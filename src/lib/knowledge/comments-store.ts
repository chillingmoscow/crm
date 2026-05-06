"use client";

import {
  ThreadStore,
  ThreadStoreAuth,
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

/** Кастомная auth-политика для KB:
 *   • create / addComment / addReaction — true (доступ к комментам уже
 *     gate'нут на mount'е через canComment).
 *   • update comment — только автор.
 *   • delete comment — автор ИЛИ editor.
 *   • resolve / unresolve / delete thread — автор треда ИЛИ editor.
 *
 * BN-default (`DefaultThreadStoreAuth`) пускал ВСЕХ резолвить тред и
 * блокировал автора, если он не editor. Это противоречит ожиданиям
 * юзера: «решить может либо автор, либо должность с правами». */
class KbThreadStoreAuth extends ThreadStoreAuth {
  private userId: string;
  private isEditor: boolean;
  private isThreadCreator: (threadId: string) => boolean;

  constructor(opts: {
    userId: string;
    isEditor: boolean;
    isThreadCreator: (threadId: string) => boolean;
  }) {
    super();
    this.userId = opts.userId;
    this.isEditor = opts.isEditor;
    this.isThreadCreator = opts.isThreadCreator;
  }

  canCreateThread(): boolean {
    return true;
  }
  canAddComment(): boolean {
    return true;
  }
  canUpdateComment(comment: CommentData): boolean {
    return comment.userId === this.userId;
  }
  canDeleteComment(comment: CommentData): boolean {
    return comment.userId === this.userId || this.isEditor;
  }
  canDeleteThread(thread: ThreadData): boolean {
    return this.isThreadCreator(thread.id) || this.isEditor;
  }
  canResolveThread(thread: ThreadData): boolean {
    return this.isThreadCreator(thread.id) || this.isEditor;
  }
  canUnresolveThread(thread: ThreadData): boolean {
    return this.isThreadCreator(thread.id) || this.isEditor;
  }
  canAddReaction(comment: CommentData, emoji?: string): boolean {
    if (!emoji) return true;
    const r = (comment.reactions ?? []).find((x) => x.emoji === emoji);
    if (!r) return true;
    return !r.userIds.includes(this.userId);
  }
  canDeleteReaction(comment: CommentData, emoji?: string): boolean {
    if (!emoji) return true;
    const r = (comment.reactions ?? []).find((x) => x.emoji === emoji);
    if (!r) return false;
    return r.userIds.includes(this.userId);
  }
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

  /** threadId → kb_threads.created_by. Заполняется в loadInitial /
   *  realtime updates. Используется KbThreadStoreAuth для проверки
   *  «автор треда может resolve / delete независимо от editor-роли». */
  private threadCreators = new Map<string, string | null>();

  /** ID последнего треда, созданного через `createThread()`. Composer
   *  читает после await'а чтобы открыть thread popover (selectThread)
   *  на свежесозданном треде — UX «сразу видишь что комментарий
   *  опубликовался».
   *
   *  Read-only снаружи, set'им только в createThread. */
  public lastCreatedThreadId: string | null = null;

  constructor(opts: SupabaseThreadStoreOptions) {
    const auth = new KbThreadStoreAuth({
      userId: opts.userId,
      isEditor: opts.isEditor,
      isThreadCreator: (threadId: string) =>
        this.threadCreators.get(threadId) === opts.userId,
    });
    super(auth);
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
          filter: `page_id=eq.${this.pageId}`,
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
      // KbThreadStoreAuth смотрит в this.threadCreators, поэтому
      // re-build при realtime UPDATE'е должен сохранять автора (не null).
      created_by: this.threadCreators.get(t.id) ?? null,
      deleted_at: t.deletedAt?.toISOString() ?? null,
      metadata: (t.metadata as Database["public"]["Tables"]["kb_threads"]["Row"]["metadata"]) ?? {},
    };
  }

  /** Reverse-mapping CommentData[] → CommentRow[] для re-build threads. */
  private commentDataToRows(comments: ThreadData["comments"]): CommentRow[] {
    return comments.map((c) => ({
      id: c.id,
      thread_id: "", // overwritten by caller
      page_id: this.pageId,
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
    // Запоминаем автора треда — KbThreadStoreAuth.canResolveThread
    // и canDeleteThread смотрят сюда чтобы пускать автора независимо
    // от editor-роли.
    this.threadCreators.set(row.id, row.created_by ?? null);
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
      page_id: this.pageId,
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
    this.lastCreatedThreadId = threadId;
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
      page_id: commentRow.page_id,
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
      page_id: this.pageId,
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
      page_id: commentRow.page_id,
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

    // Re-emit @-mention notifs если в edit'е появились новые упоминания.
    // PK kb_comment_user_mentions(comment_id, user_id) защищает старых
    // mention'ов от повторов — RPC silent-no-op'ит на уже-known users.
    // Новые user_ids получают свежий notif. Без этого юзер мог бы
    // добавить @-mention edit'ом и получатель ничего не узнал бы.
    this.emitCommentMentions(opts.commentId, opts.comment.body);

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

  // ─── Position-persistence для comment-mark'ов ──────────────────
  //
  // BlockNote'овский nodeToBlock-сериализатор (blocks-CSfJen16.js:622)
  // strip'ает comment-mark'и при конверсии PM-doc → BN-blocks, потому
  // что они помечены `blocknoteIgnore: true` (comments.js:37). BN
  // полагается на Yjs для cross-session persistence; без Yjs марки
  // живут только в TipTap state'е и теряются при reload'е (тред
  // становится orphan).
  //
  // Воркэраунд: храним позицию `{from, to}` в `kb_threads.metadata.position`
  // и re-apply'ем mark при загрузке editor'а через `applyAllMarksToEditor`.
  // На каждом save-цикле вызываем `captureCommentMarkPositions(editor)` —
  // это берёт текущие PM-позиции и обновляет metadata, корректируя drift
  // от последующих edit'ов до маркированного диапазона.

  /** Outer editor reference. Set'ится из KbBlockNoteEditor когда
   *  editor смонтирован. Используется в addThreadToDocument +
   *  applyAllMarksToEditor + captureCommentMarkPositions. */
  private editor: unknown = null;

  setEditor(editor: unknown): void {
    this.editor = editor;
  }

  addThreadToDocument = async (opts: {
    threadId: string;
    selection: {
      prosemirror?: { from?: number; to?: number; head?: number; anchor?: number };
    };
  }): Promise<void> => {
    const pmSel = opts.selection?.prosemirror ?? {};
    const head = typeof pmSel.head === "number" ? pmSel.head : pmSel.from;
    const anchor = typeof pmSel.anchor === "number" ? pmSel.anchor : pmSel.to;
    if (typeof head !== "number" || typeof anchor !== "number") return;
    const from = Math.min(head, anchor);
    const to = Math.max(head, anchor);
    if (from === to) return; // empty selection — skip mark

    // 1) Save position в metadata. Без этого reload не восстановит mark.
    //    Берём также text-fingerprint выделения — на reload сверяемся
    //    что doc.textBetween(from, to) совпадает; если PM-позиции
    //    drift'нули относительно сохранённых, ищем `text` в doc'е
    //    и пере-якоримся к актуальной позиции (см. applyAllMarksToEditor).
    const text = readDocTextBetween(this.editor, from, to);
    await this.persistThreadPosition(opts.threadId, from, to, text);

    // 2) Apply mark в editor через PM low-level dispatch (обходит
    //    TipTap'овский editable-check на locked-страницах).
    const editor = this.editor as
      | {
          _tiptapEditor?: {
            view?: {
              state: {
                schema: { marks: Record<string, unknown> };
                tr: { addMark: (from: number, to: number, mark: unknown) => unknown };
              };
              dispatch: (tr: unknown) => void;
            };
          };
        }
      | null;
    const view = editor?._tiptapEditor?.view;
    if (!view) return;
    const markType = (
      view.state.schema.marks as Record<string, { create: (attrs: unknown) => unknown }>
    ).comment;
    if (!markType) return;
    const tr = (
      view.state.tr as unknown as {
        addMark: (from: number, to: number, mark: unknown) => unknown;
      }
    ).addMark(from, to, markType.create({ orphan: false, threadId: opts.threadId }));
    view.dispatch(tr);
  };

  /** Re-apply все comment-mark'и в редактор из сохранённых позиций
   *  metadata. Вызывается ПОСЛЕ начальной загрузки документа И на
   *  каждом threadStore-notify (realtime INSERT/UPDATE из других
   *  юзеров).
   *
   *  ВАЖНО: сначала removeMark для каждого treadId, ПОТОМ addMark —
   *  metadata.position должна быть единственным источником правды.
   *  Раньше применяли только addMark; PM addMark на уже-помеченном
   *  диапазоне идемпотентен ТОЛЬКО когда mark с тем же attrs полностью
   *  лежит в новом range. Если по какой-то причине существующий mark
   *  оказался шире (BN keepOnSplit, manual mark-edit, baggage от
   *  предыдущей версии и т.п.), повторный addMark не сужал range, и
   *  каждый цикл reload + apply раздувал highlight ещё на ε. Юзер
   *  видел постепенное «расползание» комментариев. Remove+add
   *  гарантирует exact-match с metadata. */
  applyAllMarksToEditor(): void {
    const editor = this.editor as
      | {
          _tiptapEditor?: {
            view?: {
              state: {
                doc: { content: { size: number }; nodeAt: (pos: number) => unknown };
                schema: { marks: Record<string, unknown> };
                tr: unknown;
              };
              dispatch: (tr: unknown) => void;
            };
          };
        }
      | null;
    const view = editor?._tiptapEditor?.view;
    if (!view) return;
    const markType = (
      view.state.schema.marks as Record<
        string,
        { create: (attrs: unknown) => unknown; name: string }
      >
    ).comment as
      | { create: (attrs: unknown) => unknown; name: string }
      | undefined;
    if (!markType) return;

    const docSize = view.state.doc.content.size;

    // Walk doc once и собираем текущие comment-mark диапазоны по threadId.
    // Используется (а) для no-op-guard'а ниже — если target-набор marks
    // точно совпадает с текущим, не диспатчим транзакцию вообще; (б) для
    // отслеживания orphan-flag'а, чтобы дёрнуть update даже если from/to
    // те же, но `resolved` поменялось.
    //
    // КРИТИЧНО: без этого guard'а каждый notify() (даже на свои же
    // position-updates) приводил к removeMark+addMark dispatch'у → PM
    // фиксирует docChanged=true → BlockNote onChange → parent
    // scheduleSave → 2 сек → flush → captureCommentMarkPositions →
    // UPDATE kb_threads.metadata → notify() → loop. См. plan
    // frolicking-gathering-aho.md §P0.
    const currentMarks = new Map<
      string,
      { from: number; to: number; orphan: boolean }
    >();
    {
      const walkDoc = view.state.doc as unknown as {
        descendants: (
          cb: (
            node: {
              isText: boolean;
              marks: Array<{
                type: { name: string };
                attrs: Record<string, unknown>;
              }>;
              nodeSize: number;
            },
            pos: number,
          ) => void,
        ) => void;
      };
      walkDoc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const mark of node.marks ?? []) {
          if (mark.type.name !== "comment") continue;
          const tid = mark.attrs.threadId as string | undefined;
          if (!tid) continue;
          const orphan = Boolean(mark.attrs.orphan);
          const from = pos;
          const to = pos + node.nodeSize;
          const cur = currentMarks.get(tid);
          if (!cur) {
            currentMarks.set(tid, { from, to, orphan });
          } else {
            currentMarks.set(tid, {
              from: Math.min(cur.from, from),
              to: Math.max(cur.to, to),
              orphan: cur.orphan || orphan,
            });
          }
        }
      });
    }

    let tr = view.state.tr as unknown as {
      addMark: (from: number, to: number, mark: unknown) => unknown;
      removeMark: (
        from: number,
        to: number,
        mark: { type: { name: string } } | unknown,
      ) => unknown;
      setMeta: (key: string, value: unknown) => unknown;
    };
    // Снимаем все существующие comment-марки на всём документе.
    // PM-сигнатура `removeMark(from, to, MarkType)` очищает все марки
    // данного типа в диапазоне. Полный сброс перед re-apply — самый
    // дешёвый способ обеспечить metadata-as-source-of-truth.
    tr = tr.removeMark(0, docSize, markType as unknown) as typeof tr;

    // Подготавливаем char-map для drift-correction: если у thread
    // есть text-fingerprint и текст по сохранённым PM-позициям не
    // совпадает (drift), ищем `text` в плоской строке doc'а и
    // пере-якоримся к найденной позиции. Стоимость walk'а — однократно
    // на apply (O(text-content-size)).
    let charMap: { flat: string; pmPositions: number[] } | null = null;
    const ensureCharMap = () => {
      if (!charMap) {
        charMap = buildDocCharMap(
          view.state.doc as unknown as {
            descendants: (
              cb: (node: { isText: boolean; text?: string }, pos: number) => void,
            ) => void;
          },
        );
      }
      return charMap;
    };

    // Re-apply'им марки для всех тредов с position в metadata. Важно
    // включать и resolved/deleted-threads с orphan=true, иначе после
    // removeMark выше они бы полностью исчезли из UI. BN-plugin сам
    // потом синхронизирует orphan-flag, но для повторного запуска
    // applyAllMarksToEditor нам нужно чтобы исходное состояние было
    // правильное.
    const correctedPositions = new Map<string, { from: number; to: number; text: string }>();
    // Target-набор marks — тот, который мы СОБИРАЕМСЯ применить.
    // Сравниваем с currentMarks (выше) после расчёта drift-correction'а.
    // Если совпадают точь-в-точь, dispatch не делаем (no-op-guard).
    const targetMarks = new Map<
      string,
      { from: number; to: number; orphan: boolean }
    >();
    for (const thread of this.threadCache.values()) {
      // Hard-deleted threads (deletedAt set, и DB row помечена) —
      // не должны иметь mark'а вообще: BN-логика всё равно показала
      // бы их как orphan, но тред сам удалён → нечего показывать.
      if (thread.deletedAt) continue;
      const meta = thread.metadata as
        | { position?: { from?: number; to?: number; text?: string } }
        | null;
      const storedFrom = meta?.position?.from;
      const storedTo = meta?.position?.to;
      const storedText = meta?.position?.text;
      if (typeof storedFrom !== "number" || typeof storedTo !== "number") continue;

      // Default: numeric positions из metadata, clamp'нутые к docSize.
      let safeFrom = Math.max(0, Math.min(storedFrom, docSize));
      let safeTo = Math.max(0, Math.min(storedTo, docSize));

      // Drift-correction: если у нас есть text-fingerprint и текущий
      // текст по сохранённым PM-позициям отличается, ищем `text` в
      // doc'е и пере-якоримся. Без этого PM-positions могут уплыть из-
      // за serialization-roundtrip'а (BN strip'ает comment-марки → JSON
      // → reload → новый PM-doc, где position-numbering может слегка
      // отличаться от того, что было сохранено).
      if (typeof storedText === "string" && storedText.length > 0) {
        let currentText: string;
        try {
          currentText = (
            view.state.doc as unknown as {
              textBetween: (
                from: number,
                to: number,
                blockSeparator?: string,
                leafText?: string,
              ) => string;
            }
          ).textBetween(safeFrom, safeTo, "\n", "");
        } catch {
          currentText = "";
        }
        if (currentText !== storedText) {
          // Drift detected — search для re-anchor'а.
          const map = ensureCharMap();
          const flat = map.flat;
          // Заменяем "\n" в storedText на "" для матча против flat
          // (где block-separator не вносится — buildDocCharMap идёт
          // только по text-content). Если storedText содержит "\n"
          // (multi-block selection) — пытаемся matched substring без них,
          // НО затем верифицируем: textBetween(found.from, found.to,
          // "\n") должен совпадать с оригинальным storedText (с
          // newline'ами). Иначе re-anchor мог match'нуть single-block
          // "foobar" для оригинального "foo\nbar" — Codex P1 #2 на
          // PR #139.
          const needle = storedText.replace(/\n/g, "");
          if (needle.length > 0) {
            // Codex P1 #1 на PR #139: первый global indexOf может
            // привязаться к чужому occurrence'у текста (если "Hello"
            // встречается дважды и thread был на втором — мы бы
            // переякорились на первый, и потом persist'нули wrong-
            // position навсегда). Перебираем ВСЕ совпадения и берём
            // ближайшее по PM-position'у к storedFrom — sane default,
            // т.к. drift обычно небольшой относительно оригинала.
            let bestIdx = -1;
            let bestDistance = Infinity;
            let searchFrom = 0;
            while (searchFrom <= flat.length - needle.length) {
              const idx = flat.indexOf(needle, searchFrom);
              if (idx < 0) break;
              const candidatePm = map.pmPositions[idx];
              const distance = Math.abs(candidatePm - storedFrom);
              if (distance < bestDistance) {
                bestDistance = distance;
                bestIdx = idx;
              }
              searchFrom = idx + 1;
            }

            if (
              bestIdx >= 0 &&
              bestIdx + needle.length <= map.pmPositions.length
            ) {
              const newFrom = map.pmPositions[bestIdx];
              // End = pos последнего char'а + 1 (PM-позиции — это
              // позиции МЕЖДУ char'ами).
              const newTo = map.pmPositions[bestIdx + needle.length - 1] + 1;
              if (newFrom < newTo && newTo <= docSize) {
                // Verify: textBetween по найденным PM-позициям должен
                // ровно совпадать с оригинальным storedText (включая
                // "\n" между блоками). Это отлавливает случаи когда
                // multi-block storedText "foo\nbar" попал в single-
                // block "foobar" или наоборот — без verify мы бы
                // persist'нули wrong position и переходили в loop
                // mismatch → re-anchor → mismatch на каждом apply'е.
                let verifiedText = "";
                try {
                  verifiedText = (
                    view.state.doc as unknown as {
                      textBetween: (
                        from: number,
                        to: number,
                        blockSeparator?: string,
                        leafText?: string,
                      ) => string;
                    }
                  ).textBetween(newFrom, newTo, "\n", "");
                } catch {
                  verifiedText = "";
                }
                if (verifiedText === storedText) {
                  safeFrom = newFrom;
                  safeTo = newTo;
                  // Persist'им скорректированную позицию — next save /
                  // reload не будут повторять re-anchor.
                  correctedPositions.set(thread.id, {
                    from: newFrom,
                    to: newTo,
                    text: storedText,
                  });
                }
              }
            }
          }
        }
      }

      if (safeFrom >= safeTo) continue;
      const orphan = Boolean(thread.resolved);
      targetMarks.set(thread.id, { from: safeFrom, to: safeTo, orphan });
      tr = tr.addMark(
        safeFrom,
        safeTo,
        markType.create({
          orphan,
          threadId: thread.id,
        }),
      ) as typeof tr;
    }

    // No-op-guard: если target-набор marks ровно совпадает с тем, что
    // уже стоит в doc'е, не диспатчим транзакцию. Без guard'а dispatch
    // фиксирует docChanged → BlockNote onChange → parent scheduleSave →
    // потенциальная петля через captureCommentMarkPositions → notify().
    let identical = currentMarks.size === targetMarks.size;
    if (identical) {
      for (const [tid, target] of targetMarks) {
        const cur = currentMarks.get(tid);
        if (
          !cur ||
          cur.from !== target.from ||
          cur.to !== target.to ||
          cur.orphan !== target.orphan
        ) {
          identical = false;
          break;
        }
      }
    }
    if (identical) {
      // Persist drift-correction'ы всё равно — позиции пересобраны и
      // нужно записать их в БД (чтобы next reload не перезапускал
      // re-anchor). Сам dispatch — пропущен.
      for (const [threadId, p] of correctedPositions) {
        void this.persistThreadPosition(threadId, p.from, p.to, p.text).catch(
          (err) => {
            console.warn("[kb-comments] re-anchor persist failed", {
              threadId,
              error: err,
            });
          },
        );
      }
      return;
    }
    // setMeta('addToHistory', false) — re-apply'ы comment-mark'ов после
    // realtime-event'а от других юзеров не должны попадать в undo-стек:
    // ctrl-Z должен возвращать ТОЛЬКО собственные правки, а не «снимать»
    // чужие комменты. Для local-cycle'а тоже безвредно.
    tr = tr.setMeta("addToHistory", false) as typeof tr;
    view.dispatch(tr);

    // Fire-and-forget: persist'им скорректированные позиции в DB,
    // чтобы next save / reload не делали re-anchor (драйфт зафиксирован).
    // Без этого drift возникал бы повторно при каждом cycle'е.
    for (const [threadId, p] of correctedPositions) {
      void this.persistThreadPosition(threadId, p.from, p.to, p.text).catch(
        (err) => {
          console.warn("[kb-comments] re-anchor persist failed", {
            threadId,
            error: err,
          });
        },
      );
    }
  }

  /** Walks PM doc, находит все comment-mark'и, обновляет
   *  metadata.position если позиция drift'нула с прошлой записи.
   *  Вызывается на save-cycle'е чтобы корректировать сдвиги от
   *  edit'ов окружающего текста. */
  async captureCommentMarkPositions(): Promise<void> {
    const editor = this.editor as
      | { _tiptapEditor?: { view?: { state: { doc: unknown } } } }
      | null;
    const view = editor?._tiptapEditor?.view;
    if (!view) return;

    const positions = new Map<string, { from: number; to: number }>();
    const doc = view.state.doc as unknown as {
      descendants: (
        cb: (
          node: {
            isText: boolean;
            marks: Array<{ type: { name: string }; attrs: Record<string, unknown> }>;
            nodeSize: number;
          },
          pos: number,
        ) => void,
      ) => void;
    };
    doc.descendants((node, pos) => {
      // Comment — inline mark; живёт ТОЛЬКО на текстовых нод'ах. Если
      // в PM-doc'е оказался блок-уровневый узел (paragraph/heading/
      // blockContainer) с этим маркой (теоретически возможно при
      // schema-quirk'ах или импортах), его `nodeSize` включает open/
      // close-токены + всё содержимое — captured-range получился бы
      // намного шире фактически выделенного текста. Это и был
      // источник «расширяющихся» highlight'ов после перезагрузок:
      // широкий range писался в metadata → applyAllMarksToEditor
      // повторно применял его → mark разрастался каждый цикл.
      if (!node.isText) return;
      for (const mark of node.marks ?? []) {
        if (mark.type.name !== "comment") continue;
        const tid = mark.attrs.threadId as string | undefined;
        const orphan = mark.attrs.orphan as boolean | undefined;
        if (!tid || orphan) continue;
        const from = pos;
        const to = pos + node.nodeSize;
        const cur = positions.get(tid);
        if (!cur) {
          positions.set(tid, { from, to });
        } else {
          // Mark может быть разбит на несколько inline-runs (если
          // часть текста имела доп. форматирование) — расширяем range.
          positions.set(tid, {
            from: Math.min(cur.from, from),
            to: Math.max(cur.to, to),
          });
        }
      }
    });

    const writes: Array<Promise<void>> = [];
    for (const [threadId, pos] of positions) {
      const thread = this.threadCache.get(threadId);
      if (!thread) continue;
      const meta = thread.metadata as
        | { position?: { from?: number; to?: number; text?: string } }
        | null;
      const prev = meta?.position;
      // Также захватываем text-fingerprint — содержимое текста под
      // mark'ом. На reload используем для re-anchor'а если PM-позиции
      // drift'нули (см. applyAllMarksToEditor).
      const text = readDocTextBetween(this.editor, pos.from, pos.to);
      if (
        prev &&
        prev.from === pos.from &&
        prev.to === pos.to &&
        prev.text === text
      ) {
        continue;
      }
      writes.push(this.persistThreadPosition(threadId, pos.from, pos.to, text));
    }

    // Threads с metadata.position, но БЕЗ соответствующего mark'а в
    // doc'е — их marked-text был удалён. Без этой ветки stale position
    // оставался в metadata, и applyAllMarksToEditor на reload'е
    // re-apply'ил их к ЧУЖОМУ тексту по тем же координатам. Codex #80 P1.
    for (const thread of this.threadCache.values()) {
      const meta = thread.metadata as { position?: { from?: number; to?: number } } | null;
      const prev = meta?.position;
      if (!prev) continue;
      if (positions.has(thread.id)) continue; // Mark есть — позиция уже закаптурена выше.
      if (thread.deletedAt || thread.resolved) continue; // Этим thread'ам всё равно не applyMarks.
      // Mark исчез — clear position. Тред становится orphan'ом, popover
      // открывать только из ThreadsSidebar или per-thread навигации.
      writes.push(this.clearThreadPosition(thread.id));
    }
    await Promise.all(writes);
  }

  /** Records `metadata.position={from, to}` в БД + локальном кэше.
   *  КРИТИЧНО: DB update FIRST, mutation cache ТОЛЬКО на success.
   *  Если порядок обратный, transient DB-fail оставляет cache с
   *  «новой» позицией, и captureCommentMarkPositions на следующем
   *  save'е сравнивает свежий drift с этой fake-prev → пропускает
   *  retry → позиция не доезжает до БД и теряется на reload'е.
   *  Codex #80 P2. */
  private async persistThreadPosition(
    threadId: string,
    from: number,
    to: number,
    text: string | null = null,
  ): Promise<void> {
    const thread = this.threadCache.get(threadId);
    const newMetadata = {
      ...((thread?.metadata as Record<string, unknown>) ?? {}),
      // text-fingerprint опционален: legacy-position'ы (без text)
      // продолжают работать. Новые добавления всегда пишут text для
      // re-anchor'а на reload'е (drift-correction).
      position: text ? { from, to, text } : { from, to },
    };
    const { error } = await this.supabase
      .from("kb_threads")
      .update({ metadata: newMetadata as never, updated_at: new Date().toISOString() })
      .eq("id", threadId);
    if (error) {
      console.warn("[kb-comments] persist position failed", {
        threadId,
        error: error.message,
      });
      return; // Cache untouched — next save retries.
    }
    if (thread) {
      thread.metadata = newMetadata;
      // Намеренно НЕ зовём this.notify(): metadata.position не отображается
      // в UI (не sidebar, не floating-thread, не composer) — единственный
      // её consumer — applyAllMarksToEditor на следующем reload'е, который
      // читает свежий threadCache в любом случае. notify() здесь раньше
      // запускал applyAllMarksToEditor через подписчика в blocknote-editor.tsx,
      // что в свою очередь дёргало editor.dispatch → onChange → scheduleSave
      // и приводило к петле автосейва. См. plan §P0.
    }
  }

  /** Очищает `metadata.position` (и в БД, и в кэше). Используется когда
   *  marked text был удалён — stale position не должна re-apply'иться. */
  private async clearThreadPosition(threadId: string): Promise<void> {
    const thread = this.threadCache.get(threadId);
    if (!thread) return;
    const cur = (thread.metadata as Record<string, unknown> | null) ?? {};
    if (!("position" in cur)) return;
    const { position: _omit, ...rest } = cur;
    void _omit;
    const { error } = await this.supabase
      .from("kb_threads")
      .update({ metadata: rest as never, updated_at: new Date().toISOString() })
      .eq("id", threadId);
    if (error) {
      console.warn("[kb-comments] clear position failed", {
        threadId,
        error: error.message,
      });
      return;
    }
    thread.metadata = rest;
    // Та же мотивация что и в persistThreadPosition: position не имеет
    // UI-consumer'ов, notify() лишний и провоцирует applyAllMarksToEditor.
  }
}

/** Читает текст между PM-позициями [from, to] из текущего doc'а.
 *  Используется для text-fingerprint'а thread.metadata.position —
 *  храним содержимое выделенного текста чтобы на reload'е сверить /
 *  пере-якориться если PM-позиции drift'нули.
 *
 *  Block-separator = "\n" (если выделение пересекает границу блоков),
 *  leafText = "" — атомарные leaf-ноды (mention chip и т.п.) не
 *  считаем char'ами, чтобы fingerprint фокусировался на text-content. */
function readDocTextBetween(
  editor: unknown,
  from: number,
  to: number,
): string | null {
  const view = (editor as
    | {
        _tiptapEditor?: {
          view?: {
            state: {
              doc: {
                content: { size: number };
                textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
              };
            };
          };
        }
      } | null)?._tiptapEditor?.view;
  if (!view) return null;
  const doc = view.state.doc;
  const docSize = doc.content.size;
  if (from < 0 || to > docSize || from >= to) return null;
  try {
    return doc.textBetween(from, to, "\n", "");
  } catch {
    return null;
  }
}

/** Перебирает все text-узлы doc'а и склеивает их в плоскую строку
 *  с маппингом каждого char'а в абсолютную PM-позицию. Используется
 *  в applyAllMarksToEditor для re-anchor'а: если metadata.text не
 *  совпадает с текстом по сохранённым PM-позициям, ищем text в
 *  плоской строке и пересчитываем PM-позиции для marka.
 *
 *  Атомарные leaf-ноды (mentions, attachment-chips) не вносят char'ов
 *  — flat string содержит ТОЛЬКО реальные text-content символы из
 *  text-узлов. Это совпадает с поведением `readDocTextBetween` без
 *  leafText. */
function buildDocCharMap(doc: {
  descendants: (
    cb: (node: { isText: boolean; text?: string }, pos: number) => void,
  ) => void;
}): { flat: string; pmPositions: number[] } {
  const flat: string[] = [];
  const pmPositions: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || typeof node.text !== "string") return;
    for (let i = 0; i < node.text.length; i++) {
      flat.push(node.text[i]);
      pmPositions.push(pos + i);
    }
  });
  return { flat: flat.join(""), pmPositions };
}

