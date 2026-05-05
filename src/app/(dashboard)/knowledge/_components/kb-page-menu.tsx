"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  BookCheck,
  BookmarkPlus,
  ChevronRight,
  Copy,
  Download,
  History,
  Loader2,
  Lock,
  MoreHorizontal,
  Redo2,
  Star,
  Trash2,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";
import { undoDepth, redoDepth } from "prosemirror-history";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useKbEditor } from "@/app/(dashboard)/knowledge/_components/kb-editor-store";
import { addKbFavorite, removeKbFavorite } from "@/lib/knowledge/favorites";
import { setKbPageRequiredReading } from "@/lib/knowledge/required-reading";
import {
  duplicateKbPage,
  exportKbPageAsMarkdown,
  setKbPageLock,
} from "@/lib/knowledge/pages";
import { flushAllPendingSaves } from "@/lib/knowledge/pending-saves";
import { KbDeletePageDialog } from "@/app/(dashboard)/knowledge/_components/kb-delete-page-dialog";
import { KbVersionHistory } from "@/app/(dashboard)/knowledge/_components/kb-version-history";
import { KbSaveAsTemplateDialog } from "@/app/(dashboard)/knowledge/_components/kb-save-as-template-dialog";
import { KbImportDialog } from "@/app/(dashboard)/knowledge/_components/kb-import-dialog";

interface KbPageMenuProps {
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  /** Cascade descendants count — used in delete confirmation. */
  childCount: number;
  /** Initial state from server-render. Local state syncs to it on
   *  pageId change (Codex #86 P1 pattern). */
  initialFavorited: boolean;
  initialRequiredReading: boolean;
  initialLocked: boolean;
  /** Текущая required-reading отметка для отображения "Кто прочитал"
   *  пункта (имеет смысл только когда required=true). */
  requiredReadingActive: boolean;
  /** Дата последнего изменения + автор — для footer-блока меню. */
  updatedAt: string | null;
  updatedByName: string | null;
  // ── permissions / capability gating ──
  canEdit: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canExport: boolean;
  canImport: boolean;
  canManageTemplates: boolean;
  canManageRequiredReading: boolean;
  canLock: boolean;
  canViewAnalytics: boolean;
}

/**
 * Notion-style ⋯-меню всех page-level действий KB-страницы. Заменяет
 * группу из 9 отдельных кнопок в топбаре одним dropdown-триггером
 * (см. дизайн `sheerly.pen` frame 09 · DOgqX).
 *
 * Состав меню (видимость зависит от permissions):
 *   1. ⭐ Избранное (toggle, optimistic)
 *   2. 🔖 Сохранить как шаблон (canManageTemplates)
 *   ─ ─ ─
 *   3. ⚠ Обязательно к прочтению + Switch (canManageRequiredReading)
 *   4. 🔒 Заблокировать + Switch (canLock)
 *   ─ ─ ─
 *   5. ↶ Отменить ⌘Z (когда editor подключён)
 *   6. ↷ Повторить ⌘⇧Z
 *   7. 📋 Дублировать страницу (canDuplicate)
 *   ─ ─ ─
 *   8. ⬇ Экспорт (canExport, прямой download .md)
 *   9. ⬆ Импорт (canImport — KB-импорт ZIP/MD как подстраницы текущей)
 *   ─ ─ ─
 *   10. 📊 Аналитика (canViewAnalytics) — Link на /knowledge/analytics/[slug]
 *   11. 📋 Кто прочитал (canManageRequiredReading + requiredReadingActive)
 *   12. 🕘 История версий
 *   ─ ─ ─
 *   13. 🗑 Удалить страницу (canDelete, destructive)
 *   ─ footer ─
 *   • «Изменено: …» + автор последней правки.
 *
 * Тяжёлые диалоги/sheets (versions, save-as-template, import, delete)
 * — controlled-mode: KbPageMenu держит open-state, рендерит их вне
 * DropdownMenu чтобы Radix-портал не закрывал родительский dropdown
 * при ESC внутри child-диалога.
 */
