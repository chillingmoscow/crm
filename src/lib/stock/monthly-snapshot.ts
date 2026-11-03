/**
 * Сбор снимка месяца: всё, что нужно `allocateMonthlyShortage`, чтобы решить,
 * кто платит за недостачу заведения за календарный месяц.
 *
 * Расчёт здесь не повторяется. Модуль только собирает его вход из базы:
 *  - недостача проведённых актов инвентаризации (управленческая, по
 *    финализированным строкам и активным пересортам: management-totals.ts);
 *  - акты списаний, разнесённые человеком по пулам (writeoff-pools.ts);
 *  - смены месяца, которые заплатила зарплатная ведомость;
 *  - версия правил, действовавшая в этом месяце.
 *
 * Главный принцип: то, что нельзя определить, попадает в `unresolved`, а не в
 * значение по умолчанию. Склад без подразделения, архивное подразделение, смена
 * без должности, акт без зафиксированных итогов, расхождение таймзон - всё это
 * делает месяц неполным и видимым. Молчаливый общий пул или роль по умолчанию
 * переложили бы чужие деньги на всю команду.
 *
 * Исключение - проблемы данных заведения, у которых нет месяца: акт без даты и
 * акт без заведения. Их нельзя исправить «в месяце», в котором их нет, поэтому
 * они не блокируют ничей месяц, а отдаются отдельным списком `dataProblems`.
 *
 * Устройство: чистые функции берут обычные данные (их проверяет node:test без
 * базы); `buildMonthlySnapshot` читает таблицы и отдаёт данные в
 * `assembleMonthlySnapshot`. Без импортов из `@/...`: тест-раннер не резолвит
 * alias из tsconfig.
 */

import { deductionRulesSchema, type DeductionRules } from "./deduction-rules.ts";
import type { MonthlyShortageInput, PoolKind, PoolSource } from "./monthly-shortage.ts";
import type { ShiftWeight } from "./shared-shortage.ts";
import {
  writeoffPoolSources,
  writeoffSourceRef,
  type WriteoffPoolAssignment,
  type WriteoffPoolDoc,
} from "./writeoff-pools.ts";
import { stockCalendarDate, type WriteoffKind } from "./writeoffs.ts";
import {
  managementTotalsByDocument,
  type ManagementTotalsDoc,
  type ManagementTotalsItemRow,
  type ManagementTotalsResortItemRow,
  type ManagementTotalsResortRow,
} from "../inventory/management-totals.ts";
import { isInventoryResultFrozen } from "../inventory/results-snapshot.ts";
import { addDays, validDate } from "../sales/time.ts";
import type { LooseDb, LooseQuery } from "../supabase/loose.ts";

// ── Типы строк, которые читает сбор ──────────────────────────

export type ActRow = ManagementTotalsDoc & {
  processed: boolean;
  archived_at: string | null;
  /** Бизнес-дата акта Quick Resto. */
  invoice_date: string | null;
  store_id: string | null;
  venue_id: string | null;
  results_has_line_amounts: boolean | null;
};
export type ItemRow = ManagementTotalsItemRow;
export type ResortRow = ManagementTotalsResortRow;
export type ResortItemRow = ManagementTotalsResortItemRow;
export type StoreRow = {
  id: string;
  local_venue_id: string | null;
  department_id: string | null;
  department_scope: string;
};
export type DepartmentRow = {
  id: string;
  venue_id: string;
  archived_at: string | null;
};
export type WriteoffRow = {
  venue_id: string;
  external_id: number;
  business_date: string;
  missing_at: string | null;
  payload: unknown;
};
export type AssignmentRow = {
  venue_id: string;
  external_id: number;
  pool: PoolKind | "excluded";
  department_id: string | null;
  employee_id: string | null;
};
/** Начисление за рабочий день; `attendance_ids` - отметки, из которых оно получено. */
export type AccrualRow = {
  employee_id: string;
  business_date: string;
  attendance_ids: unknown;
};
export type AttendanceRow = {
  external_id: number;
  employee_id: string | null;
  business_date: string;
  shift_id: string | null;
  /** Должность сотрудника на момент расчёта дня: по ней ведомость и считала начисление. */
  role_name: string;
};
export type RoleRow = {
  id: string;
  name: string;
  department_id: string | null;
  archived_at: string | null;
};
export type ShiftRow = {
  id: string;
  role_id: string | null;
  department_id: string | null;
};
export type RuleVersionRow = {
  id: string;
  version: number;
  valid_from: string;
  config: unknown;
};

/** Привязка склада на момент расчёта: то, что заморожено в снимке. */
export type SnapshotStoreBinding = {
  storeId: string;
  scope: string;
  departmentId: string | null;
};

