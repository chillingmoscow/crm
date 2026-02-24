import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VenuesClient } from "./_components/venues-client";
import type { WorkingHours } from "@/types/database";

export type VenueRow = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  working_hours: WorkingHours | null;
};

export default async function VenuesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!account) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Заведения</h1>
        <p className="text-muted-foreground mt-2">
          Управление заведениями доступно только владельцу аккаунта.
        </p>
      </div>
    );
  }

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, type, address, phone, currency, timezone, working_hours")
    .eq("account_id", account.id)
    .order("name")
    .returns<VenueRow[]>();

  return <VenuesClient venues={venues ?? []} />;
}
