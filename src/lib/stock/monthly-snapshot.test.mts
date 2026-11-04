import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleMonthlySnapshot,
  buildMonthlySnapshot,
  businessMonthOf,
  monthBounds,
  inventoryPoolSources,
  pickRuleVersion,
  readAll,
  readByIds,
  sameZone,
  type ActRow,
  type AssignmentRow,
  type AttendanceRow,
  type DepartmentRow,
  type ItemRow,
  type AccrualRow,
  type RawMonthData,
  type ResortItemRow,
  type ResortRow,
  type RoleRow,
  type RuleVersionRow,
  type ShiftRow,
  type StoreRow,
  type WriteoffRow,
} from "./monthly-snapshot.ts";
import { allocateMonthlyShortage } from "./monthly-shortage.ts";
import type { DeductionRules } from "./deduction-rules.ts";
import { asLooseDb } from "../supabase/loose.ts";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENUE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_VENUE = "bbbbbbbb-bbbb-4bbb-8bbb-cccccccccccc";
const DEPT_HOOKAH = "dddddddd-dddd-4ddd-8ddd-000000000001";
const DEPT_BAR = "dddddddd-dddd-4ddd-8ddd-000000000002";
const STORE_MAIN = "55555555-5555-4555-8555-000000000001";
const STORE_HOOKAH = "55555555-5555-4555-8555-000000000002";
const ROLE_BAR = "11111111-1111-4111-8111-000000000001";
const ROLE_HOOKAH = "11111111-1111-4111-8111-000000000002";
const EMP_A = "eeeeeeee-eeee-4eee-8eee-00000000000a";
const EMP_B = "eeeeeeee-eeee-4eee-8eee-00000000000b";
const RULE_ID = "99999999-9999-4999-8999-000000000001";
const NOW = new Date("2026-11-03T09:00:00Z");

const rules = (over: Partial<DeductionRules> = {}): DeductionRules => ({
  enabled: true,
  companyAllowance: 0,
  multiplier: 1,
  ingredientTolerance: 0,
  distribution: "shifts",
  split: "once",
  inventoryExclusions: [],
  roleSpecificCategories: [],
  writeoffReasons: [],
  excludedRoleIds: [],
  groups: [],
  ...over,
});
const ruleVersion = (over: Partial<RuleVersionRow> = {}): RuleVersionRow => ({
  id: RULE_ID,
  version: 1,
  valid_from: "2026-01-01",
  config: rules(),
  ...over,
});

const act = (id: string, over: Partial<ActRow> = {}): ActRow => ({
  id,
  status: "processed",
  processed: true,
  archived_at: null,
  invoice_date: "2026-10-15T12:00:00+00:00",
  store_id: STORE_MAIN,
  venue_id: VENUE,
  results_has_line_amounts: true,
  results_finalized_at: "2026-10-16T10:00:00+00:00",
  results_reopened_at: null,
  results_snapshot_at: "2026-10-16T10:00:00+00:00",
  ...over,
});
/** Строка акта со снимком: живые значения намеренно отличаются от замороженных, где это нужно. */
const item = (
  docId: string,
  id: string,
  sum: number,
  over: Partial<ItemRow> = {},
): ItemRow => ({
  document_id: docId,
  id,
  difference_amount: -1,
  difference_sum: sum,
  excluded_from_totals: false,
  finalized_at: "2026-10-16T10:00:00+00:00",
  finalized_difference_amount: -1,
  finalized_difference_sum: sum,
  finalized_excluded_from_totals: false,
  ...over,
});
const store = (id: string, over: Partial<StoreRow> = {}): StoreRow => ({
  id,
  local_venue_id: VENUE,
  department_id: null,
  department_scope: "shared",
  ...over,
});
const dept = (id: string, over: Partial<DepartmentRow> = {}): DepartmentRow => ({
  id,
  venue_id: VENUE,
  archived_at: null,
  ...over,
});

let ext = 1000;
const shift = (id: string, over: Partial<ShiftRow> = {}): ShiftRow => ({
  id,
  role_id: ROLE_BAR,
  department_id: DEPT_BAR,
  ...over,
});
/** День работы: отметка + начисление, в снимке которого эта отметка перечислена. */
const day = (
  employee: string,
  date: string,
  shiftId: string | null,
  over: { attendanceIds?: number[] | null; kind?: string | null } = {},
): { attendance: AttendanceRow; accrual: AccrualRow } => {
  const external_id = ext++;
  return {
    attendance: { external_id, employee_id: employee, business_date: date, shift_id: shiftId, role_name: "" },
    accrual: {
      employee_id: employee,
      business_date: date,
      attendance_ids: over.attendanceIds === undefined ? [external_id] : over.attendanceIds,
      snapshot_kind: over.kind ?? null,
    },
  };
};

const raw = (over: Partial<RawMonthData> = {}): RawMonthData => ({
  venueId: VENUE,
  month: "2026-10-01",
  timezone: "Europe/Moscow",
  now: NOW,
  acts: [],
  items: [],
  resorts: [],
  resortItems: [],
  stores: [store(STORE_MAIN), store(STORE_HOOKAH, { department_scope: "department", department_id: DEPT_HOOKAH })],
  departments: [dept(DEPT_HOOKAH), dept(DEPT_BAR)],
  writeoffs: [],
  assignments: [],
  accruals: [],
  attendance: [],
  shifts: [],
  ruleVersions: [ruleVersion()],
  roles: [],
  writeoffSourceTimezone: null,
  payrollTimezone: null,
  payrollDayStartHour: null,
  ...over,
});
const role = (id: string, name: string, over: Partial<RoleRow> = {}): RoleRow => ({
  id,
  name,
  department_id: null,
  archived_at: null,
  ...over,
});

// ── месяц ────────────────────────────────────────────────────

test("месяц задаёт бизнес-день акта в таймзоне заведения, а не дата проведения", () => {
  // Акт от 31 октября, проведён и зафиксирован 1 ноября: октябрь.
  const a = act("doc-1", {
    invoice_date: "2026-10-31T12:00:00+00:00",
    results_finalized_at: "2026-11-01T09:00:00+00:00",
    results_snapshot_at: "2026-11-01T09:00:00+00:00",
  });
  const oct = assembleMonthlySnapshot(raw({ acts: [a], items: [item("doc-1", "i1", -300)] }));
  assert.deepEqual(oct.sources.map((s) => s.sourceRef), ["inventory:doc-1"]);
  const nov = assembleMonthlySnapshot(
    raw({ month: "2026-11-01", acts: [a], items: [item("doc-1", "i1", -300)] }),
  );
  assert.deepEqual(nov.sources, []);
});

test("граница месяца считается в таймзоне заведения, а не по UTC", () => {
  // 21:30 UTC 31 октября = 00:30 1 ноября по Москве: это уже ноябрь.
  assert.equal(businessMonthOf("2026-10-31T21:30:00+00:00", "Europe/Moscow"), "2026-11");
  assert.equal(businessMonthOf("2026-10-31T21:30:00+00:00", "UTC"), "2026-10");
  // 20:59 UTC = 23:59 по Москве: ещё октябрь.
  assert.equal(businessMonthOf("2026-10-31T20:59:59+00:00", "Europe/Moscow"), "2026-10");
});

test("monthBounds принимает только первое число месяца", () => {
  assert.deepEqual(monthBounds("2026-02-01"), {
    first: "2026-02-01",
    next: "2026-03-01",
    last: "2026-02-28",
  });
  assert.throws(() => monthBounds("2026-02-15"));
  assert.throws(() => monthBounds("2026-13-01"));
  assert.throws(() => monthBounds("октябрь"));
});

