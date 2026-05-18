"use client";

import JSZip from "jszip";

import type { KbBlock, KbInlineContent } from "@/types/knowledge";
import { parseCsv } from "@/lib/knowledge/csv";

// ─── 1. Title / UUID utilities ──────────────────────────────────────────────

/** 32 hex digits в конце имени, отделённые пробелом (Notion-конвенция).
 *  Захват — без дефисов, lowercase или uppercase (Notion отдаёт lowercase).
 *  Пример: «Обслуживание посудомоечных машин 33128fdd8e9f81f489a7c6594760441c». */
const NOTION_UUID_TAIL_RE = / ([0-9a-f]{32})$/i;
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

/** Достаёт 32-hex Notion UUID из имени файла или папки. Понимает оба
 *  варианта: «Page Name <uuid>.md» и «Page Name <uuid>» (folder). */
export function extractNotionUuidFromName(name: string): string | null {
  const noExt = name.replace(MARKDOWN_EXT_RE, "");
  const m = NOTION_UUID_TAIL_RE.exec(noExt);
  return m ? m[1].toLowerCase() : null;
}

/** «Page Name <uuid>.md» → «Page Name». Не-Notion имена возвращаются как
 *  есть (минус расширение). */
export function cleanNotionTitle(name: string): string {
  const noExt = name.replace(MARKDOWN_EXT_RE, "").trim();
  return noExt.replace(NOTION_UUID_TAIL_RE, "").trim() || "Без названия";
}

// ─── 2. ZIP parsing ─────────────────────────────────────────────────────────

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i;

export interface NotionZipNode {
  /** 32-hex UUID из имени файла. Используется как ключ для перелинковки. */
  uuid: string | null;
  /** Очищенный заголовок. */
  title: string;
  /** Полный путь внутри ZIP'а (для разрешения относительных image-refs). */
  zipPath: string;
  /** Глубина в дереве (0 = root). Нужно для DFS-сортировки. */
  depth: number;
  /** UUID родителя ВНУТРИ импорта. null если parent-сегмента не было,
   *  ИЛИ если он был, но соответствующий .md в импорт не попал —
   *  нормализованное значение для DFS pre-order'а в Pass 1. */
  parentUuid: string | null;
  /** Был ли в zip-структуре parent-сегмент с UUID (до нормализации).
   *  Pass 3 (implicit hierarchy) использует это вместо `parentUuid`,
   *  чтобы не реparent'ить страницы с явной zip-иерархией даже когда
   *  родитель сам не попал в импорт. */
  hadOriginalParent: boolean;
  /** Конструированный File (ZIP уже извлёк blob). */
  file: File;
}

/** Notion-база (таблица). Сигнал — inline-ссылка на `.csv` в теле
 *  страницы (`[label](path/to/db.csv)`), а НЕ имя папки. */
export interface NotionZipDatabase {
  /** Человекочитаемый заголовок: ближайший заголовок над ссылкой,
   *  иначе текст ссылки, иначе «Коллекция». */
  title: string;
  /** Сырой CSV целевого файла ссылки. */
  csvText: string;
  /** UUID .md-страницы, в теле которой стоит ссылка на CSV
   *  (контейнер для блока-коллекции). null → корневой импорт. */
  containerUuid: string | null;
  /** Decoded href ссылки на CSV (для замены конкретного
   *  link-параграфа на collection-блок in place). */
  csvHref: string;
  /** Строки базы: сопоставленные по заголовку (Наименование)
   *  .md-файлы — тело записи. Нет .md → запись без тела. */
  rows: { zipPath: string; title: string; file: File }[];
  /** Заголовки всех строк CSV (первая колонка) — для read-only
   *  превью в диалоге импорта (что приедет вместе со страницей). */
  recordTitles: string[];
}

export interface NotionZipParseResult {
  /** Markdown-файлы в DFS pre-order: parent перед children. */
  pages: NotionZipNode[];
  /** Notion-базы (таблицы) — импортируются как KB-коллекции. */
  databases: NotionZipDatabase[];
  /** Все картинки, ключуются по полному пути в ZIP'е. Lookup-стратегия:
   *  сначала relative-resolve от .md-страницы, потом fallback по basename. */
  imagesByPath: Map<string, File>;
  /** Какой-то .md заканчивается на `<32-hex>.md`? Если да — экспорт «notion». */
  isNotionExport: boolean;
}

/** Рекурсивно «расплющивает» все entries архивa: если внутри лежит
 *  вложенный .zip (Notion для воркспейсов отдаёт `ExportBlock-<uuid>.zip`,
 *  внутри которого ещё один .zip с реальным экспортом) — разворачиваем
 *  его на месте, склеивая внутренние пути с префиксом ВНЕШНЕГО архива.
 *  Возвращает плоский Map: full-path → loaded Blob. */
