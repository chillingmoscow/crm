import "server-only";

import { asLooseDb } from "@/lib/supabase/loose";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";

// Карточки выплат зарплаты в очереди «На разбор» (план выплат, этап 3,
// миграция 408): выдача не сошлась с изъятием, не хватило наличных, автовыдача
// не прошла, сообщение менеджерам не ушло, выплата переводом не внесена,
// перенос остатка ждёт. Заводит их сервер; здесь — только открытые карточки
// активного заведения. Читает RLS (payroll.pay в активном заведении).

export type PayoutAlertItem = {
  id: string;
  kind: "reconcile" | "short" | "carry" | "transfer" | "failed" | "message";
  title: string;
  lines: string[];
  copy_text: string | null;
  business_date: string | null;
  created_at: string;
};

const KINDS = new Set<PayoutAlertItem["kind"]>(["reconcile", "short", "carry", "transfer", "failed", "message"]);

type PgError = { message: string; code?: string } | null;

/** Таблицы ещё нет: приложение выкатили раньше миграции 408. */
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /payroll_payout_alerts/.test(error.message);
}

async function canSee(): Promise<boolean> {
  const can = await getCachedPermissionChecker();
  return can("payroll.pay");
}

export async function loadPayoutAlerts(): Promise<{ items: PayoutAlertItem[]; error: string | null }> {
  if (!(await canSee())) return { items: [], error: null };
  const supabase = await createClient();
  const [{ data: venueId }, alerts] = await Promise.all([
    supabase.rpc("get_active_venue_id"),
    asLooseDb(supabase)
      .from<{ venue_id: string; id: string; kind: string; title: string; lines: unknown; copy_text: string | null; business_date: string | null; created_at: string }[]>("payroll_payout_alerts")
      .select("id, venue_id, kind, title, lines, copy_text, business_date, created_at")
      .eq("status", "open")
      .order("created_at")
      .limit(200),
  ]);
  if (alerts.error) {
    if (isMissingTable(alerts.error)) {
      console.warn(`[payout-inbox] пропуск карточек выплат: ${alerts.error.message}`);
      return { items: [], error: null };
    }
    console.error(`[payout-inbox] list: ${alerts.error.message}`);
    return { items: [], error: "Не удалось загрузить карточки выплат зарплаты" };
  }
  const venue = typeof venueId === "string" ? venueId : null;
  // RLS отдаёт только активное заведение; фильтр — страховка от смены заведения между запросами.
  const items = (alerts.data ?? []).flatMap((a): PayoutAlertItem[] => {
    if (a.venue_id !== venue || !KINDS.has(a.kind as PayoutAlertItem["kind"])) return [];
    return [{
      id: a.id,
      kind: a.kind as PayoutAlertItem["kind"],
      title: a.title,
      lines: Array.isArray(a.lines) ? a.lines.filter((l): l is string => typeof l === "string") : [],
      copy_text: a.copy_text,
      business_date: a.business_date,
      created_at: a.created_at,
    }];
  });
  return { items, error: null };
}

/** Сколько карточек выплат ждут разбора — для счётчика «На разбор». */
export async function countPayoutAlerts(): Promise<number> {
  if (!(await canSee())) return 0;
  const supabase = await createClient();
  const { count, error } = await asLooseDb(supabase)
    .from("payroll_payout_alerts")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) {
    if (isMissingTable(error)) console.warn(`[payout-inbox] пропуск счётчика: ${error.message}`);
    else console.error(`[payout-inbox] count: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
