import { test } from "node:test";
import assert from "node:assert/strict";
import {
  writeoffChargeRubles,
  writeoffCounts,
  writeoffPoolLabel,
  writeoffPoolSources,
  writeoffPoolState,
  type WriteoffPoolAssignment,
  type WriteoffPoolDoc,
} from "./writeoff-pools.ts";
import { normalizeWriteoff, type WriteoffRules } from "./writeoffs.ts";
import { allocateMonthlyShortage } from "./monthly-shortage.ts";

const V = "11111111-aaaa-4aaa-8aaa-111111111111";
const V2 = "22222222-bbbb-4bbb-8bbb-222222222222";
const ref = (n: number, v = V) => `writeoff:${v}:${n}`;
const DEPT = "22222222-2222-4222-8222-222222222222";
const EMP = "33333333-3333-4333-8333-333333333333";

const doc = (
  externalId: number,
  amounts: Array<number | null>,
  over: {
    kind?: WriteoffPoolDoc["payload"]["kind"];
    processed?: boolean;
    missing_at?: string | null;
  } = {},
): WriteoffPoolDoc => ({
  venue_id: V,
  external_id: externalId,
  missing_at: over.missing_at ?? null,
  payload: {
    kind: over.kind ?? "team",
    processed: over.processed ?? true,
    lines: amounts.map((amount, i) => ({ id: i + 1, amount })),
  },
});
const shared = (externalId: number): WriteoffPoolAssignment => ({
  venue_id: V,
  external_id: externalId,
  pool: "shared",
  key: null,
});

test("сумма акта округляется вверх по каждой позиции", () => {
  // 10,01 + 10,01: по позициям 11 + 11 = 22, а не 20,02 и не 21 (вверх от суммы).
  const r = writeoffPoolSources([doc(1, [10.01, 10.01])], [shared(1)]);
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].amount, -22);
});

test("личное списание округляется до целого рубля, а не вверх", () => {
  const personal = (n: number, amounts: number[]) =>
    doc(n, amounts, { kind: "personal" });
  const asEmp = (n: number): WriteoffPoolAssignment => ({
    venue_id: V,
    external_id: n,
    pool: "personal",
    key: EMP,
  });
  const r = writeoffPoolSources(
    [personal(1, [10.4]), personal(2, [10.6, 10.4])],
    [asEmp(1), asEmp(2)],
  );
  // 10,40 -> 10 (вверх было бы 11); 10,60 + 10,40 -> 11 + 10.
  assert.deepEqual(
    r.sources.map((s) => s.amount),
    [-10, -21],
  );
  // Обратная сторона: то же 10,40 в командном акте идёт вверх, до 11.
  const team = writeoffPoolSources([doc(3, [10.4])], [shared(3)]);
  assert.equal(team.sources[0].amount, -11);
});

test("сотруднический акт (не личное потребление) тоже округляется вверх", () => {
  const r = writeoffPoolSources(
    [doc(1, [10.01], { kind: "employee" })],
    [{ venue_id: V, external_id: 1, pool: "personal", key: EMP }],
  );
  assert.equal(r.sources[0].amount, -11);
});

// Покрывает три вида из шести (personal, employee, team): у business и unknown
// `legacyAmount` в источнике пуст, для них паритета нет (см. следующий тест).
test("округление совпадает с тем, что синхронизация кладёт в legacyAmount", () => {
  const rules: WriteoffRules = {
    storeIds: [1],
    timezone: "Europe/Moscow",
    personalOperatorIds: [7],
    teamReasons: ["Бой посуды"],
    masterReasons: [],
  };
  const raw = (type: string, operatorId: number, reason: string | null) => ({
    id: 100,
    documentNumber: "A-1",
    processed: true,
    invoiceDate: "2026-10-05T12:00:00+03:00",
    customerType: type,
    store: { id: 1, title: "Основной" },
    operator: { id: operatorId, firstName: "А", lastName: "Б" },
    discardReason: reason ? { id: 1, description: reason } : null,
    totalSum: 30,
    invoiceItems: [10.4, 10.6, 9.01].map((fixedTotalSum, i) => ({
      id: i + 1,
      product: { id: i + 1, name: `Товар ${i + 1}` },
      actualAmount: 1,
      fixedTotalSum,
    })),
  });
  for (const [type, op, reason] of [
    ["EMPLOYEE", 7, null], // личное потребление
    ["EMPLOYEE", 8, null], // сотрудник
    ["SPECIAL", 8, "Бой посуды"], // вся команда
  ] as const) {
    const n = normalizeWriteoff(raw(type, op, reason), rules);
    assert.notEqual(n.legacyTotal, null);
    const pool = n.kind === "personal" ? "personal" : "shared";
    const r = writeoffPoolSources(
      [{ venue_id: V, external_id: n.id, missing_at: null, payload: n }],
      [{ venue_id: V, external_id: n.id, pool, key: pool === "shared" ? null : EMP }],
    );
    assert.equal(r.sources[0].amount, -n.legacyTotal!, `${type}/${n.kind}`);
  }
});

