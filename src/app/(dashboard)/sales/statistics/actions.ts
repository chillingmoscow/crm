"use server";
import { z } from "zod";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { loadSales } from "../shifts/actions";
import type { SalesData } from "@/lib/sales/types";
import type { StatisticsReport } from "@/lib/sales/statistics-reports";
import type { StatisticsArchive } from "@/lib/sales/statistics-view";
import { processStatisticsReport } from "@/lib/sales/statistics-sync";
export type StatisticsData = SalesData & {
  reports: StatisticsReport[];
  reportsConfigured: boolean;
  archives: StatisticsArchive[];
};
export async function loadStatistics(): Promise<StatisticsData> {
  const data = await loadSales();
  const db = asLooseDb(await createClient());
  const [reports, config, archive] = await Promise.all([
    db
      .from<StatisticsReport[]>("sales_month_reports")
      .select(
        "id,venue_id,month,kind,metrics,period_start,period_end,through_date,synced_at,state,last_error",
      )
      .eq("venue_id", data.venueId)
      .order("month", { ascending: false })
      .order("kind")
      .range(0, 999),
    db
      .from<{ enabled: boolean }>("sales_statistics_sources")
      .select("enabled")
      .eq("venue_id", data.venueId)
      .maybeSingle(),
    db
      .from<StatisticsArchive[]>("sales_statistics_archive")
      .select(
        "id,venue_id,month,metrics,weekday_turnover,note,captured_at,origin",
      )
      .eq("venue_id", data.venueId)
      .order("month", { ascending: false })
      .order("captured_at", { ascending: false })
      .order("id")
      .range(0, 999),
  ]);
  if (reports.error || config.error || archive.error)
    throw new Error("Не удалось загрузить месячные отчёты");
  const allReports = reports.data ?? [];
  const archives = archive.data ?? [];
  for (let start = 1000; archives.length === start; start += 1000) {
    const next = await db
      .from<StatisticsArchive[]>("sales_statistics_archive")
      .select(
        "id,venue_id,month,metrics,weekday_turnover,note,captured_at,origin",
      )
      .eq("venue_id", data.venueId)
      .order("month", { ascending: false })
      .order("captured_at", { ascending: false })
      .order("id")
      .range(start, start + 999);
    if (next.error) throw new Error("Не удалось загрузить архив статистики");
    archives.push(...(next.data ?? []));
  }
  for (let start = 1000; allReports.length === start; start += 1000) {
    const next = await db
      .from<StatisticsReport[]>("sales_month_reports")
      .select(
        "id,venue_id,month,kind,metrics,period_start,period_end,through_date,synced_at,state,last_error",
      )
      .eq("venue_id", data.venueId)
      .order("month", { ascending: false })
      .order("kind")
      .range(start, start + 999);
    if (next.error) throw new Error("Не удалось загрузить все месячные отчёты");
    allReports.push(...(next.data ?? []));
  }
  const activeVenue = await db.rpc("get_active_venue_id");
  if (activeVenue.error || activeVenue.data !== data.venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  return {
    ...data,
    reports: allReports,
    reportsConfigured: config.data?.enabled ?? false,
    archives,
  };
}
export async function requestStatisticsMonth(month: string, venueId: string) {
  z.string().uuid().parse(venueId);
  z.string()
    .regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
    .parse(month);
  if (
    !(await getCachedPermissionChecker())("sales.sync_shifts") ||
    !(await getCachedActiveAccountId())
  )
    throw new Error("Нет доступа к обновлению статистики");
  const db = asLooseDb(await createClient());
  const venue = await db.rpc("get_active_venue_id");
  if (venue.error || !venue.data) throw new Error("Выберите заведение");
  if (venue.data !== venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  const r = await db.rpc("sales_request_month_reports", {
    p_month: month + "-01",
    p_expected_venue: venueId,
  });
  if (r.error) throw new Error(r.error.message);
  if (!r.data)
    throw new Error("В этом месяце пока нет завершённых рабочих дней");
  const started = Date.now();
  for (let i = 0; i < 3 && Date.now() - started < 8000; i++) {
    const next = await processStatisticsReport(String(venue.data));
    if (next.idle) break;
  }
  return Number(r.data);
}

export async function exportStatistics(
  venueId: string,
): Promise<StatisticsData> {
  z.string().uuid().parse(venueId);
  if (!(await getCachedPermissionChecker())("sales.export_shifts"))
    throw new Error("Нет доступа к экспорту статистики");
  const data = await loadStatistics();
  if (data.venueId !== venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  return data;
}
