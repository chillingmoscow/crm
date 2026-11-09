import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadSchedule } from "./actions";
import { ScheduleClient } from "./_components/schedule-client";
import { loadCalendarTasks } from "./tasks/actions";
import { addDays, weekStart } from "@/lib/schedule/utils";
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; showTasks?: string; date?: string; view?: string }>;
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
  const showTasks = params.showTasks === "1";
  const week = initialDate ? weekStart(initialDate) : null;
  const [data, calendarTasks] = await Promise.all([
    loadSchedule(),
    showTasks
      ? loadCalendarTasks(week ? { from: week, to: addDays(week, 6) } : undefined).catch(() => null)
      : null,
  ]);
  return (
    <ScheduleClient
      key={data.venueId}
      initial={data}
      initialCalendarTasks={calendarTasks}
      initialShowTasks={params.showTasks === undefined ? undefined : showTasks}
      initialDate={initialDate}
      initialView={params.view === "templates" ? "templates" : undefined}
    />
  );
}
