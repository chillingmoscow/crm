"use server";

// Каталог: картинки позиций и групп, описание и поставщики ингредиента.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { writeAuditEvent } from "@/lib/audit/write";
import {
  getIngredientDetail,
  listIngredientHistory,
  type IngredientDetail,
} from "@/lib/inventory/ingredients";
import {
  previousActs,
  type IngredientHistoryEntry,
} from "@/lib/inventory/ingredient-history-shared";

/** Сколько актов помещается в карточку при наведении, не превращая её в простыню. */
const HISTORY_HOVER_LIMIT = 6;
import {
  actionErrorMessage,
  buildStoragePath,
  getActiveContext,
  priceNum,
  text
} from "../actions-shared";

export async function uploadInventoryProductImage(formData: FormData): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const productId = text(formData.get("productId"));
  const file = formData.get("file");
  if (!productId) return { error: "Не указана позиция" };
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите изображение" };
  if (!file.type.startsWith("image/")) return { error: "Можно загрузить только изображение" };

  const admin = asLooseDb(createAdminClient());
  const product = await loadIngredientRef(admin, ctx.accountId, productId);
  if (!product) return { error: "Позиция не найдена" };

  const storagePath = buildStoragePath(ctx.accountId, file.name);
  const { error: uploadError } = await admin.storage
    .from("account-attachments")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) return { error: uploadError.message };

  const { data: fileRow, error: fileError } = await admin
    .from<{ id: string }>("account_files")
    .insert({
      account_id: ctx.accountId,
      storage_path: storagePath,
      name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (fileError || !fileRow?.id) {
    await admin.storage.from("account-attachments").remove([storagePath]);
    return { error: fileError?.message ?? "Не удалось сохранить файл" };
  }

  const { error: productError } = await admin
    .from("ingredients")
    .update({ primary_image_file_id: fileRow.id, photo_source: "manual" })
    .eq("id", productId)
    .eq("account_id", ctx.accountId);
  if (productError) return { error: productError.message };

  const replaced = Boolean(product.primary_image_file_id);
  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId: productId,
    eventType: "photo_updated",
    payload: { fileName: file.name, replaced },
    actorId: ctx.user.id,
  });
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: ctx.venueId,
    userId: ctx.user.id,
    actionCode: "catalog.ingredient.photo_updated",
    entityType: "ingredient",
    entityId: productId,
    details: { name: product.name, kind: product.kind, replaced },
  });

  revalidateCatalog();
  return { error: null };
}

/**
 * Убрать фото позиции. Файл в хранилище остаётся (как и при замене фото):
 * на него может ссылаться история, а место он занимает копеечное.
 */
export async function removeInventoryProductImage(input: {
  productId: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const productId = text(input.productId);
  if (!productId) return { error: "Не указана позиция" };

  const admin = asLooseDb(createAdminClient());
  const product = await loadIngredientRef(admin, ctx.accountId, productId);
  if (!product) return { error: "Позиция не найдена" };
  if (!product.primary_image_file_id) return { error: null };

  const { error } = await admin
    .from("ingredients")
    .update({ primary_image_file_id: null, photo_source: null })
    .eq("id", productId)
    .eq("account_id", ctx.accountId);
  if (error) return { error: error.message };

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId: productId,
    eventType: "photo_updated",
    payload: { removed: true },
    actorId: ctx.user.id,
  });
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: ctx.venueId,
    userId: ctx.user.id,
    actionCode: "catalog.ingredient.photo_removed",
    entityType: "ingredient",
    entityId: productId,
    details: { name: product.name, kind: product.kind },
  });

  revalidateCatalog();
  return { error: null };
}

export async function uploadInventoryProductGroupImage(formData: FormData): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const groupId = text(formData.get("groupId"));
  const file = formData.get("file");
  if (!groupId) return { error: "Не указана категория" };
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите изображение" };
  if (!file.type.startsWith("image/")) return { error: "Можно загрузить только изображение" };

  const admin = asLooseDb(createAdminClient());
  const { data: group } = await admin
    .from<{
      id: string;
      name: string | null;
      kind: string | null;
      primary_image_file_id: string | null;
    }>("ingredient_groups")
    .select("id, name, kind, primary_image_file_id")
    .eq("id", groupId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!group?.id) return { error: "Категория не найдена" };

  const storagePath = buildStoragePath(ctx.accountId, file.name);
  const { error: uploadError } = await admin.storage
    .from("account-attachments")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) return { error: uploadError.message };

  const { data: fileRow, error: fileError } = await admin
    .from<{ id: string }>("account_files")
    .insert({
      account_id: ctx.accountId,
      storage_path: storagePath,
      name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (fileError || !fileRow?.id) {
    await admin.storage.from("account-attachments").remove([storagePath]);
    return { error: fileError?.message ?? "Не удалось сохранить файл" };
  }

  const { error: groupError } = await admin
    .from("ingredient_groups")
    .update({ primary_image_file_id: fileRow.id })
    .eq("id", groupId)
    .eq("account_id", ctx.accountId);
  if (groupError) return { error: groupError.message };

  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: ctx.venueId,
    userId: ctx.user.id,
    actionCode: "catalog.ingredient_group.photo_updated",
    entityType: "ingredient_group",
    entityId: groupId,
    details: {
      name: group.name,
      kind: group.kind,
      replaced: Boolean(group.primary_image_file_id),
    },
  });

  revalidateCatalog();
  return { error: null };
}

