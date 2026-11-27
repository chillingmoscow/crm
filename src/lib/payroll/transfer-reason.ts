// Причина переноса остатка месяца — одна для ручного переноса (панель в
// «Зарплате») и для автопереноса после второй выплаты (план выплат).

/** «ноябрь 2026». */
export const transferMonthLabel = (m: string) =>
  new Date(`${m}T12:00:00Z`)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .replace(" г.", "");

/**
 * Причина для журнала: база требует её, а выбирать здесь нечего. Остаток
 * бывает долгом (недоплатили — доплатим в следующем месяце) или переплатой
 * (выдали больше — удержим из следующего месяца), и причина говорит, какой.
 */
export function transferReason(remaining: number, from: string, to: string) {
  return remaining < 0
    ? `Переплата за ${transferMonthLabel(from)}: удерживается из выплаты за ${transferMonthLabel(to)}`
    : `Недоплата за ${transferMonthLabel(from)}: переносится к выплате за ${transferMonthLabel(to)}`;
}
