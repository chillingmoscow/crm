/** Read/plan boundary: no writes to payroll, money or the provider. */
export type PersonalFinanceMapping = {
  legacyBankId: number;
  incomeCategoryId: number;
  expenseCategoryId: number;
};
export type WriteoffRules = {
  storeIds: number[];
  timezone: string;
  personalOperatorIds: number[];
  teamReasons: string[];
  masterReasons: string[];
  personalFinance?: PersonalFinanceMapping;
};
export type WriteoffKind =
  | "personal"
  | "employee"
  | "team"
  | "masters"
  | "business"
  | "unknown";
export const writeoffKindLabels: Record<WriteoffKind, string> = {
  personal: "Личное потребление",
  employee: "Сотрудник",
  team: "Вся команда",
  masters: "Кальянные мастера",
  business: "За счёт заведения",
  unknown: "Нужно уточнить",
};
export type WriteoffLine = {
  id: number;
  productId: number | null;
  name: string;
  categories: string[];
  unit: string | null;
  quantity: number | null;
  amount: number | null;
  legacyAmount: number | null;
};
export type WriteoffDocument = {
  id: number;
  number: string;
  date: string;
  invoiceAt: string;
  processed: boolean;
  storeId: number;
  storeName: string;
  reasonId: number | null;
  reason: string | null;
  customerType: string;
  operatorId: number | null;
  operatorName: string | null;
  kind: WriteoffKind;
  total: number | null;
  legacyTotal: number | null;
  lines: WriteoffLine[];
  issues: string[];
  providerUpdatedAt: string | null;
};
export type WriteoffArchive = {
  id: string;
  venue_id: string;
  business_date: string;
  legacy_ref: string;
  name: string;
  quantity: string | null;
  total: number | null;
  correspondent: string;
  kind: string;
  document_number: string | null;
  document_url: string | null;
  category: string | null;
  deleted: boolean;
  delete_reason: string | null;
  issues: string[];
  origin: { spreadsheet_id: string; range: string };
  captured_at: string;
  period_total_raw?: number | null;
};
export type StoredWriteoff = {
  id: string;
  venue_id: string;
  business_date: string;
  external_id: number;
  payload: WriteoffDocument;
  source_hash: string;
  captured_at: string;
  version: number;
  missing_at: string | null;
};
export function stockNumber(v: unknown): number | null {
  return (typeof v === "number" ||
    (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v))) &&
    Number.isFinite(Number(v)) &&
    Math.abs(Number(v)) <= 1e12
    ? Number(v)
    : null;
}
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const name = (v: unknown, max = 300) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const id = (v: unknown) =>
  Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : null;
const same = (v: string) =>
  v.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
