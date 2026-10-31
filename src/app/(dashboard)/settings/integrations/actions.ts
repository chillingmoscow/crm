"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checked, integrationInput, integrationScope, requireIntegrationVenue, readEmploymentSettings } from "@/lib/integrations/settings";
import type { ConnectionView } from "@/lib/candidates/types";
import { getConnection, withBackOfficeSession } from "@/app/(dashboard)/inventory/actions-shared";
import { callQuickRestoBackOfficeData } from "@/lib/integrations/quickresto/client";
import { telegramDestination } from "@/lib/integrations/telegram-destination";

const uuid = z.string().uuid();
function refreshSettings() { revalidatePath("/settings/integrations", "layout"); }

export async function readTildaConnection(): Promise<ConnectionView> {
  const s = await integrationScope();
  const row = checked(await s.db.from<NonNullable<ConnectionView>>("candidate_connections")
    .select("id,enabled,form_id,telegram_chat_id,last_received_at").eq("account_id", s.accountId).maybeSingle());
  if (!row) return null;
  const jobs = checked(await s.db.from<{ state: string }[]>("candidate_jobs").select("state")
    .eq("account_id", s.accountId).neq("state", "done")) ?? [];
  return { ...row, telegram_configured: false, pending_jobs: jobs.filter(j => j.state !== "error").length, failed_jobs: jobs.filter(j => j.state === "error").length };
}

export async function saveTildaConnection(input: unknown) {
  const s = await integrationScope();
  const value = integrationInput(z.object({ enabled: z.boolean(), form_id: z.string().trim().regex(/^form\d+$/, "Укажите ID формы, например form356864639"), rotate: z.boolean().optional() }), input);
  const old = checked(await s.db.from<{ id: string; telegram_secret: unknown; telegram_chat_id: string | null }>("candidate_connections")
    .select("id,telegram_secret,telegram_chat_id").eq("account_id", s.accountId).maybeSingle());
  const telegram = checked(await s.db.from<{ default_chat_id: string | null; candidate_chat_id: string | null }>("organization_telegram_settings")
    .select("default_chat_id,candidate_chat_id").eq("account_id", s.accountId).maybeSingle());
  if (value.enabled && !telegramDestination("notify", telegram, old?.telegram_secret ? old.telegram_chat_id : null))
    throw new Error("Сначала подключите Telegram и выберите чат для новых анкет");
  const secret = !old || value.rotate ? randomBytes(32).toString("hex") : null;
  const payload = { account_id: s.accountId, enabled: value.enabled, form_id: value.form_id, created_by: s.user.id,
    ...(secret ? { secret_hash: createHash("sha256").update(secret).digest("hex") } : {}) };
  const row = checked(await (old ? s.db.from<{ id: string }>("candidate_connections").update(payload).eq("id", old.id).eq("account_id", s.accountId)
    : s.db.from<{ id: string }>("candidate_connections").insert(payload)).select("id").single());
  refreshSettings();
  return { id: row.id, secret };
}

export async function getEmploymentSettings(venueId: string) { return readEmploymentSettings(uuid.parse(venueId)); }

export async function saveHiringSettings(venueId: string, input: unknown) {
  const s = await integrationScope(true);
  uuid.parse(venueId); await requireIntegrationVenue(venueId);
  const value = integrationInput(z.object({ store_ids: z.array(z.number().int().positive()).min(1, "Выберите хотя бы один склад").max(30),
    master_store_ids: z.array(z.number().int().positive()).max(30), staff_group_id: z.number().int().positive(), bonus_account_type_id: z.number().int().positive(),
    tips_uri: z.string().trim().max(1000).url().refine(v => v.startsWith("https://"), "Ссылка должна начинаться с https://").nullable() }), input);
  // Deliberately omit office_pool_initialized: this screen never changes codes.
  checked(await s.db.from("candidate_employment_settings").upsert({ account_id: s.accountId, venue_id: venueId, ...value }, { onConflict: "venue_id" }));
  refreshSettings();
}

