import {
  normalizeSettlementReceipt,
  type SettlementReceipt,
} from "./settlement";
import { dayWindow, validDate } from "./time";

export class SettlementSourceChanged extends Error {
  constructor() {
    super("Данные чеков изменились во время чтения. Запустите сверку ещё раз");
  }
}
type ObjectRow = Record<string, unknown>;
export type SettlementReaderPhase =
  | "orders"
  | "details"
  | "payments"
  | "verify"
  | "commit";
export type SettlementMethod = { id: number; title: string };
type Header = {
  id: number;
  createDate: number;
  payer: { id: number } | null;
  returned: boolean;
  deleted: boolean;
  status: string;
};
type Detail = {
  id: number;
  returned: boolean;
  returnId: number;
  deleted: boolean;
  orderItemList: { costPrice: number | null; amount: number | null }[] | null;
};
type RawPayment = {
  id: number;
  amount: number;
  paymentType: SettlementMethod;
  ownerContextId?: number;
};
export type SettlementReaderPayload = {
  provider?: string;
  orders: Header[];
  facts: SettlementReceipt[];
  methods: SettlementMethod[];
  detail?: Detail;
  payments?: RawPayment[];
  paymentCursor?: number;
  reference?: SettlementReceipt[];
  verificationOrders?: Header[];
};
export type SettlementReaderJob = {
  business_date: string;
  phase: SettlementReaderPhase;
  cursor: number;
  request: { timezone: string; dayStartHour: number };
  payload: SettlementReaderPayload;
};
export type SettlementSource = {
  orders: (start: number) => Promise<unknown>;
  detail: (id: number) => Promise<unknown>;
  payments: (id: number, start: number) => Promise<unknown>;
};
function object(v: unknown): ObjectRow {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Некорректный ответ Quick Resto");
  return v as ObjectRow;
}
function numeric(v: unknown, label: string) {
  if (
    v == null ||
    v === "" ||
    typeof v === "boolean" ||
    !Number.isFinite(Number(v))
  )
    throw new Error(`Не подтверждено поле: ${label}`);
  return Number(v);
}
function identifier(v: unknown, label: string) {
  const n = numeric(v, label);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`Некорректный ID: ${label}`);
  return n;
}
function paymentId(raw: unknown) {
  const n = numeric(raw, "платёж");
  if (!Number.isSafeInteger(n) || n === 0)
    throw new Error("Некорректный ID платежа");
  return n;
}
function rows(raw: unknown): unknown[] {
  const response = object(raw);
  if (!Array.isArray(response.ds))
    throw new Error("Quick Resto не подтвердил список данных");
  return response.ds;
}
function order(raw: unknown, range: { start: number; end: number }): Header {
  const row = object(raw),
    o = object(row.object ?? row);
  if (
    typeof o.returned !== "boolean" ||
    (o.status != null && typeof o.status !== "string") ||
    (o.state != null && typeof o.state !== "string")
  )
    throw new Error(
      `Не подтверждены поля чека: ${[
        typeof o.returned !== "boolean" ? "возврат" : "",
        o.status != null && typeof o.status !== "string" ? "статус" : "",
        o.state != null && typeof o.state !== "string" ? "состояние" : "",
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
  const created = numeric(o.createDate, "дата чека");
  if (
    !Number.isSafeInteger(created) ||
    created < range.start ||
    created >= range.end
  )
    throw new Error("Чек за пределами рабочего дня");
  return {
    id: identifier(o.id, "чек"),
    createDate: created,
    payer:
      o.payer == null
        ? null
        : { id: identifier(object(o.payer).id, "плательщик") },
    returned: o.returned,
    deleted: o.deleted === true,
    status: String(o.status ?? o.state ?? ""),
  };
}
function detail(raw: unknown, expected: number): Detail {
  const row = object(raw),
    d = object(row.data ?? row);
  if (
    identifier(d.id, "детали чека") !== expected ||
    typeof d.returned !== "boolean" ||
    (Array.isArray(d.orderItemList) && d.orderItemList.length > 10000)
  )
    throw new Error("Не подтверждены детали чека");
  const returnId = d.returnId == null ? 0 : numeric(d.returnId, "возврат");
  if (!Number.isSafeInteger(returnId) || returnId < 0)
    throw new Error("Некорректный статус возврата");
  return {
    id: expected,
    returned: d.returned,
    returnId,
    deleted: d.deleted === true,
    orderItemList: Array.isArray(d.orderItemList)
      ? d.orderItemList.map((raw) => {
          const l = object(raw);
          return {
            costPrice:
              l.costPrice == null
                ? null
                : numeric(l.costPrice, "себестоимость"),
            amount: l.amount == null ? null : numeric(l.amount, "количество"),
          };
        })
      : null,
  };
}
function payment(raw: unknown, expected: number): RawPayment {
  const row = object(raw),
    p = object(row.object ?? row),
    method = object(p.paymentType);
  const amount = numeric(p.amount, "платёж");
  if (
    amount < 0 ||
    amount > 100000000 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001
  )
    throw new Error("Некорректная сумма платежа");
  const owner =
    p.ownerContextId == null
      ? undefined
      : identifier(p.ownerContextId, "владелец платежа");
  if (owner !== undefined && owner !== expected)
    throw new Error("Платёж относится к другому чеку");
  return {
    id: paymentId(p.id),
    amount,
    paymentType: {
      id: identifier(method.id, "способ оплаты"),
      title:
        typeof method.title === "string"
          ? method.title.slice(0, 300)
          : `Способ №${method.id}`,
    },
    ...(owner === undefined ? {} : { ownerContextId: owner }),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as ObjectRow)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const canonicalHeaders = (xs: Header[]) =>
  canonical(xs.slice().sort((a, b) => a.id - b.id));
function appendUnique<T extends { id: number }>(
  previous: T[],
  page: T[],
  label: string,
): T[] {
  const all = [...previous, ...page];
  if (all.length > 10000 || new Set(all.map((x) => x.id)).size !== all.length)
    throw new Error(`Неполный или повторяющийся список: ${label}`);
  return all;
}
export type SettlementReaderStep =
  | {
      phase: SettlementReaderPhase;
      cursor: number;
      payload: SettlementReaderPayload;
    }
  | {
      publish: {
        facts: SettlementReceipt[];
        methods: SettlementMethod[];
        summary: { double_checked: true; orders_count: number };
      };
    };
/** One bounded read per step. A second full pass must reproduce the same money and statuses. */
export async function advanceSettlementReader(
  j: SettlementReaderJob,
  source: SettlementSource,
): Promise<SettlementReaderStep> {
  if (
    !validDate(j.business_date) ||
    !Number.isInteger(j.cursor) ||
    j.cursor < 0 ||
    !Array.isArray(j.payload.orders) ||
    !Array.isArray(j.payload.facts) ||
    !Array.isArray(j.payload.methods)
  )
    throw new Error("Некорректное состояние сверки");
  const range = dayWindow(
    j.business_date,
    j.request.timezone,
    j.request.dayStartHour,
  );
  const patch = (
    phase: SettlementReaderPhase,
    cursor: number,
    payload: SettlementReaderPayload,
  ): SettlementReaderStep => ({ phase, cursor, payload });
  const addFact = (
    fact: SettlementReceipt,
    methods: SettlementMethod[] = [],
  ) => {
    if (j.payload.reference) {
      const original = j.payload.reference.find((x) => x.id === fact.id);
      if (!original || canonical(original) !== canonical(fact))
        throw new SettlementSourceChanged();
    }
    const known = new Map(j.payload.methods.map((m) => [m.id, m]));
    for (const m of methods) known.set(m.id, m);
    const next = {
      ...j.payload,
      facts: appendUnique(j.payload.facts, [fact], "чеки"),
      methods: [...known.values()].sort((a, b) => a.id - b.id),
    };
    delete next.detail;
    delete next.payments;
    delete next.paymentCursor;
    return patch("details", j.cursor + 1, next);
  };
  if (j.phase === "orders" || j.phase === "verify") {
    const raw = rows(await source.orders(j.cursor));
    // QR omits payer on anonymous receipts. Validate the projection once per
    // pass, rather than rejecting every guest receipt without a payer.
    if (
      j.cursor === 0 &&
      raw.length &&
      !raw.some((r) => {
        const x = object(r);
        return "payer" in object(x.object ?? x);
      })
    )
      throw new Error(
        "В списке чеков нет данных плательщиков. Проверьте подключение бэк-офиса",
      );
    const page = raw.map((r) => order(r, range));
    const previous =
      j.phase === "orders"
        ? j.payload.orders
        : (j.payload.verificationOrders ?? []);
    const all = appendUnique(previous, page, "чеки");
    if (page.length)
      return patch(j.phase, j.cursor + page.length, {
        ...j.payload,
        ...(j.phase === "orders"
          ? { orders: all }
          : { verificationOrders: all }),
      });
    if (j.phase === "orders")
      return patch("details", 0, {
        ...j.payload,
        orders: all.sort((a, b) => a.id - b.id),
      });
    if (canonicalHeaders(all) !== canonicalHeaders(j.payload.orders))
      throw new SettlementSourceChanged();
    const next = { ...j.payload, reference: j.payload.facts, facts: [] };
    delete next.verificationOrders;
    return patch("details", 0, next);
  }
  if (j.phase === "details") {
    const o = j.payload.orders[j.cursor];
    if (!o) {
      if (
        j.cursor !== j.payload.orders.length ||
        j.payload.facts.length !== j.payload.orders.length
      )
        throw new Error("Не подтверждены все чеки");
      return patch(j.payload.reference ? "commit" : "verify", 0, j.payload);
    }
    const d = detail(await source.detail(o.id), o.id);
    const excluded =
      o.returned ||
      o.deleted ||
      d.returned ||
      d.returnId > 0 ||
      d.deleted ||
      [
        "cancelled",
        "canceled",
        "returned",
        "deleted",
        "void",
        "voided",
        "refunded",
      ].includes(o.status.toLowerCase());
    if (excluded)
      return addFact(
        normalizeSettlementReceipt({ order: o, detail: d, payments: null }),
      );
    return patch("payments", j.cursor, {
      ...j.payload,
      detail: d,
      payments: [],
      paymentCursor: 0,
    });
  }
  if (j.phase === "payments") {
    const o = j.payload.orders[j.cursor],
      d = j.payload.detail;
    if (
      !o ||
      !d ||
      d.id !== o.id ||
      !Array.isArray(j.payload.payments) ||
      !Number.isInteger(j.payload.paymentCursor)
    )
      throw new Error("Не подтверждён чек для чтения платежей");
    const page = rows(
      await source.payments(o.id, j.payload.paymentCursor!),
    ).map((r) => payment(r, o.id));
    const all = appendUnique(j.payload.payments, page, "платежи");
    if (page.length)
      return patch("payments", j.cursor, {
        ...j.payload,
        payments: all,
        paymentCursor: j.payload.paymentCursor! + page.length,
      });
    const sorted = all.sort((a, b) => a.id - b.id);
    return addFact(
      normalizeSettlementReceipt({
        order: o,
        detail: d,
        payments: { orderId: o.id, complete: true, rows: sorted },
      }),
      sorted.map((p) => p.paymentType),
    );
  }
  if (
    j.phase !== "commit" ||
    !j.payload.reference ||
    j.payload.facts.length !== j.payload.orders.length
  )
    throw new Error("Полная проверка дня не завершена");
  // QR returns signed virtual payment IDs. Their identity is scoped to the
  // requested order, and each complete payment collection was checked above.
  const payments = j.payload.facts.flatMap((r) =>
    r.payments.map((p) => `${r.id}:${p.id}`),
  );
  if (new Set(payments).size !== payments.length)
    throw new Error("Платежи повторяются в чеке");
  return {
    publish: {
      facts: j.payload.facts,
      methods: j.payload.methods,
      summary: { double_checked: true, orders_count: j.payload.orders.length },
    },
  };
}
