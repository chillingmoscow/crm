"use server";

import { createClient } from "@/lib/supabase/server";
import { listAuditEvents } from "@/lib/audit/list";
import {
  KB_AUDIT_KINDS,
  type KbAuditCountKey,
} from "@/lib/knowledge/audit-kinds";

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

/** Список KB-audit-событий в active account.
 *
 *  Тонкая обёртка над общим `listAuditEvents` (см. `src/lib/audit/list.ts`):
 *  фиксирует `entity_type='kb_page'` и приводит `entity` snapshot к
 *  KB-специфичному полю `page`, чтобы не ломать существующий
 *  `KbAuditEventRow`.
 *
 *  Read-доступ enforced через RLS на `audit_logs` (`org.view_audit`,
 *  миграция 035).
 */
export async function listKbAuditEvents(input?: {
  pageId?: string;
  /** Ограничить набором action_code (фильтр журнала по типу). */
  actionCodes?: string[];
  beforeCreatedAt?: string;
  beforeId?: string;
}): Promise<{
  events: KbAuditEvent[];
  hasMore: boolean;
  error: string | null;
}> {
  const { events, hasMore, error } = await listAuditEvents({
    entityType: "kb_page",
    entityId: input?.pageId,
    actionCodes: input?.actionCodes,
    beforeCreatedAt: input?.beforeCreatedAt,
    beforeId: input?.beforeId,
  });

  const mapped: KbAuditEvent[] = events.map((e) => ({
    id: e.id,
    action_code: e.action_code,
    entity_id: e.entity_id,
    details: e.details,
    created_at: e.created_at,
    actor: e.actor,
    page:
      e.entity && e.entity.type === "kb_page"
        ? {
            id: e.entity.id,
            slug: e.entity.slug,
            title: e.entity.title,
            icon: e.entity.icon,
            icon_color: e.entity.icon_color,
            deleted_at: e.entity.deleted_at,
          }
        : null,
  }));

  return { events: mapped, hasMore, error };
}

/** Счётчики для чипов-фильтров журнала: всего KB-событий + по
 *  каждой категории. Дешёвые `head:true` COUNT-запросы; RLS на
 *  audit_logs (`org.view_audit`) уже ограничивает аккаунтом — без
 *  права вернёт нули. Запросы параллельны. */
export async function getKbAuditCounts(): Promise<
  Record<KbAuditCountKey, number>
> {
  const supabase = await createClient();

  const countAll = supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "kb_page");

  const kinds = Object.entries(KB_AUDIT_KINDS) as [
    keyof typeof KB_AUDIT_KINDS,
    readonly string[],
  ][];

  const [allRes, ...kindRes] = await Promise.all([
    countAll,
    ...kinds.map(([, codes]) =>
      supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("entity_type", "kb_page")
        .in("action_code", [...codes]),
    ),
  ]);

  const counts = { all: allRes.count ?? 0 } as Record<
    KbAuditCountKey,
    number
  >;
  kinds.forEach(([key], i) => {
    counts[key] = kindRes[i]?.count ?? 0;
  });
  return counts;
}
