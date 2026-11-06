import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { loadSchedule } from "../actions";
import { ScheduleClient } from "../_components/schedule-client";

export default async function TemplatesPage() {
  if (!(await getCachedUser())) redirect("/login");
  const data = await loadSchedule();
  if (
    ![
      "template_create",
      "template_edit",
      "template_copy",
      "template_archive",
      "shift_create",
    ].some((p) => data.permissions.includes(`schedule.${p}`))
  )
    redirect("/schedule");
  return (
    <ScheduleClient key={data.venueId} initial={data} section="templates" />
  );
}
