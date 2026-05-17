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
    }
  | {
      type: "role";
      id: string;
      name: string;
      code: string;
      venue_id: string | null;
    }
  | {
      type: "department";
      id: string;
      name: string;
    }
  | {
      type: "invitation";
      id: string;
      email: string;
      status: string;
    }
  | {
      type: "transaction";
      id: string;
      public_id: number;
      type_code: string; // income/expense/transfer
      amount: number | string;
      currency: string;
      deleted_at: string | null;
    }
  | {
      type: "bank_account";
      id: string;
      name: string;
      account_type: string;
      deleted_at: string | null;
    }
  | {
      type: "finance_category";
      id: string;
      name: string;
      category_type: string; // income/expense
      is_active: boolean;
    }
  | {
      type: "counterparty";
      id: string;
      name: string;
      inn: string | null;
      deleted_at: string | null;
    }
  | {
      type: "venue";
      id: string;
      name: string;
      venue_type: string;
    }
  | {
      type: "legal_entity";
      id: string;
      name: string;
      inn: string | null;
      is_active: boolean;
    }
  | {
      type: "account";
      id: string;
      name: string;
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
/** Одна OR-группа «персонажный фильтр»: ряд проходит, если
 *  `entity_id ∈ entityIds` ИЛИ `user_id ∈ actorIds`. Незаданные/пустые
 *  массивы трактуются как «не применять эту сторону». Если ОБА массива
 *  заданы и оба пусты — это означает «нет совпадений», и весь запрос
 *  короткозамыкается в empty (без этой семантики search с 0 совпадениями
 *  показывал бы вообще все события).
 *
 *  Несколько групп AND-комбинируются: ряд должен пройти каждую. Это
 *  нужно когда staffFilter и q-поиск активны одновременно — они
 *  ortogonal'ные constraint'ы. */
export interface AuditFilterGroup {
  entityIds?: string[];
  actorIds?: string[];
}

export async function listAuditEvents(input?: {
  entityType?: string;
  /** Несколько типов сразу (OR), для фильтра «Раздел» в общем журнале. */
  entityTypes?: string[];
  entityId?: string;
  /** Ограничить набором action_code (OR). Для фильтра журнала по
   *  типу события (создание / удаление / перемещение). */
  actionCodes?: string[];
  /** like-паттерны по action_code (`*` = `%`), OR. Кросс-модульный
   *  фильтр по категории действия в общем журнале. */
  actionLikePatterns?: string[];
  /** Массив (entity_id OR user_id) групп, AND-комбинируемых. */
  filterGroups?: AuditFilterGroup[];
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

  // Short-circuit: любая группа с обеими сторонами explicitly empty →
  // совпадений быть не может, возвращаем пусто без round-trip'а.
  for (const group of input?.filterGroups ?? []) {
    const eIds = group.entityIds;
    const aIds = group.actorIds;
    const eEmpty = eIds !== undefined && eIds.length === 0;
    const aEmpty = aIds !== undefined && aIds.length === 0;
    const eMissing = eIds === undefined;
    const aMissing = aIds === undefined;
    // Группа бессмысленна если: обе пустые ИЛИ одна пустая + другая
    // не задана (нет ни одного источника совпадений).
    if ((eEmpty && aEmpty) || (eEmpty && aMissing) || (aEmpty && eMissing)) {
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
  if (input?.actionCodes && input.actionCodes.length > 0) {
    query = query.in("action_code", input.actionCodes);
  }
  if (
    input?.actionLikePatterns &&
    input.actionLikePatterns.length > 0
  ) {
    query = query.or(
      input.actionLikePatterns
        .map((p) => `action_code.like.${p}`)
        .join(","),
    );
  }
  // Каждая группа → отдельный `.or()` или `.in()` — PostgREST AND-итит
  // их между собой. Группы с обеими сторонами пустыми отсечены в
  // short-circuit'е выше; здесь учитываем только non-empty стороны.
  for (const group of input?.filterGroups ?? []) {
    const hasE = group.entityIds && group.entityIds.length > 0;
    const hasA = group.actorIds && group.actorIds.length > 0;
    if (hasE && hasA) {
      query = query.or(
        `entity_id.in.(${group.entityIds!.join(",")}),user_id.in.(${group.actorIds!.join(",")})`,
      );
    } else if (hasE) {
      query = query.in("entity_id", group.entityIds!);
    } else if (hasA) {
      query = query.in("user_id", group.actorIds!);
    }
    // обе пустые/missing — пропустили выше.
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

  // role snapshots.
  const roleIds = idsByType.get("role");
  if (roleIds && roleIds.size > 0) {
    const { data: roleRows } = await supabase
      .from("roles")
      .select("id, name, code, venue_id")
      .in("id", Array.from(roleIds));
    for (const r of roleRows ?? []) {
      snapshotsByKey.set(`role:${r.id}`, {
        type: "role",
        id: r.id,
        name: r.name,
        code: r.code,
        venue_id: r.venue_id,
      });
    }
  }

  // department snapshots — могут отсутствовать (deleted).
  const departmentIds = idsByType.get("department");
  if (departmentIds && departmentIds.size > 0) {
    const { data: depRows } = await supabase
      .from("departments")
      .select("id, name")
      .in("id", Array.from(departmentIds));
    for (const d of depRows ?? []) {
      snapshotsByKey.set(`department:${d.id}`, {
        type: "department",
        id: d.id,
        name: d.name,
      });
    }
  }

  // invitation snapshots — могут отсутствовать (приняли/отменили).
  // В этом случае берём email из event.details при рендере.
  const invitationIds = idsByType.get("invitation");
  if (invitationIds && invitationIds.size > 0) {
    const { data: invRows } = await supabase
      .from("invitations")
      .select("id, email, status")
      .in("id", Array.from(invitationIds));
    for (const inv of invRows ?? []) {
      snapshotsByKey.set(`invitation:${inv.id}`, {
        type: "invitation",
        id: inv.id,
        email: inv.email,
        status: inv.status,
      });
    }
  }

  // ── finance snapshots ────────────────────────────────────────
  const transactionIds = idsByType.get("transaction");
  if (transactionIds && transactionIds.size > 0) {
    const { data: txRows } = await supabase
      .from("transactions")
      .select("id, public_id, type, amount, currency, deleted_at")
      .in("id", Array.from(transactionIds));
    for (const t of txRows ?? []) {
      snapshotsByKey.set(`transaction:${t.id}`, {
        type: "transaction",
        id: t.id,
        public_id: t.public_id,
        type_code: t.type,
        amount: t.amount,
        currency: t.currency,
        deleted_at: t.deleted_at,
      });
    }
  }

  const bankAccountIds = idsByType.get("bank_account");
  if (bankAccountIds && bankAccountIds.size > 0) {
    const { data: baRows } = await supabase
      .from("bank_accounts")
      .select("id, name, type, deleted_at")
      .in("id", Array.from(bankAccountIds));
    for (const ba of baRows ?? []) {
      snapshotsByKey.set(`bank_account:${ba.id}`, {
        type: "bank_account",
        id: ba.id,
        name: ba.name,
        account_type: ba.type,
        deleted_at: ba.deleted_at,
      });
    }
  }

  const categoryIds = idsByType.get("finance_category");
  if (categoryIds && categoryIds.size > 0) {
    const { data: catRows } = await supabase
      .from("finance_categories")
      .select("id, name, type, is_active")
      .in("id", Array.from(categoryIds));
    for (const c of catRows ?? []) {
      snapshotsByKey.set(`finance_category:${c.id}`, {
        type: "finance_category",
        id: c.id,
        name: c.name,
        category_type: c.type,
        is_active: c.is_active,
      });
    }
  }

  const counterpartyIds = idsByType.get("counterparty");
  if (counterpartyIds && counterpartyIds.size > 0) {
    const { data: cpRows } = await supabase
      .from("counterparties")
      .select("id, name, inn, deleted_at")
      .in("id", Array.from(counterpartyIds));
    for (const cp of cpRows ?? []) {
      snapshotsByKey.set(`counterparty:${cp.id}`, {
        type: "counterparty",
        id: cp.id,
        name: cp.name,
        inn: cp.inn,
        deleted_at: cp.deleted_at,
      });
    }
  }

  // ── org snapshots ────────────────────────────────────────────
  const venueIds = idsByType.get("venue");
  if (venueIds && venueIds.size > 0) {
    const { data: vRows } = await supabase
      .from("venues")
      .select("id, name, type")
      .in("id", Array.from(venueIds));
    for (const v of vRows ?? []) {
      snapshotsByKey.set(`venue:${v.id}`, {
        type: "venue",
        id: v.id,
        name: v.name,
        venue_type: v.type,
      });
    }
  }

  const legalEntityIds = idsByType.get("legal_entity");
  if (legalEntityIds && legalEntityIds.size > 0) {
    const { data: leRows } = await supabase
      .from("legal_entities")
      .select("id, name, inn, is_active")
      .in("id", Array.from(legalEntityIds));
    for (const le of leRows ?? []) {
      snapshotsByKey.set(`legal_entity:${le.id}`, {
        type: "legal_entity",
        id: le.id,
        name: le.name,
        inn: le.inn,
        is_active: le.is_active,
      });
    }
  }

  const accountIds = idsByType.get("account");
  if (accountIds && accountIds.size > 0) {
    const { data: aRows } = await supabase
      .from("accounts")
      .select("id, name")
      .in("id", Array.from(accountIds));
    for (const a of aRows ?? []) {
      snapshotsByKey.set(`account:${a.id}`, {
        type: "account",
        id: a.id,
        name: a.name,
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