export type RawMonthData = {
  venueId: string;
  /** Первое число месяца, `YYYY-MM-01`. */
  month: string;
  timezone: string;
  now: Date;
  acts: ActRow[];
  items: ItemRow[];
  resorts: ResortRow[];
  resortItems: ResortItemRow[];
  stores: StoreRow[];
  departments: DepartmentRow[];
  writeoffs: WriteoffRow[];
  assignments: AssignmentRow[];
  accruals: AccrualRow[];
  attendance: AttendanceRow[];
  shifts: ShiftRow[];
  ruleVersions: RuleVersionRow[];
  roles: RoleRow[];
  /** Таймзона источника списаний заведения; null - источника нет. */
  writeoffSourceTimezone: string | null;
  /** Таймзона и начало рабочего дня зарплатной ведомости; null - настроек нет. */
  payrollTimezone: string | null;
  payrollDayStartHour: number | null;
};

/** Проблемы данных заведения, у которых нет месяца: месяц они не блокируют. */
export type SnapshotDataProblems = {
  /** Проведённые акты без бизнес-даты: ни к какому месяцу не отнести. */
  undatedActs: string[];
  /** Проведённые акты месяца без заведения (склад не привязан): ни в чьих пулах не учтены. */
  actsWithoutVenue: string[];
};

export type MonthlySnapshot = MonthlyShortageInput & {
  ruleVersionId: string;
  capturedAt: string;
  storeBindings: SnapshotStoreBinding[];
  venueId: string;
  /** Первое число месяца, `YYYY-MM-01`. */
  month: string;
  timezone: string;
  /** Начало рабочего дня ведомости: по нему смены попали в месяц. Для аудита, на расчёт не влияет. */
  payrollDayStartHour: number | null;
  dataProblems: SnapshotDataProblems;
};

// ── Месяц ────────────────────────────────────────────────────

/** Границы календарного месяца. Принимает только первое число (`YYYY-MM-01`). */
export function monthBounds(month: string) {
  if (!validDate(month) || !month.endsWith("-01"))
    throw new Error("Месяц задаётся первым числом, например 2026-10-01");
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const next = `${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-01`;
  return { first: month, next, last: addDays(next, -1) };
}

/**
 * Месяц (`YYYY-MM`) бизнес-дня акта в таймзоне заведения. Та же функция, что
 * проставляет `business_date` в зеркале актов списаний (stockCalendarDate), так
 * что границу месяца обе половины снимка видят одинаково. Дата проведения
 * акта на месяц не влияет.
 */
export function businessMonthOf(timestamp: string, timezone: string): string {
  return stockCalendarDate(timestamp, timezone).slice(0, 7);
}

// ── Правила ──────────────────────────────────────────────────

/** Версия правил, действующая на дату: самая поздняя `valid_from <= asOf`, при равенстве - старшая версия. */
export function pickRuleVersion<T extends Pick<RuleVersionRow, "version" | "valid_from">>(
  versions: T[],
  asOf: string,
): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.valid_from > asOf) continue;
    if (
      !best ||
      v.valid_from > best.valid_from ||
      (v.valid_from === best.valid_from && v.version > best.version)
    )
      best = v;
  }
  return best;
}

// ── Акты инвентаризации ──────────────────────────────────────

const inventoryRef = (id: string) => `inventory:${id}`;
const micro = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Какие акты инвентаризации входят в месяц заведения.
 *
 * Считается только проведённый акт, который ещё живёт в Quick Resto: суммы акта
 * там появляются после проведения, а у распроведённого акта (`processed = false`
 * при локальном статусе `processed`) обнуляются. Месяц определяет бизнес-день
 * акта в таймзоне заведения.
 *
 * Акт без даты и акт месяца без заведения - проблемы данных, а не неполный
 * месяц: первый не принадлежит никакому месяцу, второй - никакому заведению, и
 * если бы они блокировали расчёт, снять блок было бы нечем. Они возвращаются
 * отдельными списками.
 */
export function classifyActs(
  acts: ActRow[],
  ctx: { venueId: string; month: string; timezone: string },
): {
  counted: ActRow[];
  unresolved: string[];
  undated: string[];
  withoutVenue: string[];
} {
  const counted: ActRow[] = [];
  const unresolved: string[] = [];
  const undated: string[] = [];
  const withoutVenue: string[] = [];
  const want = ctx.month.slice(0, 7);
  for (const a of acts) {
    if (a.archived_at) continue;
    if (a.status !== "processed" || a.processed !== true) continue;
    if (!a.invoice_date) {
      // Недатированный акт чужого заведения нас не касается.
      if (a.venue_id === null || a.venue_id === ctx.venueId) undated.push(inventoryRef(a.id));
      continue;
    }
    let actMonth: string;
    try {
      actMonth = businessMonthOf(a.invoice_date, ctx.timezone);
    } catch {
      // Дата есть, но не читается: как отсутствующая, это проблема данных акта.
      if (a.venue_id === null || a.venue_id === ctx.venueId) undated.push(inventoryRef(a.id));
      continue;
    }
    if (actMonth !== want) continue;
    if (!a.venue_id) {
      withoutVenue.push(inventoryRef(a.id));
      continue;
    }
    if (a.venue_id !== ctx.venueId) continue;
    counted.push(a);
  }
  return { counted, unresolved, undated, withoutVenue };
}

