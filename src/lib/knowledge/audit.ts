"use server";

import { createClient } from "@/lib/supabase/server";

export interface KbAuditEvent {
  id: string;
  action_code: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
  /** Снимок страницы на текущий момент (если ещё существует и не deleted).
   *  null если страница hard-удалена. Берётся отдельным batch-запросом
   *  по entity_id (не embedded join — у audit_logs.entity_id нет FK
   *  в kb_pages). */
  page: {
    id: string;
    slug: string;
    title: string;
    icon: string | null;
    icon_color: string | null;
    deleted_at: string | null;
  } | null;
}

const KB_PAGE_ENTITY = "kb_page";

const PAGE_SIZE = 50;

/** Список KB-audit-событий в active account.
 *
 *  Read-доступ enforced через RLS на `audit_logs` (`org.view_audit`
 *  permission, миграция 035). Под manager/hostess/waiter `.select()`
 *  вернёт пустой набор.
 *
 *  Опционально фильтр по `entity_id` — для per-page audit (например,
 *  будущая вкладка «История» на странице).
 *
 *  Keyset-пагинация через композитный курсор `(beforeCreatedAt, beforeId)`:
 *  `created_at` сам по себе не уникален (cascade-delete вставляет
 *  десятки rows с одним now()), и фильтр `lt(created_at, before)`
 *  пропускал бы остальные events с таким же timestamp на page2.
 *  Композитный курсор: `created_at < cursor_at OR (created_at =
 *  cursor_at AND id < cursor_id)`. См. Codex #52 P1.
 */
export async function listKbAuditEvents(input?: {
  pageId?: string;
  beforeCreatedAt?: string;
  beforeId?: string;
}): Promise<{
  events: KbAuditEvent[];
  hasMore: boolean;
  error: string | null;
}> {
  const supabase = await createClient();

  // Шаг 1: тянем сами audit-rows. БЕЗ embedded `page:kb_pages` —
  // на audit_logs.entity_id нет FK в kb_pages (только в legal_entity/
  // venue/user — см. миграцию 035), PostgREST не сможет resolve
  // relationship и весь запрос упадёт. Page-meta фетчим Step'ом 2
  // отдельным batch-запросом.
  let query = supabase
    .from("audit_logs")
    .select(
      `
      id,
      action_code,
      entity_id,
      details,
      created_at,
      actor:profiles!audit_logs_user_id_fkey (id, first_name, last_name, avatar_url)
      `,
    )
    .eq("entity_type", KB_PAGE_ENTITY)
    // Композитный sort: created_at DESC, id DESC. Tie-breaker по id
    // даёт детерминированный порядок для events с одинаковым timestamp.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (input?.pageId) {
    query = query.eq("entity_id", input.pageId);
  }
  if (input?.beforeCreatedAt) {
    if (input.beforeId) {
      // Композитный keyset: created_at < X OR (created_at = X AND id < Y).
      // PostgREST .or() принимает comma-разделённую строку условий,
      // and() оборачивает группу — синтаксис ниже эквивалентен SQL'ю.
      query = query.or(
        `created_at.lt.${input.beforeCreatedAt},and(created_at.eq.${input.beforeCreatedAt},id.lt.${input.beforeId})`,
      );
    } else {
      // Backwards-compat / first-page-without-id: just timestamp.
      query = query.lt("created_at", input.beforeCreatedAt);
    }
  }

  const { data, error } = await query;
  if (error) {
    return { events: [], hasMore: false, error: error.message };
  }

  type AuditRow = {
    id: string;
    action_code: string;
    entity_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
    actor:
      | {
          id: string;
          first_name: string | null;
          last_name: string | null;
          avatar_url: string | null;
        }
      | null
      | Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          avatar_url: string | null;
        }>;
  };

  const rows = (data as unknown as AuditRow[]) ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const sliced = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Шаг 2: batch-fetch kb_pages для всех уникальных entity_id из
  // sliced rows. Один SELECT вместо N joined-rows.
  const pageIds = Array.from(
    new Set(
      sliced
        .map((r) => r.entity_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const pageById = new Map<string, KbAuditEvent["page"]>();
  if (pageIds.length > 0) {
    const { data: pageRows } = await supabase
      .from("kb_pages")
      .select("id, slug, title, icon, icon_color, deleted_at")
      .in("id", pageIds);
    for (const p of pageRows ?? []) {
      pageById.set(p.id, {
        id: p.id,
        slug: p.slug,
        title: p.title,
        icon: p.icon,
        icon_color: p.icon_color,
        deleted_at: p.deleted_at,
      });
    }
  }

  const events: KbAuditEvent[] = sliced.map((r) => {
    // PostgREST joined-select может вернуть object ИЛИ array для
    // single-FK relation в зависимости от nullable hint'а. Нормализуем.
    const actorRaw = Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor;
    const actorName = actorRaw
      ? [actorRaw.first_name, actorRaw.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || "Без имени"
      : null;
    return {
      id: r.id,
      action_code: r.action_code,
      entity_id: r.entity_id,
      details: r.details ?? {},
      created_at: r.created_at,
      actor: actorRaw
        ? {
            id: actorRaw.id,
            name: actorName ?? "Без имени",
            avatar_url: actorRaw.avatar_url,
          }
        : null,
      page: r.entity_id ? pageById.get(r.entity_id) ?? null : null,
    };
  });

  return { events, hasMore, error: null };
}
