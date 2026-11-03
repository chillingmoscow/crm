/**
 * Сличение расчёта Sheerly с колонкой I Google-таблицы - поимённо.
 *
 * Чистая функция: ничего не читает и не пишет. Колонку I не меняем и обратного
 * моста нет: в ноябре платят по таблице, а отчёт показывает, где и насколько
 * расчёт разошёлся.
 *
 * Три правила, на которых держится смысл отчёта:
 *  - внешнее соединение по сотруднику: тот, кого нет с одной стороны, остаётся
 *    в результате с `null` на этой стороне, а не выпадает;
 *  - неизвестная сумма остаётся `null` и никогда не становится нулём: ноль -
 *    это «удерживать нечего», `null` - «не знаем»;
 *  - у каждой стороны есть момент снятия: таблица живая (закрытый октябрь уже
 *    сдвинулся с 5 339 до 6 039 ₽), и без отметки разницу не отличить от
 *    ошибки расчёта.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

export type ReconcileEntry = {
  employeeId: string;
  /** `null` - сумма неизвестна (месяц не посчитан, ячейка не прочитана). Не ноль. */
  amount: number | null;
};

export type ReconcileSide = {
  /** Момент, когда сторона снята (ISO 8601). */
  capturedAt: string;
  entries: ReconcileEntry[];
};

export type ReconcileStatus =
  /** Есть обе суммы, разницы нет до копейки. */
  | "match"
  /** Есть обе суммы, они различаются. */
  | "differs"
  /** Сотрудник есть только в расчёте Sheerly. */
  | "only_sheerly"
  /** Сотрудник есть только в таблице. */
  | "only_sheet"
  /** Сотрудник есть с обеих сторон, но хотя бы одна сумма неизвестна. */
  | "unknown";

export type ReconcileRow = {
  employeeId: string;
  sheerly: number | null;
  sheet: number | null;
  /** Sheerly минус таблица, в рублях с копейками; `null`, если хотя бы одна сумма неизвестна. */
  delta: number | null;
  status: ReconcileStatus;
  sheerlyCapturedAt: string;
  sheetCapturedAt: string;
};

const toCents = (n: number) => Math.round(n * 100);

/**
 * Сумма по сотруднику на одной стороне. Повтор строки суммируется (в таблице
 * человек может встретиться дважды); если среди повторов есть неизвестная
 * сумма, итог неизвестен - молча считать её нулём нельзя.
 */
function collapse(entries: ReconcileEntry[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const e of entries) {
    if (!out.has(e.employeeId)) {
      out.set(e.employeeId, e.amount === null ? null : toCents(e.amount));
      continue;
    }
    const prev = out.get(e.employeeId)!;
    out.set(
      e.employeeId,
      prev === null || e.amount === null ? null : prev + toCents(e.amount),
    );
  }
  return out;
}

const fromCents = (c: number | null) => (c === null ? null : c / 100);

export function reconcileDeduction(
  sheerly: ReconcileSide,
  sheet: ReconcileSide,
): ReconcileRow[] {
  const a = collapse(sheerly.entries);
  const b = collapse(sheet.entries);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort();

  return ids.map((employeeId) => {
    const inA = a.has(employeeId);
    const inB = b.has(employeeId);
    // Отсутствие стороны и неизвестная сумма - обе `null`, различает их status.
    const ca = inA ? a.get(employeeId)! : null;
    const cb = inB ? b.get(employeeId)! : null;

    let status: ReconcileStatus;
    let delta: number | null = null;
    if (!inB) status = "only_sheerly";
    else if (!inA) status = "only_sheet";
    else if (ca === null || cb === null) status = "unknown";
    else {
      delta = (ca - cb) / 100;
      status = ca === cb ? "match" : "differs";
    }

    return {
      employeeId,
      sheerly: fromCents(ca),
      sheet: fromCents(cb),
      delta,
      status,
      sheerlyCapturedAt: sheerly.capturedAt,
      sheetCapturedAt: sheet.capturedAt,
    };
  });
}
