"use server";
import { z } from "zod";
import { businessDate, addDays } from "@/lib/sales/time";
import {
  createClient,
  getCachedPermissions,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  type AdditionalDay,
  type AdditionalArchive,
  type AdditionalRuleVersion,
  type AdditionalRules,
  validateAdditionalRules,
} from "@/lib/sales/additional";

async function scope(permission = "sales.view_shifts", expectedVenue?: string) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  const permissions = await getCachedPermissions();
  const account = await getCachedActiveAccountId();
  const db = asLooseDb(client);
  const venue = await db.rpc("get_active_venue_id");
  if (
    !user ||
    !account ||
    !venue.data ||
    venue.error ||
    !permissions.includes(permission) ||
    !permissions.includes("sales.view_shifts")
  )
    throw new Error("Нет доступа к допродажам");
  if (
    expectedVenue !== undefined &&
    venue.data !== z.string().uuid().parse(expectedVenue)
  )
    throw new Error("Заведение изменилось. Обновите страницу");
  return { db, venueId: String(venue.data), permissions };
}
export type AdditionalData = {
  venueId: string;
  permissions: string[];
  configured: boolean;
  version: number;
  timezone: string;
  hour: number;
  nextFrom: string;
  reports: AdditionalDay[];
  archives: AdditionalArchive[];
  rules: AdditionalRuleVersion[];
};
export async function loadAdditional(
  expectedVenue?: string,
): Promise<AdditionalData> {
  const s = await scope("sales.view_shifts", expectedVenue);
  async function rows<T>(table: string, columns: string, order: string) {
    const result: T[] = [];
    for (let start = 0; start < 100000; start += 1000) {
      let query = s.db
        .from<T[]>(table)
        .select(columns)
        .eq("venue_id", s.venueId)
        .order(order, { ascending: false });
      if (table === "sales_additional_rules")
        query = query.order("created_at", { ascending: false });
      const r = await query.order("id").range(start, start + 999);
      if (r.error) throw new Error("Не удалось загрузить допродажи");
      result.push(...(r.data ?? []));
      if ((r.data ?? []).length < 1000) return result;
    }
    throw new Error(
      "Слишком большой период допродаж. Обратитесь к управляющему",
    );
  }
  const [reports, archives, rules, source, settings] = await Promise.all([
    rows<AdditionalDay>(
      "sales_additional_reports",
      "id,venue_id,business_date,kind,request,metrics,metrics_request,state,last_error,synced_at,period_start,period_end",
      "business_date",
    ),
    rows<AdditionalArchive>(
      "sales_additional_archive",
      "id,venue_id,business_date,kind,metrics,captured_at,origin",
      "captured_at",
    ),
    rows<AdditionalRuleVersion>(
      "sales_additional_rules",
      "id,valid_from,config,reason,created_at,created_by",
      "valid_from",
    ),
    s.db
      .from<{
        enabled: boolean;
        rules_version: number;
      }>("sales_additional_sources")
      .select("enabled,rules_version")
      .eq("venue_id", s.venueId)
      .maybeSingle(),
    s.db
      .from<{ timezone: string; day_start_hour: number }>("sales_settings")
      .select("timezone,day_start_hour")
      .eq("venue_id", s.venueId)
      .maybeSingle(),
  ]);
  if (source.error || settings.error)
    throw new Error("Не удалось загрузить настройки допродаж");
  const check = await s.db.rpc("get_active_venue_id");
  if (check.error || check.data !== s.venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  return {
    venueId: s.venueId,
    permissions: s.permissions,
    configured: source.data?.enabled ?? false,
    version: source.data?.rules_version ?? 0,
    timezone: settings.data?.timezone ?? "Europe/Moscow",
    hour: settings.data?.day_start_hour ?? 9,
    nextFrom: addDays(
      businessDate(
        new Date(),
        settings.data?.timezone ?? "Europe/Moscow",
        settings.data?.day_start_hour ?? 9,
      ),
      1,
    ),
    reports,
    archives,
    rules,
  };
}
export async function requestAdditional(month: string, venueId: string) {
  z.string()
    .regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
    .parse(month);
  const s = await scope("sales.sync_shifts", venueId);
  const r = await s.db.rpc("sales_request_additional_month", {
    p_month: month + "-01",
    p_expected_venue: s.venueId,
  });
  if (r.error) throw new Error(r.error.message);
  if (!r.data)
    throw new Error("Нет завершённых дней с настроенными правилами допродаж");
  return Number(r.data);
}
export async function saveAdditionalRules(input: {
  venueId: string;
  version: number;
  from: string;
  config: AdditionalRules;
  reason: string;
}) {
  const s = await scope("sales.configure_shifts", input.venueId);
  z.number().int().positive().parse(input.version);
  z.string()
    .regex(/^20\d{2}-\d{2}-\d{2}$/)
    .parse(input.from);
  z.string().trim().min(3).max(1000).parse(input.reason);
  validateAdditionalRules(input.config);
  const r = await s.db.rpc("sales_save_additional_rules", {
    p_expected_venue: s.venueId,
    p_version: input.version,
    p_from: input.from,
    p_config: input.config,
    p_reason: input.reason,
  });
  if (r.error) throw new Error(r.error.message);
  return loadAdditional(s.venueId);
}
export async function loadAdditionalHistory(venueId: string, reportId: string) {
  const s = await scope("sales.view_shifts", venueId);
  z.string().uuid().parse(reportId);
  const result: {
    id: string;
    created_at: string;
    metrics: AdditionalDay["metrics"];
  }[] = [];
  for (let start = 0; start < 100000; start += 1000) {
    const r = await s.db
      .from<typeof result>("sales_additional_history")
      .select("id,created_at,metrics")
      .eq("venue_id", s.venueId)
      .eq("report_id", reportId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить историю");
    result.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) return result;
  }
  throw new Error("Не удалось загрузить всю историю");
}
export async function exportAdditional(venueId: string) {
  await scope("sales.export_shifts", venueId);
  return loadAdditional(venueId);
}
