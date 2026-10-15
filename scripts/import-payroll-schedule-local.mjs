// One-time local import. Input is a reviewed snapshot; no runtime Notion/Sheets dependency.
import { loadEnvFile } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
loadEnvFile(".env.local");
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  )
)
  throw Error("Local database only");
const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
const exits = JSON.parse(await readFile(process.argv[3], "utf8"));
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const check = async (q) => {
  const r = await q;
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const venue = await check(
  db
    .from("venues")
    .select("id,account_id,timezone")
    .eq("name", "CHILLING")
    .single(),
);
if (venue.timezone !== "Europe/Moscow")
  throw Error("Reviewed import is for Europe/Moscow");
const employees = await check(
  db
    .from("payroll_employees")
    .select(
      "id,quickresto_id,name,role_id,local_user_id,active,hired_on,casual,model_id",
    )
    .eq("venue_id", venue.id),
);
const quote = (s) =>
  s == null ? "null" : "'" + String(s).replaceAll("'", "''") + "'";
const uuid = (url) => {
  const id = url.split("/").at(-1).replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/.test(id)) throw Error("Invalid source page ID");
  return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
};
const norm = (s) =>
  s.trim().toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ");
const weekday = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const statements = ["begin;"];
const linked = new Set();
const skipped = [];
const imported = [];
for (const row of snapshot.rows) {
  const sourceTitle = row["Событие"]?.trim();
  // Explicitly confirmed alias, not fuzzy matching.
  const title = sourceTitle === "Полина" ? "Полина Вознесенская" : sourceTitle;
  const bridges = snapshot.employees.filter(
    (e) => norm(e.name) === norm(title ?? ""),
  );
  const employee =
    bridges.length === 1
      ? employees.find(
          (e) => Number(e.quickresto_id) === bridges[0].quickresto_id,
        )
      : null;
  if (!employee) {
    skipped.push({
      source: row.url,
      title,
      reason: "Нет однозначной связи с ID сотрудника Quick Resto",
    });
    continue;
  }
  const left = exits.find(
    (e) => e.quickresto_id === Number(employee.quickresto_id),
  )?.left_on;
  if ((!employee.active || left) && !employee.casual) {
    skipped.push({
      source: row.url,
      title,
      reason: "В прежнем учёте сотрудник не действует",
      left_on: left,
    });
    continue;
  }
  if (!employee.role_id) {
    skipped.push({
      source: row.url,
      title,
      reason: "Не назначена должность Sheerly",
    });
    continue;
  }
  const start = new Date(row["date:Дата и время:start"].replace(" ", "T"));
  if (!Number.isFinite(start.getTime()))
    throw Error("Invalid source timestamp");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  const wd = weekday[new Date(`${day}T12:00:00Z`).getUTCDay()];
  const rules = snapshot.hours.filter(
    (h) =>
      h["Смена"] === row["Должность"] &&
      JSON.parse(h["День недели"] ?? "[]").includes(wd),
  );
  if (rules.length !== 1 || !/^\d{1,2}:\d{2}$/.test(rules[0]["Окончание"])) {
    skipped.push({
      source: row.url,
      title,
      reason: "Нет однозначного времени окончания в расписании",
    });
    continue;
  }
  const finish = row["date:Дата и время:end"];
  let end = finish
    ? new Date(finish.replace(" ", "T"))
    : new Date(`${day}T${rules[0]["Окончание"]}:00+03:00`);
  if (!finish && end <= start) end = new Date(end.getTime() + 86400000);
  if (end <= start || end - start > 86400000) {
    skipped.push({
      source: row.url,
      title,
      reason: "Неоднозначная длительность смены",
    });
    continue;
  }
  const localId = employee.casual
    ? null
    : (employee.local_user_id ?? employee.id);
  if (!linked.has(employee.id)) {
    linked.add(employee.id);
    if (!employee.local_user_id && !employee.casual) {
      const [first, ...last] = employee.name.split(" ");
      // No password, no identity, no email confirmation, no invitation, permanently banned login.
      statements.push(
        `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data) values(${quote(localId)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${quote(`payroll-local-${employee.quickresto_id}@sheerly.invalid`)},'','infinity',${quote(JSON.stringify({ local_payroll_preview: true, providers: [] }))}::jsonb,${quote(JSON.stringify({ first_name: first, last_name: last.join(" ") }))}::jsonb) on conflict(id) do nothing;`,
      );
      statements.push(
        `insert into public.profiles(id,first_name,last_name,active_venue_id) values(${quote(localId)},${quote(first)},${quote(last.join(" "))},${quote(venue.id)}) on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,active_venue_id=excluded.active_venue_id;`,
      );
      statements.push(
        `insert into public.user_venue_roles(user_id,venue_id,role_id,status) values(${quote(localId)},${quote(venue.id)},${quote(employee.role_id)},'active') on conflict(user_id,venue_id) do nothing;`,
      );
      statements.push(
        `update public.payroll_employees set local_user_id=${quote(localId)} where id=${quote(employee.id)} and venue_id=${quote(venue.id)} and local_user_id is null;`,
      );
    }
  }
  const note = `Однократный перенос графика. Источник: ${row.url}. Начало — персональная запись. ${finish ? "Окончание — персональная запись." : `Окончание — расписание «${row["Должность"]}», ${wd} (${rules[0]["Окончание"]}).`}`;
  statements.push(
    `insert into public.schedule_shifts(id,venue_id,user_id,payroll_employee_id,payroll_model_id,role_id,title,color,starts_at,ends_at,note,published) values(${quote(uuid(row.url))},${quote(venue.id)},${quote(localId)},${quote(employee.casual ? employee.id : null)},${quote(employee.casual ? employee.model_id : null)},${quote(employee.role_id)},${quote(row["Должность"])},${quote(row["Должность"].startsWith("Бармен") ? "blue" : row["Должность"].startsWith("Мастер") ? "purple" : "green")},${quote(start.toISOString())},${quote(end.toISOString())},${quote(note)},true) on conflict(id) do nothing;`,
  );
  imported.push({
    source: row.url,
    employee_id: employee.id,
    name: employee.name,
    date: day,
    shift_id: uuid(row.url),
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
  });
}
statements.push("commit;");
await writeFile("/tmp/sheerly-real-schedule-apply.sql", statements.join("\n"));
await writeFile(
  "/tmp/sheerly-real-schedule-report.json",
  JSON.stringify({ imported, skipped }, null, 2),
);
console.log(
  JSON.stringify(
    {
      shifts: imported.length,
      employees: linked.size,
      months: Object.fromEntries(
        [...new Set(imported.map((r) => r.date.slice(0, 7)))].map((m) => [
          m,
          imported.filter((r) => r.date.startsWith(m)).length,
        ]),
      ),
      skipped,
    },
    null,
    2,
  ),
);