// ── суммы акта: финализированные строки и активные пересорты ─

test("исключённая позиция не входит в недостачу", () => {
  const a = act("doc-1");
  const r = assembleMonthlySnapshot(
    raw({
      acts: [a],
      items: [
        item("doc-1", "i1", -300),
        item("doc-1", "i2", -700, {
          finalized_excluded_from_totals: true,
          excluded_from_totals: true,
        }),
      ],
    }),
  );
  assert.deepEqual(r.sources.map((s) => s.amount), [-300]);
});

test("сумма берётся из финализированных строк: правка живых значений её не двигает", () => {
  const a = act("doc-1");
  const r = assembleMonthlySnapshot(
    raw({
      acts: [a],
      items: [
        // После утверждения живую строку исключили и пересчитали: деньги не должны сдвинуться.
        item("doc-1", "i1", -50, {
          finalized_difference_sum: -300,
          excluded_from_totals: true,
        }),
      ],
    }),
  );
  assert.deepEqual(r.sources.map((s) => s.amount), [-300]);
});

test("активный пересорт уменьшает недостачу внутри акта", () => {
  const resort: ResortRow = {
    id: "r1",
    document_id: "doc-1",
    status: "active",
    offset_amount: 1,
    residual_shortfall_sum: 0,
    residual_surplus_sum: 0,
    cost_adjustment_sum: 0,
    finalized_at: "2026-10-16T10:00:00+00:00",
    finalized_status: "active",
    finalized_offset_amount: 1,
    finalized_residual_shortfall_sum: 0,
    finalized_residual_surplus_sum: 0,
    finalized_cost_adjustment_sum: 0,
  };
  // Пересорт покрыл 300 из 400 недостачи: остаётся 100.
  const resortItem: ResortItemRow = {
    document_id: "doc-1",
    resort_id: "r1",
    document_item_id: "i1",
    role: "shortage",
    source_difference_amount: -1,
    source_difference_sum: -400,
    offset_amount: 1,
    remaining_difference_amount: 0,
    remaining_difference_sum: -100,
    finalized_at: "2026-10-16T10:00:00+00:00",
    finalized_source_difference_amount: -1,
    finalized_source_difference_sum: -400,
    finalized_offset_amount: 1,
    finalized_remaining_difference_amount: 0,
    finalized_remaining_difference_sum: -100,
  };
  const base = { acts: [act("doc-1")], items: [item("doc-1", "i1", -400)], resortItems: [resortItem] };
  const active = assembleMonthlySnapshot(raw({ ...base, resorts: [resort] }));
  assert.deepEqual(active.sources.map((s) => s.amount), [-100]);
  // Пересорт, аннулированный до фиксации, не действует: недостача целиком.
  const voided = assembleMonthlySnapshot(
    raw({ ...base, resorts: [{ ...resort, status: "voided", finalized_status: "voided" }] }),
  );
  assert.deepEqual(voided.sources.map((s) => s.amount), [-400]);
  // Аннулирован ПОСЛЕ фиксации (живой статус voided, в снимке active): итог утверждён, не двигается.
  const voidedLater = assembleMonthlySnapshot(
    raw({ ...base, resorts: [{ ...resort, status: "voided" }] }),
  );
  assert.deepEqual(voidedLater.sources.map((s) => s.amount), [-100]);
});

test("нетто акта: излишек и недостача внутри акта складываются", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("doc-1")],
      items: [item("doc-1", "i1", -300), item("doc-1", "i2", 120)],
    }),
  );
  assert.deepEqual(r.sources.map((s) => s.amount), [-180]);
});

// ── какие акты считаются ─────────────────────────────────────

test("не проведённый, архивный и распроведённый в QR акты не считаются", () => {
  const acts = [
    act("draft", { status: "ready_for_review", processed: false }),
    act("archived", { archived_at: "2026-10-20T00:00:00+00:00" }),
    // Проведён у нас, но в Quick Resto распроведён: sums в QR уже нули.
    act("unprocessed-in-qr", { processed: false }),
  ];
  const r = assembleMonthlySnapshot(
    raw({ acts, items: acts.map((a) => item(a.id, `i-${a.id}`, -500)) }),
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, []);
});

test("акт без даты - проблема данных заведения, а не блокировка месяцев", () => {
  const acts = [
    act("no-date", { invoice_date: null }),
    act("no-date-no-venue", { invoice_date: null, venue_id: null }),
    // Недатированный акт другого заведения заведение не касается.
    act("foreign-no-date", { invoice_date: null, venue_id: OTHER_VENUE }),
    // Не проведённый акт без даты - просто черновик.
    act("draft-no-date", { invoice_date: null, status: "assigned", processed: false }),
  ];
  for (const month of ["2026-10-01", "2026-11-01"]) {
    const r = assembleMonthlySnapshot(raw({ month, acts }));
    assert.deepEqual(r.unresolved, [], month);
    assert.deepEqual(r.dataProblems.undatedActs, ["inventory:no-date", "inventory:no-date-no-venue"], month);
  }
});

test("проведённый датированный акт месяца без заведения блокирует месяц, а не уходит в проблемы данных", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [
        act("no-venue", { venue_id: null }),
        // Другой месяц: в этом списке его нет.
        act("no-venue-nov", { venue_id: null, invoice_date: "2026-11-15T12:00:00+00:00" }),
      ],
      items: [item("no-venue", "i", -1)],
    }),
  );
  // Молчаливый ноль на месте недостачи был бы потерей денег: месяц неполный.
  assert.deepEqual(r.unresolved, ["inventory:no-venue"]);
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.dataProblems.undatedActs, []);
  assert.equal(allocateMonthlyShortage(r).state, "incomplete");
});

test("акт без строк и акт без построчных сумм дают unresolved, а не ноль", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("empty"), act("blocked", { results_has_line_amounts: false })],
      items: [item("blocked", "i", 0)],
    }),
  );
  assert.deepEqual(r.unresolved, ["inventory:blocked", "inventory:empty"]);
});

test("акт с нулевым итогом ничего не меняет и не блокирует месяц", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("zero", { store_id: "no-such-store" })],
      items: [item("zero", "i1", -100), item("zero", "i2", 100)],
    }),
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, []);
});

// ── привязка склада ──────────────────────────────────────────

test("склад без подразделения даёт unresolved, а не общий пул", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("doc-1", { store_id: "unset" })],
      items: [item("doc-1", "i1", -500)],
      stores: [store("unset", { department_scope: "unset", department_id: null })],
    }),
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, ["inventory:doc-1"]);
});

test("явно общий склад платит общий пул, склад подразделения - подразделение", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("shared"), act("hookah", { store_id: STORE_HOOKAH })],
      items: [item("shared", "i1", -500), item("hookah", "i2", -200)],
    }),
  );
  assert.deepEqual(
    r.sources.map((s) => [s.sourceRef, s.pool, s.key, s.amount]),
    [
      ["inventory:hookah", "department", DEPT_HOOKAH, -200],
      ["inventory:shared", "shared", null, -500],
    ],
  );
});

test("архивное подразделение склада даёт unresolved, а не общий пул", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("hookah", { store_id: STORE_HOOKAH })],
      items: [item("hookah", "i", -200)],
      departments: [dept(DEPT_HOOKAH, { archived_at: "2026-10-20T00:00:00+00:00" })],
    }),
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, ["inventory:hookah"]);
});