/**
 * Акты, итоги которых нельзя считать зафиксированными. Деньги, которые уже
 * выплатили, не должны двигаться от поздней правки исключения или пересорта, а
 * пообещать это можно только по снимку (`finalized_*`). Поэтому акт, проведённый
 * мимо Sheerly (снимка нет), переоткрытый, либо со строкой, пересортом или
 * позицией пересорта, добавленными после снимка, не читается по живым значениям:
 * месяц с ним неполный, пока кто-то не посмотрит на акт.
 */
export function splitFrozenActs(
  counted: ActRow[],
  rows: {
    items: Array<{ document_id: string; finalized_at?: string | null }>;
    resorts: Array<{ document_id: string; finalized_at?: string | null }>;
    resortItems: Array<{ document_id: string; finalized_at?: string | null }>;
  },
): { frozen: ActRow[]; unfrozen: string[] } {
  const live = new Set<string>();
  for (const list of [rows.items, rows.resorts, rows.resortItems])
    for (const r of list) if (r.finalized_at == null) live.add(r.document_id);
  const frozen: ActRow[] = [];
  const unfrozen: string[] = [];
  for (const a of counted) {
    if (isInventoryResultFrozen(a) && !live.has(a.id)) frozen.push(a);
    else unfrozen.push(inventoryRef(a.id));
  }
  return { frozen, unfrozen };
}

/**
 * Кто платит за склад. Подходящая привязка - только `department` с живым
 * подразделением того же заведения, что и склад. Всё остальное, включая
 * «Не задано», - `unresolved`, но никогда не общий пул.
 *
 * Схема сама следит за согласованностью колонок и заведением подразделения;
 * здесь проверка повторяется намеренно: расчёт не должен зависеть от того, что
 * триггер когда-то не обошли.
 */
export function resolveStoreBinding(
  store: StoreRow | undefined,
  departments: Map<string, DepartmentRow>,
  venueId: string,
): { pool: "shared"; key: null } | { pool: "department"; key: string } | null {
  if (!store || store.local_venue_id !== venueId) return null;
  if (store.department_scope === "shared")
    return store.department_id === null ? { pool: "shared", key: null } : null;
  if (store.department_scope !== "department" || !store.department_id) return null;
  const d = departments.get(store.department_id);
  if (!d || d.archived_at) return null;
  if (d.venue_id !== store.local_venue_id || d.venue_id !== venueId) return null;
  return { pool: "department", key: store.department_id };
}

/**
 * Акты инвентаризации -> источники пулов. Сумма источника - нетто акта
 * (недостача отрицательна, излишек положителен), одно значение на акт: округляет
 * до копеек и группирует по пулам `allocateMonthlyShortage`, второй раз не округляем.
 */
export function inventoryPoolSources(input: {
  counted: ActRow[];
  totals: Map<string, { managementShortfallSum: number; managementSurplusSum: number }>;
  stores: StoreRow[];
  departments: DepartmentRow[];
  venueId: string;
}): { sources: PoolSource[]; unresolved: string[]; storeBindings: SnapshotStoreBinding[] } {
  const storeById = new Map(input.stores.map((s) => [s.id, s]));
  const deptById = new Map(input.departments.map((d) => [d.id, d]));
  const bindings = new Map<string, SnapshotStoreBinding>();
  const sources: PoolSource[] = [];
  const unresolved: string[] = [];

  for (const a of input.counted) {
    const ref = inventoryRef(a.id);
    const store = a.store_id ? storeById.get(a.store_id) : undefined;
    if (store && !bindings.has(store.id))
      bindings.set(store.id, {
        storeId: store.id,
        scope: store.department_scope,
        departmentId: store.department_id,
      });

    // Без построчных сумм или без строк недостачу не знаем: это не ноль.
    const totals = input.totals.get(a.id);
    if (a.results_has_line_amounts !== true || !totals) {
      unresolved.push(ref);
      continue;
    }
    const amount = micro(totals.managementShortfallSum + totals.managementSurplusSum);
    // Нетто ноль не меняет ни один пул: плательщик не важен, месяц не блокируем.
    if (amount === 0) continue;

    const pool = resolveStoreBinding(store, deptById, input.venueId);
    if (!pool) {
      unresolved.push(ref);
      continue;
    }
    sources.push({ pool: pool.pool, key: pool.key, amount, sourceRef: ref });
  }
  return {
    sources,
    unresolved,
    storeBindings: [...bindings.values()].sort((x, y) => x.storeId.localeCompare(y.storeId)),
  };
}

