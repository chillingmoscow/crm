import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import { PageFrame } from "@/components/shared/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { loadSupplies } from "./actions";
import { SuppliesClient } from "./supplies-client";
import type { SupplyFilters } from "@/lib/supplies/types";
import { supplyCalendarDate } from "@/lib/supplies/source";

export const metadata: Metadata = { title: "Приходные накладные" };

export default async function SuppliesPage() {
  if (!(await getCachedUser())) redirect("/login");
  // Накладные связаны с расходами — видят те, кто видит операции финансов.
  if (!(await getCachedPermissionChecker())("finance.view_transactions"))
    return (
      <PageFrame>
        <EmptyState
          icon={Lock}
          title="Нет доступа к приходным накладным"
          description="Накладные видят сотрудники с правом смотреть операции в финансах"
        />
      </PageFrame>
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
  const [first, amountRoundingScale] = await Promise.all([
    loadSupplies(filters),
    getActiveAccountAmountRoundingScale(),
  ]);
  let data = first;
  // Открываем текущий месяц заведения, а если в нём накладных нет — последний
  // месяц с накладными до него.
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
      amountRoundingScale={amountRoundingScale}
    />
  );
}