test("подразделение чужого заведения или пропавшее даёт unresolved", () => {
  const base = {
    acts: [act("hookah", { store_id: STORE_HOOKAH })],
    items: [item("hookah", "i", -200)],
  };
  const foreign = assembleMonthlySnapshot(
    raw({ ...base, departments: [dept(DEPT_HOOKAH, { venue_id: OTHER_VENUE })] }),
  );
  assert.deepEqual(foreign.unresolved, ["inventory:hookah"]);
  const missing = assembleMonthlySnapshot(raw({ ...base, departments: [] }));
  assert.deepEqual(missing.unresolved, ["inventory:hookah"]);
  // Склад другого заведения, чем у акта: тоже не угадываем.
  const storeElsewhere = assembleMonthlySnapshot(
    raw({ ...base, stores: [store(STORE_HOOKAH, { local_venue_id: OTHER_VENUE, department_scope: "department", department_id: DEPT_HOOKAH })] }),
  );
  assert.deepEqual(storeElsewhere.unresolved, ["inventory:hookah"]);
  // Общий склад, привязанный к другому заведению, не платит за это.
  const sharedElsewhere = assembleMonthlySnapshot(
    raw({ ...base, stores: [store(STORE_HOOKAH, { local_venue_id: OTHER_VENUE })] }),
  );
  assert.deepEqual(sharedElsewhere.unresolved, ["inventory:hookah"]);
  // Склад не найден вовсе или акт без склада.
  const noStore = assembleMonthlySnapshot(raw({ ...base, stores: [] }));
  assert.deepEqual(noStore.unresolved, ["inventory:hookah"]);
});

test("снимок фиксирует привязку склада на момент расчёта", () => {
  const base = {
    acts: [act("hookah", { store_id: STORE_HOOKAH })],
    items: [item("hookah", "i", -200)],
  };
  const before = assembleMonthlySnapshot(raw(base));
  assert.deepEqual(before.storeBindings, [
    { storeId: STORE_HOOKAH, scope: "department", departmentId: DEPT_HOOKAH },
  ]);
  assert.equal(before.sources[0].key, DEPT_HOOKAH);

  // Склад переназначили на бар. Уже снятый снимок прежнего плательщика не теряет...
  const reassigned = raw({
    ...base,
    stores: [store(STORE_HOOKAH, { department_scope: "department", department_id: DEPT_BAR })],
  });
  assert.equal(before.sources[0].key, DEPT_HOOKAH);
  assert.equal(before.storeBindings[0].departmentId, DEPT_HOOKAH);
  // ...а новый расчёт меняет плательщика и записывает новую привязку: только вперёд.
  const after = assembleMonthlySnapshot(reassigned);
  assert.equal(after.sources[0].key, DEPT_BAR);
  assert.deepEqual(after.storeBindings, [
    { storeId: STORE_HOOKAH, scope: "department", departmentId: DEPT_BAR },
  ]);
});

test("в привязки попадают склады проведённых актов месяца, в том числе неподходящие", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [
        act("a", { store_id: "unset" }),
        act("b", { store_id: STORE_MAIN }),
        act("c", { store_id: STORE_MAIN }),
        act("draft", { store_id: STORE_HOOKAH, status: "assigned", processed: false }),
      ],
      items: [item("a", "ia", -1), item("b", "ib", -1), item("c", "ic", -1), item("draft", "id", -1)],
      stores: [
        store("unset", { department_scope: "unset", department_id: null }),
        store(STORE_MAIN),
        store(STORE_HOOKAH, { department_scope: "department", department_id: DEPT_HOOKAH }),
      ],
    }),
  );
  assert.deepEqual(r.storeBindings, [
    { storeId: STORE_MAIN, scope: "shared", departmentId: null },
    { storeId: "unset", scope: "unset", departmentId: null },
  ]);
});

// ── списания ─────────────────────────────────────────────────

const writeoff = (externalId: number, amount: number, over: Partial<WriteoffRow> = {}): WriteoffRow => ({
  venue_id: VENUE,
  external_id: externalId,
  business_date: "2026-10-12",
  missing_at: null,
  payload: {
    processed: true,
    kind: "team",
    lines: [{ id: 1, amount }],
  },
  ...over,
});
const mark = (externalId: number, over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  venue_id: VENUE,
  external_id: externalId,
  pool: "shared",
  department_id: null,
  employee_id: null,
  ...over,
});

test("пометка списания на архивное подразделение даёт unresolved", () => {
  const r = assembleMonthlySnapshot(
    raw({
      writeoffs: [writeoff(7, 100)],
      assignments: [mark(7, { pool: "department", department_id: DEPT_BAR })],
      departments: [dept(DEPT_BAR, { archived_at: "2026-10-25T00:00:00+00:00" })],
    }),
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, [`writeoff:${VENUE}:7`]);
});

test("пометка списания на пропавшее или чужое подразделение тоже unresolved", () => {
  const w = [writeoff(7, 100)];
  const a = [mark(7, { pool: "department", department_id: DEPT_BAR })];
  assert.deepEqual(
    assembleMonthlySnapshot(raw({ writeoffs: w, assignments: a, departments: [] })).unresolved,
    [`writeoff:${VENUE}:7`],
  );
  assert.deepEqual(
    assembleMonthlySnapshot(
      raw({ writeoffs: w, assignments: a, departments: [dept(DEPT_BAR, { venue_id: OTHER_VENUE })] }),
    ).unresolved,
    [`writeoff:${VENUE}:7`],
  );
});

test("списание с живым подразделением и личное списание попадают в свои пулы", () => {
  const r = assembleMonthlySnapshot(
    raw({
      writeoffs: [writeoff(1, 100), writeoff(2, 40), writeoff(3, 10)],
      assignments: [
        mark(1, { pool: "department", department_id: DEPT_BAR }),
        mark(2, { pool: "personal", employee_id: EMP_A }),
        mark(3, { pool: "excluded" }),
      ],
    }),
  );
  assert.deepEqual(
    r.sources.map((s) => [s.pool, s.key, s.amount]),
    [
      ["department", DEPT_BAR, -100],
      ["personal", EMP_A, -40],
    ],
  );
  assert.deepEqual(r.unresolved, []);
});

test("месяц списания задаёт его бизнес-день; черновик и пропавший акт не считаются", () => {
  const r = assembleMonthlySnapshot(
    raw({
      writeoffs: [
        writeoff(1, 100, { business_date: "2026-11-01" }),
        writeoff(2, 100, { missing_at: "2026-10-20T00:00:00+00:00" }),
        writeoff(3, 100, { payload: { processed: false, kind: "team", lines: [{ id: 1, amount: 100 }] } }),
        writeoff(4, 100),
      ],
      assignments: [mark(4)],
    }),
  );
  assert.deepEqual(r.sources.map((s) => s.sourceRef), [`writeoff:${VENUE}:4`]);
  assert.deepEqual(r.unresolved, []);
});

test("списание с битым содержимым даёт unresolved", () => {
  const bad = writeoff(5, 0, { payload: { processed: true, kind: "team" } as never });
  const r = assembleMonthlySnapshot(raw({ writeoffs: [bad] }));
  assert.deepEqual(r.unresolved, [`writeoff:${VENUE}:5`]);
});

// ── смены ────────────────────────────────────────────────────

