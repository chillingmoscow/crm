import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const code = ts.transpileModule(
  await readFile(
    new URL("../src/lib/sales/additional.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { defaultAdditionalRules, additionalAward } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const headers = {
  Sales: [
    "Дата",
    "Дата / Номер месяца",
    "Дата / Год",
    "Заведение / ID",
    "Смена / ID",
    "Выручка",
    "Себестоимость",
    "Общая прибавка",
    "Чай Премиум",
    "Добавки",
    "Крепкий алкоголь",
    "Вино (бокалы)",
    "Вино (бутылки)",
    "Коктейли Фирменные",
    "Настойки (порция)",
    "Настойки (сет)",
    "Лимонады (бокал)",
    "Лимонады (графин)",
    "Авторский чай",
    "Коктейль-конструктор",
  ],
  KPI: [
    "Дата",
    "Дата / Номер месяца",
    "Дата / Год",
    "Заведение / ID",
    "Смена / ID",
    "Выручка",
    "Себестоимость",
    "Общая прибавка",
    "Дополнительный доход",
    "Баллы / За смену",
    "Премиальный табак",
    "Дегустационный сет",
    "Эксклюзивные кальяны",
  ],
};
const numeric = (value, nullable = false) => {
  if ((value === null || value === undefined || value === "") && nullable)
    return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e12 ||
    Math.round((value + Number.EPSILON) * 100) / 100 !== value
  )
    throw new Error("Некорректное числовое значение источника");
  return value;
};
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function prepareAdditionalArchive(source, legacyVenue) {
  if (!Number.isFinite(Date.parse(source.captured_at)))
    throw new Error("Нет даты снимка");
  const records = [],
    duplicates = [],
    held = [];
  for (const sheet of ["Sales", "KPI"]) {
    const input = source.sheets[sheet];
    if (
      !input ||
      JSON.stringify(input.values[0]) !== JSON.stringify(headers[sheet])
    )
      throw new Error("Изменились заголовки " + sheet);
    const byDate = new Map(),
      kind = sheet === "Sales" ? "bar" : "masters";
    input.values.slice(1).forEach((row, index) => {
      if (!row.length || row.every((v) => v == null || v === "")) return;
      const serial = numeric(row[0]);
      if (!Number.isInteger(serial)) throw new Error("Неоднозначная дата");
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
        .toISOString()
        .slice(0, 10);
      if (row[3] === undefined || row[3] === null || row[3] === "") {
        held.push({
          sheet,
          row: index + 2,
          date,
          reason: "Нет заведения и полного набора показателей",
        });
        return;
      }
      if (
        Number(date.slice(0, 4)) < 2000 ||
        Number(date.slice(0, 4)) > 2100 ||
        row[1] !== Number(date.slice(5, 7)) ||
        row[2] !== Number(date.slice(0, 4)) ||
        row[3] !== legacyVenue
      )
        throw new Error("Дата или заведение источника не совпали");
      const quantities = Object.fromEntries(
        defaultAdditionalRules[kind].map((g, i) => [
          g.id,
          numeric(row[(kind === "bar" ? 8 : 10) + i], true),
        ]),
      );
      const metrics = {
        revenue: numeric(row[5]),
        primeCost: numeric(row[6]),
        bonus: numeric(row[7]),
        points: kind === "masters" ? numeric(row[9]) : null,
        quantities,
      };
      const range = `${sheet}!A${index + 2}:${kind === "bar" ? "T" : "M"}${index + 2}`;
      // Column I of KPI is deliberately excluded by the owner, including the raw source.
      const kept = Object.fromEntries(
        headers[sheet].flatMap((h, i) =>
          sheet === "KPI" && i === 8 ? [] : [[h, row[i] ?? null]],
        ),
      );
      const content = {
        business_date: date,
        kind,
        metrics,
        origin: {
          spreadsheet_id: source.spreadsheet_id,
          legacy_venue_id: legacyVenue,
          legacy_shift_id: row[4] ?? null,
          ranges: [range],
          raw: kept,
        },
      };
      const previous = byDate.get(date);
      if (previous) {
        if (
          JSON.stringify(previous.metrics) !== JSON.stringify(metrics) ||
          previous.origin.legacy_shift_id !== content.origin.legacy_shift_id
        )
          throw new Error("Конфликтующие строки " + sheet + " за " + date);
        previous.origin.ranges.push(range);
        duplicates.push({ kind, date, ranges: [...previous.origin.ranges] });
        return;
      }
      byDate.set(date, content);
    });
    records.push(
      ...[...byDate.values()].map((r) => ({
        ...r,
        source_hash: digest(r),
        captured_at: source.captured_at,
      })),
    );
  }
  if (!records.length) throw new Error("Источник пуст");
  return {
    records,
    duplicates,
    held,
    ruleDifferences: records
      .filter((r) => {
        const n = additionalAward(r.kind, r.metrics.quantities);
        return n.bonus !== r.metrics.bonus || n.points !== r.metrics.points;
      })
      .map((r) => ({ date: r.business_date, kind: r.kind })),
  };
}
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const uuid = (value) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error("Некорректный ID области");
  return literal(value);
};
export function additionalImportSql(plan, target) {
  const [a, v, u] = ["account_id", "venue_id", "owner_id"].map((k) =>
    uuid(target[k]),
  );
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(target.rules_valid_from ?? "") ||
    !Number.isFinite(Date.parse(target.rules_valid_from)) ||
    new Date(target.rules_valid_from + "T12:00:00Z")
      .toISOString()
      .slice(0, 10) !== target.rules_valid_from
  )
    throw new Error("Укажите согласованную дату начала нативных правил");
  const ids = target.report_ids;
  if (
    !ids ||
    ["masters", "bar", "cocktail"].some(
      (k) => !Number.isSafeInteger(ids[k]) || ids[k] <= 0,
    )
  )
    throw new Error("Нужны проверенные ID QR-отчётов");
  const payload =
    literal(
      JSON.stringify({
        records: plan.records,
        rules: defaultAdditionalRules,
        rules_valid_from: target.rules_valid_from,
        source: target.origin ?? {},
      }),
    ) + "::jsonb";
  const fingerprint = `md5(jsonb_build_object('sales',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_days t where venue_id=${v}),'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id=${v}),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id=${v}),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id=${v}),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t where account_id=${a}))::text)`;
  return `begin;
set local standard_conforming_strings=on;
select set_config('request.jwt.claim.sub',${u},true);
select set_config('app.ctx_ready','0',true);
select pg_advisory_xact_lock(hashtextextended('sales-additional-import:'||${v},0));
create temporary table _sales_additional_input(payload jsonb) on commit drop;
insert into _sales_additional_input values(${payload});
do $import$ declare p jsonb;r jsonb;old public.sales_additional_archive;n integer:=0;before_hash text;after_hash text;begin
 if public.get_active_account_id() is distinct from ${a}::uuid or public.get_active_venue_id() is distinct from ${v}::uuid or not public.is_account_owner(${a}::uuid) then raise exception 'Wrong owner/scope';end if;
 select payload into p from pg_temp._sales_additional_input;select ${fingerprint} into before_hash;
 perform private.sales_validate_additional_rules(p->'rules');
 insert into public.sales_additional_sources(account_id,venue_id,masters_report_id,bar_report_id,cocktail_report_id,origin) values(${a},${v},${ids.masters},${ids.bar},${ids.cocktail},p->'source') on conflict(venue_id) do nothing;
 if not exists(select 1 from public.sales_additional_sources where account_id=${a} and venue_id=${v} and masters_report_id=${ids.masters} and bar_report_id=${ids.bar} and cocktail_report_id=${ids.cocktail}) then raise exception 'Conflicting source configuration';end if;
 if not exists(select 1 from public.sales_additional_rules where account_id=${a} and venue_id=${v}) then
  insert into public.sales_additional_rules(account_id,venue_id,valid_from,config,reason,created_by) select ${a},${v},(p->>'rules_valid_from')::date,p->'rules','Правила допродаж сверены с опубликованными n8n и Fees',${u};
 end if;
 for r in select value from jsonb_array_elements(p->'records') loop
  select * into old from public.sales_additional_archive where venue_id=${v} and business_date=(r->>'business_date')::date and kind=r->>'kind' order by captured_at desc limit 1;
  if found and old.source_hash=r->>'source_hash' then continue;end if;
  if found and old.captured_at>=(r->>'captured_at')::timestamptz then raise exception 'Newer/conflicting snapshot exists';end if;
  insert into public.sales_additional_archive(account_id,venue_id,business_date,kind,metrics,origin,source_hash,captured_at,imported_by) values(${a},${v},(r->>'business_date')::date,r->>'kind',r->'metrics',r->'origin',r->>'source_hash',(r->>'captured_at')::timestamptz,${u});n:=n+1;
 end loop;
 if n>0 then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(${a},${v},${u},'sales.additional.archive_imported','venue',${v},jsonb_build_object('days',n,'source','Fees / Sales, KPI'));end if;
 select ${fingerprint} into after_hash;if before_hash is distinct from after_hash then raise exception 'Financial/sales data changed';end if;
 raise notice 'Imported % snapshots; salary, transactions and balances unchanged',n;
end $import$;
commit;
`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const arg = (key) => {
    const i = process.argv.indexOf(key);
    if (i < 0 || !process.argv[i + 1]) throw new Error("Укажите " + key);
    return process.argv[i + 1];
  };
  const source = JSON.parse(await readFile(arg("--source"), "utf8")),
    target = JSON.parse(await readFile(arg("--target"), "utf8"));
  const plan = prepareAdditionalArchive(source, target.legacy_venue_id);
  await writeFile(arg("--sql"), additionalImportSql(plan, target));
  const report = {
    records: plan.records.length,
    from: plan.records.map((r) => r.business_date).sort()[0],
    through: plan.records
      .map((r) => r.business_date)
      .sort()
      .at(-1),
    duplicates: plan.duplicates,
    held: plan.held,
    rulesValidFrom: target.rules_valid_from,
    historicalRuleDifferences: plan.ruleDifferences,
  };
  await writeFile(arg("--report"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
