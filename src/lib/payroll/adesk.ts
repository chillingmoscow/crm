// Pure rules for mirroring payroll payouts to Adesk. No I/O: the worker and the tests share them.

/** An Adesk operation as the transactions list and the create endpoint return it. */
export type AdeskTransaction = {
  id: number | string;
  amount: number | string;
  description?: string | null;
  type?: number | string;
  dateIso?: string;
  relatedDateIso?: string | null;
  isTransfer?: boolean;
  isPlanned?: boolean;
  bankAccount?: { id?: number | string } | null;
  category?: { id?: number | string } | null;
  project?: { id?: number | string } | null;
  contractor?: { name?: string | null } | null;
};

/** The expense a payout should produce in Adesk. */
export type AdeskExpense = {
  date: string;
  relatedDate: string;
  amount: number;
  bankAccount: number;
  category: number;
  project: number;
  description: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Accrual date for a payout. A payout made inside the payroll month is the first payout
 * of that month (16th); one made after the month ended is the final payout (last day).
 */
export function adeskRelatedDate(month: string, paymentDate: string): string {
  const m = /^(\d{4})-(\d{2})-01$/.exec(month);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error("Некорректный месяц или дата выплаты");
  const year = Number(m[1]),
    monthIndex = Number(m[2]) - 1;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthEnd = `${m[1]}-${m[2]}-${pad(lastDay)}`;
  return paymentDate <= monthEnd ? `${m[1]}-${m[2]}-16` : monthEnd;
}

const words = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const same = (a: unknown, b: unknown) => a != null && b != null && Number(a) === Number(b);

/** An Adesk operation is this payout: same day, account, amount, category, employee and kind. */
export function isExactMatch(t: AdeskTransaction, e: AdeskExpense): boolean {
  return (
    same(t.amount, e.amount) &&
    same(t.bankAccount?.id, e.bankAccount) &&
    same(t.category?.id, e.category) &&
    Number(t.type) === 2 &&
    t.dateIso === e.date &&
    String(t.description ?? "").trim() === e.description.trim() &&
    t.isTransfer !== true &&
    t.isPlanned !== true
  );
}

/**
 * A bank-imported operation that may already be this payout: same day, account and amount,
 * recipient name contains every word of the employee's name. It is never linked automatically.
 */
export function isPossibleBankImport(t: AdeskTransaction, e: AdeskExpense): boolean {
  const employee = [...new Set(words(e.description))];
  if (employee.length < 2) return false;
  const recipient = new Set(words(t.contractor?.name));
  return (
    same(t.amount, e.amount) &&
    same(t.bankAccount?.id, e.bankAccount) &&
    Number(t.type) === 2 &&
    t.dateIso === e.date &&
    t.isTransfer !== true &&
    t.isPlanned !== true &&
    employee.every((w) => recipient.has(w))
  );
}

export type MatchDecision =
  | { kind: "create" }
  | { kind: "link"; id: number }
  | { kind: "review"; reason: string };

/** What to do before creating: reuse an existing operation, create a new one, or stop for review. */
export function decideBeforeCreate(list: AdeskTransaction[], e: AdeskExpense, knownId: number | null): MatchDecision {
  const exact = list.filter((t) => isExactMatch(t, e));
  if (knownId != null) {
    const known = exact.find((t) => Number(t.id) === knownId);
    if (known) return { kind: "link", id: knownId };
  }
  if (exact.length > 1)
    return { kind: "review", reason: `В Adesk несколько одинаковых выплат: ${exact.map((t) => t.id).join(", ")}` };
  const exactIds = new Set(exact.map((t) => String(t.id)));
  const imported = list.filter((t) => !exactIds.has(String(t.id)) && isPossibleBankImport(t, e));
  if (imported.length)
    return {
      kind: "review",
      reason: `В Adesk уже есть возможная банковская выплата этому сотруднику: ${imported.map((t) => t.id).join(", ")}. Проверьте её, чтобы не создать дубль`,
    };
  if (exact.length === 1) return { kind: "link", id: Number(exact[0].id) };
  return { kind: "create" };
}

/** The created operation must be exactly what was asked for before the payout is marked synced. */
export function verifyCreated(t: AdeskTransaction | undefined, e: AdeskExpense): number {
  const id = Number(t?.id);
  if (!t || !Number.isSafeInteger(id) || id <= 0) throw new Error("Adesk не вернул номер операции");
  if (!isExactMatch(t, e) || !same(t.project?.id, e.project) || t.relatedDateIso !== e.relatedDate)
    throw new Error("Операция в Adesk не совпадает с выплатой; нужна сверка");
  return id;
}
