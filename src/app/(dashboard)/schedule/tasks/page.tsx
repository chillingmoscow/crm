import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadSchedule } from "../actions";
import { ScheduleClient } from "../_components/schedule-client";
import { loadTasks } from "./actions";

export default async function TasksPage() {
  if (!(await getCachedUser())) redirect("/login");
  const data = await loadSchedule();
  if (
    ![
      "schedule.view_all",
      "schedule.checklist_create",
      "schedule.checklist_edit",
    ].some((p) => data.permissions.includes(p))
  )
    redirect("/schedule?showTasks=1");
  const tasks = await loadTasks();
  return (
    <ScheduleClient
      key={data.venueId}
      initial={data}
      section="tasks"
      initialTasks={tasks}
    />
  );
}