async function flattenZipRecursively(
  archive: JSZip,
  prefix = "",
  out: Map<string, Blob> = new Map(),
  depth = 0,
): Promise<Map<string, Blob>> {
  if (depth > 4) return out; // sanity-cap: zip-bomb / circular wrap
  for (const [path, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const fullPath = prefix ? `${prefix}/${path}` : path;
    if (/\.zip$/i.test(path)) {
      const nestedBlob = await entry.async("blob");
      try {
        const nested = await JSZip.loadAsync(nestedBlob);
        await flattenZipRecursively(nested, stripExt(fullPath), out, depth + 1);
      } catch {
        // битый вложенный архив — складываем как обычный файл
        out.set(fullPath, nestedBlob);
      }
      continue;
    }
    const blob = await entry.async("blob");
    out.set(fullPath, blob);
  }
  return out;
}

function stripExt(path: string): string {
  return path.replace(/\.[^./]+$/, "");
}

/** Распаковывает Notion-style ZIP (включая вложенные ZIP'ы — Notion для
 *  workspace-экспорта оборачивает реальный архив в `ExportBlock-<uuid>.zip`).
 *  Возвращает .md в DFS pre-order и все images. */
export async function parseNotionZip(zip: File): Promise<NotionZipParseResult> {
  const root = await JSZip.loadAsync(zip);
  const flat = await flattenZipRecursively(root);

  const mdEntries: { path: string; name: string; blob: Blob }[] = [];
  const imagesByPath = new Map<string, File>();

  for (const [path, blob] of flat) {
    const name = path.split("/").pop() ?? "";
    if (MARKDOWN_EXT_RE.test(name)) {
      mdEntries.push({ path, name, blob });
    } else if (IMAGE_EXT_RE.test(name)) {
      const file = new File([blob], name, {
        type: blob.type || mimeFromExt(name),
      });
      imagesByPath.set(path, file);
    }
    // прочее (csv, json и т.п.) — игнорируем.
  }

  const isNotionExport = mdEntries.some(
    (e) => extractNotionUuidFromName(e.name) !== null,
  );

  // Pre-pass: построить `folderToUuid` мапу для сопоставления **папок без
  // UUID в имени** с UUID соответствующего .md-файла. Notion в новом
  // формате экспорта (наблюдается в Notion 2025+) кладёт UUID **только**
  // в имена .md-файлов, а контейнер-папку для детей называет просто
  // «<title>/», без хвостового UUID. Старый формат (UUID и в имени папки)
  // тоже поддерживаем — extractNotionUuidFromName на сегменте сработает
  // первым в walk-up'е.
  //
  // Логика: для файла `<dir>/<title> <uuid>.md` дочерние страницы лежат
  // под `<dir>/<title>/`. Записываем `<dir>/<title>` → uuid.
  const folderToUuid = new Map<string, string>();
  for (const { path, name } of mdEntries) {
    const fileUuid = extractNotionUuidFromName(name);
    if (!fileUuid) continue;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const titleNoUuid = cleanNotionTitle(name);
    const childrenFolderPath = [...segments.slice(0, -1), titleNoUuid].join("/");
    folderToUuid.set(childrenFolderPath, fileUuid);
  }

  // Notion-БАЗЫ детектим по СИГНАЛУ: inline-ссылка на `.csv` в теле
  // .md-страницы (`[label](relative/path/db.csv)`). Это и есть то,
  // как Notion встраивает базу. Папочные эвристики убраны (ломали
  // иерархию). Строки CSV сопоставляем со .md по заголовку
  // (Наименование = первая колонка); такие .md исключаем из обычных
  // страниц — они станут записями коллекции.
  const mdText = new Map<string, string>();
  for (const { path, blob } of mdEntries) {
    mdText.set(path, await blob.text());
  }
  // Индекс .md по очищенному заголовку (lowercase) для матчинга строк.
  const mdByTitle = new Map<string, typeof mdEntries>();
  for (const e of mdEntries) {
    const key = cleanNotionTitle(e.name).trim().toLowerCase();
    const arr = mdByTitle.get(key) ?? [];
    arr.push(e);
    mdByTitle.set(key, arr);
  }
  const CSV_LINK_RE = /\[([^\]]*)\]\(\s*<?([^)>\s]+)>?\s*\)/g;
  const databases: NotionZipDatabase[] = [];
  const rowZipPathSet = new Set<string>();
  const usedRowPaths = new Set<string>();
  const containerPaths = new Set<string>();
  for (const { path, name } of mdEntries) {
    const raw = mdText.get(path) ?? "";
    if (!raw.includes(".csv")) continue;
    containerPaths.add(path);
    const containerUuid = extractNotionUuidFromName(name);
    const pageDir = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/") + 1)
      : "";
    const lines = raw.split("\n");
    for (const m of raw.matchAll(CSV_LINK_RE)) {
      const linkText = (m[1] ?? "").trim();
      let href = m[2] ?? "";
      try {
        href = decodeURIComponent(href);
      } catch {
        /* keep raw */
      }
      const hrefNoQuery = href.replace(/[#?].*$/, "");
      if (!/\.csv$/i.test(hrefNoQuery)) continue;
      const csvPath = resolveZipPath(pageDir, hrefNoQuery);
      const csvBlob = flat.get(csvPath);
      if (!csvBlob) continue;
      const csvText = await csvBlob.text();
      // Заголовок: ближайший markdown-heading НАД ссылкой; иначе
      // текст ссылки (если не «Untitled»); иначе «Коллекция».
      const linkLineIdx = lines.findIndex((l) => l.includes(m[2] ?? ""));
      let title = "";
      for (let i = linkLineIdx - 1; i >= 0; i--) {
        const hm = lines[i].match(/^#{1,6}\s+(.+?)\s*$/);
        if (hm) {
          title = hm[1].trim();
          break;
        }
      }
      if (!title) {
        title =
          linkText && !/^untitled$/i.test(linkText) ? linkText : "Коллекция";
      }
      // Строки: первая колонка CSV = Наименование → ищем .md с тем
      // же заголовком (без повторного использования одного .md).
      const table = parseCsv(csvText);
      const rows: NotionZipDatabase["rows"] = [];
      const recordTitles: string[] = [];
      for (const r of table.slice(1)) {
        const rowTitle = (r[0] ?? "").trim();
        if (!rowTitle) continue;
        recordTitles.push(rowTitle);
        const cand = (mdByTitle.get(rowTitle.toLowerCase()) ?? []).find(
          (e) => e.path !== path && !usedRowPaths.has(e.path),
        );
        if (!cand) continue;
        usedRowPaths.add(cand.path);
        rowZipPathSet.add(cand.path);
        rows.push({
          zipPath: cand.path,
          title: cleanNotionTitle(cand.name),
          file: new File([cand.blob], cand.name, {
            type: "text/markdown",
          }),
        });
      }
      databases.push({
        title,
        csvText,
        containerUuid,
        csvHref: hrefNoQuery,
        rows,
        recordTitles,
      });
    }
  }
  // Папка строк-базы содержит ещё и служебный .md самой базы
  // (Notion-экспорт «Untitled <uuid>.md» — placeholder вида БД).
  // Любой .md в директории, где лежат сопоставленные строки, и сам
  // НЕ контейнер — это артефакт базы: исключаем из обычных страниц
  // (иначе появляется лишняя «Untitled» с сырым property-текстом).
  const rowDirs = new Set<string>();
  for (const p of rowZipPathSet) {
    const d = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (d) rowDirs.add(d);
  }
  for (const e of mdEntries) {
    if (containerPaths.has(e.path)) continue;
    const d = e.path.includes("/")
      ? e.path.slice(0, e.path.lastIndexOf("/"))
      : "";
    if (d && rowDirs.has(d)) rowZipPathSet.add(e.path);
  }

  const nodesByUuid = new Map<string, NotionZipNode>();
  const orphanNodes: NotionZipNode[] = [];
  for (const { path, name, blob } of mdEntries) {
    // Строки Notion-базы → записи коллекции, не отдельные страницы.
    if (rowZipPathSet.has(path)) continue;
    const uuid = extractNotionUuidFromName(name);
    const segments = path.split("/").filter(Boolean);
    const depth = segments.length - 1;
    // Notion часто дублирует страницу: и `Parent <uuid>.md` (на уровень
    // выше), и `Parent <uuid>/Parent <uuid>.md` (в собственной папке для
    // attachments). Это одна и та же страница — дедуплицируем по UUID,
    // оставляя ту, у которой path короче (= уровень родителя).
    if (uuid && nodesByUuid.has(uuid)) {
      const existing = nodesByUuid.get(uuid)!;
      if (existing.zipPath.length <= path.length) continue;
    }
    // Идём ВВЕРХ по сегментам пути до первого, для которого нашёлся
    // UUID. На каждом уровне пробуем два источника:
    //   1. Сам сегмент: `<title> <uuid>` (старый формат Notion + новый
    //      для .md-файлов). Покрывает self-ref guard `Page <uuid>/Page
    //      <uuid>.md` — пропускаем `u === uuid` и идём выше.
    //   2. Сопоставление по полному пути сегмента → UUID соседнего .md
    //      на уровне выше (новый формат: папка-контейнер без UUID в
    //      имени). Пропускаем папки-БД (`Лог @ Генеральные уборки/`),
    //      у которых нет соответствующего .md → uuid не найдётся, идём
    //      дальше вверх к фактической parent-странице.
    let effectiveParentUuid: string | null = null;
    for (let s = segments.length - 2; s >= 0; s--) {
      const folderPath = segments.slice(0, s + 1).join("/");
      const direct = extractNotionUuidFromName(segments[s]);
      if (direct && direct !== uuid) {
        effectiveParentUuid = direct;
        break;
      }
      const viaFolder = folderToUuid.get(folderPath);
      if (viaFolder && viaFolder !== uuid) {
        effectiveParentUuid = viaFolder;
        break;
      }
    }
    // hadOriginalParent отражает ИСХОДНУЮ zip-структуру (до второго
    // прохода нормализации ниже). Pass 3 implicit-hierarchy использует
    // его вместо `parentUuid`, чтобы не реparent'ить через mention'ы
    // страницы, у которых явный parent был в zip, даже если он сам не
    // попал в импорт (partial selection / отсутствует в архиве).
    const hadOriginalParent = effectiveParentUuid !== null;
    const file = new File([blob], name, { type: "text/markdown" });
    const node: NotionZipNode = {
      uuid,
      title: cleanNotionTitle(name),
      zipPath: path,
      depth,
      parentUuid: effectiveParentUuid,
      hadOriginalParent,
      file,
    };
    if (uuid) nodesByUuid.set(uuid, node);
    else orphanNodes.push(node);
  }

  // Нормализация parentUuid: если parent-узел не попал в импорт
  // (parentUuid указывает на UUID, которого нет в nodesByUuid), считаем
  // такой узел top-level — иначе DFS-обход его не подхватит и страница
  // попадает в fallback'-блок в insertion-order'е (= Pass 1 импорта
  // получает child'ов раньше parent'ов и parent_id фоллбэчится на
  // selectedRoot — иерархия теряется).
  for (const node of nodesByUuid.values()) {
    if (node.parentUuid !== null && !nodesByUuid.has(node.parentUuid)) {
      node.parentUuid = null;
    }
  }

  // DFS pre-order: parent → children. Нужно чтобы при INSERT'е child'а
  // его parent_id уже был известен. Орфаны (не Notion .md) — в конец, flat.
  const pages: NotionZipNode[] = [];
  const childrenByParent = new Map<string | null, NotionZipNode[]>();
  for (const node of nodesByUuid.values()) {
    const key = node.parentUuid;
    const arr = childrenByParent.get(key) ?? [];
    arr.push(node);
    childrenByParent.set(key, arr);
  }
  // Сортируем сиблинги по zipPath чтобы порядок был детерминированным
  // и соответствовал тому, что юзер видел в Notion'е (Notion в имени
  // файла обычно сохраняет натуральный порядок).
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.zipPath.localeCompare(b.zipPath));
  }
  const visit = (parentUuid: string | null) => {
    const kids = childrenByParent.get(parentUuid) ?? [];
    for (const kid of kids) {
      pages.push(kid);
      if (kid.uuid) visit(kid.uuid);
    }
  };
  visit(null);
  // Если parentUuid не нашёлся в map'е (битый экспорт) — добавим как top-level.
  for (const node of nodesByUuid.values()) {
    if (!pages.includes(node)) pages.push(node);
  }
  pages.push(...orphanNodes);

  return { pages, databases, imagesByPath, isNotionExport };
}

