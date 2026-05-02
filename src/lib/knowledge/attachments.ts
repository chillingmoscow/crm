"use server";

import { createClient } from "@/lib/supabase/server";
import { getFileSignedUrl } from "@/lib/files/signed-urls";

/**
 * Storage path шаблон тот же, что у Finance — bucket account-attachments,
 * первая папка = account_id (см. миграции 045 / 054 storage policies).
 */
function buildKbStoragePath(accountId: string, originalName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  return `${accountId}/${yyyy}/${mm}/${uuid}-${safe}`;
}

export type UploadKbAttachmentArgs = {
  pageId: string;
  file: Blob;
  name: string;
  mime_type: string;
};

export type UploadKbAttachmentResult =
  | { url: string; file_id: string; storage_path: string; error: null }
  | { url: null; file_id: null; storage_path: null; error: string };

/**
 * Upload бинарника в `account-attachments`, создание строки `account_files`,
 * привязка к странице через `kb_page_attachments`, и возврат **signed
 * URL** (TTL 1 час), готового для рендера в BlockNote-блоке.
 *
 * Авторизация: `kb.manage_attachments` (storage RLS из 054 +
 * account_files INSERT из 050 + kb_page_attachments INSERT из 050).
 *
 * Откат: если пивот не удалось вставить, удаляем и storage-объект,
 * и account_files-строку — иначе остаётся ничейный файл.
 */
export async function uploadKbAttachment(
  args: UploadKbAttachmentArgs,
): Promise<UploadKbAttachmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { url: null, file_id: null, storage_path: null, error: "Не авторизован" };
  }

  const { data: accountId, error: accErr } = await supabase.rpc(
    "get_active_account_id",
  );
  if (accErr || !accountId) {
    return {
      url: null,
      file_id: null,
      storage_path: null,
      error: "Не удалось определить активный аккаунт",
    };
  }

  const storagePath = buildKbStoragePath(accountId as unknown as string, args.name);

  // 1. Storage upload.
  const { error: upErr } = await supabase.storage
    .from("account-attachments")
    .upload(storagePath, args.file, { contentType: args.mime_type, upsert: false });
  if (upErr) {
    return { url: null, file_id: null, storage_path: null, error: upErr.message };
  }

  // 2. account_files row.
  const { data: fileRow, error: fileErr } = await supabase
    .from("account_files")
    .insert({
      account_id: accountId as unknown as string,
      uploaded_by: user.id,
      storage_path: storagePath,
      name: args.name,
      mime_type: args.mime_type,
      size_bytes: args.file.size,
    })
    .select("id")
    .single();
  if (fileErr || !fileRow) {
    await supabase.storage.from("account-attachments").remove([storagePath]);
    return {
      url: null,
      file_id: null,
      storage_path: null,
      error: fileErr?.message ?? "Не удалось создать запись о файле",
    };
  }

  // 3. Pivot — привязка к странице.
  const { error: pivotErr } = await supabase.from("kb_page_attachments").insert({
    page_id: args.pageId,
    file_id: fileRow.id,
    attached_by: user.id,
  });
  if (pivotErr) {
    // Compensating delete — без пивота файл «осиротеет» (account_files
    // SELECT-политика проверяет EXISTS в pivot-таблицах).
    await supabase.from("account_files").delete().eq("id", fileRow.id);
    await supabase.storage.from("account-attachments").remove([storagePath]);
    return {
      url: null,
      file_id: null,
      storage_path: null,
      error: pivotErr.message,
    };
  }

  // 4. Signed URL — для немедленного рендера в редакторе.
  const { url, error: urlErr } = await getFileSignedUrl(fileRow.id);
  if (urlErr || !url) {
    return {
      url: null,
      file_id: null,
      storage_path: null,
      error: urlErr ?? "Не удалось получить ссылку на файл",
    };
  }

  return { url, file_id: fileRow.id, storage_path: storagePath, error: null };
}

/** Получить (refreshed) signed URL по storage_path — нужно при загрузке
 *  сохранённой страницы, потому что в `content` jsonb хранится только
 *  storage_path, а не сам URL (тот был бы expired). */
export async function getKbAttachmentSignedUrl(
  storagePath: string,
): Promise<{ url: string | null; error: string | null }> {
  const supabase = await createClient();
  // Lookup file_id по storage_path → берём signed URL через общий хелпер.
  const { data, error } = await supabase
    .from("account_files")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (error) return { url: null, error: error.message };
  if (!data) return { url: null, error: "Файл не найден или доступ закрыт" };
  return getFileSignedUrl(data.id);
}
