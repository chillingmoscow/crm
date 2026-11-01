import { z } from "zod";
import { canonicalSourceValue } from "@/lib/source/canonical";
/** Header-only mirror. Nested supplier/company bank details are never retained. */
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const stamp = z.string().datetime({ offset: true });
export const supplyHeaderSchema = z
  .object({
    id,
    version: z.number().int().min(0),
    number: z.string().min(1).max(500),
    invoiceAt: stamp,
    providerId: id.nullable(),
    providerName: z.string().max(500).nullable(),
    storeId: id,
    storeTitle: z.string().max(500),
    processed: z.boolean(),
    paid: z.boolean(),
    amountCents: z.number().int().nonnegative().max(1e12),
    authorName: z.string().max(500).nullable(),
  })
  .strict();
export type SupplyHeader = z.infer<typeof supplyHeaderSchema>;
export const supplyFactSchema = supplyHeaderSchema
  .extend({
    businessId: id,
    invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paidAt: stamp.nullable(),
    paidDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    accountId: id.nullable(),
    accountTitle: z.string().max(500).nullable(),
    issues: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type SupplyFact = z.infer<typeof supplyFactSchema>;
function obj(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Quick Resto не подтвердил накладную");
  return v as Record<string, unknown>;
}
function ref(v: unknown) {
  return id.parse(v);
}
function text(v: unknown) {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > 500)
    throw Error("Некорректное название в накладной");
  return v.trim() || null;
}
function instant(v: unknown) {
  const date =
    typeof v === "number" && Number.isSafeInteger(v)
      ? new Date(v)
      : typeof v === "string" &&
          /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)
        ? new Date(v)
        : null;
  if (
    !date ||
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 2000 ||
    date.getUTCFullYear() > 2100
  )
    throw Error("Не подтверждена дата накладной");
  return date.toISOString();
}
function amount(v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e10)
    throw Error("Не подтверждена сумма накладной");
  return Math.round((v + Number.EPSILON) * 100);
}
function bool(v: unknown) {
  if (typeof v !== "boolean")
    throw Error("Не подтверждено состояние накладной");
  return v;
}
export function supplyCalendarDate(at: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}
export function normalizeSupplyHeader(raw: unknown): SupplyHeader {
  const outer = obj(raw),
    r = obj(outer.object ?? outer);
  if (r.deleted !== false)
    throw Error("Проверьте удалённую накладную в источнике");
  const provider = r.provider == null ? null : obj(r.provider),
    store = obj(r.store),
    author = r.authorWeb == null ? null : obj(r.authorWeb);
  return supplyHeaderSchema.parse({
    id: ref(r.id),
    version: r.version,
    number: text(r.documentNumber) ?? `Накладная №${ref(r.id)}`,
    invoiceAt: instant(r.invoiceDate),
    providerId: provider ? ref(provider.id) : null,
    providerName: provider ? text(provider.title) : null,
    storeId: ref(store.id),
    storeTitle: text(store.title) ?? `Склад №${ref(store.id)}`,
    processed: bool(r.processed),
    paid: bool(r.paid),
    amountCents: amount(r.totalSum),
    authorName: author ? text(author.title) : null,
  });
}
function comparable(h: SupplyHeader) {
  return {
    id: h.id,
    number: h.number,
    invoiceAt: h.invoiceAt,
    providerId: h.providerId,
    storeId: h.storeId,
    processed: h.processed,
    paid: h.paid,
    amountCents: h.amountCents,
  };
}
export function normalizeSupplyList(
  raw: unknown,
  headers: SupplyHeader[],
  timezone: string,
  businessIds: number[],
): SupplyFact[] {
  if (
    !Array.isArray(raw) ||
    raw.length > 30000 ||
    raw.length !== headers.length
  )
    throw Error("Не подтверждён полный список накладных");
  const map = new Map(headers.map((h) => [h.id, h])),
    seen = new Set<number>();
  return raw
    .map((value) => {
      const r = obj(value),
        rid = ref(r.id),
        header = map.get(rid);
      if (!header || seen.has(rid))
        throw Error("Повторная или отсутствующая накладная");
      seen.add(rid);
      const store = obj(r.store),
        business = obj(store.liteBusiness),
        businessId = ref(business.id),
        provider = r.provider == null ? null : obj(r.provider);
      if (!businessIds.includes(businessId))
        throw Error(
          "Накладная относится к неподтверждённому заведению Quick Resto",
        );
      const actual = {
        id: rid,
        number: text(r.documentNumber) ?? `Накладная №${rid}`,
        invoiceAt: instant(r.invoiceDate),
        providerId: provider ? ref(provider.id) : null,
        storeId: ref(store.id),
        processed: bool(r.processed),
        paid: bool(r.paid),
        amountCents: amount(r.totalSum),
      };
      if (
        canonicalSourceValue(actual) !==
        canonicalSourceValue(comparable(header))
      )
        throw Error("Накладная изменилась между чтениями");
      const account =
          r.transactionAccount == null ? null : obj(r.transactionAccount),
        paidAt = r.paymentDate == null ? null : instant(r.paymentDate),
        issues: string[] = [];
      if (header.paid && header.amountCents > 0 && !paidAt)
        issues.push("Не указана дата оплаты");
      if (header.paid && header.amountCents > 0 && !account)
        issues.push("Не указан счёт оплаты");
      if (!header.providerId || !header.providerName)
        issues.push("Не указан поставщик");
      return supplyFactSchema.parse({
        ...header,
        businessId,
        invoiceDate: supplyCalendarDate(header.invoiceAt, timezone),
        paidAt,
        paidDate: paidAt ? supplyCalendarDate(paidAt, timezone) : null,
        accountId: account ? ref(account.id) : null,
        accountTitle: account ? text(account.name) : null,
        issues,
      });
    })
    .sort((a, b) => a.id - b.id);
}
export type SupplyReadJob = {
  phase: "grid_first" | "financial_first" | "grid_verify" | "financial_verify";
  cursor: number;
  payload: {
    first: SupplyHeader[];
    second: SupplyHeader[];
    facts: SupplyFact[];
    provider?: string;
  };
  request: { timezone: string; businessIds: number[] };
};
export type SupplySource = {
  page: (start: number) => Promise<unknown>;
  financial: () => Promise<unknown>;
};
/** Each complete public list is independently checked against paginated grid IDs.
 * Two matching passes prevent truncation or mid-read changes from publishing. */
