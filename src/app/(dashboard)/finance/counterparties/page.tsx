import { redirect } from "next/navigation";

import { getCachedPermissionChecker } from "@/lib/supabase/server";
import {
  listCounterparties,
  listCounterpartyGroups,
} from "@/lib/finance/counterparties";
import { CounterpartiesList } from "./_components/counterparties-list";

export default async function CounterpartiesPage() {
  // include_deleted гейтится на canManage — view-only пользователь не должен
  // получать soft-deleted строки в RSC-payload (спрятать их в UI мало: данные
  // видно в сетевом формате).
  const can = await getCachedPermissionChecker();
  const canView = can("finance.view_counterparties");
  const canManage = can("finance.manage_counterparties");
  if (!canView) redirect("/dashboard");

  // Подгружаем все строки видимые для роли (incl. archived если canManage),
  // чтобы посчитать archivedCount; live-список фильтрует в клиенте.
  const [{ rows: counterparties }, { rows: groups }] = await Promise.all([
    listCounterparties({ include_deleted: canManage }),
    listCounterpartyGroups(),
  ]);

  const archivedCount = counterparties.filter((cp) => cp.deleted_at).length;

  return (
    <CounterpartiesList
      counterparties={counterparties}
      groups={groups}
      canManage={!!canManage}
      archivedCount={archivedCount}
    />
  );
}
