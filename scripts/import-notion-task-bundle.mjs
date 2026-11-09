/** Import the prepared private bundle into KB and add all missing disabled tasks.
 * Dry run by default. --bundle DIRECTORY --venue UUID [--apply].
 * Run import-notion-tasks.mjs and migrate-task-instructions.mjs first.
 * No worker, payroll or notification activation is performed here.
 */
import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { resolve, basename, sep } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { mergeImportedContent, importedMediaUrls } from "./notion-bundle-content.mjs";

import { scopeNotionBundle, stripPersonalNotionReferences } from "./notion-bundle-scope.mjs";

const args = process.argv.slice(2);
const arg = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const venue = arg("--venue"),
  bundleDir = arg("--bundle");
if (!/^[a-f0-9-]{36}$/.test(venue ?? "") || !bundleDir)
  throw Error("Укажите --venue UUID --bundle DIRECTORY");
const bundleRoot = realpathSync(bundleDir);
const bundle = JSON.parse(
  readFileSync(resolve(bundleRoot, "bundle.json"), "utf8"),
);
if (
  bundle.schemaVersion !== 1 ||
  !Array.isArray(bundle.pages) ||
  !Array.isArray(bundle.assets)
)
  throw Error("Неверный формат пакета");
if (!args.includes("--catalog-only") && bundle.missingAssets.length)
  throw Error("Сначала восстановите недостающие вложения пакета");
