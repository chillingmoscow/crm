import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";
import { loadAuditFeedPage } from "@/lib/audit/feed";
import { listAccountStaff } from "@/lib/audit/search-staff";
import { AuditPageClient } from "./_components/audit-page-client";

export const metadata: Metadata = { title: "Журнал событий" };

/**
 * Общий журнал событий аккаунта. Доступ — permission `org.view_audit`
 * (миграция 035 §RLS). URL-driven фильтры:
 *   ?q                — общий поиск (сотрудник, должность, email
 *                       приглашения, страница базы знаний, счёт, …)
 *   ?sections=payroll,finance — разделы журнала (модули, см. AUDIT_MODULES)
 *   ?types=kb_page    — типы объекта; фильтра в интерфейсе нет, ставят
 *                       ссылки из модулей (журнал базы знаний, переносов)
 *   ?actions=created  — категории действия
 *   ?staff=<uuid,…>   — конкретные сотрудники (как объект ИЛИ исполнитель)
 *   ?from / ?to       — диапазон дат (YYYY-MM-DD, сутки заведения)
 *   ?date_preset      — лейбл пресета («Текущая неделя», …)
 *
 * Логика фильтров инкапсулирована в `loadAuditFeedPage` — та же функция
 * используется кнопкой «Показать события старее» из клиента.
 */
export default async function OrgAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sections?: string;
    types?: string;
    actions?: string;
    staff?: string;
    from?: string;
    to?: string;
    date_preset?: string;
  }>;
}) {
  const sp = await searchParams;
  const can = await getCachedPermissionChecker();
  if (!can("org.view_audit")) redirect("/");
  const canRestoreKb = can("kb.delete_pages");

  const timeZone = await activeVenueTimeZone();
  const [{ events, hasMore, error }, staffOptions] = await Promise.all([
    loadAuditFeedPage({
      q: sp.q,
      sections: sp.sections,
      types: sp.types,
      actions: sp.actions,
      staff: sp.staff,
      from: sp.from,
      to: sp.to,
      timeZone,
    }),
    listAccountStaff(),
  ]);

  return (
    <AuditPageClient
      events={events}
      hasMore={hasMore}
      error={error}
      staffOptions={staffOptions}
      canRestoreKb={Boolean(canRestoreKb)}
      timeZone={timeZone}
    />
  );
}

/** Часовой пояс активного заведения: в нём лента делится на дни и
 *  показывается время. Без заведения — московское время, как у
 *  остальных разделов. */
async function activeVenueTimeZone(): Promise<string> {
  const supabase = await createClient();
  const { data: venueId } = await supabase.rpc("get_active_venue_id");
  if (!venueId) return "Europe/Moscow";
  const { data } = await supabase
    .from("venues")
    .select("timezone")
    .eq("id", venueId)
    .maybeSingle();
  return data?.timezone || "Europe/Moscow";
}
