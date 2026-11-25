import "server-only";
import { createHash } from "node:crypto";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { businessDate } from "@/lib/sales/time";
import { autoIssueDecision, autoReportText } from "./payout-issue";
import { buildPreview, executeCashIssue, payoutAudit, type PlanRecord, type VenueHandle } from "./payout-engine";
import { loadVenuePayoutData } from "./payout-source";

// Автовыдача по утверждённому плану: раз в день (14:00, cron на хосте) для
// каждого заведения с настройками графика выплат — кассы, распределение,
// проведение с кэшбокса, сообщение менеджерам. Без пользователя: выплаты и
// журнал пишутся от «Системы». Не вышло — короткий отчёт в чат отчётов.

export type AutoVenueResult = {
  venueId: string;
  outcome: "skipped" | "issued" | "reported" | "error";
  total?: number;
  reason?: string;
};

/** Один ключ на план и день: повторный запуск в тот же день не проведёт второй раз. */
function dayKey(planId: string, day: string): string {
  const h = createHash("md5").update(`payout-auto:${planId}:${day}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function report(s: VenueHandle, text: string) {
  try {
    const bot = await loadTelegramBot(s.admin, s.accountId);
    if (bot?.reportsChatId) await bot.sendMessage(bot.reportsChatId, text);
  } catch (e) {
    console.error("[payroll-payout-auto] отчёт не отправлен", e);
  }
}

export async function runPayoutAuto(now = new Date()): Promise<AutoVenueResult[]> {
  const admin = asLooseDb(createAdminClient());
  const venues = await admin
    .from<{ account_id: string; venue_id: string }[]>("payroll_payout_settings")
    .select("account_id,venue_id");
  if (venues.error) throw new Error(venues.error.message);
  const results: AutoVenueResult[] = [];
  for (const v of venues.data ?? []) {
    const s: VenueHandle = { db: admin, admin, accountId: v.account_id, venueId: v.venue_id };
    try {
      const data = await loadVenuePayoutData(admin, v.account_id, v.venue_id);
      const today = businessDate(now, data.timezone, data.dayStartHour);
      const plans = await admin
        .from<PlanRecord[]>("payroll_payout_plans")
        .select("id,schedule,month,payout_no,window_from,window_to,state,version")
        .eq("account_id", v.account_id)
        .eq("venue_id", v.venue_id)
        .eq("schedule", "main")
        .eq("state", "approved")
        .lte("window_from", today)
        .gte("window_to", today);
      if (plans.error) throw new Error(plans.error.message);
      for (const plan of plans.data ?? []) {
        const preview = await buildPreview(s, data, plan.id);
        const decision = autoIssueDecision(preview);
        if (decision === "skip") {
          results.push({ venueId: v.venue_id, outcome: "skipped" });
          continue;
        }
        if (decision === "report") {
          const venue = await admin.from<{ name: string }>("venues").select("name").eq("id", v.venue_id).single();
          const waiting = preview.short.map((r) => r.name);
          await report(s, autoReportText(venue.data?.name ?? "заведение", today, preview.problem ?? "", waiting));
          await payoutAudit(s, null, "payroll.payout_plan.auto_failed", plan.id, {
            month: plan.month,
            business_date: today,
            reason: preview.problem,
            waiting,
          });
          results.push({ venueId: v.venue_id, outcome: "reported", reason: preview.problem ?? undefined });
          continue;
        }
        const result = await executeCashIssue(s, preview, dayKey(plan.id, today), null, async (input) => {
          const r = await admin.rpc("payroll_payout_issue_system", {
            p_account: v.account_id,
            p_venue: v.venue_id,
            p_input: input,
          });
          if (r.error) throw new Error(r.error.message);
          return r.data as string;
        });
        if (result.messageState === "failed" || result.notMoved.length) {
          const lines = [
            `Зарплата ${today.slice(8, 10)}.${today.slice(5, 7)}: выдача проведена.`,
            result.messageState === "failed" ? `Сообщение менеджерам не ушло, отправьте сами:\n${preview.message}` : null,
            result.notMoved.length ? `Нет следующей смены в окне, выберите день в плане: ${result.notMoved.join(", ")}.` : null,
          ];
          await report(s, lines.filter(Boolean).join("\n"));
        }
        results.push({
          venueId: v.venue_id,
          outcome: "issued",
          total: preview.lines.reduce((sum, l) => sum + l.amount, 0),
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "неизвестная ошибка";
      console.error(`[payroll-payout-auto] ${v.venue_id}: ${reason}`);
      await report(s, `Зарплата: автовыдача по плану упала с ошибкой: ${reason}. Выдайте вручную кнопкой «Выдать сейчас».`);
      results.push({ venueId: v.venue_id, outcome: "error", reason });
    }
  }
  return results;
}
