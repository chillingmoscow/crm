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
import { rewriteBrokenMediaBlocks } from "@/lib/knowledge/blocks-media";
import {
  importKbPageFromMarkdown,
  type KbImportFileInput,
  type KbImportResultItem,
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
  /** Прогресс per-file импорта: «N из M». Null → не идёт. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

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
    setProgress({ done: 0, total: files.length });

    // Каждый файл идёт в отдельный server-action — Next.js Server Actions
    // имеют дефолтный лимит 1MB на body, и пачка средних .md в одном
    // вызове его пробивает (codex #43 P1). Per-file pattern: типичный
    // .md << 1MB; результаты агрегируем здесь.
    //
    // Парсинг markdown → blocks делаем последовательно, чтобы
    // редактор не молотил параллельно ProseMirror tx — на больших
    // пачках это создавало UI-лаг.
    const imported: KbImportResultItem[] = [];
    const failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const md = await file.text();
        const rawBlocks = (await editor.tryParseMarkdownToBlocks(
          md,
        )) as unknown as KbBlock[];
        // Заменяем broken-image / file / video / audio блоки (с не-http
        // URL — обычно `./path.jpg` из локальных markdown-экспортов) на
        // текстовый placeholder. Без этого юзер видит сломанные картинки
        // с alt-текстом и иконкой broken-image — UX мусорный.
        const blocks = rewriteBrokenMediaBlocks(rawBlocks);
        const payload: KbImportFileInput = {
          name: file.name,
          blocks,
          plainText: blocksToPlainText(blocks),
        };
        const { imported: row, error } = await importKbPageFromMarkdown({
          parent_id: parentId,
          file: payload,
        });
        if (row) imported.push(row);
        if (error) failures.push(`«${file.name}»: ${error}`);
      } catch (err) {
        failures.push(
          `«${file.name}»: ${err instanceof Error ? err.message : "неизвестная ошибка"}`,
        );
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setPending(false);
    setProgress(null);

    if (imported.length === 0 && failures.length > 0) {
      toast.error(failures[0]);
      return;
    }
    if (failures.length > 0) {
      toast.warning(
        `Импортировано ${imported.length} из ${files.length}. ${failures[0]}`,
      );
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
            {progress
              ? `Импорт ${progress.done} / ${progress.total}`
              : files.length > 0
                ? `Импортировать (${files.length})`
                : "Импортировать"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

