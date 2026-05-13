"use server";

import { createClient } from "@/lib/supabase/server";

/** Унифицированный snapshot сущности для рендера в журнале. Discriminated
 *  union по `type`. Расширяется при добавлении новых entity_type'ов. */
export type AuditEntitySnapshot =
  | {
      type: "kb_page";
      id: string;
      slug: string;
      title: string;
      icon: string | null;
      icon_color: string | null;
      deleted_at: string | null;
    }
  | {
      type: "staff";
      id: string;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
    };

export interface AuditEvent {
  id: string;
  action_code: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
  /** Снимок сущности на текущий момент (`null` если она hard-удалена
   *  или entity_type не зарегистрирован в snapshot-fetchers). */
  entity: AuditEntitySnapshot | null;
}

const AUDIT_PAGE_SIZE = 50;

/** Список audit-событий в активном аккаунте.
 *
 *  Read-доступ enforced через RLS на `audit_logs` (permission
 *  `org.view_audit`, миграция 035). Без права `.select()` вернёт
 *  пустой набор.
 *
 *  Фильтры:
 *  - `entityType` — ограничить одним типом сущности (например `'staff'`).
 *  - `entityType + entityId` — лента одной сущности (per-staff журнал).
 *
 *  Keyset-пагинация через композитный курсор `(beforeCreatedAt, beforeId)`.
 *  Cascade-операции могут вставлять десятки rows с одним `created_at`,
 *  и фильтр `lt(created_at, before)` пропускал бы события с тем же
 *  timestamp на page2. Композит: `created_at < cursor_at OR
 *  (created_at = cursor_at AND id < cursor_id)` (см. KB Codex #52 P1).
 */
