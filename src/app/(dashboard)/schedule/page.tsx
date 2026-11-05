import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadSchedule } from "./actions";
import { ScheduleClient } from "./_components/schedule-client";
import { loadTasks } from "./tasks/actions";
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
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
  return (
    <ScheduleClient
      key={data.venueId}
      initial={data}
      initialTab={initialTab}
      initialTasks={tasks}
    />
  );
}
