"use client";

import { useExitValue } from "@/hooks/use-exit-value";
import { Fragment, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  BookCheck,
  BookmarkPlus,
  Copy,
  Download,
  History,
  ListTree,
  Loader2,
  Lock,
  MoreHorizontal,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { KB_COMMAND_EVENT, type KbCommand } from "@/lib/kb-hotkeys";
import {
  setKbPageStateOverride,
  useKbPageStateOverride,
} from "@/app/(dashboard)/knowledge/_components/kb-page-state-overrides-store";
import { setKbPageRequiredReading } from "@/lib/knowledge/required-reading";
import {
  duplicateKbPage,
  exportKbPageAsMarkdown,
  setKbPageShowChildren,
  setKbPageLock,
} from "@/lib/knowledge/pages";
import { flushAllPendingSaves } from "@/lib/knowledge/pending-saves";
import { softDeletePageWithUndo } from "@/app/(dashboard)/knowledge/_components/kb-soft-delete-page";
import { kbPageMenuGroups, type KbPageMenuKey } from "@/lib/knowledge/document";

const KbVersionHistory = dynamic(
  () =>
    import("@/app/(dashboard)/knowledge/_components/kb-version-history").then(
      (m) => m.KbVersionHistory,
    ),
  { ssr: false, loading: () => null },
);
const KbSaveAsTemplateDialog = dynamic(
  () =>
    import(
      "@/app/(dashboard)/knowledge/_components/kb-save-as-template-dialog"
    ).then((m) => m.KbSaveAsTemplateDialog),
  { ssr: false, loading: () => null },
);
const KbImportDialog = dynamic(
  () =>
    import("@/app/(dashboard)/knowledge/_components/kb-import-dialog").then(
      (m) => m.KbImportDialog,
    ),
  { ssr: false, loading: () => null },
);

interface KbPageMenuProps {
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  /** Cascade descendants count — used in delete confirmation. */
  childCount: number;
  /** Initial page-level setting for automatic direct-children section. */
  initialShowChildren: boolean;
  initialRequiredReading: boolean;
  initialLocked: boolean;
  // ── permissions / capability gating ──
  /** Базовый edit-permission БЕЗ учёта lock-state. Lock-state читаем
   *  через override-store в реальном времени — undo/redo и
   *  version-restore должны переключаться сразу после toggle Lock'а
   *  без router.refresh. Codex P2 на PR #161. Тот же паттерн что в
   *  KbPageEditor (#154). */
  canEditBase: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canExport: boolean;
  canImport: boolean;
  canManageTemplates: boolean;
  canManageRequiredReading: boolean;
  canLock: boolean;
  /** `kb.view_version_history` (миграция 181) — видеть/сравнивать/
   *  восстанавливать снимки версий. Без права пункт меню скрыт, а
   *  server-actions в versions.ts всё равно перепроверят. */
  canViewVersionHistory: boolean;
}

/**
 * Меню ⋯ действий со страницей базы знаний в верхней панели.
 * Пункты — обычные пункты DropdownMenu приложения (`px-2 py-1.5`).
 *
 * Состав и порядок пунктов — `kbPageMenuGroups` (src/lib/knowledge/document.ts),
 * каждый по своему праву. Избранное — звёздочкой в верхней панели
 * (KbFavoriteToggle), «О странице» и статистика — в ⓘ, «Кто прочитал» —
 * на плашке чтения, отмена и повтор — ⌘Z / ⌘⇧Z, на телефоне —
 * кнопками мобильной панели редактора (редизайн 27.11.2026).
 *
 * Тяжёлые диалоги/sheets (versions, save-as-template, import, delete)
 * — controlled-mode: KbPageMenu держит open-state, рендерит их вне
 * DropdownMenu чтобы Radix-портал не закрывал родительский dropdown
 * при ESC внутри child-диалога.
 */
export function KbPageMenu(props: KbPageMenuProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // Optimistic-state для тогглов:
  //  • required-reading + lock — через global override store, чтобы
  //    KbPageEditor (canEdit-gate) и KbRequiredReadingBanner получили
  //    свежий state мгновенно — без `router.refresh()`. router.refresh
  //    форсировал full RSC re-fetch (10+ запросов в layout + page), что
  //    при self-hosted pool=20 быстро выжирало connections. См.
  //    plan §TRACK-B + memory/feedback_pool_pressure_audit.md.
  //  • favorite — local state + optimistic; server-данные подтянутся
  //    на next-navigation, sidebar favorite-section обновится тогда же.
  const stateOverride = useKbPageStateOverride(props.pageId);
  const required =
    stateOverride?.requiredReading ?? props.initialRequiredReading;
  const locked = stateOverride?.locked ?? props.initialLocked;
  const showChildren =
    stateOverride?.showChildren ?? props.initialShowChildren;
  const localUnlocked = stateOverride?.localUnlocked === true;

  // controlled-state'ы для тяжёлых dialog'ов — открываются по клику
  // на соответствующий menu-item; DropdownMenu закрывается сразу,
  // dialog/sheet монтируется отдельно и сам управляет своим жизненным
  // циклом.
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Окна держим смонтированными, пока они закрываются (docs/motion.md).
  const shownVersions = useExitValue(versionsOpen);
  const shownTemplate = useExitValue(templateOpen);
  const shownImport = useExitValue(importOpen);

  const [requiredPending, setRequiredPending] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const [showChildrenPending, setShowChildrenPending] = useState(false);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [exporting, setExporting] = useState(false);


  // Effective canEdit учитывает свежий lock-state + локальный
  // Notion-style unlock из override-store.
  // props.canEdit передаётся как уже-resolved (canEditBase && !initialLocked),
  // но не учитывает override от toggle'а; для undo/redo и version-restore
  // нам нужно эффективное значение. canEditBase отдельным prop'ом —
  // тот же паттерн что в KbPageEditor (см. PR #154). Codex P2 на #161.
  const effectiveCanEdit = props.canEditBase && (!locked || localUnlocked);


  const onToggleRequired = async () => {
    const next = !required;
    setKbPageStateOverride(props.pageId, { requiredReading: next });
    setRequiredPending(true);
    const { error } = await setKbPageRequiredReading({
      pageId: props.pageId,
      required: next,
    });
    setRequiredPending(false);
    if (error) {
      setKbPageStateOverride(props.pageId, { requiredReading: !next });
      toast.error(`Не удалось переключить: ${error}`);
      return;
    }
    // Без success-toast'а: жёлтый banner на странице
    // (KbRequiredReadingBanner) и подсветка иконки уже сообщают что
    // флаг включён. Дополнительный toast дублировал эту информацию.
    // Без router.refresh: override-store уже синхронизировал UI;
    // revalidatePath на сервере покрывает next-navigation.
  };

  const onToggleLock = async () => {
    const next = !locked;
    const prevLocalUnlocked = localUnlocked;
    setKbPageStateOverride(props.pageId, {
      locked: next,
      localUnlocked: false,
    });
    setLockPending(true);
    if (next) {
      // Перед global lock'ом — ждём pending-save'а, иначе пользователь
      // может визуально выйти из edit-mode до того как последний flush
      // успел уйти на сервер.
      try {
        await flushAllPendingSaves();
      } catch {
        // Если flush упал — продолжаем с lock'ом (network может
        // быть offline, юзер всё равно хочет защитить страницу).
      }
    }
    const { error } = await setKbPageLock({
      pageId: props.pageId,
      locked: next,
    });
    setLockPending(false);
    if (error) {
      setKbPageStateOverride(props.pageId, {
        locked: !next,
        localUnlocked: prevLocalUnlocked,
      });
      toast.error(`Не удалось переключить блокировку: ${error}`);
      return;
    }
    // Без router.refresh: KbPageEditor читает override через
    // useKbPageStateOverride и мгновенно переключает canEdit-gate.
    // Sidebar lock-state — то же. revalidatePath покрывает next-nav.
  };

  const onToggleShowChildren = async () => {
    const next = !showChildren;
    setKbPageStateOverride(props.pageId, { showChildren: next });
    setShowChildrenPending(true);
    const { error } = await setKbPageShowChildren({
      pageId: props.pageId,
      showChildren: next,
    });
    setShowChildrenPending(false);
    if (error) {
      setKbPageStateOverride(props.pageId, { showChildren: !next });
      toast.error(`Не удалось переключить подстраницы: ${error}`);
    }
  };

  const onDuplicate = async () => {
    setDuplicatePending(true);
    const { slug, error } = await duplicateKbPage(props.pageId);
    setDuplicatePending(false);
    if (error || !slug) {
      toast.error(`Не удалось дублировать: ${error}`);
      return;
    }
    toast.success("Создана копия страницы");
    router.push(`/knowledge/${slug}`);
  };

  // Хоткеи действий страницы (Mod+Shift+L/D/H; F — в kb-favorite-toggle,
  // P — в kb-tree-create-menu). Вызываем те же
  // обработчики, что и пункты ⋯-меню — flush-before-lock, optimistic
  // override и тосты об ошибках живут внутри них. Нет права → тихий
  // no-op (как и скрытый пункт меню).
  useEffect(() => {
    const onCommand = (e: Event) => {
      const command = (e as CustomEvent<{ command: KbCommand }>).detail
        .command;
      if (command === "toggle-lock") {
        if (!props.canLock) return;
        void onToggleLock();
      } else if (command === "duplicate") {
        if (!props.canDuplicate || duplicatePending) return;
        void onDuplicate();
      } else if (command === "version-history") {
        if (!props.canViewVersionHistory) return;
        setVersionsOpen(true);
      }
    };
    window.addEventListener(KB_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(KB_COMMAND_EVENT, onCommand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.pageId,
    props.canLock,
    props.canDuplicate,
    props.canViewVersionHistory,
    duplicatePending,
    // Toggle-состояние: onToggleLock читает эти значения из замыкания.
    // Без re-subscribe повторный Mod+Shift+L работал бы со stale-значением
    // (Codex P2 #348). Избранное (Mod+Shift+F) — в KbFavoriteToggle.
    locked,
    localUnlocked,
  ]);

  const onExport = async () => {
    setExporting(true);
    try {
      const { markdown, filename, error } = await exportKbPageAsMarkdown(
        props.pageId,
      );
      if (error || !markdown || !filename) {
        toast.error(
          `Не удалось экспортировать: ${error ?? "неизвестная ошибка"}`,
        );
        return;
      }
      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // Состав и порядок — kbPageMenuGroups (src/lib/knowledge/document.ts).
  const menuGroups = kbPageMenuGroups({
    canEdit: props.canEditBase,
    canDelete: props.canDelete,
    canDuplicate: props.canDuplicate,
    canExport: props.canExport,
    canImport: props.canImport,
    canManageTemplates: props.canManageTemplates,
    canManageRequiredReading: props.canManageRequiredReading,
    canLock: props.canLock,
    canViewVersionHistory: props.canViewVersionHistory,
  });

  const renderItem = (key: KbPageMenuKey) => {
    switch (key) {
      case "template":
        return (
          <DropdownMenuItem onSelect={() => setTemplateOpen(true)} className="gap-2.5">
            <BookmarkPlus className="size-4 shrink-0" />
            <span className="flex-1">Сохранить как шаблон</span>
          </DropdownMenuItem>
        );
      case "show-children":
        return (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (effectiveCanEdit && !showChildrenPending) onToggleShowChildren();
            }}
            disabled={!effectiveCanEdit || showChildrenPending}
            className="gap-2.5"
          >
            <ListTree className="size-4 shrink-0" />
            <span className="flex-1">Показывать подстраницы</span>
            <Switch
              checked={showChildren}
              disabled={!effectiveCanEdit || showChildrenPending}
              aria-label="Показывать подстраницы"
              className="pointer-events-none"
            />
          </DropdownMenuItem>
        );
      case "required":
        return (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!requiredPending) onToggleRequired();
            }}
            disabled={requiredPending}
            className="gap-2.5"
          >
            <BookCheck className="size-4 shrink-0" />
            <span className="flex-1">Обязательно к прочтению</span>
            <Switch
              checked={required}
              disabled={requiredPending}
              aria-label="Обязательно к прочтению"
              className="pointer-events-none"
            />
          </DropdownMenuItem>
        );
      case "lock":
        return (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!lockPending) onToggleLock();
            }}
            disabled={lockPending}
            className="gap-2.5"
          >
            {locked ? <Lock className="size-4 shrink-0" /> : <Unlock className="size-4 shrink-0" />}
            <span className="flex-1">Заблокировать</span>
            <Switch
              checked={locked}
              disabled={lockPending}
              aria-label="Заблокировать"
              className="pointer-events-none"
            />
          </DropdownMenuItem>
        );
      case "duplicate":
        return (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!duplicatePending) onDuplicate();
            }}
            disabled={duplicatePending}
            className="gap-2.5"
          >
            {duplicatePending ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Copy className="size-4 shrink-0" />
            )}
            <span className="flex-1">Дублировать страницу</span>
          </DropdownMenuItem>
        );
      case "export":
        return (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!exporting) onExport();
            }}
            disabled={exporting}
            className="gap-2.5"
          >
            {exporting ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Download className="size-4 shrink-0" />
            )}
            <span className="flex-1">Экспорт</span>
          </DropdownMenuItem>
        );
      case "import":
        return (
          <DropdownMenuItem onSelect={() => setImportOpen(true)} className="gap-2.5">
            <Upload className="size-4 shrink-0" />
            <span className="flex-1">Импорт</span>
          </DropdownMenuItem>
        );
      case "history":
        return (
          <DropdownMenuItem onSelect={() => setVersionsOpen(true)} className="gap-2.5">
            <History className="size-4 shrink-0" />
            <span className="flex-1">История версий</span>
          </DropdownMenuItem>
        );
      case "delete":
        return (
          <DropdownMenuItem
            onSelect={() =>
              void softDeletePageWithUndo({
                pageId: props.pageId,
                pageTitle: props.pageTitle,
                childCount: props.childCount,
                router,
              })
            }
            className="gap-2.5 text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="size-4 shrink-0" />
            <span className="flex-1">Удалить страницу</span>
          </DropdownMenuItem>
        );
    }
  };

  return (
    <>
      {/* Без единого пункта (сотрудник только с просмотром) кнопки нет:
       * пустое всплывающее меню выглядит как поломка. */}
      {menuGroups.length > 0 && (
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(next) => {
            setMenuOpen(next);
          }}
        >
          <IconTooltip label="Меню страницы">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Меню страницы"
                className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground transition-colors"
              >
                <MoreHorizontal className="w-[18px] h-[18px]" />
              </button>
            </DropdownMenuTrigger>
          </IconTooltip>
          <DropdownMenuContent align="end" sideOffset={8} className="w-72">
            {menuGroups.map((group, index) => (
              <Fragment key={group.join("-")}>
                {index > 0 && <DropdownMenuSeparator />}
                {group.map((key) => (
                  <Fragment key={key}>{renderItem(key)}</Fragment>
                ))}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Тяжёлые controlled-диалоги, рендерятся на корневом уровне
       * чтобы их Radix-порталы не пересекались с DropdownMenuContent. */}
      {shownVersions && props.canViewVersionHistory && (
        <KbVersionHistory
          pageId={props.pageId}
          canEdit={effectiveCanEdit}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
        />
      )}
      {props.canManageTemplates && shownTemplate && (
        <KbSaveAsTemplateDialog
          pageId={props.pageId}
          pageTitle={props.pageTitle}
          open={templateOpen}
          onOpenChange={setTemplateOpen}
        />
      )}
      {props.canImport && shownImport && (
        <KbImportDialog
          parentId={props.pageId}
          triggerLabel="Импорт в эту страницу"
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      )}
    </>
  );
}