const scoped = scopeNotionBundle(bundle);
const stable = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const sha = (v) => createHash("sha256").update(v).digest("hex");
const uuid = (v) => {
  const h = sha(v);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const canonical = (v) => v.replaceAll("-", "").toLowerCase();
const check = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const env = { ...process.env };
const envPath = new URL("../.env.local", import.meta.url);
for (const line of (existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : ""
).split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}
const local = ["localhost", "127.0.0.1"].includes(
  new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,
);
const apply = args.includes("--apply");
const verify = args.includes("--verify");
if (apply && !local && !args.includes("--allow-production"))
  throw Error("Для производственной базы требуется --allow-production");
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const venueRow = check(
  await db.from("venues").select("id,name,account_id").eq("id", venue).single(),
);
const account = venueRow.account_id;
const defs = check(
  await db.from("schedule_task_definitions").select("*").eq("venue_id", venue),
);
if (defs.some((d) => d.enabled))
  throw Error("Перед переносом выключите шаблоны задач");
if (
  check(
    await db
      .from("schedule_task_occurrences")
      .select("id")
      .eq("venue_id", venue)
      .limit(1),
  ).length
)
  throw Error(
    "Есть назначенные задания: требуется отдельный перенос с сохранением отчётов",
  );
const settings = check(
  await db
    .from("schedule_task_settings")
    .select("enabled_from")
    .eq("venue_id", venue)
    .maybeSingle(),
);
if (settings?.enabled_from)
  throw Error("Автоматическое назначение уже включено");
// Owner removed this empty Notion placeholder; never recreate it on a fresh import.
const excludedSources = new Set(["c802ca9bf68c4bba9ecebcae1ea6cf12"]);
const source = JSON.parse(
  readFileSync(
    new URL(
      "../docs/automation-migration/notion-tasks-source-2026-11-05.json",
      import.meta.url,
    ),
    "utf8",
  ),
).templates;
const curated = JSON.parse(
  readFileSync(
    new URL(
      "../docs/automation-migration/notion-task-checklists-2026-11-05.json",
      import.meta.url,
    ),
    "utf8",
  ),
).tasks;
const templates = check(
  await db
    .from("schedule_templates")
    .select("id,name,subtitle")
    .eq("venue_id", venue)
    .eq("archived", false),
);
for (const t of curated)
  if (!defs.find((d) => d.source_key === `notion:${t.key}`))
    throw Error("Сначала выполните импорт подготовленных чек-листов");
const roles = {
  "Мастер №1": "Мастер · день",
  "Мастер №2": "Мастер · вечер",
  "Бармен №1": "Бармен · день",
  "Бармен №2": "Бармен · вечер",
  "Менеджер №1": "Менеджер · день",
  "Менеджер №2": "Менеджер · вечер",
};
const fresh = [];
for (const s of source) {
  if (excludedSources.has(canonical(s.sourceId))) continue;
  if (curated.some((t) => canonical(t.sourceId) === canonical(s.sourceId)))
    continue;
  const key = `notion:archive:${canonical(s.sourceId)}`;
  if (defs.some((d) => d.source_key === key)) continue;
  const match = templates.filter((t) => [t.name, t.subtitle].filter(Boolean).join(" · ") === roles[s.sourceRole]);
  if (s.sourceRole && match.length !== 1)
    throw Error("Нет однозначного шаблона смены для " + s.name);
  fresh.push({
    id: uuid(`${venue}:${key}`),
    account_id: account,
    venue_id: venue,
    source_key: key,
    source_url: s.sourceUrl,
    name: s.name || "Без названия",
    instructions: "",
    template_id: match[0]?.id ?? null,
    review_mode: "manager",
    items: [],
    recurrence: null,
    starts_on: new Date().toISOString().slice(0, 10),
    enabled: false,
    penalty_enabled: false,
    fine_amount: s.sourceFine,
    reward_amount: s.sourceReward,
    equipment_groups: [],
  });
}
if (args.includes("--catalog-only")) {
  console.log(
    JSON.stringify({
      mode: apply ? "apply_disabled_drafts" : "dry_run",
      newTasks: fresh.length,
      totalTasks: defs.filter((d) => !d.deleted_at).length + fresh.length,
      activation: false,
    }),
  );
  if (apply && fresh.length) {
    check(await db.from("schedule_task_definitions").insert(fresh));
    check(
      await db.from("schedule_task_history").insert(
        fresh.map((d) => ({
          venue_id: venue,
          entity_id: d.id,
          action: "definition.imported",
          details: { source: "notion_full_catalog", enabled: false },
        })),
      ),
    );
  }
  process.exit(0);
}
const allDefs = [
  ...defs.filter((d) => !d.deleted_at && d.source_key?.startsWith("notion:")),
  ...fresh,
];
const folderId = uuid(`task-instructions:${venue}`),
  relatedId = uuid(`task-instruction-references:${venue}`);
const targets = new Map();
const pages = [];
for (const p of scoped.pages) {
  if (excludedSources.has(p.sourceId)) continue;
  if (!/^[a-f0-9]{31,32}$/.test(p.sourceId))
    throw Error("Неверный идентификатор источника");
  const native = [...defs, ...fresh].filter((d) => {
    const c = curated.find((t) => `notion:${t.key}` === d.source_key);
    return c
      ? canonical(c.sourceId) === p.sourceId
      : d.source_key === `notion:archive:${p.sourceId}`;
  });
  // The two independent candle stages retain their curated instructions.
  // The original complete article is also retained as a related material.
  const one = native.length === 1 ? native[0] : null;
  const id =
    one?.instruction_page_id ??
    (one
      ? uuid(`task-instruction:${one.id}`)
      : uuid(`notion-source:${venue}:${p.sourceId}`));
  const slug = one
    ? `task-instruction-${one.id}`
    : `notion-${venue}-${p.sourceId}`;
  targets.set(p.sourceId, { id, slug, title: p.title });
  if (one?.deleted_at) continue;
  pages.push({
    ...p,
    id,
    slug,
    parent_id: one ? folderId : relatedId,
    definition: one,
  });
}
for (const s of source)
  if (
    !excludedSources.has(canonical(s.sourceId)) &&
    !targets.has(canonical(s.sourceId))
  )
    throw Error("В пакете отсутствует шаблон " + s.name);
const files = new Map();
for (const a of scoped.assets) {
  if (
    !/^[a-f0-9]{64}$/.test(a.sha256) ||
    basename(a.file) !== a.file ||
    !a.file.startsWith(a.sha256 + ".") ||
    !Number.isSafeInteger(a.bytes) ||
    a.bytes < 1 ||
    a.bytes > 52428800
  )
    throw Error("Неверное вложение пакета");
  const path = realpathSync(resolve(bundleRoot, "assets", a.file));
  if (!path.startsWith(resolve(bundleRoot, "assets") + sep))
    throw Error("Вложение за пределами пакета");
  const binary = readFileSync(path);
  if (binary.length !== a.bytes || sha(binary) !== a.sha256)
    throw Error("Повреждённое вложение");
  files.set(a.sha256, {
    ...a,
    binary,
    path: `${account}/task-instructions/${a.file}`,
  });
}
const report = {
  mode: apply ? "apply_disabled_drafts" : "dry_run",
  newTasks: fresh.length,
  totalTasks: allDefs.length,
  pages: pages.length,
  files: files.size,
  excludedPersonalPages: bundle.pages.filter((page) => scoped.excluded.has(page.sourceId)).length,
  excludedPersonalFiles: bundle.assets.length - scoped.assets.length,
  unavailablePages: pages.filter((p) => p.unavailable).length,
  pendingPages: pages.filter((p) => p.pending).length,
  sourceWarnings: bundle.warnings.length,
  activation: false,
};
console.log(JSON.stringify(report));
if (!apply && !verify) process.exit(0);
if (!local && !env.TASK_INSTRUCTION_ACCESS_TOKEN)
  throw Error("Нужен TASK_INSTRUCTION_ACCESS_TOKEN владельца");
const kb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(!local
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${env.TASK_INSTRUCTION_ACCESS_TOKEN}`,
            },
          },
        }
      : {}),
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
  await kb.auth.getUser(local ? undefined : env.TASK_INSTRUCTION_ACCESS_TOKEN),
).user;
if (
  !actor ||
  check(await kb.rpc("get_active_account_id")) !== account ||
  check(await kb.rpc("get_active_venue_id")) !== venue
)
  throw Error("Неверный аккаунт или заведение владельца");
const existingPages = new Map();
for (let offset = 0; ; offset += 500) {
  const rows = check(await kb.from("kb_pages")
    .select("id,account_id,slug,title,icon,icon_color,content,parent_id,show_children,deleted_at,updated_at")
    .eq("account_id", account).order("id").range(offset, offset + 499));
  for (const page of rows) existingPages.set(page.id, page);
  if (rows.length < 500) break;
}
// A previously imported private record is not made safe by skipping it
// on a rerun. Stop before any writes until the old copies are reconciled.
for (const sourceId of scoped.excluded) {
  const page = existingPages.get(uuid(`notion-source:${venue}:${sourceId}`));
  if (page && !page.deleted_at)
    throw Error("В базе остались личные карточки из предыдущего импорта");
}
if (verify) {
  for (const f of files.values()) {
    const blob = check(
      await kb.storage.from("account-attachments").download(f.path),
    );
    const binary = Buffer.from(await blob.arrayBuffer());
    if (binary.length !== f.bytes || sha(binary) !== f.sha256)
      throw Error("Файл в хранилище отличается от исходного");
  }
  const slugs = new Set([...existingPages.values()].filter((p) => !p.deleted_at).map((p) => p.slug));
  for (const source of pages) {
    const page = existingPages.get(source.id);
    if (!page || page.deleted_at) throw Error("Страница архива не сохранена");
    const text = JSON.stringify(page.content);
    if (stable(stripPersonalNotionReferences(page.content, scoped.excluded)) !== stable(page.content))
      throw Error("В архиве остались ссылки на личные карточки");
    if (/notionpage:\/\/|bundleasset:\/\/|X-Amz-|X-Goog-/.test(text))
      throw Error("Остались неразрешённые ссылки архива");
    for (const match of text.matchAll(/\/knowledge\/([a-zA-Z0-9_-]+)/g))
      if (!slugs.has(match[1])) throw Error("Внутренняя ссылка ведёт на отсутствующую страницу");
  }
  for (const d of allDefs) {
    const page = existingPages.get(d.instruction_page_id);
    if (
      !page ||
      /notion\.com|notion\.so|X-Amz-|X-Goog-/.test(JSON.stringify(page.content))
    )
      throw Error("Инструкция не перенесена полностью");
  }
  console.log(
    JSON.stringify({
      verifiedFiles: files.size,
      verifiedPages: pages.length,
      linkedTasks: allDefs.length,
      activation: false,
    }),
  );
  process.exit(0);
}
// Newly created KB pages can have a null updated_at until their first body save.
// Use SQL IS NULL for the same optimistic guard used for existing timestamps.
const withUnchangedPage = (query, row) => row.updated_at === null
  ? query.eq("id", row.id).is("updated_at", null)
  : query.eq("id", row.id).eq("updated_at", row.updated_at);
const statePath = resolve(bundleRoot, `state-${venue}.json`);
const importState = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {};
let initializedFolders = 0;
const ensurePage = async (p) => {
  const old = existingPages.get(p.id);
  if (old) {
    if (old.account_id !== account || old.deleted_at)
      throw Error("Страница недоступна");
    // Upgrade only generated empty folders once. Subsequent imports respect
    // the owner's choice to hide the child list again.
    if (p.showChildren && !importState.$folderChildren?.[p.id]) {
      if (!old.show_children && !old.content?.length &&
          (old.title === p.title || (p.id === relatedId && old.title === "Связанные материалы"))) {
        const updated = check(await withUnchangedPage(
          kb.from("kb_pages").update({ show_children: true }), old,
        ).select("updated_at,show_children").maybeSingle());
        if (!updated) throw Error("Папка изменена во время переноса");
        Object.assign(old, updated);
        initializedFolders++;
      }
      importState.$folderChildren ??= {};
      importState.$folderChildren[p.id] = true;
      writeFileSync(statePath, JSON.stringify(importState, null, 2));
    }
    return old;
  }
  const row = check(
    await kb
      .from("kb_pages")
      .insert({
        id: p.id,
        account_id: account,
        created_by: actor.id,
        updated_by: actor.id,
        parent_id: p.parent_id ?? null,
        title: p.title,
        slug: p.slug,
        icon: p.icon ?? null,
        show_children: p.showChildren === true || p.sourceKind === "database",
        content: [],
      })
      .select(
        "id,account_id,slug,title,icon,icon_color,content,parent_id,show_children,deleted_at,updated_at",
      )
      .single(),
  );
  existingPages.set(row.id, row);
  if (p.showChildren) {
    importState.$folderChildren ??= {};
    importState.$folderChildren[p.id] = true;
    writeFileSync(statePath, JSON.stringify(importState, null, 2));
  }
  return row;
};
await ensurePage({
  id: folderId,
  title: `Инструкции задач · ${venueRow.name}`,
  slug: `task-instructions-${venue}`,
  showChildren: true,
});
await ensurePage({
  id: relatedId,
  title: "Архив Notion",
  slug: `task-instruction-references-${venue}`,
  showChildren: true,
});
for (const p of pages) {
  const old = await ensurePage(p);
  targets.get(p.sourceId).slug = old.slug;
}
// Recreate source hierarchy only where the parent remains import-owned.
const hierarchyPath = resolve(bundleRoot, `hierarchy-${venue}.json`);
const hierarchyState = existsSync(hierarchyPath) ? JSON.parse(readFileSync(hierarchyPath, "utf8")) : {};
const archive = existingPages.get(relatedId);
if (archive.title === "Связанные материалы" && archive.parent_id === folderId) {
  check(await kb.from("kb_pages").update({ title: "Архив Notion", parent_id: null }).eq("id", relatedId).eq("title", archive.title).eq("parent_id", folderId));
}
for (const p of pages) {
  if (p.definition) continue;
  const old = existingPages.get(p.id);
  const desired = targets.get(p.parentSourceId)?.id ?? relatedId;
  if (desired === p.id) throw Error("Источник ссылается на себя как на родителя");
  const previous = Object.hasOwn(hierarchyState, p.id) ? hierarchyState[p.id] : relatedId;
  if (old.parent_id === previous && old.parent_id !== desired) {
    const moved = check(
      await withUnchangedPage(
        kb.from("kb_pages").update({ parent_id: desired }), old,
      ).select("updated_at,parent_id").maybeSingle(),
    );
    if (!moved) throw Error("Страница изменена во время переноса иерархии");
    Object.assign(old, moved);
  }
  if (old.parent_id === desired) hierarchyState[p.id] = desired;
  writeFileSync(hierarchyPath, JSON.stringify(hierarchyState, null, 2));
}
// Preserve the generated candle pages as separate native task instructions.
const candleDefs = allDefs.filter(
  (d) =>
    curated.filter(
      (t) =>
        canonical(t.sourceId) ===
        canonical(
          curated.find((x) => `notion:${x.key}` === d.source_key)?.sourceId ??
            "",
        ),
    ).length > 1,
);
for (const d of candleDefs)
  if (!d.instruction_page_id)
    throw Error("Сначала свяжите подготовленные инструкции");
const fileRows = new Map();
for (const f of files.values()) {
  const old = check(
    await kb
      .from("account_files")
      .select("id,storage_path,mime_type,size_bytes")
      .eq("account_id", account)
      .eq("storage_path", f.path)
      .maybeSingle(),
  );
  if (old) {
    if (old.mime_type !== f.mime || old.size_bytes !== f.bytes)
      throw Error("Конфликт вложения");
    fileRows.set(f.sha256, old);
    continue;
  }
  const upload = await kb.storage
    .from("account-attachments")
    .upload(f.path, f.binary, { contentType: f.mime, upsert: false });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message))
    throw Error(upload.error.message);
  const id = check(
    await kb.rpc("kb_register_attachment", {
      p_storage_path: f.path,
      p_name: typeof f.name === "string" && f.name.trim() ? f.name : f.file,
      p_mime_type: f.mime,
      p_size_bytes: f.bytes,
      p_page_id: relatedId,
    }),
  );
  fileRows.set(f.sha256, { id, storage_path: f.path });
}
const rewrite = (value) => {
  if (typeof value === "string") {
    if (value.startsWith("bundleasset://")) {
      const f = files.get(value.slice(14));
      if (!f) throw Error("Неизвестное вложение");
      return `kbfile://${f.path}`;
    }
    return value
      .replace(/notionpage:\/\/([a-f0-9]{31,32})/g, (_, id) => {
        if (excludedSources.has(id)) return "/schedule/tasks";
        if (scoped.excluded.has(id)) return "Личная карточка пропущена";
        const t = targets.get(id);
        if (!t) throw Error("Неизвестная связанная страница");
        return `/knowledge/${t.slug}`;
      })
      .replace(
        /https:\/\/(?:app\.notion\.com|(?:www\.)?notion\.so|[a-z0-9-]+\.notion\.site)\/[^\s"<>)]*/gi,
        (url) => {
          const path = new URL(url).pathname.replace(/\/$/, "");
          const match = path.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{31})$/i);
          if (!match) return url;
          const id = canonical(match[1]);
          if (id === "768f265590174214b80fa86dbd849267") return "/schedule";
            if (excludedSources.has(id)) return "/schedule/tasks";
          if (scoped.excluded.has(id)) return "Личная карточка пропущена";
          const t = targets.get(id);
          if (!t) throw Error("Неизвестная связанная страница");
          return `/knowledge/${t.slug}`;
        },
      );
  }
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rewrite(v)]),
    );
  return value;
};
const legacyContent = (d) =>
  d.instructions
    .split(/\n+/)
    .filter(Boolean)
    .map((text, n) => ({
      id: uuid(`${d.instruction_page_id}:${n}`),
      type: "paragraph",
      content: [{ type: "text", text, styles: {} }],
    }));
