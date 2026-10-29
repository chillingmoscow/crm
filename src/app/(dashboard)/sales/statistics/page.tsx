import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadStatistics } from "./actions";
import { StatisticsClient } from "./statistics-client";

export default async function SalesStatisticsPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return (
      <div className="px-6 py-12 text-muted-foreground">
        Нет доступа к статистике продаж.
      </div>
    );
  return <StatisticsClient initial={await loadStatistics()} />;
}