// ── Акты списаний ────────────────────────────────────────────

const WRITEOFF_KINDS = new Set<string>([
  "personal",
  "employee",
  "team",
  "masters",
  "business",
  "unknown",
]);

function writeoffDoc(row: WriteoffRow): WriteoffPoolDoc | null {
  const p = row.payload as {
    processed?: unknown;
    kind?: unknown;
    lines?: unknown;
  } | null;
  if (
    !p ||
    typeof p !== "object" ||
    typeof p.processed !== "boolean" ||
    typeof p.kind !== "string" ||
    !WRITEOFF_KINDS.has(p.kind) ||
    !Array.isArray(p.lines)
  )
    return null;
  return {
    venue_id: row.venue_id,
    external_id: row.external_id,
    missing_at: row.missing_at,
    payload: {
      processed: p.processed,
      kind: p.kind as WriteoffKind,
      lines: (p.lines as Array<{ id?: unknown; amount?: unknown }>).map((l) => ({
        id: Number(l?.id),
        amount: typeof l?.amount === "number" ? l.amount : null,
      })),
    },
  };
}

/**
 * Акты списаний месяца -> источники. Месяц задаёт `business_date` зеркала.
 * Пометка на подразделение, которого уже нет, которое архивировано или чужого
 * заведения, считается отсутствием пометки: акт уходит в `unresolved`, а не в
 * пул, который никто не выбирал.
 */
export function writeoffSourcesForMonth(input: {
  docs: WriteoffRow[];
  assignments: AssignmentRow[];
  departments: DepartmentRow[];
  venueId: string;
  month: string;
}): { sources: PoolSource[]; unresolved: string[] } {
  const want = input.month.slice(0, 7);
  const deptById = new Map(input.departments.map((d) => [d.id, d]));
  const docs: WriteoffPoolDoc[] = [];
  const unresolved: string[] = [];
  for (const row of input.docs) {
    if (row.venue_id !== input.venueId || row.business_date.slice(0, 7) !== want) continue;
    const doc = writeoffDoc(row);
    if (!doc) {
      // Битое содержимое важно, только если акт мог бы считаться.
      if (!row.missing_at) unresolved.push(writeoffSourceRef(row.venue_id, row.external_id));
      continue;
    }
    docs.push(doc);
  }
  const marks: WriteoffPoolAssignment[] = [];
  for (const a of input.assignments) {
    if (a.venue_id !== input.venueId) continue;
    if (a.pool === "department") {
      const d = a.department_id ? deptById.get(a.department_id) : undefined;
      if (!d || d.archived_at || d.venue_id !== input.venueId) continue;
    }
    marks.push({
      venue_id: a.venue_id,
      external_id: Number(a.external_id),
      pool: a.pool,
      key: a.pool === "department" ? a.department_id : a.pool === "personal" ? a.employee_id : null,
    });
  }
  const r = writeoffPoolSources(docs, marks);
  return { sources: r.sources, unresolved: [...unresolved, ...r.unresolved] };
}

// ── Смены ────────────────────────────────────────────────────

const shiftDayRef = (employeeId: string, date: string) => `shift:${employeeId}:${date}`;

/**
 * Должность и подразделение отметки. Цепочка, и ошибка только в её конце:
 *  1. смена из графика (`shift_id`): её должность и подразделение;
 *  2. иначе (отметка Quick Resto вне графика, `unplanned`, или у смены нет
 *     должности) - `role_name` отметки, т.е. должность, по которой ведомость
 *     и считала начисление, и подразделение этой должности. Название сопоставляется
 *     с действующей должностью заведения точно так же, как это делает сама
 *     ведомость (`payroll_employee_role_guard`, миграция 246): точное имя,
 *     не архивная, ровно одна. Названия должностей уникальностью не защищены
 *     (уникален только код), поэтому ноль совпадений и больше одного - `null`.
 */
function resolveAttendanceRole(
  att: AttendanceRow,
  shiftById: Map<string, ShiftRow>,
  roles: RoleRow[],
): { roleId: string; departmentId: string | null } | null {
  const sh = att.shift_id ? shiftById.get(att.shift_id) : undefined;
  if (sh?.role_id) return { roleId: sh.role_id, departmentId: sh.department_id };
  if (!att.role_name || att.role_name.trim() === "") return null;
  const named = roles.filter((r) => !r.archived_at && r.name === att.role_name);
  if (named.length !== 1) return null;
  return { roleId: named[0].id, departmentId: sh?.department_id ?? named[0].department_id };
}

