/**
 * Варианты шаблона смены по дням недели. Чистый модуль (без server-only),
 * чтобы его можно было импортировать и в UI, и в server action, и в node:test.
 *
 * Дни недели — ISO: 1=ПН … 7=ВС. Конец <= начала — смена заканчивается
 * на следующий день (как у самих смен). Пустой список вариантов — шаблон
 * работает каждый день со своими start_time/end_time.
 *
 * Тексты ошибок совпадают с проверками schedule_command (миграция 317).
 */
export type TemplateVariant = {
  days: number[];
  start_time: string;
  end_time: string;
};

export const MAX_TEMPLATE_VARIANTS = 7;

export const TEMPLATE_VARIANT_ERRORS = {
  tooMany: "В шаблоне может быть не больше 7 вариантов",
  noDays: "Укажите дни недели для каждого варианта шаблона",
  badDay: "Неверный день недели в варианте шаблона",
  duplicateDays: "Дни недели в вариантах шаблона не должны повторяться",
  badTime: "Неверное время в варианте шаблона",
  breakTooLong: "Перерыв должен быть короче каждого варианта шаблона",
} as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function minutesOf(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** Длительность в минутах; конец <= начала — переход через полночь. */
export function variantMinutes(v: { start_time: string; end_time: string }) {
  const diff = minutesOf(v.end_time) - minutesOf(v.start_time);
  return diff <= 0 ? diff + 1440 : diff;
}

/** Время шаблона на день недели; null — в этот день шаблон не работает. */
export function templateTimesFor(
  t: { start_time: string; end_time: string; variants: TemplateVariant[] },
  isoWeekday: number,
): { start_time: string; end_time: string } | null {
  if (!t.variants || t.variants.length === 0)
    return { start_time: t.start_time, end_time: t.end_time };
  const v = t.variants.find((x) => x.days.includes(isoWeekday));
  return v ? { start_time: v.start_time, end_time: v.end_time } : null;
}

/** Текст первой ошибки или null. breakMinutes — перерыв шаблона. */
export function validateVariants(
  v: TemplateVariant[],
  breakMinutes = 0,
): string | null {
  if (v.length > MAX_TEMPLATE_VARIANTS) return TEMPLATE_VARIANT_ERRORS.tooMany;
  const seen = new Set<number>();
  for (const x of v) {
    if (!x.days || x.days.length === 0) return TEMPLATE_VARIANT_ERRORS.noDays;
    for (const d of x.days) {
      if (!Number.isInteger(d) || d < 1 || d > 7)
        return TEMPLATE_VARIANT_ERRORS.badDay;
      if (seen.has(d)) return TEMPLATE_VARIANT_ERRORS.duplicateDays;
      seen.add(d);
    }
    if (!TIME_RE.test(x.start_time) || !TIME_RE.test(x.end_time))
      return TEMPLATE_VARIANT_ERRORS.badTime;
    if (breakMinutes >= variantMinutes(x))
      return TEMPLATE_VARIANT_ERRORS.breakTooLong;
  }
  return null;
}
