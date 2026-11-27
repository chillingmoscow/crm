import "server-only";
import { cookies } from "next/headers";
import { parseSchedulePrefs, schedulePrefCookieName, type SchedulePrefs } from "./view-pref";

/** Выбор вида «Расписания» из cookie для серверной отрисовки. */
export async function readSchedulePrefs(venueId: string, userId: string): Promise<SchedulePrefs> {
  const store = await cookies();
  const read = (kind: "view" | "tasks" | "templateSort") =>
    store.get(schedulePrefCookieName(kind, venueId, userId))?.value;
  return parseSchedulePrefs({ view: read("view"), tasks: read("tasks"), templateSort: read("templateSort") });
}