test("смена считается, если по сотруднику и дню есть начисление с этой отметкой", () => {
  const d1 = day(EMP_A, "2026-10-03", "s1");
  const d2 = day(EMP_A, "2026-10-04", "s2");
  // Отметка есть, а начисления на неё нет: платёжная ведомость смену не посчитала.
  const unpaid = day(EMP_A, "2026-10-05", "s3", { attendanceIds: [] });
  // Начисление только по окладу (`[]`) и пустышка корректировки (ключа нет, kind = adjustment): смен нет.
  const salary = day(EMP_B, "2026-10-03", "s4", { attendanceIds: [], kind: "monthly" });
  const adjustment = day(EMP_B, "2026-10-04", "s4", { attendanceIds: null, kind: "adjustment" });
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [d1, d2, unpaid, salary].map((d) => d.attendance),
      accruals: [d1, d2, unpaid, salary, adjustment].map((d) => d.accrual),
      shifts: ["s1", "s2", "s3", "s4"].map((id) => shift(id)),
    }),
  );
  assert.deepEqual(r.weights, [
    { employeeId: EMP_A, roleId: ROLE_BAR, departmentId: DEPT_BAR, shifts: 2 },
  ]);
  assert.deepEqual(r.unresolved, []);
});

test("начисление без перечня отметок, не корректировка, - unresolved: молча уменьшать знаменатель нельзя", () => {
  const noKey = day(EMP_A, "2026-10-03", "s1", { attendanceIds: null });
  const noKeyOtherKind = day(EMP_B, "2026-10-03", "s1", { attendanceIds: null, kind: "monthly" });
  const notAnArray: AccrualRow = { employee_id: EMP_B, business_date: "2026-10-04", attendance_ids: "oops" };
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [noKey.attendance, noKeyOtherKind.attendance],
      accruals: [noKey.accrual, noKeyOtherKind.accrual, notAnArray],
      shifts: [shift("s1")],
    }),
  );
  assert.deepEqual(r.weights, []);
  assert.deepEqual(r.unresolved, [
    `shift:${EMP_A}:2026-10-03`,
    `shift:${EMP_B}:2026-10-03`,
    `shift:${EMP_B}:2026-10-04`,
  ]);
  assert.equal(allocateMonthlyShortage(r).state, "incomplete");
});

test("несколько отметок одного дня в одной должности - одна смена", () => {
  const first = day(EMP_A, "2026-10-03", "s1");
  const second = day(EMP_A, "2026-10-03", "s2");
  const accrual: AccrualRow = {
    employee_id: EMP_A,
    business_date: "2026-10-03",
    attendance_ids: [first.attendance.external_id, second.attendance.external_id],
  };
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [first.attendance, second.attendance],
      accruals: [accrual],
      shifts: [shift("s1"), shift("s2")],
    }),
  );
  assert.deepEqual(r.weights.map((w) => w.shifts), [1]);
});

test("смены в двух подразделениях дают два веса одного сотрудника", () => {
  const d1 = day(EMP_A, "2026-10-03", "s1");
  const d2 = day(EMP_A, "2026-10-04", "s2");
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [d1.attendance, d2.attendance],
      accruals: [d1.accrual, d2.accrual],
      shifts: [
        shift("s1", { role_id: ROLE_BAR, department_id: DEPT_BAR }),
        shift("s2", { role_id: ROLE_HOOKAH, department_id: DEPT_HOOKAH }),
      ],
    }),
  );
  assert.deepEqual(r.weights, [
    { employeeId: EMP_A, roleId: ROLE_BAR, departmentId: DEPT_BAR, shifts: 1 },
    { employeeId: EMP_A, roleId: ROLE_HOOKAH, departmentId: DEPT_HOOKAH, shifts: 1 },
  ]);
});

test("смена без роли даёт unresolved, а не роль по умолчанию", () => {
  const noRole = day(EMP_A, "2026-10-03", "s1");
  const noShift = day(EMP_B, "2026-10-03", null);
  const missingShift = day(EMP_B, "2026-10-04", "ghost");
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [noRole.attendance, noShift.attendance, missingShift.attendance],
      accruals: [noRole.accrual, noShift.accrual, missingShift.accrual],
      shifts: [shift("s1", { role_id: null })],
    }),
  );
  assert.deepEqual(r.weights, []);
  assert.deepEqual(r.unresolved, [
    `shift:${EMP_A}:2026-10-03`,
    `shift:${EMP_B}:2026-10-03`,
    `shift:${EMP_B}:2026-10-04`,
  ]);
});

test("день с двумя разными должностями или отметкой, которой нет, - unresolved", () => {
  const a = day(EMP_A, "2026-10-03", "s1");
  const b = day(EMP_A, "2026-10-03", "s2");
  const mixed: AccrualRow = {
    employee_id: EMP_A,
    business_date: "2026-10-03",
    attendance_ids: [a.attendance.external_id, b.attendance.external_id],
  };
  const stale: AccrualRow = {
    employee_id: EMP_B,
    business_date: "2026-10-04",
    attendance_ids: [424242],
  };
  // Отметка есть, но принадлежит другому сотруднику: чужую смену не засчитываем.
  const foreign = day(EMP_A, "2026-10-06", "s1");
  const claimsForeign: AccrualRow = {
    employee_id: EMP_B,
    business_date: "2026-10-06",
    attendance_ids: [foreign.attendance.external_id],
  };
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [a.attendance, b.attendance, foreign.attendance],
      accruals: [mixed, stale, claimsForeign],
      shifts: [shift("s1"), shift("s2", { role_id: ROLE_HOOKAH })],
    }),
  );
  assert.deepEqual(r.weights, []);
  assert.deepEqual(r.unresolved, [
    `shift:${EMP_A}:2026-10-03`,
    `shift:${EMP_B}:2026-10-04`,
    `shift:${EMP_B}:2026-10-06`,
  ]);
});

test("смена без подразделения остаётся в весах с пустым подразделением", () => {
  const d = day(EMP_A, "2026-10-03", "s1");
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [d.attendance],
      accruals: [d.accrual],
      shifts: [shift("s1", { department_id: null })],
    }),
  );
  assert.deepEqual(r.weights, [
    { employeeId: EMP_A, roleId: ROLE_BAR, departmentId: null, shifts: 1 },
  ]);
  assert.deepEqual(r.unresolved, []);
});

// ── правила ──────────────────────────────────────────────────

test("версия правил - действующая на конец месяца, но не позже сегодняшнего дня", () => {
  const v1 = ruleVersion({ id: "v1", version: 1, valid_from: "2026-01-01" });
  const v2 = ruleVersion({ id: "v2", version: 2, valid_from: "2026-10-20" });
  const v3 = ruleVersion({ id: "v3", version: 3, valid_from: "2026-12-01" });
  assert.equal(pickRuleVersion([v1, v2, v3], "2026-10-31")?.id, "v2");
  assert.equal(pickRuleVersion([v1, v2, v3], "2026-10-19")?.id, "v1");
  assert.equal(pickRuleVersion([v1, v2, v3], "2026-12-31")?.id, "v3");
  assert.equal(pickRuleVersion([v1, v2, v3], "2025-12-31"), null);
  // Две версии с одной датой: побеждает поздняя.
  const dup = ruleVersion({ id: "dup", version: 4, valid_from: "2026-10-20" });
  assert.equal(pickRuleVersion([v2, dup], "2026-10-31")?.id, "dup");
});

test("снимок несёт версию правил; закрытый месяц берёт правила на его последний день", () => {
  const r = assembleMonthlySnapshot(
    raw({
      ruleVersions: [
        ruleVersion({ id: "v1", version: 1, valid_from: "2026-01-01" }),
        ruleVersion({ id: "v2", version: 2, valid_from: "2026-10-20", config: rules({ companyAllowance: 777 }) }),
        ruleVersion({ id: "v3", version: 3, valid_from: "2026-11-02", config: rules({ companyAllowance: 999 }) }),
      ],
    }),
  );
  assert.equal(r.ruleVersionId, "v2");
  assert.equal(r.config.companyAllowance, 777);
  assert.equal(r.capturedAt, NOW.toISOString());
});

