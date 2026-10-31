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
  deductionDraft,
  deductionRulesSchema,
  type DeductionRules,
  type DeductionRuleVersion,
  type StockRoleOption,
} from "@/lib/stock/deduction-rules";
export type StockRuleData = {
  venueId: string;
  versions: DeductionRuleVersion[];
  draft: DeductionRules;
  roles: StockRoleOption[];
  today: string;
  timezone: string;
  canEdit: boolean;
  hasLegacy: boolean;
};
async function context(expected: string) {
  z.string().uuid().parse(expected);
  const [client, user, accountId, permissions] = await Promise.all([
    createClient(),
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissions(),
  ]);
  const db = asLooseDb(client),
    v = await db.rpc("get_active_venue_id");
  if (!user || !accountId || !permissions.includes("inventory.view_results"))
    throw new Error("Нет доступа к правилам удержаний");
  if (v.error || v.data !== expected)
    throw new Error(
      "Переключитесь на это заведение, чтобы открыть его правила",
    );
  return { client, db, user, accountId, venueId: expected };
}
export async function loadStockRules(venueId: string): Promise<StockRuleData> {
  const s = await context(venueId);
  const versions: DeductionRuleVersion[] = [];
  for (let start = 0; start < 10000; start += 1000) {
    const r = await s.db
      .from<DeductionRuleVersion[]>("stock_deduction_rules")
      .select(
        "id,version,valid_from,config,reason,created_at,created_by,actor_name",
      )
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .order("version", { ascending: false })
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить правила удержаний");
    versions.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
    if (start === 9000)
      throw new Error("Не удалось загрузить всю историю правил");
  }
  const roles: StockRoleOption[] = [];
  for (let start = 0; start < 10000; start += 1000) {
    const r = await s.db
      .from<StockRoleOption[]>("roles")
      .select("id,name,archived_at")
      .eq("venue_id", venueId)
      .order("name")
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить должности");
    roles.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
    if (start === 9000) throw new Error("Не удалось загрузить все должности");
  }
  // Archived assignments remain visible and removable, but cannot be newly saved.
  const referenced = new Set(
    versions.flatMap((v) => [
      ...v.config.groups.flatMap((g) => g.roleIds),
      ...v.config.excludedRoleIds,
    ]),
  );
  const visibleRoles = roles.filter(
    (r) => !r.archived_at || referenced.has(r.id),
  );
  const [source, venue, account] = await Promise.all([
    s.db
      .from<{ origin: Record<string, unknown> }>("stock_writeoff_sources")
      .select("origin")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
    s.client
      .from("venues")
      .select("timezone")
      .eq("account_id", s.accountId)
      .eq("id", venueId)
      .single(),
    s.client.from("accounts").select("owner_id").eq("id", s.accountId).single(),
  ]);
  if (source.error || venue.error || account.error)
    throw new Error("Не удалось загрузить настройки заведения");
  const fallback: DeductionRules = {
    enabled: false,
    companyAllowance: 0,
    multiplier: 1,
    ingredientTolerance: 0,
    distribution: "shifts",
    split: "once",
    inventoryExclusions: [],
    roleSpecificCategories: [],
    writeoffReasons: [],
    groups: [],
    excludedRoleIds: [],
  };
  const legacy =
    versions.length === 0
      ? deductionDraft(source.data?.origin ?? {}, roles)
      : null;
  const check = await s.db.rpc("get_active_venue_id");
  if (check.error || check.data !== venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  return {
    venueId,
    versions,
    draft: versions[0]?.config ?? legacy ?? fallback,
    roles: visibleRoles,
    today: new Intl.DateTimeFormat("en-CA", {
      timeZone: venue.data.timezone ?? "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    timezone: venue.data.timezone ?? "Europe/Moscow",
    canEdit: account.data.owner_id === s.user.id,
    hasLegacy: !!legacy,
  };
}
export async function saveStockRules(input: {
  venueId: string;
  expectedVersion: number;
  validFrom: string;
  config: DeductionRules;
  reason: string;
}) {
  const s = await context(input.venueId);
  const config = deductionRulesSchema.parse(input.config);
  z.string()
    .regex(/^20\d{2}-\d{2}-\d{2}$/)
    .parse(input.validFrom);
  z.number().int().min(0).parse(input.expectedVersion);
  z.string().trim().min(1).max(1000).parse(input.reason);
  const r = await s.db.rpc("stock_save_deduction_rules", {
    p_expected_venue: input.venueId,
    p_expected_version: input.expectedVersion,
    p_valid_from: input.validFrom,
    p_config: config,
    p_reason: input.reason,
  });
  if (r.error) throw new Error(r.error.message);
  return loadStockRules(input.venueId);
}
