import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadSales } from "./actions";
import { ShiftsClient } from "./_components/shifts-client";
import { validDate } from "@/lib/sales/time";
export default async function SalesShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
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
  return (
    <ShiftsClient initial={await loadSales()} initialRange={initialRange} />
  );
}
