/** Local integration: old returned reports retain their settled handover evidence. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    }),
);
const site = process.env.TEST_SITE_URL || "http://localhost:3001";
for (const url of [env.NEXT_PUBLIC_SUPABASE_URL, site])
  assert(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Only a local test environment is allowed",
  );
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
let jar = [];
const client = createServerClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => jar,
      setAll: (rows) => {
        for (const cookie of rows) {
          jar = jar.filter((c) => c.name !== cookie.name);
          jar.push(cookie);
        }
      },
    },
  },
);
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const definitionId = randomUUID(),
  prerequisiteId = randomUUID(),
  returnedId = randomUUID();
try {
  const { user } = check(
    await client.auth.signInWithPassword({
      email: "owner@test.com",
      password: "password123",
    }),
  );
  const venue = check(await client.rpc("get_active_venue_id"));
  const settings = check(
    await admin
      .from("schedule_task_settings")
      .select("enabled_from")
      .eq("venue_id", venue)
      .maybeSingle(),
  );
  assert(!settings?.enabled_from, "Local task processing must remain off");
  const source = check(
    await admin
      .from("schedule_task_definitions")
      .select("*")
      .eq("venue_id", venue)
      .limit(1)
      .single(),
  );
  const definition = {
    ...source,
    id: definitionId,
    name: "TEST history definition",
    source_key: `test-history:${definitionId}`,
    enabled: false,
    predecessor_id: null,
    predecessor_offset: 0,
  };
  check(await admin.from("schedule_task_definitions").insert(definition));
  const date = (days) =>
    new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const marker = `TEST old handover snapshot ${prerequisiteId}`;
  check(
    await admin.from("schedule_task_occurrences").insert([
      {
        id: prerequisiteId,
        venue_id: venue,
        account_id: source.account_id,
        definition_id: definitionId,
        business_date: date(46),
        snapshot: { ...definition, name: marker },
        status: "completed",
        user_id: user.id,
        settled_at: new Date().toISOString(),
      },
      {
        id: returnedId,
        venue_id: venue,
        account_id: source.account_id,
        definition_id: definitionId,
        business_date: date(45),
        snapshot: definition,
        status: "returned",
        user_id: user.id,
        predecessor_occurrence_id: prerequisiteId,
        deadline_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ]),
  );
  const response = await fetch(`${site}/schedule/tasks`, {
    headers: { cookie: jar.map((c) => `${c.name}=${c.value}`).join("; ") },
  });
  assert.equal(response.status, 200);
  assert(
    (await response.text()).includes(marker),
    "The settled prerequisite outside the 31-day window was omitted",
  );
  console.log(
    "PASS: authenticated task screen loads a 46-day-old settled prerequisite of an unsettled returned report",
  );
} finally {
  check(
    await admin.from("schedule_task_occurrences").delete().eq("id", returnedId),
  );
  check(
    await admin
      .from("schedule_task_occurrences")
      .delete()
      .eq("id", prerequisiteId),
  );
  check(
    await admin
      .from("schedule_task_definitions")
      .delete()
      .eq("id", definitionId),
  );
  check(
    await admin
      .from("schedule_task_history")
      .delete()
      .in("entity_id", [definitionId, prerequisiteId, returnedId]),
  );
  await client.auth.signOut({ scope: "local" });
}
