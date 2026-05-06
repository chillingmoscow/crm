"use server";

import { createClient } from "@/lib/supabase/server";
import { getFileSignedUrl } from "@/lib/files/signed-urls";

export { getFileSignedUrl };

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
  | { file_id: string; storage_path: string; error: null }
  | { file_id: null; storage_path: null; error: string };

/**
 * Upload бинарника в `account-attachments`, создание строки `account_files`
 * и привязка к странице через `kb_page_attachments`. Возвращает file_id +
 * storage_path — signed URL мы НЕ генерируем здесь (BlockNote вызовет
 * resolveFileUrl на каждом рендере, который подпишет URL на 1 час).
 *
 * Авторизация: `kb.manage_attachments` (storage RLS из 054/055 +
 * account_files INSERT из 050 + kb_page_attachments INSERT из 050).
 *
 * Раньше делал 4 sequential round-trip'а к Supabase (auth.getUser →
 * get_active_account_id → storage.upload → account_files INSERT →
 * kb_page_attachments INSERT) — под нагрузкой self-hosted PG pool
 * исчерпывался ("Timed out acquiring connection from connection pool",
 * 30+ сек на 1MB файл). С миграции 107 шаги «get account + 2 INSERT»
 * объединены в один RPC `kb_register_attachment` (SECURITY INVOKER,
 * RLS применяется внутри). Итого: 2 round-trip'а вместо 4 (1 storage +
 * 1 RPC), pool footprint падает 3 → 1 connection per upload.
 *
 * Откат: storage-upload отдельно, поэтому если RPC упадёт после успеха
 * storage-upload'а — нужно вручную удалить storage-объект (compensating
 * delete). Двух INSERT'ов в RPC автоматически atomic — если pivot
 * упал, account_files INSERT откатывается транзакцией Postgres.
 */
export async function uploadKbAttachment(
  args: UploadKbAttachmentArgs,
): Promise<UploadKbAttachmentResult> {
  const supabase = await createClient();

  // accountId нужен для storage-path шаблона (`{account}/{yyyy}/{mm}/...`).
  // Это ОДИН маленький RPC — отдельно от kb_register_attachment, потому
  // что сам storagePath передаётся в storage.upload (HTTP к storage-
  // service), а только потом — в RPC (PG). Но в новой архитектуре всё
  // равно избавились от auth.getUser() — userId резолвится внутри RPC
  // через auth.uid().
  const { data: accountId, error: accErr } = await supabase.rpc(
    "get_active_account_id",
  );
  if (accErr || !accountId) {
    return {
      file_id: null,
      storage_path: null,
      error: "Не удалось определить активный аккаунт",
    };
  }

  const storagePath = buildKbStoragePath(accountId as unknown as string, args.name);

  // 1. Storage upload — отдельный HTTP-call к storage-service. Не
  //    шарит pool с PG; consolidate'ить с RPC нельзя.
  const { error: upErr } = await supabase.storage
    .from("account-attachments")
    .upload(storagePath, args.file, { contentType: args.mime_type, upsert: false });
  if (upErr) {
    return { file_id: null, storage_path: null, error: upErr.message };
  }

  // 2. Один RPC: account_files INSERT + kb_page_attachments INSERT
  //    в одной серверной транзакции. RLS политики применяются внутри
  //    SECURITY INVOKER функции — авторизация под юзером, как раньше.
  //    См. миграцию 107.
  const { data: fileId, error: rpcErr } = await supabase.rpc(
    "kb_register_attachment",
    {
      p_storage_path: storagePath,
      p_name: args.name,
      p_mime_type: args.mime_type,
      p_size_bytes: args.file.size,
      p_page_id: args.pageId,
    },
  );
  if (rpcErr || !fileId) {
    // Compensating delete: storage-объект уже создан, но БД-записей нет
    // (RPC atomic — оба INSERT'а откатились). Без удаления storage
    // получим ничейный blob в bucket'е.
    await supabase.storage.from("account-attachments").remove([storagePath]);
    return {
      file_id: null,
      storage_path: null,
      error: rpcErr?.message ?? "Не удалось зарегистрировать файл",
    };
  }

  return {
    file_id: fileId as unknown as string,
    storage_path: storagePath,
    error: null,
  };
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
