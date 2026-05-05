// Единицы массы — общесистемный registry. Используется KB-properties
// (numeric с unit), а в будущем — inventory/товарооборот модулем.
//
// Conversion factors хранятся в `factorToBase` (база = грамм). Модули
// которые делают arithmetic'у (агрегация, конвертация) умножают/делят
// на factor; чисто display modules (KB-property) factor не используют,
// просто рендерят `{ value } {label}`.

export const MASS_UNITS = [
  { code: "gram", label: "г", longLabel: "грамм", factorToBase: 1 },
  { code: "kg", label: "кг", longLabel: "килограмм", factorToBase: 1000 },
] as const;

export type MassUnitCode = (typeof MASS_UNITS)[number]["code"];

export function massLabel(code: MassUnitCode): string {
  return MASS_UNITS.find((u) => u.code === code)?.label ?? code;
}
