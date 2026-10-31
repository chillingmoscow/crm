import { z } from "zod";
import { dayWindow, validDate } from "./time";

const uuid = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const fee = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .refine(
    (v) => Math.abs(v * 10000 - Math.round(v * 10000)) < 0.000001,
    "Укажите процент не более чем с четырьмя знаками после запятой",
  );
export const settlementSettingsSchema = z
  .object({
    venueId: uuid,
    timezone: z.string().min(1),
    dayStartHour: z.number().int().min(0).max(23),
    revenueCategoryId: uuid,
    methods: z
      .array(
        z
          .object({
            paymentTypeId: positiveId,
            bankAccountId: uuid.nullable(),
            excluded: z.enum(["bonus", "no_payment"]).nullable(),
            feePercent: fee,
            feeAccounting: z.enum(["net", "separate"]),
          })
          .strict(),
      )
      .max(100),
    personal: z
      .object({
        payerId: positiveId,
        bankAccountId: uuid,
        incomeCategoryId: uuid,
        expenseCategoryId: uuid,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      new Set(s.methods.map((m) => m.paymentTypeId)).size !== s.methods.length
    )
      c.addIssue({
        code: "custom",
        message: "Способ оплаты указан несколько раз",
      });
    if (
      s.methods.some((m) =>
        m.excluded
          ? m.bankAccountId !== null || m.feePercent !== 0
          : !m.bankAccountId,
      )
    )
      c.addIssue({
        code: "custom",
        message: "Назначьте счёт или исключите способ оплаты",
      });
  });
export type SettlementSettings = z.infer<typeof settlementSettingsSchema>;
type Payment = { id: number; typeId: number; amountCents: number };
export type SettlementReceipt = {
  id: number;
  createdAt: number;
  payerId: number | null;
  excluded: "returned" | "deleted" | null;
  cost: number | null;
  payments: Payment[];
};

function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Некорректный ответ Quick Resto");
  return v as Record<string, unknown>;
}
function finite(v: unknown, field: string) {
  if (
    v == null ||
    v === "" ||
    typeof v === "boolean" ||
    !Number.isFinite(Number(v))
  )
    throw new Error(`Не подтверждено числовое поле: ${field}`);
  return Number(v);
}
function id(v: unknown, field: string) {
  const n = finite(v, field);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`Некорректный ID: ${field}`);
  return n;
}
function cents(v: unknown, field: string) {
  const n = finite(v, field);
  if (
    n < 0 ||
    n > 100000000 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.000001
  )
    throw new Error(`Некорректная денежная сумма: ${field}`);
  return Math.round(n * 100);
}