test("неразнесённый акт попадает в unresolved, а не в общий пул", () => {
  const r = writeoffPoolSources([doc(1, [50])], []);
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, [ref(1)]);
});

test("неразнесённый акт блокирует месяц, а не списывается на команду", () => {
  const r = writeoffPoolSources([doc(1, [5000]), doc(2, [100])], [shared(2)]);
  const out = allocateMonthlyShortage({
    sources: r.sources,
    unresolved: r.unresolved,
    config: {
      enabled: true,
      companyAllowance: 10000,
      multiplier: 1,
      ingredientTolerance: 0,
      distribution: "shifts",
      split: "once",
      inventoryExclusions: [],
      roleSpecificCategories: [],
      writeoffReasons: [],
      excludedRoleIds: [],
      groups: [],
    },
    weights: [],
  });
  assert.deepEqual(out.unresolved, [ref(1)]);
  assert.equal(out.state, "incomplete");
  assert.equal(
    out.pools.reduce((s, p) => s + p.employees + p.company, 0),
    0,
    "пока есть неразнесённый акт, никому ничего не начисляется",
  );
});

test("вид акта из источника не подставляет пул вместо человека", () => {
  // Ни «Вся команда», ни «Личное потребление», ни «За счёт заведения» пул не выбирают.
  for (const kind of ["team", "personal", "employee", "business", "masters"] as const) {
    const r = writeoffPoolSources([doc(1, [50], { kind })], []);
    assert.deepEqual(r.sources, [], kind);
    assert.deepEqual(r.unresolved, [ref(1)], kind);
  }
});

test("причина списания не фильтрует расчёт: акт «за счёт заведения» идёт, если его разнесли", () => {
  const r = writeoffPoolSources(
    [doc(1, [70], { kind: "business" })],
    [shared(1)],
  );
  assert.equal(r.sources[0].amount, -70);
});

test("черновик и исчезнувший акт в расчёт не идут", () => {
  const docs = [
    doc(1, [100]),
    doc(2, [200], { processed: false }),
    doc(3, [400], { missing_at: "2026-11-02T00:00:00Z" }),
  ];
  // Разнесены все три: пометка исчезнувшего и черновика ничего не меняет.
  const r = writeoffPoolSources(docs, [shared(1), shared(2), shared(3)]);
  assert.deepEqual(
    r.sources.map((s) => s.sourceRef),
    [ref(1)],
  );
  assert.deepEqual(r.unresolved, []);
  // И без пометки они не блокируют месяц как «неразнесённые».
  const bare = writeoffPoolSources(docs, [shared(1)]);
  assert.deepEqual(bare.unresolved, []);
});

test("пометка живёт сама по себе: исчезнувший акт возвращается и находит своё разнесение", () => {
  const marks = [{ venue_id: V, external_id: 5, pool: "department" as const, key: DEPT }];
  const gone = writeoffPoolSources(
    [doc(5, [100], { missing_at: "2026-11-02T00:00:00Z" })],
    marks,
  );
  assert.deepEqual(gone.sources, []);
  const back = writeoffPoolSources([doc(5, [100])], marks);
  assert.equal(back.sources[0].pool, "department");
  assert.equal(back.sources[0].key, DEPT);
});

test("пул и ключ берутся из пометки", () => {
  const r = writeoffPoolSources(
    [doc(1, [10]), doc(2, [20]), doc(3, [30])],
    [
      shared(1),
      { venue_id: V, external_id: 2, pool: "department", key: DEPT },
      { venue_id: V, external_id: 3, pool: "personal", key: EMP },
    ],
  );
  assert.deepEqual(
    r.sources.map((s) => [s.pool, s.key, s.amount, s.sourceRef]),
    [
      ["shared", null, -10, ref(1)],
      ["department", DEPT, -20, ref(2)],
      ["personal", EMP, -30, ref(3)],
    ],
  );
});

test("подразделение или сотрудник без ключа — не пул, а unresolved", () => {
  const r = writeoffPoolSources(
    [doc(1, [10]), doc(2, [20])],
    [
      { venue_id: V, external_id: 1, pool: "department", key: null },
      { venue_id: V, external_id: 2, pool: "personal", key: "" },
    ],
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, [ref(1), ref(2)]);
});

test("неизвестная или отрицательная сумма позиции — unresolved, а не ноль", () => {
  const r = writeoffPoolSources(
    [doc(1, [10, null]), doc(2, [10, -5]), doc(3, [])],
    [shared(1), shared(2), shared(3)],
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, [ref(1), ref(2), ref(3)]);
});

