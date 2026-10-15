// Import evidence only. A manager must reconcile each record before finance posting.
import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
loadEnvFile(".env.local");
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  )
)
  throw new Error("Local database only");
const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  ),
  source = JSON.parse(
    await readFile("/tmp/sheerly-payroll-legacy-payments.json", "utf8"),
  );
const check = async (q) => {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const settings = await check(db.from("payroll_settings").select("*").single()),
  employees = await check(
    db
      .from("payroll_employees")
      .select("id,name")
      .eq("venue_id", settings.venue_id),
  );
let count = 0,
  total = 0;
for (const r of source) {
  if (
    !r.processed ||
    r.deleted === true ||
    r.venue !== "U053tGTsSCKUtJebumKzWQ" ||
    !["Выплата", "Аванс"].includes(r.kind) ||
    r.month !== 9 ||
    !(r.amount > 0)
  )
    continue;
  const matches = employees.filter((e) => e.name === r.employee);
  if (matches.length !== 1)
    throw new Error(
      "Historical payment employee mapping is missing or ambiguous",
    );
  const employee = matches[0];
  const occurred = new Date(
    Date.UTC(1899, 11, 30) + r.created * 86400000 - 3 * 3600000,
  ).toISOString();
  if (!occurred.startsWith("2026-"))
    throw new Error("Historical payment year is ambiguous");
  const ref = `initial-migration:payment:${r.id}`;
  const exists = await check(
    db
      .from("payroll_legacy_payments")
      .select("id")
      .eq("account_id", settings.account_id)
      .eq("source_ref", ref)
      .maybeSingle(),
  );
  if (exists) continue;
  await check(
    db.from("payroll_legacy_payments").insert({
      account_id: settings.account_id,
      venue_id: settings.venue_id,
      employee_id: employee.id,
      month: "2026-09-01",
      occurred_at: occurred,
      amount: r.amount,
      kind: r.kind === "Аванс" ? "advance" : "salary",
      source_ref: ref,
      source_bank: r.bank ?? "",
    }),
  );
  count++;
  total += r.amount;
}
console.log(
  JSON.stringify({
    records: count,
    amount: total,
    state: "review",
    financeTransactionsCreated: 0,
  }),
);
