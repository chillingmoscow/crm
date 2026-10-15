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
      timeZone,
      count: 10000,
    });
    if (!Array.isArray(result.ds) || result.ds.length >= 10000)
      throw new Error(`Неполный отчёт продаж ${vid}`);
    return result;
  };
  const masters = await report(140),
    bar = await report(175),
    cocktails = await report(227);
  return {
    attendance,
    cashbox,
    masters,
    bar,
    cocktails,
    synced_at: new Date().toISOString(),
    timezone,
    timeZone,
    window,
    date,
  };
}
export function extraBonuses(masters: PayrollResponse, bar: PayrollResponse) {
  const top = masters.ds.map((r) => r.object).filter((r) => r._Level === 0);
  const qty = (name: string) =>
    top
      .filter((r) => r._branch === name)
      .reduce((s, r) => s + Number(r.saleAmount ?? 0), 0);
  const points =
    qty("Премиальный табак") * 0.5 +
    qty("Дегустация") * 1.25 +
    qty("Эксклюзивные кальяны") * 2;
  const masterBonus =
    Math.floor(points) *
    (points >= 9 ? 300 : points >= 6 ? 225 : points >= 3 ? 150 : 0);
  const branchRates: Record<string, number> = {
    "Премиальный чай": 100,
    "Ягоды и фрукты": 20,
    Добавки: 20,
    "Сиропы к кофе": 20,
    Пюре: 20,
    Виски: 100,
    Ром: 100,
    Джин: 100,
    "Прочее / Алкоголь": 100,
    "Мескаль / Текила": 100,
    "По бокалам": 100,
    "Белые вина": 600,
    "Игристые вина": 600,
    "Красные вина": 600,
    "Розовые вина": 600,
    "Фирменные коктейли": 180,
    Настойки: 20,
    "Сет настоек": 200,
    "Лимонад (бокал)": 20,
    "Лимонад (графин)": 100,
    "Лимонад-конструктор": 100,
    "Авторский чай": 100,
    "Коктейль-конструктор": 220,
  };
  const barBonus = bar.ds.reduce(
    (s, r) =>
      s +
      (branchRates[String(r.object._branch)] ?? 0) *
        Number(r.object.saleAmount ?? 0),
    0,
  );
  return {
    masters: Math.round(masterBonus),
    bar: Math.round(barBonus),
    masterPoints: points,
  };
}
