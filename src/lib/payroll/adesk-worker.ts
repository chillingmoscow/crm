import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  CreatedMismatchError,
  adeskRelatedDate,
  decideBeforeCreate,
  isExactMatch,
  verifyCreated,
  type AdeskExpense,
  type AdeskTransaction,
} from "./adesk";

const API = "https://api.adesk.ru/v1";

type Job = {
  payment_id: string;
  account_id: string;
  payment_state: "posted" | "cancelled";
  adesk_id: number | null;
  amount: number | string;
  date: string;
  employees: number | null;
  months: string[] | null;
  employee_name: string | null;
  bank_adesk_id: number | null;
  category_adesk_id: number | null;
  project_adesk_id: number | null;
};

type Outcome = { state: "synced" | "error" | "review"; adeskId: number | null; error: string | null };

const clip = (text: string) => text.slice(0, 500);

async function call(token: string, path: string, init: RequestInit & { query?: Record<string, string> } = {}) {
  const url = new URL(API + path);
  url.searchParams.set("api_token", token);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25000), cache: "no-store" });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // The token is in the URL: never echo the URL or the raw response into errors.
  if (!res.ok || !body || (body.success !== true && body.success !== "true"))
    throw new Error(`Adesk ответил ошибкой (${res.status})`);
  return body;
}

/** Every operation of one account on one cash date; a partial list blocks any write. */
async function listDay(token: string, date: string, bankAccount: number): Promise<AdeskTransaction[]> {
  const all: AdeskTransaction[] = [];
  let total: number | null = null;
  for (let start = 0; start < 50000; start += 500) {
    const body = await call(token, "/transactions", {
      query: {
        range: "custom",
        range_start: date,
        range_end: date,
        type: "all",
        length: "500",
        start: String(start),
        bank_account: String(bankAccount),
        date_type: "cashier",
      },
    });
    const page = body.transactions,
      filtered = Number(body.recordsFiltered);
    if (!Array.isArray(page) || !Number.isSafeInteger(filtered)) throw new Error("Adesk вернул неполный список операций");
    if (total !== null && total !== filtered) throw new Error("Список операций Adesk изменился во время чтения");
    total = filtered;
    all.push(...(page as AdeskTransaction[]));
    if (page.length === 0 || all.length >= total) break;
  }
  if (all.length !== total || new Set(all.map((t) => String(t.id))).size !== all.length)
    throw new Error("Adesk вернул неполный список операций");
  return all;
}

async function remove(token: string, id: number) {
  await call(token, `/transaction/${id}/remove`, { method: "POST" });
}

function expenseFor(job: Job): AdeskExpense | string {
  if (job.employees !== 1 || !job.employee_name) return "Выплата распределена на нескольких сотрудников: внесите её в Adesk вручную";
  if (!job.months || job.months.length !== 1) return "Выплата закрывает несколько месяцев: внесите её в Adesk вручную";
  if (!job.bank_adesk_id) return "Счёт выплаты не связан со счётом Adesk";
  if (!job.category_adesk_id) return "Статья выплаты не связана со статьёй Adesk";
  if (!job.project_adesk_id) return "Для заведения не указан проект Adesk";
  return {
    date: job.date,
    relatedDate: adeskRelatedDate(job.months[0], job.date),
    amount: Number(job.amount),
    bankAccount: Number(job.bank_adesk_id),
    category: Number(job.category_adesk_id),
    project: Number(job.project_adesk_id),
    description: job.employee_name.trim(),
  };
}

async function createOrLink(token: string, job: Job): Promise<Outcome> {
  const expense = expenseFor(job);
  if (typeof expense === "string") return { state: "review", adeskId: null, error: expense };
  const list = await listDay(token, expense.date, expense.bankAccount);
  const decision = decideBeforeCreate(list, expense, job.adesk_id == null ? null : Number(job.adesk_id));
  if (decision.kind === "review") return { state: "review", adeskId: null, error: decision.reason };
  if (decision.kind === "link") return { state: "synced", adeskId: decision.id, error: null };
  const body = await call(token, "/transaction", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      bank_account: String(expense.bankAccount),
      amount: String(expense.amount),
      category: String(expense.category),
      project: String(expense.project),
      date: expense.date,
      related_date: expense.relatedDate,
      type: "outcome",
      description: expense.description,
    }).toString(),
  });
  const created = (body.transaction ?? (body.data as Record<string, unknown> | undefined)?.transaction) as
    | AdeskTransaction
    | undefined;
  try {
    return { state: "synced", adeskId: verifyCreated(created, expense), error: null };
  } catch (e) {
    // Something was created: keep its id and stop, a retry must not create a second one.
    if (e instanceof CreatedMismatchError) return { state: "review", adeskId: e.adeskId, error: e.message };
    throw e;
  }
}

async function removeCancelled(token: string, job: Job): Promise<Outcome> {
  if (job.adesk_id != null) {
    const id = Number(job.adesk_id);
    try {
      await remove(token, id);
    } catch (e) {
      // Already removed by hand: the operation is gone from its day, nothing left to do.
      if (!job.bank_adesk_id) throw e;
      const list = await listDay(token, job.date, Number(job.bank_adesk_id));
      if (list.some((t) => Number(t.id) === id)) throw e;
    }
    return { state: "synced", adeskId: null, error: null };
  }
  // Never linked: the create may still have reached Adesk before the cancel.
  const expense = expenseFor(job);
  if (typeof expense === "string") return { state: "synced", adeskId: null, error: null };
  const exact = (await listDay(token, expense.date, expense.bankAccount)).filter((t) => isExactMatch(t, expense));
  if (exact.length > 1)
    return { state: "review", adeskId: null, error: `Выплата отменена, а в Adesk несколько похожих операций: ${exact.map((t) => t.id).join(", ")}` };
  if (exact.length === 1) await remove(token, Number(exact[0].id));
  return { state: "synced", adeskId: null, error: null };
}

/** Mirrors one queued payout to Adesk. Never throws after a claim: the result is reported to the queue. */
export async function processAdeskSync(): Promise<{ idle: boolean; synced?: boolean; error?: string }> {
  const token = process.env.ADESK_API_TOKEN;
  // Without a key the queue simply waits; nothing is claimed or marked failed.
  if (!token) return { idle: true };
  const db = asLooseDb(createAdminClient());
  const claimed = await db.rpc("payroll_claim_adesk_sync");
  if (claimed.error) throw new Error(claimed.error.message);
  const job = claimed.data as Job | null;
  if (!job) return { idle: true };

  const finish = async (o: Outcome) => {
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await db.rpc("payroll_finish_adesk_sync", {
        p_payment: job.payment_id,
        p_account: job.account_id,
        p_state: o.state,
        p_adesk_id: o.adeskId,
        p_error: o.error === null ? null : clip(o.error),
      });
      if (!r.error) return;
      last = r.error.message;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(last);
  };

  let outcome: Outcome;
  try {
    outcome = job.payment_state === "cancelled" ? await removeCancelled(token, job) : await createOrLink(token, job);
  } catch (e) {
    outcome = { state: "error", adeskId: null, error: e instanceof Error && e.message ? e.message : "Ошибка обмена с Adesk" };
  }
  await finish(outcome);
  return outcome.state === "synced" ? { idle: false, synced: true } : { idle: false, synced: false, error: outcome.error ?? undefined };
}
