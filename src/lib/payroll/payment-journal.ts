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
        const ids = [...new Set(data.allocations.filter((a) => a.payment_id === payment.id).map((a) => a.employee_id))];
        const employee = ids.length === 1 ? data.employees.find((e) => e.id === ids[0]) : undefined;
        return { roleName: employee?.role_name, avatarUrl: employee?.avatar_url };
      })(),
      kind:
        data.financeTransactions?.find((t) => t.id === payment.transaction_id)
          ?.category_name ??
        (payment.kind === "tips" ? "Чаевые" : "Фонд оплаты труда"),
      amount: Number(payment.amount),
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
