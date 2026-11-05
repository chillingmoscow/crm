import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadTasks } from "./actions";
import { TasksClient } from "./tasks-client";
export default async function TasksPage() {
  if (!(await getCachedUser())) redirect("/login");
  return <TasksClient initial={await loadTasks()} />;
}