test("текущий месяц не берёт версию правил из будущего", () => {
  // Сегодня 3 ноября: версия с 20 ноября ещё не действует, а с 2 ноября - уже.
  const r = assembleMonthlySnapshot(
    raw({
      month: "2026-11-01",
      ruleVersions: [
        ruleVersion({ id: "v1", version: 1, valid_from: "2026-01-01" }),
        ruleVersion({ id: "v2", version: 2, valid_from: "2026-11-02" }),
        ruleVersion({ id: "v3", version: 3, valid_from: "2026-11-20" }),
      ],
    }),
  );
  assert.equal(r.ruleVersionId, "v2");
});

test("нет действующих правил - ошибка, а не правила по умолчанию", () => {
  assert.throws(
    () => assembleMonthlySnapshot(raw({ ruleVersions: [ruleVersion({ valid_from: "2027-01-01" })] })),
    /правил/,
  );
  assert.throws(() => assembleMonthlySnapshot(raw({ ruleVersions: [] })), /правил/);
});

// ── вход калькулятора ────────────────────────────────────────

test("снимок подходит калькулятору: акты и смены дают месячное сальдо", () => {
  const d1 = day(EMP_A, "2026-10-03", "s1");
  const d2 = day(EMP_B, "2026-10-03", "s1");
  const snap = assembleMonthlySnapshot(
    raw({
      acts: [act("shared"), act("hookah", { store_id: STORE_HOOKAH })],
      items: [item("shared", "i1", -14000), item("hookah", "i2", -600)],
      attendance: [d1.attendance, d2.attendance],
      accruals: [d1.accrual, d2.accrual],
      shifts: [shift("s1", { department_id: DEPT_HOOKAH })],
      ruleVersions: [ruleVersion({ config: rules({ companyAllowance: 10000 }) })],
    }),
  );
  const out = allocateMonthlyShortage(snap);
  assert.equal(out.state, "ready");
  // Общий пул: 14 000, лимит 10 000, команде 4 000. Кальянный пул: 600 с первого рубля.
  assert.equal(out.company, 10000);
  assert.equal(out.employees, 4600);
});

test("непосчитанное в источниках делает месяц неполным, а не нулевым", () => {
  const snap = assembleMonthlySnapshot(
    raw({
      acts: [act("doc-1", { store_id: "unset" })],
      items: [item("doc-1", "i1", -500)],
      stores: [store("unset", { department_scope: "unset", department_id: null })],
    }),
  );
  assert.equal(allocateMonthlyShortage(snap).state, "incomplete");
});

test("порядок строк в базе не влияет на результат", () => {
  const d1 = day(EMP_A, "2026-10-03", "s1");
  const d2 = day(EMP_B, "2026-10-04", "s1");
  const input = {
    acts: [act("a"), act("b")],
    items: [item("a", "i1", -300), item("b", "i2", -200)],
    attendance: [d1.attendance, d2.attendance],
    accruals: [d1.accrual, d2.accrual],
    shifts: [shift("s1")],
  };
  const fwd = assembleMonthlySnapshot(raw(input));
  const rev = assembleMonthlySnapshot(
    raw({
      acts: [...input.acts].reverse(),
      items: [...input.items].reverse(),
      attendance: [...input.attendance].reverse(),
      accruals: [...input.accruals].reverse(),
      shifts: input.shifts,
    }),
  );
  assert.deepEqual(rev, fwd);
});

// ── отметки вне графика ──────────────────────────────────────

const named = (employee: string, date: string, roleName: string, shiftId: string | null = null) => {
  const d = day(employee, date, shiftId);
  d.attendance.role_name = roleName;
  return d;
};

test("отметка вне графика берёт должность по role_name и подразделение этой должности", () => {
  const d = named(EMP_A, "2026-10-03", "Бармен");
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [d.attendance],
      accruals: [d.accrual],
      roles: [role(ROLE_BAR, "Бармен", { department_id: DEPT_BAR })],
    }),
  );
  assert.deepEqual(r.weights, [{ employeeId: EMP_A, roleId: ROLE_BAR, departmentId: DEPT_BAR, shifts: 1 }]);
  assert.deepEqual(r.unresolved, []);
});

test("название должности без совпадения, с двумя совпадениями или пустое - unresolved", () => {
  const none = named(EMP_A, "2026-10-03", "Фея");
  const twice = named(EMP_A, "2026-10-04", "Бармен");
  const empty = named(EMP_B, "2026-10-03", "");
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [none.attendance, twice.attendance, empty.attendance],
      accruals: [none.accrual, twice.accrual, empty.accrual],
      roles: [role(ROLE_BAR, "Бармен"), role(ROLE_HOOKAH, "Бармен"), role("rr", "", {})],
    }),
  );
  assert.deepEqual(r.weights, []);
  assert.deepEqual(r.unresolved, [
    `shift:${EMP_A}:2026-10-03`,
    `shift:${EMP_A}:2026-10-04`,
    `shift:${EMP_B}:2026-10-03`,
  ]);
});

test("архивная должность с тем же названием не создаёт неоднозначности и не подходит", () => {
  const d = named(EMP_A, "2026-10-03", "Бармен");
  const ok = assembleMonthlySnapshot(
    raw({
      attendance: [d.attendance],
      accruals: [d.accrual],
      roles: [role(ROLE_BAR, "Бармен"), role(ROLE_HOOKAH, "Бармен", { archived_at: "2026-09-01T00:00:00+00:00" })],
    }),
  );
  assert.deepEqual(ok.weights.map((w) => w.roleId), [ROLE_BAR]);
  const onlyArchived = assembleMonthlySnapshot(
    raw({
      attendance: [d.attendance],
      accruals: [d.accrual],
      roles: [role(ROLE_BAR, "Бармен", { archived_at: "2026-09-01T00:00:00+00:00" })],
    }),
  );
  assert.deepEqual(onlyArchived.unresolved, [`shift:${EMP_A}:2026-10-03`]);
});

test("смена из графика приоритетнее role_name; без должности у смены - запасной путь по названию", () => {
  const withRole = named(EMP_A, "2026-10-03", "Мастер", "s1");
  const noShiftRole = named(EMP_B, "2026-10-03", "Мастер", "s2");
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [withRole.attendance, noShiftRole.attendance],
      accruals: [withRole.accrual, noShiftRole.accrual],
      shifts: [
        shift("s1", { role_id: ROLE_BAR, department_id: DEPT_BAR }),
        shift("s2", { role_id: null, department_id: DEPT_BAR }),
      ],
      roles: [role(ROLE_HOOKAH, "Мастер", { department_id: DEPT_HOOKAH })],
    }),
  );
  assert.deepEqual(r.weights, [
    { employeeId: EMP_A, roleId: ROLE_BAR, departmentId: DEPT_BAR, shifts: 1 },
    // Подразделение смены сохраняется, если оно задано; должность - из названия.
    { employeeId: EMP_B, roleId: ROLE_HOOKAH, departmentId: DEPT_BAR, shifts: 1 },
  ]);
  assert.deepEqual(r.unresolved, []);
});

