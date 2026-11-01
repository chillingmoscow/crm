import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadSupplies } from "./actions";
import { SuppliesClient } from "./supplies-client";
import type { SupplyFilters } from "@/lib/supplies/types";
import { supplyCalendarDate } from "@/lib/supplies/source";
export default async function SuppliesPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("finance.view_transactions"))
    return (
      <div className="p-6 text-muted-foreground">Нет доступа к поставкам.</div>
    );
  let filters: SupplyFilters = {
    month: new Date().toISOString().slice(0, 7),
    search: "",
    paid: "",
    provider: null,
    store: null,
    missing: false,
    page: 0,
    size: 25,
    sort: "date",
    desc: true,
  };
  let data = await loadSupplies(filters);
  const current = supplyCalendarDate(
    new Date().toISOString(),
    data.timezone,
  ).slice(0, 7);
  const selected = data.months.includes(current)
    ? current
    : (data.months.filter((m) => m <= current).at(-1) ?? current);
  if (selected !== filters.month) {
    filters = { ...filters, month: selected };
    data = await loadSupplies(filters, data.venueId);
  }
  return (
    <SuppliesClient
      key={data.venueId}
      initial={data}
      initialFilters={filters}
    />
  );
}
