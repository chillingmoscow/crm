import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadSchedule } from "./actions";
import { ScheduleClient } from "./_components/schedule-client";
export default async function SchedulePage() {
  if (!(await getCachedUser())) redirect("/login");
  const data = await loadSchedule();
  return <ScheduleClient initial={data} />;
}
