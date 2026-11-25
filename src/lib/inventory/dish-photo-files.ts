import "server-only";

import type { LooseDb } from "@/lib/supabase/loose";

const BUCKET = "account-attachments";

/**
 * Удалить нашу копию фото из Quick Resto, когда позиция на неё больше не
 * ссылается (фото заменили, сняли или загрузили своё). Ручные фото так не
 * удаляются — у них свой порядок. Копию из Quick Resto при нужде можно скачать
 * снова, поэтому держать её незачем.
 *
 * Файл удаляется, только если на него не ссылается ни одна позиция и ни одна
 * группа каталога: внешний ключ `on delete set null` иначе молча снял бы
 * чужое фото. Сбой удаления не мешает основной операции — только пишется в лог.
 */
export async function removeQuickRestoPhotoFile(admin: LooseDb, accountId: string, fileId: string | null): Promise<void> {
  if (!fileId) return;
  try {
    const [products, groups] = await Promise.all([
      admin.from<Array<{ id: string }>>("ingredients").select("id").eq("primary_image_file_id", fileId).limit(1),
      admin.from<Array<{ id: string }>>("ingredient_groups").select("id").eq("primary_image_file_id", fileId).limit(1),
    ]);
    if (products.error || groups.error) throw new Error((products.error ?? groups.error)?.message);
    if ((products.data?.length ?? 0) > 0 || (groups.data?.length ?? 0) > 0) return;

    const { data: deleted, error } = await admin
      .from<Array<{ storage_path: string }>>("account_files")
      .delete()
      .eq("id", fileId)
      .eq("account_id", accountId)
      .select("storage_path");
    if (error) throw new Error(error.message);
    const paths = (deleted ?? []).map((row) => row.storage_path).filter(Boolean);
    if (paths.length > 0) {
      const { error: storageError } = await admin.storage.from(BUCKET).remove(paths);
      if (storageError) throw new Error(storageError.message);
    }
  } catch (error) {
    console.error(`[dish-photos] не удалось удалить старую копию фото ${fileId}:`, error instanceof Error ? error.message : error);
  }
}
