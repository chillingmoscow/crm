"use server";

// Каталог: картинки позиций и групп, описание и поставщики ингредиента.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { getIngredientDetail, type IngredientDetail } from "@/lib/inventory/ingredients";
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
  if (!productId) return { error: "Не указан ингредиент" };
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите изображение" };
  if (!file.type.startsWith("image/")) return { error: "Можно загрузить только изображение" };

  const admin = asLooseDb(createAdminClient());
  const { data: product } = await admin
    .from<{ id: string }>("ingredients")
    .select("id")
    .eq("id", productId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!product?.id) return { error: "Ингредиент не найден" };

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
    .update({ primary_image_file_id: fileRow.id })
    .eq("id", productId)
    .eq("account_id", ctx.accountId);
  if (productError) return { error: productError.message };

  revalidatePath("/catalog/ingredients");
  revalidatePath(`/catalog/ingredients/${productId}`);
  return { error: null };
}

export async function uploadInventoryProductGroupImage(formData: FormData): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const groupId = text(formData.get("groupId"));
  const file = formData.get("file");
  if (!groupId) return { error: "Не указана группа ингредиентов" };
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите изображение" };
  if (!file.type.startsWith("image/")) return { error: "Можно загрузить только изображение" };

  const admin = asLooseDb(createAdminClient());
  const { data: group } = await admin
    .from<{ id: string }>("ingredient_groups")
    .select("id")
    .eq("id", groupId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!group?.id) return { error: "Группа ингредиентов не найдена" };

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

  revalidatePath("/catalog/ingredients");
  return { error: null };
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

async function assertOwnedIngredient(admin: LooseDb, accountId: string, ingredientId: string) {
  const { data } = await admin
    .from<{ id: string }>("ingredients")
    .select("id")
    .eq("id", ingredientId)
    .eq("account_id", accountId)
    .maybeSingle();
  return Boolean(data?.id);
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

export async function updateIngredientDescription(input: {
  ingredientId: string;
  description: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const ingredientId = text(input.ingredientId);
  if (!ingredientId) return { error: "Не указан ингредиент" };
  const description = typeof input.description === "string" ? input.description.trim() : "";

  const admin = asLooseDb(createAdminClient());
  if (!(await assertOwnedIngredient(admin, ctx.accountId, ingredientId))) {
    return { error: "Ингредиент не найден" };
  }

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

  revalidatePath(`/catalog/ingredients/${ingredientId}`);
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
  if (!ingredientId) return { error: "Не указан ингредиент" };
  if (!counterpartyId) return { error: "Выберите контрагента-поставщика" };

  const admin = asLooseDb(createAdminClient());
  if (!(await assertOwnedIngredient(admin, ctx.accountId, ingredientId))) {
    return { error: "Ингредиент не найден" };
  }
  if (!(await assertOwnedCounterparty(admin, ctx.accountId, counterpartyId))) {
    return { error: "Контрагент не найден" };
  }

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
        ? "Этот поставщик уже добавлен к ингредиенту"
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

  revalidatePath(`/catalog/ingredients/${ingredientId}`);
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
    .from<{ id: string; ingredient_id: string }>("ingredient_suppliers")
    .select("id, ingredient_id")
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!existing?.id) return { error: "Связка поставщика не найдена" };

  const { error } = await admin
    .from("ingredient_suppliers")
    .update({
      supplier_article: text(input.supplierArticle),
      supplier_price: priceNum(input.supplierPrice),
      is_preferred: Boolean(input.isPreferred),
      note: text(input.note),
    })
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

  revalidatePath(`/catalog/ingredients/${existing.ingredient_id}`);
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

  revalidatePath(`/catalog/ingredients/${existing.ingredient_id}`);
  return { error: null };
}
