"use server";
import { z } from "zod";
import {
  createClient,
  getCachedUser,
  getCachedActiveAccountId,
  getCachedPermissions,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  initialCashControlRules,
  cashControlRulesSchema,
  cashControlResults,
  type CashControlRules,
  type CashControlReport,
} from "@/lib/sales/cash-control";
import { validDate } from "@/lib/sales/time";
export type CashRuleVersion = {
  id: string;
  version: number;
  config: CashControlRules;
  reason: string;
  actor_name: string;
  created_at: string;
};
export type CashHistoryEntry = {
  id: string;
  version: number;
  reports: CashControlReport[];
  actor_name: string;
  created_at: string;
};
export async function loadCashHistory(
  venueId: string,
  date: string,
  beforeVersion?: number,
): Promise<{ rows: CashHistoryEntry[]; more: boolean } | null> {
  const s = await scope(venueId);
  if (!s) return null;
  if (!validDate(date)) throw new Error("Выберите рабочий день");
  if (beforeVersion !== undefined)
    z.number().int().positive().parse(beforeVersion);
  const day = await s.db
    .from<{ id: string }>("cash_control_days")
    .select("id")
    .eq("account_id", s.accountId)
    .eq("venue_id", venueId)
    .eq("business_date", date)
    .maybeSingle();
  if (day.error) throw new Error("Не удалось загрузить историю кассы");
  if (!day.data) return { rows: [], more: false };
  let query = s.db
    .from<CashHistoryEntry[]>("cash_control_history")
    .select("id,version,reports,actor_name,created_at")
    .eq("day_id", day.data.id)
    .order("version", { ascending: false })
    .limit(21);
  if (beforeVersion !== undefined)
    query = query.lte("version", beforeVersion - 1);
  const r = await query;
  if (r.error) throw new Error("Не удалось загрузить историю кассы");
  return {
    rows: (r.data ?? []).slice(0, 20),
    more: (r.data?.length ?? 0) > 20,
  };
}
export type CashConfiguration = {
  venueId: string;
  versions: CashRuleVersion[];
  canManage: boolean;
};
export type CashDayData = {
  canManage: boolean;
  reports: CashControlReport[];
  results: ReturnType<typeof cashControlResults>;
  checkedAt: string | null;
  version: number | null;
  rules: CashControlRules;
  problem: string | null;
  job: { state: string; phase: string; error: string | null } | null;
};
async function scope(venueId: string) {
  z.string().uuid().parse(venueId);
  const [client, user, accountId, permissions] = await Promise.all([
    createClient(),
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissions(),
  ]);
  if (
    !user ||
    !accountId ||
    !permissions.includes("finance.view_transactions") ||
    !permissions.includes("sales.view_shifts")
  )
    return null;
  const db = asLooseDb(client),
    [active, owner] = await Promise.all([
      db.rpc("get_active_venue_id"),
      client.from("accounts").select("owner_id").eq("id", accountId).single(),
    ]);
  if (active.error || owner.error)
    throw new Error("Не удалось проверить доступ к контролю кассы");
  if (active.data !== venueId) return null;
  return { db, accountId, canManage: owner.data?.owner_id === user.id };
}
export async function loadCashConfiguration(
  venueId: string,
): Promise<CashConfiguration> {
  const s = await scope(venueId);
  if (!s) throw new Error("Нет доступа к контролю кассы");
  const versions: CashRuleVersion[] = [];
  for (let start = 0; start < 10000; start += 500) {
    const r = await s.db
      .from<CashRuleVersion[]>("cash_control_rules")
      .select("id,version,config,reason,actor_name,created_at")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .order("version", { ascending: false })
      .range(start, start + 499);
    if (r.error) throw new Error("Не удалось загрузить правила контроля кассы");
    versions.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 500)
      return { venueId, versions, canManage: s.canManage };
  }
  throw new Error("Не удалось загрузить всю историю правил");
}
export async function saveCashConfiguration(input: {
  venueId: string;
  version: number;
  config: CashControlRules;
  reason: string;
}) {
  const s = await scope(input.venueId);
  if (!s?.canManage)
    throw new Error("Правила контроля кассы изменяет владелец");
  const config = cashControlRulesSchema.parse(input.config);
  z.number().int().min(0).parse(input.version);
  z.string().trim().min(1).max(1000).parse(input.reason);
  const r = await s.db.rpc("cash_control_save_rules", {
    p_venue: input.venueId,
    p_version: input.version,
    p_config: config,
    p_reason: input.reason,
  });
  if (r.error) throw new Error(r.error.message);
  return loadCashConfiguration(input.venueId);
}
export async function requestCashControl(venueId: string, date: string) {
  const s = await scope(venueId);
  if (!s?.canManage) throw new Error("Проверку кассы запускает владелец");
  if (!validDate(date)) throw new Error("Выберите рабочий день");
  const r = await s.db.rpc("cash_control_request", {
    p_venue: venueId,
    p_date: date,
  });
  if (r.error) throw new Error(r.error.message);
}
export async function loadCashControl(
  venueId: string,
  date: string,
): Promise<CashDayData | null> {
  const s = await scope(venueId);
  if (!s) return null;
  if (!validDate(date)) throw new Error("Выберите рабочий день");
  const [rule, day, job, settings] = await Promise.all([
    s.db
      .from<{ config: CashControlRules }>("cash_control_rules")
      .select("config")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    s.db
      .from<{
        reports: CashControlReport[];
        checked_at: string;
        version: number;
        request: { timezone: string; dayStartHour: number };
      }>("cash_control_days")
      .select("reports,checked_at,version,request")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .maybeSingle(),
    s.db.rpc("cash_control_job_status", { p_venue: venueId, p_date: date }),
    s.db
      .from<{ timezone: string; day_start_hour: number }>("sales_settings")
      .select("timezone,day_start_hour")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
  ]);
  if (rule.error || day.error || job.error || settings.error)
    throw new Error("Не удалось загрузить контроль кассы");
  const rules = rule.data?.config ?? initialCashControlRules,
    d = day.data;
  const problem =
    d &&
    (d.request.timezone !== settings.data?.timezone ||
      d.request.dayStartHour !== settings.data?.day_start_hour)
      ? "Начало рабочего дня изменилось. Прочитайте кассовые отчёты заново"
      : null;
  if (!(await scope(venueId))) return null;
  return {
    canManage: s.canManage,
    reports: d?.reports ?? [],
    results: problem ? [] : cashControlResults(d?.reports ?? [], rules),
    checkedAt: d?.checked_at ?? null,
    version: d?.version ?? null,
    rules,
    problem,
    job: job.data as CashDayData["job"],
  };
}