/** Резолвит relative-path внутри ZIP относительно директории страницы.
 *  `pageDir` — путь до .md в zip'е (с trailing slash) или "" для root'а.
 *  Нормализует `..` и `./`. */
export function resolveZipPath(pageDir: string, relPath: string): string {
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

/** Подменяет URL'ы media-блоков (image/file/video/audio) по mapping'у,
 *  где ключи — **полные resolved-пути внутри ZIP'а** (а не basename'ы).
 *
 *  Зачем не через `applyMediaUrlMap` из blocks-media.ts: тот матчит по
 *  basename'у, и две разных картинки с одинаковым именем из разных
 *  папок (`assets/image.png` и `screens/image.png`) сливаются в один
 *  upload и оба блока в md ссылаются на одну и ту же storage-копию
 *  (Codex P1). Здесь ключуем по resolved-пути относительно pageDir,
 *  что гарантирует уникальность.
 *
 *  `urlMap`: `resolveZipPath(pageDir, decodedRef)` → `kbfile://...`.
 *  `pageDir`: тот же `pageDir`, что использовался при заполнении
 *  urlMap для этой страницы. */
export function applyNotionMediaUrlMap(
  blocks: KbBlock[],
  urlMap: Map<string, string>,
  pageDir: string,
): KbBlock[] {
  return blocks.map((block) => {
    const b = block as unknown as {
      type?: string;
      props?: { url?: string };
      children?: unknown[];
    };
    const isMedia =
      b.type === "image" ||
      b.type === "file" ||
      b.type === "video" ||
      b.type === "audio";
    if (isMedia) {
      const url = (b.props?.url ?? "").trim();
      if (url && !/^(https?:\/\/|data:|blob:|kbfile:\/\/)/i.test(url)) {
        let decoded: string;
        try {
          decoded = decodeURIComponent(url);
        } catch {
          decoded = url;
        }
        const fullKey = resolveZipPath(pageDir, decoded);
        const replacement = urlMap.get(fullKey);
        if (replacement) {
          return {
            ...block,
            props: { ...(b.props ?? {}), url: replacement },
          } as KbBlock;
        }
      }
    }
    if (Array.isArray(b.children) && b.children.length > 0) {
      return {
        ...block,
        children: applyNotionMediaUrlMap(
          b.children as KbBlock[],
          urlMap,
          pageDir,
        ),
      } as KbBlock;
    }
    return block;
  });
}

/** Все UUID'ы потомков данного узла (DFS). Используется UI чтобы при
 *  снятии чекбокса с родителя автоматически снимать всё поддерево —
 *  иначе у потомков теряется parent_id и они «всплывают» в root. */
export function collectDescendantPaths(
  pages: NotionZipNode[],
  rootZipPath: string,
): string[] {
  const root = pages.find((p) => p.zipPath === rootZipPath);
  if (!root || !root.uuid) return [];
  const out: string[] = [];
  const queue = [root.uuid];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const p of pages) {
      if (p.parentUuid === parent) {
        out.push(p.zipPath);
        if (p.uuid) queue.push(p.uuid);
      }
    }
  }
  return out;
}

