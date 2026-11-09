import { redirect } from "next/navigation";
import { getCachedPermissions, getCachedUser } from "@/lib/supabase/server";
import { ScheduleTasksTab } from "../_components/tasks-tab";
import { loadTasks } from "./actions";

export default async function TasksPage() {
  const [user, permissions] = await Promise.all([
    getCachedUser(),
    getCachedPermissions(),
  ]);
  if (!user) redirect("/login");
  if (
    ![
      "schedule.view_all",
      "schedule.checklist_create",
      "schedule.checklist_edit",
    ].some((p) => permissions.includes(p))
  )
    redirect("/schedule?showTasks=1");
  const tasks = await loadTasks();
  return <ScheduleTasksTab key={tasks.venueId} initial={tasks} />;
}
