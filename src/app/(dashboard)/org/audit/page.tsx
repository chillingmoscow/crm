import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadAuditFeedPage } from "@/lib/audit/feed";
import { listAccountStaff } from "@/lib/audit/search-staff";
import { AuditPageClient } from "./_components/audit-page-client";

/**
 * Общий журнал событий аккаунта. Доступ — permission `org.view_audit`
 * (миграция 035 §RLS). URL-driven фильтры:
 *   ?q                — общий поиск (имя сотрудника / должность /
 *                       email приглашения / название KB-страницы)
 *   ?types=staff,invitation,role,kb_page — разделы (csv)
 *   ?staff=<uuid,…>   — конкретные сотрудники (как объект ИЛИ исполнитель)
 *   ?from / ?to       — диапазон дат (YYYY-MM-DD)
 *   ?date_preset      — лейбл пресета («Текущая неделя», …)
 *   ?before_at,?before_id — keyset-курсор пагинации (для shareable URL)
 *
 * Логика фильтров инкапсулирована в `loadAuditFeedPage` —
 * та же функция используется кнопкой «Загрузить ещё» из клиента.
 */
export default async function OrgAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    types?: string;
    staff?: string;
    from?: string;
    to?: string;
    date_preset?: string;
    before_at?: string;
    before_id?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "org.view_audit",
  });
  if (!canView) redirect("/");

  const [{ events, hasMore, error }, staffOptions] = await Promise.all([
    loadAuditFeedPage({
      q: sp.q,
      types: sp.types,
      staff: sp.staff,
      from: sp.from,
      to: sp.to,
      beforeAt: sp.before_at,
      beforeId: sp.before_id,
    }),
    listAccountStaff(),
  ]);

  return (
    <AuditPageClient
      events={events}
      hasMore={hasMore}
      error={error}
      staffOptions={staffOptions}
    />
  );
}
