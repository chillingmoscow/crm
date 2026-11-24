import type { UpsellTarget } from "@/lib/sales/upsell";

/** Вид позиции правил допродаж — подпись в списке, поиске и карточке дня. */
export const TARGET_LABEL: Record<UpsellTarget, string> = {
  dish: "Блюдо",
  dish_group: "Категория",
  modifier: "Модификатор",
  modifier_group: "Группа модификаторов",
};
