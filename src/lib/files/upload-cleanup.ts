import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Убрать только что загруженный файл, который не удалось прикрепить.
 *
 * Service-role, потому что у загрузившего может не быть права
 * finance.delete_attachments: обычным клиентом удаление молча ничего не
 * делает, и в хранилище копились бы файлы, которых никто не видит.
 * Безопасно: вызывается только сервером для файла, который этот же запрос
 * только что создал; удаляется ровно эта пара «id + путь».
 *
 * Не "use server": модуль не становится действием, доступным из браузера.
 */
export async function removeFreshUpload(args: {
  fileId: string | null;
  storagePath: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error: storageError } = await admin.storage
    .from("account-attachments")
    .remove([args.storagePath]);
  if (storageError)
    console.error(`[files] не удалось убрать загрузку ${args.storagePath}: ${storageError.message}`);
  if (args.fileId) {
    const { error } = await admin
      .from("account_files")
      .delete()
      .eq("id", args.fileId)
      .eq("storage_path", args.storagePath);
    if (error) console.error(`[files] не удалось убрать запись файла ${args.fileId}: ${error.message}`);
  }
}
