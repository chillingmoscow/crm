"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, getCachedActiveAccountId, getCachedPermissions, getCachedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { actionResult } from "@/lib/actions/result";
import { loadMonthPlanView, loadPlanSummary, type MonthPlanView } from "@/lib/sales/plan-data";
import { parseSeasonIndex } from "@/lib/sales/seasonality";

// План месяца в «Статистике»: оборот и доля алкоголя, журнал цен, сезонность.
// Права и запись проверяет база (миграция 418); здесь — ввод и данные экрана.

const MONTH = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Проверьте месяц");

async function scope(write = false) {
  const client = await createClient();
  const [user, permissions, accountId, venue] = await Promise.all([
    getCachedUser(),
    getCachedPermissions(),
    getCachedActiveAccountId(),
    client.rpc("get_active_venue_id"),
  ]);
  if (!user) throw new Error("Войдите в аккаунт");
  if (!accountId || !venue.data) throw new Error("Выберите заведение");
  const canView = permissions.includes("sales.view_shifts") || permissions.includes("sales.plan");
  if (!canView || (write && !permissions.includes("sales.plan"))) throw new Error("Нет доступа к планам продаж");
  return {
    db: asLooseDb(client),
    venue: { admin: asLooseDb(createAdminClient()), accountId, venueId: venue.data as string, permissions },
  };
}

async function loadMonthPlanImpl(month: string): Promise<MonthPlanView> {
  const s = await scope();
  return loadMonthPlanView(s.venue, `${MONTH.parse(month)}-01`);
}

async function saveMonthPlanImpl(input: { month: string; turnover: number | null; alcoholShare: number | null }): Promise<MonthPlanView> {
  const s = await scope(true);
  const parsed = z.object({
    month: MONTH,
    turnover: z.number().finite().positive("План оборота должен быть больше нуля").lt(1e12, "Слишком большая сумма").nullable(),
    alcoholShare: z.number().finite().min(0.1, "Доля алкоголя — от 0,1 до 100%").max(100, "Доля алкоголя — от 0,1 до 100%").nullable(),
  }).parse(input);
  const month = `${parsed.month}-01`;
  // Снимок прогноза — с сервера, на момент утверждения; прогноз от плана не зависит,
  // поэтому после сохранения тот же экран отдаём с новыми цифрами плана.
  const before = await loadMonthPlanView(s.venue, month);
  const turnover = parsed.turnover === null ? null : Math.round(parsed.turnover * 100) / 100;
  const alcoholShare = parsed.alcoholShare === null ? null : Math.round(parsed.alcoholShare * 100) / 100;
  const r = await s.db.rpc("sales_month_plan_save", {
    p_month: month,
    p_input: {
      turnover,
      alcohol_share: alcoholShare,
      forecast: { turnover: before.turnover.forecast, alcohol_share: before.alcoholShare.forecast },
    },
  });
  if (r.error) throw new Error(r.error.message);
  // Карточку «План продаж не задан» закрываем сразу, не дожидаясь утренней проверки
  // (если KPI долю не требуют, а её нет, утренняя проверка решит сама).
  if (turnover !== null && alcoholShare !== null) {
    const now = new Date().toISOString();
    const closed = await s.venue.admin.from("payroll_payout_alerts")
      .update({ status: "resolved", resolved_by: null, resolved_at: now, updated_at: now })
      .eq("account_id", s.venue.accountId).eq("venue_id", s.venue.venueId)
      .eq("kind", "sales_plan").eq("key", month).eq("status", "open");
    if (closed.error) console.error(`[sales-plan] карточка плана не закрыта: ${closed.error.message}`);
  }
  revalidatePath("/sales/statistics");
  revalidatePath("/sales/shifts");
  revalidatePath("/finance/inbox");
  return {
    ...before,
    turnover: { ...before.turnover, plan: turnover },
    alcoholShare: { ...before.alcoholShare, plan: alcoholShare },
  };
}

async function savePriceChangeImpl(input: { month: string; date: string; percent: number; note: string }): Promise<MonthPlanView> {
  const s = await scope(true);
  const parsed = z.object({
    month: MONTH,
    date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/, "Проверьте дату"),
    percent: z.number().finite().min(-50, "Изменение цен — от −50 до 100%").max(100, "Изменение цен — от −50 до 100%").refine((v) => v !== 0, "Изменение цен не может быть нулём"),
    note: z.string().trim().max(300, "Комментарий — до 300 символов"),
  }).parse(input);
  const r = await s.db.rpc("sales_price_change_save", { p_input: { date: parsed.date, percent: parsed.percent, note: parsed.note } });
  if (r.error) throw new Error(r.error.message);
  return loadMonthPlanView(s.venue, `${parsed.month}-01`);
}

async function deletePriceChangeImpl(month: string, id: string): Promise<MonthPlanView> {
  const s = await scope(true);
  const r = await s.db.rpc("sales_price_change_delete", { p_id: z.string().uuid().parse(id) });
  if (r.error) throw new Error(r.error.message);
  return loadMonthPlanView(s.venue, `${MONTH.parse(month)}-01`);
}

async function saveSeasonalityImpl(month: string, index: number[] | null): Promise<MonthPlanView> {
  const s = await scope(true);
  const r = await s.db.rpc("sales_seasonality_save", { p_index: index === null ? null : parseSeasonIndex(index) });
  if (r.error) throw new Error(r.error.message);
  return loadMonthPlanView(s.venue, `${MONTH.parse(month)}-01`);
}

async function loadPlanSummaryImpl() {
  const s = await scope();
  return loadPlanSummary(s.venue);
}

// Действия возвращают ошибку текстом, а не исключением (см. lib/actions/result).
export async function loadMonthPlan(month: string) {
  return actionResult(() => loadMonthPlanImpl(month), "Не удалось загрузить план месяца");
}
export async function saveMonthPlan(input: { month: string; turnover: number | null; alcoholShare: number | null }) {
  return actionResult(() => saveMonthPlanImpl(input), "Не удалось сохранить план месяца");
}
export async function savePriceChange(input: { month: string; date: string; percent: number; note: string }) {
  return actionResult(() => savePriceChangeImpl(input), "Не удалось сохранить изменение цен");
}
export async function deletePriceChange(month: string, id: string) {
  return actionResult(() => deletePriceChangeImpl(month, id), "Не удалось удалить изменение цен");
}
export async function saveSeasonality(month: string, index: number[] | null) {
  return actionResult(() => saveSeasonalityImpl(month, index), "Не удалось сохранить сезонность");
}
export async function loadPlanSummaryAction() {
  return actionResult(() => loadPlanSummaryImpl(), "Не удалось загрузить планы");
}
