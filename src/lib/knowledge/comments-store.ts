"use client";

import {
  ThreadStore,
  DefaultThreadStoreAuth,
  type CommentBody,
  type CommentData,
  type CommentReactionData,
  type ThreadData,
  type User,
} from "@blocknote/core/comments";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { extractMentionedUserIds } from "@/lib/knowledge/mention-extract";
import type { Database } from "@/types/database";
import type { KbBlock } from "@/types/knowledge";

/**
 * SupabaseThreadStore — реализация BlockNote `ThreadStore` поверх
 * нашей Supabase-БД (миграция 076: kb_threads + kb_comments).
 *
 * Контракт BlockNote:
 *   - `ThreadStore.subscribe(cb)` — оповещает UI о любых изменениях
 *     thread'ов; cb получает Map<threadId, ThreadData>.
 *   - `getThreads()` — синхронный snapshot текущих thread'ов
 *     (BlockNote вызывает на каждый render; кэшируем).
 *   - mutating методы (createThread / addComment / etc) — async,
 *     возвращают новые ThreadData / CommentData.
 *
 * Реализация:
 *   1. На mount — fetch всех thread'ов + comments страницы (initialLoad).
 *   2. Realtime НЕ используется для MVP (multi-user collab — отдельный
 *      enhancement). Optimistic update + refresh на success.
 *   3. ID'шники thread'ов / comments генерируются client-side через
 *      crypto.randomUUID() — BlockNote ожидает immediate ThreadData
 *      от createThread() для рендера mark'а в документе.
 *
 * Auth:
 *   Используем `DefaultThreadStoreAuth(userId, role)`. role='editor'
 *   если canEdit (== полный контроль над thread'ами / удаление чужих
 *   comments), 'comment' иначе (только авторский edit/delete).
 */

type ThreadRow = Database["public"]["Tables"]["kb_threads"]["Row"];
type CommentRow = Database["public"]["Tables"]["kb_comments"]["Row"];

interface SupabaseThreadStoreOptions {
  pageId: string;
  accountId: string;
  userId: string;
  /** kb.edit_any_page или kb.edit_own_pages для своей страницы.
   *  Контролирует canDeleteThread / canDeleteComment чужих. */
  isEditor: boolean;
}

export class SupabaseThreadStore extends ThreadStore {
  private supabase: SupabaseClient<Database>;
  private pageId: string;
  private accountId: string;
  private userId: string;
  private threadCache = new Map<string, ThreadData>();
  private listeners = new Set<(threads: Map<string, ThreadData>) => void>();
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;
  /** Realtime-канал из supabase_realtime publication. Sprint D Phase 5
   *  подписан на INSERT/UPDATE kb_threads/kb_comments — когда другой
   *  юзер пишет comment в этот же тред, broadcast приходит сюда и мы
   *  apply'им diff в cache + notify(). null до первого loadInitial(). */
  private realtimeChannel: RealtimeChannel | null = null;
  /** Set of comment ids, которые сами вставляли локально (createThread /
   *  addComment) — игнорим broadcast по ним, т.к. cache уже содержит
   *  optimistic-row. Без этого получали бы дубль-render и потенциально
   *  «дрожание» (если broadcast row отличается полями типа updated_at).
   */
  private localCommentIds = new Set<string>();
  private localThreadIds = new Set<string>();
  /** Set'ится в `destroy()`. Защита от race'а:
   *  `loadInitial().then(setupRealtime)` — async chain. Если юзер
   *  ушёл со страницы пока loadInitial pending'ует, destroy() запустится
   *  с `realtimeChannel=null` (ничего удалять), а потом promise
   *  резолвнется и setupRealtime создаст orphaned channel, который
   *  никто никогда не отпишет. См. Codex #62 P1. */
  private destroyed = false;

  constructor(opts: SupabaseThreadStoreOptions) {
    super(
      new DefaultThreadStoreAuth(opts.userId, opts.isEditor ? "editor" : "comment"),
    );
    this.supabase = createClient();
    this.pageId = opts.pageId;
    this.accountId = opts.accountId;
    this.userId = opts.userId;
    // Стартуем загрузку немедленно — getThreads() вернёт пустой Map
    // пока не подгрузится; subscribe-callback'и сработают по
    // завершении. setupRealtime() сам проверит destroyed-флаг — если
    // юзер успел уйти со страницы пока loadInitial pending'ует, мы
    // НЕ создаём orphaned channel.
    void this.loadInitial().then(() => this.setupRealtime());
  }

