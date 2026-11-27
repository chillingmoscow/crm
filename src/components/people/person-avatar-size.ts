/**
 * Размеры аватара человека (DS → «Аватары и цвет»): 36 — списки и карточки,
 * 28 — комментарии и история версий, 20 — плотные меню, 14 — упоминание в
 * строке текста. Инициалы в 20 и 14px — 10 и 8px: единственное исключение из
 * шкалы кеглей, иначе две буквы не помещаются в круг.
 */
export type PersonAvatarSize = "xs" | "sm" | "md" | "lg";

const SIZES: Record<PersonAvatarSize, { box: string; text: string; px: number }> = {
  lg: { box: "size-9", text: "text-xs", px: 36 },
  md: { box: "size-7", text: "text-xs", px: 28 },
  sm: { box: "size-5", text: "text-[10px]", px: 20 },
  xs: { box: "size-[14px]", text: "text-[8px]", px: 14 },
};

export function personAvatarSize(size: PersonAvatarSize | undefined) {
  return SIZES[size ?? "lg"];
}
