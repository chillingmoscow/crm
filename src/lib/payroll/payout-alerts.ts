import "server-only";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import type { AlertText } from "./payout-alert-text";
import type { VenueHandle } from "./payout-engine";

// Карточки «Финансы → На разбор» по выплатам зарплаты (миграция 409). Заводит
// и закрывает их сам только сервер (service_role): автовыдача, утренняя сверка,
// автоперенос. Одна карточка на (заведение, вид, ключ): закрытая «Всё верно»
// не откроется снова, даже если причина повторится.
//
// Сбой карточки не роняет выдачу или сверку: деньги уже записаны, а о
// проблеме параллельно пишет чат отчётов. В лог — только вид и заведение.

export type PayoutAlertKind = "reconcile" | "short" | "carry" | "transfer" | "failed" | "message";

export async function raiseAlert(
  s: VenueHandle,
  alert: AlertText & {
    kind: PayoutAlertKind;
    key: string;
    planId?: string | null;
    businessDate?: string | null;
    copyText?: string | null;
  },
): Promise<"created" | "exists" | "failed"> {
  try {
    const r = await s.admin.from<{ id: string }[]>("payroll_payout_alerts").upsert(
      {
        account_id: s.accountId,
        venue_id: s.venueId,
        kind: alert.kind,
        key: alert.key.slice(0, 200),
        plan_id: alert.planId ?? null,
        business_date: alert.businessDate ?? null,
        title: alert.title.slice(0, 300),
        lines: alert.lines,
        copy_text: alert.copyText ? alert.copyText.slice(0, 4000) : null,
      },
      { onConflict: "venue_id,kind,key", ignoreDuplicates: true },
    ).select("id");
    if (r.error) throw new Error(r.error.message);
    // При конфликте ignoreDuplicates строку не возвращает: карточка уже была.
    if ((r.data ?? []).length > 0) return "created";
    // Была и закрылась сама (без автора), а причина вернулась — открыть снова.
    const now = new Date().toISOString();
    const reopened = await s.admin
      .from<{ id: string }[]>("payroll_payout_alerts")
      .update({
        status: "open",
        resolved_at: null,
        updated_at: now,
        title: alert.title.slice(0, 300),
        lines: alert.lines,
        copy_text: alert.copyText ? alert.copyText.slice(0, 4000) : null,
      })
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .eq("kind", alert.kind)
      .eq("key", alert.key.slice(0, 200))
      .eq("status", "resolved")
      .is("resolved_by", null)
      .select("id");
    if (reopened.error) throw new Error(reopened.error.message);
    if ((reopened.data ?? []).length > 0) return "created";
    // Открытая карточка — освежить текст: причины переноса и «изъято» меняются день ото дня.
    const refreshed = await s.admin
      .from("payroll_payout_alerts")
      .update({
        updated_at: now,
        title: alert.title.slice(0, 300),
        lines: alert.lines,
        copy_text: alert.copyText ? alert.copyText.slice(0, 4000) : null,
      })
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .eq("kind", alert.kind)
      .eq("key", alert.key.slice(0, 200))
      .eq("status", "open");
    if (refreshed.error) console.error(`[payroll-payout-alert] ${s.venueId}/${alert.kind}: текст карточки не обновлён (${refreshed.error.message})`);
    return "exists";
  } catch (e) {
    console.error(`[payroll-payout-alert] ${s.venueId}/${alert.kind}: карточка не заведена (${e instanceof Error ? e.message : "ошибка"})`);
    return "failed";
  }
}

/**
 * Отчёт в чат отчётов. В лог сервера пишем только заведение и причину сбоя
 * доставки: имена и суммы остаются в Telegram, не в логах.
 */
export async function reportToChat(s: VenueHandle, text: string): Promise<boolean> {
  try {
    const bot = await loadTelegramBot(s.admin, s.accountId);
    if (!bot?.reportsChatId) {
      console.error(`[payroll-payout] ${s.venueId}: не настроен чат отчётов, отчёт не отправлен`);
      return false;
    }
    const sent = await bot.sendMessage(bot.reportsChatId, text);
    if (!sent.ok) console.error(`[payroll-payout] ${s.venueId}: отчёт не дошёл (${sent.description ?? "Telegram"})`);
    return sent.ok;
  } catch {
    console.error(`[payroll-payout] ${s.venueId}: отчёт не отправлен (Telegram не ответил)`);
    return false;
  }
}

/**
 * Новая проблема: карточка в «На разбор» и сообщение в чат отчётов. Если
 * карточка уже была (вчера или раньше) — в чат повторно не пишем.
 * `seen` — человек об этом узнает: есть карточка или дошёл отчёт.
 */
export async function attention(
  s: VenueHandle,
  alert: Parameters<typeof raiseAlert>[1],
  chatText: string,
): Promise<{ seen: boolean; reportSent?: boolean }> {
  const raised = await raiseAlert(s, alert);
  if (raised === "exists") return { seen: true };
  const reportSent = await reportToChat(s, chatText);
  return { seen: raised === "created" || reportSent, reportSent };
}

/**
 * Причина ушла сама (изъятие нашлось, выплату внесли, перенос прошёл) —
 * закрыть открытую карточку без автора. Если причина вернётся (выплату
 * удалили), raiseAlert откроет её снова; закрытую человеком «Всё верно» — нет.
 */
export async function closeAlert(s: VenueHandle, kind: PayoutAlertKind, key: string): Promise<void> {
  const now = new Date().toISOString();
  const r = await s.admin
    .from("payroll_payout_alerts")
    .update({ status: "resolved", resolved_by: null, resolved_at: now, updated_at: now })
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("kind", kind)
    .eq("key", key)
    .eq("status", "open");
  if (r.error) console.error(`[payroll-payout-alert] ${s.venueId}/${kind}: карточка не закрыта (${r.error.message})`);
}

/** Закрыть открытые карточки плана этого вида, кроме `exceptKey` (причины сменились — старая карточка устарела). */
export async function closePlanAlerts(s: VenueHandle, kind: PayoutAlertKind, planId: string, exceptKey?: string): Promise<void> {
  const now = new Date().toISOString();
  let q = s.admin
    .from("payroll_payout_alerts")
    .update({ status: "resolved", resolved_by: null, resolved_at: now, updated_at: now })
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("kind", kind)
    .eq("plan_id", planId)
    .eq("status", "open");
  if (exceptKey) q = q.neq("key", exceptKey);
  const r = await q;
  if (r.error) console.error(`[payroll-payout-alert] ${s.venueId}/${kind}: карточки плана не закрыты (${r.error.message})`);
}
