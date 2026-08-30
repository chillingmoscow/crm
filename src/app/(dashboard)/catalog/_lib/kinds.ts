import "server-only";

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
 * правке.
 */
export type CatalogKind = "ingredient" | "dish" | "semi_finished";

export type CatalogKindConfig = {
  kind: CatalogKind;
  /** Сегмент пути: /catalog/<slug> */
  slug: string;
  title: string;
  description: string;
  /** Родительный падеж множественного числа — для пустых состояний. */
  genitivePlural: string;
  /** Что показывать в счётчике списка: «114 групп · 1218 ингредиентов». */
  countNoun: { one: string; few: string; many: string };
};

export const CATALOG_KINDS: Record<CatalogKind, CatalogKindConfig> = {
  ingredient: {
    kind: "ingredient",
    slug: "ingredients",
    title: "Ингредиенты",
    description:
      "Дерево групп и ингредиентов Quick Resto с локальными фото для инвентаризации.",
    genitivePlural: "ингредиентов",
    countNoun: { one: "ингредиент", few: "ингредиента", many: "ингредиентов" },
  },
  dish: {
    kind: "dish",
    slug: "dishes",
    title: "Блюда",
    description:
      "Дерево категорий и блюд Quick Resto. Блюда участвуют в актах инвентаризации и пересорте наравне с ингредиентами.",
    genitivePlural: "блюд",
    countNoun: { one: "блюдо", few: "блюда", many: "блюд" },
  },
  semi_finished: {
    kind: "semi_finished",
    slug: "semi-products",
    title: "Полуфабрикаты",
    description:
      "Дерево категорий и полуфабрикатов Quick Resto: премиксы, настойки, сиропы и заготовки.",
    genitivePlural: "полуфабрикатов",
    countNoun: { one: "полуфабрикат", few: "полуфабриката", many: "полуфабрикатов" },
  },
};

/** Путь к разделу и к карточке позиции внутри него. */
export function catalogPath(config: CatalogKindConfig, productId?: string): string {
  return productId ? `/catalog/${config.slug}/${productId}` : `/catalog/${config.slug}`;
}
