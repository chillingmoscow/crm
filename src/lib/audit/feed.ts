"use server";

import { listAuditEvents, type AuditEvent, type AuditFilterGroup } from "@/lib/audit/list";
import { searchAuditEntities } from "@/lib/audit/search-staff";
import { categoriesToLikePatterns } from "@/lib/audit/action-categories";

export interface AuditFeedParams {
  q?: string;
  types?: string;
  /** CSV категорий действия (created/changed/deleted/restored/moved). */
  actions?: string;
  staff?: string;
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
  const staffFilter = parseCsv(params.staff);

  const search = q ? await searchAuditEntities(q) : null;

  const filterGroups: AuditFilterGroup[] = [];
  if (staffFilter.length > 0) {
    // Сотрудник как объект ИЛИ как исполнитель (одна группа = OR).
    filterGroups.push({
      entityIds: staffFilter,
      actorIds: staffFilter,
    });
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
  const actionLikePatterns = categoriesToLikePatterns(
    parseCsv(params.actions),
  );
  const fromDate = params.from ? startOfDayISO(params.from) : undefined;
  const toDate = params.to ? endOfDayISO(params.to) : undefined;

  return listAuditEvents({
    entityTypes,
    actionLikePatterns:
      actionLikePatterns.length > 0 ? actionLikePatterns : undefined,
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
