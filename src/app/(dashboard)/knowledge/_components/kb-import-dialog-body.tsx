"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";

import { kbCalloutBlock } from "@/components/knowledge/blocks/kb-callout-block";
import { kbPageMentionInlineContent } from "@/components/knowledge/blocks/kb-page-mention";
import { kbStaffMentionInlineContent } from "@/components/knowledge/blocks/kb-staff-mention";
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
import {
  parseNotionZip,
  stripNotionProperties,
  dropDuplicateTitleHeading,
  relinkNotionMentions,
  preprocessNotionCallouts,
  postprocessNotionCallouts,
  collectDescendantPaths,
  type NotionZipParseResult,
  type UuidToPageInfo,
} from "@/lib/knowledge/notion-import";
import type { KbBlock } from "@/types/knowledge";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i;
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;
const ZIP_EXT_RE = /\.zip$/i;
const VALID_URL_PREFIX_RE = /^(https?:\/\/|data:|blob:|kbfile:\/\/)/i;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(\s*([^\s)"']+)/g;

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

function normalizeBasename(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

interface ExpectedRef {
  raw: string;
  key: string;
  matched: boolean;
}

/** Тело диалога импорта KB. Загружается ТОЛЬКО client-side через
 *  `next/dynamic({ ssr: false })`, потому что `useCreateBlockNote` пытается
 *  прицепить `window.ProseMirror` и крашит SSR-проход страницы /knowledge. */
export default function KbImportDialogBody({
  parentId,
  onClose,
}: {
  parentId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [notionResult, setNotionResult] = useState<NotionZipParseResult | null>(null);
  /** Какие страницы выбраны для импорта. Ключ — `zipPath` (уникальный
   *  внутри одного экспорта). Init'им при появлении notionResult всеми
   *  путями, потом юзер может снимать чекбоксы. */
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{
    phase: "import" | "relink";
    done: number;
    total: number;
  } | null>(null);
  const [expectedRefs, setExpectedRefs] = useState<ExpectedRef[]>([]);
  const [parsingZip, setParsingZip] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const schema = useMemo(
    () =>
      BlockNoteSchema.create({
        blockSpecs: {
          ...defaultBlockSpecs,
          callout: kbCalloutBlock(),
        },
        inlineContentSpecs: {
          ...defaultInlineContentSpecs,
          kbPageMention: kbPageMentionInlineContent,
          kbStaffMention: kbStaffMentionInlineContent,
        },
      }),
    [],
  );
  const editor = useCreateBlockNote({ schema });

  useEffect(() => {
    if (notionResult || files.length === 0) {
      setExpectedRefs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const allRefs = new Set<string>();
      const rawByKey = new Map<string, string>();
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
          // file read failed — skip
        }
      }
      if (cancelled) return;
      const imageKeys = new Set(imageFiles.map((f) => normalizeBasename(f.name)));
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
  }, [files, imageFiles, notionResult]);

  const ingestFiles = async (incoming: File[]) => {
    if (incoming.length === 0) return;
    const md: File[] = [];
    const images: File[] = [];
    const zips: File[] = [];
    const skipped: string[] = [];
    for (const f of incoming) {
      if (ZIP_EXT_RE.test(f.name)) zips.push(f);
      else if (MARKDOWN_EXT_RE.test(f.name)) md.push(f);
      else if (IMAGE_EXT_RE.test(f.name)) images.push(f);
      else skipped.push(f.name);
    }
    if (skipped.length > 0) {
      toast.warning(
        `Пропущено файлов: ${skipped.length} (поддерживается .zip, .md/.markdown и изображения)`,
      );
    }

    let switchedToNotion = false;
    if (zips.length > 0) {
      setParsingZip(true);
      try {
        for (const zip of zips) {
          try {
            const result = await parseNotionZip(zip);
            if (result.isNotionExport) {
              setNotionResult(result);
              setSelectedPaths(new Set(result.pages.map((p) => p.zipPath)));
              setFiles([]);
              setImageFiles([]);
              setExpectedRefs([]);
              switchedToNotion = true;
              break;
            }
            for (const node of result.pages) md.push(node.file);
            for (const img of result.imagesByPath.values()) images.push(img);
            if (result.pages.length === 0 && result.imagesByPath.size === 0) {
              toast.warning(
                `«${zip.name}»: в архиве не нашлось .md / .markdown / изображений`,
              );
            }
          } catch (err) {
            console.error("[kb-import] zip parse failed", zip.name, err);
            toast.error(
              `Не удалось распаковать «${zip.name}»: ${err instanceof Error ? err.message : "ошибка"}`,
            );
          }
        }
      } finally {
        setParsingZip(false);
      }
    }

    if (switchedToNotion) return;
    setFiles((prev) => mergeFiles(prev, md));
    setImageFiles((prev) => mergeFiles(prev, images));
  };

  const onFilesPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    await ingestFiles(picked);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    await ingestFiles(dropped);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  };

  const removeFile = (which: "md" | "image", index: number) => {
    if (which === "md") {
      setFiles((prev) => prev.filter((_, i) => i !== index));
    } else {
      setImageFiles((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const resetAll = () => {
    setFiles([]);
    setImageFiles([]);
    setNotionResult(null);
    setSelectedPaths(new Set());
    setExpectedRefs([]);
  };

  /** Toggle одной страницы. При снятии родителя — снимаем всё поддерево
   *  (иначе у потомков теряется parent_id и они «всплывают» в root). */
  const toggleSelected = (zipPath: string, checked: boolean) => {
    if (!notionResult) return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(zipPath);
      } else {
        next.delete(zipPath);
        for (const desc of collectDescendantPaths(notionResult.pages, zipPath)) {
          next.delete(desc);
        }
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!notionResult) return;
    setSelectedPaths(new Set(notionResult.pages.map((p) => p.zipPath)));
  };
  const deselectAll = () => setSelectedPaths(new Set());

  const onImport = async () => {
    if (notionResult) {
      await runNotionImport(notionResult);
    } else {
      await runFlatImport();
    }
  };

  const runNotionImport = async (result: NotionZipParseResult) => {
    setPending(true);
    // Фильтруем страницы по selection'у юзера. Сохраняем DFS-порядок
    // (parent перед child) — родительский pageId должен быть в uuidMap'е
    // ДО импорта детей.
    const pagesToImport = result.pages.filter((p) => selectedPaths.has(p.zipPath));
    setProgress({ phase: "import", done: 0, total: pagesToImport.length });

    const imported: KbImportResultItem[] = [];
    const failures: string[] = [];
    const uuidMap = new Map<string, UuidToPageInfo>();
    const snapshot: { pageId: string; title: string; blocks: KbBlock[] }[] = [];

    for (let i = 0; i < pagesToImport.length; i++) {
      const node = pagesToImport[i];
      try {
        const mdRaw = await node.file.text();
        const md = preprocessNotionCallouts(mdRaw);
        const parsed = (await editor.tryParseMarkdownToBlocks(
          md,
        )) as unknown as KbBlock[];
        const rawBlocks = postprocessNotionCallouts(parsed);

        const titleStripped = dropDuplicateTitleHeading(rawBlocks, node.title);
        const propsStripped = stripNotionProperties(titleStripped);

        const refs = collectRelativeMediaRefs(propsStripped);
        const urlMap = new Map<string, string>();
        const pageDir = node.zipPath.includes("/")
          ? node.zipPath.slice(0, node.zipPath.lastIndexOf("/") + 1)
          : "";
        const seen = new Set<string>();

        const parent_id =
          node.parentUuid && uuidMap.has(node.parentUuid)
            ? uuidMap.get(node.parentUuid)!.pageId
            : parentId;

        const cleanedNoImagesNoLinks = rewriteBrokenMediaBlocks(propsStripped);
        const initialPayload: KbImportFileInput = {
          name: node.file.name,
          title: node.title,
          blocks: cleanedNoImagesNoLinks,
          plainText: blocksToPlainText(cleanedNoImagesNoLinks),
        };
        const { imported: row, error } = await importKbPageFromMarkdown({
          parent_id,
          file: initialPayload,
        });
        if (error) failures.push(`«${node.title}»: ${error}`);
        if (!row) {
          setProgress({ phase: "import", done: i + 1, total: pagesToImport.length });
          continue;
        }
        imported.push(row);
        if (node.uuid) {
          uuidMap.set(node.uuid, {
            pageId: row.id,
            slug: row.slug,
            title: row.title,
          });
        }

        for (const ref of refs) {
          const decodedRef = (() => {
            try { return decodeURIComponent(ref); } catch { return ref; }
          })();
          const basenameKey = normalizeBasename(
            decodedRef.split(/[/\\]/).pop() ?? "",
          );
          if (!basenameKey || seen.has(basenameKey)) continue;
          seen.add(basenameKey);
          const resolvedKey = resolveZipPath(pageDir, decodedRef);
          let imgFile =
            result.imagesByPath.get(resolvedKey) ??
            result.imagesByPath.get(decodedRef);
          if (!imgFile) {
            for (const [path, f] of result.imagesByPath) {
              if (normalizeBasename(path.split("/").pop() ?? "") === basenameKey) {
                imgFile = f;
                break;
              }
            }
          }
          if (!imgFile) continue;
          const { storage_path, error: upErr } = await uploadKbAttachment({
            pageId: row.id,
            file: imgFile,
            name: imgFile.name,
            mime_type: imgFile.type || "application/octet-stream",
          });
          if (upErr || !storage_path) {
            console.error("[kb-notion-import] upload failed", imgFile.name, upErr);
            failures.push(`«${imgFile.name}»: ${upErr ?? "не удалось загрузить"}`);
            continue;
          }
          urlMap.set(basenameKey, `kbfile://${storage_path}`);
        }

        const blocksWithImages =
          urlMap.size > 0
            ? applyMediaUrlMap(propsStripped, urlMap)
            : propsStripped;

        snapshot.push({
          pageId: row.id,
          title: row.title,
          blocks: blocksWithImages,
        });

        if (urlMap.size > 0) {
          const cleanedFinal = rewriteBrokenMediaBlocks(blocksWithImages);
          const { error: saveErr } = await saveKbPage({
            id: row.id,
            title: row.title,
            icon: null,
            icon_color: null,
            content: cleanedFinal,
            plain_text: blocksToPlainText(cleanedFinal),
          });
          if (saveErr) {
            failures.push(`«${node.title}» (картинки): ${saveErr}`);
          }
        }
      } catch (err) {
        failures.push(
          `«${node.title}»: ${err instanceof Error ? err.message : "неизвестная ошибка"}`,
        );
      }
      setProgress({ phase: "import", done: i + 1, total: pagesToImport.length });
    }

    setProgress({ phase: "relink", done: 0, total: snapshot.length });
    for (let i = 0; i < snapshot.length; i++) {
      const entry = snapshot[i];
      const { blocks, replacements } = relinkNotionMentions(entry.blocks, uuidMap);
      if (replacements > 0) {
        const finalBlocks = rewriteBrokenMediaBlocks(blocks);
        const { error: saveErr } = await saveKbPage({
          id: entry.pageId,
          title: entry.title,
          icon: null,
          icon_color: null,
          content: finalBlocks,
          plain_text: blocksToPlainText(finalBlocks),
        });
        if (saveErr) {
          failures.push(`«${entry.title}» (перелинковка): ${saveErr}`);
        }
      }
      setProgress({ phase: "relink", done: i + 1, total: snapshot.length });
    }

    setPending(false);
    setProgress(null);
    finalize(imported, failures, new Set(), pagesToImport.length);
  };

  const runFlatImport = async () => {
    if (files.length === 0) return;
    setPending(true);
    setProgress({ phase: "import", done: 0, total: files.length });

    const imported: KbImportResultItem[] = [];
    const failures: string[] = [];
    const unmatchedRefs = new Set<string>();

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
        if (error) failures.push(`«${file.name}»: ${error}`);
        if (!row) {
          setProgress({ phase: "import", done: i + 1, total: files.length });
          continue;
        }
        imported.push(row);

        const refs = collectRelativeMediaRefs(rawBlocks);
        if (refs.length === 0) {
          setProgress({ phase: "import", done: i + 1, total: files.length });
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
            console.error("[kb-import] upload failed", imgFile.name, upErr);
            failures.push(`«${imgFile.name}»: ${upErr ?? "не удалось загрузить"}`);
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
      setProgress({ phase: "import", done: i + 1, total: files.length });
    }

    setPending(false);
    setProgress(null);
    finalize(imported, failures, unmatchedRefs, files.length);
  };

  const finalize = (
    imported: KbImportResultItem[],
    failures: string[],
    unmatchedRefs: Set<string>,
    expectedTotal: number,
  ) => {
    if (imported.length === 0 && failures.length > 0) {
      toast.error(failures[0]);
      return;
    }
    if (failures.length > 0 || unmatchedRefs.size > 0) {
      const parts: string[] = [];
      if (imported.length > 0) {
        parts.push(`Импортировано ${imported.length} из ${expectedTotal}.`);
      }
      if (unmatchedRefs.size > 0) {
        parts.push(
          `Не нашёл картинки: ${Array.from(unmatchedRefs).slice(0, 4).join(", ")}` +
            (unmatchedRefs.size > 4 ? ` и ещё ${unmatchedRefs.size - 4}` : "") +
            ". Добавь их в выбор и импортируй ещё раз.",
        );
      }
      if (failures.length > 0) parts.push(failures[0]);
      toast.warning(parts.join(" "));
    } else {
      toast.success(
        imported.length === 1
          ? `Импортирована страница «${imported[0].title}»`
          : `Импортировано страниц: ${imported.length}`,
      );
    }
    onClose();
    resetAll();
    router.refresh();
  };

  const missingCount = expectedRefs.filter((r) => !r.matched).length;
  const selectedCount = selectedPaths.size;
  const canImport =
    !pending &&
    !parsingZip &&
    (notionResult ? selectedCount > 0 : files.length > 0);

  return (
    <DialogContent className="max-w-[480px] p-0 gap-0 [&>button:last-child]:hidden">
      <div className="flex items-start gap-3.5 px-6 pt-6 pb-4">
        <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-full bg-brand/10 text-brand">
          <Upload className="size-[18px]" />
        </span>
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <DialogTitle className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
            Импорт из Markdown / Notion
          </DialogTitle>
          <DialogDescription className="text-sm leading-snug text-muted-foreground">
            Можно загрузить ZIP-экспорт из Notion (Markdown & CSV) — мы
            распакуем, восстановим иерархию и перелинкуем внутренние
            ссылки. Или россыпь <span className="font-mono text-[12px]">.md</span>
            {" "}файлов с картинками — каждый файл станет отдельной страницей.
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
      <div
        className="px-6 pb-4 pl-[78px] flex flex-col gap-3"
        onDrop={(e) => void onDrop(e)}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <label
          className={
            "relative flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 cursor-pointer transition-colors " +
            (isDragOver
              ? "border-brand bg-brand/5 text-foreground"
              : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40")
          }
        >
          <Upload className="size-5 opacity-70" />
          <span className="text-[13px] font-medium leading-tight">
            Перетащите файлы сюда или нажмите, чтобы выбрать
          </span>
          <span className="text-[11px] leading-tight text-muted-foreground/80">
            .zip из Notion · .md / .markdown · изображения
          </span>
          <input
            type="file"
            accept=".md,.markdown,text/markdown,.zip,application/zip,application/x-zip-compressed,image/*"
            multiple
            onChange={(e) => {
              void onFilesPicked(e);
              e.target.value = "";
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {parsingZip && (
          <div className="text-[12px] text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> распаковка ZIP…
          </div>
        )}
        {notionResult && (
          <NotionSummary
            result={notionResult}
            selectedPaths={selectedPaths}
            onToggle={toggleSelected}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onClear={() => {
              setNotionResult(null);
              setSelectedPaths(new Set());
            }}
          />
        )}
        {!notionResult && (files.length > 0 || imageFiles.length > 0) && (
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
        {!notionResult && expectedRefs.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 flex flex-col gap-1.5">
            <div className="text-[12px] font-medium text-foreground flex items-center justify-between">
              <span>В markdown упомянуто картинок: {expectedRefs.length}</span>
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
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Отмена
        </Button>
        <Button onClick={onImport} disabled={!canImport}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {progress
            ? `${progress.phase === "import" ? "Импорт" : "Перелинковка"} ${progress.done} / ${progress.total}`
            : notionResult
              ? `Импортировать (${selectedCount})`
              : files.length > 0
                ? `Импортировать (${files.length})`
                : "Импортировать"}
        </Button>
      </div>
    </DialogContent>
  );
}

function NotionSummary({
  result,
  selectedPaths,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onClear,
}: {
  result: NotionZipParseResult;
  selectedPaths: Set<string>;
  onToggle: (zipPath: string, checked: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClear: () => void;
}) {
  const total = result.pages.length;
  const selected = selectedPaths.size;
  const allSelected = selected === total && total > 0;
  return (
    <div className="rounded-lg border border-border bg-muted/20 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-[12px] min-w-0">
          <span className="inline-flex items-center justify-center size-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px]">
            ✓
          </span>
          <span className="font-medium text-foreground truncate">Notion-экспорт</span>
          <span className="text-muted-foreground tabular-nums shrink-0">
            {selected} / {total}
          </span>
          {result.imagesByPath.size > 0 && (
            <span className="text-muted-foreground tabular-nums shrink-0">
              · {result.imagesByPath.size} картинок
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-muted-foreground/70 hover:text-foreground inline-flex items-center gap-1 shrink-0"
          aria-label="Сбросить"
        >
          <X className="size-3" /> сбросить
        </button>
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-[11px]">
        <button
          type="button"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="text-brand hover:underline font-medium"
        >
          {allSelected ? "снять все" : "выделить все"}
        </button>
        <span className="text-muted-foreground/70">
          снимите чекбокс, чтобы пропустить страницу
        </span>
      </div>
      <ul className="flex flex-col max-h-[320px] overflow-y-auto py-1">
        {result.pages.map((p) => {
          const checked = selectedPaths.has(p.zipPath);
          return (
            <li
              key={p.zipPath}
              className="flex items-center gap-2 px-3 py-1 hover:bg-muted/40 transition-colors"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(v) => onToggle(p.zipPath, v === true)}
                className="shrink-0"
                aria-label={`Импортировать «${p.title}»`}
              />
              <span
                className="text-[13px] truncate flex-1"
                style={{ paddingLeft: `${p.depth * 14}px` }}
              >
                <span className="text-muted-foreground/60 mr-1">
                  {p.depth > 0 ? "↳" : "•"}
                </span>
                <span className={checked ? "text-foreground" : "text-muted-foreground/60 line-through"}>
                  {p.title}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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

function resolveZipPath(pageDir: string, relPath: string): string {
  if (relPath.startsWith("/")) relPath = relPath.slice(1);
  const segments = (pageDir + relPath).split("/").filter(Boolean);
  const out: string[] = [];
  for (const s of segments) {
    if (s === "." || s === "") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}
