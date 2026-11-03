/**
 * Постановка удержания по недостаче: оркестрация без доступа к базе.
 *
 * Здесь решается только порядок и условия; всё, что трогает базу, приходит
 * через `PostDeps` (серверное действие подставляет настоящие, тест - заглушки).
 *
 *  1. снимок месяца -> `allocateMonthlyShortage`;
 *  2. ставится ТОЛЬКО `ready`. `incomplete` и `disabled` не вызывают запись и
 *     возвращают, чего не хватает: частичная строка при автоматической
 *     постановке была бы неверной суммой, которую никто не проверял;
 *  3. строки - по одной на сотрудника за месяц, суммы по пулам складываются в копейках;
 *  4. после записи - проверка аномалии. Она только предупреждает и никогда не
 *     влияет на то, поставлена строка или нет: сбой уведомления или истории
 *     не откатывает и не скрывает постановку.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

import { createHash } from "node:crypto";
import { allocateMonthlyShortage, type MonthlyShortagePool } from "./monthly-shortage.ts";
import type { MonthlySnapshot, SnapshotDataProblems } from "./monthly-snapshot.ts";
import {
  detectDeductionAnomaly,
  type AnomalyVerdict,
  type HistoryMonth,
} from "./deduction-anomaly.ts";

const cents = (n: number) => Math.round(n * 100);

export type DeductionLine = {
  employeeId: string;
  /** Положительная сумма в рублях: знак ставит RPC (в ведомости удержание отрицательно). */
  amount: number;
  /** Из каких пулов набралась сумма: для аудита, на расчёт не влияет. */
  pools: Array<{ pool: string; key: string | null; amount: number }>;
};