export function validateWriteoffRules(r: WriteoffRules) {
  if (
    !r ||
    !Array.isArray(r.storeIds) ||
    !r.storeIds.length ||
    r.storeIds.length > 50 ||
    r.storeIds.some((x) => id(x) === null) ||
    new Set(r.storeIds).size !== r.storeIds.length ||
    !Array.isArray(r.personalOperatorIds) ||
    r.personalOperatorIds.length > 50 ||
    r.personalOperatorIds.some((x) => id(x) === null) ||
    new Set(r.personalOperatorIds).size !== r.personalOperatorIds.length
  )
    throw new Error("Проверьте склады и сотрудников личного потребления");
  try {
    if (typeof r.timezone !== "string" || !r.timezone) throw new Error();
    new Intl.DateTimeFormat("ru-RU", { timeZone: r.timezone }).format();
  } catch {
    throw new Error("Проверьте часовой пояс списаний");
  }
  for (const list of [r.teamReasons, r.masterReasons])
    if (
      !Array.isArray(list) ||
      list.length > 100 ||
      list.some((x) => typeof x !== "string" || !x.trim() || x.length > 200) ||
      new Set(list.map(same)).size !== list.length
    )
      throw new Error("Проверьте причины списаний");
  if (
    r.teamReasons.some((x) => r.masterReasons.some((y) => same(x) === same(y)))
  )
    throw new Error(
      "Причина не может относиться сразу ко всей команде и мастерам",
    );
  if (
    r.personalFinance &&
    (["legacyBankId", "incomeCategoryId", "expenseCategoryId"].some(
      (k) => id(object(r.personalFinance)[k]) === null,
    ) ||
      Object.keys(r.personalFinance).some(
        (k) =>
          !["legacyBankId", "incomeCategoryId", "expenseCategoryId"].includes(
            k,
          ),
      ))
  )
    throw new Error("Проверьте финансовое отражение личного потребления");
}
export function stockCalendarDate(value: unknown, timezone: string) {
  if (
    typeof value !== "string" ||
    !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !==
      value.slice(0, 10)
  )
    throw new Error("Нет однозначной даты акта Quick Resto");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function writeoffKind(
  type: string,
  operator: number | null,
  reason: string | null,
  r: WriteoffRules,
): WriteoffKind {
  if (type === "EMPLOYEE")
    return operator === null
      ? "unknown"
      : r.personalOperatorIds.includes(operator)
        ? "personal"
        : "employee";
  if (type !== "SPECIAL") return "unknown";
  if (reason && r.teamReasons.some((s) => same(s) === same(reason)))
    return "team";
  if (reason && r.masterReasons.some((s) => same(s) === same(reason)))
    return "masters";
  return "business";
}
/** Select only warehouse facts; never persist QR user credentials, DOB or bank details. */
export function normalizeWriteoff(
  raw: unknown,
  r: WriteoffRules,
): WriteoffDocument {
  validateWriteoffRules(r);
  const d = object(raw),
    store = object(d.store),
    operator = object(d.operator),
    reason = object(d.discardReason);
  const docId = id(d.id),
    storeId = id(store.id);
  if (docId === null || storeId === null || !r.storeIds.includes(storeId))
    throw new Error("Акт относится к другому складу или не имеет ID");
  if (typeof d.processed !== "boolean" || !Array.isArray(d.invoiceItems))
    throw new Error("Неполный ответ акта Quick Resto");
  if (d.invoiceItems.length > 10000)
    throw new Error("Слишком большой акт. Нужна проверка полноты");
  const operatorId = id(operator.id),
    reasonText = name(reason.description, 200) || null,
    customerType = name(d.customerType, 40),
    kind = writeoffKind(customerType, operatorId, reasonText, r);
  const seen = new Set<number>();
  const issues: string[] = [];
  const lines = d.invoiceItems.map((v: unknown): WriteoffLine => {
    const item = object(v),
      p = object(item.product),
      unit = object(item.measureUnit);
    const lineId = id(item.id);
    if (lineId === null || seen.has(lineId))
      throw new Error("Неоднозначные ID позиций акта");
    seen.add(lineId);
    const categories: string[] = [];
    let parent = object(p.parentItem);
    const visited = new Set<number>();
    for (let n = 0; n < 16 && Object.keys(parent).length; n++) {
      const parentId = id(parent.id);
      if (parentId !== null && visited.has(parentId))
        throw new Error("Цикл категорий товара");
      if (parentId !== null) visited.add(parentId);
      const label = name(parent.name ?? parent.itemTitle);
      if (label) categories.push(label);
      parent = object(parent.parentItem);
    }
    if (Object.keys(parent).length)
      throw new Error("Неполная цепочка категорий товара");
    const quantity = stockNumber(item.actualAmount),
      amount = stockNumber(item.fixedTotalSum);
    if (quantity === null || amount === null)
      issues.push("В акте есть позиции без количества или суммы");
    if ((quantity !== null && quantity < 0) || (amount !== null && amount < 0))
      issues.push("В акте есть отрицательная позиция — нужна сверка");
    return {
      id: lineId,
      productId: id(p.id),
      name: name(p.name ?? p.itemTitle) || "Товар без названия",
      categories,
      unit: name(unit.name ?? unit.fullName) || null,
      quantity,
      amount,
      legacyAmount:
        amount === null || kind === "business" || kind === "unknown"
          ? null
          : kind === "personal"
            ? Math.round(amount)
            : Math.ceil(amount),
    };
  });

  if (kind === "unknown") issues.push("Не определён получатель списания");
  const total = stockNumber(d.totalSum),
    legacyTotal =
      lines.length && lines.every((l) => l.legacyAmount !== null)
        ? lines.reduce((sum, l) => sum + l.legacyAmount!, 0)
        : null;
  if (total === null) issues.push("Источник не передал сумму акта");
  if (total !== null && total < 0)
    issues.push("В акте отрицательная сумма — нужна сверка");
  if (!lines.length) issues.push("В акте нет позиций");
  return {
    id: docId,
    number: name(d.documentNumber, 100) || `№${docId}`,
    date: stockCalendarDate(d.invoiceDate, r.timezone),
    invoiceAt: String(d.invoiceDate),
    processed: d.processed,
    storeId,
    storeName: name(store.title) || `Склад ${storeId}`,
    reasonId: id(reason.id),
    reason: reasonText,
    customerType,
    operatorId,
    operatorName:
      [name(operator.firstName), name(operator.lastName)]
        .filter(Boolean)
        .join(" ") || null,
    kind,
    total,
    legacyTotal,
    lines,
    issues: [...new Set(issues)],
    providerUpdatedAt:
      typeof d.lastUpdateDate === "string" &&
      Number.isFinite(Date.parse(d.lastUpdateDate))
        ? d.lastUpdateDate
        : null,
  };
}
export function discardListIds(raw: unknown, r: WriteoffRules, month: string) {
  validateWriteoffRules(r);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Проверьте месяц списаний");
  const rows = Array.isArray(raw) ? raw : object(raw).data;
  if (!Array.isArray(rows) || rows.length >= 5000)
    throw new Error("Не удалось подтвердить полноту списка актов");
  const result: number[] = [],
    seen = new Set<number>();
  for (const value of rows) {
    const d = object(value),
      ref = id(d.id);
    if (ref === null || seen.has(ref))
      throw new Error("Повтор или отсутствие ID в списке актов");
    seen.add(ref);
    const storeId = id(object(d.store).id);
    if (storeId === null) throw new Error("В списке актов отсутствует склад");
    if (!r.storeIds.includes(storeId)) continue;
    const date = stockCalendarDate(d.invoiceDate, r.timezone);
    if (!date.startsWith(month)) continue;
    result.push(ref);
  }
  return result.sort((a, b) => a - b);
}
export type PersonalConsumptionPlan = {
  eligible: boolean;
  amount: number | null;
  operations: {
    key: string;
    type: "income" | "expense";
    amount: number;
    date: string;
    description: string;
    legacyBankId: number;
    legacyCategoryId: number;
  }[];
  issues: string[];
};
/** Compatibility plan only. Existing n8n remains the writer until owner cutover. */
export function personalConsumptionPlan(
  d: WriteoffDocument,
  mapping?: PersonalFinanceMapping,
): PersonalConsumptionPlan {
  const issues = [...d.issues];
  if (!d.processed) issues.push("Акт не проведён");
  if (d.kind !== "personal") issues.push("Не личное потребление");
  if (
    !mapping ||
    [
      mapping.legacyBankId,
      mapping.incomeCategoryId,
      mapping.expenseCategoryId,
    ].some((x) => id(x) === null)
  )
    issues.push("Не настроено финансовое отражение личного потребления");
  if (issues.length || d.legacyTotal === null)
    return { eligible: false, amount: null, operations: [], issues };
  const operations: PersonalConsumptionPlan["operations"] = [];
  for (const line of d.lines) {
    if (line.legacyAmount === 0) continue;
    for (const type of ["income", "expense"] as const)
      operations.push({
        key: `qr-discard:${d.id}:line:${line.id}:${type}`,
        type,
        amount: line.legacyAmount!,
        date: d.date,
        description:
          type === "income"
            ? `${d.operatorName ?? "Личное потребление"} — ${d.number}`
            : `Личное потребление · ${line.name} · ${d.number}`,
        legacyBankId: mapping!.legacyBankId,
        legacyCategoryId:
          type === "income"
            ? mapping!.incomeCategoryId
            : mapping!.expenseCategoryId,
      });
  }
  return { eligible: true, amount: d.legacyTotal, operations, issues: [] };
}
