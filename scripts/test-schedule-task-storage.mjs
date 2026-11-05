/** Local integration only: real private upload -> report -> signed download, with cleanup. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    }),
);
assert(
  ["localhost", "127.0.0.1"].includes(
    new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  ),
  "Only a local database is allowed",
);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const staff = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  options,
);
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const user = check(
  await staff.auth.signInWithPassword({
    email: "waiter@test.com",
    password: "password123",
  }),
).user;
const venueId = check(await staff.rpc("get_active_venue_id"));
const venue = check(
  await admin
    .from("venues")
    .select("account_id,timezone")
    .eq("id", venueId)
    .single(),
);
const settings = check(
  await admin
    .from("schedule_task_settings")
    .select("enabled_from")
    .eq("venue_id", venueId)
    .maybeSingle(),
);
assert(
  !settings?.enabled_from,
  "The local automatic task handler must be off during this check",
);
const d = new Intl.DateTimeFormat("en-CA", {
  timeZone: venue.timezone || "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const templateId = randomUUID(),
  definitionId = randomUUID(),
  shiftId = randomUUID(),
  occurrenceId = randomUUID(),
  itemId = randomUUID();
const path = `${occurrenceId}/${itemId}/${randomUUID()}.png`;
let employeeId = null,
  createdEmployee = false;
try {
  employeeId = check(
    await admin
      .from("payroll_employees")
      .select("id")
      .eq("venue_id", venueId)
      .eq("local_user_id", user.id)
      .maybeSingle(),
  )?.id;
  if (!employeeId) {
    employeeId = randomUUID();
    check(
      await admin
        .from("payroll_employees")
        .insert({
          id: employeeId,
          account_id: venue.account_id,
          venue_id: venueId,
          local_user_id: user.id,
          name: "Проверка отчёта",
          role_name: "Официант",
        }),
    );
    createdEmployee = true;
  }
  check(
    await admin
      .from("schedule_templates")
      .insert({
        id: templateId,
        venue_id: venueId,
        name: "Проверка загрузки фото",
        color: "blue",
        start_time: "09:00",
        end_time: "17:00",
      }),
  );
  const def = {
    id: definitionId,
    account_id: venue.account_id,
    venue_id: venueId,
    name: "Проверка приватного отчёта",
    instructions: "Тест",
    template_id: templateId,
    review_mode: "auto",
    items: [
      {
        id: itemId,
        title: "Фотография",
        kind: "photo",
        required: true,
        hint: "",
        parent_id: null,
        min: null,
        max: null,
        unit: "",
        max_length: 2000,
      },
    ],
    recurrence: { unit: "week", interval: 1, anchor: d },
    starts_on: d,
    enabled: false,
    penalty_enabled: false,
    fine_amount: null,
    reward_amount: null,
  };
  check(await admin.from("schedule_task_definitions").insert(def));
  check(
    await admin
      .from("schedule_shifts")
      .insert({
        id: shiftId,
        venue_id: venueId,
        user_id: user.id,
        template_id: templateId,
        title: "Проверка отчёта",
        color: "blue",
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 3600000).toISOString(),
        published: true,
      }),
  );
  check(
    await admin
      .from("schedule_task_occurrences")
      .insert({
        id: occurrenceId,
        venue_id: venueId,
        account_id: venue.account_id,
        definition_id: definitionId,
        business_date: d,
        shift_id: shiftId,
        employee_id: employeeId,
        user_id: user.id,
        employee_name: "Проверка отчёта",
        snapshot: def,
        status: "assigned",
        deadline_at: new Date(Date.now() + 3600000).toISOString(),
      }),
  );
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
    "base64",
  );
  check(
    await staff.storage
      .from("task-evidence")
      .upload(path, bytes, { contentType: "image/png" }),
  );
  check(
    await staff.rpc("schedule_task_command", {
      p_action: "run.submit",
      p_input: { id: occurrenceId, version: 1, answers: { [itemId]: path } },
    }),
  );
  const report = check(
    await staff
      .from("schedule_task_occurrences")
      .select("status,answers")
      .eq("id", occurrenceId)
      .single(),
  );
  assert.equal(report.status, "completed");
  assert.equal(report.answers[itemId], path);
  const signed = check(
    await staff.storage.from("task-evidence").createSignedUrl(path, 60),
  );
  const image = await fetch(signed.signedUrl);
  assert.equal(image.status, 200);
  assert.equal((await image.arrayBuffer()).byteLength, bytes.length);
  const denied = await staff.storage
    .from("task-evidence")
    .upload(`${randomUUID()}/${itemId}/${randomUUID()}.png`, bytes, {
      contentType: "image/png",
    });
  assert(denied.error, "A foreign report upload was allowed");
  const anonymous = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    options,
  );
  assert(
    (await anonymous.storage.from("task-evidence").download(path)).error,
    "Anonymous access to evidence was allowed",
  );
  process.stdout.write(
    "PASS: real private photo upload, automatic report acceptance, signed image read, foreign-upload rejection, anonymous-read rejection\n",
  );
} finally {
  check(await admin.storage.from("task-evidence").remove([path]));
  check(
    await admin
      .from("schedule_task_history")
      .delete()
      .in("entity_id", [occurrenceId, definitionId]),
  );
  check(
    await admin
      .from("schedule_task_occurrences")
      .delete()
      .eq("id", occurrenceId),
  );
  check(
    await admin
      .from("schedule_task_definitions")
      .delete()
      .eq("id", definitionId),
  );
  check(await admin.from("schedule_shifts").delete().eq("id", shiftId));
  check(await admin.from("schedule_templates").delete().eq("id", templateId));
  if (createdEmployee)
    check(await admin.from("payroll_employees").delete().eq("id", employeeId));
}
