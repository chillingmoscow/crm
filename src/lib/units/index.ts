// System-wide единицы измерения. Используется:
//   - KB-properties (number с `unit` опционально),
//   - finance / accounting (валюты),
//   - inventory / товарооборот (масса, объём, штуки) — когда модуль
//     появится.
//
// Single source of truth для каждой категории — отдельный файл
// (currencies / mass / volume / pieces). Этот index только склеивает
// типы в discriminated union `Unit` + общий форматтер.

import { formatCurrency, UNIT_CURRENCIES } from "./currencies";
import { MASS_UNITS, massLabel, type MassUnitCode } from "./mass";
import {
  VOLUME_UNITS,
  volumeLabel,
  type VolumeUnitCode,
} from "./volume";
import { PIECE_UNIT } from "./pieces";

export {
  UNIT_CURRENCIES,
  MASS_UNITS,
  VOLUME_UNITS,
  PIECE_UNIT,
  formatCurrency,
  massLabel,
  volumeLabel,
};
export type { CurrencyCode } from "./currencies";
export type { MassUnitCode } from "./mass";
export type { VolumeUnitCode } from "./volume";

/** Discriminated union единицы для использования в KB-property
 *  и в будущих модулях. `none` = «без единицы» (просто число).
 *
 *  `currency.code` намеренно широкий `string` (не CurrencyCode-enum) —
 *  чтобы старые сохранённые валюты не выпадали из system'ы при
 *  rebuild'е CURRENCIES list. Display через `formatCurrency` гладко
 *  fallback'ит на `<value> CODE` для незнакомых ISO-кодов. */
export type Unit =
  | { kind: "none" }
  | { kind: "currency"; code: string }
  | { kind: "mass"; code: MassUnitCode }
  | { kind: "volume"; code: VolumeUnitCode }
  | { kind: "piece" }
  | { kind: "custom"; label: string };

/** Default — без единицы. */
export const UNIT_NONE: Unit = { kind: "none" };

/** Форматирует значение с единицей. Единый форматтер для всех мест
 *  где value-with-unit нужно отрендерить (KB-property display, future
 *  inventory list, аналитика).
 *
 *  - currency → `Intl.NumberFormat` style:'currency' с code (через
 *    formatCurrency).
 *  - mass / volume / piece / custom → `<value> <label>`, value
 *    форматируется через `toLocaleString('ru-RU')` с пробелом-разделителем
 *    тысяч.
 *  - none → просто `toLocaleString` без суффикса.
 *
 *  `null` value не должен попадать сюда — caller проверяет before. */
export function formatWithUnit(value: number, unit: Unit): string {
  switch (unit.kind) {
    case "none":
      return value.toLocaleString("ru-RU");
    case "currency":
      return formatCurrency(value, unit.code);
    case "mass":
      return `${value.toLocaleString("ru-RU")} ${massLabel(unit.code)}`;
    case "volume":
      return `${value.toLocaleString("ru-RU")} ${volumeLabel(unit.code)}`;
    case "piece":
      return `${value.toLocaleString("ru-RU")} ${PIECE_UNIT.label}`;
    case "custom":
      return `${value.toLocaleString("ru-RU")} ${unit.label}`;
  }
}

/** Короткий suffix без числа — для display-helper'ов где value
 *  форматируется отдельно. */
export function unitSuffix(unit: Unit): string {
  switch (unit.kind) {
    case "none":
      return "";
    case "currency":
      // Currency-короткий-символ берём из последнего токена label'а
      // (см. CURRENCIES в lib/constants.ts: «$ Доллар США», берём «$»).
      return (
        UNIT_CURRENCIES.find((c) => c.value === unit.code)?.label.split(
          " ",
        )[0] ?? unit.code
      );
    case "mass":
      return massLabel(unit.code);
    case "volume":
      return volumeLabel(unit.code);
    case "piece":
      return PIECE_UNIT.label;
    case "custom":
      return unit.label;
  }
}
