"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { deleteAccountFile } from "@/lib/files/upload";
import { uploadAndAttach } from "@/lib/files/attachments";

/** Файл операции для панели: имя, размер и ссылка на час. */
export type TransactionFile = {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  /** Подписанная ссылка на час: открыть файл и показать превью картинки. */
  url: string | null;
};

const URL_TTL_SECONDS = 60 * 60;
// Совпадает с `storage.file_size_limit` и лимитом тела server action (50 МБ).
// Не экспортируется: из файла "use server" можно экспортировать только функции.
const MAX_TRANSACTION_FILE_BYTES = 49 * 1024 * 1024;

/**
 * Файлы операции. Видимость — RLS: `transaction_attachments_select`
 * требует finance.view_attachments, ссылку выдаёт storage по видимой
 * строке `account_files`.
 */
export async function listTransactionFiles(
  transactionId: string,
): Promise<{ files: TransactionFile[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_attachments")
    .select("file:account_files(id, name, mime_type, size_bytes, storage_path, uploaded_at)")
    .eq("transaction_id", transactionId);
  if (error) return { files: [], error: "Не удалось загрузить файлы" };

  type FileJoin = {
    id: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    uploaded_at: string;
  };
  const rows = ((data ?? []) as unknown as { file: FileJoin | null }[])
    .map((r) => r.file)
    .filter((f): f is FileJoin => !!f)
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
  if (rows.length === 0) return { files: [], error: null };

  const { data: signed } = await supabase.storage
    .from("account-attachments")
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      URL_TTL_SECONDS,
    );
  const urlByPath = new Map(
    (signed ?? []).map((s) => [s.path, s.signedUrl ?? null] as const),
  );

  return {
    files: rows.map((r) => ({
      fileId: r.id,
      name: r.name,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      uploadedAt: r.uploaded_at,
      url: urlByPath.get(r.storage_path) ?? null,
    })),
    error: null,
  };
}

/** Прикрепить файл к операции: загрузка в хранилище + связь, откат при сбое. */
export async function uploadTransactionFile(
  transactionId: string,
  file: File,
): Promise<{ error: string | null }> {
  if (file.size > MAX_TRANSACTION_FILE_BYTES)
    return { error: `Файл «${file.name}» больше 49 МБ` };
  // У удалённой операции файлы не меняем: панель её показывает только для
  // чтения и восстановления.
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from("transactions")
    .select("id, deleted_at")
    .eq("id", transactionId)
    .maybeSingle();
  if (!tx) return { error: "Операция недоступна" };
  if (tx.deleted_at) return { error: "Операция удалена: сначала восстановите её" };

  const { error } = await uploadAndAttach({
    parent: { kind: "transaction", id: transactionId },
    file,
    document_type: "receipt",
  });
  if (error) return { error: humanizeFileError(error, "upload") };
  revalidatePath("/finance/transactions");
  return { error: null };
}

/**
 * Удалить файл операции. Файл, загруженный к операции, больше нигде не
 * используется, поэтому удаляется целиком — и из хранилища, а не только
 * открепляется: иначе в хранилище копились бы файлы, которых никто не видит.
 */
export async function deleteTransactionFile(
  transactionId: string,
  fileId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  // Удаляем только файл, прикреплённый к этой операции.
  const { data: link, error: linkError } = await supabase
    .from("transaction_attachments")
    .select("file_id")
    .eq("transaction_id", transactionId)
    .eq("file_id", fileId)
    .maybeSingle();
  if (linkError) return { error: "Не удалось удалить файл. Повторите позже" };
  if (!link) return { error: "Файл уже удалён или недоступен" };

  const { error } = await deleteAccountFile(fileId);
  if (error) return { error: humanizeFileError(error, "delete") };
  revalidatePath("/finance/transactions");
  return { error: null };
}

function humanizeFileError(message: string, action: "upload" | "delete"): string {
  if (/row-level security|permission denied|42501|Unauthorized|403/i.test(message))
    return action === "upload"
      ? "Нет прав на загрузку файлов"
      : "Нет прав на удаление файлов";
  if (/exceeded|too large|maximum allowed size|413/i.test(message))
    return "Файл больше 49 МБ";
  return action === "upload"
    ? "Не удалось загрузить файл. Повторите позже"
    : "Не удалось удалить файл. Повторите позже";
}
