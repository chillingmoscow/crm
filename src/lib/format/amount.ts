export type AmountRoundingScale = 0 | 1 | 2;

export const DEFAULT_AMOUNT_ROUNDING_SCALE: AmountRoundingScale = 1;

export const AMOUNT_ROUNDING_OPTIONS: Array<{
  value: AmountRoundingScale;
  label: string;
  description: string;
}> = [
  { value: 0, label: "До целых", description: "1 235 ₽" },
  { value: 1, label: "До десятых", description: "1 234,6 ₽" },
  { value: 2, label: "До сотых", description: "1 234,56 ₽" },
];

export function normalizeAmountRoundingScale(value: unknown): AmountRoundingScale {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (parsed === 0 || parsed === 1 || parsed === 2) return parsed;
  return DEFAULT_AMOUNT_ROUNDING_SCALE;
}

export function formatAmount(value: number | null | undefined, scale: AmountRoundingScale): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(value);
}

/**
 * Количество для отображения. В отличие от formatAmount не добивает
 * дробную часть нулями: целые показываются без запятой («93 шт»),
 * дробные — до scale знаков («13,5 л»). Нужно для штучных позиций,
 * где «93,0 шт» выглядит лишним.
 */
export function formatQuantityAmount(
  value: number | null | undefined,
  scale: AmountRoundingScale
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: scale,
  }).format(value);
}

export function formatMoney(
  value: number | null | undefined,
  currency = "RUB",
  scale: AmountRoundingScale = DEFAULT_AMOUNT_ROUNDING_SCALE
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const formatted = formatAmount(value, scale);
  if (currency === "RUB") return `${formatted} ₽`;
  if (currency === "USD") return `${formatted} $`;
  if (currency === "EUR") return `${formatted} €`;
  return `${formatted} ${currency}`;
}

export function formatSignedMoney(
  value: number | null | undefined,
  currency = "RUB",
  scale: AmountRoundingScale = DEFAULT_AMOUNT_ROUNDING_SCALE
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(value), currency, scale)}`;
}

/**
 * Цвет знаковой суммы: излишек зелёный, недостача красная, ноль нейтральный.
 *
 * Семантическая пара income/expense из дизайн-системы (§Dark mode, п.5):
 * green `#16a34a` → `#22c55e`, red `#dc2626` → `#f87171`. Тот же класс уже
 * стоит на суммах транзакций в финансах — чтобы «плюс» на двух экранах не был
 * двух разных зелёных.
 *
 * Emerald/rose из палитры — про аватары и бейджи, не про суммы.
 */
export function signedAmountClass(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (amount > 0) return "text-green-700 dark:text-green-400";
  if (amount < 0) return "text-red-700 dark:text-red-400";
  return "text-muted-foreground";
}
