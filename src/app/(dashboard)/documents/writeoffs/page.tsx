import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadWriteoffs } from "./actions";
import { WriteoffsClient } from "./writeoffs-client";
export default async function WriteoffsPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("inventory.view_results"))
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Нет доступа к списаниям. Обратитесь к владельцу аккаунта.
      </div>
    );
  const initial = await loadWriteoffs();
  return <WriteoffsClient key={initial.venueId} initial={initial} />;
}