/** Resolve user info для CommentsExtension `resolveUsers` callback.
 *  BlockNote передаёт массив userIds — возвращаем User[] с avatar.
 *
 *  Использует account-scoped RPC `kb_resolve_users_by_ids` (миграция
 *  101) — точечный fetch по запрошенному списку без 25-лимита из
 *  `kb_list_account_members`. Codex #92 P1 fix: для аккаунтов с >25
 *  members часть юзеров silently не возвращалась и попадала под
 *  placeholder «Удалённый пользователь».
 *
 *  Placeholder остаётся для missing IDs: BN ожидает entry для
 *  КАЖДОГО userId в request'е (internal useUsers Map-lookup). Если
 *  юзер удалён / off-boarded / выбыл из аккаунта — placeholder
 *  гарантирует, что BN не падает. */
export async function resolveKbUsers(userIds: string[]): Promise<User[]> {
  if (userIds.length === 0) return [];
  const supabase = createClient();
  const { data } = await supabase.rpc("kb_resolve_users_by_ids", {
    p_user_ids: userIds,
  });
  const found = new Map<string, User>();
  for (const m of data ?? []) {
    const fullName =
      [m.first_name, m.last_name].filter(Boolean).join(" ").trim() ||
      "Без имени";
    found.set(m.id, {
      id: m.id,
      username: fullName,
      avatarUrl: m.avatar_url ?? "",
    });
  }
  return userIds.map(
    (id): User =>
      found.get(id) ?? {
        id,
        username: "Удалённый пользователь",
        avatarUrl: "",
      },
  );
}