/**
 * Состав смен месяца: ровно то, что заплатила зарплатная ведомость.
 *
 * Единица - день работы сотрудника, по которому есть начисление, в снимке
 * которого перечислены отметки прихода (`calculation_snapshot.attendance_ids`).
 * Само наличие строки начисления смену не доказывает: в `payroll_accruals` лежат
 * и начисления только по окладу или корректировке, без единой отметки. Они смен
 * не дают; отметка без начисления (игнорируемая, без ставки за смену) тоже. Так
 * знаменатель распределения совпадает с тем, за что фактически заплатили.
 *
 * Должность и подразделение - см. resolveAttendanceRole. День, где их не
 * определить, где отметка из начисления не найдена или принадлежит другому
 * сотруднику, или где две разные пары (должность, подразделение), уходит в
 * `unresolved`; угадывать нельзя. Идентификатор сотрудника - `payroll_employees.id`,
 * как и у личных пометок списаний.
 */
export function buildShiftWeights(input: {
  accruals: AccrualRow[];
  attendance: AttendanceRow[];
  shifts: ShiftRow[];
  roles: RoleRow[];
}): { weights: ShiftWeight[]; unresolved: string[] } {
  const attendanceByExternal = new Map(input.attendance.map((a) => [Number(a.external_id), a]));
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const counts = new Map<string, ShiftWeight>();
  const unresolved: string[] = [];

  for (const acc of input.accruals) {
    const ids = Array.isArray(acc.attendance_ids) ? acc.attendance_ids.map(Number) : [];
    if (ids.length === 0) continue;

    let ok = true;
    const combos = new Map<string, { roleId: string; departmentId: string | null }>();
    for (const id of ids) {
      const att = attendanceByExternal.get(id);
      const place = att && att.employee_id === acc.employee_id
        ? resolveAttendanceRole(att, shiftById, input.roles)
        : null;
      if (!place) {
        ok = false;
        break;
      }
      combos.set(`${place.roleId}\u0000${place.departmentId ?? ""}`, place);
    }
    if (!ok || combos.size !== 1) {
      unresolved.push(shiftDayRef(acc.employee_id, acc.business_date));
      continue;
    }
    const [{ roleId, departmentId }] = [...combos.values()];
    const key = `${acc.employee_id}\u0000${roleId}\u0000${departmentId ?? ""}`;
    const w = counts.get(key) ?? { employeeId: acc.employee_id, roleId, departmentId, shifts: 0 };
    w.shifts += 1;
    counts.set(key, w);
  }

  const weights = [...counts.values()].sort(
    (a, b) =>
      a.employeeId.localeCompare(b.employeeId) ||
      a.roleId.localeCompare(b.roleId) ||
      (a.departmentId ?? "").localeCompare(b.departmentId ?? ""),
  );
  return { weights, unresolved };
}

// ── Таймзоны ─────────────────────────────────────────────────

