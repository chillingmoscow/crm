import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lock, Settings2 } from "lucide-react";
import { z } from "zod";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { ProfileHeader } from "@/components/shared/profile-header";
import { EmptyState } from "@/components/ui/empty-state";
import { loadSalesConfiguration } from "../shifts/actions";
import { SalesNoAccess } from "../_components/sales-no-access";
import { SalesSettingsTab } from "./_components/sales-settings-tab";

export const metadata: Metadata = { title: "Настройки продаж" };

const crumbs = [
  { label: "Продажи" },
  { label: "Смены", href: "/sales/shifts" },
  { label: "Настройки продаж" },
];

/**
 * Настройки продаж заведения: расчёт смен, пересчёт истории, сверка
 * поступлений, контроль кассы, инкассации, проведение операций. Раньше
 * жили вкладкой карточки заведения. `?venue=` — другое заведение аккаунта
 * (ссылки из карточки), без него — активное.
 */
export default async function SalesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  const can = await getCachedPermissionChecker();
  if (!can("sales.view_shifts") || !can("sales.configure_shifts"))
    return <SalesNoAccess page="Настройки продаж" />;
  const { venue } = await searchParams;
  let venueId = z.string().uuid().safeParse(venue).success ? venue! : null;
  if (!venueId) {
    const active = await (await createClient()).rpc("get_active_venue_id");
    venueId = typeof active.data === "string" ? active.data : null;
  }
  const configuration = venueId
    ? await loadSalesConfiguration(venueId).then((r) => (r.ok ? r.data : null))
    : null;
  if (!configuration)
    return (
      <ProfilePageFrame>
        <Breadcrumbs items={crumbs} />
        <EmptyState
          icon={Lock}
          title="Настройки продаж недоступны"
          description="Настройки продаж меняет владелец аккаунта. Проверьте, что выбрано нужное заведение"
        />
      </ProfilePageFrame>
    );
  return (
    <ProfilePageFrame>
      <Breadcrumbs items={crumbs} />
      <ProfileHeader
        name="Настройки продаж"
        avatar={
          <div
            aria-hidden
            className="flex size-14 items-center justify-center rounded-[14px] bg-muted text-muted-foreground"
          >
            <Settings2 className="size-7" />
          </div>
        }
      >
        <span className="text-sm text-muted-foreground">
          {configuration.venueName}
        </span>
      </ProfileHeader>
      <SalesSettingsTab key={configuration.venueId} initial={configuration} />
    </ProfilePageFrame>
  );
}
