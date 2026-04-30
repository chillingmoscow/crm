import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities } from "@/lib/org/legal-entities";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { LegalEntitySwitcher } from "@/components/shared/legal-entity-switcher";

/**
 * Finance block shell. Gates the entire /finance/* tree on
 * `finance.view_dashboard` and renders the active-legal-entity
 * switcher in the header. The switcher hides itself when fewer
 * than 2 legal entities exist (nothing to switch).
 *
 * Note: the cookie scoping is *advisory* — RLS itself doesn't read
 * it. Pages that want to honour the user's chosen LE must call
 * getActiveFinanceLegalEntityId() and apply an `eq("legal_entity_id", …)`
 * filter to their queries.
 */
export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "finance.view_dashboard",
  });
  if (!canView) redirect("/dashboard");

  const [{ rows: legalEntities }, activeLegalEntityId] = await Promise.all([
    listLegalEntities(),
    getActiveFinanceLegalEntityId(),
  ]);

  return (
    <div className="flex flex-col w-full">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <h1 className="text-lg font-semibold">Финансы</h1>
        <LegalEntitySwitcher
          legalEntities={legalEntities}
          activeLegalEntityId={activeLegalEntityId}
        />
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