export async function readDoorPool() {
  const s = await integrationScope(true);
  const [numbers, passwords, issued] = await Promise.all([
    s.db.from("staff_door_reserved").select("kind", { count: "exact", head: true }).eq("account_id", s.accountId).eq("kind", "user"),
    s.db.from("staff_door_reserved").select("kind", { count: "exact", head: true }).eq("account_id", s.accountId).eq("kind", "password"),
    s.db.from("staff_door_codes").select("user_number", { count: "exact", head: true }).eq("account_id", s.accountId).is("revoked_at", null),
  ]);
  [numbers, passwords, issued].forEach(checked);
  return { reservedNumbers: numbers.count ?? 0, reservedPasswords: passwords.count ?? 0, issued: issued.count ?? 0 };
}

export async function saveDoorPool(venueId: string, input: unknown) {
  const s = await integrationScope(true);
  uuid.parse(venueId); await requireIntegrationVenue(venueId);
  const value = integrationInput(z.object({ codes: z.string().max(150000), confirm_empty_pool: z.boolean(), use_existing_pool: z.boolean().optional() }), input);
  const lines = value.codes.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length && !value.confirm_empty_pool && !value.use_existing_pool) throw new Error("Добавьте занятые коды или подтвердите, что ранее их не выдавали");
  if (value.use_existing_pool) {
    const existing = await s.db.from("staff_door_reserved").select("kind", { head: true, count: "exact" }).eq("account_id", s.accountId);
    checked(existing);
    if (!existing.count) throw new Error("Общий резерв пока пуст. Добавьте занятые коды.");
  }
  const reserved = lines.flatMap(line => {
    const cells = /[\t;,]/.test(line) ? line.split(/[\t;,]/) : line.trim().split(/ +/);
    const number = (cells[0] ?? "").trim(), password = (cells[1] ?? "").trim();
    if (cells.length > 2 || (number && !/^\d{3}$/.test(number)) || (password && !/^\d{6}$/.test(password)) || (!number && !password))
      throw new Error("В каждой строке укажите трёхзначный номер и шестизначный код через пробел или табуляцию");
    return [...(number ? [{ account_id: s.accountId, kind: "user", value: String(Number(number)) }] : []),
      ...(password ? [{ account_id: s.accountId, kind: "password", value: createHash("sha256").update(password).digest("hex") }] : [])];
  });
  if (reserved.length) checked(await s.db.from("staff_door_reserved").upsert(reserved, { onConflict: "account_id,kind,value", ignoreDuplicates: true }));
  // Other hiring columns are untouched, including when a pool is topped up.
  checked(await s.db.from("candidate_employment_settings").upsert({ account_id: s.accountId, venue_id: venueId, office_pool_initialized: true }, { onConflict: "venue_id" }));
  checked(await s.db.from("audit_logs").insert({ account_id: s.accountId, user_id: s.user.id, action_code: "integration.updated", entity_type: "integration", entity_id: venueId,
    details: { provider: "office_codes", imported_rows: lines.length, initialized: true } }));
  refreshSettings();
  return { imported: lines.length };
}

export async function getHiringDictionaries() {
  const s = await integrationScope();
  const connection = await getConnection(s.accountId);
  if (!connection) throw new Error("Сначала подключите Quick Resto");
  type Item = { id: number; name?: string; title?: string; fullName?: string; deleted?: boolean };
  const read = async (path: string) => {
    const all: { value: number; label: string }[] = [];
    for (let start = 0; start < 10000; start += 200) {
      const data = await withBackOfficeSession({ connection, admin: s.db, run: authorization => callQuickRestoBackOfficeData<{ ds?: { object: Item }[]; utilityData?: { totalCount?: number } }>({
        layerName: connection.login, baseUrl: connection.backoffice_base_url, authorization, path, query: { start, count: 200 },
      }) });
      if (!Array.isArray(data.ds)) throw new Error("Quick Resto не вернул справочник");
      for (const { object: row } of data.ds) if (!row.deleted && Number.isSafeInteger(row.id)) all.push({ value: row.id, label: row.title || row.name || row.fullName || `№ ${row.id}` });
      const total = data.utilityData?.totalCount;
      if (data.ds.length < 200 || (typeof total === "number" && start + data.ds.length >= total)) return all;
    }
    throw new Error("Справочник слишком большой. Уточните настройки Quick Resto");
  };
  // Read sequentially: the connection serializes back-office authorization.
  return { stores: await read("warehouse.store/select"), groups: await read("crm.customer.group/select"), accountTypes: await read("crm.accounting.account.type/select") };
}
