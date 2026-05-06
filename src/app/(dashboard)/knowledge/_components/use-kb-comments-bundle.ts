"use client";

import { useEffect, useMemo } from "react";

import {
  SupabaseThreadStore,
  resolveKbUsers,
} from "@/lib/knowledge/comments-store";
import type { CommentsBundle } from "@/components/knowledge/blocknote-editor";

interface UseKbCommentsBundleOptions {
  pageId: string;
  accountId: string | null;
  userId: string | null;
  /** Может ли юзер вообще редактировать страницу — влияет на роль в
   *  DefaultThreadStoreAuth (editor может удалять чужие комменты;
   *  не-editor — только свои). */
  canEdit: boolean;
  /** `kb.comment_pages` permission (миграция 076). false → bundle
   *  полностью null, CommentsExtension не подключается, BlockNote не
   *  показывает thread-UI / AddCommentButton / ничего comment-related.
   *  Раньше bundle создавался даже без права → DefaultThreadStoreAuth
   *  считал юзера 'editor', UI показывал кнопки → click → RLS reject в
   *  runtime'е, плохой UX. Codex #54 P2. */
  canComment: boolean;
  /** Имя/аватарка current user — для рендера в кастомном composer'е
   *  (Notion-style chip с avatar слева). */
  currentUserName: string | null;
  currentUserAvatarUrl: string | null;
}

/**
 * `commentsBundle` для `KbBlockNoteEditor`: один instance на page-mount.
 * Хук инкапсулирует:
 *   1. `useMemo` создающий `SupabaseThreadStore` + резолвер юзеров +
 *      UI-флаги. Recreate при смене любого dep'а; родитель и так
 *      remount'ится по `key={pageId}` в SSR-page'е, но deps на pageId/
 *      accountId/userId — defensive на случай если в будущем remount уберут.
 *   2. Cleanup-effect зовущий `store.destroy()` на unmount / смене
 *      bundle. Sprint D Phase 5: без unsubscribe realtime-канал утекает,
 *      сервер продолжает броадкастить даже после route-change.
 */
export function useKbCommentsBundle({
  pageId,
  accountId,
  userId,
  canEdit,
  canComment,
  currentUserName,
  currentUserAvatarUrl,
}: UseKbCommentsBundleOptions): CommentsBundle | null {
  const commentsBundle = useMemo<CommentsBundle | null>(() => {
    if (!accountId || !userId) return null;
    if (!canComment) return null;
    return {
      threadStore: new SupabaseThreadStore({
        pageId,
        accountId,
        userId,
        isEditor: canEdit,
      }),
      resolveUsers: resolveKbUsers,
      canComment,
      currentUserName,
      currentUserAvatarUrl,
    };
  }, [
    pageId,
    accountId,
    userId,
    canEdit,
    canComment,
    currentUserName,
    currentUserAvatarUrl,
  ]);

  useEffect(() => {
    if (!commentsBundle) return;
    const store = commentsBundle.threadStore;
    return () => {
      if (store instanceof SupabaseThreadStore) {
        store.destroy();
      }
    };
  }, [commentsBundle]);

  return commentsBundle;
}