const stripSource = (blocks) =>
  blocks.filter(
    (b) => !JSON.stringify(b).includes("Исходная инструкция с иллюстрациями"),
  );
const plain = (v) =>
  typeof v === "string"
    ? ""
    : Array.isArray(v)
      ? v.map(plain).join(" ")
      : v && typeof v === "object"
        ? v.type === "text"
          ? v.text
          : Object.values(v).map(plain).join(" ")
        : "";

let saved = 0,
  preserved = 0;
async function save(p, original) {
  const old = existingPages.get(p.id);
  let content = rewrite(stripPersonalNotionReferences(original, scoped.excluded));
  let manuallyEdited = false;
  if (old.content?.length) {
    const stripped = stripPersonalNotionReferences(stripSource(old.content), scoped.excluded);
    const generated =
      p.definition &&
      stable(
        stripped.filter(
          (b) => !["image", "file", "video", "audio"].includes(b.type),
        ),
      ) === stable(rewrite(legacyContent(p.definition)));
    const merged = mergeImportedContent({
      current: rewrite(stripped),
      incoming: content,
      previousHash: importState[p.id],
      currentHash: sha(stable(old.content)),
      generated,
      seenMedia: importState.$mediaSeen?.[p.id] ?? [],
    });
    content = merged.content;
    manuallyEdited = merged.manuallyEdited;
    if (manuallyEdited) preserved++;
  }
  const used = [...files.values()].filter((f) =>
    JSON.stringify(content).includes(`kbfile://${f.path}`),
  );
  for (const f of used)
    check(
      await kb.from("kb_page_attachments").upsert(
        {
          page_id: p.id,
          file_id: fileRows.get(f.sha256).id,
          attached_by: actor.id,
        },
        { onConflict: "page_id,file_id", ignoreDuplicates: true },
      ),
    );
  const title = /^(Связанный материал|Недоступная страница) · [a-f0-9]{8}$/.test(old.title) && p.title ? p.title : old.title;
  if (stable(old.content) !== stable(content) || old.title !== title) {
    const current = check(
      await kb.from("kb_pages").select("updated_at").eq("id", p.id).single(),
    );
    if (current.updated_at !== old.updated_at)
      throw Error("Страница изменена во время переноса, повторите сверку");
    check(
      await kb.rpc("kb_save_page", {
        p_id: p.id,
        p_title: title,
        p_icon: old.icon ?? null,
        p_icon_color: old.icon_color ?? null,
        p_content: content,
        p_plain_text: plain(content),
        p_link_targets: [],
        p_force_new_version: false,
      }),
    );
    saved++;
  }
  if (manuallyEdited) delete importState[p.id];
  else importState[p.id] = sha(stable(content));
  importState.$mediaSeen ??= {};
  importState.$mediaSeen[p.id] = [...new Set([
    ...(importState.$mediaSeen[p.id] ?? []),
    ...importedMediaUrls(content),
  ])];
  writeFileSync(statePath, JSON.stringify(importState, null, 2));
  return content;
}
for (const p of pages) await save(p, p.content);
for (const d of candleDefs)
  await save(
    { id: d.instruction_page_id },
    stripSource(existingPages.get(d.instruction_page_id).content),
  );
if (fresh.length)
  check(await db.from("schedule_task_definitions").insert(fresh));
for (const d of allDefs) {
  const p = pages.find((p) => p.definition?.id === d.id);
  const id = p?.id ?? d.instruction_page_id;
  if (!id) throw Error("Не найдена инструкция задачи");
  const livePage = check(
    await kb.from("kb_pages").select("updated_at").eq("id", id).single(),
  );
  if (
    d.instruction_page_id === id &&
    d.instruction_snapshot?.updated_at === livePage.updated_at
  )
    continue;
  check(
    await kb.rpc("schedule_task_command", {
      p_action: "definition.save",
      p_input: { ...d, version: d.version ?? 1, instruction_page_id: id },
    }),
  );
}
const result = {
  ...report,
  savedPages: saved,
  initializedFolders,
  preservedEdits: preserved,
  completedAt: new Date().toISOString(),
};
writeFileSync(
  resolve(bundleRoot, `result-${venue}.json`),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