function mimeFromExt(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return "application/octet-stream";
  switch (m[1]) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "avif": return "image/avif";
    case "bmp": return "image/bmp";
    case "heic": return "image/heic";
    default: return "application/octet-stream";
  }
}

// ─── 3. Properties block stripping ──────────────────────────────────────────

/** Похож ли plain-text параграфа на Notion DB property-row?
 *
 *  Two patterns:
 *  - одна строка `Ключ: Значение`
 *  - одна склееная строка с >=3 двоеточиями (BlockNote'овский parser
 *    схлопывает Notion'овские property-строки в один paragraph если
 *    между ними нет blank-line — реальный кейс на скриншоте). */
function looksLikePropertyText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^[^:\n]{1,40}:\s+\S/.test(t) && !t.includes("\n")) return true;
  const colonCount = (t.match(/[:：]\s/g) ?? []).length;
  if (colonCount >= 3 && t.length < 1000) return true;
  return false;
}

/** Plain text всех инлайн-runs параграфа (без mark'ов). */
function blockPlainText(block: KbBlock): string {
  const c = block.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  let out = "";
  for (const inline of c) {
    if (inline.type === "text") {
      out += (inline as { text?: string }).text ?? "";
    } else if (inline.type === "link") {
      const nested = (inline as { content?: KbInlineContent[] }).content;
      if (Array.isArray(nested)) {
        for (const n of nested) {
          if (n.type === "text") out += (n as { text?: string }).text ?? "";
        }
      }
    }
  }
  return out;
}