/** One response is bound to its requested order, never to an HTTP-response array index. */
export function normalizeSettlementReceipt(input: {
  order: unknown;
  detail: unknown;
  payments: { orderId: number; complete: boolean; rows: unknown[] } | null;
}): SettlementReceipt {
  const raw = record(input.order),
    order = record(raw.object ?? raw);
  const rawDetail = record(input.detail),
    detail = record(rawDetail.data ?? rawDetail);
  const orderId = id(order.id, "чек");
  if (id(detail.id, "детали чека") !== orderId)
    throw new Error("Детали относятся к другому чеку");
  if (
    typeof order.returned !== "boolean" ||
    typeof detail.returned !== "boolean"
  )
    throw new Error(`Не подтверждён статус возврата чека ${orderId}`);
  const returnId =
    detail.returnId == null ? 0 : finite(detail.returnId, "возврат");
  if (!Number.isSafeInteger(returnId) || returnId < 0)
    throw new Error("Некорректный ID возврата");
  const returned = order.returned || detail.returned || returnId > 0;
  const status = String(order.status ?? order.state ?? "").toLowerCase();
  const deleted =
    order.deleted === true ||
    detail.deleted === true ||
    [
      "cancelled",
      "canceled",
      "returned",
      "deleted",
      "void",
      "voided",
      "refunded",
    ].includes(status);
  const base = {
    id: orderId,
    createdAt: finite(order.createDate, "дата чека"),
    payerId:
      order.payer == null ? null : id(record(order.payer).id, "плательщик"),
    excluded: returned
      ? ("returned" as const)
      : deleted
        ? ("deleted" as const)
        : null,
  };
  if (base.excluded) return { ...base, cost: null, payments: [] };
  if (
    !input.payments?.complete ||
    input.payments.orderId !== orderId ||
    !Array.isArray(input.payments.rows)
  )
    throw new Error(`Не подтверждены все платежи чека ${orderId}`);
  const payments = input.payments.rows.map((raw): Payment => {
    const row = record(raw),
      p = record(row.object ?? row),
      type = record(p.paymentType);
    // Some QR versions include an owner in each payment; validate it when present.
    if (
      p.ownerContextId != null &&
      id(p.ownerContextId, "владелец платежа") !== orderId
    )
      throw new Error("Платёж относится к другому чеку");
    return {
      id: id(p.id, "платёж"),
      typeId: id(type.id, "способ оплаты"),
      amountCents: cents(p.amount, "платёж"),
    };
  });
  let cost: number | null = null;
  if (Array.isArray(detail.orderItemList)) {
    let total = 0,
      known = true;
    for (const rawLine of detail.orderItemList) {
      const line = record(rawLine);
      if (line.costPrice == null || line.amount == null) {
        known = false;
        continue;
      }
      const price = finite(line.costPrice, "себестоимость"),
        quantity = finite(line.amount, "количество");
      if (price < 0 || (quantity < 0 && price !== 0)) {
        known = false;
        continue;
      }
      total += price * quantity;
    }
    if (known && Number.isFinite(total) && total >= 0 && total <= 100000000)
      cost = total;
  }
  return { ...base, cost, payments };
}

