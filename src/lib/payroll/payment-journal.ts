import type { PayrollData, Payment } from "./types";
export type PaymentJournalRow = {
  id: string;
  date: string;
  transactionId: string | null;
  earningMonths: string[];
  employee: string;
  roleName?: string;
  avatarUrl?: string | null;
  kind: string;
  amount: number;
  /** Debt settled includes tax; cash still comes from the financial operation. */
  settledAmount?: number;
  taxAmount?: number;
  status: string;
  posted: boolean;
  external?: boolean;
};
export function paymentJournalRows(
  data: PayrollData,
  payments: Payment[],
  financeMonth?: string,
  financeRole?: string,
): PaymentJournalRow[] {
  return [
    ...payments.map((payment) => ({
      id: payment.id,
      date: payment.occurred_at,
      transactionId: payment.transaction_id,
      earningMonths: [
        ...new Set(
          data.allocations
            .filter((a) => a.payment_id === payment.id)
            .map((a) => a.month),
        ),
      ].sort(),
      employee: [
        ...new Set(
          data.allocations
            .filter((a) => a.payment_id === payment.id)
            .map(
              (a) =>
                data.employees.find((e) => e.id === a.employee_id)?.name ??
                "Сотрудник",
            ),
        ),
      ].join(", "),
      ...(() => {
        const ids = [
          ...new Set(
            data.allocations
              .filter((a) => a.payment_id === payment.id)
              .map((a) => a.employee_id),
          ),
        ];
        const employee =
          ids.length === 1
            ? data.employees.find((e) => e.id === ids[0])
            : undefined;
        return {
          roleName: employee?.role_name,
          avatarUrl: employee?.avatar_url,
        };
      })(),
      kind:
        data.financeTransactions?.find((t) => t.id === payment.transaction_id)
          ?.category_name ??
        (payment.kind === "tips" ? "Чаевые" : "Фонд оплаты труда"),
      amount: Number(payment.amount),
      ...paymentSettlement(
        data.allocations.filter((a) => a.payment_id === payment.id),
        Number(payment.amount),
      ),
      status: payment.state === "posted" ? "Проведена" : "Удалена",
      posted: payment.state === "posted",
    })),
    ...(financeMonth
      ? (data.financeTransactions ?? [])
          .filter(
            (t) =>
              !data.payments.some((p) => p.transaction_id === t.id) &&
              new Intl.DateTimeFormat("sv-SE", { timeZone: data.timezone })
                .format(new Date(t.date))
                .startsWith(financeMonth.slice(0, 7)) &&
              (!financeRole || t.category_name === financeRole),
          )
          .map((t) => ({
            id: t.id,
            date: t.date,
            transactionId: t.id,
            earningMonths: [],
            employee: t.description || t.category_name,
            kind: t.category_name,
            amount: Number(t.amount),
            status: t.deleted_at ? "Удалена" : "Проведена",
            posted: !t.deleted_at,
            external: true,
          }))
      : []),
  ];
}

export function paymentSettlement(
  allocations: PayrollData["allocations"],
  cash: number,
): { settledAmount?: number; taxAmount?: number } {
  // A restricted view may contain only part of an old group payment.
  // Do not present that partial gross as the total or invent tax for finance-only rows.
  if (!allocations.length || !Number.isFinite(cash)) return {};
  const cashCents = allocations.reduce(
    (s, a) => s + Math.round(Number(a.amount) * 100),
    0,
  );
  const grossCents = allocations.reduce(
    (s, a) => s + Math.round(Number(a.settled_amount ?? a.amount) * 100),
    0,
  );
  if (
    !Number.isSafeInteger(grossCents) ||
    cashCents !== Math.round(cash * 100) ||
    grossCents < cashCents
  )
    return {};
  return {
    settledAmount: grossCents / 100,
    taxAmount: (grossCents - cashCents) / 100,
  };
}
