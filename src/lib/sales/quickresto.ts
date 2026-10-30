import "server-only";
import {
  callQuickRestoBackOfficeData,
  quickRestoFetch,
} from "@/lib/integrations/quickresto/client";
import {
  getConnection,
  withBackOfficeSession,
  type QuickRestoConnection,
} from "@/app/(dashboard)/inventory/actions-shared";
import { decryptSecret } from "@/lib/integrations/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { dayWindow, addDays } from "./time";
import type { SalesSettings } from "./types";
import { salesRead, SalesRateLimitError } from "./rate-limit";

export { getConnection };
export function salesSource(
  connection: QuickRestoConnection,
  settings: SalesSettings,
  date: string,
  snapshotAt?: string,
) {
  const window = dayWindow(date, settings.timezone, settings.day_start_hour);
  if (snapshotAt) window.end = Math.min(window.end, Date.parse(snapshotAt));
  const admin = asLooseDb(createAdminClient());
  let backOfficeLayer = connection.login;
  if (connection.backoffice_base_url) {
    const origin = new URL(connection.backoffice_base_url);
    if (
      origin.protocol !== "https:" ||
      !/^[-a-z0-9]+\.quickresto\.ru$/.test(origin.hostname)
    )
      throw new Error("Некорректный адрес бэк-офиса Quick Resto");
    backOfficeLayer = origin.hostname.split(".")[0];
  }
  const publicRead = async (
    module: string,
    id?: number,
    filters?: unknown[],
  ) => {
    const password = decryptSecret({
      encrypted: connection.password_encrypted,
      iv: connection.password_iv,
      tag: connection.password_tag,
    });
    const q = new URLSearchParams({ moduleName: module });
    if (id !== undefined) q.set("objectId", String(id));
    const response = await salesRead(settings.account_id, () =>
      quickRestoFetch(
        `https://${connection.login}.quickresto.ru/platform/online/api/${id === undefined ? "list" : "read"}?${q}`,
        {
          method: filters ? "POST" : "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${connection.login}:${password}`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: filters ? JSON.stringify({ filters }) : undefined,
        },
      ),
    );
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const delay =
        raw && /^\d+$/.test(raw)
          ? Number(raw) * 1000
          : raw
            ? Date.parse(raw) - Date.now()
            : 60000;
      throw new SalesRateLimitError(
        Number.isFinite(delay)
          ? Math.max(30000, Math.min(delay, 15 * 60000))
          : 60000,
      );
    }
    if (!response.ok)
      throw new Error(`Quick Resto: ошибка чтения (${response.status})`);
    return response.json();
  };
  const backRead = (
    path: string,
    query: Record<string, string | number | (string | number)[]>,
  ) =>
    salesRead(settings.account_id, () =>
      withBackOfficeSession({
        connection,
        admin,
        run: (authorization) =>
          callQuickRestoBackOfficeData<Record<string, unknown>>({
            layerName: backOfficeLayer,
            authorization,
            path,
            query,
          }),
      }),
    );
  return {
    orders: (start: number) =>
      backRead("front.orders.orderinfoweb/select", {
        start,
        count: 150,
        "filterField[]": ["createDate", "createDate", "returned"],
        "filterOperator[]": ["range", "range", "eq"],
        "filterValue[]": [window.start, window.end, "false"],
        businessDayOffsetInMs: settings.day_start_hour * 3600000,
        timeZone: 0,
      }),
    staff: (start: number) =>
      backRead("report.datasources.bonuses/select", {
        vid: 29,
        mode: "allTime",
        start,
        count: 500,
        businessDayOffsetInMs: settings.day_start_hour * 3600000,
        timeZone: 0,
      }),
    detail: (id: number) =>
      publicRead("front.orders", id) as Promise<Record<string, unknown>>,
    zList: () =>
      publicRead("front.zreport", undefined, [
        {
          field: "localOpenedTime",
          operation: "range",
          value: { since: date, till: addDays(date, 1) },
        },
      ]) as Promise<Record<string, unknown>[]>,
    zDetail: (id: number) =>
      publicRead("front.zreport", id) as Promise<Record<string, unknown>>,
    hookah: () =>
      backRead("report.datasources.sales/select", {
        vid: settings.hookah_report_id,
        mode: "dateFilter",
        "extParams[className]": "DateFilter",
        "extParams[dateRange][start]": window.start,
        "extParams[dateRange][end]": window.end,
        "extParams[dateFrom]": window.start,
        "extParams[dateTo]": window.end,
        businessDayOffsetInMs: settings.day_start_hour * 3600000,
        timeZone: 0,
      }),
    statisticsReport: (
      reportId: number,
      range: { start: number; end: number },
    ) => {
      if (
        !Number.isSafeInteger(reportId) ||
        reportId <= 0 ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start >= range.end
      )
        throw new Error("Проверьте источник и период отчёта");
      return backRead("report.datasources.sales/select", {
        vid: reportId,
        mode: "dateFilter",
        "extParams[className]": "DateFilter",
        "extParams[dateRange][start]": range.start,
        "extParams[dateRange][end]": range.end,
        "extParams[dateFrom]": range.start,
        "extParams[dateTo]": range.end,
        businessDayOffsetInMs: settings.day_start_hour * 3600000,
        timeZone: 0,
      });
    },
    taxi: () =>
      publicRead("front.encashment", undefined, [
        {
          field: "serverRegisterTime",
          operation: "range",
          value: {
            // QR interprets these wall-clock hours literally despite the Z suffix.
            since: `${date}T${String(settings.day_start_hour).padStart(2, "0")}:00:00.000Z`,
            till: `${addDays(date, 1)}T06:00:00.000Z`,
          },
        },
      ]) as Promise<Record<string, unknown>[]>,
  };
}
