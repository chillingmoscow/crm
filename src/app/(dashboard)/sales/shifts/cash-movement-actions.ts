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
  cashMovementRulesSchema,
  cashMovementOverridesSchema,
  planCashMovements,
  compareCashMovements,
  type CashMovementRules,
  type CashMovement,
  type MovementTransaction,
} from "@/lib/sales/cash-movements";
import { validDate } from "@/lib/sales/time";
import { loadSettlementConfiguration } from "./settlement-actions";
export type MovementRuleVersion = {
  id: string;
  version: number;
  config: CashMovementRules;
  reason: string;
  actor_name: string;
  created_at: string;
};
export type MovementConfiguration = {
  venueId: string;
  versions: MovementRuleVersion[];
  preset: CashMovementRules["overrides"];
  banks: { id: string; name: string }[];
  categories: { id: string; name: string; type: string }[];
};
export type MovementHistoryEntry = {
  id: string;
  version: number;
  items: CashMovement[];
  actor_name: string;
  created_at: string;
};
export type MovementDayData = {
  canManage: boolean;
  items: CashMovement[];
  checkedAt: string | null;
  version: number | null;
  configured: boolean;
  problem: string | null;
  review: ReturnType<typeof planCashMovements>["review"];
  rows: ReturnType<typeof compareCashMovements>;
  job: {
    state: string;
    phase: string;
    error: string | null;
    outside?: { id: number; date: string }[];
  } | null;
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
  const [active, owner] = await Promise.all([
    client.rpc("get_active_venue_id"),
    client.from("accounts").select("owner_id").eq("id", accountId).single(),
  ]);
  if (active.error || owner.error)
    throw Error("Не удалось проверить доступ к кассовым операциям");
  if (active.data !== venueId) return null;
  return {
    db: asLooseDb(client),
    accountId,
    canManage: owner.data.owner_id === user.id,
  };
}
export async function loadMovementConfiguration(
  venueId: string,
): Promise<MovementConfiguration> {
  const s = await scope(venueId);
  if (!s?.canManage)
    throw Error("Правила изменяет владелец в выбранном заведении");
  const imported = await s.db
    .from<{ payload: { overrides: unknown } }>("integration_external_snapshots")
    .select("payload")
    .eq("account_id", s.accountId)
    .eq("provider", "n8n")
    .eq("entity_type", "cash_movement_rule_preset")
    .eq("payload->>venueId", venueId)
    .order("fetched_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (imported.error)
    throw Error("Не удалось загрузить прежние ручные решения");
  const preset = imported.data
    ? cashMovementOverridesSchema.parse(imported.data.payload.overrides)
    : [];
  const options = await loadSettlementConfiguration(venueId),
    versions: MovementRuleVersion[] = [];
  for (let start = 0; start < 10000; start += 500) {
    const r = await s.db
      .from<MovementRuleVersion[]>("cash_movement_rules")
      .select("id,version,config,reason,actor_name,created_at")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .order("version", { ascending: false })
      .range(start, start + 499);
    if (r.error) throw Error("Не удалось загрузить правила инкассаций");
    versions.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 500)
      return {
        venueId,
        versions,
        preset,
        banks: options.banks,
        categories: options.categories,
      };
  }
  throw Error("Не удалось полностью загрузить историю правил");
}
export async function saveMovementConfiguration(input: {
  venueId: string;
  version: number;
  config: CashMovementRules;
  reason: string;
}) {
  const s = await scope(input.venueId);
  if (!s?.canManage) throw Error("Правила изменяет владелец");
  const config = cashMovementRulesSchema.parse(input.config);
  for (const key of [
    "cashAccountId",
    "safeAccountId",
    "operatingAccountId",
    "incomeCategoryId",
    "taxiCategoryId",
    "tipsCategoryId",
  ] as const)
    z.string().uuid().parse(config[key]);
  z.number().int().min(0).parse(input.version);
  z.string().trim().min(1).max(1000).parse(input.reason);
  const r = await s.db.rpc("cash_movement_save_rules", {
    p_venue: input.venueId,
    p_version: input.version,
    p_config: config,
    p_reason: input.reason,
  });
  if (r.error) throw Error(r.error.message);
  return loadMovementConfiguration(input.venueId);
}
export async function requestCashMovements(venueId: string, date: string) {
  const s = await scope(venueId);
  if (!s?.canManage) throw Error("Сверку запускает владелец");
  if (!validDate(date)) throw Error("Выберите день");
  const r = await s.db.rpc("cash_movement_request", {
    p_venue: venueId,
    p_date: date,
  });
  if (r.error) throw Error(r.error.message);
}
export async function loadCashMovements(
  venueId: string,
  date: string,
): Promise<MovementDayData | null> {
  const s = await scope(venueId);
  if (!s) return null;
  if (!validDate(date)) throw Error("Выберите день");
  const [rule, day, job, settings, tx, pinned] = await Promise.all([
    s.db
      .from<{ config: CashMovementRules }>("cash_movement_rules")
      .select("config")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    s.db
      .from<{
        items: CashMovement[];
        checked_at: string;
        version: number;
        request: { timezone: string };
      }>("cash_movement_days")
      .select("items,checked_at,version,request")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .maybeSingle(),
    s.db.rpc("cash_movement_job_status", { p_venue: venueId, p_date: date }),
    s.db
      .from<{ timezone: string }>("sales_settings")
      .select("timezone")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
    s.db.rpc("cash_movement_transactions", { p_venue: venueId, p_date: date }),
    s.db.rpc("finance_execution_day_rule", {
      p_venue: venueId, p_date: date, p_kind: "movements",
    }),
  ]);
  if (rule.error || day.error || job.error || settings.error || tx.error || pinned.error)
    throw Error("Не удалось загрузить сверку кассовых операций");
  let config = rule.data?.config;
  if (pinned.data) {
    const saved = await s.db.from<{ config: CashMovementRules }>("cash_movement_rules")
      .select("config").eq("account_id", s.accountId).eq("venue_id", venueId)
      .eq("id", pinned.data).single();
    if (saved.error || !saved.data || !config)
      throw Error("Не удалось загрузить правила проведённого дня");
    // Per-item decisions remain editable; account mappings are pinned to the day.
    config = { ...saved.data.config, overrides: config.overrides };
  }
  const items = day.data?.items ?? [],
    problem =
      day.data && day.data.request.timezone !== settings.data?.timezone
        ? "Часовой пояс изменился. Прочитайте кассовые операции заново"
        : null;
  const plan =
    config && !problem
      ? planCashMovements(venueId, items, config)
      : null;
  if (!(await scope(venueId))) return null;
  return {
    canManage: s.canManage,
    items,
    checkedAt: day.data?.checked_at ?? null,
    version: day.data?.version ?? null,
    configured: !!rule.data,
    problem,
    review: plan?.review ?? [],
    rows: plan
      ? compareCashMovements({
          venueId,
          plans: plan.plans,
          source: items,
          transactions: tx.data as MovementTransaction[],
          complete: true,
        })
      : [],
    job: job.data as MovementDayData["job"],
  };
}
export async function loadMovementHistory(
  venueId: string,
  date: string,
  before?: number,
): Promise<{ rows: MovementHistoryEntry[]; more: boolean } | null> {
  const s = await scope(venueId);
  if (!s) return null;
  if (!validDate(date)) throw Error("Выберите день");
  if (before !== undefined) z.number().int().positive().parse(before);
  const day = await s.db
    .from<{ id: string }>("cash_movement_days")
    .select("id")
    .eq("account_id", s.accountId)
    .eq("venue_id", venueId)
    .eq("business_date", date)
    .maybeSingle();
  if (day.error) throw Error("Не удалось загрузить историю кассовых операций");
  if (!day.data) return { rows: [], more: false };
  let q = s.db
    .from<MovementHistoryEntry[]>("cash_movement_history")
    .select("id,version,items,actor_name,created_at")
    .eq("day_id", day.data.id)
    .order("version", { ascending: false })
    .limit(21);
  if (before !== undefined) q = q.lte("version", before - 1);
  const r = await q;
  if (r.error) throw Error("Не удалось загрузить историю кассовых операций");
  return {
    rows: (r.data ?? []).slice(0, 20),
    more: (r.data?.length ?? 0) > 20,
  };
}