/** Разрезает «склееный» текст вида
 *  `Автор: Павел Оплочко, Георгий Вышкварка Актуальность: Expired Внёс: ...`
 *  на пары `{key, value}`. Position-based: ищем все позиции «ключа»
 *  (заглавное слово + 0-3 lowercase-слов + `:` + пробел), без запятых
 *  внутри ключа — иначе значение типа «Оплочко, Георгий Вышкварка»
 *  ошибочно расщепляется по каждой капитализации. */
function parsePropertiesText(text: string): { key: string; value: string }[] {
  // Ключ: заглавное слово (без пробелов/запятой/двоеточия), затем 0-3
  // lowercase-слова через одиночный пробел, затем `:` с пробелом и
  // непустым значением. `:` в значении (12:57) не ловится, т.к.
  // следующего пробела нет.
  const keyRe = /(?:^|\s)((?:[A-ZА-ЯЁ][^\s,:]*)(?:[ \t][a-zа-яё][^\s,:]*){0,3}):[ \t]+(?=\S)/gu;
  type Hit = { keyStart: number; keyEnd: number; valueStart: number; key: string };
  const hits: Hit[] = [];
  for (const m of text.matchAll(keyRe)) {
    const matchStart = m.index ?? 0;
    const leadOffset = m[0].startsWith(" ") || m[0].startsWith("\t") ? 1 : 0;
    const keyStart = matchStart + leadOffset;
    const keyEnd = keyStart + m[1].length;
    const valueStart = matchStart + m[0].length;
    hits.push({ keyStart, keyEnd, valueStart, key: m[1] });
  }
  if (hits.length === 0) return [];
  const out: { key: string; value: string }[] = [];
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const end = i + 1 < hits.length ? hits[i + 1].keyStart : text.length;
    const value = text.slice(cur.valueStart, end).trim();
    out.push({ key: cur.key, value });
  }
  return out;
}

/** Детектирует ведущие property-параграфы Notion-DB-страницы и
 *  возвращает распарсенные пары `{key,value}` + индекс, с которого
 *  начинается «настоящий» контент (после свойств). Если свойств нет —
 *  `{ pairs: [], cursor: 0 }`. Общая логика для `stripNotionProperties`
 *  (legacy toggle) и `extractNotionProperties` (маппинг в KB-props). */
