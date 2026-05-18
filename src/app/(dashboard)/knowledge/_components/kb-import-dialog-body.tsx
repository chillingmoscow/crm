"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X, Check, Plus } from "lucide-react";
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
import {
  saveKbPage,
  setKbPageParent,
  getKbPageById,
} from "@/lib/knowledge/pages";
import { saveKbPageProperties } from "@/lib/knowledge/properties";
import { nanoid } from "nanoid";

import {
  inferKbPropertiesFromPairs,
  inferCollectionFieldsFromCsv,
  coerceCsvCellToFieldValue,
  cleanNotionPropertyValue,
} from "@/lib/knowledge/notion-properties";
import { parseCsv } from "@/lib/knowledge/csv";
import {
  getOrCreateKbPageCollection,
  createKbCollectionRecord,
  updateKbCollection,
  updateKbCollectionRecordTitle,
} from "@/lib/knowledge/collection-actions";
import {
  getPageCollectionId,
  serializeCollectionSchema,
  type KbCollectionSchema,
} from "@/lib/knowledge/collection";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  parseNotionZip,
  extractNotionProperties,
  buildNotionPropertiesToggle,
  extractNotionUuidFromName,
  dropDuplicateTitleHeading,
  relinkNotionMentions,
  preprocessNotionCallouts,
  postprocessNotionCallouts,
  collectDescendantPaths,
  collectImportedMentionTargets,
  resolveZipPath,
  applyNotionMediaUrlMap,
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
    phase: "import" | "relink" | "hierarchy";
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
    /** Pass 3 input. `hadZipParent` фиксирует **исходный intent**
     *  ZIP-структуры — был ли у узла родительский сегмент с UUID в путях
     *  zip'а (поле `node.hadOriginalParent`, фиксируется до нормализации
     *  parentUuid). Это важнее, чем фактический `parent_id` в БД: при
     *  partial-import'е (юзер снял чекбокс с родителя, но оставил
     *  ребёнка) реальный `parent_id` фоллбэчится на selectedRoot, и
     *  Pass 3 ошибочно решил бы, что у ребёнка не было явного
     *  zip-родителя, и реparent'ил бы через mention'ы. */
    const snapshot: {
      pageId: string;
      title: string;
      blocks: KbBlock[];
      hadZipParent: boolean;
    }[] = [];

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
        // Notion-DB property-параграфы вырезаем из контента и мапим в
        // типизированные KB page-properties (см. saveKbPageProperties
        // ниже) — вместо сырого toggle «Свойства».
        const { blocks: propsStripped, pairs: notionPropertyPairs } =
          extractNotionProperties(titleStripped);

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

        // Notion-DB-свойства страницы → типизированные KB
        // page-properties. Best-effort: ошибка не валит импорт.
        if (notionPropertyPairs.length > 0) {
          const props = inferKbPropertiesFromPairs(notionPropertyPairs);
          let propsPersisted = false;
          if (props.length > 0) {
            const { error: propErr } = await saveKbPageProperties({
              pageId: row.id,
              properties: props,
            });
            if (propErr) {
              failures.push(`«${node.title}» (свойства): ${propErr}`);
            } else {
              propsPersisted = true;
            }
          }
          // Fallback (Codex P1): типизированное сохранение не удалось
          // или ни одно свойство не выведено — НЕ теряем метаданные,
          // возвращаем их в контент скрытым toggle «Свойства».
          if (!propsPersisted) {
            const toggle = buildNotionPropertiesToggle(notionPropertyPairs);
            const withProps = [toggle, ...cleanedNoImagesNoLinks];
            const { error: restoreErr } = await saveKbPage({
              id: row.id,
              title: node.title,
              icon: null,
              icon_color: null,
              content: withProps,
              plain_text: blocksToPlainText(withProps),
            });
            if (restoreErr) {
              failures.push(
                `«${node.title}» (свойства, fallback): ${restoreErr}`,
              );
            }
          }
        }

        // Ключуем urlMap по **resolved full-path** внутри ZIP'а
        // (а не по basename'у) — две картинки с одинаковым именем из
        // разных папок (`assets/image.png` и `screens/image.png`)
        // больше не сольются в один upload (Codex P1).
        //
        // Phase 1 (serial): dedup + resolve File handle. Чисто-CPU
        // работа, нет смысла параллелить.
        type UploadTask = { resolvedKey: string; imgFile: File };
        const uploadTasks: UploadTask[] = [];
        for (const ref of refs) {
          const decodedRef = (() => {
            try { return decodeURIComponent(ref); } catch { return ref; }
          })();
          const resolvedKey = resolveZipPath(pageDir, decodedRef);
          if (!resolvedKey || seen.has(resolvedKey)) continue;
          seen.add(resolvedKey);
          let imgFile =
            result.imagesByPath.get(resolvedKey) ??
            result.imagesByPath.get(decodedRef);
          if (!imgFile) {
            // Fallback по basename'у — если zip-структура не сматчилась
            // (битый экспорт): берём первую картинку с тем же именем.
            const basename = normalizeBasename(
              decodedRef.split(/[/\\]/).pop() ?? "",
            );
            for (const [path, f] of result.imagesByPath) {
              if (normalizeBasename(path.split("/").pop() ?? "") === basename) {
                imgFile = f;
                break;
              }
            }
          }
          if (!imgFile) continue;
          uploadTasks.push({ resolvedKey, imgFile });
        }

        // Phase 2 (bounded concurrent): N images × ~30s (upload + RPC) серийно
        // — главный bottleneck импорта. uploadKbAttachment делает
        // storage.upload + RPC kb_register_attachment = 2 round-trip'а
        // (см. migration 107). limit=4 даёт ~4× speedup без перегрузки
        // pool'а (default 20 connections, 1-2 на upload).
        //
        // Best-effort: внутренний try/catch на каждый worker. Если
        // одна картинка упадёт с throw'ом (сеть, etc), мы не хотим
        // прерывать остальные uploads и пропускать block-remap +
        // saveKbPage этой страницы — иначе страница останется с
        // placeholder-блоками. Пушим в `failures`, продолжаем.
        await runWithConcurrency(uploadTasks, 4, async (task) => {
          try {
            const { storage_path, error: upErr } = await uploadKbAttachment({
              pageId: row.id,
              file: task.imgFile,
              name: task.imgFile.name,
              mime_type: task.imgFile.type || "application/octet-stream",
            });
            if (upErr || !storage_path) {
              console.error(
                "[kb-notion-import] upload failed",
                task.imgFile.name,
                upErr,
              );
              failures.push(
                `«${task.imgFile.name}»: ${upErr ?? "не удалось загрузить"}`,
              );
              return;
            }
            urlMap.set(task.resolvedKey, `kbfile://${storage_path}`);
          } catch (err) {
            console.error(
              "[kb-notion-import] upload threw",
              task.imgFile.name,
              err,
            );
            failures.push(
              `«${task.imgFile.name}»: ${err instanceof Error ? err.message : "ошибка загрузки"}`,
            );
          }
        });

        const blocksWithImages =
          urlMap.size > 0
            ? applyNotionMediaUrlMap(propsStripped, urlMap, pageDir)
            : propsStripped;

        snapshot.push({
          pageId: row.id,
          title: row.title,
          blocks: blocksWithImages,
          hadZipParent: node.hadOriginalParent,
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

    // ── Pass 3 ─ implicit hierarchy ────────────────────────────────
    // Notion для database-export'а кладёт записи плоско в одной папке,
    // и иерархии в zip-структуре нет. Но в content родителя обычно есть
    // mention'ы на subpages — используем их как сигнал: «X mention'ит Y →
    // Y становится child'ом X». Кандидаты ограничены страницами, у которых
    // в zip-структуре не было явного родителя (`hadZipParent === false`).
    //
    // Two-pass logic нужна для глубокой иерархии: Notion-страница A часто
    // содержит mention'ы на ВСЕХ потомков (B, C — даже если C на самом деле
    // child of B). Простой first-X-wins поставил бы B и C на один уровень.
    // Решение: для каждого Y выбрать «самого локального» X — того, кто НЕ
    // упоминается другими X-кандидатами Y. В случае A→{B,C}, B→{C}: для Y=C
    // кандидаты {A, B}; A упоминает B — значит B локальнее A; pick B.
    setProgress({ phase: "hierarchy", done: 0, total: snapshot.length });
    const childrenById = new Map<string, (typeof snapshot)[number]>();
    for (const e of snapshot) childrenById.set(e.pageId, e);

    // 3a. Build mention-graph: X → Set<Y> (page X mentions page Y).
    const mentionsBy = new Map<string, Set<string>>();
    for (const entry of snapshot) {
      const targets = collectImportedMentionTargets(entry.blocks, uuidMap);
      const set = new Set<string>();
      for (const t of targets) {
        if (t === entry.pageId) continue; // self-link
        set.add(t);
      }
      mentionsBy.set(entry.pageId, set);
    }

    // 3b. Inverse: Y → Set<X> (candidates that could parent Y).
    const candidatesFor = new Map<string, Set<string>>();
    for (const [x, ys] of mentionsBy) {
      for (const y of ys) {
        const childEntry = childrenById.get(y);
        // Не двигаем тех, у кого в zip была явная иерархия.
        if (!childEntry || childEntry.hadZipParent) continue;
        const set = candidatesFor.get(y) ?? new Set<string>();
        set.add(x);
        candidatesFor.set(y, set);
      }
    }

    // 3c. Для каждого Y выбрать «самого локального» X.
    //   Notion-семантика: страница содержит ссылки на свои subpages.
    //   Если X упоминает X' (X → X'), то X' — child of X, значит X' более
    //   локален (глубже в дереве). Pick X'.
    //   Mutual-mention (циклы) — tie-break по первой позиции в snapshot
    //   для детерминированности.
    const snapshotIndex = new Map<string, number>();
    for (let i = 0; i < snapshot.length; i++) snapshotIndex.set(snapshot[i].pageId, i);
    const decisions: { childId: string; parentId: string }[] = [];
    for (const [childId, candidates] of candidatesFor) {
      const arr = Array.from(candidates);
      let best = arr[0];
      for (const cand of arr) {
        if (cand === best) continue;
        const candMentionsBest = mentionsBy.get(cand)?.has(best) ?? false;
        const bestMentionsCand = mentionsBy.get(best)?.has(cand) ?? false;
        if (bestMentionsCand && !candMentionsBest) {
          // best → cand: cand является child of best → cand локальнее.
          // Pick cand.
          best = cand;
        } else if (candMentionsBest && !bestMentionsCand) {
          // cand → best: best является child of cand → best локальнее.
          // Оставляем best.
        } else {
          // Tie / mutual: берём более ранний по snapshot order.
          const ix = snapshotIndex.get(cand) ?? Infinity;
          const ib = snapshotIndex.get(best) ?? Infinity;
          if (ix < ib) best = cand;
        }
      }
      decisions.push({ childId, parentId: best });
    }

    // 3d. Apply. Сортируем decisions так, чтобы родитель устанавливался
    // ПОСЛЕ своего собственного parent'а (если он тоже adopted) — иначе
    // БД-триггер `kb_pages_check_no_cycle` отвергнет операцию из-за
    // временного цикла. Простое топологическое: страница, чей parent тоже
    // в decisions, идёт ПОСЛЕ. Реализуем как DFS с отслеживанием.
    const adoptedSet = new Set<string>();
    for (const d of decisions) adoptedSet.add(d.childId);
    const decisionByChild = new Map<string, string>();
    for (const d of decisions) decisionByChild.set(d.childId, d.parentId);
    const ordered: typeof decisions = [];
    const visited = new Set<string>();
    const visit = (childId: string) => {
      if (visited.has(childId)) return;
      visited.add(childId);
      const parent = decisionByChild.get(childId);
      if (parent && adoptedSet.has(parent)) visit(parent);
      ordered.push({ childId, parentId: decisionByChild.get(childId)! });
    };
    for (const d of decisions) visit(d.childId);

    let done = 0;
    for (const { childId, parentId: newParent } of ordered) {
      const { error: parentErr } = await setKbPageParent({
        id: childId,
        parent_id: newParent,
      });
      if (parentErr) {
        // Cycle / RLS — пропускаем тихо. Триггер БД kb_pages_check_no_cycle
        // отвергнет циклические перепривязки.
      }
      done++;
      setProgress({ phase: "hierarchy", done, total: ordered.length });
    }

    // ─── Notion-базы → KB-коллекции ──────────────────────────────────
    // Каждая база: collection-блок на странице-контейнере + kb_collections
    // со схемой из CSV + по записи-подстранице на строку с
    // типизированными scoped-значениями. Best-effort: сбой одной базы
    // не валит остальной импорт.
    const databases = result.databases ?? [];
    if (databases.length > 0) {
      setProgress({ phase: "import", done: 0, total: databases.length });
      for (let di = 0; di < databases.length; di++) {
        const db = databases[di];
        try {
          // Уважаем выбор пользователя (Codex P2): если у базы есть
          // страница-контейнер, но она НЕ импортирована (снята с
          // выбора / отсутствует) — базу пропускаем целиком, не
          // подкладываем её под selectedRoot. Контейнер=null
          // (база в корне экспорта) → кладём под выбранный root.
          let containerPageId: string | null;
          if (db.containerUuid) {
            if (!uuidMap.has(db.containerUuid)) continue;
            containerPageId = uuidMap.get(db.containerUuid)!.pageId;
          } else {
            containerPageId = parentId;
          }
          if (!containerPageId) {
            failures.push(`«${db.title}»: нет страницы-контейнера`);
            continue;
          }
          const table = parseCsv(db.csvText);
          const headers = table[0] ?? [];
          const dataRows = table
            .slice(1)
            .filter((r) => r.some((c) => c.trim().length > 0));
          if (headers.length === 0 || dataRows.length === 0) continue;

          const { titleColumnIndex, fields } = inferCollectionFieldsFromCsv(
            headers,
            dataRows,
          );
          const schema: KbCollectionSchema = { version: 1, fields };
          const schemaJson = serializeCollectionSchema(schema);
          const collectionKey = getPageCollectionId(containerPageId);

          // 1. collection-блок в контент страницы-контейнера.
          const blockId = nanoid();
          const collectionBlock = {
            id: blockId,
            type: "collection",
            props: {
              collectionId: collectionKey,
              title: db.title,
              schemaJson,
              view: "table",
            },
            content: [],
            children: [],
          } as unknown as KbBlock;
          const snapEntry = snapshot.find(
            (s) => s.pageId === containerPageId,
          );
          let containerBlocks: KbBlock[];
          let containerTitle: string;
          let containerIcon: string | null = null;
          let containerIconColor: string | null = null;
          if (snapEntry) {
            containerBlocks = [...snapEntry.blocks, collectionBlock];
            containerTitle = snapEntry.title;
            snapEntry.blocks = containerBlocks;
          } else {
            // Контейнер — уже существующая страница (импорт в неё), её
            // НЕ затираем (Codex P1): читаем текущий контент/заголовок
            // и ДОБАВЛЯЕМ блок-коллекцию в конец.
            const { row: existing, error: getErr } =
              await getKbPageById(containerPageId);
            if (getErr || !existing) {
              failures.push(
                `«${db.title}» (контейнер): ${getErr ?? "страница не найдена"}`,
              );
              continue;
            }
            const existingBlocks =
              (existing.content as unknown as KbBlock[]) ?? [];
            containerBlocks = [...existingBlocks, collectionBlock];
            containerTitle = existing.title;
            containerIcon =
              (existing as { icon?: string | null }).icon ?? null;
            containerIconColor =
              (existing as { icon_color?: string | null }).icon_color ?? null;
          }
          const { error: blockErr } = await saveKbPage({
            id: containerPageId,
            title: containerTitle,
            icon: containerIcon,
            icon_color: containerIconColor,
            content: containerBlocks,
            plain_text: blocksToPlainText(containerBlocks),
          });
          if (blockErr) failures.push(`«${db.title}» (блок): ${blockErr}`);

          // 2. kb_collections + схема.
          const { state, error: colErr } = await getOrCreateKbPageCollection({
            pageId: containerPageId,
            blockId,
          });
          if (colErr || !state) {
            failures.push(`«${db.title}»: ${colErr ?? "коллекция не создана"}`);
            continue;
          }
          await updateKbCollection({
            collectionId: state.collection.id,
            title: db.title,
            schemaJson,
          });

          // 3. Строки → записи.
          for (const dataRow of dataRows) {
            const titleVal =
              cleanNotionPropertyValue(dataRow[titleColumnIndex] ?? "") ||
              "Без названия";
            const rec = await createKbCollectionRecord({
              parentPageId: containerPageId,
              collectionId: collectionKey,
              collectionTitle: db.title,
              schemaJson,
            });
            if (rec.error || !rec.id || !rec.row) {
              if (rec.error)
                failures.push(`«${db.title}» (строка «${titleVal}»): ${rec.error}`);
              continue;
            }
            // Типизированные значения по полям.
            const props = (rec.row.properties ?? []).map((p) => {
              const scope = (p as { scope?: { type?: string; fieldId?: string } })
                .scope;
              if (scope?.type !== "collection") return p;
              const field =
                fields.find((f) => f.id === scope.fieldId) ??
                fields.find((f) => f.name === p.name);
              if (!field) return p;
              const colIdx = headers.findIndex(
                (h) => h.trim() === field.name,
              );
              if (colIdx < 0) return p;
              const value = coerceCsvCellToFieldValue(
                field,
                dataRow[colIdx] ?? "",
              );
              return { ...p, value } as typeof p;
            });
            await saveKbPageProperties({
              pageId: rec.id,
              properties: props,
            });
            await updateKbCollectionRecordTitle({
              pageId: rec.id,
              title: titleVal,
            });
            imported.push({
              id: rec.id,
              slug: rec.slug ?? "",
              title: titleVal,
            });

            // Тело записи из соответствующего .md (best-effort).
            const rowFile = db.rows.find(
              (r) => r.title.trim().toLowerCase() === titleVal.toLowerCase(),
            );
            // Регистрируем UUID строки-базы → запись: ссылки из других
            // импортированных страниц на эту строку станут mention'ами
            // (финальный relink-pass ниже, PR3). Регистрируем даже без
            // распарсенного тела.
            const rowUuid = rowFile
              ? extractNotionUuidFromName(rowFile.file.name)
              : null;
            if (rowUuid) {
              uuidMap.set(rowUuid, {
                pageId: rec.id,
                slug: rec.slug ?? "",
                title: titleVal,
              });
            }
            if (rowFile) {
              try {
                const md = preprocessNotionCallouts(await rowFile.file.text());
                const parsed = (await editor.tryParseMarkdownToBlocks(
                  md,
                )) as unknown as KbBlock[];
                const post = postprocessNotionCallouts(parsed);
                const noTitle = dropDuplicateTitleHeading(post, titleVal);
                const { blocks: noProps } = extractNotionProperties(noTitle);
                const body = rewriteBrokenMediaBlocks(noProps);
                await saveKbPage({
                  id: rec.id,
                  title: titleVal,
                  icon: null,
                  icon_color: null,
                  content: body,
                  plain_text: blocksToPlainText(body),
                });
                // В финальный relink-pass (PR3): тело записи может
                // ссылаться на другие импортированные страницы/строки.
                snapshot.push({
                  pageId: rec.id,
                  title: titleVal,
                  blocks: body,
                  hadZipParent: true,
                });
              } catch {
                /* тело best-effort — пропускаем при сбое парсинга */
              }
            }
          }
        } catch (err) {
          failures.push(
            `«${db.title}»: ${err instanceof Error ? err.message : "ошибка базы"}`,
          );
        }
        setProgress({ phase: "import", done: di + 1, total: databases.length });
      }
    }

    // ─── Финальный relink-pass (PR3) ─────────────────────────────────
    // uuidMap теперь содержит и обычные страницы, и строки-записи баз.
    // Перепроходим весь snapshot (страницы + тела записей) — внутренние
    // Notion-ссылки (`*.md`, `notion.so/<uuid>`) → kbPageMention.
    // Перезаписываем только изменённые. Это «нераспознанные → читаемый
    // текст» уже обеспечено cleanNotionPropertyValue для свойств.
    if (snapshot.length > 0) {
      setProgress({ phase: "relink", done: 0, total: snapshot.length });
      for (let i = 0; i < snapshot.length; i++) {
        const entry = snapshot[i];
        const { blocks, replacements } = relinkNotionMentions(
          entry.blocks,
          uuidMap,
        );
        if (replacements > 0) {
          entry.blocks = blocks;
          const { error: relinkErr } = await saveKbPage({
            id: entry.pageId,
            title: entry.title,
            icon: null,
            icon_color: null,
            content: blocks,
            plain_text: blocksToPlainText(blocks),
          });
          if (relinkErr) {
            failures.push(`«${entry.title}» (перелинковка): ${relinkErr}`);
          }
        }
        setProgress({ phase: "relink", done: i + 1, total: snapshot.length });
      }
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
        // Phase 1 (serial): dedup + resolve File handle.
        type FlatUploadTask = { basename: string; imgFile: File };
        const flatTasks: FlatUploadTask[] = [];
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
          flatTasks.push({ basename, imgFile });
        }

        // Phase 2 (bounded concurrent): see parallel comment in the
        // zip branch above — same trade-off, limit=4 keeps pool happy.
        // Best-effort: try/catch на worker'е по той же причине что и
        // в zip-импорте.
        await runWithConcurrency(flatTasks, 4, async (task) => {
          try {
            const { storage_path, error: upErr } = await uploadKbAttachment({
              pageId: row.id,
              file: task.imgFile,
              name: task.imgFile.name,
              mime_type: task.imgFile.type || "application/octet-stream",
            });
            if (upErr || !storage_path) {
              console.error("[kb-import] upload failed", task.imgFile.name, upErr);
              failures.push(
                `«${task.imgFile.name}»: ${upErr ?? "не удалось загрузить"}`,
              );
              return;
            }
            urlMap.set(task.basename, `kbfile://${storage_path}`);
          } catch (err) {
            console.error("[kb-import] upload threw", task.imgFile.name, err);
            failures.push(
              `«${task.imgFile.name}»: ${err instanceof Error ? err.message : "ошибка загрузки"}`,
            );
          }
        });

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
    // Если что-то импортировалось — НАВИГИРУЕМ на первую (корневую)
    // импортированную страницу, как это делают все create-flow'ы в
    // дереве (router.push на новый slug). Голый router.refresh() здесь
    // не давал sidebar'у подхватить новые страницы — пользователь
    // видел «импортировано N», но дерево оставалось прежним. push
    // форсирует свежий серверный рендер layout'а с деревом и сразу
    // показывает результат. Иначе (всё упало) — refresh на месте.
    //
    // Порядок: navigation ДО close, close отложен в микротаск. Если
    // close синхронно или раньше — `onClose()` сносит body через
    // `{open && <Body/>}`, а параллельный RSC-ре-рендер не даёт
    // Radix-порталу отдетачиться чисто → `removeChild on null`.
    if (imported.length > 0) {
      router.push(`/knowledge/${imported[0].slug}`);
    } else {
      router.refresh();
    }
    queueMicrotask(onClose);
  };

  const missingCount = expectedRefs.filter((r) => !r.matched).length;
  const selectedCount = selectedPaths.size;
  // Уже что-то добавлено → большую дропзону схлопываем в компактную
  // кнопку «Добавить ещё» (не занимает пол-диалога). DnD на body всё
  // равно работает (onDrop на контейнере ниже).
  const hasAdded =
    notionResult !== null || files.length > 0 || imageFiles.length > 0;
  const canImport =
    !pending &&
    !parsingZip &&
    (notionResult ? selectedCount > 0 : files.length > 0);

  return (
    <DialogContent className="max-w-[560px] p-0 gap-0 [&>button:last-child]:hidden">
      <div className="flex items-start gap-3.5 px-7 pt-7 pb-4">
        <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-full bg-brand/10 text-brand">
          <Upload className="size-[18px]" />
        </span>
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <DialogTitle className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
            Импорт из Markdown / Notion
          </DialogTitle>
          <DialogDescription className="text-sm leading-snug text-muted-foreground">
            Загрузите ZIP-экспорт из Notion или отдельные
            {" "}<span className="font-mono text-[12px]">.md</span>-файлы.
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
        className="px-7 pb-5 flex flex-col gap-3.5"
        onDrop={(e) => void onDrop(e)}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {hasAdded ? (
          <label
            className="relative inline-flex w-fit items-center gap-2 self-start rounded-md border border-border bg-muted/30 px-3 py-1.5 text-[13px] font-medium text-muted-foreground cursor-pointer transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Plus className="size-4" />
            Добавить ещё
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
        ) : (
          <>
            <label
              className={
                "relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-9 cursor-pointer transition-colors " +
                (isDragOver
                  ? "border-brand bg-brand/5 text-foreground"
                  : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40")
              }
            >
              <Upload className="size-6 opacity-70" />
              <span className="text-sm font-medium leading-tight">
                Перетащите файлы сюда или нажмите, чтобы выбрать
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
            {/* Footnote — мелким шрифтом под полем: форматы + что делаем */}
            <p className="text-[11px] leading-snug text-muted-foreground/70">
              .zip из Notion · .md / .markdown · изображения. ZIP
              распакуем, восстановим иерархию и перелинкуем внутренние
              ссылки; каждый отдельный .md станет своей страницей.
            </p>
          </>
        )}
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
          <ul className="text-sm text-muted-foreground flex flex-col gap-1 max-h-44 overflow-y-auto">
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
      <div className="flex justify-end gap-2 px-7 py-4 border-t">
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
            ? `${progress.phase === "import" ? "Импорт" : progress.phase === "relink" ? "Перелинковка" : "Иерархия"} ${progress.done} / ${progress.total}`
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
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-[11px]">
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
      <ul className="flex flex-col max-h-[380px] overflow-y-auto py-1.5">
        {result.pages.map((p) => {
          const checked = selectedPaths.has(p.zipPath);
          return (
            <li
              key={p.zipPath}
              className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/40 transition-colors"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(v) => onToggle(p.zipPath, v === true)}
                className="shrink-0 size-[18px]"
                aria-label={`Импортировать «${p.title}»`}
              />
              <span
                className="text-sm truncate flex-1"
                style={{ paddingLeft: `${p.depth * 18}px` }}
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

