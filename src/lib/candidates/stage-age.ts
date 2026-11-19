import { countRu, pluralRu } from "../format/plural.ts";
import type { CandidateStatus } from "./types.ts";

/**
 * Сколько дней кандидат может стоять на этапе, прежде чем анкета считается
 * залежавшейся. Новую анкету стоит разобрать за пару дней, стажировка
 * законно идёт до двух недель. «Не подходит» и «Принят» срока не имеют.
 */
export const STAGE_AGE_LIMITS: Partial<Record<CandidateStatus, number>> = {
  new: 2,
  review: 5,
  interview: 5,
  trial: 14,
};

// Подбор ведётся по московскому времени, как и даты заявок в фильтре списка.
const TIME_ZONE = "Europe/Moscow";
const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayNumber = (date: Date) =>
  Date.parse(`${dayKey.format(date)}T00:00:00Z`) / 86_400_000;

/** Календарные дни на этапе по Москве: 0 — перешёл сегодня. */
export function stageAgeDays(stageChangedAt: string, now = new Date()): number {
  const since = new Date(stageChangedAt);
  if (Number.isNaN(since.getTime())) return 0;
  return Math.max(0, dayNumber(now) - dayNumber(since));
}

export type StageAge = {
  days: number;
  label: string;
  /** Порог этапа, если срок его превысил. */
  overdueAfter: number | null;
};

/** Срок на этапе для списка; null — у этапа срока нет. */
export function stageAge(
  status: CandidateStatus,
  stageChangedAt: string,
  now = new Date(),
): StageAge | null {
  const limit = STAGE_AGE_LIMITS[status];
  if (limit === undefined) return null;
  const days = stageAgeDays(stageChangedAt, now);
  return {
    days,
    label: days === 0 ? "Сегодня" : countRu(days, "день", "дня", "дней"),
    overdueAfter: days > limit ? limit : null,
  };
}

/** «Дольше 2 дней на этапе „Новая анкета“» — подсказка у подсвеченного срока. */
export function overdueHint(limit: number, stageLabel: string): string {
  return `Дольше ${limit} ${pluralRu(limit, "дня", "дней", "дней")} на этапе «${stageLabel}»`;
}
