import { nanoid } from "nanoid";

import type { KbProperty } from "@/types/knowledge";
import type { KbCollectionField } from "./collection";

/**
 * Маппинг Notion-овских property-строк («Ключ: Значение») в типизированные
 * KB page-properties. Чистые функции — юнит-тестируемы (см.
 * notion-properties.test.mts).
 *
 * Notion в Markdown-экспорте НЕ хранит типы свойств, поэтому тип
 * выводим эвристикой по значению, с безопасным fallback в `text`
 * (решение пользователя — «автоинференс с fallback в текст»).
 * Реляционные значения Notion часто приходят как
 * `Заголовок (../../..%D0%90….md)` или
 * `Имя (https://www.notion.so/<uuid>?pvs=21)` — чистим до
 * человекочитаемого текста (полноценная перелинковка — отдельная фаза).
 */

const CHECKBOX_TRUE = new Set([
  "да",
  "yes",
  "true",
  "✓",
  "✔",
  "checked",
  "on",
]);
const CHECKBOX_FALSE = new Set([
  "нет",
  "no",
  "false",
  "✗",
  "✘",
  "unchecked",
  "off",
  "—",
  "-",
]);

/** Убирает Notion-овские relative-`.md` и `notion.so`-ссылки из
 *  значения, оставляя только видимый текст. Примеры:
 *   `Авторский чай (../../..%D0%90….md)` → `Авторский чай`
 *   `Гефест (https://www.notion.so/90f2…?pvs=21)` → `Гефест`
 *   несколько подряд — соединяем через `, `. Если текста до скобки
 *   нет (`(https://…)`) — оставляем сам URL. */
export function cleanNotionPropertyValue(raw: string): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  // Разбиваем на сегменты «label (url)» по парам; URL = .md-relative
  // или notion.so/любой http. Глобально вырезаем `(…\.md)` и
  // `(https://www.notion.so/…)`-хвосты.
  const cleaned = text
    // `(<...>.md)` — относительная ссылка на страницу Notion
    .replace(/\s*\([^()]*\.md\)/gi, "")
    // `(https://www.notion.so/...)` / `(https://notion.so/...)`
    .replace(/\s*\(https?:\/\/(?:www\.)?notion\.so\/[^()]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned) return cleaned;
  // Фоллбэк: всё значение было ссылкой — вернём декодированное имя
  // файла без hash, либо исходник.
  const mdMatch = text.match(/([^/()]+)\.md\)?\s*$/i);
  if (mdMatch) {
    let name = mdMatch[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep raw */
    }
    // Notion дописывает 32-hex hash после имени — отрезаем.
    return name.replace(/\s+[0-9a-f]{32}$/i, "").trim();
  }
  return text;
}

