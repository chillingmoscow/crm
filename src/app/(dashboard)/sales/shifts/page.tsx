import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadSales } from "./actions";
import { ShiftsClient } from "./_components/shifts-client";
export default async function SalesShiftsPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return (
      <div className="px-6 py-12 text-muted-foreground">
        Нет доступа к сменам. Обратитесь к владельцу аккаунта.
      </div>
    );
  return <ShiftsClient initial={await loadSales()} />;
}
