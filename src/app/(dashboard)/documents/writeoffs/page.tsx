import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
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
  const initial = unwrapAction(await loadWriteoffs());
  // Строка удержания за текущий месяц — с сервера, чтобы таблица не уезжала
  // вниз, когда она догрузится. Права проверяет само действие; сбой —
  // клиент запросит сам.
  const month = `${initial.currentMonth}-01`;
  const deduction =
    initial.connected &&
    (initial.permissions.includes("inventory.post_deductions") ||
      initial.permissions.includes("payroll.view"))
      ? await loadWriteoffDeduction(initial.venueId, month)
          .then(unwrapAction)
          .then((r) => ({ month, visible: r.visible, posted: r.posted }))
          .catch(() => undefined)
      : undefined;
  return <WriteoffsClient key={initial.venueId} initial={initial} initialDeduction={deduction} />;
}
