"use server";
import { z } from "zod";
import { createClient, getCachedActiveAccountId } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "@/lib/sales/finance-source";
import { businessDate } from "@/lib/sales/time";
import { normalizeSupplyCompanies } from "@/lib/supplies/source";
import {
  supplyFiltersSchema,
  supplyReadRulesSchema,
  type SupplyFilters,
  type SupplyList,
  type SupplyDetail,
  type SupplyConfiguration,
} from "@/lib/supplies/types";
function checked<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw Error("Проверьте поля и параметры поставок");
  return r.data;
}
async function scope(expected?: string) {
  const client = await createClient(),
    db = asLooseDb(client),
    account = await getCachedActiveAccountId();
  const {
    data: { user },
  } = await client.auth.getUser();
  const venue = await db.rpc("get_active_venue_id");
  if (!user || !account || venue.error || !venue.data)
    throw Error("Нет доступа к поставкам");
  const venueId = String(venue.data);
  if (expected && checked(z.string().uuid(), expected) !== venueId)
    throw Error("Заведение изменилось. Обновите страницу");
  return { db, account, venueId };
}
export async function loadSupplies(
  filters: SupplyFilters,
  venue?: string,
): Promise<SupplyList> {
  const s = await scope(venue),
    f = checked(supplyFiltersSchema, filters);
  const [y, m] = f.month.split("-").map(Number),
    last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const r = await s.db.rpc("supply_list", {
    p_venue: s.venueId,
    p_from: f.month + "-01",
    p_to: last,
    p_search: f.search,
    p_paid: f.paid,
    p_provider: f.provider,
    p_store: f.store,
    p_missing: f.missing,
    p_page: f.page,
    p_size: f.size,
    p_sort: f.sort,
    p_desc: f.desc,
  });
  if (r.error) throw Error(r.error.message);
  return r.data as SupplyList;
}
export async function loadSupply(
  venue: string,
  id: string,
  before?: number,
): Promise<SupplyDetail> {
  const s = await scope(venue),
    r = await s.db.rpc("supply_detail", {
      p_venue: s.venueId,
      p_document: checked(z.string().uuid(), id),
      p_before:
        before == null
          ? null
          : checked(
              z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
              before,
            ),
    });
  if (r.error) throw Error(r.error.message);
  return r.data as SupplyDetail;
}
async function configuration(s: Awaited<ReturnType<typeof scope>>) {
  const r = await s.db.rpc("supply_read_configuration", { p_venue: s.venueId });
  if (r.error) throw Error(r.error.message);
  return r.data as Pick<SupplyConfiguration, "versions">;
}
async function sourceOptions(s: Awaited<ReturnType<typeof scope>>) {
  const r = await s.db
    .from<{ timezone: string; day_start_hour: number }>("sales_settings")
    .select("timezone,day_start_hour")
    .eq("account_id", s.account)
    .eq("venue_id", s.venueId)
    .single();
  if (r.error || !r.data)
    throw Error("Подключите Quick Resto и настройте рабочий день заведения");
  const settings = r.data;
  const { source, provider } = await financeSource({
    account_id: s.account,
    venue_id: s.venueId,
    business_date: businessDate(
      new Date(),
      settings.timezone,
      settings.day_start_hour,
    ),
    request: {
      timezone: settings.timezone,
      dayStartHour: settings.day_start_hour,
    },
  });
  return {
    companies: normalizeSupplyCompanies(await source.supplyCompanies()),
    provider,
  };
}
export async function loadSupplyConfiguration(
  venue: string,
): Promise<SupplyConfiguration> {
  const s = await scope(venue),
    c = await configuration(s);
  try {
    return { ...c, ...(await sourceOptions(s)), sourceError: null };
  } catch (e) {
    return {
      ...c,
      companies: [],
      provider: null,
      sourceError:
        e instanceof Error
          ? e.message
          : "Не удалось проверить источник поставок",
    };
  }
}
export async function saveSupplyReadRules(
  venue: string,
  version: number,
  input: { autoRead: boolean; intervalMinutes: number; businessIds: number[] },
  expectedProvider: string,
  reason: string,
) {
  const s = await scope(venue),
    c = await configuration(s),
    old = c.versions[0]?.config;
  const changes = checked(
    z
      .object({
        autoRead: z.boolean(),
        intervalMinutes: z.number().int().min(15).max(1440),
        businessIds: z.array(z.number().int().positive()).min(1).max(100),
      })
      .strict(),
    input,
  );
  changes.businessIds = [...new Set(changes.businessIds)].sort((a, b) => a - b);
  let config;
  if (
    !changes.autoRead &&
    old &&
    old.provider === expectedProvider &&
    JSON.stringify(old.businessIds) === JSON.stringify(changes.businessIds)
  )
    config = { ...old, ...changes };
  else {
    const options = await sourceOptions(s);
    if (options.provider !== expectedProvider)
      throw Error("Подключение изменилось. Откройте настройки заново");
    if (
      changes.businessIds.some(
        (id) => !options.companies.some((c) => c.id === id),
      )
    )
      throw Error("Выберите заведение из Quick Resto");
    config = {
      ...changes,
      provider: options.provider,
      businessNames: Object.fromEntries(
        options.companies
          .filter((c) => changes.businessIds.includes(c.id))
          .map((c) => [c.id, c.name]),
      ),
    };
  }
  const r = await s.db.rpc("supply_save_read_rules", {
    p_venue: s.venueId,
    p_version: checked(z.number().int().min(0), version),
    p_config: checked(supplyReadRulesSchema, config),
    p_reason: checked(z.string().trim().min(1).max(1000), reason),
  });
  if (r.error) throw Error(r.error.message);
}
export async function requestSupplies(venue: string) {
  const s = await scope(venue),
    r = await s.db.rpc("supply_request", { p_venue: s.venueId });
  if (r.error) throw Error(r.error.message);
  return String(r.data);
}
