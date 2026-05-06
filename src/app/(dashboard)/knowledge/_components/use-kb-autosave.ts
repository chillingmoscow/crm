"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { saveKbPage } from "@/lib/knowledge/pages";
import { registerPendingSaveFlush } from "@/lib/knowledge/pending-saves";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import {
  getKbSaveState,
  setKbSaveState,
} from "@/app/(dashboard)/knowledge/_components/kb-save-status";
import { setKbTreeOverride } from "@/app/(dashboard)/knowledge/_components/kb-tree-overrides-store";
import type { CommentsBundle } from "@/components/knowledge/blocknote-editor";
import type { KbBlock } from "@/types/knowledge";

const DEBOUNCE_MS = 2000;

interface UseKbAutosaveOptions {
  pageId: string;
  /** ThreadStore нужен для `captureCommentMarkPositions` перед save'ом —
   *  снимает актуальные PM-позиции comment-mark'ов в kb_threads.metadata,
   *  чтобы они restore'нулись на reload'е. null → comments отключены,
   *  capture-фаза пропускается. */
  commentsBundle: CommentsBundle | null;
  /** Базовый edit-permission. Влияет на beforeunload + canSave gate. */
  canEdit: boolean;
  /** `kb.comment_pages` — на locked-странице пользователь всё ещё может
   *  добавлять comment-mark, и save идёт через kb_save_page_comment_only.
   *  canSave = canEdit || canComment. */
  canComment: boolean;

  initialTitle: string;
  initialIcon: string | null;
  initialIconColor: string | null;
  initialContent: KbBlock[];
}

interface UseKbAutosaveResult {
  // ── UI-bindings ──────────────────────────────────────────────────
  title: string;
  icon: string | null;
  iconColor: string | null;
  // ── Setters (мутируют ref + state + триггерят save) ──────────────
  /** Title input change handler. Sync-обновляет titleRef + state +
   *  scheduleSave (debounced). */
  setTitle: (next: string) => void;
  /** Icon-picker change handler. Sync-обновляет iconRef + iconColorRef +
   *  state + IMMEDIATE flush (bypass debounce). Юзер ждёт что иконка
   *  персистнется и появится в sidebar мгновенно. */
  commitIcon: (nextIcon: string | null, nextColor: string | null) => void;
  /** BlockNote `onChange` handler. Обновляет contentRef + либо ставит
   *  baseline-hash на первом event'е (BN-internal normalization, не
   *  edit), либо scheduleSave. */
  commitContent: (next: KbBlock[]) => void;
  // ── Public flush (для icon-bypass / внешних триггеров) ───────────
  flush: () => Promise<void>;
}

/**
 * KB autosave: единая точка владения всеми save-related refs/state/effects.
 *
 * Что инкапсулирует:
 *   - State: title / icon / iconColor (для UI input binding) + ref-копии
 *     для save-closure.
 *   - Refs: contentRef, lastSavedHashRef, lastTreeSnapshotRef,
 *     isFirstEditorEventRef, timerRef, savingPromiseRef.
 *   - Effects: save-status reset на pageId-смене, registerPendingSaveFlush,
 *     beforeunload warning, unmount-flush.
 *
 * Save semantics (важно сохранить при рефакторе):
 *   1. **In-flight guard через Promise.** Если flush() вызван при активном
 *      save'е, ждём его (try/catch — ошибка уже surface'нута toast'ом
 *      внутри предыдущего save'а), затем рекурсивно перезапускаемся
 *      чтобы дослать правки появившиеся во время ожидания. Критично для
 *      `flushAllPendingSaves()` (lock-toggle и пр.) — они требуют
 *      persistence-гарантию до выполнения action'а. Codex P1 на PR #148.
 *   2. **Hash-skip:** если snapshot title/icon/color/content совпадает с
 *      lastSavedHash — return без network-roundtrip'а. Reset бейджа из
 *      pending в idle.
 *   3. **First editor event = baseline.** BlockNote делает internal-
 *      normalization первой onChange-event'ой (block id-нормализация),
 *      хеш отличается от того что мы передали в initialContent. Adopt'им
 *      результат как новый baseline вместо считая edit'ом.
 *   4. **Tree-overrides без RSC-refresh.** Если title/icon/color
 *      изменились — push'им в client-side store, KbTreeNav перерендерит
 *      sidebar мгновенно. Никакого `router.refresh()` (он бы remount'ил
 *      редактор и закрывал slash-меню).
 *   5. **Unmount-flush через `void flush()`** в empty-deps cleanup
 *      (eslint-disable экспонится here): cleanup ловит закрытый
 *      замыканием flush, актуальный на mount; commentsBundle стабилен
 *      per-mount (parent remount'ится по key={pageId}), стало быть
 *      капчруется правильный flush.
 */
