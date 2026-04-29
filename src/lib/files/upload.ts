"use server";

import { createClient } from "@/lib/supabase/server";
import type { AccountFileRow } from "@/types/finance";

// ─── Storage path helper ─────────────────────────────────────────────────────

/**
 * Build a storage object name following the convention used by the
 * `account-attachments` bucket:
 *
 *   {accountId}/{yyyy}/{mm}/{uuid}-{name}
 *
 * The first path component is the account UUID — that's what the
 * INSERT storage policy checks (migration 045 §account_attachments_insert).
 * `name` is sanitised: anything outside `A-Z a-z 0-9 . - _` is replaced
 * with `_` so storage doesn't choke on weird filenames.
 */
function buildStoragePath(accountId: string, originalName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  return `${accountId}/${yyyy}/${mm}/${uuid}-${safe}`;
}

// ─── Public upload entry ─────────────────────────────────────────────────────

export type UploadAttachmentResult =
  | { row: AccountFileRow; error: null }
  | { row: null; error: string };

/**
 * Upload a binary blob to the `account-attachments` bucket and create
 * an `account_files` row. Caller must have `finance.upload_attachments`
 * — both the storage INSERT policy and the account_files INSERT policy
 * check it (migrations 045 §account_attachments_insert /
 * §account_files_insert).
 *
 * Flow: storage upload first → account_files insert. If the second step
 * fails, the orphan storage object is deleted to keep things tidy.
 */
export async function uploadAttachment(args: {
  /** The actual bytes to upload. Comes from a FormData field on the client. */
  file: Blob;
  /** Original filename (used for `account_files.name` and the storage path tail). */
  name: string;
  /** MIME type — must match what we send to storage. */
  mime_type: string;
}): Promise<UploadAttachmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { row: null, error: "Не авторизован" };

  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { row: null, error: "Не удалось определить активный аккаунт" };
  }

  const storagePath = buildStoragePath(accountId as unknown as string, args.name);

  const { error: uploadErr } = await supabase.storage
    .from("account-attachments")
    .upload(storagePath, args.file, {
      contentType: args.mime_type,
      upsert: false,
    });
  if (uploadErr) {
    return { row: null, error: uploadErr.message };
  }

  const { data: row, error: insertErr } = await supabase
    .from("account_files")
    .insert({
      account_id:   accountId as unknown as string,
      uploaded_by:  user.id,
      storage_path: storagePath,
      name:         args.name,
      mime_type:    args.mime_type,
      size_bytes:   args.file.size,
    })
    .select("*")
    .single();

  if (insertErr || !row) {
    // Roll back the storage object if the row insert failed; otherwise
    // we'd leave an orphan that no one can see (storage SELECT policy
    // depends on EXISTS in account_files — see migration 045).
    await supabase.storage.from("account-attachments").remove([storagePath]);
    return {
      row: null,
      error: insertErr?.message ?? "Не удалось создать запись о файле",
    };
  }

  return { row: row as AccountFileRow, error: null };
}

/**
 * Hard delete an account_files row and the underlying storage object.
 * Caller must have `finance.delete_attachments` — both the storage
 * DELETE policy and the account_files DELETE policy check it (migration
 * 045). All pivot rows (transaction_attachments, counterparty_attachments,
 * legal_entity_attachments) cascade automatically (migration 041).
 */
export async function deleteAccountFile(
  fileId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: row, error: fetchErr } = await supabase
    .from("account_files")
    .select("id, storage_path")
    .eq("id", fileId)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!row) return { error: "Файл не найден" };

  const { error: storageErr } = await supabase.storage
    .from("account-attachments")
    .remove([row.storage_path]);
  if (storageErr) return { error: storageErr.message };

  const { error: dbErr } = await supabase
    .from("account_files")
    .delete()
    .eq("id", fileId);
  if (dbErr) return { error: dbErr.message };
  return { error: null };
}
