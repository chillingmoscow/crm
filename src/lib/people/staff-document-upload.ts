"use client";

import { createClient } from "@/lib/supabase/client";
import { changeStaffDocument } from "@/app/(dashboard)/people/staff/actions";
import { staffDocumentPath, staffDocumentProblem } from "./staff-document-name";

/** Ошибка, текст которой можно показать пользователю как есть. */
export class StaffDocumentUploadError extends Error {}

/**
 * Загружает файл в «Документы» сотрудника: сначала в хранилище, затем
 * добавляет путь в список документов (сравнение со списком `expectedPaths`,
 * который видит экран). Возвращает путь файла и новый список документов.
 * Ошибки с понятным текстом — `StaffDocumentUploadError`; прочие (обрыв
 * сети) пробрасываются как есть.
 */
export async function uploadStaffDocument({
  venueId,
  userId,
  accountId,
  name,
  file,
  expectedPaths,
}: {
  venueId: string;
  userId: string;
  accountId: string;
  name: string;
  file: File;
  expectedPaths: string[];
}): Promise<{ path: string; paths: string[] }> {
  const problem = staffDocumentProblem(file, name);
  if (problem) throw new StaffDocumentUploadError(problem);
  const path = staffDocumentPath({
    venueId,
    userId,
    name,
    type: file.type,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
  });
  const { error } = await createClient()
    .storage.from("staff-documents")
    .upload(path, file, { contentType: file.type });
  if (error) throw new StaffDocumentUploadError(`Ошибка загрузки: ${error.message}`);
  const result = await changeStaffDocument({ userId, accountId, expectedPaths, addPath: path });
  if (result.error) throw new StaffDocumentUploadError(result.error);
  return { path, paths: result.paths ?? [...expectedPaths, path] };
}
