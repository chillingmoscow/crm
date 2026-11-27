import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import {
  getCachedActiveVenueId,
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { dateInZone } from "@/lib/schedule/utils";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { unwrapAction } from "@/lib/actions/result";
import { loadWriteoffDeduction, loadWriteoffs } from "./actions";
import { WriteoffsClient } from "./writeoffs-client";
export default async function WriteoffsPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("inventory.view_results"))
    return (
      <PageFrame>
        <Breadcrumbs items={[{ label: "Документы" }, { label: "Списания" }]} />
        <EmptyState
          icon={Lock}
          title="Нет доступа к списаниям"
          description="Обратитесь к владельцу аккаунта."
        />
      </PageFrame>
    );
  // Строка удержания за текущий месяц — с сервера, одной волной со списком,
  // чтобы таблица не уезжала вниз, когда она догрузится. Месяц — по Москве:
  // если у заведения он другой, клиент сверит и запросит сам. Права
  // проверяет само действие; сбой — клиент тоже запросит сам.
  const month = `${dateInZone(new Date(), "Europe/Moscow").slice(0, 7)}-01`;
  const [initialResult, deduction] = await Promise.all([
    loadWriteoffs(),
    getCachedActiveVenueId().then((venueId) =>
      venueId
        ? loadWriteoffDeduction(venueId, month)
            .then(unwrapAction)
            .then((r) => ({ venueId, month, visible: r.visible, posted: r.posted }))
            .catch(() => undefined)
        : undefined,
    ),
  ]);
  const initial = unwrapAction(initialResult);
  const initialDeduction =
    deduction && deduction.venueId === initial.venueId
      ? { month: deduction.month, visible: deduction.visible, posted: deduction.posted }
      : undefined;
  return <WriteoffsClient key={initial.venueId} initial={initial} initialDeduction={initialDeduction} />;
}
