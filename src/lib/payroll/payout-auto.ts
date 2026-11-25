import "server-only";
import { createHash } from "node:crypto";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { businessDate } from "@/lib/sales/time";
import { autoIssueDecision, autoIssuedReportText, autoReportText } from "./payout-issue";
import {
  buildPreview,
  executeCashIssue,
  payoutAudit,
  sendIssueMessage,
  type MessageState,
  type PlanRecord,
  type VenueHandle,
} from "./payout-engine";
import { loadVenuePayoutData } from "./payout-source";

// Автовыдача по утверждённому плану: раз в день (14:00 по Москве, cron на хосте)
// для заведений, где она включена в «Графике выплат», — кассы, распределение,
// проведение с кэшбокса, сообщение менеджерам. Без пользователя: выплаты и
// журнал пишутся от «Системы». Всё, что требует внимания человека, уходит
// отчётом в чат отчётов; если и он не дошёл — маршрут отвечает 500, и это
// видно в логе хоста.
//
// Выключатель на весь сервер: PAYROLL_PAYOUT_AUTO=off.

export type AutoPlanResult = {
  venueId: string;
  planId?: string;
  outcome: "skipped" | "already" | "issued" | "reported" | "error";
  total?: number;
  reason?: string;
  messageState?: MessageState;
  /** Нужно внимание человека (не ушло сообщение, нет дня, отчёт о сбое). */
  attention: boolean;
  /** Отчёт о том, что требует внимания, дошёл до чата отчётов. */
  reportSent?: boolean;
};

