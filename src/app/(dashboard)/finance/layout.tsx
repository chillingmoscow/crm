import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { listLegalEntities } from "@/lib/org/legal-entities";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { FinanceSectionHeader } from "./section-header";
import { LegalEntitySwitcher } from "@/components/shared/legal-entity-switcher";

/**
 * Finance block shell. Pages enforce their own permissions; payroll
 * also supports self access. Users with finance.view_dashboard see
 * the active-legal-entity switcher in the header. The switcher hides itself when fewer
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
  const can = await getCachedPermissionChecker();
  // Payroll has its own team/self permission boundary. Other finance pages
  // enforce their existing permissions before loading any data.
  if (!can("finance.view_dashboard")) return <>{children}</>;

  const [{ rows: legalEntities }, activeLegalEntityId] = await Promise.all([
    listLegalEntities(),
    getActiveFinanceLegalEntityId(),
  ]);

  return (
    <div className="flex flex-col w-full">
      <FinanceSectionHeader>
        <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
          <h1 className="text-lg font-semibold">Финансы</h1>
          <LegalEntitySwitcher
            legalEntities={legalEntities}
            activeLegalEntityId={activeLegalEntityId}
          />
        </div>
      </FinanceSectionHeader>
      <div className="flex-1">{children}</div>
    </div>
  );
}
