/**
 * Месяц, который «Допродажи» открывают первым: последний с данными (отчёты,
 * дни допродаж), а без данных — месяц начала расчёта. Общий для
 * страницы (сервер грузит под него рейтинг) и клиента — чтобы они совпадали.
 */
export function additionalLatestMonth(data: {
  reports: { business_date: string }[];
  upsellDays: { business_date: string }[];
  nextFrom: string;
}): string {
  return (
    [
      ...data.reports.map((r) => r.business_date),
      ...data.upsellDays.map((r) => r.business_date),
    ]
      .sort()
      .at(-1) ?? data.nextFrom
  ).slice(0, 7);
}