function offsetMinutes(at: Date, timezone: string): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(part ?? "");
  if (!m) throw new Error("offset");
  return m[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Одна и та же граница суток у двух таймзон в этом месяце: совпадают названия
 * либо смещения от UTC во все выбранные моменты месяца (псевдонимы одной зоны).
 */
export function sameZone(a: string, b: string, month: string): boolean {
  if (a === b) return true;
  try {
    const { first, next } = monthBounds(month);
    const end = Date.parse(`${addDays(next, 1)}T00:00:00Z`);
    for (let t = Date.parse(`${addDays(first, -1)}T00:00:00Z`); t <= end; t += 12 * 3600_000) {
      if (offsetMinutes(new Date(t), a) !== offsetMinutes(new Date(t), b)) return false;
    }
    return true;
  } catch {
    // Неизвестное название зоны сравнить нельзя: считаем расхождением.
    return false;
  }
}

/**
 * Граница месяца у актов считается в таймзоне заведения, а у списаний и смен
 * уже посчитана по таймзоне их источников. Если зоны расходятся, акт и смены
 * режутся по разным границам, и удержание ляжет на другой состав смен, чем в
 * ведомости: расхождение блокирует расчёт и называет обе зоны.
 * Начало рабочего дня ведомости (`day_start_hour`) расхождением не считается:
 * оно часть правила, по которому смена получает дату, и записывается в снимок.
 */
export function timezoneDisagreements(input: {
  venue: string;
  month: string;
  others: Array<{ label: string; timezone: string | null }>;
}): string[] {
  return input.others
    .filter((o) => o.timezone !== null && !sameZone(input.venue, o.timezone, input.month))
    .map((o) => `timezone:venue=${input.venue};${o.label}=${o.timezone}`);
}

// ── Сборка ───────────────────────────────────────────────────

/** Чистая сборка снимка из прочитанных строк. Бросает, если на месяц нет ни одной версии правил. */
export function assembleMonthlySnapshot(raw: RawMonthData): MonthlySnapshot {
  const { last } = monthBounds(raw.month);

  // Правила - на конец месяца, но не из будущего: версия с датой впереди ещё не действует.
  const today = stockCalendarDate(raw.now.toISOString(), raw.timezone);
  const rule = pickRuleVersion(raw.ruleVersions, last < today ? last : today);
  if (!rule) throw new Error("Нет правил удержаний, действующих в этом месяце");
  const parsed = deductionRulesSchema.safeParse(rule.config);
  if (!parsed.success)
    throw new Error(`Правила удержаний (версия ${rule.version}) не прошли проверку`);
  const config: DeductionRules = parsed.data;

  const classified = classifyActs(raw.acts, {
    venueId: raw.venueId,
    month: raw.month,
    timezone: raw.timezone,
  });
  const countedIds = new Set(classified.counted.map((a) => a.id));
  const rowsOf = <T extends { document_id: string }>(rows: T[]) =>
    rows.filter((r) => countedIds.has(r.document_id));
  // Акт без зафиксированных итогов по живым значениям не читаем (см. splitFrozenActs).
  const { frozen: counted, unfrozen } = splitFrozenActs(classified.counted, {
    items: rowsOf(raw.items),
    resorts: rowsOf(raw.resorts),
    resortItems: rowsOf(raw.resortItems),
  });
  const frozenIds = new Set(counted.map((a) => a.id));
  const totals = managementTotalsByDocument({
    docs: counted,
    items: raw.items.filter((i) => frozenIds.has(i.document_id)),
    resorts: raw.resorts.filter((r) => frozenIds.has(r.document_id)),
    resortItems: raw.resortItems.filter((r) => frozenIds.has(r.document_id)),
  });
  const inventory = inventoryPoolSources({
    counted,
    totals,
    stores: raw.stores,
    departments: raw.departments,
    venueId: raw.venueId,
  });
  const writeoffs = writeoffSourcesForMonth({
    docs: raw.writeoffs,
    assignments: raw.assignments,
    departments: raw.departments,
    venueId: raw.venueId,
    month: raw.month,
  });
  const shifts = buildShiftWeights({
    accruals: raw.accruals,
    attendance: raw.attendance,
    shifts: raw.shifts,
    roles: raw.roles,
  });
  const timezones = timezoneDisagreements({
    venue: raw.timezone,
    month: raw.month,
    others: [
      { label: "writeoffs", timezone: raw.writeoffSourceTimezone },
      { label: "payroll", timezone: raw.payrollTimezone },
    ],
  });

  return {
    sources: [...inventory.sources, ...writeoffs.sources].sort((a, b) =>
      a.sourceRef.localeCompare(b.sourceRef),
    ),
    config,
    weights: shifts.weights,
    unresolved: [
      ...new Set([
        ...classified.unresolved,
        ...unfrozen,
        ...timezones,
        ...inventory.unresolved,
        ...writeoffs.unresolved,
        ...shifts.unresolved,
      ]),
    ].sort(),
    ruleVersionId: rule.id,
    capturedAt: raw.now.toISOString(),
    storeBindings: inventory.storeBindings,
    venueId: raw.venueId,
    month: raw.month,
    timezone: raw.timezone,
    payrollDayStartHour: raw.payrollDayStartHour,
    dataProblems: {
      undatedActs: [...new Set(classified.undated)].sort(),
      actsWithoutVenue: [...new Set(classified.withoutVenue)].sort(),
    },
  };
}

// ── Чтение из базы ───────────────────────────────────────────

const PAGE = 1000;
const HARD_CAP = 200_000;
const CHUNK = 100;

async function readAll<T>(
  table: string,
  make: () => LooseQuery<T[]>,
  orderBy: string,
  ascending = true,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await make()
      .order(orderBy, { ascending })
      .range(from, from + PAGE - 1);
    // Ошибка страницы - не конец данных: пустой ответ превратил бы месяц в нулевой.
    if (error) throw new Error(`Не удалось прочитать ${table}: ${error.message}`);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < PAGE || out.length >= HARD_CAP) break;
    from += chunk.length;
  }
  return out;
}

