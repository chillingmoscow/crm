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
  applyMediaUrlMap,
  collectRelativeMediaRefs,
  rewriteBrokenMediaBlocks,
} from "@/lib/knowledge/blocks-media";
import {
  importKbPageFromMarkdown,
  type KbImportFileInput,
  type KbImportResultItem,
} from "@/lib/knowledge/import";
import { uploadKbAttachment } from "@/lib/knowledge/attachments";
import { saveKbPage } from "@/lib/knowledge/pages";
import type { KbBlock } from "@/types/knowledge";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i;
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

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
  const [imageFiles, setImageFiles] = useState<File[]>([]);
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
    // Разделяем .md от картинок: .md идёт в files (one page each),
    // картинки в imageFiles — после создания страницы каждая картинка,
    // упомянутая в md по basename'у, заливается в storage и URL в
    // блоках подменяется на kbfile://. Без этого relative-refs (типа
    // `Движение-а.jpg`) превращались бы в placeholder-параграфы.
    const md: File[] = [];
    const images: File[] = [];
    const skipped: string[] = [];
    for (const f of picked) {
      if (MARKDOWN_EXT_RE.test(f.name)) md.push(f);
      else if (IMAGE_EXT_RE.test(f.name)) images.push(f);
      else skipped.push(f.name);
    }
    if (skipped.length > 0) {
      toast.warning(
        `Пропущено файлов: ${skipped.length} (поддерживается .md / .markdown и изображения)`,
      );
    }
    setFiles(md);
    setImageFiles(images);
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

    // Index image-files по lowercased basename для быстрого match'а с
    // relative-refs из markdown'а («Движение-а.jpg» → File). Используется
    // в loop'е ниже — каждый matched ref → upload + URL-rewrite.
    //
    // Коллизии (две картинки с одинаковым basename'ом, например
    // `./a/logo.png` + `./b/logo.png`) → не имеем способа отличить, на
    // какой из них ссылается markdown. Заносим первую, остальные
    // отмечаем в `ambiguousNames` и warn'аем — лучше показать
    // placeholder, чем подставить «не ту» картинку. См. Codex #66 P2.
    const imagesByName = new Map<string, File>();
    const ambiguousNames = new Set<string>();
    for (const f of imageFiles) {
      const key = f.name.toLowerCase();
      if (imagesByName.has(key)) {
        ambiguousNames.add(key);
        continue;
      }
      imagesByName.set(key, f);
    }
    if (ambiguousNames.size > 0) {
      toast.warning(
        `Несколько картинок с одинаковым именем (${Array.from(ambiguousNames).join(", ")}). ` +
          `В markdown'е может оказаться неоднозначной ссылка — переименуйте файлы и попробуйте ещё раз.`,
      );
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const md = await file.text();
        const rawBlocks = (await editor.tryParseMarkdownToBlocks(
          md,
        )) as unknown as KbBlock[];

        // Шаг 1: создаём страницу с placeholder'ами на месте всех
        // невалидных media-URL'ов. Placeholder'ы потом заменим на
        // настоящие image-блоки во второй save'е (если нашли match'и
        // среди picked image-files). Без первого save'а нет pageId,
        // а pageId нужен для kb_page_attachments-pivot при upload'е.
        const placeholderBlocks = rewriteBrokenMediaBlocks(rawBlocks);
        const payload: KbImportFileInput = {
          name: file.name,
          blocks: placeholderBlocks,
          plainText: blocksToPlainText(placeholderBlocks),
        };
        const { imported: row, error } = await importKbPageFromMarkdown({
          parent_id: parentId,
          file: payload,
        });
        if (error) {
          failures.push(`«${file.name}»: ${error}`);
        }
        if (!row) {
          setProgress({ done: i + 1, total: files.length });
          continue;
        }
        imported.push(row);

        // Шаг 2: для каждой relative-image-ref в исходных blocks
        // ищем картинку среди picked image-files. Match по basename
        // (lowercased), чтобы выдержать `./path/foo.JPG` vs `foo.jpg`.
        const refs = collectRelativeMediaRefs(rawBlocks);
        if (refs.length === 0 || imagesByName.size === 0) {
          setProgress({ done: i + 1, total: files.length });
          continue;
        }

        const urlMap = new Map<string, string>();
        const seen = new Set<string>();
        for (const ref of refs) {
          // Decode percent-encoding: markdown часто пишет `My%20Image.png`
          // вместо `My Image.png`, а `File.name` — уже decoded. Без
          // decodeURIComponent такие ref'ы никогда не сматчат файл и
          // оставались бы placeholder'ом. См. Codex #66 P2.
          const rawBasename = ref.split(/[/\\]/).pop() ?? "";
          let decoded: string;
          try {
            decoded = decodeURIComponent(rawBasename);
          } catch {
            decoded = rawBasename; // невалидный escape — fallback
          }
          const basename = decoded.toLowerCase();
          if (!basename || seen.has(basename)) continue;
          seen.add(basename);
          // Ambiguous (несколько image-files с этим basename'ом) →
          // оставляем placeholder. Юзер получил warning выше.
          if (ambiguousNames.has(basename)) continue;
          const imgFile = imagesByName.get(basename);
          if (!imgFile) continue;

          const { storage_path, error: upErr } = await uploadKbAttachment({
            pageId: row.id,
            file: imgFile,
            name: imgFile.name,
            mime_type: imgFile.type || "application/octet-stream",
          });
          if (upErr || !storage_path) {
            failures.push(
              `«${file.name}» / ${imgFile.name}: ${upErr ?? "upload failed"}`,
            );
            continue;
          }
          urlMap.set(basename, `kbfile://${storage_path}`);
        }

        // Шаг 3: если что-то залилось — пересохраняем страницу с
        // подменёнными URL'ами. Не залившиеся (или непредложенные
        // пользователем) — снова placeholder'им.
        if (urlMap.size > 0) {
          const remappedBlocks = applyMediaUrlMap(rawBlocks, urlMap);
          const cleanedBlocks = rewriteBrokenMediaBlocks(remappedBlocks);
          const { error: saveErr } = await saveKbPage({
            id: row.id,
            title: row.title,
            icon: null,
            icon_color: null,
            content: cleanedBlocks,
            plain_text: blocksToPlainText(cleanedBlocks),
          });
          if (saveErr) {
            failures.push(`«${file.name}» (после картинок): ${saveErr}`);
          }
        }
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
    setImageFiles([]);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setFiles([]); setImageFiles([]); } }}>
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
              отдельной страницей. Можно одновременно выбрать картинки —
              если markdown ссылается на них по имени файла, они
              загрузятся и подставятся в страницу.
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
            accept=".md,.markdown,text/markdown,image/*"
            multiple
            onChange={onFilesPicked}
            className="block text-sm text-muted-foreground
                       file:mr-3 file:py-1.5 file:px-3 file:rounded-md
                       file:border file:border-input
                       file:bg-background file:text-foreground
                       file:text-sm file:cursor-pointer
                       hover:file:bg-accent"
          />
          {(files.length > 0 || imageFiles.length > 0) && (
            <ul className="text-[13px] text-muted-foreground flex flex-col gap-0.5 max-h-32 overflow-y-auto">
              {files.map((f, i) => (
                <li key={`md-${f.name}-${i}`} className="truncate">
                  • {f.name}{" "}
                  <span className="text-muted-foreground/60">
                    ({Math.round(f.size / 102.4) / 10} KB)
                  </span>
                </li>
              ))}
              {imageFiles.map((f, i) => (
                <li key={`img-${f.name}-${i}`} className="truncate text-muted-foreground/70">
                  🖼 {f.name}{" "}
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

