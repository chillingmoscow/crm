"use server";
import { z } from "zod";
import {
  createClient,
  getCachedUser,
  getCachedActiveAccountId,
  getCachedPermissions,
} from "@/lib/supabase/server";
import { asLooseDb, type LooseQuery } from "@/lib/supabase/loose";
import {
  calculateSettlement,
  compareSettlement,
  settlementSettingsSchema,
  type SettlementSettings,
  type SettlementReceipt,
  type SettlementTransaction,
} from "@/lib/sales/settlement";
import { validDate } from "@/lib/sales/time";
import type { SettlementMethod } from "@/lib/sales/settlement-reader";

export type SettlementVersion = {
  id: string;
  version: number;
  config: SettlementSettings;
  auto_read: boolean;
  reason: string;
  actor_name: string;
  created_at: string;
};
export type SettlementJobStatus = {
  id: string;
  state: string;
  phase: string;
  pass: number;
  cursor: number;
  total: number;
  error: string | null;
  updatedAt: string;
};
type Option = { id: string; name: string };
export type SettlementConfiguration = {
  venueId: string;
  timezone: string;
  dayStartHour: number;
  versions: SettlementVersion[];
  banks: Option[];
  categories: (Option & { type: string })[];
  methods: SettlementMethod[];
};
export type SettlementPanelData = {
  configured: boolean;
  version: number | null;
  checkedAt: string | null;
  receipts: number;
  job: SettlementJobStatus | null;
  problem: string | null;
  methods: SettlementMethod[];
  rows: {
    key: string;
    label: string;
    bank: string;
    amount: number;
    state: string;
    transactionIds: string[];
  }[];
  extraCount: number;
  ready: boolean;
  excludedAmount: number;
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
    !permissions.includes("sales.view_shifts") ||
    !permissions.includes("finance.view_transactions")
  )
    return null;
  const [active, owner] = await Promise.all([
    client.rpc("get_active_venue_id"),
    client
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("owner_id", user.id)
      .maybeSingle(),
  ]);
  if (active.error || owner.error)
    throw new Error("Не удалось проверить доступ к сверке");
  if (active.data !== venueId || !owner.data) return null;
  return { client, db: asLooseDb(client), accountId, venueId };
}
async function required(venueId: string) {
  const s = await scope(venueId);
  if (!s) throw new Error("Сверка доступна владельцу в выбранном заведении");
  return s;
}
async function all<T>(build: () => LooseQuery<T[]>): Promise<T[]> {
  const result: T[] = [];
  for (let start = 0; start < 10000; start += 500) {
    const r = await build().range(start, start + 499);
    if (r.error)
      throw new Error("Не удалось полностью загрузить настройки сверки");
    result.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 500) return result;
  }
  throw new Error(
    "Список настроек слишком большой. Загрузка остановлена без усечения",
  );
}
export async function loadSettlementConfiguration(
  venueId: string,
): Promise<SettlementConfiguration> {
  const s = await required(venueId);
  const [versions, banks, categories, settings, days] = await Promise.all([
    all(() =>
      s.db
        .from<SettlementVersion[]>("finance_settlement_settings")
        .select("id,version,config,auto_read,reason,actor_name,created_at")
        .eq("account_id", s.accountId)
        .eq("venue_id", venueId)
        .order("version", { ascending: false }),
    ),
    all(() =>
      s.db
        .from<Option[]>("bank_accounts")
        .select("id,name")
        .eq("account_id", s.accountId)
        .or(`venue_id.is.null,venue_id.eq.${venueId}`)
        .eq("is_active", true)
        .eq("currency", "RUB")
        .is("deleted_at", null)
        .order("name")
        .order("id"),
    ),
    all(() =>
      s.db
        .from<(Option & { type: string })[]>("finance_categories")
        .select("id,name,type")
        .eq("account_id", s.accountId)
        .is("archived_at", null)
        .order("name")
        .order("id"),
    ),
    s.db
      .from<{ timezone: string; day_start_hour: number }>("sales_settings")
      .select("timezone,day_start_hour")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
    s.db
      .from<{ methods: SettlementMethod[] }[]>("finance_settlement_days")
      .select("methods")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .order("business_date", { ascending: false })
      .limit(100),
  ]);
  if (settings.error || days.error)
    throw new Error("Не удалось загрузить источники поступлений");
  if (!settings.data) throw new Error("Сначала настройте источники продаж");
  const methods = new Map<number, SettlementMethod>();
  // Most recent observed label wins. Other methods can be added by ID explicitly.
  for (const day of days.data ?? [])
    for (const method of day.methods)
      if (!methods.has(method.id)) methods.set(method.id, method);
  await required(venueId);
  return {
    venueId,
    timezone: settings.data.timezone,
    dayStartHour: settings.data.day_start_hour,
    versions,
    banks,
    categories,
    methods: [...methods.values()].sort((a, b) => a.id - b.id),
  };
}
export async function saveSettlementConfiguration(input: {
  venueId: string;
  version: number;
  config: SettlementSettings;
  autoRead: boolean;
  reason: string;
}) {
  const s = await required(input.venueId),
    config = settlementSettingsSchema.parse(input.config);
  if (config.venueId !== input.venueId) throw new Error("Заведение изменилось");
  z.number().int().min(0).parse(input.version);
  z.boolean().parse(input.autoRead);
  z.string().trim().min(1).max(1000).parse(input.reason);
  const r = await s.db.rpc("finance_save_settlement_settings", {
    p_venue: input.venueId,
    p_version: input.version,
    p_config: config,
    p_auto_read: input.autoRead,
    p_reason: input.reason,
  });
  if (r.error) throw new Error(r.error.message);
  return loadSettlementConfiguration(input.venueId);
}
export async function requestSettlement(venueId: string, date: string) {
  const s = await required(venueId);
  if (!validDate(date)) throw new Error("Выберите рабочий день");
  const r = await s.db.rpc("finance_request_settlement", {
    p_venue: venueId,
    p_date: date,
  });
  if (r.error) throw new Error(r.error.message);
}
export async function loadSettlementPanel(
  venueId: string,
  date: string,
): Promise<SettlementPanelData | null> {
  const s = await scope(venueId);
  if (!s) return null;
  if (!validDate(date)) throw new Error("Выберите рабочий день");
  const [config, day, status] = await Promise.all([
    s.db
      .from<SettlementVersion>("finance_settlement_settings")
      .select("id,version,config,auto_read,reason,actor_name,created_at")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    s.db
      .from<{
        facts: SettlementReceipt[];
        methods: SettlementMethod[];
        version: number;
        checked_at: string;
        summary: { source: { timezone: string; dayStartHour: number } };
      }>("finance_settlement_days")
      .select("facts,methods,version,checked_at,summary")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .maybeSingle(),
    s.db.rpc("finance_settlement_job_status", {
      p_venue: venueId,
      p_date: date,
    }),
  ]);
  if (config.error || day.error || status.error)
    throw new Error("Не удалось загрузить сверку поступлений");
  const d = day.data,
    c = config.data;
  const result: SettlementPanelData = {
    configured: !!c,
    version: d?.version ?? null,
    checkedAt: d?.checked_at ?? null,
    receipts: d?.facts.length ?? 0,
    job: status.data as SettlementJobStatus | null,
    problem: null,
    methods: d?.methods ?? [],
    rows: [],
    extraCount: 0,
    ready: false,
    excludedAmount: 0,
  };
  if (!d || !c) return result;
  const settings = await s.db
    .from<{ timezone: string; day_start_hour: number }>("sales_settings")
    .select("timezone,day_start_hour")
    .eq("account_id", s.accountId)
    .eq("venue_id", venueId)
    .single();
  if (settings.error)
    throw new Error("Не удалось проверить границу рабочего дня");
  try {
    if (
      settings.data?.timezone !== c.config.timezone ||
      settings.data?.day_start_hour !== c.config.dayStartHour ||
      d.summary.source.timezone !== c.config.timezone ||
      d.summary.source.dayStartHour !== c.config.dayStartHour
    )
      throw new Error(
        "Граница рабочего дня изменилась. Сохраните настройки и прочитайте день заново",
      );
    const plan = calculateSettlement({
      date,
      complete: true,
      expectedOrderIds: d.facts.map((r) => r.id),
      receipts: d.facts,
      settings: c.config,
    });
    const [transactions, banks] = await Promise.all([
      s.db.rpc("finance_settlement_transactions", {
        p_venue: venueId,
        p_date: date,
      }),
      all(() =>
        s.db
          .from<Option[]>("bank_accounts")
          .select("id,name")
          .eq("account_id", s.accountId)
          .order("id"),
      ),
    ]);
    if (transactions.error) throw new Error(transactions.error.message);
    const compared = compareSettlement(
      plan,
      transactions.data as SettlementTransaction[],
      true,
    );
    result.rows = compared.matches.map((r) => ({
      key: r.effect.key,
      label:
        r.effect.kind === "revenue"
          ? "Выручка"
          : r.effect.kind === "personal_income"
            ? "Личное потребление · приход"
            : "Личное потребление · расход",
      bank:
        banks.find((b) => b.id === r.effect.bankAccountId)?.name ??
        "Счёт недоступен",
      amount: r.effect.amount,
      state: r.state,
      transactionIds: r.transactionIds,
    }));
    result.extraCount =
      compared.extraLegacy.length + compared.extraNative.length;
    result.ready = compared.ready;
    result.excludedAmount = plan.excludedPayments.reduce(
      (sum, x) => sum + x.amount,
      0,
    );
  } catch (e) {
    result.problem =
      e instanceof Error ? e.message : "Не удалось рассчитать сверку";
  }
  await required(venueId);
  return result;
}
