"use server";
import { actionResult } from "@/lib/actions/result";
import { writeAuditEvent } from "@/lib/audit/write";
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
import { metricKeys, salesSettingsColumns } from "@/lib/sales/types";
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
async function loadSalesConfigurationImpl(
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
async function recalculateSalesHistoryImpl(input: {
  venueId: string;
  from: string;
  to: string;
}) {
  const s = await scope("sales.sync_shifts", input.venueId);
  if (!s.permissions.includes("sales.configure_shifts"))
    throw new Error("Нет доступа к настройкам смен");
  if (!validDate(input.from) || !validDate(input.to) || input.from > input.to)
    throw new Error("Выберите корректный период");
  const config = await loadSalesConfigurationImpl(s.venueId);
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
/**
 * Смены активного заведения. С `month` («2026-11») — только дни этого месяца:
 * экран «Смен» показывает один месяц и обновляет его каждую минуту, читать
 * всю историю на каждом обновлении незачем. Без `month` — вся история
 * (статистика по месяцам).
 */
async function loadSalesImpl(
  requested?: string | "current",
): Promise<SalesData> {
  if (requested !== undefined && requested !== "current")
    z.string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .parse(requested);
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
  const timezone =
    settings.data?.timezone ?? venue.data?.timezone ?? "Europe/Moscow";
  // «current» — месяц текущего рабочего дня в поясе заведения.
  const month =
    requested === "current"
      ? businessDate(
          new Date(),
          timezone,
          settings.data?.day_start_hour ?? 9,
        ).slice(0, 7)
      : requested;
  const days: SalesDay[] = [];
  const bounds = month
    ? {
        from: `${month}-01`,
        to: new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10),
      }
    : null;
  for (let start = 0; ; start += 1000) {
    let q = s.db
      .from<SalesDay[]>("sales_days")
      .select("*")
      .eq("venue_id", s.venueId);
    if (bounds)
      q = q.gte("business_date", bounds.from).lte("business_date", bounds.to);
    const r = await q
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
  // Есть ли смены вообще — чтобы пустой месяц не выглядел как «смен пока нет».
  let hasDays = days.length > 0;
  if (!hasDays && bounds) {
    const any = await s.db
      .from<{ id: string }[]>("sales_days")
      .select("id")
      .eq("venue_id", s.venueId)
      .limit(1);
    if (any.error) throw new Error(any.error.message);
    hasDays = (any.data?.length ?? 0) > 0;
  }
  return {
    days,
    hasDays,
    month,
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
async function adjustSalesImpl(input: {
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
    // null — вернуть исходное значение. NaN и Infinity при передаче
    // превращаются в null и молча сбросили бы исправление: отклоняем их.
    changes: z.record(
      z.enum(metricKeys),
      z.number().finite().gt(-1e12).lt(1e12).nullable(),
    ),
  }).parse(input);
  if (
    typeof input.changes.checks === "number" &&
    (!Number.isInteger(input.changes.checks) || input.changes.checks < 0)
  )
    throw new Error("Количество чеков: целое неотрицательное число");
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
async function salesHistoryImpl(id: string) {
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
async function requestSalesSyncImpl(dates: string[]) {
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
async function saveSalesSettingsImpl(
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
  const before = await admin
    .from<Record<string, unknown>>("sales_settings")
    .select(Object.keys(values).join(","))
    .eq("venue_id", s.venueId)
    .maybeSingle();
  // Без прежних значений журнал записал бы правку как новую настройку.
  if (before.error) throw new Error("Не удалось прочитать текущие настройки. Повторите попытку");
  const r = await admin.from("sales_settings").upsert({
    ...values,
    account_id: s.accountId,
    venue_id: s.venueId,
    updated_at: new Date().toISOString(),
  });
  if (r.error) throw new Error(r.error.message);
  await logSalesSettingsChange(s, before.data ?? null, values);
  if (values.enabled)
    await enqueueDay(
      s.accountId,
      s.venueId,
      businessDate(new Date(), values.timezone, values.day_start_hour),
      s.user.id,
      10,
    );
}
async function exportSalesRowsImpl(ids: string[]) {
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

/** Запись в общий журнал: что поменялось в настройках продаж. Поля с
 *  числовыми идентификаторами Quick Resto в строку не выводим — только
 *  факт, что они изменились. */
async function logSalesSettingsChange(
  s: { accountId: string; venueId: string; user: { id: string } },
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed = Object.keys(after).filter(
    (key) => !before || !same(before[key], after[key]),
  );
  if (before && changed.length === 0) return;
  const shown = ["enabled", "day_start_hour"];
  await writeAuditEvent({
    accountId: s.accountId,
    venueId: s.venueId,
    userId: s.user.id,
    actionCode: "sales.settings.updated",
    entityType: "sales_settings",
    entityId: s.venueId,
    details: {
      created: !before,
      changes: before
        ? changed
            .filter((key) => shown.includes(key))
            .map((key) => ({ field: `sales_${key}`, old: before[key], new: after[key] }))
        : [],
      other_fields: changed.filter((key) => !shown.includes(key)).length,
    },
  });
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function loadSalesConfiguration(venueId: string) {
  return actionResult(
    () => loadSalesConfigurationImpl(venueId),
    "Не удалось загрузить настройки смен",
  );
}
export async function recalculateSalesHistory(
  input: Parameters<typeof recalculateSalesHistoryImpl>[0],
) {
  return actionResult(
    () => recalculateSalesHistoryImpl(input),
    "Не удалось запустить пересчёт",
  );
}
/** Для сервера (страница, статистика): данные или исключение. */
export async function loadSales(
  requested?: string | "current",
): Promise<SalesData> {
  return loadSalesImpl(requested);
}
/** Для браузера: обновление экрана «Смен». */
export async function loadSalesForClient(requested?: string | "current") {
  return actionResult(
    () => loadSalesImpl(requested),
    "Не удалось загрузить смены",
  );
}
export async function adjustSales(
  input: Parameters<typeof adjustSalesImpl>[0],
) {
  return actionResult(
    () => adjustSalesImpl(input),
    "Не удалось сохранить исправления",
  );
}
export async function salesHistory(id: string) {
  return actionResult(
    () => salesHistoryImpl(id),
    "Не удалось загрузить историю смены",
  );
}
export async function requestSalesSync(dates: string[]) {
  return actionResult(
    () => requestSalesSyncImpl(dates),
    "Не удалось запустить обновление",
  );
}
export async function saveSalesSettings(
  input: z.infer<typeof settingsSchema>,
  venueId: string,
) {
  return actionResult(
    () => saveSalesSettingsImpl(input, venueId),
    "Не удалось сохранить настройки смен",
  );
}
export async function exportSalesRows(ids: string[]) {
  return actionResult(
    () => exportSalesRowsImpl(ids),
    "Не удалось выгрузить смены",
  );
}
