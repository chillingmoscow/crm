import "server-only";

import { cache } from "react";

import { businessDate, zonedParts } from "@/lib/sales/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissions,
  getCachedUser,
} from "@/lib/supabase/server";

/** Час начала рабочего дня, если в заведении не настроены продажи. */
const DEFAULT_DAY_START_HOUR = 9;

export type HomeContext = {
  userId: string;
  accountId: string;
  venueId: string;
  permissions: Set<string>;
  timezone: string;
  /** Час начала рабочего дня заведения (настройка продаж). */
  dayStartHour: number;
  /** Рабочий день, который идёт сейчас (до начала дня — ещё вчерашний). */
  businessDay: string;
  /** Календарный день в поясе заведения. */
  calendarDay: string;
  /** Час в поясе заведения — для приветствия. */
  hour: number;
};

/**
 * Общий контекст главной и счётчиков «Требует внимания»: кто, в каком
 * заведении, какие права и какой сейчас рабочий день по часам заведения
 * (на проде сервер в UTC). Один раз на запрос — блоки страницы и меню берут
 * его из `cache`. `null` — нет пользователя или активного заведения.
 */
export const getHomeContext = cache(async (): Promise<HomeContext | null> => {
  const supabase = await createClient();
  const [user, accountId, permissions, venue] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissions(),
    supabase.rpc("get_active_venue_id"),
  ]);
  const venueId = (venue.data as string | null) ?? null;
  if (!user || !accountId || !venueId) return null;

  const [venueRow, settings] = await Promise.all([
    supabase.from("venues").select("timezone").eq("id", venueId).maybeSingle(),
    // Час начала дня — не секрет, но таблица настроек продаж читается только
    // с правом на смены. Нужен и тем, кто видит только расписание.
    asLooseDb(createAdminClient())
      .from<{ day_start_hour: number; timezone: string | null }>("sales_settings")
      .select("day_start_hour,timezone")
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
  ]);
  const timezone = safeZone(settings.data?.timezone ?? venueRow.data?.timezone ?? "Europe/Moscow");
  const dayStartHour = settings.data?.day_start_hour ?? DEFAULT_DAY_START_HOUR;
  const now = new Date();
  const parts = zonedParts(now, timezone);
  return {
    userId: user.id,
    accountId,
    venueId,
    permissions: new Set(permissions),
    timezone,
    dayStartHour,
    businessDay: businessDate(now, timezone, dayStartHour),
    calendarDay: parts.date,
    hour: parts.hour,
  };
});

/** Незнакомый Intl пояс уронил бы страницу RangeError — тогда московское время. */
function safeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: timezone });
    return timezone;
  } catch {
    return "Europe/Moscow";
  }
}