  /** Cleanup на unmount. Без unsubscribe канал утекал бы в memory
   *  и сервер продолжал бы броадкаст-ить даже когда страница закрыта.
   *  Вызывается из useEffect cleanup в KbPageEditor.
   *
   *  Idempotent — повторный вызов безопасен (флаг + null-check). */
  destroy(): void {
    this.destroyed = true;
    if (this.realtimeChannel) {
      void this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.listeners.clear();
  }

  /** Подписка на postgres_changes для kb_threads + kb_comments.
   *  RLS на обеих таблицах фильтрует rows по active account, так что
   *  кросс-аккаунт-leak невозможен. Sprint D Phase 5 / plan §2.8-E.
   *
   *  Guard на `destroyed`: вызывается из then-callback'а после
   *  loadInitial, а тот может резолвнуться УЖЕ после того как юзер
   *  ушёл со страницы (slow network / quick route change). Без guard'а
   *  получали бы fresh subscription без cleanup-сlauses → leaked
   *  channel. См. Codex #62 P1. */
  private setupRealtime(): void {
    if (this.destroyed) return;
    if (this.realtimeChannel) return;
    const channelName = `kb-comments-${this.pageId}`;
    this.realtimeChannel = this.supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kb_threads",
          filter: `page_id=eq.${this.pageId}`,
        },
        (payload) => this.handleThreadChange(payload.new as ThreadRow, payload.eventType),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kb_comments",
        },
        (payload) => this.handleCommentChange(payload.new as CommentRow, payload.eventType),
      )
      .subscribe();
  }

  /** Apply incoming thread-row из realtime. Если thread наш-же локальный
   *  (только что создал) — пропускаем (cache уже актуален). Иначе
   *  upsert'им и notify'им. */
  private handleThreadChange(
    row: ThreadRow | undefined,
    eventType: "INSERT" | "UPDATE" | "DELETE" | string,
  ): void {
    if (!row || !row.id) return;
    if (eventType === "INSERT" && this.localThreadIds.has(row.id)) {
      // Self-broadcast — cache уже содержит optimistic-thread.
      return;
    }
    // Обновляем thread, comments берём из существующего cache (real-time
    // не присылает их вместе с thread-row). Если thread soft-deleted
    // → удаляем из cache.
    if (row.deleted_at) {
      this.threadCache.delete(row.id);
    } else {
      const existing = this.threadCache.get(row.id);
      const existingComments = existing
        ? this.commentDataToRows(existing.comments)
        : [];
      this.threadCache.set(row.id, this.toThreadData(row, existingComments));
    }
    this.notify();
  }

  /** Apply incoming comment-row из realtime. Тред должен жить в
   *  threadCache (= относится к нашей странице). Если нет — пропускаем
   *  (другая страница; broadcast прилетел из-за no-filter подписки). */
  private handleCommentChange(
    row: CommentRow | undefined,
    eventType: "INSERT" | "UPDATE" | "DELETE" | string,
  ): void {
    if (!row || !row.id) return;
    if (eventType === "INSERT" && this.localCommentIds.has(row.id)) {
      return;
    }
    const thread = this.threadCache.get(row.thread_id);
    if (!thread) return;

    const existingComments = this.commentDataToRows(thread.comments);
    let next: CommentRow[];
    if (row.deleted_at) {
      // Soft-delete: помечаем comment как deleted (BlockNote всё равно
      // показывает «Comment was deleted» placeholder).
      next = existingComments.map((c) =>
        c.id === row.id ? { ...c, deleted_at: row.deleted_at, updated_at: row.updated_at } : c,
      );
    } else {
      const idx = existingComments.findIndex((c) => c.id === row.id);
      if (idx >= 0) {
        // UPDATE: replace.
        next = existingComments.slice();
        next[idx] = row;
      } else {
        // INSERT: append, sorted by created_at (matches loadInitial).
        next = [...existingComments, row].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
      }
    }
    // Re-build thread с обновлённым comments-array.
    // Используем оригинальный thread-row — для этого нужен row, но в
    // cache у нас ThreadData. Восстанавливаем фейковый row из ThreadData
    // (поля совпадают; см. toThreadData).
    const fakeThreadRow = this.threadDataToRow(thread);
    this.threadCache.set(row.thread_id, this.toThreadData(fakeThreadRow, next));
    this.notify();
  }

  /** Reverse-mapping ThreadData → ThreadRow для re-build при comment
   *  change'ах. Не идеально (теряем precision на дате), но для
   *  re-rendering достаточно. */
  private threadDataToRow(t: ThreadData): ThreadRow {
    return {
      id: t.id,
      page_id: this.pageId,
      account_id: this.accountId,
      resolved: Boolean(t.resolved),
      resolved_at: t.resolvedUpdatedAt?.toISOString() ?? null,
      resolved_by: t.resolvedBy ?? null,
      created_at: t.createdAt.toISOString(),
      updated_at: t.updatedAt.toISOString(),
      created_by: null, // не используется UI'ем после initial render
      deleted_at: t.deletedAt?.toISOString() ?? null,
      metadata: (t.metadata as Database["public"]["Tables"]["kb_threads"]["Row"]["metadata"]) ?? {},
    };
  }

  /** Reverse-mapping CommentData[] → CommentRow[] для re-build threads. */
  private commentDataToRows(comments: ThreadData["comments"]): CommentRow[] {
    return comments.map((c) => ({
      id: c.id,
      thread_id: "", // overwritten by caller
      account_id: this.accountId,
      author_id: c.userId,
      body: (("body" in c ? c.body : null) ?? null) as Database["public"]["Tables"]["kb_comments"]["Row"]["body"],
      reactions: this.reactionsToJson(c.reactions),
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
      deleted_at: "deletedAt" in c && c.deletedAt ? c.deletedAt.toISOString() : null,
      metadata: (c.metadata as Database["public"]["Tables"]["kb_comments"]["Row"]["metadata"]) ?? {},
    }));
  }

  /** CommentReactionData[] → kb_comments.reactions jsonb. Inverse от
   *  toReactions. Используется только для re-build при realtime UPDATE. */
  private reactionsToJson(
    reactions: ThreadData["comments"][number]["reactions"],
  ): Database["public"]["Tables"]["kb_comments"]["Row"]["reactions"] {
    const out: Record<string, string[]> = {};
    for (const r of reactions ?? []) {
      out[r.emoji] = r.userIds.slice();
    }
    return out as Database["public"]["Tables"]["kb_comments"]["Row"]["reactions"];
  }

  private async loadInitial(): Promise<void> {
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      const { data: threads } = await this.supabase
        .from("kb_threads")
        .select("*")
        .eq("page_id", this.pageId)
        .is("deleted_at", null);
      const threadIds = (threads ?? []).map((t) => t.id);
      if (threadIds.length === 0) {
        this.loaded = true;
        this.notify();
        return;
      }
      const { data: comments } = await this.supabase
        .from("kb_comments")
        .select("*")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: true });
      const commentsByThread = new Map<string, CommentRow[]>();
      for (const c of (comments ?? []) as CommentRow[]) {
        const arr = commentsByThread.get(c.thread_id) ?? [];
        arr.push(c);
        commentsByThread.set(c.thread_id, arr);
      }
      this.threadCache.clear();
      for (const t of (threads ?? []) as ThreadRow[]) {
        const tComments = commentsByThread.get(t.id) ?? [];
        this.threadCache.set(t.id, this.toThreadData(t, tComments));
      }
      this.loaded = true;
      this.notify();
    })();
    return this.loadingPromise;
  }

  private notify(): void {
    const snapshot = new Map(this.threadCache);
    for (const cb of this.listeners) cb(snapshot);
  }

  private toThreadData(row: ThreadRow, comments: CommentRow[]): ThreadData {
    return {
      type: "thread",
      id: row.id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      resolved: row.resolved,
      resolvedUpdatedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
      resolvedBy: row.resolved_by ?? undefined,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      comments: comments.map((c) => this.toCommentData(c)),
    };
  }

  private toCommentData(row: CommentRow): CommentData {
    const reactions = this.toReactions(row.reactions, row.created_at);
    const base = {
      type: "comment" as const,
      id: row.id,
      userId: row.author_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      reactions,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
    if (row.deleted_at) {
      return {
        ...base,
        deletedAt: new Date(row.deleted_at),
        body: undefined,
      };
    }
    return {
      ...base,
      body: row.body as CommentBody,
    };
  }

  private toReactions(
    raw: unknown,
    createdAtIso: string,
  ): CommentReactionData[] {
    if (!raw || typeof raw !== "object") return [];
    const obj = raw as Record<string, unknown>;
    const out: CommentReactionData[] = [];
    for (const [emoji, value] of Object.entries(obj)) {
      if (!Array.isArray(value)) continue;
      out.push({
        emoji,
        createdAt: new Date(createdAtIso),
        userIds: value.map((v) => String(v)),
      });
    }
    return out;
  }

  // ─── Read API ───────────────────────────────────────────────

  getThread(threadId: string): ThreadData {
    const t = this.threadCache.get(threadId);
    if (!t) {
      throw new Error(`Thread ${threadId} not found`);
    }
    return t;
  }

  getThreads(): Map<string, ThreadData> {
    // Возвращаем references on cache; BlockNote использует это
    // только для рендера и подписан через subscribe().
    return this.threadCache;
  }

  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.listeners.add(cb);
    // Немедленный вызов с текущим snapshot'ом — BlockNote ожидает
    // получить начальное состояние в первом callback'е.
    if (this.loaded) {
      cb(new Map(this.threadCache));
    } else {
      // Если ещё не загрузились — подождём loadInitial и потом отдадим.
      void this.loadInitial().then(() => cb(new Map(this.threadCache)));
    }
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ─── Write API ──────────────────────────────────────────────

  async createThread(opts: {
    initialComment: { body: CommentBody; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> {
    const threadId = crypto.randomUUID();
    const commentId = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();

    const threadRow: ThreadRow = {
      id: threadId,
      page_id: this.pageId,
      account_id: this.accountId,
      resolved: false,
      resolved_at: null,
      resolved_by: null,
      created_at: nowIso,
      updated_at: nowIso,
      created_by: this.userId,
      deleted_at: null,
      metadata: ((opts.metadata as Record<string, unknown>) ?? {}) as never,
    };

    const commentRow: CommentRow = {
      id: commentId,
      thread_id: threadId,
      account_id: this.accountId,
      body: opts.initialComment.body as never,
      author_id: this.userId,
      reactions: {},
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      metadata: ((opts.initialComment.metadata as Record<string, unknown>) ?? {}) as never,
    };

    // Optimistic insert into cache + пометить ID'шники как локальные,
    // чтобы realtime broadcast по ним не дёргал re-render (Sprint D
    // Phase 5: self-broadcast filter).
    const threadData = this.toThreadData(threadRow, [commentRow]);
    this.threadCache.set(threadId, threadData);
    this.localThreadIds.add(threadId);
    this.localCommentIds.add(commentId);
    this.notify();

    // Persist. Two sequential INSERTs (FK from comment → thread).
    const { error: tErr } = await this.supabase.from("kb_threads").insert({
      id: threadRow.id,
      page_id: threadRow.page_id,
      account_id: threadRow.account_id,
      created_by: threadRow.created_by,
      metadata: threadRow.metadata,
    });
    if (tErr) {
      this.threadCache.delete(threadId);
      this.notify();
      throw new Error(`Не удалось создать обсуждение: ${tErr.message}`);
    }

    const { error: cErr } = await this.supabase.from("kb_comments").insert({
      id: commentRow.id,
      thread_id: commentRow.thread_id,
      account_id: commentRow.account_id,
      body: commentRow.body,
      author_id: commentRow.author_id,
      metadata: commentRow.metadata,
    });
    // Fire-and-forget @-mention notifications для упомянутых сотрудников.
    // Server-RPC `kb_emit_comment_mentions` (миграция 090) идемпотентен
    // через PK kb_comment_user_mentions — повторный вызов с теми же
    // user_ids не пушит дубликаты. Никогда не блокируем save'е (если
    // упадёт — потеряли уведомление, но не save).
    if (!cErr) {
      this.emitCommentMentions(commentRow.id, opts.initialComment.body);
    }
    if (cErr) {
      // Soft-delete rollback вместо hard-delete: миграция 076 НЕ
      // даёт DELETE policy на kb_threads (table рассчитана на
      // CASCADE из kb_pages при удалении страницы, не на ручные
      // delete'ы). .delete() здесь молча отбросит RLS → orphan
      // thread без comments в БД. UPDATE deleted_at работает —
      // есть kb_threads_update policy под kb.comment_pages, а
      // loadInitial фильтрует `.is("deleted_at", null)` так что
      // orphan не вернётся в кэш и не повлияет на UI. См. Codex
      // #54 P1.
      await this.supabase
        .from("kb_threads")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", threadId);
      this.threadCache.delete(threadId);
      this.notify();
      throw new Error(`Не удалось создать комментарий: ${cErr.message}`);
    }

    return threadData;
  }

  async addComment(opts: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
  }): Promise<CommentData> {
    const commentId = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();

    const commentRow: CommentRow = {
      id: commentId,
      thread_id: opts.threadId,
      account_id: this.accountId,
      body: opts.comment.body as never,
      author_id: this.userId,
      reactions: {},
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      metadata: ((opts.comment.metadata as Record<string, unknown>) ?? {}) as never,
    };

    const commentData = this.toCommentData(commentRow);

    // Optimistic + self-broadcast filter (Sprint D Phase 5).
    this.localCommentIds.add(commentId);
    const thread = this.threadCache.get(opts.threadId);
    if (thread) {
      thread.comments = [...thread.comments, commentData];
      thread.updatedAt = now;
      this.notify();
    }

    const { error } = await this.supabase.from("kb_comments").insert({
      id: commentRow.id,
      thread_id: commentRow.thread_id,
      account_id: commentRow.account_id,
      body: commentRow.body,
      author_id: commentRow.author_id,
      metadata: commentRow.metadata,
    });
    if (error) {
      if (thread) {
        thread.comments = thread.comments.filter((c) => c.id !== commentId);
        this.notify();
      }
      throw new Error(`Не удалось добавить комментарий: ${error.message}`);
    }

    // Fire-and-forget @-mention notifications.
    this.emitCommentMentions(commentRow.id, opts.comment.body);

    return commentData;
  }

  /** Извлекает @-mention'ы из BlockNote-body коммента и пушит RPC.
   *  Не throw'ит — если RPC упадёт, save коммента уже состоялся, а
   *  notification — best-effort. */
  private emitCommentMentions(commentId: string, body: CommentBody): void {
    const blocks = (Array.isArray(body) ? body : []) as KbBlock[];
    const userIds = extractMentionedUserIds(blocks);
    if (userIds.length === 0) return;
    void this.supabase
      .rpc("kb_emit_comment_mentions", {
        p_comment_id: commentId,
        p_user_ids: userIds,
      })
      .then(({ error }) => {
        if (error) {
          console.warn("[kb-comment] emit mentions failed", {
            commentId,
            error: error.message,
          });
        }
      });
  }

  async updateComment(opts: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
    commentId: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .from("kb_comments")
      .update({
        body: opts.comment.body as never,
        metadata: ((opts.comment.metadata as Record<string, unknown>) ?? {}) as never,
        updated_at: new Date().toISOString(),
      })
      .eq("id", opts.commentId);
    if (error) {
      throw new Error(`Не удалось обновить комментарий: ${error.message}`);
    }

    const thread = this.threadCache.get(opts.threadId);
    if (thread) {
      const idx = thread.comments.findIndex((c) => c.id === opts.commentId);
      if (idx !== -1) {
        const cur = thread.comments[idx];
        thread.comments[idx] = {
          ...cur,
          body: opts.comment.body,
          deletedAt: undefined,
          updatedAt: new Date(),
          metadata:
            (opts.comment.metadata as Record<string, unknown>) ?? cur.metadata,
        } as CommentData;
        this.notify();
      }
    }
  }

  async deleteComment(opts: {
    threadId: string;
    commentId: string;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    const { error } = await this.supabase
      .from("kb_comments")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("id", opts.commentId);
    if (error) {
      throw new Error(`Не удалось удалить комментарий: ${error.message}`);
    }

    const thread = this.threadCache.get(opts.threadId);
    if (thread) {
      const idx = thread.comments.findIndex((c) => c.id === opts.commentId);
      if (idx !== -1) {
        const cur = thread.comments[idx];
        thread.comments[idx] = {
          ...cur,
          deletedAt: new Date(nowIso),
          body: undefined,
        } as CommentData;
        this.notify();
      }
    }
  }

  async deleteThread(opts: { threadId: string }): Promise<void> {
    const nowIso = new Date().toISOString();
    const { error } = await this.supabase
      .from("kb_threads")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("id", opts.threadId);
    if (error) {
      throw new Error(`Не удалось удалить обсуждение: ${error.message}`);
    }
    this.threadCache.delete(opts.threadId);
    this.notify();
  }

  async resolveThread(opts: { threadId: string }): Promise<void> {
    const nowIso = new Date().toISOString();
    const { error } = await this.supabase
      .from("kb_threads")
      .update({
        resolved: true,
        resolved_at: nowIso,
        resolved_by: this.userId,
        updated_at: nowIso,
      })
      .eq("id", opts.threadId);
    if (error) {
      throw new Error(`Не удалось закрыть обсуждение: ${error.message}`);
    }
    const thread = this.threadCache.get(opts.threadId);
    if (thread) {
      thread.resolved = true;
      thread.resolvedUpdatedAt = new Date(nowIso);
      thread.resolvedBy = this.userId;
      thread.updatedAt = new Date(nowIso);
      this.notify();
    }
  }

  async unresolveThread(opts: { threadId: string }): Promise<void> {
    const nowIso = new Date().toISOString();
    const { error } = await this.supabase
      .from("kb_threads")
      .update({
        resolved: false,
        resolved_at: null,
        resolved_by: null,
        updated_at: nowIso,
      })
      .eq("id", opts.threadId);
    if (error) {
      throw new Error(`Не удалось переоткрыть обсуждение: ${error.message}`);
    }
    const thread = this.threadCache.get(opts.threadId);
    if (thread) {
      thread.resolved = false;
      thread.resolvedUpdatedAt = undefined;
      thread.resolvedBy = undefined;
      thread.updatedAt = new Date(nowIso);
      this.notify();
    }
  }

  async addReaction(opts: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> {
    const { error } = await this.supabase.rpc("kb_comment_react", {
      p_comment_id: opts.commentId,
      p_emoji: opts.emoji,
    });
    if (error) {
      throw new Error(`Не удалось поставить реакцию: ${error.message}`);
    }
    // Refresh comment from server для аккуратного reactions-array.
    await this.refreshComment(opts.threadId, opts.commentId);
  }

  async deleteReaction(opts: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> {
    const { error } = await this.supabase.rpc("kb_comment_unreact", {
      p_comment_id: opts.commentId,
      p_emoji: opts.emoji,
    });
    if (error) {
      throw new Error(`Не удалось убрать реакцию: ${error.message}`);
    }
    await this.refreshComment(opts.threadId, opts.commentId);
  }

  private async refreshComment(
    threadId: string,
    commentId: string,
  ): Promise<void> {
    const { data } = await this.supabase
      .from("kb_comments")
      .select("*")
      .eq("id", commentId)
      .maybeSingle();
    if (!data) return;
    const thread = this.threadCache.get(threadId);
    if (!thread) return;
    const idx = thread.comments.findIndex((c) => c.id === commentId);
    if (idx === -1) return;
    thread.comments[idx] = this.toCommentData(data as CommentRow);
    this.notify();
  }

  // addThreadToDocument — оставляем default behavior (BlockNote сам
  // создаёт mark в документе через TipTap). Если бы мы хотели
  // server-side managment позиций — тут была бы реализация.
  addThreadToDocument = undefined;
}

/** Resolve user info для CommentsExtension `resolveUsers` callback.
 *  BlockNote передаёт массив userIds — возвращаем User[] с avatar. */
export async function resolveKbUsers(userIds: string[]): Promise<User[]> {
  if (userIds.length === 0) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .in("id", userIds);
  if (!data) return [];
  return data.map((p) => {
    const fullName =
      [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
      "Без имени";
    return {
      id: p.id,
      username: fullName,
      avatarUrl: p.avatar_url ?? "",
    };
  });
}
