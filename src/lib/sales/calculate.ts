import { emptyMetrics, type Metrics, type SalesSettings } from "./types";
export type Order = {
  id: number;
  payer_id: number | null;
  gross: number;
  returned: boolean;
  deleted: boolean;
  status: string;
};
export type OrderDetail = {
  id: number;
  returned: boolean;
  deleted: boolean;
  service: number;
  lines: { product_id: number; amount: number; quantity: number }[];
};
export function number(value: unknown, name: string): number {
  if (value == null || value === "" || typeof value === "boolean")
    throw new Error(`Нет числового значения: ${name}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Некорректная сумма: ${name}`);
  return n;
}
export const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function validOrder(o: Order) {
  return (
    !o.returned &&
    !o.deleted &&
    ![
      "cancelled",
      "canceled",
      "returned",
      "deleted",
      "void",
      "voided",
      "refunded",
    ].includes(o.status.toLowerCase())
  );
}
export function normalizeOrder(row: Record<string, unknown>): Order {
  const o = (row.object ?? row) as Record<string, unknown>;
  const payer = o.payer as { id?: number } | null;
  return {
    id: number(o.id, "id чека"),
    payer_id: payer?.id == null ? null : number(payer.id, "payer.id"),
    gross: number(o.frontTotalPrice, "сумма чека"),
    returned: o.returned === true,
    deleted: o.deleted === true,
    status: String(o.status ?? o.state ?? ""),
  };
}
export function normalizeDetail(
  raw: Record<string, unknown>,
  id: number,
): OrderDetail {
  const d = (raw.data ?? raw) as Record<string, unknown>;
  if (!Array.isArray(d.orderItemList))
    throw new Error(`Нет позиций чека ${id}`);
  if (d.id != null && Number(d.id) !== id)
    throw new Error("Детали относятся к другому чеку");
  return {
    id,
    returned: d.returned === true,
    deleted: d.deleted === true,
    service: number(d.frontTotalAbsoluteCharge ?? 0, "сервисный сбор"),
    lines: d.orderItemList.map((l: Record<string, unknown>) => ({
      product_id: number((l.product as { id?: number })?.id, "позиция чека"),
      amount:
        number(l.totalPrice, "сумма позиции") -
        number(l.totalAbsoluteDiscount ?? 0, "скидка") +
        number(l.totalAbsoluteCharge ?? 0, "надбавка"),
      quantity: number(l.amount ?? 0, "количество"),
    })),
  };
}
export function calculateOrders(
  orders: Order[],
  details: OrderDetail[],
  staffIds: number[],
  settings: SalesSettings,
): Metrics {
  const m = emptyMetrics();
  const staff = new Set(staffIds);
  const byId = new Map(details.map((d) => [d.id, d]));
  if (
    new Set(orders.map((o) => o.id)).size !== orders.length ||
    byId.size !== details.length ||
    orders.length !== details.length
  )
    throw new Error("Неполные или повторяющиеся чеки");
  let turnover = 0,
    service = 0,
    parking = 0,
    staffAmount = 0,
    count = 0;
  for (const o of orders) {
    const d = byId.get(o.id);
    if (!d) throw new Error(`Нет деталей чека ${o.id}`);
    if (!validOrder(o) || d.returned || d.deleted) continue;
    count++;
    service += d.service;
    if (o.payer_id !== null && staff.has(o.payer_id)) {
      staffAmount += o.gross;
      continue;
    }
    for (const line of d.lines) {
      const pid = String(line.product_id);
      if (pid in settings.tip_products || pid in settings.deposit_products)
        continue;
      if (settings.parking_product_ids.includes(line.product_id)) {
        parking += line.amount;
        continue;
      }
      turnover += line.amount;
    }
    turnover -= d.service;
  }
  // Legacy Shifts rounds each final metric to whole rubles, not each line.
  m.turnover = Math.round(turnover);
  m.service = Math.round(service);
  m.parking = Math.round(parking);
  m.staff_checks = Math.round(staffAmount);
  m.checks = count;
  return m;
}
export function zMetrics(
  reports: Record<string, unknown>[],
  settings: SalesSettings,
) {
  let tips = 0,
    deposits = 0;
  for (const raw of reports) {
    const report = (raw.data ?? raw) as Record<string, unknown>;
    if (!Array.isArray(report.productOutgoing))
      throw new Error("В кассовом отчёте отсутствуют позиции");
    for (const it of report.productOutgoing as Record<string, unknown>[]) {
      const pid = String((it.product as { id?: number })?.id);
      if (pid in settings.tip_products)
        tips +=
          number(it.amount, "количество чаевых") * settings.tip_products[pid];
      if (pid in settings.deposit_products)
        deposits +=
          number(it.amount, "количество депозитов") *
          settings.deposit_products[pid];
    }
  }
  return { tips: Math.round(tips), deposits: Math.round(deposits) };
}
