// Re-export валют из глобального registry'а (`src/lib/constants.ts`)
// + helpers для форматирования. Этот файл — точка входа для модулей,
// которым нужны валюты (KB-properties.number, finance, accounting).
//
// Список валют расширяется ТОЛЬКО в `src/lib/constants.ts:CURRENCIES`,
// все остальные модули импортируют отсюда — single source of truth.

import { CURRENCIES } from "@/lib/constants";

/** Валюты для system-wide использования. То же что `CURRENCIES`,
 *  но переэкспортировано через `units/` для логической группировки. */
export const UNIT_CURRENCIES = CURRENCIES;

/** ISO-4217 код валюты (или legacy non-ISO label вроде «Uzbek Sum»). */
export type CurrencyCode = (typeof UNIT_CURRENCIES)[number]["value"];

/** Человекочитаемый label с символом (рендерится в селекторе).
 *  Принимает `string` — не enum'ом — чтобы graceful'но фолбэчить
 *  на старые/неизвестные коды (после rebuild'а constants). */
export function currencyLabel(code: string): string {
  return UNIT_CURRENCIES.find((c) => c.value === code)?.label ?? code;
}

/** Форматирует число как сумму в валюте.
 *  Использует `Intl.NumberFormat` с локалью `ru-RU` для thousands-
 *  separator (пробел) и locale-specific символа.
 *
 *  Для не-ISO валют (UZS которая в Intl недоступна без code) — fallback
 *  на «значение CODE» (например «1500 UZS»).
 *
 *  Возвращает строку готовую к рендеру. */
export function formatCurrency(value: number, code: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Intl не знает этот ISO-код — fallback.
    return `${value.toLocaleString("ru-RU")} ${code}`;
  }
}