test("каждая копеечная позиция округляется отдельно, а не в сумме", () => {
  const r = writeoffPoolSources(
    [doc(1, [0.1, 0.2, 0.7, 4.3])],
    [shared(1)],
  );
  // По позициям: 1 + 1 + 1 + 5; от суммы 5,3 вверх было бы 6.
  assert.equal(r.sources[0].amount, -8);
});



test("журнал и расчёт одинаково понимают, что акту нужна пометка", () => {
  const cases: Array<[WriteoffPoolDoc, WriteoffPoolAssignment | undefined]> = [
    [doc(1, [10]), undefined],
    [doc(2, [10]), shared(2)],
    [doc(3, [10], { processed: false }), undefined],
    [doc(4, [10], { missing_at: "2026-11-02T00:00:00Z" }), undefined],
    [doc(5, [10]), { venue_id: V, external_id: 5, pool: "department", key: null }],
  ];
  const state = cases.map(([d, m]) => writeoffPoolState(d, m));
  assert.deepEqual(state, [
    "unassigned",
    "assigned",
    "not_counted",
    "not_counted",
    "unassigned",
  ]);
  // «Не разнесён» в журнале == unresolved в расчёте, акт в акт.
  const r = writeoffPoolSources(
    cases.map(([d]) => d),
    cases.flatMap(([, m]) => (m ? [m] : [])),
  );
  assert.deepEqual(
    r.unresolved,
    cases.flatMap(([d], i) =>
      state[i] === "unassigned" ? [ref(d.external_id)] : [],
    ),
  );
  assert.equal(writeoffCounts(doc(9, [1])), true);
});

test("сумма к разнесению: по позициям, неизвестная сумма даёт null", () => {
  assert.equal(writeoffChargeRubles("team", [{ amount: 10.01 }, { amount: 10.01 }]), 22);
  assert.equal(writeoffChargeRubles("personal", [{ amount: 10.4 }]), 10);
  assert.equal(writeoffChargeRubles("team", [{ amount: 1 }, { amount: null }]), null);
  assert.equal(writeoffChargeRubles("team", []), null);
});

test("подпись плательщика не придумывает имя, которого нет", () => {
  const names = {
    departments: new Map([[DEPT, "Кальяны"]]),
    employees: new Map([[EMP, "Иван"]]),
  };
  const label = (m: WriteoffPoolAssignment) => writeoffPoolLabel(m, names);
  assert.equal(label(shared(1)), "Вся команда");
  assert.equal(label({ venue_id: V, external_id: 1, pool: "department", key: DEPT }), "Подразделение: Кальяны");
  assert.equal(label({ venue_id: V, external_id: 1, pool: "personal", key: EMP }), "Сотрудник: Иван");
  assert.equal(label({ venue_id: V, external_id: 1, pool: "personal", key: "x" }), "Сотрудник: не найден");
});

const excluded = (externalId: number): WriteoffPoolAssignment => ({
  venue_id: V,
  external_id: externalId,
  pool: "excluded",
  key: null,
});

test("«не удерживать» не даёт источника и не блокирует месяц", () => {
  const r = writeoffPoolSources(
    [
      doc(1, [500], { kind: "personal" }),
      doc(2, [null, 10], { kind: "personal" }), // сумма неизвестна, но решение принято
      doc(3, [100]),
    ],
    [excluded(1), excluded(2), shared(3)],
  );
  assert.deepEqual(
    r.sources.map((s) => s.sourceRef),
    [ref(3)],
  );
  assert.deepEqual(r.unresolved, []);
});

test("«не удерживать» отличается от «не разнесён» и в журнале, и в расчёте", () => {
  const d = doc(1, [500], { kind: "personal" });
  assert.equal(writeoffPoolState(d, undefined), "unassigned");
  assert.equal(writeoffPoolState(d, excluded(1)), "assigned");
  assert.equal(
    writeoffPoolLabel(excluded(1), {
      departments: new Map(),
      employees: new Map(),
    }),
    "Не удерживать",
  );
  assert.deepEqual(writeoffPoolSources([d], []).unresolved, [ref(1)]);
  assert.deepEqual(writeoffPoolSources([d], [excluded(1)]).unresolved, []);
});

test("«не удерживать» с ключом — битая пометка, а не решение", () => {
  const r = writeoffPoolSources(
    [doc(1, [50])],
    [{ venue_id: V, external_id: 1, pool: "excluded", key: DEPT }],
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, [ref(1)]);
});

