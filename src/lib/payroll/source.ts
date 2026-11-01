import "server-only";
import { callQuickRestoBackOfficeData } from "@/lib/integrations/quickresto/client";
import {
  getConnection,
  withBackOfficeSession,
} from "@/app/(dashboard)/inventory/actions-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { salesRead } from "@/lib/sales/rate-limit";
import { dayWindow, addDays } from "@/lib/sales/time";
import type { PaySettings } from "./types";
import { defaultAdditionalRules,type AdditionalRuleVersion } from "@/lib/sales/additional";
export type ObjectRow = { id?: number; [key: string]: unknown };
export type PayrollResponse = {
  ds: { type: string; object: ObjectRow }[];
  utilityData?: { totalCount?: number; aggregates?: Record<string, number> };
};
export async function readPayrollDay(
  settings: PaySettings,
  date: string,
  timezone: string,
  hour: number,
) {
  const connection = await getConnection(settings.account_id);
  if (!connection)
    throw new Error("Подключите Quick Resto в настройках заведения");
  const admin = asLooseDb(createAdminClient());
  const [extraSource, extraRule] = await Promise.all([
    admin.from<{masters_report_id:number;bar_report_id:number;cocktail_report_id:number}>("sales_additional_sources")
      .select("masters_report_id,bar_report_id,cocktail_report_id").eq("account_id",settings.account_id).eq("venue_id",settings.venue_id).maybeSingle(),
    admin.from<AdditionalRuleVersion>("sales_additional_rules").select("id,config,valid_from,created_at")
      .eq("account_id",settings.account_id).eq("venue_id",settings.venue_id).lte("valid_from",date)
      .order("valid_from",{ascending:false}).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(extraSource.error || extraRule.error) throw new Error("Не удалось получить правила допродаж");
  const window = dayWindow(date, timezone, hour);
  // QR shifts epochs according to the client's JS getTimezoneOffset. Sending the venue
  // offset yields real UTC instants which render exactly like the QR venue wall clock.
  const wall = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`),
    timeZone = (window.start - wall) / 60000;
  const read = (
    path: string,
    query: Record<string, string | number | (string | number)[]>,
  ): Promise<PayrollResponse> =>
    salesRead(settings.account_id, () =>
      withBackOfficeSession({
        connection,
        admin,
        run: (authorization) =>
          callQuickRestoBackOfficeData<PayrollResponse>({
            layerName: connection.login,
            baseUrl: connection.backoffice_base_url,
            authorization,
            path,
            query,
          }),
      }),
    );
  const list = async (path: string, field: string) => {
    const result: ObjectRow[] = [];
    const seen = new Set<number>();
    for (let start = 0; start < 20000; start += 500) {
      const response = await read(path, {
        start,
        count: 500,
        "filterField[]": [field, field],
        "filterOperator[]": ["range", "range"],
        "filterValue[]": [window.start, window.end - 1],
        timeZone,
        businessDayOffsetInMs: hour * 3600000,
      });
      if (!Array.isArray(response.ds))
        throw new Error("Quick Resto не вернул список записей");
      const page = response.ds
        .filter((r) => r.type === "item")
        .map((r) => r.object);
      for (const r of page) {
        if (!Number.isSafeInteger(r.id))
          throw new Error("Запись Quick Resto без ID");
        if (seen.has(r.id!)) throw new Error("Quick Resto повторил страницу");
        seen.add(r.id!);
        result.push(r);
      }
      if (page.length < 500) {
        return result.filter(
          (r) =>
            !r.deleted &&
            Number((r.tableScheme as { id: number })?.id) ===
              settings.quickresto_venue_id,
        );
      }
    }
    throw new Error("Превышен размер списка Quick Resto");
  };
  // Include sessions which began the previous business day: flag cross-boundary cases
  // instead of silently dropping a long/open attendance record.
  const attendanceResponse = await read("personnel.salary.workshift/select", {
    start: 0,
    count: 5000,
    "filterField[]": ["startTime", "startTime"],
    "filterOperator[]": ["range", "range"],
    "filterValue[]": [
      dayWindow(addDays(date, -1), timezone, hour).start,
      window.end - 1,
    ],
    timeZone,
  });
  if (
    !Array.isArray(attendanceResponse.ds) ||
    attendanceResponse.ds.length >= 5000
  )
    throw new Error("Неполный список персональных смен");
  const attendance = attendanceResponse.ds
    .filter((r) => r.type === "item")
    .map((r) => r.object)
    .filter(
      (r) =>
        Number((r.tableScheme as { id: number })?.id) ===
          settings.quickresto_venue_id &&
        ((Number(r.startTime) >= window.start &&
          Number(r.startTime) < window.end) ||
          !r.endTime ||
          Number(r.endTime) > window.start),
    );
  const cashbox = await list("front.encashment/select", "timeEncashment");
  const report = async (vid: number) => {
    const result = await read("report.datasources.sales/select", {
      vid,
      mode: "dateFilter",
      "extParams[className]": "DateFilter",
      "extParams[dateRange][start]": window.start,
      "extParams[dateRange][end]": window.end - 1,
      "extParams[dateFrom]": window.start,
      "extParams[dateTo]": window.end - 1,
      businessDayOffsetInMs: hour * 3600000,
      timeZone: 0,
      count: 10000,
    });
    if (!Array.isArray(result.ds) || result.ds.length >= 10000)
      throw new Error(`Неполный отчёт продаж ${vid}`);
    return result;
  };
  const masters = await report(extraSource.data?.masters_report_id ?? 140),
    bar = await report(extraSource.data?.bar_report_id ?? 175),
    cocktails = await report(extraSource.data?.cocktail_report_id ?? 227);
  return {
    attendance,
    cashbox,
    masters,
    bar,
    cocktails,
    additional_rules: extraRule.data?.config ?? defaultAdditionalRules,
    additional_rule_id: extraRule.data?.id ?? null,
    synced_at: new Date().toISOString(),
    timezone,
    timeZone,
    window,
    date,
  };
}
export { extraBonuses } from "@/lib/sales/additional";
