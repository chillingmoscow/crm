import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadGuests } from "./actions";
import { GuestsClient } from "./guests-client";
export default async function GuestsPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("crm.view_guests"))
    return (
      <div className="p-6 text-muted-foreground">Нет доступа к гостям.</div>
    );
  const data = await loadGuests({
    search: "",
    group: "",
    birthday: "",
    archived: false,
    page: 0,
    size: 25,
    sort: "name",
    desc: false,
  });
  return <GuestsClient key={data.venueId} initial={data} />;
}
