"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, Copy, Download } from "lucide-react";
import { toast } from "sonner";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  duplicateKbPage,
  exportKbPageAsMarkdown,
  softDeleteKbPage,
} from "@/lib/knowledge/pages";
import { KbSaveAsTemplateDialog } from "@/app/(dashboard)/knowledge/_components/kb-save-as-template-dialog";

interface KbPageActionsProps {
  pageId: string;
  pageTitle: string;
  /** Number of direct children — surfaced in the delete confirm. */
  childCount: number;
  canDelete: boolean;
  /** kb.create_pages — required to duplicate a page. */
  canDuplicate: boolean;
  /** `kb.export_pages` (миграция 068). Скрывает Download-кнопку.
   *  Server-action всё равно проверяет permission — это просто UX-слой. */
  canExport: boolean;
  /** `kb.manage_templates` (миграция 070). Скрывает «Сохранить как
   *  шаблон» кнопку. Server-action в createKbTemplate тоже проверяет. */
  canManageTemplates: boolean;
}

/**
 * Page-level actions: duplicate (с поддеревом), export (Markdown),
 * soft-delete.
 *
 * Duplicate — без подтверждения, Notion-style: клик → создаём копию +
 * всё поддерево → redirect на новую страницу. Cascade duplicate
 * (kb_duplicate_cascade RPC, миграция 064) копирует rows + pivot
 * kb_page_attachments; backlinks и версии начинаются заново.
 *
 * Export — скачивает .md файл (имя `<slug>.md`). Гейтится
 * `kb.export_pages` (миграция 068): рядовые сотрудники не должны
 * выгружать KB наружу.
 *
 * Soft delete — через подтверждение в диалоге z8BoQL (см. дизайн).
 * Cascade soft delete с deleted_root_id для симметричного restore.
 */
export function KbPageActions({
  pageId,
  pageTitle,
  childCount,
  canDelete,
  canDuplicate,
  canExport,
  canManageTemplates,
}: KbPageActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!canDelete && !canDuplicate && !canExport && !canManageTemplates) {
    return null;
  }

  const onDelete = async () => {
    setDeletePending(true);
    setDeleteError(null);
    const { error } = await softDeleteKbPage(pageId);
    setDeletePending(false);
    if (error) {
      // Ошибка остаётся в окне подтверждения.
      setDeleteError(`Не удалось удалить: ${error}`);
      return;
    }
    toast.success("Страница перемещена в корзину");
    setOpen(false);
    router.push("/knowledge");
  };

  const onDuplicate = async () => {
    setDuplicatePending(true);
    const { slug, error } = await duplicateKbPage(pageId);
    setDuplicatePending(false);
    if (error || !slug) {
      toast.error(`Не удалось дублировать: ${error}`);
      return;
    }
    toast.success("Создана копия страницы");
    router.push(`/knowledge/${slug}`);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const { markdown, filename, error } = await exportKbPageAsMarkdown(pageId);
      if (error || !markdown || !filename) {
        toast.error(`Не удалось экспортировать: ${error ?? "неизвестная ошибка"}`);
        return;
      }
      // Скачивание через Blob + временный <a> — без библиотек,
      // работает во всех современных браузерах.
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
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

  return (
    <>
      {canManageTemplates && (
        <KbSaveAsTemplateDialog pageId={pageId} pageTitle={pageTitle} />
      )}
      {canDuplicate && (
        <IconTooltip label="Дублировать страницу">
          <button
            type="button"
            aria-label="Дублировать страницу"
            onClick={onDuplicate}
            disabled={duplicatePending}
            className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
          >
            {duplicatePending ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
            ) : (
              <Copy className="w-[18px] h-[18px]" />
            )}
          </button>
        </IconTooltip>
      )}
      {canExport && (
        <IconTooltip label="Скачать как Markdown">
          <button
            type="button"
            aria-label="Скачать как Markdown"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
            ) : (
              <Download className="w-[18px] h-[18px]" />
            )}
          </button>
        </IconTooltip>
      )}
      {canDelete && (
        <>
          <IconTooltip label="Удалить страницу">
            {/* Top-bar icon button — стиль iedpv (36×36, no border,
                18px icon). Hover уезжает в destructive-цвет. */}
            <button
              type="button"
              aria-label="Удалить страницу"
              onClick={() => setOpen(true)}
              className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <Trash2 className="w-[18px] h-[18px]" />
            </button>
          </IconTooltip>
          <ConfirmDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setDeleteError(null);
            }}
            title={`Удалить «${pageTitle || "Без названия"}»?`}
            consequences={[
              ...(childCount > 0
                ? [
                    {
                      kind: "remove" as const,
                      text: "Подстраницы переедут в корзину вместе с ней",
                      count: childCount,
                    },
                  ]
                : []),
              { kind: "keep", text: "Восстановить страницу можно из корзины" },
            ]}
            confirmLabel="Удалить страницу"
            pendingLabel="Удаляем…"
            destructive
            busy={deletePending}
            error={deleteError}
            onConfirm={() => void onDelete()}
          />
        </>
      )}
    </>
  );
}
