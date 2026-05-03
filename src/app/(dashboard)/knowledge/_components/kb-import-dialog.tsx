"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
} from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";

import { kbCalloutBlock } from "@/components/knowledge/blocks/kb-callout-block";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import {
  importKbPagesFromMarkdown,
  type KbImportFileInput,
} from "@/lib/knowledge/import";
import type { KbBlock } from "@/types/knowledge";

interface KbImportDialogProps {
  /** Куда импортировать. NULL — в root. */
  parentId?: string | null;
  /** Render-trigger в trigger-slot. По умолчанию — small icon button. */
  triggerLabel?: string;
}

/**
 * Импорт нескольких .md / .markdown файлов в KB.
 *
 * Markdown → BlockNote-блоки парсится **на клиенте** — BlockNote'овский
 * `markdownToBlocks` требует ProseMirror Schema (DOM-зависимый
 * editor instance), на server-action'е работать не может. Здесь
 * мы держим скрытый editor через useCreateBlockNote с той же schema'ой,
 * что и основной KbBlockNoteEditor (callout-блок включён).
 *
 * Сервер только гейтит permission (`kb.import_pages` + `kb.create_pages`)
 * и создаёт строки. См. src/lib/knowledge/import.ts.
 */
export function KbImportDialog({ parentId = null, triggerLabel }: KbImportDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);

  // Hidden editor для markdown-парсинга. Создаётся один раз на mount,
  // schema идентична `KbBlockNoteEditor` — иначе callout/прочие
  // расширенные блоки бы не парсились корректно (хотя стандартный md
  // их не содержит — на будущее).
  const schema = useMemo(
    () =>
      BlockNoteSchema.create({
        blockSpecs: {
          ...defaultBlockSpecs,
          callout: kbCalloutBlock(),
        },
      }),
    [],
  );
  const editor = useCreateBlockNote({ schema });

  const onFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Фильтруем по расширению — input accept не ловит drag-drop из
    // некоторых OS-файлменеджеров.
    const valid = picked.filter((f) => /\.(md|markdown)$/i.test(f.name));
    if (valid.length < picked.length) {
      toast.warning(
        `Пропущено файлов: ${picked.length - valid.length} (поддерживается только .md / .markdown)`,
      );
    }
    setFiles(valid);
  };

  const onImport = async () => {
    if (files.length === 0) return;
    setPending(true);

    // Параллельно парсим все markdown'ы. tryParseMarkdownToBlocks
    // возвращает массив блоков по схеме editor'а.
    const parsed: KbImportFileInput[] = [];
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const md = await file.text();
          const blocks = (await editor.tryParseMarkdownToBlocks(
            md,
          )) as unknown as KbBlock[];
          return {
            name: file.name,
            blocks,
            plainText: blocksToPlainText(blocks),
          };
        }),
      );
      parsed.push(...results);
    } catch (err) {
      setPending(false);
      toast.error(
        `Ошибка парсинга markdown: ${err instanceof Error ? err.message : "неизвестная"}`,
      );
      return;
    }

    const { imported, error } = await importKbPagesFromMarkdown({
      parent_id: parentId,
      files: parsed,
    });
    setPending(false);

    if (error && imported.length === 0) {
      toast.error(error);
      return;
    }
    if (error) {
      toast.warning(`Создано ${imported.length} страниц. ${error}`);
    } else {
      toast.success(
        imported.length === 1
          ? `Импортирована страница «${imported[0].title}»`
          : `Импортировано страниц: ${imported.length}`,
      );
    }
    setOpen(false);
    setFiles([]);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFiles([]); }}>
      <IconTooltip label={triggerLabel ?? "Импорт из Markdown"}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Импорт из Markdown"
          >
            <Upload className="size-3.5" />
          </Button>
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="max-w-[480px] p-0 gap-0 [&>button:last-child]:hidden">
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-4">
          <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-full bg-brand/10 text-brand">
            <Upload className="size-[18px]" />
          </span>
          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
            <DialogTitle className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
              Импорт из Markdown
            </DialogTitle>
            <DialogDescription className="text-sm leading-snug text-muted-foreground">
              Каждый <span className="font-mono text-[12px]">.md</span> файл станет
              отдельной страницей. Вложения и картинки по внешним ссылкам
              не загружаются — только текст и базовое форматирование.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Закрыть"
              className="inline-flex shrink-0 items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </DialogClose>
        </div>
        <div className="px-6 pb-4 pl-[78px] flex flex-col gap-3">
          <input
            type="file"
            accept=".md,.markdown,text/markdown"
            multiple
            onChange={onFilesPicked}
            className="block text-sm text-muted-foreground
                       file:mr-3 file:py-1.5 file:px-3 file:rounded-md
                       file:border file:border-input
                       file:bg-background file:text-foreground
                       file:text-sm file:cursor-pointer
                       hover:file:bg-accent"
          />
          {files.length > 0 && (
            <ul className="text-[13px] text-muted-foreground flex flex-col gap-0.5 max-h-32 overflow-y-auto">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="truncate">
                  • {f.name}{" "}
                  <span className="text-muted-foreground/60">
                    ({Math.round(f.size / 102.4) / 10} KB)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Отмена
          </Button>
          <Button
            onClick={onImport}
            disabled={pending || files.length === 0}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {files.length > 0
              ? `Импортировать (${files.length})`
              : "Импортировать"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
