import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadSchedule, loadShiftAttendance } from "./actions";
import { unwrapAction } from "@/lib/actions/result";
import { ScheduleClient } from "./_components/schedule-client";
import { loadCalendarTasks } from "./tasks/actions";
import { loadAttendanceAttention } from "@/app/(dashboard)/people/payroll/actions";
import { attentionKey, type AttentionSnapshot } from "@/lib/payroll/attention-snapshot";
import { addDays, dateInZone, weekStart } from "@/lib/schedule/utils";
import { readSchedulePrefs } from "@/lib/schedule/view-pref-server";

export const metadata: Metadata = { title: "Расписание" };
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; showTasks?: string; date?: string; view?: string; swap?: string; task?: string }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  const params = await searchParams;
  if (params.tab === "tasks") redirect("/schedule/tasks");
  if (params.tab === "templates") redirect("/schedule/templates");
  if (params.tab === "team") redirect("/people/staff");
  if (params.tab) redirect("/schedule");
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? new Date(params.date + "T00:00:00Z")
    : null;
  const initialDate =
    parsedDate &&
    Number.isFinite(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === params.date
      ? params.date
      : undefined;
  const urlTasks = params.showTasks === undefined ? undefined : params.showTasks === "1";
  const pinnedWeek = initialDate ? weekStart(initialDate) : null;
  const tasksRange = (week: string) => ({ from: week, to: addDays(week, 6) });
  const loadTasks = (week: string) =>
    loadCalendarTasks(tasksRange(week)).then(unwrapAction).catch(() => null);
  // Задачи по `?showTasks=1` с известной неделей — вместе с расписанием.
  const [data, urlTasksData] = await Promise.all([
    loadSchedule().then(unwrapAction),
    urlTasks && pinnedWeek ? loadTasks(pinnedWeek) : null,
  ]);
  // Всё, от чего зависит раскладка сетки, — до первой разметки, вторым
  // шагом (нужны пояс заведения и права): иначе страница появлялась, а потом
  // перестраивалась — подставлялся запомненный вид, приезжали задачи,
  // значки отметок у смен и уведомление «ждут проверки».
  const now = Date.now();
  const today = dateInZone(new Date(now), data.timezone);
  const week = pinnedWeek ?? weekStart(today);
  const prefs = await readSchedulePrefs(data.venueId, data.userId);
  const canPlan = data.permissions.includes("schedule.view_all");
  const showTasks = urlTasks ?? prefs.showTasks ?? !canPlan;
  const canViewAttendance = canPlan && data.permissions.includes("payroll.view");
  const attentionMonths = [today.slice(0, 7), week.slice(0, 7), addDays(week, 6).slice(0, 7)];
  const [calendarTasks, attendance, attention] = await Promise.all([
    urlTasksData ?? (showTasks ? loadTasks(week) : null),
    canViewAttendance
      ? loadShiftAttendance(week).then(unwrapAction).then((marks) => ({ week, marks })).catch(() => null)
      : null,
    canViewAttendance
      ? loadAttendanceAttention(attentionMonths)
          .then(unwrapAction)
          .then((items): AttentionSnapshot => ({ key: attentionKey(attentionMonths), items }))
          .catch(() => undefined)
      : undefined,
  ]);
  return (
    <ScheduleClient
      key={data.venueId}
      initial={data}
      initialCalendarTasks={calendarTasks}
      initialShowTasks={urlTasks}
      initialPrefs={prefs}
      initialAttendance={attendance}
      initialAttention={attention}
      initialNow={now}
      initialDate={initialDate}
      initialSwap={/^[0-9a-f-]{36}$/i.test(params.swap ?? "") ? params.swap : undefined}
      initialTask={urlTasks && /^[0-9a-f-]{36}$/i.test(params.task ?? "") ? params.task : undefined}
      initialView={
        params.view === "templates" || params.view === "list" || params.view === "week"
          ? params.view
          : undefined
      }
    />
  );
}