/** Один ключ на план и день: повторный запуск в тот же день не проведёт второй раз. */
export function dayKey(planId: string, day: string): string {
  const h = createHash("md5").update(`payout-auto:${planId}:${day}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function report(s: VenueHandle, text: string): Promise<boolean> {
  try {
    const bot = await loadTelegramBot(s.admin, s.accountId);
    if (!bot?.reportsChatId) {
      console.error(`[payroll-payout-auto] ${s.venueId}: не настроен чат отчётов, отчёт не отправлен:\n${text}`);
      return false;
    }
    const sent = await bot.sendMessage(bot.reportsChatId, text);
    if (!sent.ok) console.error(`[payroll-payout-auto] ${s.venueId}: отчёт не дошёл (${sent.description ?? "Telegram"}):\n${text}`);
    return sent.ok;
  } catch (e) {
    console.error(`[payroll-payout-auto] ${s.venueId}: отчёт не отправлен:\n${text}`, e);
    return false;
  }
}

async function runPlan(s: VenueHandle, data: Awaited<ReturnType<typeof loadVenuePayoutData>>, plan: PlanRecord, today: string, venueName: string): Promise<AutoPlanResult> {
  const base = { venueId: s.venueId, planId: plan.id };
  const key = dayKey(plan.id, today);
  // Повтор в тот же день: выдача уже проведена — только дослать сообщение, если не ушло.
  const existing = await s.admin
    .from<{ id: string; message: string | null }>("payroll_payout_issues")
    .select("id,message")
    .eq("venue_id", s.venueId)
    .eq("request_key", key)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const chat = (await s.admin.from<{ chat_id: string | null }>("payroll_payout_settings").select("chat_id")
      .eq("account_id", s.accountId).eq("venue_id", s.venueId).maybeSingle()).data?.chat_id ?? null;
    const messageState = await sendIssueMessage(s, existing.data.id, chat).catch(() => "failed" as const);
    if (messageState !== "failed") return { ...base, outcome: "already", messageState, attention: false };
    const text = autoIssuedReportText(today, { messageFailed: true, message: existing.data.message ?? "", notMoved: [], movedSchedule: [] });
    return { ...base, outcome: "already", messageState, attention: true, reportSent: text ? await report(s, text) : false };
  }

  const preview = await buildPreview(s, data, plan.id);
  const decision = autoIssueDecision(preview);
  if (decision === "skip") {
    if (!preview.movedSchedule.length) return { ...base, outcome: "skipped", attention: false };
    const text = autoIssuedReportText(today, { messageFailed: false, message: "", notMoved: [], movedSchedule: preview.movedSchedule });
    return { ...base, outcome: "skipped", attention: true, reportSent: text ? await report(s, text) : false };
  }
  if (decision === "report") {
    const waiting = [...preview.short.map((r) => r.name), ...preview.lines.map((l) => l.name)];
    await payoutAudit(s, null, "payroll.payout_plan.auto_failed", plan.id, {
      month: plan.month,
      business_date: today,
      reason: preview.problem,
      waiting,
      moved_schedule: preview.movedSchedule,
    });
    const text = [autoReportText(venueName, today, preview.problem ?? "", waiting),
      preview.movedSchedule.length ? `На другом графике выплат, по плану не выдано: ${preview.movedSchedule.join(", ")}.` : null]
      .filter(Boolean).join("\n");
    return { ...base, outcome: "reported", reason: preview.problem ?? undefined, attention: true, reportSent: await report(s, text) };
  }

  const result = await executeCashIssue(s, preview, key, null, async (input) => {
    const r = await s.admin.rpc("payroll_payout_issue_system", {
      p_account: s.accountId,
      p_venue: s.venueId,
      p_input: input,
    });
    if (r.error) throw new Error(r.error.message);
    return r.data as string;
  });
  // Дальше деньги уже записаны: всё, что требует человека, — отчётом, не ошибкой.
  const text = autoIssuedReportText(today, {
    messageFailed: result.messageState === "failed",
    message: preview.message,
    notMoved: result.notMoved,
    movedSchedule: preview.movedSchedule,
  });
  return {
    ...base,
    outcome: "issued",
    total: preview.lines.reduce((sum, l) => sum + l.amount, 0),
    messageState: result.messageState,
    attention: !!text,
    reportSent: text ? await report(s, text) : undefined,
  };
}

export async function runPayoutAuto(now = new Date()): Promise<AutoPlanResult[]> {
  if (process.env.PAYROLL_PAYOUT_AUTO === "off") return [];
  const admin = asLooseDb(createAdminClient());
  const enabled = await admin
    .from<{ account_id: string; venue_id: string }[]>("payroll_payout_settings")
    .select("account_id,venue_id")
    .eq("auto_issue", true);
  if (enabled.error) throw new Error(enabled.error.message);
  const ids = (enabled.data ?? []).map((v) => v.venue_id);
  const live = ids.length
    ? await admin.from<{ id: string; name: string }[]>("venues").select("id,name").in("id", ids).is("archived_at", null)
    : { data: [], error: null };
  if (live.error) throw new Error(live.error.message);
  const names = new Map((live.data ?? []).map((v) => [v.id, v.name]));
  const results: AutoPlanResult[] = [];
  // Заведения в архиве не трогаем.
  for (const v of (enabled.data ?? []).filter((x) => names.has(x.venue_id))) {
    const s: VenueHandle = { db: admin, admin, accountId: v.account_id, venueId: v.venue_id };
    const venueName = names.get(v.venue_id) ?? "заведение";
    let data: Awaited<ReturnType<typeof loadVenuePayoutData>>;
    let plans: PlanRecord[];
    let today: string;
    try {
      data = await loadVenuePayoutData(admin, v.account_id, v.venue_id);
      today = businessDate(now, data.timezone, data.dayStartHour);
      const r = await admin
        .from<PlanRecord[]>("payroll_payout_plans")
        .select("id,schedule,month,payout_no,window_from,window_to,state,version")
        .eq("account_id", v.account_id)
        .eq("venue_id", v.venue_id)
        .eq("schedule", "main")
        .eq("state", "approved")
        .lte("window_from", today)
        .gte("window_to", today);
      if (r.error) throw new Error(r.error.message);
      plans = r.data ?? [];
    } catch (e) {
      const reason = e instanceof Error ? e.message : "неизвестная ошибка";
      console.error(`[payroll-payout-auto] ${v.venue_id}: ${reason}`);
      const sent = await report(s, `Зарплата, ${venueName}: автовыдача по плану не запустилась: ${reason}. Выдайте вручную кнопкой «Выдать сейчас».`);
      results.push({ venueId: v.venue_id, outcome: "error", reason, attention: true, reportSent: sent });
      continue;
    }
    // Каждый план — отдельно: сбой одного не мешает остальным.
    for (const plan of plans) {
      try {
        results.push(await runPlan(s, data, plan, today, venueName));
      } catch (e) {
        // Сюда попадают только сбои ДО проведения (после него — отчётом в runPlan).
        const reason = e instanceof Error ? e.message : "неизвестная ошибка";
        console.error(`[payroll-payout-auto] ${v.venue_id}/${plan.id}: ${reason}`);
        const sent = await report(s, `Зарплата, ${venueName}: автовыдача по плану не проведена: ${reason}. Выдайте вручную кнопкой «Выдать сейчас».`);
        results.push({ venueId: v.venue_id, planId: plan.id, outcome: "error", reason, attention: true, reportSent: sent });
      }
    }
  }
  return results;
}
