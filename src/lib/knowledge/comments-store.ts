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
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

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
    // завершении.
    void this.loadInitial();
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

    // Optimistic insert into cache.
    const threadData = this.toThreadData(threadRow, [commentRow]);
    this.threadCache.set(threadId, threadData);
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

    // Optimistic
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

    return commentData;
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
