import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadStatistics } from "./actions";
import { StatisticsClient } from "./statistics-client";
import { SalesNoAccess } from "../_components/sales-no-access";

export const metadata: Metadata = { title: "Статистика продаж" };

export default async function SalesStatisticsPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return <SalesNoAccess page="Статистика" />;
  const initial = await loadStatistics();
  return <StatisticsClient key={initial.venueId} initial={initial} />;
}