/**
 * Каталог — три раздела (ингредиенты, блюда, полуфабрикаты) с общими
 * экшенами: сбрасываем кэш всего `/catalog`, а не только ингредиентов —
 * иначе правка в карточке блюда не долетала до списка блюд.
 */
function revalidateCatalog() {
  revalidatePath("/catalog", "layout");
}

async function writeIngredientJournal(input: {
  admin: LooseDb;
  accountId: string;
  ingredientId: string;
  eventType:
    | "synced"
    | "description_updated"
    | "photo_updated"
    | "supplier_added"
    | "supplier_updated"
    | "supplier_removed";
  payload?: Record<string, unknown>;
  actorId: string;
}) {
  await input.admin.from("ingredient_journal").insert({
    account_id: input.accountId,
    ingredient_id: input.ingredientId,
    event_type: input.eventType,
    payload: input.payload ?? {},
    actor_id: input.actorId,
  });
}

type IngredientRef = {
  id: string;
  name: string;
  kind: string | null;
  local_description: string | null;
  primary_image_file_id: string | null;
};

/** Позиция номенклатуры этого аккаунта (или null): проверка владения и
 *  название/вид для записи в журнал. */
async function loadIngredientRef(
  admin: LooseDb,
  accountId: string,
  ingredientId: string,
): Promise<IngredientRef | null> {
  const { data } = await admin
    .from<IngredientRef>("ingredients")
    .select("id, name, kind, local_description, primary_image_file_id")
    .eq("id", ingredientId)
    .eq("account_id", accountId)
    .maybeSingle();
  return data?.id ? data : null;
}

async function counterpartyName(
  admin: LooseDb,
  accountId: string,
  counterpartyId: string,
): Promise<string | null> {
  const { data } = await admin
    .from<{ name: string | null }>("counterparties")
    .select("name")
    .eq("id", counterpartyId)
    .eq("account_id", accountId)
    .maybeSingle();
  return data?.name ?? null;
}

async function assertOwnedCounterparty(admin: LooseDb, accountId: string, counterpartyId: string) {
  const { data } = await admin
    .from<{ id: string }>("counterparties")
    .select("id")
    .eq("id", counterpartyId)
    .eq("account_id", accountId)
    .maybeSingle();
  return Boolean(data?.id);
}

/**
 * Обзор ингредиента для боковой панели из «Итогов» акта: клик по названию
 * позиции открывает Sheet с основными данными карточки (без загрузки
 * полной страницы). Переиспользует getIngredientDetail.
 *
 * Гейт — `inventory.view_products`: та же граница, что у каталога
 * (страница карточки ингредиента проверяет именно это право). Иначе
 * пользователь с view_results, но без view_products, получил бы метаданные
 * каталога (артикул, штрих-код, себестоимость, остаток) в обход (Codex P1 #404).
 */
export async function getInventoryIngredientOverview(input: {
  ingredientId: string;
}): Promise<{ data: IngredientDetail | null; error: string | null }> {
  const ctx = await getActiveContext("inventory.view_products");
  if (ctx.error || !ctx.accountId) return { data: null, error: ctx.error };
  try {
    const data = await getIngredientDetail(ctx.accountId, input.ingredientId);
    return { data: data ?? null, error: null };
  } catch (error) {
    return { data: null, error: actionErrorMessage(error, "Не удалось загрузить ингредиент") };
  }
}

/**
 * История позиции по прошлым актам — для карточки при наведении в итогах акта.
 *
 * Право то же, что у самой страницы итогов: разницы и суммы по другим актам —
 * это итоги, а не каталог. `view_products` здесь не годится (см. #551).
 * Исполнитель, которого пускают на проведённый акт в порядке исключения, права
 * не имеет и историю не увидит — исключение узкое и на один документ.
 */
