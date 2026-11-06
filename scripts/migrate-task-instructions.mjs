/** Move legacy task instructions into KB pages. Dry run by default; never enables tasks. */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const args = process.argv.slice(2),
  venue = args[args.indexOf("--venue") + 1];
if (!args.includes("--venue") || !/^[a-f0-9-]{36}$/.test(venue ?? ""))
  throw new Error("Укажите --venue UUID");
const env = { ...process.env };
const envPath=new URL("../.env.local",import.meta.url);
for (const l of (existsSync(envPath) ? readFileSync(envPath,"utf8") : "").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const local = ["localhost", "127.0.0.1"].includes(
  new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,
);
if (args.includes("--apply") && !local && !args.includes("--allow-production"))
  throw new Error("Для производственной базы требуется --allow-production");
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const uuid = (v) => {
  const h = createHash("sha256").update(v).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const defs = check(
  await db
    .from("schedule_task_definitions")
    .select(
      "id,account_id,name,instructions,source_url,enabled,instruction_page_id",
    )
    .eq("venue_id", venue).is("deleted_at", null),
);
const pending = defs.filter(
  (d) => !d.instruction_page_id && d.instructions.trim(),
);
if (pending.some((d) => d.enabled))
  throw new Error("Выключите задачи перед переносом инструкций");
const venueRow = check(
  await db.from("venues").select("name,account_id").eq("id", venue).single(),
);
const folderId = uuid(`task-instructions:${venue}`);
console.log(
  JSON.stringify({
    mode: args.includes("--apply") ? "apply" : "dry_run",
    pages: pending.length,
    alreadyLinked: defs.length - pending.length,
    workerActivation: false,
  }),
);
if (args.includes("--apply") && pending.length) {
  if (!local && !env.TASK_INSTRUCTION_ACCESS_TOKEN)
    throw new Error(
      "Нужен TASK_INSTRUCTION_ACCESS_TOKEN владельца для создания страниц с аудитом",
    );
  const kb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(local
        ? {}
        : {
            global: {
              headers: {
                Authorization: `Bearer ${env.TASK_INSTRUCTION_ACCESS_TOKEN}`,
              },
            },
          }),
    },
  );
  if (local)
    check(
      await kb.auth.signInWithPassword({
        email: "owner@test.com",
        password: "password123",
      }),
    );
  const actor = check(
    await kb.auth.getUser(
      local ? undefined : env.TASK_INSTRUCTION_ACCESS_TOKEN,
    ),
  ).user;
  if (!actor) throw new Error("Не удалось определить владельца переноса");
  const account = check(await kb.rpc("get_active_account_id"));
  if (account !== venueRow.account_id)
    throw new Error("Аккаунт владельца не совпадает с заведением");
  const folder = check(
    await db
      .from("kb_pages")
      .select("id,account_id,deleted_at")
      .eq("id", folderId)
      .maybeSingle(),
  );
  if (
    folder &&
    (folder.account_id !== venueRow.account_id || folder.deleted_at)
  )
    throw new Error("Папка инструкций недоступна");
  if (!folder)
    check(
      await kb.from("kb_pages").insert({
        id: folderId,
        account_id: venueRow.account_id,
        created_by: actor.id,
        updated_by: actor.id,
        title: `Инструкции задач · ${venueRow.name}`,
        slug: `task-instructions-${venue}`,
        content: [],
      }),
    );
  for (const d of pending) {
    if (
      check(
        await db
          .from("schedule_task_occurrences")
          .select("id")
          .eq("definition_id", d.id)
          .limit(1),
      ).length
    )
      throw new Error("У задачи есть отчёты: выберите инструкцию вручную");
    const id = uuid(`task-instruction:${d.id}`);
    let page = check(
      await db.from("kb_pages").select("*").eq("id", id).maybeSingle(),
    );
    if (page && (page.account_id !== d.account_id || page.deleted_at))
      throw new Error("Страница инструкции недоступна");
    if (!page) {
      const content = d.instructions
        .split(/\n+/)
        .filter(Boolean)
        .map((text, n) => ({
          id: uuid(`${id}:${n}`),
          type: "paragraph",
          content: [{ type: "text", text, styles: {} }],
        }));
      if (d.source_url)
        content.push({
          id: uuid(`${id}:source`),
          type: "paragraph",
          content: [
            {
              type: "link",
              href: d.source_url,
              content: [
                {
                  type: "text",
                  text: "Исходная инструкция с иллюстрациями",
                  styles: {},
                },
              ],
            },
          ],
        });
      page = check(
        await kb
          .from("kb_pages")
          .insert({
            id,
            parent_id: folderId,
            account_id: d.account_id,
            created_by: actor.id,
            updated_by: actor.id,
            title: d.name,
            slug: `task-instruction-${d.id}`,
            content,
            plain_text: d.instructions,
          })
          .select("*")
          .single(),
      );
    }
    const instruction = {
      page_id: id,
      title: page.title,
      content: page.content,
      updated_at: page.updated_at,
      files: [],
    };
    const updated = check(
      await db
        .from("schedule_task_definitions")
        .update({ instruction_page_id: id, instruction_snapshot: instruction })
        .eq("id", d.id)
        .eq("enabled", false)
        .is("instruction_page_id", null)
        .select("id"),
    );
    if (updated.length)
      check(
        await db.from("schedule_task_history").insert({
          venue_id: venue,
          entity_id: d.id,
          action: "definition.instruction_linked",
          details: { page_id: id, source: "legacy_instruction_migration" },
        }),
      );
  }
}
