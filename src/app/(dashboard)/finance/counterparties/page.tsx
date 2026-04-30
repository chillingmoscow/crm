import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  listCounterparties,
  listCounterpartyGroups,
} from "@/lib/finance/counterparties";
import { CounterpartiesList } from "./_components/counterparties-list";

export default async function CounterpartiesPage() {
  const supabase = await createClient();

  // Resolve permissions in parallel so include_deleted is gated on
  // canManage — view-only users never receive soft-deleted rows in
  // the RSC payload (UI hiding alone leaks data via the wire format).
  const [{ data: canView }, { data: canManage }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "finance.view_counterparties" }),
    supabase.rpc("has_permission", { permission_code: "finance.manage_counterparties" }),
  ]);
  if (!canView) redirect("/dashboard");

  const [{ rows: counterparties }, { rows: groups }] = await Promise.all([
    listCounterparties({ include_deleted: !!canManage }),
    listCounterpartyGroups(),
  ]);

  return (
    <CounterpartiesList
      counterparties={counterparties}
      groups={groups}
      canManage={!!canManage}
    />
  );
}
