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
   *  null если страница hard-удалена. Берётся через JOIN на kb_pages. */
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
 *  Keyset-пагинация через `before` (created_at): передаём cursor от
 *  последнего показанного события, получаем следующую страницу.
 *  PAGE_SIZE = 50 — компромисс между «всё на одной странице» и
 *  «бесконечный scroll».
 */
export async function listKbAuditEvents(input?: {
  pageId?: string;
  before?: string;
}): Promise<{
  events: KbAuditEvent[];
  hasMore: boolean;
  error: string | null;
}> {
  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select(
      `
      id,
      action_code,
      entity_id,
      details,
      created_at,
      actor:profiles!audit_logs_user_id_fkey (id, first_name, last_name, avatar_url),
      page:kb_pages!audit_logs_entity_id_fkey (id, slug, title, icon, icon_color, deleted_at)
      `,
    )
    .eq("entity_type", KB_PAGE_ENTITY)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (input?.pageId) {
    query = query.eq("entity_id", input.pageId);
  }
  if (input?.before) {
    query = query.lt("created_at", input.before);
  }

  const { data, error } = await query;
  if (error) {
    // Note: PostgREST returns error when entity_id FK не существует
    // (kb_pages удалена hard-delete). У нас kb_pages никогда не
    // удаляется hard-delete (только soft через deleted_at), но FK
    // сам по себе nullable — query всё равно вернёт rows с page=null.
    // Если упало — реальная ошибка (RLS deny / network).
    return { events: [], hasMore: false, error: error.message };
  }

  type Row = {
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
    page:
      | {
          id: string;
          slug: string;
          title: string;
          icon: string | null;
          icon_color: string | null;
          deleted_at: string | null;
        }
      | null
      | Array<{
          id: string;
          slug: string;
          title: string;
          icon: string | null;
          icon_color: string | null;
          deleted_at: string | null;
        }>;
  };

  const rows = (data as unknown as Row[]) ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const sliced = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const events: KbAuditEvent[] = sliced.map((r) => {
    // PostgREST joined-select может вернуть object ИЛИ array для
    // single-FK relation в зависимости от nullable hint'а. Нормализуем.
    const actorRaw = Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor;
    const pageRaw = Array.isArray(r.page) ? r.page[0] ?? null : r.page;
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
      page: pageRaw
        ? {
            id: pageRaw.id,
            slug: pageRaw.slug,
            title: pageRaw.title,
            icon: pageRaw.icon,
            icon_color: pageRaw.icon_color,
            deleted_at: pageRaw.deleted_at,
          }
        : null,
    };
  });

  return { events, hasMore, error: null };
}