export async function getInventoryIngredientHistory(input: {
  ingredientId: string;
  /** Открытый акт: отдаём то, что было ДО него. */
  currentDocumentId?: string;
}): Promise<{ data: IngredientHistoryEntry[]; error: string | null }> {
  const ctx = await getActiveContext("inventory.view_results");
  if (ctx.error || !ctx.accountId) return { data: [], error: ctx.error };

  const ingredientId = text(input.ingredientId);
  if (!ingredientId) return { data: [], error: "Не указана позиция" };

  try {
    const entries = await listIngredientHistory(ctx.accountId, ingredientId, true);
    return {
      data: input.currentDocumentId
        ? previousActs(entries, input.currentDocumentId, HISTORY_HOVER_LIMIT)
        : entries.slice(0, HISTORY_HOVER_LIMIT),
      error: null,
    };
  } catch (error) {
    return { data: [], error: actionErrorMessage(error, "Не удалось загрузить историю") };
  }
}

export async function updateIngredientDescription(input: {
  ingredientId: string;
  description: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const ingredientId = text(input.ingredientId);
  if (!ingredientId) return { error: "Не указана позиция" };
  const description = typeof input.description === "string" ? input.description.trim() : "";

  const admin = asLooseDb(createAdminClient());
  const ingredient = await loadIngredientRef(admin, ctx.accountId, ingredientId);
  if (!ingredient) return { error: "Позиция не найдена" };
  const before = ingredient.local_description ?? "";
  if (before === description) return { error: null };

  const { error } = await admin
    .from("ingredients")
    .update({ local_description: description || null })
    .eq("id", ingredientId)
    .eq("account_id", ctx.accountId);
  if (error) return { error: error.message };

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId,
    eventType: "description_updated",
    payload: { hasText: description.length > 0 },
    actorId: ctx.user.id,
  });
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: ctx.venueId,
    userId: ctx.user.id,
    actionCode: "catalog.ingredient.description_updated",
    entityType: "ingredient",
    entityId: ingredientId,
    details: {
      name: ingredient.name,
      kind: ingredient.kind,
      changes: [
        { field: "local_description", old: before || null, new: description || null },
      ],
    },
  });

  revalidateCatalog();
  return { error: null };
}

export async function addIngredientSupplier(input: {
  ingredientId: string;
  counterpartyId: string;
  supplierArticle?: string | null;
  supplierPrice?: number | string | null;
  isPreferred?: boolean;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const ingredientId = text(input.ingredientId);
  const counterpartyId = text(input.counterpartyId);
  if (!ingredientId) return { error: "Не указана позиция" };
  if (!counterpartyId) return { error: "Выберите контрагента-поставщика" };

  const admin = asLooseDb(createAdminClient());
  const ingredient = await loadIngredientRef(admin, ctx.accountId, ingredientId);
  if (!ingredient) return { error: "Позиция не найдена" };
  if (!(await assertOwnedCounterparty(admin, ctx.accountId, counterpartyId))) {
    return { error: "Контрагент не найден" };
  }
  // Привязка ставит контрагенту отметку «Поставщик» (триггер миграции 387).
  // Триггер журнала контрагента под служебным клиентом молчит — пишем сами.
  const { data: before } = await admin
    .from<{ is_supplier: boolean; name: string; deleted_at: string | null }>("counterparties")
    .select("is_supplier, name, deleted_at")
    .eq("id", counterpartyId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  const { error } = await admin.from("ingredient_suppliers").insert({
    account_id: ctx.accountId,
    ingredient_id: ingredientId,
    counterparty_id: counterpartyId,
    supplier_article: text(input.supplierArticle),
    supplier_price: priceNum(input.supplierPrice),
    is_preferred: Boolean(input.isPreferred),
    note: text(input.note),
  });
  if (error) {
    return {
      error: /duplicate key|unique/i.test(error.message)
        ? "Этот поставщик уже добавлен"
        : error.message,
    };
  }

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId,
    eventType: "supplier_added",
    payload: { counterpartyId },
    actorId: ctx.user.id,
  });
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: ctx.venueId,
    userId: ctx.user.id,
    actionCode: "catalog.ingredient.supplier_added",
    entityType: "ingredient",
    entityId: ingredientId,
    details: {
      name: ingredient.name,
      kind: ingredient.kind,
      counterparty_id: counterpartyId,
      counterparty_name: await counterpartyName(admin, ctx.accountId, counterpartyId),
    },
  });
  if (before && !before.is_supplier && !before.deleted_at) {
    await writeAuditEvent({
      accountId: ctx.accountId,
      userId: ctx.user.id,
      actionCode: "finance.counterparty.updated",
      entityType: "counterparty",
      entityId: counterpartyId,
      details: {
        name: before.name,
        changes: [{ field: "is_supplier", old: false, new: true }],
        reason: `поставщик позиции «${ingredient.name}»`,
      },
    });
  }

  revalidateCatalog();
  revalidatePath(`/finance/counterparties/${counterpartyId}`);
  return { error: null };
}

