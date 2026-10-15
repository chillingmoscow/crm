// One-time local transfer of pay rules and reconciliation evidence. No external writes.
import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
loadEnvFile(".env.local");
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error(
    "This importer only writes to the local development database",
  );
const db = createClient(url.href, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const source = JSON.parse(
  await readFile(process.argv[2] ?? "/tmp/sheerly-payroll-source.json", "utf8"),
);
const sourceNames = source.employees
  .map((e) => e["Имя Фамилия"])
  .filter(Boolean);
if (new Set(sourceNames).size !== sourceNames.length)
  throw new Error(
    "Ambiguous employee names in one-time migration; map source IDs explicitly before importing",
  );
const starts = process.argv[3] ?? "2026-09-01";
if (!/^\d{4}-\d{2}-01$/.test(starts))
  throw new Error("Use a first-of-month date");
const check = async (q) => {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const settings = await check(
  db
    .from("sales_settings")
    .select("account_id,venue_id")
    .eq("enabled", true)
    .single(),
);
const { account_id: accountId, venue_id: venueId } = settings;
if (
  (
    await check(
      db
        .from("payroll_periods")
        .select("id")
        .eq("venue_id", venueId)
        .neq("status", "draft"),
    )
  ).length ||
  (
    await check(
      db.from("payroll_payments").select("id").eq("venue_id", venueId),
    )
  ).length
)
  throw new Error("Initial migration is locked after confirmation or payments");
const fields = (rows) =>
  rows
    .slice(1)
    .map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i] ?? null])));
const date = (n) => {
  if (!n) return null;
  if (typeof n === "number")
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000)
      .toISOString()
      .slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return n;
  return null;
};
await check(
  db.from("payroll_settings").upsert(
    {
      account_id: accountId,
      venue_id: venueId,
      starts_on: starts,
      quickresto_venue_id: 1,
      enabled: true,
      benefits_mode: "active",
    },
    { onConflict: "venue_id" },
  ),
);
const positions = fields(source.positions),
  steps = Object.fromEntries(
    source.experience
      .slice(1)
      .filter((r) => Number(r[0]) > 0)
      .map((r) => [String(r[0]), Number(r[2])]),
  );
