import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listAuditEvents, type AuditFilterGroup } from "@/lib/audit/list";
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

  // ── Сборка фильтр-групп ──────────────────────────────────────
  // staffFilter и search — independent constraint'ы, AND-комбинируются.
  // Пересекать их id-сеты нельзя: если q совпал только с KB-title и
  // не с именем staffFilter'а, intersect-подход обнулит staffFilter и
  // запрос вернёт чужие события (Codex P1 #2).
  //
  // Actor-match (`user_id ∈ persons`) применяется независимо от
  // entity_type — сотрудник может быть автором события любого раздела,
  // включая KB. Раньше я обнулял actorIds при types=kb_page → KB-события,
  // сделанные сотрудником, не находились (Codex P1 #1).
  const filterGroups: AuditFilterGroup[] = [];

  // Группа 1: staffFilter — сотрудник как объект ИЛИ как исполнитель.
  if (staffFilter.length > 0) {
    filterGroups.push({
      entityIds: staffFilter,
      actorIds: staffFilter,
    });
  }

  // Группа 2: search — KB по названию + персона по имени, либо как
  // entity_id, либо как user_id. entityIds объединяет staff+kb (один и
  // тот же entity_id не может ссылаться на оба типа одновременно —
  // entity_type фильтр в paired AND'е разделит). Если q ничего не
  // нашёл → группа с пустыми массивами → short-circuit в listAuditEvents.
  if (search) {
    filterGroups.push({
      entityIds: [...search.staffIds, ...search.kbPageIds],
      actorIds: search.staffIds,
    });
  }

  const entityTypes = types.length > 0 ? types : undefined;
  const fromDate = sp.from ? startOfDayISO(sp.from) : undefined;
  const toDate = sp.to ? endOfDayISO(sp.to) : undefined;

  const [{ events, hasMore, error }, staffOptions] = await Promise.all([
    listAuditEvents({
      entityTypes,
      filterGroups,
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
