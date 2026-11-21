/**
 * Кого можно назначить на акт инвентаризации исполнителем и проверяющим.
 *
 * Pure-модуль без импортов из `@/...` — его читает node:test напрямую, а
 * используют и серверные экшены назначения, и пикеры в списке актов.
 *
 * Правила (docs/handbook/inventory/statuses.md):
 *  - исполнитель — человек с правом «Заполнять назначенные акты» (или
 *    «Назначать и управлять актами») в заведении акта;
 *  - проверяющий — с правом «Возвращать на пересчёт» (или «Назначать и
 *    управлять актами») в заведении акта;
 *  - владелец аккаунта подходит всегда;
 *  - исполнитель и проверяющий одного акта — разные люди.
 *
 * Проверяющий при этом может ЗАПОЛНИТЬ форму за отсутствующего исполнителя
 * (canFillInventoryAct, решение владельца от 20.11) — это не назначение и
 * здесь не регулируется.
 */

export type InventoryAssignRole = "assignee" | "reviewer";

export const INVENTORY_EXECUTOR_PERMISSIONS: readonly string[] = [
  "inventory.fill_assigned_documents",
  "inventory.manage_documents",
];

export const INVENTORY_REVIEWER_PERMISSIONS: readonly string[] = [
  "inventory.recount_documents",
  "inventory.manage_documents",
];

/** Все коды, которые нужно загрузить, чтобы посчитать обе роли. */
export const INVENTORY_ASSIGNMENT_PERMISSIONS: readonly string[] = Array.from(
  new Set([...INVENTORY_EXECUTOR_PERMISSIONS, ...INVENTORY_REVIEWER_PERMISSIONS]),
);

/**
 * Кто подходит на роль, по заведениям. Сериализуемо (уходит в клиентский
 * компонент списка), поэтому Record и массивы, а не Map/Set.
 */
export type InventoryAssignmentEligibility = {
  ownerId: string | null;
  executorsByVenue: Record<string, string[]>;
  reviewersByVenue: Record<string, string[]>;
};

export const EMPTY_ASSIGNMENT_ELIGIBILITY: InventoryAssignmentEligibility = {
  ownerId: null,
  executorsByVenue: {},
  reviewersByVenue: {},
};

/**
 * Собрать матрицу допуска из «кто в каком заведении какие права имеет».
 * На вход — активные (не уволенные) членства с уже раскрытыми кодами прав
 * роли (только granted).
 */
export function buildAssignmentEligibility(input: {
  ownerId: string | null;
  grants: ReadonlyArray<{ userId: string; venueId: string; permissionCodes: readonly string[] }>;
}): InventoryAssignmentEligibility {
  const executors = new Map<string, Set<string>>();
  const reviewers = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, venueId: string, userId: string) => {
    const set = map.get(venueId) ?? new Set<string>();
    set.add(userId);
    map.set(venueId, set);
  };
  for (const grant of input.grants) {
    const codes = new Set(grant.permissionCodes);
    if (INVENTORY_EXECUTOR_PERMISSIONS.some((code) => codes.has(code))) {
      add(executors, grant.venueId, grant.userId);
    }
    if (INVENTORY_REVIEWER_PERMISSIONS.some((code) => codes.has(code))) {
      add(reviewers, grant.venueId, grant.userId);
    }
  }
  const toRecord = (map: Map<string, Set<string>>) =>
    Object.fromEntries(
      Array.from(map.entries()).map(([venueId, users]) => [venueId, Array.from(users).sort()]),
    );
  return {
    ownerId: input.ownerId,
    executorsByVenue: toRecord(executors),
    reviewersByVenue: toRecord(reviewers),
  };
}

function byVenueFor(eligibility: InventoryAssignmentEligibility, role: InventoryAssignRole) {
  return role === "assignee" ? eligibility.executorsByVenue : eligibility.reviewersByVenue;
}

/**
 * Подходит ли человек на роль в акте заведения `venueId`. Акт без заведения
 * (склад ещё не привязан) проверяем по всему аккаунту: достаточно права в
 * любом заведении.
 */
export function isEligibleForRole(input: {
  eligibility: InventoryAssignmentEligibility;
  role: InventoryAssignRole;
  venueId: string | null;
  userId: string;
}): boolean {
  if (input.eligibility.ownerId && input.eligibility.ownerId === input.userId) return true;
  const byVenue = byVenueFor(input.eligibility, input.role);
  if (input.venueId) return (byVenue[input.venueId] ?? []).includes(input.userId);
  return Object.values(byVenue).some((users) => users.includes(input.userId));
}

/**
 * Отфильтровать справочник сотрудников до тех, кого можно назначить на роль
 * хотя бы в одном из заведений `venueIds` (массовое назначение берёт
 * объединение; неподходящие акты сервер пропустит).
 */
export function filterEligibleOptions<T extends { id: string }>(input: {
  options: readonly T[];
  eligibility: InventoryAssignmentEligibility;
  role: InventoryAssignRole;
  venueIds: ReadonlyArray<string | null>;
}): T[] {
  const venues = input.venueIds.length > 0 ? input.venueIds : [null];
  return input.options.filter((option) =>
    venues.some((venueId) =>
      isEligibleForRole({
        eligibility: input.eligibility,
        role: input.role,
        venueId,
        userId: option.id,
      }),
    ),
  );
}

export function ineligibleAssigneeMessage(role: InventoryAssignRole): string {
  return role === "assignee"
    ? "Этому сотруднику нельзя назначить акт: нет права заполнять акты"
    : "Этому сотруднику нельзя назначить акт: нет права проверять акты";
}

/**
 * Причина, по которой человека нельзя поставить на роль из-за второй роли
 * того же акта, либо null. Снятие назначения (userId=null) конфликтов не даёт.
 */
export function getAssignmentConflictReason(input: {
  role: InventoryAssignRole;
  userId: string | null;
  assignedTo: string | null;
  reviewerId: string | null;
}): string | null {
  if (!input.userId) return null;
  if (input.role === "assignee" && input.userId === input.reviewerId) {
    return "Этот сотрудник — проверяющий акта. Исполнитель и проверяющий должны быть разными людьми";
  }
  if (input.role === "reviewer" && input.userId === input.assignedTo) {
    return "Этот сотрудник — исполнитель акта. Исполнитель и проверяющий должны быть разными людьми";
  }
  return null;
}

/** Короткая подсказка в пикере для человека, занятого второй ролью. */
export function conflictHint(role: InventoryAssignRole): string {
  return role === "assignee" ? "Проверяющий этого акта" : "Исполнитель этого акта";
}

/**
 * Авто-фоллбэк проверяющего: тот, кто вернул акт на пересчёт или подвёл итоги,
 * становится проверяющим, если поле пустое. Но не исполнитель акта — иначе
 * автоматом получался бы акт, где человек проверяет собственный счёт.
 * Возвращает id для записи или null, если reviewer_id трогать не нужно.
 */
export function resolveReviewerFallback(input: {
  reviewerId: string | null;
  assignedTo: string | null;
  actorId: string;
}): string | null {
  if (input.reviewerId) return null;
  if (input.actorId === input.assignedTo) return null;
  return input.actorId;
}
