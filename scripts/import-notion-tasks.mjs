/**
 * Prepared Notion instructions -> disabled native drafts. Dry run by default.
 * node scripts/import-notion-tasks.mjs --venue UUID [--apply]
 * Production additionally requires --allow-production; this never enables a worker.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2),
  arg = (name) => args[args.indexOf(name) + 1];
const venueId = arg("--venue");
if (!args.includes("--venue") || !/^[0-9a-f-]{36}$/.test(venueId ?? ""))
  throw new Error("Укажите --venue UUID");
const env = { ...process.env };
const envPath = new URL("../.env.local", import.meta.url);
for (const line of (existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : ""
).split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Не настроена база данных");
const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
if (args.includes("--apply") && !local && !args.includes("--allow-production"))
  throw new Error(
    "Для производственной базы требуется явный --allow-production после сверки",
  );
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../docs/automation-migration/notion-task-checklists-2026-11-05.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const source = JSON.parse(
  readFileSync(
    new URL(
      "../docs/automation-migration/notion-tasks-source-2026-11-05.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const uuid = (value) => {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const addDays = (d, n) => {
  const date = new Date(d + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
};
const clean = (text) =>
  (text ?? "")
    .replace(/<image[^>]*\/>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<mention url="([^"]+)"[^>]*\/>/g, " (Раздел инструкции: $1) ")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/t[dh]>/g, " · ")
    .replace(/<\/(?:p|li|tr|callout|h[1-6])>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|<\/?>/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/\n[ \t]+/g, "\n")
    .replace(
      /в комментар(?:ий|ии)(?: к задаче)?/gi,
      "в отчёт этой задачи в Sheerly",
    )
    .replace(
      /Загрузите отчёт в отчёт этой задачи в Sheerly/gi,
      "Заполните отчёт этой задачи в Sheerly",
    )
    .replace(/ и отметьте (?:управляющего|менеджера)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const venue = await db
  .from("venues")
  .select("id,account_id,name")
  .eq("id", venueId)
  .single();
if (venue.error) throw new Error(venue.error.message);
const [templates, existing] = await Promise.all([
  db
    .from("schedule_templates")
    .select("id,name")
    .eq("venue_id", venueId)
    .eq("archived", false),
  db
    .from("schedule_task_definitions")
    .select("id,source_key")
    .eq("venue_id", venueId),
]);
if (templates.error || existing.error)
  throw new Error(templates.error?.message || existing.error?.message);
const planned = [],
  problems = [];
for (const task of manifest.tasks) {
  const matches = templates.data.filter((t) => t.name === task.shiftTemplate);
  if (matches.length !== 1) {
    problems.push(
      `${task.name}: нет однозначного шаблона «${task.shiftTemplate}»`,
    );
    continue;
  }
  const original = source.templates.find((t) => t.sourceId === task.sourceId);
  const sourceKey = `notion:${task.key}`;
  const id =
    existing.data.find((e) => e.source_key === sourceKey)?.id ??
    uuid(`${venueId}:${sourceKey}`);
  const anchor = addDays(
    task.recurrence.nextOccurrence,
    task.dateOffsetDays ?? 0,
  );
  let instructions = clean(original?.sourceContent);
  if (task.name === "Уборка за холодильниками на кухне")
    instructions = instructions.replace(
      /Каждую пятницу/g,
      "Каждый понедельник",
    );
  if (task.name === "Подготовить подсвечники к мойке")
    instructions =
      "В конце смены подготовьте все 14 подсвечников к мойке.\n\n1. Достаньте фитили и уберите в отдельный пакет в контейнер на кальянном баре.\n2. Пересыпьте воск из подсвечников в контейнер в вентиляционной.\n3. Поставьте все подсвечники на барную стойку.\n4. Приложите фотографию всех подготовленных подсвечников к пункту отчёта в Sheerly.\n\nМойка и расстановка назначаются отдельной задачей следующего дня. За подготовку начислений нет.";
  if (task.name === "Вымыть и расставить подсвечники")
    instructions =
      "Проверьте выполнение подготовки и её фотографии в предыдущей задаче.\n\n1. Утром следующего дня очистите стеклянные подсвечники от воска металлической и обычной губками.\n2. Хорошо промойте водой и насухо натрите вафельным полотном.\n3. До заполнения воском приложите к пункту отчёта в Sheerly фотографию всех чистых и сухих подсвечников.\n4. Заполните подсвечники воском, установите фитили и расставьте на столы.";
  planned.push({
    id,
    account_id: venue.data.account_id,
    venue_id: venueId,
    source_key: sourceKey,
    source_url: task.sourceUrl,
    name: task.name,
    instructions,
    template_id: matches[0].id,
    review_mode: "manager",
    enabled: false,
    starts_on: anchor,
    recurrence: {
      unit: task.recurrence.unit,
      interval: task.recurrence.interval,
      anchor,
    },
    items: task.items.map((i) => ({
      ...i,
      id: uuid(`${sourceKey}:${i.id}`),
      hint: "",
      parent_id: null,
      min: null,
      max: null,
      unit: "",
      max_length: 2000,
    })),
    penalty_enabled: task.name !== "Подготовить подсвечники к мойке",
    fine_amount: task.fine,
    reward_amount: task.rewardForTransferred,
    predecessor_id: task.dependsOnKey
      ? (existing.data.find(
          (e) => e.source_key === `notion:${task.dependsOnKey}`,
        )?.id ?? uuid(`${venueId}:notion:${task.dependsOnKey}`))
      : null,
    predecessor_offset: task.dependsOnKey ? 1 : 0,
    equipment_groups: task.equipmentCycleGroups ?? [],
  });
}
if (problems.length) {
  for (const p of problems) process.stderr.write(p + "\n");
  throw new Error("Импорт остановлен: исправьте соответствия шаблонов");
}
const fresh = planned.filter(
  (t) => !existing.data.some((e) => e.source_key === t.source_key),
);
process.stdout.write(
  JSON.stringify(
    {
      mode: args.includes("--apply") ? "apply_disabled_drafts" : "dry_run",
      venue: venue.data.name,
      planned: planned.length,
      alreadyPresent: planned.length - fresh.length,
      newDrafts: fresh.length,
      managerReviewDefault: true,
      workerActivation: false,
    },
    null,
    2,
  ) + "\n",
);
if (args.includes("--apply")) {
  if (fresh.length) {
    const r = await db.from("schedule_task_definitions").insert(fresh);
    if (r.error) throw new Error(r.error.message);
  }
  const check = await db
    .from("schedule_task_definitions")
    .select("id,source_key,enabled,items")
    .eq("venue_id", venueId)
    .in(
      "source_key",
      planned.map((t) => t.source_key),
    );
  if (check.error) throw new Error(check.error.message);
  if (check.data.length !== planned.length)
    throw new Error("Не все черновики подтверждены повторным чтением");
  process.stdout.write(
    `Подтверждено чтением: ${check.data.length} задач; новых черновиков: ${fresh.length}. Настройки перехода не изменялись.\n`,
  );
}
