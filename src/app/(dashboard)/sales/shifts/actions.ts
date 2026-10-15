"use server";
import {
  createClient,
  getCachedPermissions,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getConnection } from "@/lib/sales/quickresto";
import { enqueueDay } from "@/lib/sales/sync";
import { businessDate, validDate, addDays } from "@/lib/sales/time";
import { z } from "zod";
import { salesSettingsColumns } from "@/lib/sales/types";
import type {
  SalesData,
  SalesDay,
  SalesEvent,
  SalesSettings,
  Metrics,
  SalesConfiguration,
} from "@/lib/sales/types";

async function scope(permission = "sales.view_shifts", targetVenueId?: string) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Войдите в аккаунт");
  const permissions = await getCachedPermissions();
  if (
    !permissions.includes(permission) ||
    !permissions.includes("sales.view_shifts")
  )
    throw new Error("Нет доступа к сменам");
  const accountId = await getCachedActiveAccountId();
  const venue = await client.rpc("get_active_venue_id");
  if (!accountId || !venue.data) throw new Error("Выберите заведение");
  if (targetVenueId) {
    z.string().uuid().parse(targetVenueId);
    const owner = await client
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("owner_id", user.id)
      .maybeSingle();
    const target = await client
      .from("venues")
      .select("id")
      .eq("id", targetVenueId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!owner.data || !target.data)
      throw new Error("Настройки заведения недоступны");
  }
  return {
    client,
    db: asLooseDb(client),
    accountId,
    venueId: targetVenueId ?? (venue.data as string),
    user,
    permissions,
  };
}
export async function loadSalesConfiguration(
  venueId: string,
): Promise<SalesConfiguration> {
  const s = await scope("sales.configure_shifts", venueId);
  const admin = asLooseDb(createAdminClient());
  const [venue, settings, connection, first, pending] = await Promise.all([
    s.client
      .from("venues")
      .select("name,timezone")
      .eq("id", s.venueId)
      .single(),
    admin
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .maybeSingle(),
    getConnection(s.accountId),
    admin
      .from<{ business_date: string }>("sales_days")
      .select("business_date")
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .order("business_date")
      .limit(1)
      .maybeSingle(),
    admin
      .from("sales_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .in("status", ["queued", "running"]),
  ]);
  const error = venue.error ?? settings.error ?? first.error ?? pending.error;
  if (error) throw new Error(error.message);
  return {
    venueId: s.venueId,
    venueName: venue.data?.name ?? "",
    timezone:
      settings.data?.timezone ?? venue.data?.timezone ?? "Europe/Moscow",
    settings: settings.data,
    connected: !!connection,
    historyStart: first.data?.business_date ?? null,
    pending: pending.count ?? 0,
  };
}
export async function recalculateSalesHistory(input: {
  venueId: string;
  from: string;
  to: string;
}) {
  const s = await scope("sales.sync_shifts", input.venueId);
  if (!s.permissions.includes("sales.configure_shifts"))
    throw new Error("Нет доступа к настройкам смен");
  if (!validDate(input.from) || !validDate(input.to) || input.from > input.to)
    throw new Error("Выберите корректный период");
  const config = await loadSalesConfiguration(s.venueId);
  if (!config.settings || !config.connected)
    throw new Error(
      "Сначала подключите Quick Resto и сохраните параметры расчёта",
    );
  const today = businessDate(
    new Date(),
    config.timezone,
    config.settings.day_start_hour,
  );
  if (input.to > today) throw new Error("Будущие смены нельзя пересчитать");
  const length =
    Math.round((Date.parse(input.to) - Date.parse(input.from)) / 86400000) + 1;
  if (length > 366)
    throw new Error("За один запуск можно пересчитать до 366 дней");
  for (let i = 0; i < length; i++)
    await enqueueDay(s.accountId, s.venueId, addDays(input.from, i), s.user.id);
  return length;
}
export async function loadSales(): Promise<SalesData> {
  const s = await scope();
  const [venue, settings, connection] = await Promise.all([
    s.db
      .from<{ name: string; timezone: string }>("venues")
      .select("name,timezone")
      .eq("id", s.venueId)
      .single(),
    s.db
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("venue_id", s.venueId)
      .maybeSingle(),
    getConnection(s.accountId),
  ]);
  if (venue.error || settings.error)
    throw new Error(venue.error?.message ?? settings.error?.message);
  const days: SalesDay[] = [];
  for (let start = 0; ; start += 1000) {
    const r = await s.db
      .from<SalesDay[]>("sales_days")
      .select("*")
      .eq("venue_id", s.venueId)
      .order("business_date", { ascending: false })
      .range(start, start + 999);
    if (r.error) throw new Error(r.error.message);
    days.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 1000) break;
  }
  const jobs = await asLooseDb(createAdminClient())
    .from<
      {
        id: string;
        business_date: string;
        status: string;
        error: string | null;
      }[]
    >("sales_sync_jobs")
    .select("id,business_date,status,error")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .in("status", ["queued", "running", "failed"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (jobs.error) throw new Error(jobs.error.message);
  return {
    days,
    venueId: s.venueId,
    venueName: venue.data?.name ?? "",
    timezone:
      settings.data?.timezone ?? venue.data?.timezone ?? "Europe/Moscow",
    permissions: s.permissions,
    settings: settings.data,
    connected: !!connection,
    error: null,
    jobs: jobs.data ?? [],
  };
}
export async function adjustSales(input: {
  id: string;
  version: number;
  changes: Partial<Metrics>;
  reason: string;
  note: string;
}) {
  const s = await scope("sales.adjust_shifts");
  z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
    note: z.string().max(5000),
  }).parse(input);
  const r = await s.db.rpc("sales_adjust", {
    p_day_id: input.id,
    p_version: input.version,
    p_changes: input.changes,
    p_reason: input.reason,
    p_note: input.note,
  });
  if (r.error) throw new Error(r.error.message);
  return r.data as SalesDay;
}
export async function salesHistory(id: string) {
  const s = await scope();
  z.string().uuid().parse(id);
  const r = await s.db
    .from<SalesEvent[]>("sales_events")
    .select("*")
    .eq("day_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}
export async function requestSalesSync(dates: string[]) {
  const s = await scope("sales.sync_shifts");
  if (!dates.length || dates.length > 31 || dates.some((d) => !validDate(d)))
    throw new Error("Выберите от 1 до 31 даты");
  const settings = await s.db
    .from<SalesSettings>("sales_settings")
    .select(salesSettingsColumns)
    .eq("venue_id", s.venueId)
    .single();
  if (!settings.data)
    throw new Error("Настройте расчёт смен в карточке заведения");
  const today = businessDate(
    new Date(),
    settings.data.timezone,
    settings.data.day_start_hour,
  );
  if (dates.some((d) => d > today))
    throw new Error("Будущие смены нельзя обновить");
  if (!(await getConnection(s.accountId)))
    throw new Error("Подключите Quick Resto в настройках интеграций");
  for (const d of new Set(dates))
    await enqueueDay(
      s.accountId,
      s.venueId,
      d,
      s.user.id,
      d === today ? 10 : 5,
    );
  return dates.length;
}
const mapping = z.record(
  z.string().regex(/^\d+$/),
  z
    .number()
    .finite()
    .min(-100000)
    .max(100000)
    .refine((n) => n !== 0),
);
const settingsSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().refine((t) => {
    try {
      new Intl.DateTimeFormat("ru", { timeZone: t });
      return true;
    } catch {
      return false;
    }
  }, "Некорректный часовой пояс"),
  day_start_hour: z.number().int().min(0).max(23),
  staff_group_id: z.number().int().positive(),
  hookah_report_id: z.number().int().positive(),
  quickresto_venue_id: z.number().int().positive().nullable(),
  tip_products: mapping,
  deposit_products: mapping,
  parking_product_ids: z.array(z.number().int().positive()).max(100),
});
export async function saveSalesSettings(
  input: z.infer<typeof settingsSchema>,
  venueId: string,
) {
  const s = await scope("sales.configure_shifts", venueId);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      "Проверьте часовой пояс, числовые идентификаторы и номиналы позиций",
    );
  const values = parsed.data;
  if (values.enabled && !(await getConnection(s.accountId)))
    throw new Error("Подключите Quick Resto перед включением обновлений");
  const admin = asLooseDb(createAdminClient());
  const other = await admin
    .from<{ venue_id: string }[]>("sales_settings")
    .select("venue_id")
    .eq("account_id", s.accountId)
    .eq("enabled", true)
    .neq("venue_id", s.venueId);
  if (other.error) throw new Error(other.error.message);
  if (values.enabled && other.data?.length)
    throw new Error(
      "Автообновление уже включено для другого заведения этого подключения. Сначала настройте разделение источников",
    );
  const active = await admin
    .from("sales_sync_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .in("status", ["queued", "running"]);
  if (active.error) throw new Error(active.error.message);
  if (active.count)
    throw new Error("Дождитесь окончания пересчёта перед изменением правил");
  const r = await admin.from("sales_settings").upsert({
    ...values,
    account_id: s.accountId,
    venue_id: s.venueId,
    updated_at: new Date().toISOString(),
  });
  if (r.error) throw new Error(r.error.message);
  if (values.enabled)
    await enqueueDay(
      s.accountId,
      s.venueId,
      businessDate(new Date(), values.timezone, values.day_start_hour),
      s.user.id,
      10,
    );
}
export async function exportSalesRows(ids: string[]) {
  const s = await scope("sales.export_shifts");
  if (
    ids.length > 20000 ||
    ids.some((id) => !z.string().uuid().safeParse(id).success)
  )
    throw new Error("Некорректные строки");
  const result: SalesDay[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const r = await s.db
      .from<SalesDay[]>("sales_days")
      .select("*")
      .eq("venue_id", s.venueId)
      .in("id", ids.slice(i, i + 200));
    if (r.error) throw new Error(r.error.message);
    result.push(...(r.data ?? []));
  }
  return result;
}
