import { z } from "zod";
import { validDate, zonedParts } from "./time";

// Only linear expressions: text, character classes, alternatives, one .* per branch.
// Nested quantifiers/groups/backreferences are not accepted in editable routing rules.
const pattern = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => {
    if (!/^[\p{L}\p{N}\s_\-\[\]|.*]+$/u.test(s)) return false;
    if (
      s
        .split("|")
        .some(
          (p) =>
            !p ||
            (p.match(/\.\*/g)?.length ?? 0) > 1 ||
            /[.*]/.test(p.replace(/\.\*/g, "")),
        )
    )
      return false;
    try {
      new RegExp(s, "iu");
      return true;
    } catch {
      return false;
    }
  }, "Проверьте правило распознавания комментария");
const id = z
  .string()
  .min(1, "Выберите все счета и статьи")
  .max(100)
  .transform((s) => s.toLowerCase());
export const cashMovementOverridesSchema = z
  .array(
    z
      .object({
        sourceId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        date: z.string().refine(validDate, "Укажите дату смены"),
        amountCents: z.number().int().positive().max(100000000000),
        comment: z.string().max(2000),
        route: z.enum(["safe", "operating", "hold"]),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict(),
  )
  .max(1000)
  .refine(
    (rows) => new Set(rows.map((r) => r.sourceId)).size === rows.length,
    "Операция повторяется в исключениях",
  );
export const cashMovementRulesSchema = z
  .object({
    cashAccountId: id,
    safeAccountId: id,
    operatingAccountId: id,
    incomeCategoryId: id,
    taxiCategoryId: id,
    tipsCategoryId: id,
    safePattern: pattern,
    taxiPattern: pattern,
    tipsPattern: pattern,
    lookbackDays: z.number().int().min(1).max(90),
    intervalMinutes: z.number().int().min(15).max(1440),
    autoRead: z.boolean(),
    overrides: cashMovementOverridesSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      new Set([s.cashAccountId, s.safeAccountId, s.operatingAccountId]).size !==
      3
    )
      ctx.addIssue({
        code: "custom",
        message: "Касса, сейф и операционный счёт должны отличаться",
      });
  });
export type CashMovementRules = z.infer<typeof cashMovementRulesSchema>;
export const cashMovementDefaults = {
  safePattern: "инкас|инк.*ация",
  taxiPattern: "такси",
  tipsPattern: "ча[йеюёвы]",
  lookbackDays: 30,
  intervalMinutes: 60,
  autoRead: false,
  overrides: [],
} satisfies Partial<CashMovementRules>;
export type CashMovement = {
  id: number;
  date: string;
  amountCents: number;
  type: "cashIn" | "cashOut";
  shiftId: number;
  openedAt: string;
  occurredAt: string;
  arrivedAt: string;
  comment: string;
};
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Некорректная операция кассы Quick Resto");
  return v as Obj;
};
const identifier = (v: unknown) => {
  const n = Number(v);
  if (
    v == null ||
    v === "" ||
    (typeof v !== "number" && typeof v !== "string") ||
    !Number.isSafeInteger(n) ||
    n <= 0
  )
    throw new Error("Некорректный номер кассовой операции");
  return n;
};
export const movementCents = (v: unknown) => {
  const n = Number(v);
  if (
    v == null ||
    v === "" ||
    (typeof v !== "number" && typeof v !== "string") ||
    !Number.isFinite(n) ||
    n <= 0 ||
    n > 1000000000 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 1e-6
  )
    throw new Error("Не подтверждена сумма кассовой операции");
  return Math.round(n * 100);
};
const timestamp = (v: unknown) => {
  if (
    typeof v !== "string" ||
    !validDate(v.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new Error("Не подтверждена дата кассовой операции");
  return new Date(v).toISOString();
};
export function normalizeCashMovements(
  raw: unknown,
  scope: { from: string; through: string; timezone: string },
): CashMovement[] {
  if (
    !validDate(scope.from) ||
    !validDate(scope.through) ||
    scope.from > scope.through ||
    !Array.isArray(raw) ||
    raw.length > 10000
  )
    throw new Error("Не подтверждён полный список кассовых операций");
  const seen = new Set<number>(),
    rows: CashMovement[] = [];
  for (const input of raw) {
    const r = object(input),
      ident = identifier(r.id),
      shift = object(r.shift),
      openedAt = timestamp(shift.opened);
    if (
      seen.has(ident) ||
      r.deleted === true ||
      typeof r.typeTransaction !== "string" ||
      !["cashIn", "cashOut"].includes(String(r.typeTransaction))
    )
      throw new Error("Удалённая, повторная или неизвестная кассовая операция");
    seen.add(ident);
    const date = zonedParts(new Date(openedAt), scope.timezone).date;
    if (
      typeof shift.localOpenedTime !== "string" ||
      !validDate(shift.localOpenedTime.slice(0, 10)) ||
      date !== shift.localOpenedTime.slice(0, 10)
    )
      throw new Error(`Не совпадают даты кассовой смены #${ident}`);
    const amountCents = movementCents(r.amount),
      shiftId = identifier(shift.id),
      occurredAt = timestamp(r.timeEncashment),
      arrivedAt = timestamp(r.serverRegisterTime);
    if (
      r.comment != null &&
      (typeof r.comment !== "string" || r.comment.length > 2000)
    )
      throw new Error("Не подтверждён комментарий кассовой операции");
    if (date < scope.from || date > scope.through) continue;
    rows.push({
      id: ident,
      date,
      amountCents,
      type: r.typeTransaction as CashMovement["type"],
      shiftId,
      openedAt,
      occurredAt,
      arrivedAt,
      comment: String(r.comment ?? ""),
    });
  }
  return rows.sort((a, b) => a.id - b.id);
}
export function sameCashMovements(a: CashMovement[], b: CashMovement[]) {
  const canonical = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical((v as Obj)[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
  return canonical(a) === canonical(b);
}
export type MovementPlan = {
  key: string;
  label: string;
  date: string;
  sourceIds: number[];
  type: "income" | "expense" | "transfer";
  bankAccountId: string;
  toBankAccountId: string | null;
  categoryId: string | null;
  amountCents: number;
};
export type MovementReview = { sourceId: number; message: string };
export function planCashMovements(
  venueId: string,
  rows: CashMovement[],
  rawRules: CashMovementRules,
) {
  const rules = cashMovementRulesSchema.parse(rawRules),
    plans: MovementPlan[] = [],
    review: MovementReview[] = [];
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error("Кассовые операции повторяются");
  const patterns = {
    safe: new RegExp(rules.safePattern, "iu"),
    taxi: new RegExp(rules.taxiPattern, "iu"),
    tips: new RegExp(rules.tipsPattern, "iu"),
  };
  const taxi = new Map<string, CashMovement[]>();
  for (const row of rows) {
    const override = rules.overrides.find((o) => o.sourceId === row.id);
    if (
      override &&
      (override.date !== row.date ||
        override.amountCents !== row.amountCents ||
        override.comment.trim().toLowerCase() !==
          row.comment.trim().toLowerCase())
    ) {
      review.push({
        sourceId: row.id,
        message: "Операция изменилась после ручного решения",
      });
      continue;
    }
    if (override?.route === "hold") {
      review.push({ sourceId: row.id, message: override.reason });
      continue;
    }
    if (!override && /не\s+(сдел|пров|работ)/iu.test(row.comment)) {
      review.push({
        sourceId: row.id,
        message: "По комментарию требуется ручная сверка",
      });
      continue;
    }
    if (row.type === "cashIn") {
      if (override) {
        review.push({
          sourceId: row.id,
          message: "Исключение маршрута не применяется к внесению",
        });
        continue;
      }
      plans.push({
        key: `qr:cash-movement:${venueId}:${row.id}:income`,
        label: "Внесение",
        date: row.date,
        sourceIds: [row.id],
        type: "income",
        bankAccountId: rules.cashAccountId,
        toBankAccountId: null,
        categoryId: rules.incomeCategoryId,
        amountCents: row.amountCents,
      });
      continue;
    }
    const safe = override
      ? override.route === "safe"
      : patterns.safe.test(row.comment);
    const isTaxi = !safe && patterns.taxi.test(row.comment),
      tips = !safe && patterns.tips.test(row.comment);
    if (isTaxi && tips) {
      review.push({
        sourceId: row.id,
        message: "Комментарий одновременно указывает на такси и чаевые",
      });
      continue;
    }
    plans.push({
      key: `qr:cash-movement:${venueId}:${row.id}:transfer`,
      label: safe ? "Инкассация в сейф" : "Перевод на операционный счёт",
      date: row.date,
      sourceIds: [row.id],
      type: "transfer",
      bankAccountId: rules.cashAccountId,
      toBankAccountId: safe ? rules.safeAccountId : rules.operatingAccountId,
      categoryId: null,
      amountCents: row.amountCents,
    });
    if (isTaxi) taxi.set(row.date, [...(taxi.get(row.date) ?? []), row]);
    if (tips)
      plans.push({
        key: `qr:cash-movement:${venueId}:${row.id}:tips`,
        label: "Выдача чаевых",
        date: row.date,
        sourceIds: [row.id],
        type: "expense",
        bankAccountId: rules.operatingAccountId,
        toBankAccountId: null,
        categoryId: rules.tipsCategoryId,
        amountCents: row.amountCents,
      });
  }
  for (const [date, members] of taxi)
    plans.push({
      key: `qr:cash-movement:${venueId}:taxi:${date}`,
      label: "Такси",
      date,
      sourceIds: members.map((r) => r.id).sort((a, b) => a - b),
      type: "expense",
      bankAccountId: rules.operatingAccountId,
      toBankAccountId: null,
      categoryId: rules.taxiCategoryId,
      amountCents: members.reduce((s, r) => s + r.amountCents, 0),
    });
  return {
    plans: plans.sort(
      (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
    ),
    review,
  };
}
export type MovementTransaction = {
  id: string;
  venueId: string | null;
  sourceKey: string | null;
  sourceIds?: number[];
  date: string;
  type: string;
  bankAccountId: string;
  toBankAccountId: string | null;
  categoryId: string | null;
  amountCents: number;
  description: string;
  deleted: boolean;
  planned: boolean;
};
const markers = (s: string) =>
  [...s.matchAll(/#(\d+)(?!\d)/g)].map((m) => Number(m[1]));
export function compareCashMovements(input: {
  venueId: string;
  plans: MovementPlan[];
  source: CashMovement[];
  transactions: MovementTransaction[];
  complete: boolean;
}) {
  if (
    !input.complete ||
    new Set(input.transactions.map((t) => t.id)).size !==
      input.transactions.length
  )
    throw new Error("Не подтверждён полный журнал операций");
  const byId = new Map(input.source.map((r) => [r.id, r]));
  return input.plans.map((plan) => {
    const sourceIds = new Set(plan.sourceIds);
    // A payroll expense with the same #ID is not a transfer, and vice versa.
    const candidates = input.transactions.filter(
      (t) =>
        t.sourceKey === plan.key ||
        ((plan.type === "transfer"
          ? t.type === "transfer"
          : t.type !== "transfer") &&
          (t.sourceIds?.length ? t.sourceIds : markers(t.description)).some(
            (i) => sourceIds.has(i),
          )),
    );
    const problems: string[] = [];
    if (candidates.length === 0) {
      const similar = input.transactions.filter(
        (t) =>
          !t.deleted &&
          !t.planned &&
          t.venueId === input.venueId &&
          t.date === plan.date &&
          t.type === plan.type &&
          t.bankAccountId === plan.bankAccountId &&
          t.amountCents === plan.amountCents &&
          (plan.type !== "expense" || t.categoryId === plan.categoryId),
      );
      if (similar.length)
        return {
          plan,
          state: "conflict" as const,
          transactionIds: similar.map((t) => t.id),
          problems: [
            "Есть похожая операция без подтверждённой связи с Quick Resto",
          ],
        };
      return {
        plan,
        state: "missing" as const,
        transactionIds: [],
        problems: ["В Sheerly нет связанной операции"],
      };
    }
    const used = new Set<number>();
    for (const t of candidates) {
      const ids =
        t.sourceKey === plan.key
          ? plan.sourceIds
          : t.sourceIds?.length
            ? t.sourceIds
            : markers(t.description);
      if (
        t.deleted ||
        t.planned ||
        t.venueId !== input.venueId ||
        t.date !== plan.date ||
        t.type !== plan.type ||
        t.bankAccountId !== plan.bankAccountId ||
        t.toBankAccountId !== plan.toBankAccountId ||
        t.categoryId !== plan.categoryId
      )
        problems.push("Не совпадают дата, состояние, счета или статья");
      if (
        !ids.length ||
        new Set(ids).size !== ids.length ||
        ids.some((i) => !sourceIds.has(i) || used.has(i))
      )
        problems.push("Повторная или посторонняя связь с Quick Resto");
      ids.forEach((i) => used.add(i));
      const expected = ids.reduce(
        (s, i) => s + (byId.get(i)?.amountCents ?? NaN),
        0,
      );
      if (!Number.isSafeInteger(t.amountCents) || t.amountCents !== expected)
        problems.push("Не совпадает сумма");
      if (plan.sourceIds.length === 1 && candidates.length !== 1)
        problems.push("Найдено несколько операций");
    }
    if (used.size !== sourceIds.size)
      problems.push("Связаны не все исходные операции");
    return {
      plan,
      state: problems.length ? ("conflict" as const) : ("matched" as const),
      transactionIds: candidates.map((t) => t.id),
      problems: [...new Set(problems)],
    };
  });
}
