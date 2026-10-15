// Local verification setup only. No real balances or bank details are invented.
import { loadEnvFile } from "node:process";
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
  check = async (q) => {
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
const settings = await check(db.from("payroll_settings").select("*").single());
let legal = await check(
  db
    .from("legal_entities")
    .select("id")
    .eq("account_id", settings.account_id)
    .eq("name", "CHILLING · локальная проверка")
    .maybeSingle(),
);
if (!legal)
  legal = await check(
    db
      .from("legal_entities")
      .insert({
        account_id: settings.account_id,
        name: "CHILLING · локальная проверка",
        legal_form: "OTHER",
      })
      .select("id")
      .single(),
  );
let bank = await check(
  db
    .from("bank_accounts")
    .select("id")
    .eq("account_id", settings.account_id)
    .eq("venue_id", settings.venue_id)
    .eq("name", "Касса CHILLING · локальная проверка")
    .maybeSingle(),
);
if (!bank)
  bank = await check(
    db
      .from("bank_accounts")
      .insert({
        account_id: settings.account_id,
        venue_id: settings.venue_id,
        legal_entity_id: legal.id,
        name: "Касса CHILLING · локальная проверка",
        type: "cash",
        currency: "RUB",
        description:
          "Локальный счёт для проверки зарплаты. Реальный остаток не подтверждён.",
      })
      .select("id")
      .single(),
  );
let tips = await check(
  db
    .from("finance_categories")
    .select("id")
    .eq("account_id", settings.account_id)
    .eq("type", "expense")
    .eq("name", "Чаевые сотрудникам")
    .maybeSingle(),
);
if (!tips)
  tips = await check(
    db
      .from("finance_categories")
      .insert({
        account_id: settings.account_id,
        type: "expense",
        name: "Чаевые сотрудникам",
      })
      .select("id")
      .single(),
  );
const salary = await check(
  db
    .from("finance_categories")
    .select("id")
    .eq("account_id", settings.account_id)
    .eq("type", "expense")
    .eq("name", "Зарплата")
    .single(),
);
await check(
  db
    .from("payroll_settings")
    .update({ salary_category_id: salary.id, tip_category_id: tips.id })
    .eq("venue_id", settings.venue_id),
);
console.log(
  JSON.stringify({
    localVerificationAccount: bank.id,
    cashboxMapping: "requires_confirmation",
    financialTransactionsCreated: 0,
  }),
);