export async function advanceSupplyRead(
  job: SupplyReadJob,
  source: SupplySource,
) {
  const { phase, payload } = job;
  if (
    ![
      "grid_first",
      "financial_first",
      "grid_verify",
      "financial_verify",
    ].includes(phase) ||
    !Number.isSafeInteger(job.cursor) ||
    job.cursor < 0 ||
    job.cursor > 30000
  )
    throw Error("Некорректное состояние чтения поставок");
  if (phase === "financial_first" || phase === "financial_verify") {
    const facts = normalizeSupplyList(
      await source.financial(),
      payload.first,
      job.request.timezone,
      job.request.businessIds,
    );
    if (phase === "financial_first")
      return {
        phase: "grid_verify" as const,
        cursor: 0,
        payload: { ...payload, facts, second: [] },
      };
    if (canonicalSourceValue(payload.facts) !== canonicalSourceValue(facts))
      throw Error(
        "Оплата накладных изменилась во время проверки. Обновите поставки заново",
      );
    return { publish: facts };
  }
  const previous = phase === "grid_first" ? payload.first : payload.second;
  if (previous.length !== job.cursor)
    throw Error("Пропущена страница накладных");
  const raw = obj(await source.page(job.cursor));
  if (!Array.isArray(raw.ds) || raw.ds.length > 500)
    throw Error("Quick Resto не подтвердил страницу накладных");
  const page = raw.ds.map(normalizeSupplyHeader),
    ids = new Set(previous.map((r) => r.id));
  for (const row of page) {
    if (ids.has(row.id))
      throw Error("Quick Resto повторил накладную или страницу");
    ids.add(row.id);
  }
  if (previous.length + page.length > 30000)
    throw Error("Превышен предел подтверждённого чтения накладных");
  if (page.length) {
    const combined = [...previous, ...page];
    return {
      phase,
      cursor: combined.length,
      payload: {
        ...payload,
        [phase === "grid_first" ? "first" : "second"]: combined,
      },
    };
  }
  const sorted = [...previous].sort((a, b) => a.id - b.id);
  if (phase === "grid_first")
    return {
      phase: "financial_first" as const,
      cursor: sorted.length,
      payload: { ...payload, first: sorted },
    };
  if (canonicalSourceValue(payload.first) !== canonicalSourceValue(sorted))
    throw Error("Состав или данные накладных изменились во время проверки");
  return {
    phase: "financial_verify" as const,
    cursor: sorted.length,
    payload: { ...payload, second: sorted },
  };
}
export function normalizeSupplyCompanies(raw: unknown) {
  if (!Array.isArray(raw) || raw.length > 1000)
    throw Error("Не подтверждён список заведений Quick Resto");
  const map = new Map<number, string>();
  for (const item of raw) {
    const store = obj(item);
    if (store.deleted === true || store.liteBusiness == null) continue;
    const business = obj(store.liteBusiness),
      rid = ref(business.id),
      title = text(business.title ?? business.name);
    if (!title) throw Error("У заведения Quick Resto не указано название");
    if (map.has(rid) && map.get(rid) !== title)
      throw Error("Различаются названия одного заведения Quick Resto");
    map.set(rid, title);
  }
  return [...map]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id - b.id);
}