function extractLeadingProperties(blocks: KbBlock[]): {
  pairs: { key: string; value: string }[];
  cursor: number;
} {
  if (blocks.length === 0) return { pairs: [], cursor: 0 };
  const propertyBlocks: KbBlock[] = [];
  let cursor = 0;
  while (cursor < blocks.length) {
    const b = blocks[cursor];
    if (b.type === "heading") break;
    if (b.type !== "paragraph") break;
    const text = blockPlainText(b);
    if (!looksLikePropertyText(text)) break;
    propertyBlocks.push(b);
    cursor++;
  }
  if (propertyBlocks.length === 0) return { pairs: [], cursor: 0 };

  // Stronger signal — иначе одиночный intro-параграф вида «Note: …»
  // ошибочно засчитался бы за DB-метаданные. Требуем ≥2 property-
  // параграфов либо один склееный с ≥3 двоеточиями (реальный кейс
  // Notion DB-export'а с merged properties).
  if (propertyBlocks.length === 1) {
    const text = blockPlainText(propertyBlocks[0]).trim();
    const colonCount = (text.match(/[:：]\s/g) ?? []).length;
    if (colonCount < 3) return { pairs: [], cursor: 0 };
  }

  const pairs: { key: string; value: string }[] = [];
  for (const p of propertyBlocks) {
    const text = blockPlainText(p).trim();
    if (!text) continue;
    if (text.includes("\n")) {
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const colonIdx = t.indexOf(":");
        if (colonIdx > 0 && colonIdx < t.length - 1) {
          pairs.push({
            key: t.slice(0, colonIdx).trim(),
            value: t.slice(colonIdx + 1).trim(),
          });
        }
      }
    } else {
      const parsed = parsePropertiesText(text);
      if (parsed.length === 0) pairs.push({ key: "", value: text });
      else pairs.push(...parsed);
    }
  }
  if (pairs.length === 0) return { pairs: [], cursor: 0 };
  return { pairs, cursor };
}

/** Извлекает ведущие Notion-DB property-параграфы как пары
 *  `{key,value}` и ОТРЕЗАЕТ их из контента (без toggle-обёртки —
 *  caller замапит их в типизированные KB page-properties через
 *  inferKbPropertiesFromPairs / saveKbPageProperties). */
export function extractNotionProperties(blocks: KbBlock[]): {
  blocks: KbBlock[];
  pairs: { key: string; value: string }[];
} {
  const { pairs, cursor } = extractLeadingProperties(blocks);
  if (pairs.length === 0) return { blocks, pairs: [] };
  return { blocks: blocks.slice(cursor), pairs };
}

/** Собирает скрывающийся toggle-блок «Свойства» из пар {key,value}.
 *  Используется как fallback: если типизированное сохранение
 *  page-properties упало (лимиты схемы / RPC) — не теряем метаданные,
 *  а возвращаем их в контент текстом (Codex P1). */
export function buildNotionPropertiesToggle(
  pairs: { key: string; value: string }[],
): KbBlock {
  const children: KbBlock[] = pairs.map(({ key, value }) => ({
    type: "paragraph",
    props: {},
    content: key
      ? [
          { type: "text", text: `${key}: `, styles: { bold: true } },
          { type: "text", text: value, styles: {} },
        ]
      : [{ type: "text", text: value, styles: {} }],
    children: [],
  }));
  return {
    type: "toggleListItem",
    props: {},
    content: [{ type: "text", text: "Свойства", styles: { bold: true } }],
    children,
  };
}

/** Legacy: ведущие property-параграфы → скрывающийся toggle
 *  «Свойства». Оставлено для обратной совместимости; новый импорт
 *  использует `extractNotionProperties` + page-properties. */
export function stripNotionProperties(blocks: KbBlock[]): KbBlock[] {
  const { pairs, cursor } = extractLeadingProperties(blocks);
  if (pairs.length === 0) return blocks;
  return [buildNotionPropertiesToggle(pairs), ...blocks.slice(cursor)];
}

// ─── 4. Internal-link relinking → kbPageMention ─────────────────────────────

/** Достаёт 32-hex UUID из href markdown-ссылки. Понимает relative
 *  paths (`Sub%20Page%20<uuid>.md`), absolute (`/foo/<uuid>.md`),
 *  с anchor'ом (`<uuid>.md#section`), с decode'нутыми пробелами. */
