// Единицы объёма — общесистемный registry. См. mass.ts по семантике.
// База = миллилитр.

export const VOLUME_UNITS = [
  { code: "ml", label: "мл", longLabel: "миллилитр", factorToBase: 1 },
  { code: "liter", label: "л", longLabel: "литр", factorToBase: 1000 },
] as const;

export type VolumeUnitCode = (typeof VOLUME_UNITS)[number]["code"];

export function volumeLabel(code: VolumeUnitCode): string {
  return VOLUME_UNITS.find((u) => u.code === code)?.label ?? code;
}