export async function updateIngredientSupplier(input: {
  supplierId: string;
  supplierArticle?: string | null;
  supplierPrice?: number | string | null;
  isPreferred?: boolean;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const supplierId = text(input.supplierId);
  if (!supplierId) return { error: "Не указана связка поставщика" };

  const admin = asLooseDb(createAdminClient());
  const { data: existing } = await admin
    .from<SupplierRow>("ingredient_suppliers")
    .select(
      "id, ingredient_id, counterparty_id, supplier_article, supplier_price, is_preferred, note",
    )
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!existing?.id) return { error: "Связка поставщика не найдена" };

  const next = {
    supplier_article: text(input.supplierArticle),
    supplier_price: priceNum(input.supplierPrice),
    is_preferred: Boolean(input.isPreferred),
    note: text(input.note),
  };
  const { error } = await admin
    .from("ingredient_suppliers")
    .update(next)
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId);
  if (error) return { error: error.message };

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId: existing.ingredient_id,
    eventType: "supplier_updated",
    payload: { supplierId },
    actorId: ctx.user.id,
  });
  const changes = supplierChanges(existing, next);
  if (changes.length > 0) {
    const ingredient = await loadIngredientRef(admin, ctx.accountId, existing.ingredient_id);
    await writeAuditEvent({
      accountId: ctx.accountId,
      venueId: ctx.venueId,
      userId: ctx.user.id,
      actionCode: "catalog.ingredient.supplier_updated",
      entityType: "ingredient",
      entityId: existing.ingredient_id,
      details: {
        name: ingredient?.name ?? null,
        kind: ingredient?.kind ?? null,
        counterparty_id: existing.counterparty_id,
        counterparty_name: await counterpartyName(admin, ctx.accountId, existing.counterparty_id),
        changes,
      },
    });
  }

  revalidateCatalog();
  return { error: null };
}

export async function removeIngredientSupplier(input: {
  supplierId: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const supplierId = text(input.supplierId);
  if (!supplierId) return { error: "Не указана связка поставщика" };

  const admin = asLooseDb(createAdminClient());
  const { data: existing } = await admin
    .from<{ id: string; ingredient_id: string; counterparty_id: string }>("ingredient_suppliers")
    .select("id, ingredient_id, counterparty_id")
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!existing?.id) return { error: "Связка поставщика не найдена" };

  const { error } = await admin
    .from("ingredient_suppliers")
    .delete()
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId);
  if (error) return { error: error.message };

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId: existing.ingredient_id,
    eventType: "supplier_removed",
    payload: { counterpartyId: existing.counterparty_id },
    actorId: ctx.user.id,
  });
  const ingredient = await loadIngredientRef(admin, ctx.accountId, existing.ingredient_id);
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: ctx.venueId,
    userId: ctx.user.id,
    actionCode: "catalog.ingredient.supplier_removed",
    entityType: "ingredient",
    entityId: existing.ingredient_id,
    details: {
      name: ingredient?.name ?? null,
      kind: ingredient?.kind ?? null,
      counterparty_id: existing.counterparty_id,
      counterparty_name: await counterpartyName(admin, ctx.accountId, existing.counterparty_id),
    },
  });

  revalidateCatalog();
  return { error: null };
}

type SupplierRow = {
  id: string;
  ingredient_id: string;
  counterparty_id: string;
  supplier_article: string | null;
  supplier_price: number | string | null;
  is_preferred: boolean;
  note: string | null;
};

/** Изменённые поля связки «ингредиент — поставщик» для строки журнала. */
function supplierChanges(
  before: SupplierRow,
  after: Pick<SupplierRow, "supplier_article" | "supplier_price" | "is_preferred" | "note">,
): Array<{ field: string; old: unknown; new: unknown }> {
  const out: Array<{ field: string; old: unknown; new: unknown }> = [];
  const price = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  if ((before.supplier_article ?? null) !== (after.supplier_article ?? null))
    out.push({ field: "supplier_article", old: before.supplier_article, new: after.supplier_article });
  if (price(before.supplier_price) !== price(after.supplier_price))
    out.push({ field: "supplier_price", old: price(before.supplier_price), new: price(after.supplier_price) });
  if (Boolean(before.is_preferred) !== Boolean(after.is_preferred))
    out.push({ field: "is_preferred", old: Boolean(before.is_preferred), new: Boolean(after.is_preferred) });
  if ((before.note ?? null) !== (after.note ?? null))
    out.push({ field: "note", old: before.note, new: after.note });
  return out;
}
