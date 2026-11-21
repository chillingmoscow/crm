import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadSales } from "./actions";
import { ShiftsClient } from "./_components/shifts-client";
import { validDate } from "@/lib/sales/time";
import { loadDayArchive } from "../day-actions";
import { SalesNoAccess } from "../_components/sales-no-access";

export const metadata: Metadata = { title: "Смены" };

const TABS = ["values", "employees", "comments", "history"];

export default async function SalesShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    from?: string;
    to?: string;
    day?: string;
    tab?: string;
    source?: string;
  }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return <SalesNoAccess page="Смены" />;
  const query = await searchParams;
  // Период страницы — месяц. Старые ссылки с `from`/`to` и ссылки на день
  // открывают месяц, в который они попадают.
  const day =
    typeof query.day === "string" && validDate(query.day) ? query.day : null;
  const initialMonth =
    typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
      ? query.month
      : day
        ? day.slice(0, 7)
        : typeof query.from === "string" && validDate(query.from)
          ? query.from.slice(0, 7)
          : undefined;
  const initial = await loadSales(initialMonth ?? "current");
  const selection = day
    ? {
        date: day,
        tab: TABS.includes(query.tab ?? "") ? query.tab! : "values",
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
      selection={selection}
      selectedArchive={archive}
    />
  );
}
