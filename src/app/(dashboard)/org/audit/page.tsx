import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listAuditEvents } from "@/lib/audit/list";
import {
  listAccountStaff,
  searchAuditEntities,
} from "@/lib/audit/search-staff";
import { AuditPageClient } from "./_components/audit-page-client";

/**
 * Общий журнал событий аккаунта. Доступ — permission `org.view_audit`
 * (миграция 035 §RLS). URL-driven фильтры:
 *   ?q                — общий поиск (имя сотрудника / название KB-страницы)
 *   ?types=staff,kb_page — разделы (csv)
 *   ?staff=<uuid,…>   — конкретные сотрудники (csv)
 *   ?from / ?to       — диапазон дат (YYYY-MM-DD)
 *   ?date_preset      — лейбл пресета («Текущая неделя», …)
 *   ?before_at,?before_id — keyset-курсор пагинации
 *
 * Keyset-курсор: композитный (created_at, id) — cascade-инсерты могут
 * давать десятки rows с одинаковым created_at.
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

  const q = (sp.q ?? "").trim();
  const types = parseCsv(sp.types);
  const staffFilter = parseCsv(sp.staff);

  // Поиск резолвит подстроку в id-сеты для staff и kb_page.
  const search = q ? await searchAuditEntities(q) : null;

  // ── Логика match'инга персон ─────────────────────────────────
  // Сотрудник может быть в ряде audit_logs либо объектом действия
  // (entity_id когда entity_type='staff'), либо исполнителем
  // (user_id). Поэтому персонажи матчатся на ОБЕ позиции через
  // `.or(entity_id.in.(...),user_id.in.(...))`.
  //
  //   • staffFilter и search оба заданы → пересекаем сеты.
  //   • один из них → берём как есть.
  //   • ни один → персонажный фильтр не применяется.
  let personIds: string[] | null = null;
  if (staffFilter.length > 0 && search) {
    const set = new Set(search.staffIds);
    personIds = staffFilter.filter((id) => set.has(id));
  } else if (staffFilter.length > 0) {
    personIds = staffFilter;
  } else if (search) {
    personIds = search.staffIds;
  }

  // KB-pages — только entity match (нет понятия "actor по названию").
  const kbPageIds = search ? search.kbPageIds : [];

  // Если активен фильтр «Раздел», narrow персон/kb по выбранным типам.
  const includeStaff = types.length === 0 || types.includes("staff");
  const includeKb = types.length === 0 || types.includes("kb_page");

  // Финальные массивы для listAuditEvents:
  //   • entityIds = (personIds если включены staff) ∪ (kbPageIds если включены kb)
  //   • actorIds  = personIds (matches user_id любого ряда)
  //
  // Если ни staffFilter, ни search не дали персон/kb — не применяем
  // ни один из этих фильтров (undefined). Если дали, но включаемые
  // типы пусты — короткозамыкаем в [] чтобы получить пустой результат.
  let entityIds: string[] | undefined;
  let actorIds: string[] | undefined;
  if (personIds !== null || search) {
    const entityParts: string[] = [];
    if (personIds !== null && includeStaff) entityParts.push(...personIds);
    if (includeKb) entityParts.push(...kbPageIds);
    entityIds = entityParts;

    // actorIds применимы только если выбран раздел staff или раздел не
    // фильтрован. KB-события не имеют actor-name match'а.
    if (personIds !== null) {
      actorIds = includeStaff ? personIds : [];
    }
  }

  const entityTypes = types.length > 0 ? types : undefined;
  const fromDate = sp.from ? startOfDayISO(sp.from) : undefined;
  const toDate = sp.to ? endOfDayISO(sp.to) : undefined;

  const [{ events, hasMore, error }, staffOptions] = await Promise.all([
    listAuditEvents({
      entityTypes,
      entityIds,
      actorIds,
      fromDate,
      toDate,
      beforeCreatedAt: sp.before_at,
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

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "2026-05-13" → ISO начала локального дня. */
function startOfDayISO(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** "2026-05-13" → ISO начала следующего дня, чтобы `< toDate` включал
 *  весь выбранный день. */
function endOfDayISO(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}