const modelIds = new Map();
for (const m of fields(source.models)) {
  const pos = positions.find((p) => p["Row ID"] === m["Должность / ID"]);
  if (!pos) throw new Error("Unknown position in pay rules");
  const row = {
    account_id: accountId,
    venue_id: venueId,
    name: m["Название"],
    role_name: pos["Название"],
    quickresto_role_id: Number(pos["Quick Resto ID"]) || null,
    basis:
      { Кальяны: "hookah", Бар: "bar", Оборот: "turnover" }[
        pos["Процент от продаж / Тип"]
      ] ?? "none",
    tips: pos["Чаевые"] === true,
    experience: pos["Надбавки / Стаж"] === true,
    knowledge_amount: Number(pos["Надбавки / Знания"]) || 0,
    food_amount: Number(pos["Надбавки / Питание"]) || 0,
    cleaner_bonus: Number(pos["Надбавки / Отсутствие клиннера"]) || 0,
  };
  const saved = await check(
    db
      .from("payroll_models")
      .upsert(row, { onConflict: "venue_id,name" })
      .select("id")
      .single(),
  );
  modelIds.set(m["🔒 Row ID"], saved.id);
  const rates = {};
  for (const [i, mode] of [
    "Одиночная",
    "Двойная",
    "Тройная",
    "Четверная",
  ].entries()) {
    rates[String(i + 1)] = {};
    for (const [wd, day] of [
      "Понедельник",
      "Вторник",
      "Среда",
      "Четверг",
      "Пятница",
      "Суббота",
      "Воскресенье",
    ].entries()) {
      const base = m[`${mode} смена / Выход - ${day}`],
        percent = m[`${mode} смена / Процент от оборота - ${day}`];
      rates[String(i + 1)][String(wd + 1)] = {
        base: base == null || base === "" ? null : Number(base),
        percent:
          percent == null || percent === ""
            ? row.basis === "none"
              ? 0
              : null
            : Number(percent),
      };
    }
  }
  const existing = await check(
    db
      .from("payroll_rule_versions")
      .select("id")
      .eq("model_id", saved.id)
      .eq("valid_from", starts)
      .is("employee_id", null)
      .maybeSingle(),
  );
  if (!existing)
    await check(
      db.from("payroll_rule_versions").insert({
        account_id: accountId,
        venue_id: venueId,
        model_id: saved.id,
        valid_from: starts,
        rates,
        experience_steps: steps,
      }),
    );
}
const assistant = await check(
  db
    .from("payroll_models")
    .upsert(
      {
        account_id: accountId,
        venue_id: venueId,
        name: "Ассистент · оклад",
        role_name: "Ассистент",
        basis: "none",
        monthly_amount: 47700,
      },
      { onConflict: "venue_id,name" },
    )
    .select("id")
    .single(),
);
const localLinks = await check(
  db
    .from("external_entity_links")
    .select("local_id,external_id")
    .eq("account_id", accountId)
    .eq("provider", "quickresto")
    .eq("entity_type", "staff"),
);
const imported = await check(
  db
    .from("payroll_employees")
    .select("id,name,quickresto_id")
    .eq("venue_id", venueId),
);
const employeeMap = new Map();
for (const e of source.employees) {
  if (["Владелец", "Директор"].includes(e["Должность / Название (скрипт)"]))
    continue;
  const model =
    modelIds.get(e["Модель оплаты / ID"]) ??
    (e["Имя Фамилия"] === "Татьяна Явных" ? assistant.id : null);
  const modelRow = model
    ? await check(
        db.from("payroll_models").select("role_name").eq("id", model).single(),
      )
    : null;
  const previous = imported.find(
    (r) =>
      (Number(r.quickresto_id) === Number(e["QR / Сотрудник"]) &&
        e["QR / Сотрудник"]) ||
      r.name === e["Имя Фамилия"],
  );
  const prior = source.payroll
    .slice(1)
    .filter(
      (r) =>
        r[0] === e["Имя Фамилия"] && Number(r[3]) < Number(starts.slice(5, 7)),
    );
  const opening =
    Math.round(
      prior.reduce(
        (s, r) =>
          s +
          Number(r[5] || 0) +
          Number(r[7] || 0) -
          Number(r[6] || 0) -
          Number(r[8] || 0) +
          Number(r[9] || 0) -
          Math.abs(Number(r[10] || 0)) +
          Number(r[13] || 0),
        0,
      ) * 100,
    ) / 100;
  const row = {
    ...(previous ? { id: previous.id } : {}),
    account_id: accountId,
    venue_id: venueId,
    name: e["Имя Фамилия"],
    quickresto_id: Number(e["QR / Сотрудник"]) || null,
    local_user_id:
      localLinks.find((l) => l.external_id === String(e["QR / Сотрудник"]))
        ?.local_id ?? null,
    role_name: modelRow?.role_name ?? e["Должность / Название (скрипт)"] ?? "",
    model_id: model,
    hired_on: date(e["Трудоустройство / Дата"]),
    active: e["Действующий"] === true,
    opening_balance: opening,
    opening_confirmed: false,
  };
  const saved = await check(
    db.from("payroll_employees").upsert(row).select("id").single(),
  );
  employeeMap.set(row.name, saved.id);
}
const existingAdj = await check(
  db.from("payroll_adjustments").select("source_ref").eq("venue_id", venueId),
);
const used = new Set(existingAdj.map((r) => r.source_ref));
for (const f of fields(source.fees)) {
  if (
    !["Премия", "Штраф"].includes(f["Категория"]) ||
    (f["Сотрудник"] === "Татьяна Явных" &&
      f["Комментарий"] === "Зарплата" &&
      Number(f["Сумма"]) === 47700)
  ) {
    await check(
      db
        .from("payroll_adjustments")
        .delete()
        .eq("venue_id", venueId)
        .eq("source_ref", `initial-migration:adjustment:${f["🔒 Row ID"]}`),
    );
  }
}
for (const f of fields(source.fees)) {
  const employee = employeeMap.get(f["Сотрудник"]),
    d = date(f["Дата"]);
  if (
    !employee ||
    !d ||
    d < starts ||
    f["Удаление / Статус"] === true ||
    f["Тип"] !== "Деньги" ||
    !["Премия", "Штраф"].includes(f["Категория"])
  )
    continue;
  if (
    f["Сотрудник"] === "Татьяна Явных" &&
    f["Комментарий"] === "Зарплата" &&
    Number(f["Сумма"]) === 47700
  )
    continue;
  const ref = `initial-migration:adjustment:${f["🔒 Row ID"]}`;
  if (used.has(ref)) continue;
  await check(
    db.from("payroll_adjustments").insert({
      account_id: accountId,
      venue_id: venueId,
      employee_id: employee,
      business_date: d,
      kind: f["Категория"] === "Премия" ? "bonus" : "deduction",
      amount: (f["Категория"] === "Премия" ? 1 : -1) * Number(f["Сумма"]),
      reason: f["Комментарий"] || "Перенесённая корректировка",
      source_ref: ref,
      approved: true,
    }),
  );
}
console.log(
  JSON.stringify({
    venueId,
    starts,
    models: modelIds.size + 1,
    employees: employeeMap.size,
    openingBalances: "require_confirmation",
    financialTransactionsCreated: 0,
  }),
);