test("акт на ноль рублей не блокирует месяц и не создаёт источник", () => {
  const docs = [doc(1, [0]), doc(2, [0, 0]), doc(3, [0.4], { kind: "personal" })];
  // Без пометки: не unresolved.
  const bare = writeoffPoolSources(docs, []);
  assert.deepEqual(bare.sources, []);
  assert.deepEqual(bare.unresolved, []);
  // С пометкой: тоже ни одного источника на ноль.
  const marked = writeoffPoolSources(docs, [shared(1), shared(2), shared(3)]);
  assert.deepEqual(marked.sources, []);
  assert.deepEqual(marked.unresolved, []);
  // Журнал: видно и можно разнести, но это не «Не разнесён».
  assert.equal(writeoffPoolState(docs[0], undefined), "not_needed");
  assert.equal(writeoffPoolState(docs[0], shared(1)), "assigned");
});

test("ноль рублей не прячет неизвестную сумму и копейки вверх", () => {
  // 0,40 в командном акте — вверх, это уже 1 ₽ и акт нужно разнести.
  const r = writeoffPoolSources([doc(1, [0.4]), doc(2, [0, null])], []);
  assert.deepEqual(r.unresolved, [ref(1), ref(2)]);
});

test("вид business: синхронизация legacyAmount не считает, расчёт считает вверх, если акт разнесён", () => {
  const rules: WriteoffRules = {
    storeIds: [1],
    timezone: "Europe/Moscow",
    personalOperatorIds: [],
    teamReasons: [],
    masterReasons: [],
  };
  const n = normalizeWriteoff(
    {
      id: 200,
      documentNumber: "B-1",
      processed: true,
      invoiceDate: "2026-10-05T12:00:00+03:00",
      customerType: "SPECIAL",
      store: { id: 1, title: "Основной" },
      discardReason: { id: 1, description: "Порча" },
      totalSum: 20.02,
      invoiceItems: [10.01, 10.01].map((fixedTotalSum, i) => ({
        id: i + 1,
        product: { id: i + 1, name: `Товар ${i + 1}` },
        actualAmount: 1,
        fixedTotalSum,
      })),
    },
    rules,
  );
  assert.equal(n.kind, "business");
  assert.equal(n.legacyTotal, null);
  const r = writeoffPoolSources(
    [{ venue_id: V, external_id: n.id, missing_at: null, payload: n }],
    [{ ...shared(n.id) }],
  );
  assert.equal(r.sources[0].amount, -22);
});

test("один external_id в двух заведениях: пометка не переходит через заведение", () => {
  const a = doc(7, [100]);
  const b = { ...doc(7, [300]), venue_id: V2 };
  const markA: WriteoffPoolAssignment = shared(7);
  const markB: WriteoffPoolAssignment = {
    venue_id: V2,
    external_id: 7,
    pool: "department",
    key: DEPT,
  };
  // Обе пометки: каждая ложится на свой акт, независимо от порядка.
  for (const marks of [[markA, markB], [markB, markA]]) {
    const r = writeoffPoolSources([a, b], marks);
    assert.deepEqual(r.unresolved, []);
    assert.deepEqual(
      r.sources.map((s) => [s.sourceRef, s.pool, s.key, s.amount]),
      [
        [ref(7, V), "shared", null, -100],
        [ref(7, V2), "department", DEPT, -300],
      ],
    );
  }
  // Пометка только заведения V не закрывает такой же ID в V2.
  const only = writeoffPoolSources([a, b], [markA]);
  assert.deepEqual(
    only.sources.map((s) => s.sourceRef),
    [ref(7, V)],
  );
  assert.deepEqual(only.unresolved, [ref(7, V2)]);
  // Журнал: чужая пометка не делает акт «разнесённым».
  assert.equal(writeoffPoolState(b, markA), "unassigned");
  assert.equal(writeoffPoolState(b, markB), "assigned");
});

test("«вся команда» с ключом — битая пометка, а не пул с ключом", () => {
  const r = writeoffPoolSources(
    [doc(1, [50])],
    [{ venue_id: V, external_id: 1, pool: "shared", key: DEPT }],
  );
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.unresolved, [ref(1)]);
});

test("бесконечная и нечисловая сумма позиции — unresolved", () => {
  const r = writeoffPoolSources(
    [doc(1, [Infinity]), doc(2, [NaN]), doc(3, [10])],
    [shared(1), shared(2), shared(3)],
  );
  assert.deepEqual(
    r.sources.map((s) => s.sourceRef),
    [ref(3)],
  );
  assert.deepEqual(r.unresolved, [ref(1), ref(2)]);
});

test("подпись подразделения, которого нет в списке, — «не найдено»", () => {
  const label = writeoffPoolLabel(
    { venue_id: V, external_id: 1, pool: "department", key: DEPT },
    { departments: new Map(), employees: new Map() },
  );
  assert.equal(label, "Подразделение: не найдено");
});