function parseNumber(value: string): number | null {
  // «800», «1 234,5», «12.5», с возможным хвостом-единицей.
  const m = value.match(
    /^-?\d{1,3}(?:[  ]?\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/,
  );
  if (!m) return null;
  // Если ПОСЛЕ числа есть что-то кроме коротких буквенных единиц —
  // это не число (например «2 шт. в наборе, см. ниже»).
  const rest = value.slice(m[0].length).trim();
  if (rest && !/^[^\d]{0,12}$/.test(rest)) return null;
  const num = Number(m[0].replace(/[  ]/g, "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function parseDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

function makeId(): string {
  return nanoid(8);
}

/**
 * Превращает массив `{key, value}` (из parsePropertiesText) в
 * типизированные page-scoped KB-properties. Пустые значения
 * пропускаются. select НЕ выводим на уровне одной страницы (нет
 * cross-page контекста) — одиночные категориальные значения
 * остаются `text`; агрегированный select делается на уровне
 * коллекций (CSV) в следующей фазе.
 */
export function inferKbPropertiesFromPairs(
  pairs: { key: string; value: string }[],
): KbProperty[] {
  const out: KbProperty[] = [];
  const seenNames = new Set<string>();
  for (const { key, value } of pairs) {
    const name = key.trim();
    if (!name || seenNames.has(name.toLowerCase())) continue;
    const cleaned = cleanNotionPropertyValue(value);
    if (!cleaned) continue;
    seenNames.add(name.toLowerCase());
    const base = { id: makeId(), name } as const;
    const lower = cleaned.toLowerCase();

    if (/^https?:\/\/\S+$/.test(cleaned)) {
      out.push({ ...base, type: "url", value: cleaned });
      continue;
    }
    if (CHECKBOX_TRUE.has(lower)) {
      out.push({ ...base, type: "checkbox", value: true });
      continue;
    }
    if (CHECKBOX_FALSE.has(lower)) {
      out.push({ ...base, type: "checkbox", value: false });
      continue;
    }
    const date = parseDate(cleaned);
    if (date) {
      out.push({ ...base, type: "date", value: date });
      continue;
    }
    const num = parseNumber(cleaned);
    if (num !== null) {
      out.push({ ...base, type: "number", value: num });
      continue;
    }
    // Список через запятую (>=2 непустых) → multi-select.
    const parts = cleaned
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => p.length <= 60)) {
      out.push({
        ...base,
        type: "multi-select",
        value: parts,
        options: parts,
      });
      continue;
    }
    out.push({ ...base, type: "text", value: cleaned });
  }
  return out;
}

// ─── CSV (Notion-база) → схема коллекции ────────────────────────────────────

function isCheckboxToken(v: string): boolean {
  const l = v.trim().toLowerCase();
  return CHECKBOX_TRUE.has(l) || CHECKBOX_FALSE.has(l);
}
function checkboxValue(v: string): boolean {
  return CHECKBOX_TRUE.has(v.trim().toLowerCase());
}
function splitMulti(v: string): string[] {
  return v
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

type FieldType = KbCollectionField["type"];

function inferColumnType(values: string[]): {
  type: FieldType;
  options?: string[];
} {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return { type: "text" };

  if (nonEmpty.every((v) => /^https?:\/\/\S+$/.test(v))) {
    return { type: "url" };
  }
  if (nonEmpty.every(isCheckboxToken)) return { type: "checkbox" };
  if (nonEmpty.every((v) => parseDate(v) !== null)) return { type: "date" };
  if (nonEmpty.every((v) => parseNumber(v) !== null)) {
    return { type: "number" };
  }

  // multi-select: большинство ячеек — список через запятую (≥2 части).
  const multiCells = nonEmpty.filter((v) => splitMulti(v).length >= 2);
  if (multiCells.length >= Math.ceil(nonEmpty.length / 2)) {
    const opts = new Set<string>();
    for (const v of nonEmpty) for (const p of splitMulti(v)) opts.add(p);
    const options = [...opts].filter((o) => o.length <= 60).slice(0, 50);
    if (options.length > 0) return { type: "multi-select", options };
  }

  // select: ограниченный набор различных коротких значений.
  const distinct = [...new Set(nonEmpty)];
  const cap = Math.min(20, Math.max(2, Math.ceil(values.length * 0.6)));
  if (
    distinct.length <= cap &&
    distinct.every((d) => d.length <= 60) &&
    distinct.length >= 1
  ) {
    return { type: "select", options: distinct.slice(0, 50) };
  }
  return { type: "text" };
}

/**
 * Строит схему полей KB-коллекции из CSV Notion-базы. Первая колонка
 * Notion-CSV — это title-свойство строки (становится заголовком
 * record-страницы), её в поля НЕ включаем. Тип каждой остальной
 * колонки выводим агрегированно по значениям (автоинференс, fallback
 * в text). Значения чистятся от relative `.md`/`notion.so` ссылок.
 */
export function inferCollectionFieldsFromCsv(
  headers: string[],
  dataRows: string[][],
): { titleColumnIndex: number; fields: KbCollectionField[] } {
  const fields: KbCollectionField[] = [];
  for (let col = 1; col < headers.length; col++) {
    const name = (headers[col] ?? "").trim() || `Колонка ${col + 1}`;
    const colValues = dataRows.map((r) =>
      cleanNotionPropertyValue(r[col] ?? ""),
    );
    const { type, options } = inferColumnType(colValues);
    const field: KbCollectionField = { id: nanoid(8), name, type };
    if (options && (type === "select" || type === "multi-select")) {
      field.options = options;
    }
    fields.push(field);
  }
  return { titleColumnIndex: 0, fields };
}

/** Типизированное значение CSV-ячейки под конкретное поле коллекции.
 *  Возвращает то, что нужно положить в `value` соответствующей
 *  KbProperty (тип берётся из field.type). */
export function coerceCsvCellToFieldValue(
  field: KbCollectionField,
  rawCell: string,
): string | number | boolean | string[] | null {
  const v = cleanNotionPropertyValue(rawCell ?? "");
  switch (field.type) {
    case "number":
    case "rating":
      return v ? parseNumber(v) : null;
    case "date":
      return v ? parseDate(v) : null;
    case "checkbox":
      return v ? checkboxValue(v) : false;
    case "multi-select":
      return splitMulti(v);
    case "select":
      return v || null;
    case "url":
    case "text":
    default:
      return v;
  }
}