export function extractNotionUuidFromHref(href: string): string | null {
  let h: string;
  try { h = decodeURIComponent(href); } catch { h = href; }
  // strip query/anchor
  h = h.replace(/[#?].*$/, "");
  // strip extension
  h = h.replace(MARKDOWN_EXT_RE, "");
  const m = h.match(/([0-9a-f]{32})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Mapping заполняется во время Pass 1 импорта. */
export interface UuidToPageInfo {
  pageId: string;
  slug: string;
  title: string;
}

/** Перелинковывает внутренние ссылки на свежесозданные страницы.
 *  В каждом inline-link'е, чей href содержит известный Notion-UUID,
 *  заменяем link на atomic `kbPageMention` с slug целевой страницы. */
export function relinkNotionMentions(
  blocks: KbBlock[],
  uuidMap: Map<string, UuidToPageInfo>,
): { blocks: KbBlock[]; replacements: number } {
  let replacements = 0;
  const visit = (bs: KbBlock[]): KbBlock[] =>
    bs.map((block) => {
      let next: KbBlock = block;
      if (Array.isArray(block.content)) {
        const newContent: KbInlineContent[] = [];
        let changed = false;
        for (const run of block.content) {
          if (run.type !== "link") {
            newContent.push(run);
            continue;
          }
          const link = run as { href: string; content: KbInlineContent[] };
          const uuid = extractNotionUuidFromHref(link.href);
          const target = uuid ? uuidMap.get(uuid) : undefined;
          if (!target) {
            newContent.push(run);
            continue;
          }
          // Title: видимый текст ссылки или fallback на сохранённый title.
          let displayTitle = "";
          for (const n of link.content) {
            if (n.type === "text") displayTitle += (n as { text?: string }).text ?? "";
          }
          const cleanedTitle = displayTitle
            ? cleanNotionTitle(displayTitle.trim())
            : target.title;
          newContent.push({
            type: "kbPageMention",
            props: {
              slug: target.slug,
              title: cleanedTitle || target.title,
              icon: "",
              iconColor: "",
            },
          });
          replacements++;
          changed = true;
        }
        if (changed) {
          next = { ...block, content: newContent };
        }
      }
      if (Array.isArray(next.children) && next.children.length > 0) {
        const newChildren = visit(next.children);
        if (newChildren !== next.children) {
          next = { ...next, children: newChildren };
        }
      }
      return next;
    });
  return { blocks: visit(blocks), replacements };
}

/** Собирает pageId'ы импортированных страниц, на которые ссылается данная
 *  страница через inline link'и `[Title](.../<uuid>.md)`. Используется
 *  Pass 3 импорта (implicit hierarchy) — если родитель X mention'ит
 *  целевой Y, входящий в этот же импорт, то Y становится child'ом X.
 *
 *  Walk по тем же inline-link'ам, что и `relinkNotionMentions`, но без
 *  мутации блоков и без zamены на kbPageMention. Возвращает уникальные
 *  pageId'ы в порядке появления в content (нужно для детерминированного
 *  tie-break'а в Pass 3). */
export function collectImportedMentionTargets(
  blocks: KbBlock[],
  uuidMap: Map<string, UuidToPageInfo>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (bs: KbBlock[]) => {
    for (const block of bs) {
      if (Array.isArray(block.content)) {
        for (const run of block.content) {
          if (run.type !== "link") continue;
          const link = run as { href: string };
          const uuid = extractNotionUuidFromHref(link.href);
          if (!uuid) continue;
          const target = uuidMap.get(uuid);
          if (!target) continue;
          if (seen.has(target.pageId)) continue;
          seen.add(target.pageId);
          out.push(target.pageId);
        }
      }
      if (Array.isArray(block.children) && block.children.length > 0) {
        visit(block.children);
      }
    }
  };
  visit(blocks);
  return out;
}

// ─── 5. Notion callouts (blockquote с emoji) ───────────────────────────────

/** Magic-маркер: paragraph c таким префиксом → callout-блок (см. ниже).
 *  Кладём в markdown ДО парсинга, выгребаем ПОСЛЕ. */
const CALLOUT_MARKER = "kb:callout:";

/** Пре-процессинг markdown'а из Notion: callout-блок → magic-prefix paragraph.
 *
 *  Notion экспортирует callout двумя способами в разных версиях:
 *    1. `> 💡 text` — markdown blockquote с emoji-префиксом (старый формат)
 *    2. `<aside>\n💡 text\n</aside>` — HTML-блок (новый Notion 2024+)
 *
 *  BlockNote'овский parser оба формата теряет (либо blockquote → paragraph
 *  без `>`, либо HTML-блок выкидывается полностью). Заменяем оба варианта
 *  на простой paragraph с magic-маркером, который post-процесс распознает
 *  и превратит в callout-блок. */
export function preprocessNotionCallouts(md: string): string {
  // Variant 1: markdown blockquote `> 💡 text`
  let out = md.replace(
    /^>[ \t]+(\p{Extended_Pictographic}️?)[ \t]+(.+)$/gmu,
    (_m, emoji: string, text: string) => `${CALLOUT_MARKER}${emoji} ${text}`,
  );
  // Variant 2: HTML aside-блок (multi-line). Notion 2024+ экспортирует
  // callout именно так. Захватываем emoji из первого непустого фрагмента
  // внутри + остаток текста (схлопываем переносы).
  out = out.replace(
    /<aside>\s*(\p{Extended_Pictographic}️?)\s+([\s\S]*?)<\/aside>/gu,
    (_m, emoji: string, text: string) => {
      const oneLine = text.replace(/\s+/g, " ").trim();
      return `${CALLOUT_MARKER}${emoji} ${oneLine}`;
    },
  );
  // Variant 3: blockquote с unicode-кавычкой `›` (некоторые Notion-клиенты).
  out = out.replace(
    /^[›][ \t]*(\p{Extended_Pictographic}️?)[ \t]+(.+)$/gmu,
    (_m, emoji: string, text: string) => `${CALLOUT_MARKER}${emoji} ${text}`,
  );
  return out;
}

const VARIANT_BY_EMOJI: Record<string, "info" | "warning" | "success" | "error"> = {
  "💡": "info",
  "ℹ️": "info",
  "📌": "info",
  "📍": "info",
  "⚠️": "warning",
  "🚧": "warning",
  "⚡": "warning",
  "✅": "success",
  "✔️": "success",
  "🟢": "success",
  "❌": "error",
  "❗": "error",
  "⛔": "error",
  "🔴": "error",
};

/** Post-процесс: paragraph'ы, начинающиеся с CALLOUT_MARKER, превращаем
 *  в callout-блок. Variant выбираем по emoji; emoji в content не кладём
 *  (его рендерит сам callout через variant-icon). */
export function postprocessNotionCallouts(blocks: KbBlock[]): KbBlock[] {
  return blocks.map((block) => {
    if (block.type === "paragraph" && Array.isArray(block.content)) {
      const first = block.content[0];
      if (
        first &&
        first.type === "text" &&
        typeof (first as { text?: string }).text === "string" &&
        (first as { text: string }).text.startsWith(CALLOUT_MARKER)
      ) {
        const stripped = stripMarkerFromInline(block.content);
        const text = stripped.plain.trim();
        const emojiMatch = /^(\p{Extended_Pictographic}️?)\s+(.*)$/u.exec(text);
        const emoji = emojiMatch?.[1] ?? "";
        const variant = VARIANT_BY_EMOJI[emoji] ?? "info";
        // Обрезаем emoji + space из inline-runs (не только из plain).
        const inlineWithoutEmoji = emoji
          ? trimLeadingChars(stripped.runs, emoji.length + 1)
          : stripped.runs;
        return {
          type: "callout",
          props: { variant },
          content: inlineWithoutEmoji,
          children: [],
        } as KbBlock;
      }
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      return {
        ...block,
        children: postprocessNotionCallouts(block.children),
      } as KbBlock;
    }
    return block;
  });
}

function stripMarkerFromInline(runs: KbInlineContent[]): {
  runs: KbInlineContent[];
  plain: string;
} {
  const out: KbInlineContent[] = [];
  let plain = "";
  let stripped = false;
  for (const run of runs) {
    if (!stripped && run.type === "text") {
      const t = (run as { text: string }).text;
      const idx = t.indexOf(CALLOUT_MARKER);
      if (idx !== -1) {
        const after = t.slice(idx + CALLOUT_MARKER.length);
        out.push({
          type: "text",
          text: after,
          styles: (run as { styles?: Record<string, unknown> }).styles ?? {},
        });
        plain += after;
        stripped = true;
        continue;
      }
    }
    out.push(run);
    if (run.type === "text") plain += (run as { text: string }).text;
  }
  return { runs: out, plain };
}

/** Срезает первые `n` UTF-16 code unit'ов из text-run'ов (учитывая
 *  surrogate pairs у emoji). */
function trimLeadingChars(runs: KbInlineContent[], n: number): KbInlineContent[] {
  const out: KbInlineContent[] = [];
  let remaining = n;
  let started = false;
  for (const run of runs) {
    if (!started && remaining > 0 && run.type === "text") {
      const t = (run as { text: string }).text;
      if (t.length <= remaining) {
        remaining -= t.length;
        continue;
      }
      out.push({
        type: "text",
        text: t.slice(remaining),
        styles: (run as { styles?: Record<string, unknown> }).styles ?? {},
      });
      remaining = 0;
      started = true;
      continue;
    }
    started = true;
    out.push(run);
  }
  return out;
}

// ─── 6. Title-duplication cleanup (H1 = filename) ───────────────────────────

/** Notion часто дублирует заголовок страницы первым H1-блоком в теле.
 *  После того как мы вычистили заголовок из имени файла, тот же
 *  заголовок остаётся в content'е и выглядит как дубль. Сравниваем
 *  cleaned-title с первым heading-1 — если совпадают, выкидываем. */
export function dropDuplicateTitleHeading(
  blocks: KbBlock[],
  pageTitle: string,
): KbBlock[] {
  if (blocks.length === 0) return blocks;
  const first = blocks[0];
  if (first.type !== "heading") return blocks;
  if ((first.props as { level?: number } | undefined)?.level !== 1) return blocks;
  const text = blockPlainText(first).trim();
  if (cleanNotionTitle(text) === pageTitle.trim()) {
    return blocks.slice(1);
  }
  return blocks;
}
