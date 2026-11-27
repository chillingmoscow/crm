import "server-only";

import { getKbRequiredUnreadForUser } from "@/lib/knowledge/landing";
import { payrollMonthRange } from "@/lib/payroll/month-range";
import type { TaskOccurrence } from "@/lib/schedule/tasks";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

import { getHomeContext } from "./context";
import { addDaysIso } from "./today";

export type MyShift = { id: string; title: string | null; startsAt: string; endsAt: string };
export type MyTask = {
  id: string;
  title: string;
  businessDay: string;
  status: TaskOccurrence["status"];
  deadlineAt: string | null;
};
export type MyReading = { id: string; slug: string; title: string; icon: string | null; iconColor: string | null };

/** Задачи, которые ждут действий самого сотрудника. */
const OPEN_TASK = ["assigned", "in_progress", "returned"] as const;

/** Ближайшие опубликованные смены сотрудника, начиная с идущей. */
export async function loadMyShifts(limit = 5): Promise<MyShift[]> {
  const ctx = await getHomeContext();
  if (!ctx) return [];
  const db = asLooseDb(await createClient());
  const { data, error } = await db
    .from<{ id: string; title: string | null; starts_at: string; ends_at: string }[]>("schedule_shifts")
    .select("id,title,starts_at,ends_at")
    .eq("venue_id", ctx.venueId)
    .eq("user_id", ctx.userId)
    .eq("published", true)
    .gte("ends_at", new Date().toISOString())
    .order("starts_at")
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ id: s.id, title: s.title, startsAt: s.starts_at, endsAt: s.ends_at }));
}

/**
 * Начислено сотруднику за текущий месяц заведения: зарплата по сменам и
 * доплаты (без чаевых) и отдельно чаевые. `null` — сотрудник не заведён в
 * «Зарплате» этого заведения.
 */
export async function loadMyAccrued(): Promise<{ /** «2026-11» */ month: string; salary: number; tips: number; shifts: number } | null> {
  const ctx = await getHomeContext();
  if (!ctx) return null;
  const db = asLooseDb(await createClient());
  const employee = await db
    .from<{ id: string }[]>("payroll_employees")
    .select("id")
    .eq("venue_id", ctx.venueId)
    .eq("local_user_id", ctx.userId)
    .limit(1);
  if (employee.error) throw new Error(employee.error.message);
  const id = employee.data?.[0]?.id;
  if (!id) return null;
  const month = ctx.businessDay.slice(0, 7);
  const range = payrollMonthRange(month);
  const { data, error } = await db
    .from<{ salary: number; tips: number; calculation_snapshot: { kind?: string } | null }[]>("payroll_accruals")
    .select("salary,tips,calculation_snapshot")
    .eq("venue_id", ctx.venueId)
    .eq("employee_id", id)
    .gte("business_date", range.from)
    .lt("business_date", range.until);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    month,
    salary: Math.round(rows.reduce((s, r) => s + Number(r.salary), 0) * 100) / 100,
    tips: Math.round(rows.reduce((s, r) => s + Number(r.tips), 0) * 100) / 100,
    shifts: rows.filter((r) => !["monthly", "adjustment"].includes(String(r.calculation_snapshot?.kind))).length,
  };
}

/** Открытые задачи сотрудника за неделю назад и неделю вперёд. */
export async function loadMyTasks(limit = 5): Promise<MyTask[]> {
  const ctx = await getHomeContext();
  if (!ctx) return [];
  const db = asLooseDb(await createClient());
  const { data, error } = await db
    .from<Pick<TaskOccurrence, "id" | "business_date" | "status" | "deadline_at" | "snapshot">[]>(
      "schedule_task_occurrences",
    )
    .select("id,business_date,status,deadline_at,snapshot")
    .eq("venue_id", ctx.venueId)
    .eq("user_id", ctx.userId)
    .in("status", [...OPEN_TASK])
    .gte("business_date", addDaysIso(ctx.businessDay, -7))
    .lte("business_date", addDaysIso(ctx.businessDay, 7))
    .order("business_date")
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({
    id: t.id,
    title: t.snapshot?.name?.trim() || "Задача",
    businessDay: t.business_date,
    status: t.status,
    deadlineAt: t.deadline_at,
  }));
}

/** Обязательное чтение, которое сотрудник ещё не прочитал (или его попросили перечитать). */
export async function loadMyReading(): Promise<{ rows: MyReading[]; error: boolean }> {
  const { rows, error } = await getKbRequiredUnreadForUser();
  return {
    rows: rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title || "Без названия", icon: r.icon ?? null, iconColor: r.icon_color ?? null })),
    error: !!error,
  };
}
