import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadSales } from "./actions";
import { ShiftsClient } from "./_components/shifts-client";
import { validDate } from "@/lib/sales/time";
import { loadDayArchive } from "../day-actions";
export default async function SalesShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    day?: string;
    tab?: string;
    source?: string;
  }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return (
      <div className="px-6 py-12 text-muted-foreground">
        Нет доступа к сменам. Обратитесь к владельцу аккаунта.
      </div>
    );
  const query = await searchParams;
  const initialRange =
    typeof query.from === "string" &&
    typeof query.to === "string" &&
    validDate(query.from) &&
    validDate(query.to) &&
    query.from <= query.to
      ? { from: query.from, to: query.to }
      : undefined;
  const initial = await loadSales();
  const selection =
    typeof query.day === "string" && validDate(query.day)
      ? {
          date: query.day,
          tab: ["values", "employees", "comments", "history"].includes(
            query.tab ?? "",
          )
            ? query.tab!
            : "values",
          source:
            query.source === "archive"
              ? ("archive" as const)
              : ("native" as const),
        }
      : undefined;
  const archive =
    selection &&
    (selection.source === "archive" ||
      !initial.days.some((d) => d.business_date === selection.date))
      ? await loadDayArchive(initial.venueId, selection.date)
      : null;
  return (
    <ShiftsClient
      key={initial.venueId}
      initial={initial}
      initialRange={initialRange}
      selection={selection}
      selectedArchive={archive}
    />
  );
}
