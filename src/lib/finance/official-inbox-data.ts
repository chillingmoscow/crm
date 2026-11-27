import "server-only";

import { asLooseDb } from "@/lib/supabase/loose";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";
import {
  isOfficialReviewReason,
  type OfficialReviewItem,
  type OfficialReviewSettings,
} from "@/lib/payroll/official-review";
import type { PayrollData } from "@/lib/payroll/types";

// Официальная часть в очереди «На разбор»: месяцы, которые крон официальной
// зарплаты не провёл сам (payroll_official_months.status = 'review').
//
// Видимость — активное заведение. Читает RLS таблицы (payroll.view в активном
// заведении), а разбирают payroll_record_official_payment / payroll_official_skip,
// которые тоже работают только в активном заведении и требуют payroll.pay.
// Карточки других заведений здесь не показываются: разобрать их отсюда всё
// равно нельзя, а расширять RLS ради чтения не стали.

export type OfficialInbox = {
  items: OfficialReviewItem[];
  /** Расчётные счета в рублях, доступные заведению. */
  banks: PayrollData["banks"];
  settings: OfficialReviewSettings;
  venueId: string | null;
};

const EMPTY: OfficialInbox = { items: [], banks: [], settings: { payDay: 5, bankAccountId: null }, venueId: null };

type PgError = { message: string; code?: string } | null;

/**
 * Таблицы ещё нет: приложение выкатили раньше миграции 383. Очередь работает
 * без официальной части, в лог — предупреждение.
 */
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    /payroll_official_months|official_pay_day|official_bank_account_id/.test(error.message)
  );
}

/** Разбирать официальную часть может только тот, у кого есть право на выплаты. */
async function canSeeOfficial(): Promise<boolean> {
  const can = await getCachedPermissionChecker();
  return can("payroll.pay");
}

type MonthRow = {
  id: string;
  venue_id: string;
  employment_id: string;
  employee_id: string;
  month: string;
  kind: string;
  gross: number | string | null;
  reason: string | null;
};

const KINDS = new Set(["full", "first", "final"]);

export async function loadOfficialReview(): Promise<{ data: OfficialInbox; error: string | null }> {
  if (!(await canSeeOfficial())) return { data: EMPTY, error: null };
  const supabase = await createClient();
  const db = asLooseDb(supabase);
  const [{ data: venueId }, months] = await Promise.all([
    supabase.rpc("get_active_venue_id"),
    supabase
      .from("payroll_official_months")
      .select("id, venue_id, employment_id, employee_id, month, kind, gross, reason")
      .eq("status", "review")
      .order("month")
      .order("id"),
  ]);
  if (months.error) {
    if (isMissingTable(months.error)) {
      console.warn(`[official-inbox] пропуск официальной части: ${months.error.message}`);
      return { data: EMPTY, error: null };
    }
    console.error(`[official-inbox] list: ${months.error.message}`);
    return { data: EMPTY, error: "Не удалось загрузить официальные выплаты" };
  }
  const venue = typeof venueId === "string" ? venueId : null;
  // RLS отдаёт только активное заведение; фильтр — страховка от смены заведения между запросами.
  const rows = ((months.data ?? []) as MonthRow[]).filter((r) => r.venue_id === venue);
  if (!venue) return { data: EMPTY, error: null };

  const employeeIds = [...new Set(rows.map((r) => r.employee_id))];
  const employmentIds = [...new Set(rows.map((r) => r.employment_id))];
  const [employees, employments, settings, banks] = await Promise.all([
    employeeIds.length
      ? db
          .from<{ id: string; name: string; local_user_id: string | null }[]>("payroll_employees")
          .select("id, name, local_user_id")
          .in("id", employeeIds)
      : Promise.resolve({ data: [], error: null }),
    // «Платит агентство»: карточка проводит запись без счёта и налога.
    employmentIds.length
      ? db
          .from<{ id: string; agency: boolean | null }[]>("payroll_official_employments")
          .select("id, agency")
          .in("id", employmentIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from<{ official_pay_day: number | null; official_bank_account_id: string | null }>("payroll_settings")
      .select("official_pay_day, official_bank_account_id")
      .eq("venue_id", venue)
      .maybeSingle(),
    db
      .from<PayrollData["banks"]>("bank_accounts")
      .select("id, name, legal_entity_id, type")
      .eq("is_active", true)
      .is("deleted_at", null)
      .eq("currency", "RUB")
      .eq("type", "checking")
      .or(`venue_id.is.null,venue_id.eq.${venue}`)
      .order("name"),
  ]);
  for (const r of [employees, settings, banks]) {
    if (r.error) {
      console.error(`[official-inbox] list: ${r.error.message}`);
      return { data: EMPTY, error: "Не удалось загрузить официальные выплаты" };
    }
  }

  const byId = new Map((employees.data ?? []).map((e) => [e.id, e]));
  // До миграции 398 столбца agency нет: карточки — как обычные официальные.
  if (employments.error) console.warn(`[official-inbox] без признака «Платит агентство»: ${employments.error.message}`);
  const agencyIds = new Set(
    (employments.error ? [] : (employments.data ?? [])).filter((e) => e.agency === true).map((e) => e.id),
  );
  const items: OfficialReviewItem[] = rows.flatMap((r) => {
    if (!isOfficialReviewReason(r.reason)) return [];
    const employee = byId.get(r.employee_id);
    return [
      {
        id: r.id,
        venue_id: r.venue_id,
        employment_id: r.employment_id,
        employee_id: r.employee_id,
        employee_name: employee?.name ?? "Сотрудник",
        employee_user_id: employee?.local_user_id ?? null,
        month: r.month.slice(0, 10),
        kind: (KINDS.has(r.kind) ? r.kind : "full") as OfficialReviewItem["kind"],
        gross: r.gross === null ? null : Number(r.gross),
        reason: r.reason,
        agency: agencyIds.has(r.employment_id),
      },
    ];
  });

  return {
    data: {
      items,
      banks: banks.data ?? [],
      settings: {
        payDay: settings.data?.official_pay_day ?? 5,
        bankAccountId: settings.data?.official_bank_account_id ?? null,
      },
      venueId: venue,
    },
    error: null,
  };
}

/** Сколько официальных месяцев ждут разбора — для счётчика «На разбор». */
export async function countOfficialReview(): Promise<number> {
  if (!(await canSeeOfficial())) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("payroll_official_months")
    .select("id", { count: "exact", head: true })
    .eq("status", "review");
  if (error) {
    if (isMissingTable(error)) console.warn(`[official-inbox] пропуск счётчика: ${error.message}`);
    else console.error(`[official-inbox] count: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