test("месяц с отметками вне графика считается", () => {
  const a = named(EMP_A, "2026-10-03", "Бармен");
  const b = named(EMP_B, "2026-10-03", "Бармен");
  const snap = assembleMonthlySnapshot(
    raw({
      acts: [act("shared")],
      items: [item("shared", "i", -12000)],
      attendance: [a.attendance, b.attendance],
      accruals: [a.accrual, b.accrual],
      roles: [role(ROLE_BAR, "Бармен", { department_id: DEPT_BAR })],
      ruleVersions: [ruleVersion({ config: rules({ companyAllowance: 10000 }) })],
    }),
  );
  const out = allocateMonthlyShortage(snap);
  assert.equal(out.state, "ready");
  assert.equal(out.employees, 2000);
});

// ── акт без зафиксированных итогов ───────────────────────────

test("акт без снимка итогов, переоткрытый или с поздней строкой не читается по живым значениям", () => {
  const cases: Array<[string, ActRow, ItemRow[], ResortRow[], ResortItemRow[]]> = [
    ["no-snapshot", act("no-snapshot", { results_snapshot_at: null }), [item("no-snapshot", "i", -500)], [], []],
    [
      "reopened",
      act("reopened", { results_finalized_at: null, results_reopened_at: "2026-10-20T00:00:00+00:00" }),
      [item("reopened", "i", -500)],
      [],
      [],
    ],
    [
      "late-line",
      act("late-line"),
      [item("late-line", "i1", -500), item("late-line", "i2", -999, { finalized_at: null })],
      [],
      [],
    ],
    [
      "late-resort",
      act("late-resort"),
      [item("late-resort", "i", -500)],
      [
        {
          id: "r",
          document_id: "late-resort",
          status: "active",
          offset_amount: 1,
          residual_shortfall_sum: 0,
          residual_surplus_sum: 0,
          cost_adjustment_sum: 0,
          finalized_at: null,
        },
      ],
      [],
    ],
    [
      "late-resort-item",
      act("late-resort-item"),
      [item("late-resort-item", "i", -500)],
      [],
      [
        {
          document_id: "late-resort-item",
          resort_id: "r",
          document_item_id: "i",
          role: "shortage",
          source_difference_amount: -1,
          source_difference_sum: -500,
          offset_amount: 1,
          remaining_difference_amount: 0,
          remaining_difference_sum: 0,
          finalized_at: null,
        },
      ],
    ],
  ];
  for (const [name, a, items, resorts, resortItems] of cases) {
    const r = assembleMonthlySnapshot(raw({ acts: [a], items, resorts, resortItems }));
    assert.deepEqual(r.sources, [], name);
    assert.deepEqual(r.unresolved, [`inventory:${name}`], name);
  }
});

test("зафиксированный акт читается по снимку и месяц остаётся вычислимым", () => {
  const r = assembleMonthlySnapshot(raw({ acts: [act("ok")], items: [item("ok", "i", -500)] }));
  assert.deepEqual(r.sources.map((s) => s.amount), [-500]);
  assert.deepEqual(r.unresolved, []);
});

// ── таймзоны ─────────────────────────────────────────────────

test("расхождение таймзон названо в unresolved вместе с обеими зонами", () => {
  const writeoffs = assembleMonthlySnapshot(raw({ writeoffSourceTimezone: "Asia/Yekaterinburg" }));
  assert.deepEqual(writeoffs.unresolved, ["timezone:venue=Europe/Moscow;writeoffs=Asia/Yekaterinburg"]);
  const payroll = assembleMonthlySnapshot(raw({ payrollTimezone: "Europe/Samara", payrollDayStartHour: 9 }));
  assert.deepEqual(payroll.unresolved, ["timezone:venue=Europe/Moscow;payroll=Europe/Samara"]);
  assert.equal(payroll.payrollDayStartHour, 9);
  const both = assembleMonthlySnapshot(
    raw({ writeoffSourceTimezone: "Asia/Omsk", payrollTimezone: "Asia/Omsk" }),
  );
  assert.equal(both.unresolved.length, 2);
  assert.equal(allocateMonthlyShortage(both).state, "incomplete");
});

test("одинаковые зоны и зоны-псевдонимы расхождением не считаются; нет настроек - нет сравнения", () => {
  assert.deepEqual(
    assembleMonthlySnapshot(raw({ writeoffSourceTimezone: "Europe/Moscow", payrollTimezone: "Europe/Moscow" })).unresolved,
    [],
  );
  assert.equal(sameZone("Asia/Kolkata", "Asia/Calcutta", "2026-10-01"), true);
  assert.equal(sameZone("Europe/Moscow", "Europe/Minsk", "2026-10-01"), true);
  assert.equal(sameZone("Europe/Moscow", "Europe/Samara", "2026-10-01"), false);
  assert.equal(sameZone("Europe/Moscow", "Not/AZone", "2026-10-01"), false);
  assert.deepEqual(assembleMonthlySnapshot(raw()).unresolved, []);
});

// ── округление и постраничное чтение ─────────────────────────

test("шум float в нетто акта не превращается в деньги", () => {
  // Недостача -0,30000000000000004 и излишек 0,3 в нетто дают -5,5e-17, а не ноль.
  const noisy = inventoryPoolSources({
    counted: [act("noise")],
    totals: new Map([["noise", { managementShortfallSum: -(0.1 + 0.2), managementSurplusSum: 0.3 }]]),
    stores: [store(STORE_MAIN)],
    departments: [],
    venueId: VENUE,
  });
  assert.deepEqual(noisy.sources, []);
  assert.deepEqual(noisy.unresolved, []);
  // Нетто -0,1 из строк 0,3 и -0,4 - ровно -0,1, а не -0,10000000000000003.
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("doc-1")],
      items: [
        item("doc-1", "i1", -0.4),
        item("doc-1", "i2", 0.3, { finalized_difference_amount: 1, difference_amount: 1 }),
      ],
    }),
  );
  assert.deepEqual(r.sources.map((s) => s.amount), [-0.1]);
});

test("постраничное чтение не теряет и не дублирует строки на границах страницы", async () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, "0") }));
  for (const [n, page] of [[0, 10], [9, 10], [10, 10], [11, 10], [20, 10], [25, 10], [2050, 1000]] as const) {
    const db = fakeDb({ t: rows(n) });
    const got = await readAll<{ id: string }>("t", () => db.from<Array<{ id: string }>>("t").select("id"), "id", true, {
      page,
    });
    assert.deepEqual(got.map((r) => r.id), rows(n).map((r) => r.id), `${n} строк по ${page}`);
  }
});

test("упор в предел чтения - исключение, а не молча неполный результат", async () => {
  const db = fakeDb({ t: Array.from({ length: 100 }, (_, i) => ({ id: String(i).padStart(3, "0") })) });
  await assert.rejects(
    readAll("t", () => db.from<Array<{ id: string }>>("t").select("id"), "id", true, { page: 10, cap: 25 }),
    /больше 25 строк/,
  );
  // Ровно в предел и меньше - не ошибка.
  const exact = fakeDb({ t: Array.from({ length: 25 }, (_, i) => ({ id: String(i).padStart(3, "0") })) });
  const got = await readAll("t", () => exact.from<Array<{ id: string }>>("t").select("id"), "id", true, {
    page: 10,
    cap: 25,
  });
  assert.equal(got.length, 25);
});

