"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X, Check } from "lucide-react";
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
const VALID_URL_PREFIX_RE = /^(https?:\/\/|data:|blob:|kbfile:\/\/)/i;
// `![alt](url)` или `![alt](url "title")`. URL — до пробела или `)`.
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(\s*([^\s)"']+)/g;

interface KbImportDialogProps {
  /** Куда импортировать. NULL — в root. */
  parentId?: string | null;
  /** Render-trigger в trigger-slot. По умолчанию — small icon button. */
  triggerLabel?: string;
}

/** Cheap regex-сканер markdown'а на `![alt](url)`. Возвращает только
 *  relative-URL'ы (которые надо resolve'ить через picked image-files).
 *  Используется ДО парсинга в BlockNote, чтобы заранее показать юзеру,
 *  каких картинок не хватает в выборе. */
function extractRelativeImageRefsFromMarkdown(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(MARKDOWN_IMAGE_RE)) {
    const url = m[1]?.trim();
    if (!url) continue;
    if (VALID_URL_PREFIX_RE.test(url)) continue;
    out.push(url);
  }
  return out;
}

/** Нормализация имени для match'а: lowercase + Unicode NFC. macOS
 *  отдаёт File.name в NFD (decomposed), а markdown текст обычно NFC —
 *  без normalize «Движение» из файла и из markdown'а могут не совпасть
 *  даже на одинаковых cyrillic-символах. */
function normalizeBasename(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

interface ExpectedRef {
  /** Оригинальный ref как в markdown'е (для отображения). */
  raw: string;
  /** Decoded + normalized basename — ключ для match'а. */
  key: string;
  /** Найдена ли соответствующая картинка среди picked imageFiles. */
  matched: boolean;
}

export function KbImportDialog({ parentId = null, triggerLabel }: KbImportDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  /** Прогресс per-file импорта: «N из M». Null → не идёт. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Ожидаемые картинки (refs из всех picked .md), сматченные с
   *  picked-image-files. Считается асинхронно после файл-pick'а через
   *  effect ниже. */
  const [expectedRefs, setExpectedRefs] = useState<ExpectedRef[]>([]);

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

  // Скан picked .md'ов на image-refs + сверка с picked image-files.
  // Перезапускается при любом изменении выбора. Result показывается
  // в UI ниже file-input'а — юзер видит «нужны: A.jpg (✓), B.jpg (нет)»
  // и может picker'нуть недостающие до клика «Импортировать».
  useEffect(() => {
    if (files.length === 0) {
      setExpectedRefs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const allRefs = new Set<string>();
      const rawByKey = new Map<string, string>(); // first-seen raw для отображения
      for (const file of files) {
        try {
          const text = await file.text();
          for (const ref of extractRelativeImageRefsFromMarkdown(text)) {
            const rawBasename = ref.split(/[/\\]/).pop() ?? "";
            let decoded = rawBasename;
            try {
              decoded = decodeURIComponent(rawBasename);
            } catch {
              /* keep raw */
            }
            const key = normalizeBasename(decoded);
            if (!key) continue;
            if (!allRefs.has(key)) {
              allRefs.add(key);
              rawByKey.set(key, decoded);
            }
          }
        } catch {
          // file read failed — skip; main onImport flow surface error
        }
      }
      if (cancelled) return;
      const imageKeys = new Set(
        imageFiles.map((f) => normalizeBasename(f.name)),
      );
      const refs: ExpectedRef[] = Array.from(allRefs).map((key) => ({
        key,
        raw: rawByKey.get(key) ?? key,
        matched: imageKeys.has(key),
      }));
      refs.sort((a, b) => a.raw.localeCompare(b.raw));
      setExpectedRefs(refs);
    })();
    return () => {
      cancelled = true;
    };
  }, [files, imageFiles]);

  const onFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
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
    // Re-pick: добавляем к уже выбранным, не overwrite — иначе юзер,
    // который сначала pick'нул .md, а потом картинки, теряет .md.
    // Дедуп по name+size, чтобы не дублировать один и тот же файл.
    setFiles((prev) => mergeFiles(prev, md));
    setImageFiles((prev) => mergeFiles(prev, images));
  };

  const removeFile = (which: "md" | "image", index: number) => {
    if (which === "md") {
      setFiles((prev) => prev.filter((_, i) => i !== index));
    } else {
      setImageFiles((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const onImport = async () => {
    if (files.length === 0) return;
    setPending(true);
    setProgress({ done: 0, total: files.length });

    const imported: KbImportResultItem[] = [];
    const failures: string[] = [];
    const unmatchedRefs = new Set<string>();

    // Index image-files по NFC+lowercased basename. Коллизии (две
    // картинки с одинаковым basename'ом) — первая попадает в map,
    // остальные → ambiguousNames + warning.
    const imagesByName = new Map<string, File>();
    const ambiguousNames = new Set<string>();
    for (const f of imageFiles) {
      const key = normalizeBasename(f.name);
      if (imagesByName.has(key)) {
        ambiguousNames.add(key);
        continue;
      }
      imagesByName.set(key, f);
    }
    if (ambiguousNames.size > 0) {
      toast.warning(
        `Несколько картинок с одинаковым именем (${Array.from(ambiguousNames).join(", ")}). ` +
          `Переименуйте их и попробуйте ещё раз.`,
      );
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const md = await file.text();
        const rawBlocks = (await editor.tryParseMarkdownToBlocks(
          md,
        )) as unknown as KbBlock[];

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

        const refs = collectRelativeMediaRefs(rawBlocks);
        if (refs.length === 0) {
          setProgress({ done: i + 1, total: files.length });
          continue;
        }

        const urlMap = new Map<string, string>();
        const seen = new Set<string>();
        for (const ref of refs) {
          const rawBasename = ref.split(/[/\\]/).pop() ?? "";
          let decoded: string;
          try {
            decoded = decodeURIComponent(rawBasename);
          } catch {
            decoded = rawBasename;
          }
          const basename = normalizeBasename(decoded);
          if (!basename || seen.has(basename)) continue;
          seen.add(basename);
          if (ambiguousNames.has(basename)) continue;
          const imgFile = imagesByName.get(basename);
          if (!imgFile) {
            unmatchedRefs.add(decoded);
            continue;
          }

          const { storage_path, error: upErr } = await uploadKbAttachment({
            pageId: row.id,
            file: imgFile,
            name: imgFile.name,
            mime_type: imgFile.type || "application/octet-stream",
          });
          if (upErr || !storage_path) {
            // Видимый failure — для изображений обычно size-limit или
            // RLS. Пишем в console чтобы видеть network-status и в
            // failures-список для toast'а.
            console.error("[kb-import] upload failed", imgFile.name, upErr);
            failures.push(
              `«${imgFile.name}»: ${upErr ?? "не удалось загрузить"}`,
            );
            continue;
          }
          urlMap.set(basename, `kbfile://${storage_path}`);
        }

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

    // Финальная сводка: успехи + диагностика. Юзер должен ясно видеть,
    // какие картинки НЕ попали (basename'ы), чтобы понять что добавить.
    if (imported.length === 0 && failures.length > 0) {
      toast.error(failures[0]);
      return;
    }
    if (failures.length > 0 || unmatchedRefs.size > 0) {
      const parts: string[] = [];
      if (imported.length > 0) {
        parts.push(`Импортировано ${imported.length} из ${files.length}.`);
      }
      if (unmatchedRefs.size > 0) {
        parts.push(
          `Не нашёл картинки: ${Array.from(unmatchedRefs).slice(0, 4).join(", ")}` +
            (unmatchedRefs.size > 4 ? ` и ещё ${unmatchedRefs.size - 4}` : "") +
            ". Добавь их в выбор и импортируй ещё раз.",
        );
      }
      if (failures.length > 0) {
        parts.push(failures[0]);
      }
      toast.warning(parts.join(" "));
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

  const missingCount = expectedRefs.filter((r) => !r.matched).length;

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
              отдельной страницей. Можно добавить картинки за один раз
              или дозагрузить несколькими действиями — мы дедуплицируем.
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
            onChange={(e) => {
              onFilesPicked(e);
              // Reset value чтобы повторный pick того же файла триггерил onChange.
              e.target.value = "";
            }}
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
                <li
                  key={`md-${f.name}-${i}`}
                  className="flex items-center gap-2 truncate"
                >
                  <span className="flex-1 truncate">
                    • {f.name}{" "}
                    <span className="text-muted-foreground/60">
                      ({formatSize(f.size)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile("md", i)}
                    className="shrink-0 text-muted-foreground/60 hover:text-foreground"
                    aria-label="Убрать файл"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
              {imageFiles.map((f, i) => (
                <li
                  key={`img-${f.name}-${i}`}
                  className="flex items-center gap-2 truncate text-muted-foreground/70"
                >
                  <span className="flex-1 truncate">
                    🖼 {f.name}{" "}
                    <span className="text-muted-foreground/60">
                      ({formatSize(f.size)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile("image", i)}
                    className="shrink-0 text-muted-foreground/60 hover:text-foreground"
                    aria-label="Убрать файл"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {expectedRefs.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 flex flex-col gap-1.5">
              <div className="text-[12px] font-medium text-foreground flex items-center justify-between">
                <span>
                  В markdown упомянуто картинок: {expectedRefs.length}
                </span>
                {missingCount > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                    не выбрано: {missingCount}
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    все выбраны
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-0.5 max-h-24 overflow-y-auto">
                {expectedRefs.map((ref) => (
                  <li
                    key={ref.key}
                    className="text-[12px] flex items-center gap-1.5 truncate"
                  >
                    {ref.matched ? (
                      <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <X className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                    <span
                      className={
                        ref.matched
                          ? "truncate text-muted-foreground"
                          : "truncate text-foreground"
                      }
                    >
                      {ref.raw}
                    </span>
                  </li>
                ))}
              </ul>
              {missingCount > 0 && (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Добавь недостающие через тот же file-input — ничего не
                  потеряется, мы объединим выбор.
                </p>
              )}
            </div>
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

/** Дедуп по name+size: даже если юзер pick'нул один и тот же файл
 *  второй раз, в state не появится дубликат. */
function mergeFiles(prev: File[], next: File[]): File[] {
  const byKey = new Map<string, File>();
  for (const f of prev) byKey.set(`${f.name}|${f.size}`, f);
  for (const f of next) byKey.set(`${f.name}|${f.size}`, f);
  return Array.from(byKey.values());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}
