export const metricKeys = [
  "turnover",
  "hookah",
  "bar",
  "tips",
  "service",
  "tips_total",
  "parking",
  "taxi",
  "checks",
  "staff_checks",
  "deposits",
] as const;
export type MetricKey = (typeof metricKeys)[number];
export type Metrics = Record<MetricKey, number | null>;
export const metricLabels: Record<MetricKey, string> = {
  turnover: "Оборот",
  hookah: "Кальяны",
  bar: "Бар",
  tips: "Чаевые",
  service: "Сервисный сбор",
  tips_total: "Чаевые со сбором",
  parking: "Парковка",
  taxi: "Такси",
  checks: "Количество чеков",
  staff_checks: "Чеки сотрудников",
  deposits: "Депозиты",
};
export const metricHints: Record<MetricKey, string> = {
  turnover:
    "Гостевые продажи без Staff, депозитов, парковки, чаевых и сервисного сбора",
  hookah: "Отдельный отчёт по продажам кальянов в Quick Resto",
  bar: "Оборот минус кальяны",
  tips: "Чаевые без сервисного сбора",
  service: "Сервисный сбор всех действующих чеков, включая Staff",
  tips_total: "Чаевые плюс сервисный сбор",
  parking: "Парковочные позиции действующих гостевых чеков",
  taxi: "Расходные операции с назначением «такси», окно 09:00–06:00",
  checks:
    "Все действующие чеки, включая Staff. Отменённые и возвращённые исключены",
  staff_checks: "Сумма чеков клиентов группы Staff, независимо от стола",
  deposits: "Только пополнения депозитов, без списаний и остатков счетов",
};
export type DayStatus = "preliminary" | "complete" | "imported";
export type SalesDay = {
  id: string;
  account_id: string;
  venue_id: string;
  business_date: string;
  status: DayStatus;
  calculated: Partial<Metrics>;
  overrides: Partial<Metrics>;
  legacy: Partial<Metrics>;
  legacy_source_id: string | null;
  note: string;
  sync_error: string | null;
  synced_at: string | null;
  version: number;
  updated_at: string;
  method_version: string;
  source_summary: Record<string, unknown>;
};
export type SalesEvent = {
  id: string;
  day_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: string;
  changes: Record<string, unknown>;
  reason: string;
  created_at: string;
};
export type SalesSettings = {
  account_id: string;
  venue_id: string;
  enabled: boolean;
  timezone: string;
  day_start_hour: number;
  staff_group_id: number;
  tip_products: Record<string, number>;
  deposit_products: Record<string, number>;
  parking_product_ids: number[];
  hookah_report_id: number;
  quickresto_venue_id: number | null;
};
export const salesSettingsColumns =
  "account_id,venue_id,enabled,timezone,day_start_hour,staff_group_id,tip_products,deposit_products,parking_product_ids,hookah_report_id,quickresto_venue_id";
export type SalesData = {
  days: SalesDay[];
  venueId: string;
  venueName: string;
  timezone: string;
  permissions: string[];
  settings: SalesSettings | null;
  connected: boolean;
  error: string | null;
  jobs: {
    id: string;
    business_date: string;
    status: string;
    error: string | null;
  }[];
};
export type SalesJob = {
  id: string;
  account_id: string;
  venue_id: string;
  business_date: string;
  status: string;
  phase: "orders" | "details" | "reports" | "commit";
  cursor: number;
  payload: Record<string, unknown>;
  lease_token: string;
  attempts: number;
  created_at: string;
};
export type SalesConfiguration = Pick<
  SalesData,
  "venueId" | "venueName" | "timezone" | "settings" | "connected"
> & {
  historyStart: string | null;
  pending: number;
};
export const emptyMetrics = (): Metrics =>
  Object.fromEntries(metricKeys.map((k) => [k, null])) as Metrics;
export function effectiveMetrics(
  day: Pick<SalesDay, "calculated" | "overrides">,
): Metrics {
  const m = { ...emptyMetrics(), ...day.calculated, ...day.overrides };
  if (!("bar" in day.overrides))
    m.bar =
      m.turnover === null || m.hookah === null
        ? null
        : Math.round((m.turnover - m.hookah) * 100) / 100;
  if (!("tips_total" in day.overrides) && m.tips !== null && m.service !== null)
    m.tips_total = Math.round((m.tips + m.service) * 100) / 100;
  return m;
}
