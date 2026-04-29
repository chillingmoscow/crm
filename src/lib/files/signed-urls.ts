"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Default signed URL TTL (1 hour). Long enough for a user to click
 * through to a doc and download it, short enough that links don't
 * leak indefinitely if they end up in browser history or chat logs.
 */
const DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * Get a time-limited signed URL to download a file from the
 * `account-attachments` bucket.
 *
 * Authorization: storage SELECT RLS (migration 045) checks that an
 * account_files row exists for the requested storage path AND is
 * visible to the caller. Visibility itself is gated by RLS on
 * account_files — which requires the file to be attached to a
 * transaction / counterparty / legal entity the caller can see, OR
 * for the caller to be the original uploader.
 *
 * Returns { url: null, error } when RLS denies the lookup.
 */
export async function getFileSignedUrl(
  fileId: string,
  expiresInSeconds: number = DEFAULT_TTL_SECONDS
): Promise<{ url: string | null; error: string | null }> {
  const supabase = await createClient();

  const { data: row, error: fetchErr } = await supabase
    .from("account_files")
    .select("storage_path")
    .eq("id", fileId)
    .maybeSingle();
  if (fetchErr) return { url: null, error: fetchErr.message };
  if (!row) return { url: null, error: "Файл не найден или доступ закрыт" };

  const { data, error } = await supabase.storage
    .from("account-attachments")
    .createSignedUrl(row.storage_path, expiresInSeconds);
  if (error || !data) {
    return { url: null, error: error?.message ?? "Не удалось получить ссылку" };
  }
  return { url: data.signedUrl, error: null };
}
