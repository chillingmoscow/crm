// Чистые нормализаторы payload'ов Quick Resto: ни сети, ни базы, ни секретов.
//
// Жили в inventory/actions-shared.ts, а онбординг держал собственную копию
// половины из них (`asRecord` = `asObject`, свой `productName` для групп).
// Копии не расходились по телу, но расходилась логика вокруг них — см.
// resolveDefaultVenueId в src/lib/inventory/default-venue.ts.

import type {
  QuickRestoInventoryDocument2,
  QuickRestoInventoryItem2,
  QuickRestoSingleCategory,
  QuickRestoSingleProduct,
  QuickRestoStore,
} from "./client";

export const INVENTORY_DOCUMENT_ITEM_KEYS = [
  "effectedItems",
  "prefabricatedItems",
  "disassembledItems",
] as const;

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Принимает число или строку из формы (в т.ч. с запятой-разделителем).
export function priceNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function className(value: unknown): string {
  return text(asObject(value).className) ?? "";
}

/** Суффиксы классов номенклатуры Quick Resto: категория и товар каждого вида. */
export type QuickRestoClassSuffix =
  | "SingleCategory"
  | "SingleProduct"
  | "DishCategory"
  | "Dish"
  | "SemiCategory"
  | "SemiProduct";

export function isQuickRestoClass(value: unknown, suffix: QuickRestoClassSuffix) {
  return className(value).endsWith(`.${suffix}`);
}

export function dateMs(value: unknown): number | null {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }

  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dateText(value: unknown): string | null {
  const parsed = dateMs(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

export function isDeletedQuickRestoRow(value: unknown) {
  const row = asObject(value);
  return (
    row.deleted === true ||
    row.isDeleted === true ||
    row.removed === true ||
    row.deletedAt != null ||
    row.deleteDate != null ||
    row.removeDate != null
  );
}

export function isRecentOpenInventoryDocument(doc: QuickRestoInventoryDocument2) {
  if (doc.processed || isDeletedQuickRestoRow(doc)) return false;
  const invoiceDate = dateText(doc.invoiceDate);
  if (!invoiceDate) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  cutoff.setHours(0, 0, 0, 0);
  return Date.parse(invoiceDate) >= cutoff.getTime();
}

export function sameDate(left: unknown, right: unknown) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const leftMs = dateMs(left);
  const rightMs = dateMs(right);
  return leftMs !== null && rightMs !== null && leftMs === rightMs;
}

export function productName(product: QuickRestoSingleProduct | QuickRestoInventoryItem2["product"], fallback: string) {
  return text(product?.name) ?? text(product?.itemTitle) ?? fallback;
}

export function groupName(group: QuickRestoSingleCategory) {
  return text(group.name) ?? text(group.itemTitle) ?? `Группа #${group.id}`;
}

export function storeTitle(store: QuickRestoStore) {
  return text(store.title) ?? `Склад #${store.id}`;
}

export function inventoryDocumentNumber(doc: QuickRestoInventoryDocument2) {
  return text(doc.documentNumber) ?? `QR-${doc.id}`;
}

export function externalProductId(item: QuickRestoInventoryItem2): string | null {
  const raw = asObject(item.product);
  const id = raw.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

/** Вид номенклатуры в нашем каталоге. Совпадает с enum nomenclature_kind_enum. */
export type NomenclatureKind = "ingredient" | "dish" | "semi_finished" | "product";

/**
 * Какой номенклатуре принадлежит позиция акта.
 *
 * Нужно, потому что идентификаторы в Quick Resto уникальны только внутри
 * класса: блюдо и ингредиент могут иметь один и тот же числовой id. Искать
 * позицию в каталоге по голому id значит однажды связать строку акта не с той
 * номенклатурой, поэтому ключ везде — пара «вид + id».
 *
 * Основной признак — `productDtype` (SingleProduct / Dish / SemiProduct);
 * запасной — суффикс класса самого продукта, на случай выгрузок без dtype.
 */
export function nomenclatureKind(item: QuickRestoInventoryItem2): NomenclatureKind {
  const row = asObject(item);
  const dtype = text(row.productDtype);
  if (dtype === "Dish") return "dish";
  if (dtype === "SemiProduct") return "semi_finished";
  if (dtype === "SingleProduct") return "ingredient";

  const className = text(asObject(row.product).className) ?? "";
  if (className.endsWith(".Dish")) return "dish";
  if (className.endsWith(".SemiProduct")) return "semi_finished";
  return "ingredient";
}

/** Ключ каталога: вид плюс внешний идентификатор. */
export function catalogKey(kind: NomenclatureKind | string, externalId: string): string {
  return `${kind}:${externalId}`;
}

export function quickRestoObjectId(value: unknown): string | null {
  const row = asObject(value);
  const id = row.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

export function quickRestoParentExternalId(item: unknown): string | null {
  const row = asObject(item);
  const selfId = quickRestoObjectId(row);
  const directKeys = ["parentId", "parentItemId", "parentGroupId", "parentCategoryId"];
  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === "number" || typeof value === "string") {
      const id = String(value);
      if (id !== selfId) return id;
    }
  }

  const nestedKeys = [
    "parentItem",
    "parent",
    "parentGroup",
    "parentCategory",
    "group",
    "category",
    "singleCategory",
    "productGroup",
    "productCategory",
  ];
  for (const key of nestedKeys) {
    const id = quickRestoObjectId(row[key]);
    if (id && id !== selfId) return id;
  }

  return null;
}

export function externalItemId(item: QuickRestoInventoryItem2, index: number): string {
  if (typeof item.id === "number" || typeof item.id === "string") return String(item.id);
  const productId = externalProductId(item);
  return productId ? `product:${productId}` : `row:${index}`;
}

export function inventoryDocumentItems(document: QuickRestoInventoryDocument2) {
  for (const key of INVENTORY_DOCUMENT_ITEM_KEYS) {
    const value = document[key];
    if (Array.isArray(value) && value.length > 0) {
      return { key, items: value as QuickRestoInventoryItem2[] };
    }
  }
  return { key: "effectedItems" as const, items: [] as QuickRestoInventoryItem2[] };
}
