/**
 * Сторона «таблица» сличающего отчёта: разбор вставки из Google-таблицы и
 * сопоставление имён с сотрудниками.
 *
 * Таблицу читает человек: копирует два столбца (имя и сумма из колонки I) и
 * вставляет в поле страницы. Ничего не хранится, Google-клиента нет. Поэтому
 * разбор терпим к форме вставки, но НИЧЕГО не теряет молча: непонятная строка
 * возвращается как ошибка с номером и текстом.
 *
 * Сопоставление имён - только точное, после безопасной нормализации. Имя,
 * подходящее двум сотрудникам, не разрешается выбором первого: ошибочное
 * совпадение молча сличило бы деньги двух разных людей.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

import type { ReconcileSide } from "./deduction-reconciliation.ts";

export type SheetEntry = {
  /** Номер строки во вставленном тексте, с единицы. */
  line: number;
  name: string;
  /** `null` - ячейка суммы пуста: сумма неизвестна, не ноль. */
  amount: number | null;
};

export type SheetParseError = { line: number; text: string; reason: string };

export type SheetParse = {
  entries: SheetEntry[];
  errors: SheetParseError[];
  /** Первая строка принята за заголовок и пропущена - её текст, чтобы это было видно. */
  headerText: string | null;
};

/** Сумма из ячейки: число, `null` для пустой ячейки, `"invalid"`, если разобрать нельзя. */
function parseAmount(cell: string): number | null | "invalid" {
  const compact = cell
    .replace(/[\s  ]/g, "")
    .replace(/[−–]/g, "-")
    .replace(/₽|руб\.?$|р\.?$/i, "")
    .replace(",", ".");
  if (compact === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(compact)) return "invalid";
  const n = Number(compact);
  return Number.isFinite(n) ? n : "invalid";
}

export function parseSheetPaste(text: string): SheetParse {
  const entries: SheetEntry[] = [];
  const errors: SheetParseError[] = [];
  let headerText: string | null = null;
  let seenContent = false;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    const first = !seenContent;
    seenContent = true;

    const separator = raw.includes("\t") ? "\t" : raw.includes(";") ? ";" : null;
    if (!separator) {
      errors.push({ line, text: raw, reason: "Нет разделителя между именем и суммой (табуляция или точка с запятой)" });
      return;
    }
    const cells = raw.split(separator).map((c) => c.trim());
    // Хвостовые пустые ячейки - след копирования; пустая ячейка суммы допустима только второй.
    while (cells.length > 2 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length !== 2) {
      errors.push({ line, text: raw, reason: "Ожидаются ровно два столбца: имя и сумма" });
      return;
    }
    const [name, amountCell] = cells;
    if (name === "") {
      errors.push({ line, text: raw, reason: "Не указано имя" });
      return;
    }
    const amount = parseAmount(amountCell);
    if (amount === "invalid") {
      if (first && amountCell !== "") {
        headerText = raw;
        return;
      }
      errors.push({ line, text: raw, reason: "Сумма не читается как число" });
      return;
    }
    entries.push({ line, name, amount });
  });

  return { entries, errors, headerText };
}

/** Безопасная нормализация: пробелы, регистр, ё = е. Никакого нечёткого поиска. */
export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е");
}

export type DirectoryEmployee = { id: string; name: string };

export type MatchedSheetEntry = SheetEntry & { employeeId: string };
export type UnmatchedSheetEntry = SheetEntry & {
  reason: "not_found" | "ambiguous";
  /** Для неоднозначных: имена подошедших сотрудников. */
  candidates?: string[];
};

export function matchSheetNames(
  entries: SheetEntry[],
  directory: DirectoryEmployee[],
): { matched: MatchedSheetEntry[]; unmatched: UnmatchedSheetEntry[] } {
  const byName = new Map<string, DirectoryEmployee[]>();
  for (const e of directory) {
    const key = normalizePersonName(e.name);
    byName.set(key, [...(byName.get(key) ?? []), e]);
  }
  const matched: MatchedSheetEntry[] = [];
  const unmatched: UnmatchedSheetEntry[] = [];
  for (const entry of entries) {
    const hits = byName.get(normalizePersonName(entry.name)) ?? [];
    if (hits.length === 1) matched.push({ ...entry, employeeId: hits[0].id });
    else if (hits.length === 0) unmatched.push({ ...entry, reason: "not_found" });
    else unmatched.push({ ...entry, reason: "ambiguous", candidates: hits.map((h) => h.name) });
  }
  return { matched, unmatched };
}

/**
 * Сторона Sheerly для сличения.
 *  - `ready` и `disabled`: расчёт знает ответ про каждого. Кого нет среди строк
 *    удержания, тому удерживать нечего - это настоящий ноль.
 *  - `incomplete`: месяц не посчитан до конца, суммы неизвестны (`null`),
 *    и нулём они не становятся.
 */
export function sheerlySideFor(input: {
  state: "ready" | "incomplete" | "disabled";
  capturedAt: string;
  lines: Array<{ employeeId: string; amount: number }>;
  /** Сотрудники, про которых спрашивает таблица. */
  knownEmployeeIds: string[];
}): ReconcileSide {
  if (input.state === "incomplete")
    return {
      capturedAt: input.capturedAt,
      entries: [...new Set(input.knownEmployeeIds)].map((employeeId) => ({ employeeId, amount: null })),
    };
  const amounts = new Map<string, number>();
  for (const l of input.lines) amounts.set(l.employeeId, l.amount);
  for (const id of input.knownEmployeeIds) if (!amounts.has(id)) amounts.set(id, 0);
  return {
    capturedAt: input.capturedAt,
    entries: [...amounts.entries()].map(([employeeId, amount]) => ({ employeeId, amount })),
  };
}