test("чтение по списку ключей идёт кусками и ничего не теряет", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `k${String(i).padStart(3, "0")}`);
  const log: Array<{ table: string; filters: string[] }> = [];
  const db = fakeDb({ t: ids.map((id) => ({ id })) }, log);
  const got = await readByIds<{ id: string }>("t", [...ids, ...ids], (chunk) =>
    db.from<Array<{ id: string }>>("t").select("id").in("id", chunk),
  );
  assert.deepEqual(got.map((r) => r.id).sort(), ids);
  const sizes = log.flatMap((q) => q.filters.filter((f) => f.startsWith("id in#")).map((f) => Number(f.slice(6))));
  assert.deepEqual(sizes, [100, 100, 50]);
});

// ── чтение из базы ───────────────────────────────────────────

type Row = Record<string, unknown>;
/** Минимальный in-memory LooseDb: фильтры eq/is/in/gte/lt/lte/neq/or(venue), order, range. */
function fakeDb(tables: Record<string, Row[]>, log: Array<{ table: string; filters: string[] }> = []) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const filters: string[] = [];
    const entry = { table, filters };
    log.push(entry);
    const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push(`${c}=${v}`), (rows = rows.filter((r) => r[c] === v)), q),
      neq: (c: string, v: unknown) => (rows = rows.filter((r) => r[c] !== v), q),
      is: (c: string, v: unknown) => (filters.push(`${c} is ${v}`), (rows = rows.filter((r) => (r[c] ?? null) === v)), q),
      in: (c: string, vs: unknown[]) => (filters.push(`${c} in`, `${c} in#${vs.length}`), (rows = rows.filter((r) => vs.includes(r[c]))), q),
      gte: (c: string, v: unknown) => (filters.push(`${c}>=${v}`), (rows = rows.filter((r) => r[c] != null && cmp(r[c], v) >= 0)), q),
      lt: (c: string, v: unknown) => (filters.push(`${c}<${v}`), (rows = rows.filter((r) => r[c] != null && cmp(r[c], v) < 0)), q),
      lte: (c: string, v: unknown) => (rows = rows.filter((r) => r[c] != null && cmp(r[c], v) <= 0), q),
      or: (f: string) => {
        filters.push(`or ${f}`);
        const m = /venue_id\.eq\.([^,]+),venue_id\.is\.null/.exec(f);
        assert.ok(m, `unsupported or(): ${f}`);
        rows = rows.filter((r) => r.venue_id === m![1] || (r.venue_id ?? null) === null);
        return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        const dir = o?.ascending === false ? -1 : 1;
        rows.sort((a, b) => dir * cmp(a[c], b[c]));
        return q;
      },
      range: (a: number, b: number) => ((rows = rows.slice(a, b + 1)), q),
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(ok, bad),
    };
    return q;
  };
  return asLooseDb({ from, rpc: async () => ({ data: null, error: null }) });
}

test("чтение: берёт только акты месяца своего заведения и собирает тот же снимок", async () => {
  const d1 = day(EMP_A, "2026-10-03", "s1");
  const d3 = day(EMP_A, "2026-10-04", "s1");
  const log: Array<{ table: string; filters: string[] }> = [];
  const A = (over: Row): Row => ({ account_id: ACCOUNT, document_kind: "inventory", ...over });
  const db = fakeDb(
    {
      venues: [{ id: VENUE, account_id: ACCOUNT, timezone: "Europe/Moscow" }],
      stock_deduction_rules: [
        { account_id: ACCOUNT, venue_id: VENUE, ...ruleVersion() },
        { account_id: ACCOUNT, venue_id: OTHER_VENUE, ...ruleVersion({ id: "foreign", version: 9 }) },
      ],
      documents: [
        A(act("in-month")),
        A(act("ended-oct", { invoice_date: "2026-10-31T20:59:00+00:00" })),
        A(act("starts-nov", { invoice_date: "2026-10-31T21:30:00+00:00" })),
        A(act("draft", { status: "assigned", processed: false })),
        A(act("other-venue", { venue_id: OTHER_VENUE })),
        { ...A(act("foreign-account")), account_id: "other" },
        A(act("no-venue", { venue_id: null })),
        A(act("undated", { invoice_date: null })),
      ],
      document_items: [
        item("in-month", "i1", -300),
        item("ended-oct", "i2", -100),
        item("starts-nov", "i3", -999),
        item("no-venue", "i4", -1),
      ].map((r) => ({ account_id: ACCOUNT, ...r })),
      inventory_result_resorts: [],
      inventory_result_resort_items: [],
      stores: [
        { account_id: ACCOUNT, ...store(STORE_MAIN) },
        { account_id: "other", ...store("foreign-store") },
      ],
      departments: [dept(DEPT_HOOKAH), dept(DEPT_BAR)],
      stock_writeoff_documents: [
        { account_id: ACCOUNT, id: "w1", ...writeoff(1, 50) },
        { account_id: ACCOUNT, id: "w2", ...writeoff(2, 50, { business_date: "2026-11-01" }) },
        { account_id: ACCOUNT, id: "w3", ...writeoff(3, 50, { venue_id: OTHER_VENUE }) },
      ],
      writeoff_pool_assignments: [
        { account_id: ACCOUNT, ...mark(1) },
        { account_id: ACCOUNT, ...mark(3) },
      ],
      payroll_accruals: [
        { account_id: ACCOUNT, venue_id: VENUE, ...d1.accrual },
        { account_id: ACCOUNT, venue_id: VENUE, ...d3.accrual },
        { account_id: ACCOUNT, venue_id: VENUE, ...day(EMP_B, "2026-11-01", "s1").accrual },
      ],
      payroll_attendance: [
        { account_id: ACCOUNT, venue_id: VENUE, ...d1.attendance },
        // Отметка пересчитана в другой день: хранит прежнюю дату, но числится в начислении 2026-10-04.
        { account_id: ACCOUNT, venue_id: VENUE, ...d3.attendance, business_date: "2026-09-30" },
        { account_id: ACCOUNT, venue_id: OTHER_VENUE, ...day(EMP_B, "2026-10-04", "s1").attendance },
      ],
      stock_writeoff_sources: [{ account_id: ACCOUNT, venue_id: VENUE, config: { timezone: "Europe/Moscow" } }],
      sales_settings: [{ account_id: ACCOUNT, venue_id: VENUE, timezone: "Europe/Moscow", day_start_hour: 9 }],
      roles: [{ ...role(ROLE_BAR, "Бармен"), venue_id: VENUE }, { ...role(ROLE_HOOKAH, "Мастер"), venue_id: OTHER_VENUE }],
      schedule_shifts: [{ venue_id: VENUE, ...shift("s1") }, { venue_id: OTHER_VENUE, ...shift("s2") }],
    },
    log,
  );
  const snap = await buildMonthlySnapshot(db, {
    accountId: ACCOUNT,
    venueId: VENUE,
    month: "2026-10-01",
    now: NOW,
  });
  assert.deepEqual(
    snap.sources.map((s) => [s.sourceRef, s.amount]),
    [
      ["inventory:ended-oct", -100],
      ["inventory:in-month", -300],
      [`writeoff:${VENUE}:1`, -50],
    ],
  );
  // Без даты - проблема данных: месяц не блокирует, но и не теряется.
  // Без заведения - месяц неполный: акт датирован и чинится привязкой склада.
  assert.deepEqual(snap.unresolved, ["inventory:no-venue"]);
  assert.deepEqual(snap.dataProblems, { undatedActs: ["inventory:undated"] });
  assert.equal(snap.payrollDayStartHour, 9);
  // Обе отметки найдены: вторая лежит вне окна дат месяца, но названа в начислении.
  assert.deepEqual(snap.weights, [{ employeeId: EMP_A, roleId: ROLE_BAR, departmentId: DEPT_BAR, shifts: 2 }]);
  const attendanceQuery = log.find((q) => q.table === "payroll_attendance");
  assert.ok(attendanceQuery?.filters.includes("external_id in"));
  assert.ok(!attendanceQuery?.filters.some((f) => f.startsWith("business_date")), "отметки читаются по ключам, не по окну дат");
  assert.equal(snap.ruleVersionId, RULE_ID);
  assert.equal(snap.venueId, VENUE);
  assert.equal(snap.month, "2026-10-01");
  assert.equal(snap.timezone, "Europe/Moscow");
  // Каждый запрос ограничен аккаунтом (а где есть заведение - и им).
  for (const q of log) {
    // У этих таблиц нет account_id: они ограничены заведением, которое уже проверено на аккаунт.
    if (q.table === "roles" || q.table === "schedule_shifts" || q.table === "departments") {
      assert.ok(q.filters.includes(`venue_id=${VENUE}`), `${q.table}: нет фильтра по заведению`);
      continue;
    }
    assert.ok(
      q.filters.includes(`account_id=${ACCOUNT}`),
      `${q.table}: нет фильтра по аккаунту (${q.filters.join("; ")})`,
    );
  }
});

