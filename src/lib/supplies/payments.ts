import { z } from "zod";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Некорректная дата сверки");
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const cents = z.number().int().nonnegative().max(1e12);
export const supplyExpenseSchema = z
  .object({
    id,
    date: day,
    amountCents: cents.refine((v) => v > 0),
    currency: z.literal("RUB"),
    actual: z.literal(true),
    categoryId: id,
    projectId: id.nullable(),
    description: z.string().max(4000),
    bankId: id.nullable(),
    bankName: z.string().max(500),
    counterpartyId: id.nullable(),
    counterpartyName: z.string().max(500).nullable(),
    sourceRow: z.string().max(100),
  })
  .strict();
export type SupplyExpense = z.infer<typeof supplyExpenseSchema>;
export const paymentComparisonInputSchema = z
  .object({
    invoiceSource: z
      .object({
        complete: z.literal(true),
        count: z.number().int().nonnegative(),
        checkedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    source: z
      .object({
        complete: z.literal(true),
        count: z.number().int().nonnegative(),
        amountCents: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        checkedAt: z.string().datetime({ offset: true }),
        from: day,
        to: day,
        categoryId: id,
        projectId: id,
      })
      .strict(),
    invoices: z
      .array(
        z
          .object({
            id,
            number: z.string().min(1).max(500),
            invoiceDate: day,
            amountCents: cents,
            providerId: id.nullable(),
            providerName: z.string().max(500).nullable(),
            paid: z.boolean(),
            processed: z.boolean(),
          })
          .strict(),
      )
      .max(30000),
    expenses: z.array(supplyExpenseSchema).max(30000),
  })
  .strict();
export type PaymentComparisonInput = z.infer<
  typeof paymentComparisonInputSchema
>;
export type PaymentProposal = {
  invoiceId: number;
  expenseId: number;
  invoiceDate: string;
  expenseDate: string;
  number: string;
  providerName: string | null;
  counterpartyName: string | null;
  invoiceCents: number;
  expenseCents: number;
  differenceCents: number;
  evidence: "number_and_amount" | "number" | "name_and_amount";
  counterpartiesAgree: boolean;
  sourceSaysPaid: boolean;
  processed: boolean;
  scope: "venue" | "unassigned";
  ambiguous: boolean;
};
const textValue = (value: string | null) =>
  (value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[\s\uFEFF]+/g, " ")
    .trim();
const normalized = (value: string | null) =>
  textValue(value).replace(/[«»"']/g, "");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A reference is evidence for human reconciliation, never permission to post.
 * Short numbers require an explicit document marker or a whole-description match;
 * otherwise dates, tax rates and amounts could impersonate an invoice number. */
function referenceMatcher(number: string) {
  const reference = textValue(number);
  if (!reference || /^накладная №\d+$/.test(reference)) return () => false;
  const literal = escape(reference);
  let expression: RegExp | undefined;
  return (text: string) => {
    if (text === reference) return true;
    if (!text.includes(reference)) return false;
    expression ??= /^\d{1,4}$/.test(reference)
      ? new RegExp(`(?:№|#)\\s*${literal}(?![\\p{L}\\p{N}])`, "u")
      : new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, "u");
    return expression.test(text);
  };
}
export function mentionsInvoice(description: string, number: string): boolean {
  return referenceMatcher(number)(textValue(description));
}

/** Complete comparison only. No implicit pairing by row order, fuzzy word matching,
 * rounding tolerance, automatic creation or money mutation. Even a unique reference
 * remains a proposal until its source/contractor/payment allocation is confirmed. */
export function compareSupplyExpenses(input: PaymentComparisonInput) {
  const data = paymentComparisonInputSchema.parse(input),
    { source, invoices, expenses } = data;
  if (invoices.length * expenses.length > 5_000_000)
    throw Error(
      "Сверяйте большой журнал по отдельным периодам, без сокращения источника",
    );
  if (
    source.from > source.to ||
    source.count !== expenses.length ||
    data.invoiceSource.count !== invoices.length ||
    new Set(expenses.map((e) => e.id)).size !== expenses.length ||
    new Set(invoices.map((i) => i.id)).size !== invoices.length
  )
    throw Error("Не подтверждены полнота и уникальные ID источников сверки");
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  if (
    !Number.isSafeInteger(total) ||
    total !== source.amountCents ||
    expenses.some(
      (e) =>
        e.date < source.from ||
        e.date > source.to ||
        e.categoryId !== source.categoryId ||
        (e.projectId !== null && e.projectId !== source.projectId),
    )
  )
    throw Error(
      "Период, статья, заведение или контрольная сумма расходов не совпали",
    );
  const proposals: PaymentProposal[] = [];
  const prepared = invoices.map((invoice) => ({
    invoice,
    matches: referenceMatcher(invoice.number),
    party: normalized(invoice.providerName),
  }));
  for (const expense of expenses) {
    const memo = textValue(expense.description),
      party = normalized(expense.counterpartyName);
    const references = prepared
      .filter((p) => p.matches(memo))
      .map((p) => p.invoice);
    // A weaker name/amount suggestion must not displace a literal document reference.
    const candidates = references.length
      ? references
      : prepared
          .filter(
            (p) =>
              p.invoice.amountCents === expense.amountCents &&
              !!p.party &&
              p.party === party,
          )
          .map((p) => p.invoice);
    for (const invoice of candidates)
      proposals.push({
        invoiceId: invoice.id,
        expenseId: expense.id,
        invoiceDate: invoice.invoiceDate,
        expenseDate: expense.date,
        number: invoice.number,
        providerName: invoice.providerName,
        counterpartyName: expense.counterpartyName,
        invoiceCents: invoice.amountCents,
        expenseCents: expense.amountCents,
        differenceCents: expense.amountCents - invoice.amountCents,
        evidence: references.length
          ? invoice.amountCents === expense.amountCents
            ? "number_and_amount"
            : "number"
          : "name_and_amount",
        counterpartiesAgree:
          !!invoice.providerName &&
          normalized(invoice.providerName) ===
            normalized(expense.counterpartyName),
        sourceSaysPaid: invoice.paid,
        processed: invoice.processed,
        scope: expense.projectId === source.projectId ? "venue" : "unassigned",
        ambiguous: false,
      });
  }
  const byExpense = new Map<number, number>(),
    byInvoice = new Map<number, number>();
  for (const p of proposals) {
    byExpense.set(p.expenseId, (byExpense.get(p.expenseId) ?? 0) + 1);
    byInvoice.set(p.invoiceId, (byInvoice.get(p.invoiceId) ?? 0) + 1);
  }
  for (const p of proposals)
    p.ambiguous =
      byExpense.get(p.expenseId)! > 1 || byInvoice.get(p.invoiceId)! > 1;
  const exact = proposals.filter(
    (p) =>
      p.evidence === "number_and_amount" &&
      !p.ambiguous &&
      p.scope === "venue" &&
      p.processed,
  );
  return {
    source,
    invoiceSource: data.invoiceSource,
    counts: {
      invoices: invoices.length,
      expenses: expenses.length,
      proposals: proposals.length,
      uniqueNumberAndAmount: exact.length,
      differentAmount: proposals.filter(
        (p) => p.evidence === "number" && !p.ambiguous && p.scope === "venue",
      ).length,
      ambiguousExpenses: new Set(
        proposals.filter((p) => p.ambiguous).map((p) => p.expenseId),
      ).size,
      unassigned: expenses.filter((e) => e.projectId === null).length,
    },
    proposals,
    expensesWithoutReference: expenses
      .filter(
        (e) =>
          !proposals.some(
            (p) => p.expenseId === e.id && p.evidence !== "name_and_amount",
          ),
      )
      .map((e) => e.id),
    invoicesWithoutReference: invoices
      .filter(
        (i) =>
          i.invoiceDate >= source.from &&
          i.invoiceDate <= source.to &&
          !proposals.some(
            (p) => p.invoiceId === i.id && p.evidence !== "name_and_amount",
          ),
      )
      .map((i) => i.id),
    sourceUnpaidWithExactExpense: exact
      .filter((p) => !p.sourceSaysPaid)
      .map((p) => ({ invoiceId: p.invoiceId, expenseId: p.expenseId })),
    confirmedLinks: 0,
  };
}
