import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadAdditional } from "./actions";
import { AdditionalClient } from "./additional-client";
export default async function AdditionalPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return (
      <div className="px-6 py-12 text-muted-foreground">
        Нет доступа к допродажам.
      </div>
    );
  const data = await loadAdditional();
  return <AdditionalClient key={data.venueId} initial={data} />;
}
