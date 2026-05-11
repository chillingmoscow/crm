"use client";

import {
  ThreadStoreAuth,
  type CommentData,
  type ThreadData,
} from "@blocknote/core/comments";

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
export class KbThreadStoreAuth extends ThreadStoreAuth {
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

  setEditor(isEditor: boolean): void {
    this.isEditor = isEditor;
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