async function readByIds<T>(
  table: string,
  ids: string[],
  make: (chunk: string[]) => LooseQuery<T[]>,
  orderBy = "id",
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    out.push(...(await readAll<T>(table, () => make(chunk), orderBy)));
  }
  return out;
}

const ACT_COLUMNS =
  "id, status, processed, archived_at, invoice_date, store_id, venue_id, results_has_line_amounts, results_finalized_at, results_reopened_at, results_snapshot_at";

/**
 * Снимок месяца заведения. Только чтение: никаких записей и расчёта денег.
 * Клиент может быть и пользовательским (RLS), и административным; каждый запрос
 * ограничен аккаунтом и заведением явно, а не RLS.
 */
export async function buildMonthlySnapshot(
  db: LooseDb,
  opts: { accountId: string; venueId: string; month: string; now?: Date },
): Promise<MonthlySnapshot> {
  const { accountId, venueId } = opts;
  const now = opts.now ?? new Date();
  const { first, next } = monthBounds(opts.month);

  const venue = await db
    .from<{ id: string; timezone: string | null }>("venues")
    .select("id, timezone")
    .eq("id", venueId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (venue.error) throw new Error(`Не удалось прочитать заведение: ${venue.error.message}`);
  if (!venue.data) throw new Error("Заведение не найдено в этом аккаунте");
  // Таймзона заведения: то же поле, в котором задаются даты начала правил удержаний.
  const timezone = venue.data.timezone;
  if (!timezone) throw new Error("У заведения не задана таймзона");

  // Окно с запасом в двое суток: точную границу месяца в таймзоне заведения
  // проверяет classifyActs, а SQL лишь не отдаёт заведомо лишнее.
  const from = `${addDays(first, -2)}T00:00:00Z`;
  const to = `${addDays(next, 2)}T00:00:00Z`;
  const inventoryActs = () =>
    db
      .from<ActRow[]>("documents")
      .select(ACT_COLUMNS)
      .eq("account_id", accountId)
      .eq("document_kind", "inventory")
      .eq("status", "processed")
      .eq("processed", true)
      .is("archived_at", null);

  const [ruleVersions, venueActs, orphanActs, undatedActs] = await Promise.all([
    readAll<RuleVersionRow>(
      "stock_deduction_rules",
      () =>
        db
          .from<RuleVersionRow[]>("stock_deduction_rules")
          .select("id, version, valid_from, config")
          .eq("account_id", accountId)
          .eq("venue_id", venueId),
      "version",
      false,
    ),
    readAll<ActRow>(
      "documents",
      () => inventoryActs().eq("venue_id", venueId).gte("invoice_date", from).lt("invoice_date", to),
      "id",
    ),
    // Акт без заведения (склад не привязан) не принадлежит ни одному заведению
    // и ни в чьём месяце не виден, пока его не искать: ищем и блокируем расчёт.
    readAll<ActRow>(
      "documents",
      () => inventoryActs().is("venue_id", null).gte("invoice_date", from).lt("invoice_date", to),
      "id",
    ),
    readAll<ActRow>(
      "documents",
      () => inventoryActs().is("invoice_date", null).or(`venue_id.eq.${venueId},venue_id.is.null`),
      "id",
    ),
  ]);
  const acts = [...new Map([...venueActs, ...orphanActs, ...undatedActs].map((a) => [a.id, a])).values()];

  const { counted } = classifyActs(acts, { venueId, month: first, timezone });
  const countedIds = counted.map((a) => a.id);

  const [items, resorts, resortItems, stores] = await Promise.all([
    readByIds<ItemRow>("document_items", countedIds, (ids) =>
      db
        .from<ItemRow[]>("document_items")
        .select(
          "document_id, id, difference_amount, difference_sum, excluded_from_totals, finalized_at, finalized_difference_amount, finalized_difference_sum, finalized_excluded_from_totals",
        )
        .eq("account_id", accountId)
        .in("document_id", ids),
    ),
    // Без фильтра по статусу: активность пересорта зафиксированного акта берётся
    // из снимка (finalized_status), а не из живого статуса.
    readByIds<ResortRow>("inventory_result_resorts", countedIds, (ids) =>
      db
        .from<ResortRow[]>("inventory_result_resorts")
        .select(
          "id, document_id, status, offset_amount, residual_shortfall_sum, residual_surplus_sum, cost_adjustment_sum, finalized_at, finalized_status, finalized_offset_amount, finalized_residual_shortfall_sum, finalized_residual_surplus_sum, finalized_cost_adjustment_sum",
        )
        .eq("account_id", accountId)
        .in("document_id", ids),
    ),
    readByIds<ResortItemRow>("inventory_result_resort_items", countedIds, (ids) =>
      db
        .from<ResortItemRow[]>("inventory_result_resort_items")
        .select(
          "id, document_id, resort_id, document_item_id, role, source_difference_amount, source_difference_sum, offset_amount, remaining_difference_amount, remaining_difference_sum, finalized_at, finalized_source_difference_amount, finalized_source_difference_sum, finalized_offset_amount, finalized_remaining_difference_amount, finalized_remaining_difference_sum",
        )
        .eq("account_id", accountId)
        .in("document_id", ids),
    ),
    readByIds<StoreRow>(
      "stores",
      counted.map((a) => a.store_id).filter((id): id is string => !!id),
      (ids) =>
        db
          .from<StoreRow[]>("stores")
          .select("id, local_venue_id, department_id, department_scope")
          .eq("account_id", accountId)
          .in("id", ids),
    ),
  ]);

  const [writeoffs, assignments] = await Promise.all([
    readAll<WriteoffRow & { id: string }>(
      "stock_writeoff_documents",
      () =>
        db
          .from<Array<WriteoffRow & { id: string }>>("stock_writeoff_documents")
          .select("id, venue_id, external_id, business_date, missing_at, payload")
          .eq("account_id", accountId)
          .eq("venue_id", venueId)
          .gte("business_date", first)
          .lt("business_date", next),
      "id",
    ),
    readAll<AssignmentRow & { id: string }>(
      "writeoff_pool_assignments",
      () =>
        db
          .from<Array<AssignmentRow & { id: string }>>("writeoff_pool_assignments")
          .select("id, venue_id, external_id, pool, department_id, employee_id")
          .eq("account_id", accountId)
          .eq("venue_id", venueId),
      "id",
    ),
  ]);

  const departmentIds = [
    ...stores.map((s) => s.department_id),
    ...assignments.map((a) => a.department_id),
  ].filter((id): id is string => !!id);
  const departments = await readByIds<DepartmentRow>("departments", departmentIds, (ids) =>
    db
      .from<DepartmentRow[]>("departments")
      .select("id, venue_id, archived_at")
      .in("id", ids),
  );

  const [accruals, attendance] = await Promise.all([
    readAll<AccrualRow & { id: string }>(
      "payroll_accruals",
      () =>
        db
          .from<Array<AccrualRow & { id: string }>>("payroll_accruals")
          // Только перечень отметок из снимка начисления, а не весь снимок.
          .select("id, employee_id, business_date, attendance_ids:calculation_snapshot->attendance_ids")
          .eq("account_id", accountId)
          .eq("venue_id", venueId)
          .gte("business_date", first)
          .lt("business_date", next),
      "id",
    ),
    readAll<AttendanceRow & { id: string }>(
      "payroll_attendance",
      () =>
        db
          .from<Array<AttendanceRow & { id: string }>>("payroll_attendance")
          .select("id, external_id, employee_id, business_date, shift_id, role_name")
          .eq("account_id", accountId)
          .eq("venue_id", venueId)
          .gte("business_date", first)
          .lt("business_date", next),
      "id",
    ),
  ]);
  const [writeoffSource, salesSettings, roles] = await Promise.all([
    db
      .from<{ config: { timezone?: string } | null }>("stock_writeoff_sources")
      .select("config")
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
    db
      .from<{ timezone: string | null; day_start_hour: number | null }>("sales_settings")
      .select("timezone, day_start_hour")
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
    readAll<RoleRow>(
      "roles",
      () =>
        db
          .from<RoleRow[]>("roles")
          .select("id, name, department_id, archived_at")
          .eq("venue_id", venueId),
      "id",
    ),
  ]);
  if (writeoffSource.error)
    throw new Error(`Не удалось прочитать источник списаний: ${writeoffSource.error.message}`);
  if (salesSettings.error)
    throw new Error(`Не удалось прочитать настройки смен: ${salesSettings.error.message}`);

  const shifts = await readByIds<ShiftRow>(
    "schedule_shifts",
    attendance.map((a) => a.shift_id).filter((id): id is string => !!id),
    (ids) =>
      db
        .from<ShiftRow[]>("schedule_shifts")
        .select("id, role_id, department_id")
        .eq("venue_id", venueId)
        .in("id", ids),
  );

  return assembleMonthlySnapshot({
    venueId,
    month: first,
    timezone,
    now,
    acts,
    items,
    resorts,
    resortItems,
    stores,
    departments,
    writeoffs,
    assignments,
    accruals,
    attendance,
    shifts,
    ruleVersions,
    roles,
    writeoffSourceTimezone: writeoffSource.data?.config?.timezone ?? null,
    payrollTimezone: salesSettings.data?.timezone ?? null,
    payrollDayStartHour: salesSettings.data?.day_start_hour ?? null,
  });
}