export type SettlementEffect = {
  key: string;
  kind: "revenue" | "personal_income" | "personal_expense";
  date: string;
  bankAccountId: string;
  categoryId: string;
  type: "income" | "expense";
  amount: number;
  description: string;
};
export type SettlementPlan = {
  venueId: string;
  date: string;
  legacyScope: Pick<SettlementSettings, "revenueCategoryId" | "personal">;
  receipts: number;
  returnedIds: number[];
  deletedIds: number[];
  excludedPayments: { reason: "bonus" | "no_payment"; amount: number }[];
  methods: {
    paymentTypeId: number;
    bankAccountId: string;
    gross: number;
    amount: number;
    feePercent: number;
    feeAccounting: "net" | "separate";
  }[];
  personalCost: number;
  personalReceiptIds: number[];
  effects: SettlementEffect[];
};
export function settlementPrefix(venueId: string, date: string) {
  return `qr:daily-settlement:${venueId}:${date}:`;
}
/** Calculation only. Does not mutate revenue/tips, ledger, bank balances, or any provider. */
export function calculateSettlement(input: {
  date: string;
  complete: boolean;
  expectedOrderIds: number[];
  receipts: SettlementReceipt[];
  settings: SettlementSettings;
}): SettlementPlan {
  const s = settlementSettingsSchema.parse(input.settings);
  if (!validDate(input.date) || !input.complete)
    throw new Error("Нужна полная выгрузка рабочего дня");
  const expected = new Set(input.expectedOrderIds);
  if (
    expected.size !== input.expectedOrderIds.length ||
    [...expected].some((n) => !Number.isSafeInteger(n) || n <= 0) ||
    input.receipts.length !== expected.size ||
    new Set(input.receipts.map((r) => r.id)).size !== expected.size ||
    input.receipts.some((r) => !expected.has(r.id))
  )
    throw new Error("Неполные или повторяющиеся чеки рабочего дня");
  const window = dayWindow(input.date, s.timezone, s.dayStartHour);
  const sums = new Map<number, number>(),
    seenPayments = new Set<number>();
  const exclusions = new Map<"bonus" | "no_payment", number>();
  const personalReceiptIds: number[] = [],
    returnedIds: number[] = [],
    deletedIds: number[] = [];
  let cost = 0;
  for (const r of input.receipts) {
    if (
      !Number.isFinite(r.createdAt) ||
      r.createdAt < window.start ||
      r.createdAt >= window.end
    )
      throw new Error("Чек за пределами рабочего дня");
    if (r.excluded) {
      (r.excluded === "returned" ? returnedIds : deletedIds).push(r.id);
      continue;
    }
    for (const p of r.payments) {
      if (
        !Number.isSafeInteger(p.id) ||
        p.id <= 0 ||
        !Number.isSafeInteger(p.amountCents) ||
        p.amountCents < 0 ||
        seenPayments.has(p.id)
      )
        throw new Error("Некорректные или повторяющиеся платежи");
      seenPayments.add(p.id);
      const method = s.methods.find((m) => m.paymentTypeId === p.typeId);
      if (!method)
        throw new Error(`Не настроен способ оплаты Quick Resto №${p.typeId}`);
      if (method.excluded)
        exclusions.set(
          method.excluded,
          (exclusions.get(method.excluded) ?? 0) + p.amountCents,
        );
      else sums.set(p.typeId, (sums.get(p.typeId) ?? 0) + p.amountCents);
    }
    // Staff cash/card payments are real receipts and remain included here.
    // Staff exclusion belongs to turnover calculation, which this module never changes.
    if (s.personal && r.payerId === s.personal.payerId) {
      if (r.cost === null || !Number.isFinite(r.cost) || r.cost < 0)
        throw new Error(
          `Нет подтверждённой себестоимости личного чека ${r.id}`,
        );
      cost += r.cost;
      personalReceiptIds.push(r.id);
    }
  }
  if (!Number.isFinite(cost) || cost > 100000000)
    throw new Error("Проверьте итог личного потребления");
  const methods = [...sums]
    .sort(([a], [b]) => a - b)
    .map(([paymentTypeId, grossCents]) => {
      if (!Number.isSafeInteger(grossCents) || grossCents > 10000000000)
        throw new Error("Проверьте сумму поступлений");
      const method = s.methods.find((m) => m.paymentTypeId === paymentTypeId)!;
      // Preserve legacy rounding: apply fee and round each payment type to whole RUB,
      // then combine types targeting the same bank. Separate bank commissions are not subtracted twice.
      const retained = BigInt(
        method.feeAccounting === "net"
          ? 1000000 - Math.round(method.feePercent * 10000)
          : 1000000,
      );
      const denominator = BigInt(100000000);
      const amount = Number(
        (BigInt(grossCents) * retained + denominator / BigInt(2)) / denominator,
      );
      return {
        paymentTypeId,
        bankAccountId: method.bankAccountId!,
        gross: grossCents / 100,
        amount,
        feePercent: method.feePercent,
        feeAccounting: method.feeAccounting,
      };
    });
  const byBank = new Map<string, number>();
  for (const m of methods)
    byBank.set(m.bankAccountId, (byBank.get(m.bankAccountId) ?? 0) + m.amount);
  const prefix = settlementPrefix(s.venueId, input.date),
    effects: SettlementEffect[] = [];
  for (const [bankAccountId, amount] of [...byBank].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (amount > 0)
      effects.push({
        key: `${prefix}revenue:${bankAccountId}`,
        kind: "revenue",
        date: input.date,
        bankAccountId,
        categoryId: s.revenueCategoryId,
        type: "income",
        amount,
        description: "Выручка Quick Resto",
      });
  }
  const personalCost = Math.round(cost);
  if (personalCost > 0 && s.personal) {
    for (const type of ["income", "expense"] as const)
      effects.push({
        key: `${prefix}personal:${type}`,
        kind: type === "income" ? "personal_income" : "personal_expense",
        date: input.date,
        bankAccountId: s.personal.bankAccountId,
        categoryId:
          type === "income"
            ? s.personal.incomeCategoryId
            : s.personal.expenseCategoryId,
        type,
        amount: personalCost,
        description:
          type === "income"
            ? "Личное потребление · поступление"
            : "Личное потребление · расход",
      });
  }
  return {
    venueId: s.venueId,
    date: input.date,
    legacyScope: {
      revenueCategoryId: s.revenueCategoryId,
      personal: s.personal,
    },
    receipts: input.receipts.length,
    returnedIds: returnedIds.sort((a, b) => a - b),
    deletedIds: deletedIds.sort((a, b) => a - b),
    excludedPayments: [...exclusions]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, n]) => ({ reason, amount: n / 100 })),
    methods,
    personalCost,
    personalReceiptIds: personalReceiptIds.sort((a, b) => a - b),
    effects,
  };
}

