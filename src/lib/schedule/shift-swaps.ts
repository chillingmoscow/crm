/**
 * Замена смены: «вместо меня выйдет коллега».
 *
 * Правило «кто подходит» совпадает с private.schedule_swap_problem
 * (миграция 358) — там окончательная проверка, здесь список кандидатов
 * и подсказки в интерфейсе. Меняя одно, меняйте и другое.
 */
import { dateInZone } from "./utils.ts";

export type SwapStatus = "pending" | "approved" | "rejected" | "cancelled" | "voided";
export type SwapAnswer = "accepted" | "declined";

export type ShiftSwap = {
  id: string;
  shift_id: string;
  from_user_id: string;
  to_user_id: string;
  comment: string;
  status: SwapStatus;
  candidate_answer: SwapAnswer | null;
  candidate_answered_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string;
  version: number;
  created_at: string;
};

export type SwapShift = {
  id: string;
  user_id: string | null;
  role_id: string | null;
  starts_at: string;
  ends_at: string;
  published?: boolean;
};

export type SwapPerson = {
  user_id: string;
  /** Должности сотрудника в заведении (активные назначения). */
  role_ids: string[];
};

export type SwapContext = {
  timezone: string;
  /** Дополнительные позиции (допуски): user_id → role_id. */
  qualifications: { user_id: string; role_id: string }[];
  /** Смены кандидатов вокруг дня смены — во всех заведениях. */
  busy: { id: string; user_id: string | null; starts_at: string; ends_at: string }[];
};

/** Почему сотрудник не может взять смену; null — подходит. */
export function swapProblem(
  shift: SwapShift,
  person: SwapPerson | undefined,
  ctx: SwapContext,
): string | null {
  if (!person) return "Сотрудник не работает в заведении";
  if (person.user_id === shift.user_id) return "Сотрудник уже стоит на этой смене";
  if (
    shift.role_id &&
    !person.role_ids.includes(shift.role_id) &&
    !ctx.qualifications.some((q) => q.user_id === person.user_id && q.role_id === shift.role_id)
  )
    return "У сотрудника нет допуска к этой позиции";
  const day = dateInZone(shift.starts_at, ctx.timezone);
  const start = Date.parse(shift.starts_at);
  const end = Date.parse(shift.ends_at);
  const busy = ctx.busy.some(
    (other) =>
      other.user_id === person.user_id &&
      other.id !== shift.id &&
      ((Date.parse(other.starts_at) < end && Date.parse(other.ends_at) > start) ||
        dateInZone(other.starts_at, ctx.timezone) === day),
  );
  return busy ? "У сотрудника уже есть смена в этот день" : null;
}

/** Кто может выйти вместо автора: подходящие и свободные. */
export function swapCandidates<P extends SwapPerson>(
  shift: SwapShift,
  people: P[],
  ctx: SwapContext,
): P[] {
  return people.filter((person) => swapProblem(shift, person, ctx) === null);
}

/** Статус для показа: «Ждёт решения» по закончившейся смене — «Истекла». */
export type SwapDisplayStatus = SwapStatus | "expired";

export function swapDisplayStatus(
  swap: Pick<ShiftSwap, "status">,
  shift: Pick<SwapShift, "ends_at"> | undefined,
  now: number,
): SwapDisplayStatus {
  if (swap.status !== "pending") return swap.status;
  return shift && Date.parse(shift.ends_at) <= now ? "expired" : "pending";
}

export const swapStatusLabel: Record<SwapDisplayStatus, string> = {
  pending: "Ждёт решения",
  approved: "Утверждена",
  rejected: "Отклонена",
  cancelled: "Отозвана",
  voided: "Отменена — смену изменили",
  expired: "Истекла",
};

export function swapAnswerLabel(answer: SwapAnswer | null) {
  return answer === "accepted" ? "Согласие" : answer === "declined" ? "Отказ" : "Нет ответа";
}

export type SwapAction = "cancel" | "respond" | "approve" | "reject";

/**
 * Что пользователь может сделать с заявкой. Ответ коллеги не обязателен:
 * управляющий решает, не дожидаясь его. Сервер проверяет то же самое.
 */
export function swapActions(
  swap: Pick<ShiftSwap, "status" | "from_user_id" | "to_user_id">,
  shift: Pick<SwapShift, "ends_at"> | undefined,
  viewer: { userId: string; canDecide: boolean },
  now: number,
): SwapAction[] {
  if (swapDisplayStatus(swap, shift, now) !== "pending") return [];
  const actions: SwapAction[] = [];
  if (swap.from_user_id === viewer.userId) actions.push("cancel");
  if (swap.to_user_id === viewer.userId) actions.push("respond");
  if (viewer.canDecide) actions.push("approve", "reject");
  return actions;
}

/** Можно ли предложить замену своей смене. */
export function canRequestSwap(
  shift: SwapShift,
  userId: string,
  pending: boolean,
  now: number,
): boolean {
  return (
    shift.user_id === userId &&
    shift.published !== false &&
    Date.parse(shift.starts_at) > now &&
    !pending
  );
}
