import { readOverviewOpen } from "@/lib/ui/overview-pref-server";
import { OVERVIEW_KEYS } from "@/lib/ui/overview-pref";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { unwrapAction } from "@/lib/actions/result";
import { loadAdditional, loadUpsellRanking } from "./actions";
import { additionalLatestMonth } from "@/lib/sales/additional-month";
import { AdditionalClient } from "./additional-client";
import { SalesNoAccess } from "../_components/sales-no-access";

export const metadata: Metadata = { title: "Допродажи" };

export default async function AdditionalPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return <SalesNoAccess page="Допродажи" />;
  const [data, overviewOpen] = await Promise.all([
    loadAdditional().then(unwrapAction),
    readOverviewOpen(OVERVIEW_KEYS.salesAdditional),
  ]);
  // Рейтинг в «Обзоре» — с сервера: иначе скелетон сменялся списком другой
  // высоты, и таблица под ним уезжала. Сбой — карточка догрузит сама.
  const ranking =
    overviewOpen === false
      ? undefined
      : await loadUpsellRanking(data.venueId, additionalLatestMonth(data))
          .then(unwrapAction)
          .catch(() => undefined);
  return (
    <AdditionalClient
      key={data.venueId}
      initial={data}
      initialOverviewOpen={overviewOpen}
      initialRanking={ranking}
    />
  );
}
