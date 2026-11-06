import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadSchedule } from "./actions";
import { ScheduleClient } from "./_components/schedule-client";
import { loadTasks } from "./tasks/actions";
import { addDays, dateInZone, weekStart } from "@/lib/schedule/utils";
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; showTasks?: string; date?: string }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  const params = await searchParams;
  const initialTab = [
    "calendar",
    "tasks",
    "templates",
    "checklists",
    "review",
    "team",
  ].includes(params.tab ?? "")
    ? params.tab!
    : "calendar";
  const [data, tasks] = await Promise.all([
    loadSchedule(),
    initialTab === "tasks" ? loadTasks() : Promise.resolve(null),
  ]);
  if (
    initialTab === "tasks" &&
    ![
      "schedule.view_all",
      "schedule.checklist_create",
      "schedule.checklist_edit",
    ].some((permission) => data.permissions.includes(permission))
  )
    redirect("/schedule?showTasks=1");
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
  const week = weekStart(initialDate ?? dateInZone(new Date(), data.timezone));
  const calendarTasks =
    showTasks && initialTab === "calendar"
      ? await loadTasks({ from: week, to: addDays(week, 6) })
      : null;
  return (
    <ScheduleClient
      key={data.venueId}
      initial={data}
      initialTab={initialTab}
      initialTasks={tasks}
      initialCalendarTasks={calendarTasks}
      initialShowTasks={params.showTasks === undefined ? undefined : showTasks}
      initialDate={initialDate}
    />
  );
}