export type SettlementTransaction = {
  id: string;
  venueId: string;
  sourceKey: string | null;
  date: string;
  bankAccountId: string;
  categoryId: string | null;
  type: "income" | "expense" | "transfer";
  amount: number;
  description: string | null;
  deleted: boolean;
  planned: boolean;
};
const normalizeText = (v: string | null) =>
  (v ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
function legacyMarker(
  t: SettlementTransaction,
  kind: SettlementEffect["kind"],
) {
  const d = normalizeText(t.description);
  return kind === "revenue"
    ? d === "auto"
    : kind === "personal_income"
      ? d === "антон мостяев - чек (auto)"
      : d === "списание по чеку";
}
function warehouseMarker(t: SettlementTransaction) {
  const d = normalizeText(t.description);
  return (
    d === "антон мостяев - списание (auto)" ||
    /^списание товара \(.+\)$/.test(d)
  );
}
export function compareSettlement(
  plan: SettlementPlan,
  rows: SettlementTransaction[],
  complete: boolean,
) {
  if (
    !complete ||
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    rows.some((r) => r.venueId !== plan.venueId)
  )
    throw new Error(
      "Нужен полный список финансовых операций этого заведения без дублей",
    );
  const used = new Set<string>();
  const matches = plan.effects.map((effect) => {
    const exact = rows.filter((r) => r.sourceKey === effect.key);
    const legacy = rows.filter(
      (r) =>
        !r.sourceKey &&
        !warehouseMarker(r) &&
        !r.deleted &&
        r.date === effect.date &&
        r.bankAccountId === effect.bankAccountId &&
        r.categoryId === effect.categoryId &&
        r.type === effect.type,
    );
    const candidates = exact.length ? [...exact, ...legacy] : legacy;
    candidates.forEach((r) => used.add(r.id));
    let state: "missing" | "matched" | "changed" | "review" | "cancelled" =
      "missing";
    if (candidates.length > 1) state = "review";
    else if (candidates.length === 1) {
      const r = candidates[0];
      const native = r.sourceKey === effect.key;
      state =
        r.deleted && native
          ? "cancelled"
          : r.planned || (!native && !legacyMarker(r, effect.kind))
            ? "review"
            : r.date !== effect.date ||
                r.bankAccountId !== effect.bankAccountId ||
                r.categoryId !== effect.categoryId ||
                r.type !== effect.type ||
                cents(r.amount, "операция") !== cents(effect.amount, "расчёт")
              ? "changed"
              : "matched";
    }
    return {
      effect,
      state,
      transactionIds: candidates.map((r) => r.id).sort(),
    };
  });
  const extraNative = rows
    .filter(
      (r) =>
        r.sourceKey?.startsWith(settlementPrefix(plan.venueId, plan.date)) &&
        !r.deleted &&
        !used.has(r.id),
    )
    .map((r) => r.id)
    .sort();
  const personal = plan.legacyScope.personal;
  const extraLegacy = rows
    .filter(
      (r) =>
        !r.sourceKey &&
        !r.deleted &&
        r.date === plan.date &&
        !used.has(r.id) &&
        ((r.categoryId === plan.legacyScope.revenueCategoryId &&
          r.type === "income" &&
          legacyMarker(r, "revenue")) ||
          (personal &&
            r.bankAccountId === personal.bankAccountId &&
            ((r.categoryId === personal.incomeCategoryId &&
              r.type === "income" &&
              legacyMarker(r, "personal_income")) ||
              (r.categoryId === personal.expenseCategoryId &&
                r.type === "expense" &&
                legacyMarker(r, "personal_expense"))))),
    )
    .map((r) => r.id)
    .sort();
  return {
    matches,
    extraNative,
    extraLegacy,
    ready:
      extraNative.length === 0 &&
      extraLegacy.length === 0 &&
      matches.every((r) => r.state === "matched" || r.state === "cancelled"),
  };
}
