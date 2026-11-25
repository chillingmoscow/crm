"use server";
import { z } from "zod";
import { businessDate, addDays } from "@/lib/sales/time";
import {
  createClient,
  getCachedPermissions,
  getCachedActiveAccountId,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { actionResult } from "@/lib/actions/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  validateUpsellLines,
  type UpsellDayResult,
  type UpsellLine,
} from "@/lib/sales/upsell";
import { buildUpsellPicker, type UpsellPickerItem } from "@/lib/sales/upsell-prefill";

import type { DayArchive, DayReference } from "@/lib/sales/day-context";
import {
  type AdditionalDay,
  type AdditionalArchive,
  type AdditionalRuleVersion,
} from "@/lib/sales/additional";

async function scope(permission = "sales.view_shifts", expectedVenue?: string) {
  // Всё независимо — одной волной. Пользователь — из кэша запроса: свой
  // `auth.getUser()` здесь был лишним походом в GoTrue (на проде ~0,1 с)
  // поверх того, что уже сделали страница и middleware.
  const client = await createClient();
  const db = asLooseDb(client);
  const [user, permissions, account, venue] = await Promise.all([
    getCachedUser(),
    getCachedPermissions(),
    getCachedActiveAccountId(),
    db.rpc("get_active_venue_id"),
  ]);
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
  return { db, venueId: String(venue.data), accountId: account, permissions };
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
  days: DayReference[];
  dayArchives: DayArchive[];
  /** Активные подразделения заведения; version 0 — своих правил ещё нет. */
  departments: UpsellDepartment[];
  upsellRules: UpsellRuleVersion[];
  upsellDays: UpsellDay[];
  /** Номенклатура для редактора правил; пусто без права настраивать. */
  picker: UpsellPickerItem[];
};
export type UpsellDepartment = {
  id: string;
  name: string;
  legacyKind: "bar" | "masters" | null;
  version: number;
};
export type UpsellRuleVersion = {
  id: string;
  department_id: string;
  valid_from: string;
  lines: UpsellLine[];
  reason: string;
  created_at: string;
  created_by: string | null;
};
export type UpsellDay = {
  id: string;
  department_id: string;
  business_date: string;
  state: "pending" | "running" | "ready" | "error";
  result: UpsellDayResult | null;
  last_error: string | null;
  computed_at: string | null;
};

/**
 * Подразделения и номенклатура читаются service-role клиентом строго в
 * границах активного заведения/аккаунта: их RLS требует прав раздела
 * «Люди» и склада, а редактор нужен любому с `sales.configure_shifts`.
 * Вызывать только после проверок `scope()`.
 */