export function useKbAutosave({
  pageId,
  commentsBundle,
  canEdit,
  canComment,
  initialTitle,
  initialIcon,
  initialIconColor,
  initialContent,
}: UseKbAutosaveOptions): UseKbAutosaveResult {
  // UI-binding state
  const [title, setTitleState] = useState(initialTitle);
  const [icon, setIconState] = useState<string | null>(initialIcon);
  const [iconColor, setIconColorState] = useState<string | null>(initialIconColor);

  // Latest values via refs — debounced save closure читает отсюда чтобы
  // не зависеть от ре-рендера. Setters ниже мутируют рефы СИНХРОННО
  // перед scheduleSave/flush, чтобы first save после изменения видел
  // свежие значения (use-effect-sync был бы on-next-render, поздно).
  const titleRef = useRef(initialTitle);
  const iconRef = useRef<string | null>(initialIcon);
  const iconColorRef = useRef<string | null>(initialIconColor);
  const contentRef = useRef<KbBlock[]>(initialContent);

  // Hash последнего успешного save'а (или initial baseline). Используется
  // для skip'а no-op-save'ов: BN fires onChange при первой загрузке
  // doc'а, и наш title/icon не меняется на mount'е — мы не должны
  // POST'ить identical content обратно на сервер.
  const lastSavedHashRef = useRef<string>(
    snapshotHash(initialTitle, initialIcon, initialIconColor, initialContent),
  );

  // Snapshot значений видимых в KB-tree (sidebar): title + icon + iconColor.
  // После успешного save'а сравниваем с current — если изменились, push'им
  // оверрайд в client-side store, KbTreeNav рисует свежие данные без
  // RSC-refresh'а. Codex P2 на PR #134: используем нормализованный title
  // (.trim() || "Без названия"), чтобы override matched persisted-значение.
  const lastTreeSnapshotRef = useRef<{
    title: string;
    icon: string;
    iconColor: string;
  }>({
    title: initialTitle,
    icon: initialIcon ?? "",
    iconColor: initialIconColor ?? "",
  });

  // BN fires первый onChange В ПРОЦЕССЕ загрузки initial document'а, и
  // эта internal-нормализация (block-id, canonical attrs) меняет hash
  // относительно того что мы передали. Adopt'им первый event как
  // baseline, не как edit.
  const isFirstEditorEventRef = useRef(true);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight save tracker. Хранит Promise активного `saveKbPage`
  // (или null если ничего не сохраняется). См. Codex P1 на PR #148:
  // boolean-флаг + early-return мог терять правки при race'е с
  // flushAllPendingSaves().
  const savingPromiseRef = useRef<Promise<void> | null>(null);

  // Save badge reset при смене pageId (parent remount'ится, но defensive).
  useEffect(() => {
    setKbSaveState({ kind: "idle" });
  }, [pageId]);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (savingPromiseRef.current) {
      try {
        await savingPromiseRef.current;
      } catch {
        /* surfaced via toast inside the in-flight save */
      }
      return flush();
    }
    const newHash = snapshotHash(
      titleRef.current,
      iconRef.current,
      iconColorRef.current,
      contentRef.current,
    );
    if (newHash === lastSavedHashRef.current) {
      const cur = getKbSaveState();
      if (cur.kind === "pending") setKbSaveState({ kind: "idle" });
      return;
    }
    const savePromise = (async () => {
      // captureCommentMarkPositions — fire-and-forget (HOTFIX revert #161).
      // Awaited вариант на проде вызвал каскадный degrade: persistThreadPosition
      // = UPDATE kb_threads SET metadata, который под realtime publication
      // amplification + lock-contention занимает 300-1500мс (mean 344мс по
      // pg_stat_statements). N параллельных UPDATE'ов в одной save'е на
      // одной странице блочат друг друга на row-lock'е. Когда save их ждёт
      // синхронно — UX «Сохраняем... 30 сек».
      // Fire-and-forget возвращает save мгновенно; capture продолжает в фоне
      // и НЕ блокирует пользователя. Драфт metadata если capture не успел —
      // следующий save (через 2 сек) повторит. Ошибка тоже не ломает save.
      if (commentsBundle) {
        const store = commentsBundle.threadStore as unknown as {
          captureCommentMarkPositions?: () => Promise<void>;
        };
        if (typeof store.captureCommentMarkPositions === "function") {
          void store.captureCommentMarkPositions().catch((err) => {
            console.warn("[kb] captureCommentMarkPositions failed", err);
          });
        }
      }
      const plainText = blocksToPlainText(contentRef.current);
      setKbSaveState({ kind: "saving" });
      const { error } = await saveKbPage({
        id: pageId,
        title: titleRef.current.trim() || "Без названия",
        icon: iconRef.current?.trim() || null,
        icon_color: iconColorRef.current || null,
        content: contentRef.current,
        plain_text: plainText,
      });
      if (error) {
        setKbSaveState({ kind: "error", message: error });
        toast.error(`Не удалось сохранить: ${error}`);
        return;
      }
      lastSavedHashRef.current = newHash;

      const normalizedTitle = titleRef.current.trim() || "Без названия";
      const prevTree = lastTreeSnapshotRef.current;
      const treeChanged =
        prevTree.title !== normalizedTitle ||
        prevTree.icon !== (iconRef.current ?? "") ||
        prevTree.iconColor !== (iconColorRef.current ?? "");
      if (treeChanged) {
        lastTreeSnapshotRef.current = {
          title: normalizedTitle,
          icon: iconRef.current ?? "",
          iconColor: iconColorRef.current ?? "",
        };
        setKbTreeOverride(pageId, {
          title: normalizedTitle,
          icon: iconRef.current ?? null,
          iconColor: iconColorRef.current ?? null,
        });
      }

      setKbSaveState({ kind: "saved", at: new Date() });
    })();
    savingPromiseRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      savingPromiseRef.current = null;
    }
  }, [pageId, commentsBundle]);

  // canSave gate. canEdit (обычный editable) или canComment
  // (locked-страница, save идёт через kb_save_page_comment_only).
  const canSave = canEdit || canComment;
  const scheduleSave = useCallback(() => {
    if (!canSave) return;
    setKbSaveState({ kind: "pending" });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, DEBOUNCE_MS);
  }, [canSave, flush]);

  // ── Public setters ───────────────────────────────────────────────
  const setTitle = useCallback(
    (next: string) => {
      titleRef.current = next;
      setTitleState(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const commitIcon = useCallback(
    (nextIcon: string | null, nextColor: string | null) => {
      iconRef.current = nextIcon;
      iconColorRef.current = nextColor;
      setIconState(nextIcon);
      setIconColorState(nextColor);
      // Icon — single-click action, юзер ждёт мгновенной персистентности
      // (и обновления tree-иконки в sidebar). Bypass'им 2-сек debounce.
      void flush();
    },
    [flush],
  );

  const commitContent = useCallback(
    (next: KbBlock[]) => {
      contentRef.current = next;
      if (isFirstEditorEventRef.current) {
        isFirstEditorEventRef.current = false;
        lastSavedHashRef.current = snapshotHash(
          titleRef.current,
          iconRef.current,
          iconColorRef.current,
          next,
        );
        return;
      }
      scheduleSave();
    },
    [scheduleSave],
  );

  // ── Effects ──────────────────────────────────────────────────────

  // Flush on unmount so unsaved edits don't get lost on navigation.
  // Empty deps + eslint-disable: cleanup ловит замыканием mount-time-flush.
  // commentsBundle стабилен per-mount (parent remount'ится по key=pageId),
  // поэтому замкнутый flush корректен на момент unmount'а.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Best-effort sync flush — мы не можем await в cleanup, но
        // server action — fire-and-forget с точки зрения браузера.
        void flush();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register flush в pending-saves registry: lock-toggle / другие
  // action'ы, меняющие backend-state атомарно с edit'ами, вызывают
  // flushAllPendingSaves() и ждут пока debounced-save долетит до сервера.
  // Codex #65 P2.
  useEffect(() => {
    if (!canSave) return;
    return registerPendingSaveFlush(flush);
  }, [canSave, flush]);

  // beforeunload: warn the user если есть pending edits. Читаем state
  // синхронно из module-store (без подписки чтобы не вызывать re-render
  // при каждом save-tick'е).
  useEffect(() => {
    if (!canEdit) return;
    const handler = (e: BeforeUnloadEvent) => {
      const k = getKbSaveState().kind;
      if (k === "pending" || k === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [canEdit]);

  return {
    title,
    icon,
    iconColor,
    setTitle,
    commitIcon,
    commitContent,
    flush,
  };
}

/** Cheap fingerprint of (title, icon, color, content) для change-detect.
 *  JSON.stringify достаточен на наших doc-размерах (≤ ~100 KB jsonb).
 *  Если когда-то страница раздуется, можно swap'нуть на streaming hash. */
function snapshotHash(
  title: string,
  icon: string | null,
  iconColor: string | null,
  content: KbBlock[],
): string {
  return JSON.stringify([title, icon ?? "", iconColor ?? "", content]);
}
