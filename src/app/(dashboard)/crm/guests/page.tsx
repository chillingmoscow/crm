import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { PageFrame } from "@/components/shared/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadGuests } from "./actions";
import { GuestsClient } from "./guests-client";

export const metadata: Metadata = { title: "Гости" };

export default async function GuestsPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("crm.view_guests"))
    return (
      <PageFrame>
        <EmptyState
          icon={Lock}
          title="Нет доступа к гостям"
          description="Попросите владельца аккаунта выдать доступ"
        />
      </PageFrame>
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
