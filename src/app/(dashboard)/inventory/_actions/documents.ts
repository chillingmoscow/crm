"use server";

// Жизненный цикл акта: удаление, заметка, привязка склада к точке.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  actionErrorMessage,
  assertDocumentVisible,
  filterVisibleDocumentIds,
  getActiveContext,
  text
} from "../actions-shared";

/**
 * Проведённый акт удалять нельзя: вместе со строкой documents каскадом уходят
 * снимок утверждённых итогов, пересорты и журнал решений — то есть вся
 * доказательная база по уже закрытой инвентаризации. Право
 * inventory.manage_documents такого разрешения не подразумевает.
 *
 * Условие живёт в самом DELETE (см. deleteInventoryDocument), а не в
 * предварительном SELECT: отдельная проверка «сначала прочитали, потом
 * удалили» и открывала окно, в котором акт успевали провести между этими
 * двумя шагами, и падала бы открытой при ошибке чтения (data=null читалось
 * как «блокировать нечего»). Сколько строк реально удалено, DELETE сообщает
 * сам — по нему и считаем пропущенные.
 */
const DELETE_BLOCKED_MESSAGE =
  "Проведённый акт удалить нельзя — вместе с ним пропадут утверждённые итоги и журнал решений. Если акт больше не нужен, удалите его в Quick Resto: синхронизация уберёт его и здесь.";

/**
 * Удаление акта инвентаризации. Полное delete с каскадом по FK
 * (document_items → on delete cascade из миграции 122). Требуется
 * право inventory.manage_documents.
 *
 * Caveat для актов, синхронизированных с Quick Resto (external_id != null):
 * следующая синхронизация может вернуть удалённый акт. Это нормальное
 * поведение — Quick Resto источник истины. Хочешь убрать навсегда —
 * удаляй и в QR.
 */
export async function deleteInventoryDocument(input: {
  documentId: string;
}): Promise<{ error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) {
      return { error: ctx.error ?? "Не удалось определить контекст" };
    }
    const admin = asLooseDb(createAdminClient());
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });

    const { data: deleted, error } = await admin
      .from<Array<{ id: string }>>("documents")
      .delete()
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .neq("status", "processed")
      .is("results_snapshot_at", null)
      .select("id");
    if (error) return { error: error.message };
    // Ноль удалённых строк при видимом акте = сработало условие: акт успели
    // провести или зафиксировать.
    if ((deleted ?? []).length === 0) return { error: DELETE_BLOCKED_MESSAGE };
    revalidatePath("/documents/inventory");
    return { error: null };
  } catch (e) {
    console.error("[deleteInventoryDocument] unhandled error:", e);
    return {
      error:
        e instanceof Error && e.message
          ? e.message
          : "Не удалось удалить акт. Подробности в логах.",
    };
  }
}

/**
 * Массовое удаление актов (из плавающего bulk-бара). Право
 * inventory.manage_documents. Каскад по FK. Тот же caveat про QR, что и у
 * одиночного delete: QR-акты могут вернуться при следующей синхронизации.
 */
export async function bulkDeleteInventoryDocuments(input: {
  documentIds: string[];
}): Promise<{ deleted: number; error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) {
      return { deleted: 0, error: ctx.error ?? "Не удалось определить контекст" };
    }
    const ids = Array.from(new Set(input.documentIds)).filter(Boolean);
    if (ids.length === 0) return { deleted: 0, error: "Не выбрано ни одного акта" };

    const admin = asLooseDb(createAdminClient());
    // Массиву id с клиента не доверяем: оставляем только те акты, которые
    // пользователь реально видит (RLS documents_select).
    const visible = await filterVisibleDocumentIds({ supabase: ctx.supabase, documentIds: ids });
    const visibleIds = ids.filter((id) => visible.has(id));
    if (visibleIds.length === 0) return { deleted: 0, error: "Акты не найдены" };

    const { data: deletedRows, error } = await admin
      .from<Array<{ id: string }>>("documents")
      .delete()
      .eq("account_id", ctx.accountId)
      .in("id", visibleIds)
      .neq("status", "processed")
      .is("results_snapshot_at", null)
      .select("id");
    if (error) return { deleted: 0, error: error.message };

    const deletedCount = (deletedRows ?? []).length;
    if (deletedCount === 0) return { deleted: 0, error: DELETE_BLOCKED_MESSAGE };

    revalidatePath("/documents/inventory");
    return {
      deleted: deletedCount,
      error:
        deletedCount < visibleIds.length
          ? `Пропущено проведённых актов: ${visibleIds.length - deletedCount}. ${DELETE_BLOCKED_MESSAGE}`
          : null,
    };
  } catch (e) {
    console.error("[bulkDeleteInventoryDocuments] unhandled error:", e);
    return {
      deleted: 0,
      error:
        e instanceof Error && e.message ? e.message : "Не удалось удалить акты. Подробности в логах.",
    };
  }
}

/**
 * Общий комментарий к акту (таб «Основное»). Локальное поле documents.note,
 * sync его не трогает. Редактировать может управляющий актами
 * (`inventory.manage_documents`), назначенный исполнитель или проверяющий —
 * остальным поле read-only.
 */
export async function updateInventoryDocumentNote(input: {
  documentId: string;
  note: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext();
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Ошибка" };

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    const { data: document } = await admin
      .from<{ id: string; assigned_to: string | null; reviewer_id: string | null; archived_at: string | null }>(
        "documents",
      )
      .select("id, assigned_to, reviewer_id, archived_at")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!document?.id) throw new Error("Акт не найден");
    if (document.archived_at) throw new Error("Этот акт удалён в Quick Resto и недоступен для изменений.");

    const [{ data: canManage }, { data: canRecount }] = await Promise.all([
      ctx.supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
      ctx.supabase.rpc("has_permission", { permission_code: "inventory.recount_documents" }),
    ]);
    const canEdit =
      Boolean(canManage) ||
      document.assigned_to === ctx.user.id ||
      (document.reviewer_id === ctx.user.id && Boolean(canRecount));
    if (!canEdit) throw new Error("Недостаточно прав для редактирования комментария");

    const note = text(input.note);
    const { error } = await admin
      .from("documents")
      .update({ note })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    revalidatePath(`/documents/inventory/${input.documentId}/overview`);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось сохранить комментарий") };
  }
}

export async function updateInventoryStoreVenue(input: {
  storeId: string;
  venueId: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_stores");
  if (ctx.error || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  // venueId приходит с клиента: без проверки склад (а за ним, через триггер
  // миграции 194, и все его акты) уезжал в заведение чужого аккаунта.
  if (input.venueId) {
    const { data: venue } = await admin
      .from<{ id: string }>("venues")
      .select("id")
      .eq("id", input.venueId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!venue?.id) return { error: "Заведение не найдено" };
  }

  const { error } = await admin
    .from("stores")
    .update({ local_venue_id: input.venueId || null })
    .eq("id", input.storeId)
    .eq("account_id", ctx.accountId);

  if (error) return { error: error.message };

  // Пропагация venue в documents.venue_id — на уровне БД (триггер
  // trg_stores_propagate_venue_to_documents, миграция 194), атомарно
  // в той же транзакции UPDATE stores. Второй write из app не нужен.
  revalidatePath("/org/stores");
  return { error: null };
}