async function loadUpsellScope(s: Awaited<ReturnType<typeof scope>>) {
  const admin = asLooseDb(createAdminClient());
  const canConfigure = s.permissions.includes("sales.configure_shifts");
  type ItemRow = Parameters<typeof buildUpsellPicker>[0][number];
  type GroupRow = Parameters<typeof buildUpsellPicker>[1][number];
  const [deps, joined, items, groups] = await Promise.all([
    admin
      .from<{ id: string; name: string }[]>("departments")
      .select("id,name")
      .eq("venue_id", s.venueId)
      .is("archived_at", null)
      .order("name")
      .order("id")
      .limit(1000),
    s.db
      .from<
        { department_id: string; legacy_kind: "bar" | "masters" | null; version: number }[]
      >("sales_upsell_departments")
      .select("department_id,legacy_kind,version")
      .eq("venue_id", s.venueId)
      .limit(1000),
    canConfigure
      ? fetchAllRows<ItemRow>(() =>
          admin
            .from<ItemRow[]>("ingredients")
            .select("external_id,kind,name,group_id,tags,archived_at")
            .eq("account_id", s.accountId)
            .in("kind", ["dish", "modifier"]),
        )
      : Promise.resolve([] as ItemRow[]),
    canConfigure
      ? fetchAllRows<GroupRow>(() =>
          admin
            .from<GroupRow[]>("ingredient_groups")
            .select("id,external_id,kind,name,parent_group_id,store_tags:raw_payload->storeItemTags")
            .eq("account_id", s.accountId)
            .in("kind", ["dish", "modifier"]),
        )
      : Promise.resolve([] as GroupRow[]),
  ]);
  if (deps.error || joined.error)
    throw new Error("Не удалось загрузить подразделения допродаж");
  const byId = new Map((joined.data ?? []).map((d) => [d.department_id, d]));
  const order = { bar: 0, masters: 1 } as const;
  const departments: UpsellDepartment[] = (deps.data ?? [])
    .map((d) => ({
      id: d.id,
      name: d.name,
      legacyKind: byId.get(d.id)?.legacy_kind ?? null,
      version: byId.get(d.id)?.version ?? 0,
    }))
    .sort(
      (a, b) =>
        (a.legacyKind ? order[a.legacyKind] : 2) -
          (b.legacyKind ? order[b.legacyKind] : 2) ||
        a.name.localeCompare(b.name, "ru"),
    );
  return { departments, picker: buildUpsellPicker(items, groups) };
}
async function loadAdditionalImpl(
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
      if (table === "sales_additional_rules" || table === "sales_upsell_rules")
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
  const [
    reports,
    archives,
    rules,
    source,
    days,
    dayArchives,
    settings,
    upsellRules,
    upsellDays,
    upsell,
  ] = await Promise.all([
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
      rows<DayReference>(
        "sales_days",
        "id,venue_id,business_date,calculated,overrides,status,updated_at",
        "business_date",
      ),
      rows<DayArchive>(
        "sales_day_archive",
        "id,venue_id,business_date,legacy_ref,metrics,captured_at,imported_at,origin",
        "captured_at",
      ),
      s.db
        .from<{ timezone: string; day_start_hour: number }>("sales_settings")
        .select("timezone,day_start_hour")
        .eq("venue_id", s.venueId)
        .maybeSingle(),
      rows<UpsellRuleVersion>(
        "sales_upsell_rules",
        "id,department_id,valid_from,lines,reason,created_at,created_by",
        "valid_from",
      ),
      rows<UpsellDay>(
        "sales_upsell_days",
        "id,department_id,business_date,state,result,last_error,computed_at",
        "business_date",
      ),
      loadUpsellScope(s),
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
    days,
    dayArchives,
    departments: upsell.departments,
    upsellRules,
    upsellDays,
    picker: upsell.picker,
  };
}
async function requestAdditionalImpl(month: string, venueId: string) {
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
/** Что нужно вкладке «Допродажи» карточки подразделения. */
export type UpsellEditorData = {
  venueId: string;
  timezone: string;
  /** Первый день, с которого можно сохранить версию. */
  nextFrom: string;
  department: UpsellDepartment;
  /** Прежние правила заведения — для первой версии бара и кальянов. */
  rules: AdditionalRuleVersion[];
  /** Версии правил подразделения, `valid_from desc, created_at desc`. */
  upsellRules: UpsellRuleVersion[];
  picker: UpsellPickerItem[];
};
async function loadUpsellEditorImpl(
  departmentId: string,
  expectedVenue?: string,
): Promise<UpsellEditorData> {
  z.string().uuid().parse(departmentId);
  const s = await scope("sales.configure_shifts", expectedVenue);
  const [upsell, rules, versions, settings] = await Promise.all([
    loadUpsellScope(s),
    s.db
      .from<AdditionalRuleVersion[]>("sales_additional_rules")
      .select("id,valid_from,config,reason,created_at,created_by")
      .eq("venue_id", s.venueId)
      .order("valid_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    s.db
      .from<UpsellRuleVersion[]>("sales_upsell_rules")
      .select("id,department_id,valid_from,lines,reason,created_at,created_by")
      .eq("venue_id", s.venueId)
      .eq("department_id", departmentId)
      .order("valid_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    s.db
      .from<{ timezone: string; day_start_hour: number }>("sales_settings")
      .select("timezone,day_start_hour")
      .eq("venue_id", s.venueId)
      .maybeSingle(),
  ]);
  if (rules.error || versions.error || settings.error)
    throw new Error("Не удалось загрузить правила допродаж");
  const department = upsell.departments.find((d) => d.id === departmentId);
  if (!department) throw new Error("Подразделение не найдено в этом заведении");
  const timezone = settings.data?.timezone ?? "Europe/Moscow";
  return {
    venueId: s.venueId,
    timezone,
    nextFrom: addDays(businessDate(new Date(), timezone, settings.data?.day_start_hour ?? 9), 1),
    department,
    rules: rules.data ?? [],
    upsellRules: versions.data ?? [],
    picker: upsell.picker,
  };
}
async function saveUpsellRulesImpl(input: {
  venueId: string;
  departmentId: string;
  version: number;
  from: string;
  lines: UpsellLine[];
  reason: string;
}) {
  const s = await scope("sales.configure_shifts", input.venueId);
  z.string().uuid().parse(input.departmentId);
  z.number().int().nonnegative().parse(input.version);
  z.string()
    .regex(/^20\d{2}-\d{2}-\d{2}$/)
    .parse(input.from);
  z.string().trim().min(3).max(1000).parse(input.reason);
  const lines = z
    .array(
      z
        .object({
          target: z.enum(["dish", "dish_group", "modifier", "modifier_group"]),
          external_id: z.string(),
          name: z.string(),
          rate: z.number(),
        })
        .strict(),
    )
    .parse(input.lines)
    .map((l) => ({ ...l, name: l.name.trim() }));
  validateUpsellLines(lines);
  const r = await s.db.rpc("sales_save_upsell_rules", {
    p_expected_venue: s.venueId,
    p_department: input.departmentId,
    p_version: input.version,
    p_from: input.from,
    p_lines: lines,
    p_reason: input.reason.trim(),
  });
  if (r.error) throw new Error(r.error.message);
  return loadUpsellEditorImpl(input.departmentId, s.venueId);
}
async function loadAdditionalHistoryImpl(venueId: string, reportId: string) {
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
async function exportAdditionalImpl(venueId: string) {
  await scope("sales.export_shifts", venueId);
  return loadAdditionalImpl(venueId);
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function loadAdditional(expectedVenue?: string) {
  return actionResult(
    () => loadAdditionalImpl(expectedVenue),
    "Не удалось загрузить допродажи",
  );
}
export async function requestAdditional(month: string, venueId: string) {
  return actionResult(
    () => requestAdditionalImpl(month, venueId),
    "Не удалось запросить отчёты",
  );
}
export async function loadUpsellEditor(departmentId: string) {
  return actionResult(
    () => loadUpsellEditorImpl(departmentId),
    "Не удалось загрузить правила допродаж",
  );
}
export async function saveUpsellRules(input: Parameters<typeof saveUpsellRulesImpl>[0]) {
  return actionResult(
    () => saveUpsellRulesImpl(input),
    "Не удалось сохранить правила допродаж",
  );
}
export async function loadAdditionalHistory(venueId: string, reportId: string) {
  return actionResult(
    () => loadAdditionalHistoryImpl(venueId, reportId),
    "Не удалось загрузить историю",
  );
}
export async function exportAdditional(venueId: string) {
  return actionResult(
    () => exportAdditionalImpl(venueId),
    "Не удалось выгрузить допродажи",
  );
}
