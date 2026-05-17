"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Eye, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { getKbPageById } from "@/lib/knowledge/pages";
import type { KbBlock } from "@/types/knowledge";

// Lazy-load BlockNote (~400 kB chunk) — иначе trash route раздуло бы.
const KbBlockNoteEditor = dynamic(
  () =>
    import("@/components/knowledge/blocknote-editor").then(
      (m) => m.KbBlockNoteEditor,
    ),
  { ssr: false, loading: () => <div className="min-h-[120px]" /> },
);

interface TrashPreviewSheetProps {
  pageId: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
}

/**
 * Центральная модалка с read-only превью удалённой страницы. Юзер
 * просил поп-ап вместо боковой панели — так нагляднее (контент шире,
 * по центру, не перекрыт списком корзины). Содержимое (BlockNote
 * блоки) грузится лениво только при открытии — корзина может
 * содержать много страниц.
 *
 * Доступ к удалённой строке гейтится RLS на kb_pages: пользователи
 * с `kb.delete_pages` видят deleted_at IS NOT NULL (миграция 046/050).
 */
export function TrashPreviewSheet({
  pageId,
  title,
  icon,
  iconColor,
}: TrashPreviewSheetProps) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<KbBlock[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onOpenChange = async (next: boolean) => {
    setOpen(next);
    if (next && content === null) {
      setLoading(true);
      setError(null);
      const { row, error } = await getKbPageById(pageId);
      setLoading(false);
      if (error) {
        setError(error);
        return;
      }
      setContent((row?.content as unknown as KbBlock[]) ?? []);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Просмотреть"
          title="Просмотреть"
          className="inline-flex items-center justify-center size-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Eye className="w-[18px] h-[18px]" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <KbPageIcon icon={icon} color={iconColor} size={22} />
            {title || "Без названия"}
          </DialogTitle>
          <DialogDescription className="text-left">
            Превью удалённой страницы. Чтобы вернуть её в дерево —
            используйте кнопку «Восстановить».
          </DialogDescription>
        </DialogHeader>

        <div className="pb-2">
          {loading && (
            <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Загружаем содержимое…
            </div>
          )}
          {!loading && error && (
            <p className="px-1 py-6 text-sm text-destructive">
              Не удалось загрузить: {error}
            </p>
          )}
          {!loading && content !== null && (
            <KbBlockNoteEditor
              key={pageId}
              initialContent={content}
              editable={false}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