export function KbPageMenu(props: KbPageMenuProps) {
  const router = useRouter();
  const editor = useKbEditor();
  const [, editorTick] = useState(0);

  // Optimistic-state для тогглов (favorite / required / lock).
  // Sync на pageId-change — при навигации между страницами компонент
  // не remount'ится (живёт в PageHeaderActions slot'е через context),
  // useState без явного sync залипал бы на initial. См. Codex #86 P1.
  const [favorited, setFavorited] = useState(props.initialFavorited);
  const [required, setRequired] = useState(props.initialRequiredReading);
  const [locked, setLocked] = useState(props.initialLocked);
  useEffect(() => {
    setFavorited(props.initialFavorited);
    setRequired(props.initialRequiredReading);
    setLocked(props.initialLocked);
  }, [
    props.pageId,
    props.initialFavorited,
    props.initialRequiredReading,
    props.initialLocked,
  ]);

  // controlled-state'ы для тяжёлых dialog'ов — открываются по клику
  // на соответствующий menu-item; DropdownMenu закрывается сразу,
  // dialog/sheet монтируется отдельно и сам управляет своим жизненным
  // циклом.
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [requiredPending, setRequiredPending] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [, startFavTransition] = useTransition();

  // Re-render undo/redo state on каждый editor.onChange. Cheap — это
  // 2 строчки ProseMirror state read'а на каждое изменение.
  useEffect(() => {
    if (!editor) return;
    return editor.onChange(() => editorTick((t) => t + 1));
  }, [editor]);

  const undoEnabled =
    editor && props.canEdit && undoDepth(editor._tiptapEditor.state) > 0;
  const redoEnabled =
    editor && props.canEdit && redoDepth(editor._tiptapEditor.state) > 0;

  const onToggleFavorite = () => {
    const next = !favorited;
    setFavorited(next);
    startFavTransition(async () => {
      const { error } = next
        ? await addKbFavorite(props.pageId)
        : await removeKbFavorite(props.pageId);
      if (error) {
        setFavorited(!next);
        toast.error(`Не удалось обновить избранное: ${error}`);
        return;
      }
      router.refresh();
    });
  };

  const onToggleRequired = async () => {
    const next = !required;
    setRequired(next);
    setRequiredPending(true);
    const { error } = await setKbPageRequiredReading({
      pageId: props.pageId,
      required: next,
    });
    setRequiredPending(false);
    if (error) {
      setRequired(!next);
      toast.error(`Не удалось переключить: ${error}`);
      return;
    }
    toast.success(
      next
        ? "Страница помечена как обязательная к прочтению"
        : "Снят флаг обязательного прочтения",
    );
    router.refresh();
  };

  const onToggleLock = async () => {
    const next = !locked;
    setLocked(next);
    setLockPending(true);
    if (next) {
      // Перед lock'ом — ждём pending-save'а, иначе strict-lock guard в
      // kb_save_page (миграция 086) reject'ит последний flush на 42501
      // и unsaved edits теряются. См. Codex #65 P2.
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
      setLocked(!next);
      toast.error(`Не удалось переключить блокировку: ${error}`);
      return;
    }
    router.refresh();
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
    router.refresh();
  };

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

  const showRequiredGroup = props.canManageRequiredReading || props.canLock;
  const showHistoryGroup = editor !== null || props.canDuplicate;
  const showFilesGroup = props.canExport || props.canImport;
  const showInsightsGroup =
    props.canViewAnalytics ||
    (props.canManageRequiredReading && props.requiredReadingActive);
  const showLastSeparator = props.canDelete;

  return (
    <>
      <DropdownMenu>
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
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-[280px] p-1.5 rounded-[10px] shadow-lg"
        >
          {/* Group 1: Favorites + Save as template */}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onToggleFavorite();
            }}
            className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
          >
            <Star
              className={cn(
                "size-4 shrink-0",
                favorited && "fill-yellow-400 text-yellow-500",
              )}
            />
            <span className="flex-1">
              {favorited ? "Убрать из избранного" : "Добавить в Избранное"}
            </span>
          </DropdownMenuItem>
          {props.canManageTemplates && (
            <DropdownMenuItem
              onSelect={() => setTemplateOpen(true)}
              className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
            >
              <BookmarkPlus className="size-4 shrink-0" />
              <span className="flex-1">Сохранить как шаблон</span>
            </DropdownMenuItem>
          )}

          {showRequiredGroup && <DropdownMenuSeparator />}

          {/* Group 2: Required reading + Lock toggles (with Switch) */}
          {props.canManageRequiredReading && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (!requiredPending) onToggleRequired();
              }}
              disabled={requiredPending}
              className="px-2.5 py-1.5 rounded-md text-[13px] gap-2.5"
            >
              <AlertTriangle
                className={cn(
                  "size-4 shrink-0",
                  required && "fill-yellow-400 text-yellow-600",
                )}
              />
              <span className="flex-1">Обязательно к прочтению</span>
              <Switch
                checked={required}
                disabled={requiredPending}
                aria-label="Обязательно к прочтению"
                className="pointer-events-none"
              />
            </DropdownMenuItem>
          )}
          {props.canLock && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (!lockPending) onToggleLock();
              }}
              disabled={lockPending}
              className="px-2.5 py-1.5 rounded-md text-[13px] gap-2.5"
            >
              {locked ? (
                <Lock className="size-4 shrink-0 fill-amber-200 text-amber-700 dark:fill-amber-900 dark:text-amber-400" />
              ) : (
                <Unlock className="size-4 shrink-0" />
              )}
              <span className="flex-1">Заблокировать</span>
              <Switch
                checked={locked}
                disabled={lockPending}
                aria-label="Заблокировать"
                className="pointer-events-none"
              />
            </DropdownMenuItem>
          )}

          {showHistoryGroup && <DropdownMenuSeparator />}

          {/* Group 3: Undo / Redo / Duplicate */}
          {editor !== null && (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  if (undoEnabled) editor.undo();
                }}
                disabled={!undoEnabled}
                className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
              >
                <Undo2 className="size-4 shrink-0" />
                <span className="flex-1">Отменить</span>
                <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  if (redoEnabled) editor.redo();
                }}
                disabled={!redoEnabled}
                className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
              >
                <Redo2 className="size-4 shrink-0" />
                <span className="flex-1">Повторить</span>
                <DropdownMenuShortcut>⌘⇧Z</DropdownMenuShortcut>
              </DropdownMenuItem>
            </>
          )}
          {props.canDuplicate && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (!duplicatePending) onDuplicate();
              }}
              disabled={duplicatePending}
              className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
            >
              {duplicatePending ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : (
                <Copy className="size-4 shrink-0" />
              )}
              <span className="flex-1">Дублировать страницу</span>
            </DropdownMenuItem>
          )}

          {showFilesGroup && <DropdownMenuSeparator />}

          {/* Group 4: Export / Import */}
          {props.canExport && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (!exporting) onExport();
              }}
              disabled={exporting}
              className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
            >
              {exporting ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : (
                <Download className="size-4 shrink-0" />
              )}
              <span className="flex-1">Экспорт</span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </DropdownMenuItem>
          )}
          {props.canImport && (
            <DropdownMenuItem
              onSelect={() => setImportOpen(true)}
              className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
            >
              <Upload className="size-4 shrink-0" />
              <span className="flex-1">Импорт</span>
            </DropdownMenuItem>
          )}

          {showInsightsGroup && <DropdownMenuSeparator />}

          {/* Group 5: Analytics + Required-reading stats + Versions */}
          {props.canViewAnalytics && (
            <DropdownMenuItem asChild>
              <Link
                href={`/knowledge/analytics/${props.pageSlug}`}
                className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
              >
                <BarChart3 className="size-4 shrink-0" />
                <span className="flex-1">Аналитика</span>
              </Link>
            </DropdownMenuItem>
          )}
          {props.canManageRequiredReading && props.requiredReadingActive && (
            <DropdownMenuItem asChild>
              <Link
                href={`/knowledge/${props.pageSlug}/required-reading`}
                className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
              >
                <BookCheck className="size-4 shrink-0" />
                <span className="flex-1">Кто прочитал</span>
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => setVersionsOpen(true)}
            className="px-2.5 py-2 rounded-md text-[13px] gap-2.5"
          >
            <History className="size-4 shrink-0" />
            <span className="flex-1">История версий</span>
          </DropdownMenuItem>

          {showLastSeparator && <DropdownMenuSeparator />}

          {props.canDelete && (
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              className="px-2.5 py-2 rounded-md text-[13px] gap-2.5 text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <Trash2 className="size-4 shrink-0" />
              <span className="flex-1">Удалить страницу</span>
            </DropdownMenuItem>
          )}

          {/* Footer: "Изменено + автор" — meta-info всегда видна, как
           * во frame 09. Без отдельного menu-item «О странице»: для
           * админ-debug'инга есть `Info` API/RPC; рядовой юзер чаще
           * хочет видеть «когда обновляли» — это и так на виду. */}
          <FooterMeta
            updatedAt={props.updatedAt}
            updatedByName={props.updatedByName}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Тяжёлые controlled-диалоги, рендерятся на корневом уровне
       * чтобы их Radix-порталы не пересекались с DropdownMenuContent. */}
      <KbVersionHistory
        pageId={props.pageId}
        canEdit={props.canEdit}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
      />
      {props.canManageTemplates && (
        <KbSaveAsTemplateDialog
          pageId={props.pageId}
          pageTitle={props.pageTitle}
          open={templateOpen}
          onOpenChange={setTemplateOpen}
        />
      )}
      {props.canImport && (
        <KbImportDialog
          parentId={props.pageId}
          triggerLabel="Импорт в эту страницу"
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      )}
      {props.canDelete && (
        <KbDeletePageDialog
          pageId={props.pageId}
          pageTitle={props.pageTitle}
          childCount={props.childCount}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  );
}

function FooterMeta({
  updatedAt,
  updatedByName,
}: {
  updatedAt: string | null;
  updatedByName: string | null;
}) {
  if (!updatedAt && !updatedByName) return null;
  const date = updatedAt ? formatDate(updatedAt) : null;
  return (
    <div className="mt-1 px-2.5 pt-2 pb-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground border-t border-border">
      {date && <span>Изменено: {date}</span>}
      {updatedByName && (
        <span className="font-medium text-foreground/80">{updatedByName}</span>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
