"use server";

// Импорт справочников и актов из Quick Resto по кнопке «Синхронизировать».
// Сам синк — в `@/lib/inventory/quickresto-sync`: тот же путь раз в три часа
// запускает фоновый обработчик.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { runQuickRestoInventorySync } from "@/lib/inventory/quickresto-sync";
import {
  type InventorySyncSummary,
  actionErrorMessage,
  getActiveContext,
  getConnection,
} from "../actions-shared";

export async function syncQuickRestoInventory(input?: {
  scope?: "documents" | "full";
}): Promise<{
  summary: InventorySyncSummary | null;
  error: string | null;
}> {
  const ctx = await getActiveContext("inventory.sync_quickresto");
  if (ctx.error || !ctx.user || !ctx.accountId) return { summary: null, error: ctx.error };

  const connection = await getConnection(ctx.accountId);
  if (!connection) return { summary: null, error: "Активное подключение Quick Resto не найдено" };

  const scope = input?.scope ?? "full";
  try {
    const summary = await runQuickRestoInventorySync({
      admin: asLooseDb(createAdminClient()),
      accountId: ctx.accountId,
      connection,
      scope,
      trigger: "manual",
      userId: ctx.user.id,
      activeVenueId: ctx.venueId,
    });

    revalidatePath("/documents/inventory");
    if (scope === "full") {
      // Синк тянет все виды номенклатуры — обновляем все разделы каталога.
      revalidatePath("/catalog/ingredients");
      revalidatePath("/catalog/dishes");
      revalidatePath("/catalog/semi-products");
      revalidatePath("/org/stores");
    }
    return { summary, error: null };
  } catch (error) {
    return {
      summary: null,
      error: actionErrorMessage(error, "Не удалось синхронизировать Quick Resto"),
    };
  }
}
