/**
 * Разделы каталога номенклатуры.
 *
 * Ингредиенты, блюда и полуфабрикаты — это отдельные разделы с отдельными
 * деревьями категорий. В базе они лежат в одних таблицах с колонкой `kind`
 * (см. миграцию 239): на `ingredients` завязаны семь внешних ключей из шести
 * таблиц, на `ingredient_groups` — ещё три, включая пересорт, и разводить
 * хранение значило бы учить их всех ссылаться на три каталога.
 *
 * Все три раздела рисует один компонент, отличаются они только этим конфигом.
 * Плодить три почти одинаковые страницы смысла нет: разойдутся при первой же
 * правке. Конфиг — обычные данные без серверных зависимостей: его передают в
 * клиентские компоненты пропсом.
 */
export type CatalogKind = "ingredient" | "dish" | "semi_finished";

export type CatalogKindConfig = {
  kind: CatalogKind;
  /** Сегмент пути: /catalog/<slug> */
  slug: string;
  /** Название раздела — как в боковом меню. */
  title: string;
  /** Формы для счётчиков: «1 ингредиент», «2 ингредиента», «5 ингредиентов». */
  countNoun: { one: string; few: string; many: string };
  /** Именительный падеж единственного числа: «Ингредиент», «Блюдо». */
  itemNoun: string;
  /** Заголовок сведений о карточке в верхней панели: «Об ингредиенте». */
  aboutTitle: string;
  /** Подписи дат в сведениях — под род существительного. */
  addedLabel: string;
  syncedLabel: string;
};

export const CATALOG_KINDS: Record<CatalogKind, CatalogKindConfig> = {
  ingredient: {
    kind: "ingredient",
    slug: "ingredients",
    title: "Ингредиенты",
    countNoun: { one: "ингредиент", few: "ингредиента", many: "ингредиентов" },
    itemNoun: "Ингредиент",
    aboutTitle: "Об ингредиенте",
    addedLabel: "Добавлен",
    syncedLabel: "Синхронизирован",
  },
  dish: {
    kind: "dish",
    slug: "dishes",
    title: "Блюда",
    countNoun: { one: "блюдо", few: "блюда", many: "блюд" },
    itemNoun: "Блюдо",
    aboutTitle: "О блюде",
    addedLabel: "Добавлено",
    syncedLabel: "Синхронизировано",
  },
  semi_finished: {
    kind: "semi_finished",
    slug: "semi-products",
    title: "Полуфабрикаты",
    countNoun: { one: "полуфабрикат", few: "полуфабриката", many: "полуфабрикатов" },
    itemNoun: "Полуфабрикат",
    aboutTitle: "О полуфабрикате",
    addedLabel: "Добавлен",
    syncedLabel: "Синхронизирован",
  },
};

/** Путь к разделу и к карточке позиции внутри него. */
export function catalogPath(config: CatalogKindConfig, productId?: string): string {
  return productId ? `/catalog/${config.slug}/${productId}` : `/catalog/${config.slug}`;
}