test("чтение: больше страницы и больше куска ключей - ни одна строка не теряется и не двоится", async () => {
  const n = 250;
  const pad = (i: number) => String(i).padStart(4, "0");
  const stores = Array.from({ length: n }, (_, i) => ({ account_id: ACCOUNT, ...store(`st${pad(i)}`) }));
  const docs = Array.from({ length: n }, (_, i) => ({
    account_id: ACCOUNT,
    document_kind: "inventory",
    ...act(`ac${pad(i)}`, { store_id: `st${pad(i)}` }),
  }));
  const items = Array.from({ length: n }, (_, i) => ({ account_id: ACCOUNT, ...item(`ac${pad(i)}`, `it${pad(i)}`, -1) }));
  const wo = 1250;
  const writeoffs = Array.from({ length: wo }, (_, i) => ({
    account_id: ACCOUNT,
    id: `w${pad(i)}`,
    ...writeoff(i + 1, 10),
  }));
  const marks = Array.from({ length: wo }, (_, i) => ({ account_id: ACCOUNT, id: `m${pad(i)}`, ...mark(i + 1) }));
  const snap = await buildMonthlySnapshot(
    fakeDb({
      venues: [{ id: VENUE, account_id: ACCOUNT, timezone: "Europe/Moscow" }],
      stock_deduction_rules: [{ account_id: ACCOUNT, venue_id: VENUE, ...ruleVersion() }],
      documents: docs,
      document_items: items,
      stores,
      stock_writeoff_documents: writeoffs,
      writeoff_pool_assignments: marks,
    }),
    { accountId: ACCOUNT, venueId: VENUE, month: "2026-10-01", now: NOW },
  );
  assert.equal(snap.sources.filter((s) => s.sourceRef.startsWith("inventory:")).length, n);
  assert.equal(snap.sources.filter((s) => s.sourceRef.startsWith("writeoff:")).length, wo);
  assert.equal(new Set(snap.sources.map((s) => s.sourceRef)).size, n + wo);
  assert.equal(snap.storeBindings.length, n);
  assert.deepEqual(snap.unresolved, []);
});

test("чтение: заведение чужого аккаунта и ошибка запроса - исключение, а не пустой месяц", async () => {
  await assert.rejects(
    buildMonthlySnapshot(fakeDb({ venues: [] }), { accountId: ACCOUNT, venueId: VENUE, month: "2026-10-01", now: NOW }),
    /заведени/i,
  );
  const failing = asLooseDb({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "is", "in", "gte", "lt", "lte", "or", "order", "range", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { id: VENUE, timezone: "UTC" }, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(ok);
      return q;
    },
  });
  await assert.rejects(
    buildMonthlySnapshot(failing, { accountId: ACCOUNT, venueId: VENUE, month: "2026-10-01", now: NOW }),
    /boom/,
  );
});

// ── смены из Glide, смена без подразделения, погрешность ─────

test("смена, перенесённая из Glide, считается по должности из Glide", () => {
  const glide = (date: string, position: string | null): AccrualRow => ({
    employee_id: EMP_A,
    business_date: date,
    attendance_ids: null,
    snapshot_kind: "shift",
    historical: "true",
    position_name: position,
  });
  const r = assembleMonthlySnapshot(
    raw({
      accruals: [glide("2026-10-02", "Бармен"), glide("2026-10-03", "Бармен"), glide("2026-10-04", "Нет такой")],
      roles: [role(ROLE_BAR, "Бармен", { department_id: DEPT_BAR })],
    }),
  );
  assert.deepEqual(r.weights, [
    { employeeId: EMP_A, roleId: ROLE_BAR, departmentId: DEPT_BAR, shifts: 2 },
  ]);
  assert.deepEqual(r.unresolved, [`shift:${EMP_A}:2026-10-04`]);
});

test("смена графика без подразделения берёт подразделение должности и не конфликтует с отметкой вне графика", () => {
  const inShift = day(EMP_A, "2026-10-29", "s1", { attendanceIds: [] });
  const offShift = day(EMP_A, "2026-10-29", null, { attendanceIds: [] });
  offShift.attendance.role_name = "Бармен";
  const accrual: AccrualRow = {
    employee_id: EMP_A,
    business_date: "2026-10-29",
    attendance_ids: [inShift.attendance.external_id, offShift.attendance.external_id],
    snapshot_kind: null,
  };
  const r = assembleMonthlySnapshot(
    raw({
      attendance: [inShift.attendance, offShift.attendance],
      accruals: [accrual],
      shifts: [shift("s1", { department_id: null })],
      roles: [role(ROLE_BAR, "Бармен", { department_id: DEPT_BAR })],
    }),
  );
  assert.deepEqual(r.weights, [
    { employeeId: EMP_A, roleId: ROLE_BAR, departmentId: DEPT_BAR, shifts: 1 },
  ]);
  assert.deepEqual(r.unresolved, []);
});

test("погрешность из правил: позиции до суммы включительно в обе стороны не учитываются", () => {
  const r = assembleMonthlySnapshot(
    raw({
      ruleVersions: [ruleVersion({ config: rules({ ingredientTolerance: 250 }) })],
      acts: [act("doc-1")],
      items: [
        item("doc-1", "i1", -250),
        item("doc-1", "i2", 250),
        item("doc-1", "i3", -250.01),
        item("doc-1", "i4", 400),
        item("doc-1", "i5", -1000),
      ],
    }),
  );
  assert.deepEqual(r.sources.map((s) => s.amount), [-850.01]);
});

test("без погрешности в правилах позиции учитываются все", () => {
  const r = assembleMonthlySnapshot(
    raw({
      acts: [act("doc-1")],
      items: [item("doc-1", "i1", -250), item("doc-1", "i2", 100)],
    }),
  );
  assert.deepEqual(r.sources.map((s) => s.amount), [-150]);
});

test("корректировка из Glide (без должности) не блокирует месяц и смен не даёт", () => {
  const r = assembleMonthlySnapshot(
    raw({
      accruals: [
        { employee_id: EMP_A, business_date: "2026-10-05", attendance_ids: null, snapshot_kind: "adjustment", historical: "true", position_name: null },
      ],
      roles: [role(ROLE_BAR, "Бармен", { department_id: DEPT_BAR })],
    }),
  );
  assert.deepEqual(r.weights, []);
  assert.deepEqual(r.unresolved, []);
});
