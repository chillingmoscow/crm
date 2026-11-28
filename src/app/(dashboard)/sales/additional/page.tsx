import { readOverviewOpen } from "@/lib/ui/overview-pref-server";
import { OVERVIEW_KEYS } from "@/lib/ui/overview-pref";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getCachedActiveVenueId,
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { dateInZone } from "@/lib/schedule/utils";
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
  const overviewOpen = await readOverviewOpen(OVERVIEW_KEYS.salesAdditional);
  // Рейтинг в «Обзоре» — с сервера: иначе скелетон сменялся списком другой
  // высоты, и таблица под ним уезжала. Грузим одной волной с данными, для
  // текущего месяца по Москве — обычно это и есть последний месяц с данными.
  // Не угадали (начало месяца, другой пояс) — догружаем нужный следом; сбой —
  // карточка догрузит сама. Свёрнутый «Обзор» рейтинг не грузит.
  const guess = dateInZone(new Date(), "Europe/Moscow").slice(0, 7);
  const ranking = (venueId: string, month: string) =>
    loadUpsellRanking(venueId, month)
      .then(unwrapAction)
      .catch(() => undefined);
  const [data, guessed] = await Promise.all([
    loadAdditional().then(unwrapAction),
    overviewOpen === false
      ? undefined
      : getCachedActiveVenueId().then((venueId) =>
          venueId ? ranking(venueId, guess).then((r) => (r ? { venueId, r } : undefined)) : undefined,
        ),
  ]);
  const month = additionalLatestMonth(data);
  // Без данных за месяц «Обзора» нет — и рейтинг не нужен.
  const hasData = data.reports.length + data.upsellDays.length > 0;
  const initialRanking =
    overviewOpen === false || !hasData
      ? undefined
      : guessed && guessed.venueId === data.venueId && guessed.r.month === month
        ? guessed.r
        : await ranking(data.venueId, month);
  return (
    <AdditionalClient
      key={data.venueId}
      initial={data}
      initialOverviewOpen={overviewOpen}
      initialRanking={initialRanking}
    />
  );
}