/** Строки по сотрудникам: суммы по всем пулам складываются в копейках, нули отбрасываются. */
export function buildDeductionLines(pools: MonthlyShortagePool[]): DeductionLine[] {
  const byEmployee = new Map<string, { cents: number; pools: DeductionLine["pools"] }>();
  for (const p of pools) {
    for (const a of p.allocations) {
      const c = cents(a.amount);
      if (c === 0) continue;
      const cur = byEmployee.get(a.employeeId) ?? { cents: 0, pools: [] };
      cur.cents += c;
      cur.pools.push({ pool: p.pool, key: p.key, amount: a.amount });
      byEmployee.set(a.employeeId, cur);
    }
  }
  return [...byEmployee.entries()]
    .map(([employeeId, v]) => ({ employeeId, amount: v.cents / 100, pools: v.pools }))
    .filter((l) => l.amount > 0)
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

/**
 * Ключ повтора строки: детерминирован от снимка и сотрудника. Тот же расчёт,
 * отправленный повторно, даёт тот же ключ, и уникальный индекс не даст второй строки.
 */
export function deductionRequestKey(snapshotId: string, employeeId: string): string {
  const h = createHash("sha256").update(`inventory-deduction:${snapshotId}:${employeeId}`).digest("hex");
  // Форма UUID версии 4/вариант 8: колонка request_key - uuid.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const RU_MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
/** `2026-10-01` -> «октябрь 2026». */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${RU_MONTHS[m - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

export type RpcLine = { employee_id: string; amount: number; request_key: string; reason: string; pools: DeductionLine["pools"] };
export type RpcSnapshot = {
  id: string;
  /** Всегда "ready": неготовый расчёт не отправляется, а таблица снимков принимает только "ready". */
  state: "ready";
  captured_at: string;
  rule_version_id: string;
  shortage_total: number;
  company_total: number;
  employees_total: number;
  missing: string[];
  payload: unknown;
};

export type PostRpcResult = {
  posted: boolean;
  unchanged: boolean;
  replayed: boolean;
  snapshotId: string | null;
  reversed: number;
  targetMonth: string | null;
  displaced: boolean;
  /** Суммы как в ведомости (отрицательные). */
  lines: Array<{ adjustment_id: string; employee_id: string; amount: number; business_date: string }>;
  /** Строки, поставленные уволенным сотрудникам: видны, а не потеряны. */
  inactive: Array<{ employee_id: string; name: string; amount: number }>;
};

export type PostDeps = {
  buildSnapshot: () => Promise<MonthlySnapshot>;
  loadHistory: (month: string) => Promise<HistoryMonth[]>;
  post: (args: { venueId: string; month: string; lines: RpcLine[]; snapshot: RpcSnapshot }) => Promise<PostRpcResult>;
  /**
   * Сторно всех живых строк месяца без замены. Нужно, когда правила месяца выключены:
   * заведение покрывает недостачу целиком, и прежние строки не должны остаться в ведомости.
   * Ошибка (например, зафиксированный период) пробрасывается: её нельзя проглотить.
   */
  reverse: (args: { venueId: string; month: string; reason: string }) => Promise<{ reversed: number }>;
  notifyAnomaly: (info: {
    venueId: string;
    month: string;
    snapshotId: string;
    total: number;
    median: number;
    ratio: number | null;
  }) => Promise<void>;
  newId: () => string;
};

export type PostOutcome =
  | {
      state: "incomplete";
      posted: false;
      month: string;
      unresolved: string[];
      dataProblems: SnapshotDataProblems;
    }
  | { state: "disabled"; posted: false; month: string; reversed: number }
  | {
      state: "ready";
      posted: boolean;
      unchanged: boolean;
      month: string;
      result: PostRpcResult;
      employeesTotal: number;
      anomaly: AnomalyVerdict | null;
      /** Текст ошибки уведомления/истории, если они не отработали. Постановку не отменяет. */
      notifyError: string | null;
    };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function postMonthlyDeduction(deps: PostDeps): Promise<PostOutcome> {
  const snap = await deps.buildSnapshot();
  const alloc = allocateMonthlyShortage(snap);

  if (alloc.state === "incomplete")
    return {
      state: "incomplete",
      posted: false,
      month: snap.month,
      unresolved: alloc.unresolved,
      dataProblems: snap.dataProblems,
    };
  if (alloc.state === "disabled") {
    // Правила выключены - заведение платит всё. Правильное состояние месяца: ни одной строки,
    // поэтому всё, что поставлено раньше, сторнируется (тем же механизмом, что и пересчёт).
    const { reversed } = await deps.reverse({
      venueId: snap.venueId,
      month: snap.month,
      reason: `Пересчёт удержания по недостаче за ${snap.month.slice(5, 7)}.${snap.month.slice(0, 4)}: правила удержаний выключены`,
    });
    return { state: "disabled", posted: false, month: snap.month, reversed };
  }

  const lines = buildDeductionLines(alloc.pools);
  // Страховка от расхождения: суммы строк обязаны сойтись с итогом расчёта.
  const linesCents = lines.reduce((s, l) => s + cents(l.amount), 0);
  if (linesCents !== cents(alloc.employees))
    throw new Error("Строки удержания не сходятся с итогом расчёта: постановка остановлена");

  const snapshotId = deps.newId();
  const reason = `Недостача за ${monthLabel(snap.month)}`;
  const rpcSnapshot: RpcSnapshot = {
    id: snapshotId,
    state: "ready",
    captured_at: snap.capturedAt,
    rule_version_id: snap.ruleVersionId,
    shortage_total: alloc.total,
    company_total: alloc.company,
    employees_total: alloc.employees,
    missing: [],
    payload: {
      sources: snap.sources,
      weights: snap.weights,
      config: snap.config,
      pools: alloc.pools,
      storeBindings: snap.storeBindings,
      dataProblems: snap.dataProblems,
      timezone: snap.timezone,
      payrollDayStartHour: snap.payrollDayStartHour,
    },
  };
  const result = await deps.post({
    venueId: snap.venueId,
    month: snap.month,
    lines: lines.map((l) => ({
      employee_id: l.employeeId,
      amount: l.amount,
      request_key: deductionRequestKey(snapshotId, l.employeeId),
      reason,
      pools: l.pools,
    })),
    snapshot: rpcSnapshot,
  });

  // Предупреждение об аномалии - только для расчёта, который действительно записан.
  let anomaly: AnomalyVerdict | null = null;
  let notifyError: string | null = null;
  if (result.posted) {
    try {
      const history = await deps.loadHistory(snap.month);
      anomaly = detectDeductionAnomaly({ month: snap.month, current: alloc.total, history });
      if (anomaly.kind === "anomaly")
        await deps.notifyAnomaly({
          venueId: snap.venueId,
          month: snap.month,
          snapshotId,
          total: alloc.total,
          median: anomaly.median,
          ratio: anomaly.ratio,
        });
    } catch (e) {
      notifyError = errText(e);
    }
  }
  return {
    state: "ready",
    posted: result.posted,
    unchanged: result.unchanged,
    month: snap.month,
    result,
    employeesTotal: alloc.employees,
    anomaly,
    notifyError,
  };
}

// ── Текст для человека ───────────────────────────────────────

const rub = (n: number) =>
  `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Math.abs(n))} ₽`;

/** Чего не хватает месяцу, словами: по префиксу устойчивого ID источника. */
export function describeUnresolved(refs: string[]): string {
  const kinds: Array<[string, string]> = [
    ["inventory:", "актов инвентаризации"],
    ["writeoff:", "актов списаний без плательщика"],
    ["shift:", "дней смен без должности или отметок"],
    ["timezone:", "расхождений часовых поясов"],
  ];
  const parts: string[] = [];
  let rest = refs.length;
  for (const [prefix, label] of kinds) {
    const n = refs.filter((r) => r.startsWith(prefix)).length;
    if (n > 0) parts.push(`${label}: ${n}`);
    rest -= n;
  }
  if (rest > 0) parts.push(`прочего: ${rest}`);
  return parts.join("; ");
}

/** Одна строка о том, что произошло с месяцем. Ничего не умалчивает: неполный месяц называет причину. */
export function describePostOutcome(out: PostOutcome): string {
  const label = monthLabel(out.month);
  if (out.state === "disabled")
    return (
      `Правила удержаний за ${label} выключены: строки в ведомость не ставятся.` +
      (out.reversed > 0 ? ` Прежних строк сторнировано: ${out.reversed}.` : "")
    );
  if (out.state === "incomplete") {
    const problems = out.dataProblems.undatedActs.length + out.dataProblems.actsWithoutVenue.length;
    return (
      `Удержание за ${label} не поставлено: месяц не посчитан до конца. Не хватает: ${describeUnresolved(out.unresolved)}.` +
      (problems > 0 ? ` Проблем данных вне месяца: ${problems}.` : "")
    );
  }
  const r = out.result;
  if (out.unchanged) return `Удержание за ${label} уже стоит в ведомости: пересчёт ничего не изменил.`;
  if (r.replayed) return `Удержание за ${label}: этот расчёт уже был применён ранее.`;
  const parts: string[] = [];
  parts.push(
    r.lines.length === 0
      ? `Удержание за ${label} пересчитано: с сотрудников удерживать нечего.`
      : `Удержание за ${label} поставлено в ведомость: сотрудников ${r.lines.length}, ${rub(out.employeesTotal)}.`,
  );
  if (r.reversed > 0) parts.push(`Прежних строк сторнировано: ${r.reversed}.`);
  if (r.displaced && r.targetMonth)
    parts.push(`Период ${label} зафиксирован, строки перенесены в ${monthLabel(r.targetMonth)}.`);
  if (r.inactive.length > 0)
    parts.push(`Внимание, строка поставлена уволенному сотруднику: ${r.inactive.map((i) => i.name).join(", ")}.`);
  if (out.anomaly?.kind === "anomaly")
    parts.push(`Месяц заметно выше обычного (медиана прошлых месяцев ${rub(out.anomaly.median)}): уведомление отправлено, строка поставлена.`);
  if (out.notifyError) parts.push(`Уведомление не отправлено: ${out.notifyError}.`);
  return parts.join(" ");
}