export async function listAuditEvents(input?: {
  entityType?: string;
  /** Несколько типов сразу (OR), для фильтра «Раздел» в общем журнале. */
  entityTypes?: string[];
  entityId?: string;
  /** Сужение по списку конкретных entity_id (например, поиск по имени
   *  сотрудника предварительно резолвится в массив profile.id). Если
   *  массив пустой — вернёт пустой результат (запрос не выполняется). */
  entityIds?: string[];
  /** OR с entityIds: ряд проходит фильтр, если actor (`user_id`) или
   *  entity_id попадает в соответствующий список. Используется для
   *  поиска и для фильтра «Сотрудники», когда хочется видеть события,
   *  где сотрудник либо объект, либо исполнитель действия. */
  actorIds?: string[];
  /** ISO timestamp, нижняя граница `created_at >= fromDate`. */
  fromDate?: string;
  /** ISO timestamp, верхняя граница `created_at < toDate` (исключая
   *  следующий день, удобно для date-pickers с end-of-day). */
  toDate?: string;
  beforeCreatedAt?: string;
  beforeId?: string;
  pageSize?: number;
}): Promise<{
  events: AuditEvent[];
  hasMore: boolean;
  error: string | null;
}> {
  const supabase = await createClient();
  const pageSize = input?.pageSize ?? AUDIT_PAGE_SIZE;

  // Если пользователь ввёл поиск и не нашлось совпадений — сразу пусто,
  // иначе `.in("entity_id", [])` ушло бы в Postgrest как `=in.()` и
  // вернуло бы все ряды (или ошибку), что не то что мы хотим.
  // Когда оба фильтра — entityIds и actorIds — заданы и пусты,
  // тоже короткозамыкаем; иначе .or() с пустыми in() ломается.
  const hasEntityIds = input?.entityIds && input.entityIds.length > 0;
  const hasActorIds = input?.actorIds && input.actorIds.length > 0;
  const entityIdsExplicitlyEmpty =
    input?.entityIds !== undefined && input.entityIds.length === 0;
  const actorIdsExplicitlyEmpty =
    input?.actorIds !== undefined && input.actorIds.length === 0;
  if (entityIdsExplicitlyEmpty && !hasActorIds) {
    return { events: [], hasMore: false, error: null };
  }
  if (actorIdsExplicitlyEmpty && !hasEntityIds && input?.actorIds !== undefined) {
    // actorIds=[] вместе с другими фильтрами — намеренно пусто.
    // Но если entityIds задан и непуст, поиск идёт по entity_id one-side.
    if (!hasEntityIds) {
      return { events: [], hasMore: false, error: null };
    }
  }

  let query = supabase
    .from("audit_logs")
    .select(
      `
      id,
      action_code,
      entity_type,
      entity_id,
      details,
      created_at,
      actor:profiles!audit_logs_user_id_fkey (id, first_name, last_name, avatar_url)
      `,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  if (input?.entityType) {
    query = query.eq("entity_type", input.entityType);
  }
  if (input?.entityTypes && input.entityTypes.length > 0) {
    query = query.in("entity_type", input.entityTypes);
  }
  if (input?.entityId) {
    query = query.eq("entity_id", input.entityId);
  }
  // entityIds + actorIds комбинируем через PostgREST `.or()` — ряд
  // проходит, если entity_id ∈ entityIds ИЛИ user_id ∈ actorIds.
  if (hasEntityIds && hasActorIds) {
    query = query.or(
      `entity_id.in.(${input!.entityIds!.join(",")}),user_id.in.(${input!.actorIds!.join(",")})`,
    );
  } else if (hasEntityIds) {
    query = query.in("entity_id", input!.entityIds!);
  } else if (hasActorIds) {
    query = query.in("user_id", input!.actorIds!);
  }
  if (input?.fromDate) {
    query = query.gte("created_at", input.fromDate);
  }
  if (input?.toDate) {
    query = query.lt("created_at", input.toDate);
  }
  if (input?.beforeCreatedAt) {
    if (input.beforeId) {
      query = query.or(
        `created_at.lt.${input.beforeCreatedAt},and(created_at.eq.${input.beforeCreatedAt},id.lt.${input.beforeId})`,
      );
    } else {
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
    entity_type: string;
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
  const hasMore = rows.length > pageSize;
  const sliced = hasMore ? rows.slice(0, pageSize) : rows;

  // Группируем entity_id по entity_type → один батч на тип.
  const idsByType = new Map<string, Set<string>>();
  for (const r of sliced) {
    if (!r.entity_id) continue;
    const set = idsByType.get(r.entity_type) ?? new Set<string>();
    set.add(r.entity_id);
    idsByType.set(r.entity_type, set);
  }

  const snapshotsByKey = new Map<string, AuditEntitySnapshot>();

  // kb_page snapshots.
  const kbIds = idsByType.get("kb_page");
  if (kbIds && kbIds.size > 0) {
    const { data: pageRows } = await supabase
      .from("kb_pages")
      .select("id, slug, title, icon, icon_color, deleted_at")
      .in("id", Array.from(kbIds));
    for (const p of pageRows ?? []) {
      snapshotsByKey.set(`kb_page:${p.id}`, {
        type: "kb_page",
        id: p.id,
        slug: p.slug,
        title: p.title,
        icon: p.icon,
        icon_color: p.icon_color,
        deleted_at: p.deleted_at,
      });
    }
  }

  // staff snapshots — это profile-row для user_id.
  const staffIds = idsByType.get("staff");
  if (staffIds && staffIds.size > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, avatar_url")
      .in("id", Array.from(staffIds));
    for (const p of profileRows ?? []) {
      snapshotsByKey.set(`staff:${p.id}`, {
        type: "staff",
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        avatar_url: p.avatar_url,
      });
    }
  }

  const events: AuditEvent[] = sliced.map((r) => {
    const actorRaw = Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor;
    const actorName = actorRaw
      ? [actorRaw.first_name, actorRaw.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || "Без имени"
      : null;
    const snapshotKey = r.entity_id ? `${r.entity_type}:${r.entity_id}` : null;
    return {
      id: r.id,
      action_code: r.action_code,
      entity_type: r.entity_type,
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
      entity: snapshotKey ? snapshotsByKey.get(snapshotKey) ?? null : null,
    };
  });

  return { events, hasMore, error: null };
}
