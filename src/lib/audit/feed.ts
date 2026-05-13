"use server";

import { listAuditEvents, type AuditEvent, type AuditFilterGroup } from "@/lib/audit/list";
import { searchAuditEntities } from "@/lib/audit/search-staff";

export interface AuditFeedParams {
  q?: string;
  types?: string;
  /** Сотрудники как объект действия (entity_id). */
  staff?: string;
  /** Сотрудники как исполнитель действия (user_id). */
  actor?: string;
  from?: string;
  to?: string;
  beforeAt?: string;
  beforeId?: string;
}

/** Резолв URL-параметров общего журнала в запрос к listAuditEvents.
 *  Используется и из RSC (`/org/audit/page.tsx` для initial render),
 *  и из клиента (load-more button через server-action call). Логика
 *  match'инга персон / search / типов — в одном месте, чтобы клиент
 *  и сервер видели одинаковый результат при одних и тех же фильтрах.
 *
 *  Permission-гейт здесь намеренно не делаем — это входная точка
 *  page.tsx (redirect при no-perm); load-more же вызывается уже из
 *  отрендеренной страницы, и RLS на `audit_logs` гарантирует, что
 *  без `org.view_audit` запрос вернёт пусто. */
export async function loadAuditFeedPage(params: AuditFeedParams): Promise<{
  events: AuditEvent[];
  hasMore: boolean;
  error: string | null;
}> {
  const q = (params.q ?? "").trim();
  const types = parseCsv(params.types);
  const staffEntityFilter = parseCsv(params.staff);
  const staffActorFilter = parseCsv(params.actor);

  const search = q ? await searchAuditEntities(q) : null;

  // Два независимых filter group'а: «как объект» и «как исполнитель».
  // Если активны оба — это AND (ряд должен совпасть с обеими сторонами,
  // т.е. либо X объект И Y актор, либо одна персона в обеих ролях).
  // Если активна только одна сторона — узкий фильтр.
  const filterGroups: AuditFilterGroup[] = [];
  if (staffEntityFilter.length > 0) {
    filterGroups.push({ entityIds: staffEntityFilter });
  }
  if (staffActorFilter.length > 0) {
    filterGroups.push({ actorIds: staffActorFilter });
  }
  if (search) {
    // Поиск: entity-match по всем типам (staff + kb + role + invitation +
    // finance:bank_account/category/counterparty/transaction + org:venue/
    // legal_entity), actor-match по profile.id (исполнитель действия).
    // Если ни одно не нашлось — listAuditEvents short-circuit'нет в empty.
    filterGroups.push({
      entityIds: [
        ...search.staffIds,
        ...search.kbPageIds,
        ...search.roleIds,
        ...search.invitationIds,
        ...search.transactionIds,
        ...search.bankAccountIds,
        ...search.financeCategoryIds,
        ...search.counterpartyIds,
        ...search.venueIds,
        ...search.legalEntityIds,
      ],
      actorIds: search.staffIds,
    });
  }

  const entityTypes = types.length > 0 ? types : undefined;
  const fromDate = params.from ? startOfDayISO(params.from) : undefined;
  const toDate = params.to ? endOfDayISO(params.to) : undefined;

  return listAuditEvents({
    entityTypes,
    filterGroups,
    fromDate,
    toDate,
    beforeCreatedAt: params.beforeAt,
    beforeId: params.beforeId,
  });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function startOfDayISO(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function endOfDayISO(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}
