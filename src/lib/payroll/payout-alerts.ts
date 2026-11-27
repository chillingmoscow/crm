import "server-only";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import type { AlertText } from "./payout-alert-text";
import type { VenueHandle } from "./payout-engine";

// Карточки «Финансы → На разбор» по выплатам зарплаты (миграция 408). Заводит
// и закрывает их только сервер (service_role): автовыдача, утренняя сверка,
// автоперенос. Одна карточка на (заведение, вид, ключ): закрытая «Всё верно»
// не откроется снова, даже если причина повторится в тот же день.
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
    return (r.data ?? []).length > 0 ? "created" : "exists";
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

/** Причина ушла сама (изъятие нашлось, выплату внесли, перенос прошёл) — закрыть открытую карточку. */
export async function closeAlert(s: VenueHandle, kind: PayoutAlertKind, key: string): Promise<void> {
  const r = await s.admin
    .from("payroll_payout_alerts")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("kind", kind)
    .eq("key", key)
    .eq("status", "open");
  if (r.error) console.error(`[payroll-payout-alert] ${s.venueId}/${kind}: карточка не закрыта (${r.error.message})`);
}
