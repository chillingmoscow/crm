import "server-only";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient, getCachedUser, getCachedActiveAccountId, getCachedPermissionChecker } from "@/lib/supabase/server";

export const checked = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};
export function integrationInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "";
    throw new Error(/[а-яё]/i.test(message) ? message : "Проверьте заполненные поля");
  }
  return parsed.data;
}

/** Integration settings use their own permission, independent of candidate work. */
export async function integrationScope(ownerOnly = false) {
  const [user, accountId, can, client] = await Promise.all([
    getCachedUser(), getCachedActiveAccountId(), getCachedPermissionChecker(), createClient(),
  ]);
  if (!user || !accountId || !can("settings.manage_integrations"))
    throw new Error("Нет доступа к настройкам интеграций");
  const db = asLooseDb(createAdminClient());
  const account = checked(await db.from<{ owner_id: string }>("accounts").select("owner_id").eq("id", accountId).single());
  const owner = account.owner_id === user.id;
  if (ownerOnly && !owner) throw new Error("Настройка доступна владельцу организации");
  return { user, accountId, db, client, owner };
}

export async function integrationPageScope() {
  const [user, accountId, can] = await Promise.all([getCachedUser(), getCachedActiveAccountId(), getCachedPermissionChecker()]);
  if (!user) redirect("/login");
  if (!accountId || !can("settings.manage_integrations")) redirect("/dashboard");
  return integrationScope();
}

export type IntegrationVenue = { id: string; name: string };
export type EmploymentSettings = {
  store_ids: number[];
  master_store_ids: number[];
  staff_group_id: number;
  bonus_account_type_id: number;
  tips_uri: string | null;
  office_pool_initialized: boolean;
};
export async function integrationVenues() {
  const s = await integrationScope();
  const venues = checked(await asLooseDb(s.client).from<IntegrationVenue[]>("venues")
    .select("id,name").eq("account_id", s.accountId).is("archived_at", null).order("name")) ?? [];
  const profile = checked(await s.db.from<{ active_venue_id: string | null }>("profiles").select("active_venue_id").eq("id", s.user.id).single());
  return { venues, activeVenue: venues.find(v => v.id === profile.active_venue_id)?.id ?? venues[0]?.id ?? "" };
}
export async function requireIntegrationVenue(venueId: string) {
  const { venues } = await integrationVenues();
  if (!venues.some(v => v.id === venueId)) throw new Error("Заведение недоступно");
}
export async function readEmploymentSettings(venueId: string) {
  const s = await integrationScope();
  await requireIntegrationVenue(venueId);
  return checked(await s.db.from<EmploymentSettings>("candidate_employment_settings")
    .select("store_ids,master_store_ids,staff_group_id,bonus_account_type_id,tips_uri,office_pool_initialized")
    .eq("account_id", s.accountId).eq("venue_id", venueId).maybeSingle());
}
