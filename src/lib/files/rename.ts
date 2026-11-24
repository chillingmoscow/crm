"use server";

import { revalidatePath } from "next/cache";

import { errorText } from "@/lib/actions/error-text";
import { renameFileName } from "@/lib/files/file-name";
import { createClient } from "@/lib/supabase/server";

/**
 * Переименовать документ контрагента. Расширение исходного файла
 * сохраняется. Права — RLS (миграция 386): только колонка name, только
 * файлы контрагентов, только с finance.upload_attachments.
 */
export async function renameCounterpartyFile(args: {
  fileId: string;
  name: string;
}): Promise<{ name: string | null; error: string | null }> {
  try {
    const supabase = await createClient();
    // Контрагента берём из связки файла, а не из запроса: им же обновляем страницу.
    const { data: link } = await supabase
      .from("counterparty_attachments")
      .select("counterparty_id")
      .eq("file_id", args.fileId)
      .maybeSingle();
    if (!link) return { name: null, error: "Файл не найден или доступ закрыт" };
    const { data: current, error: fetchErr } = await supabase
      .from("account_files")
      .select("name")
      .eq("id", args.fileId)
      .maybeSingle();
    if (fetchErr) return { name: null, error: errorText(fetchErr, "Не удалось переименовать файл") };
    if (!current) return { name: null, error: "Файл не найден или доступ закрыт" };

    const next = renameFileName(current.name, args.name);
    if (next.error !== null) return { name: null, error: next.error };
    if (next.name === current.name) return { name: next.name, error: null };

    const { data: updated, error } = await supabase
      .from("account_files")
      .update({ name: next.name })
      .eq("id", args.fileId)
      .select("id");
    if (error) return { name: null, error: errorText(error, "Не удалось переименовать файл") };
    if (!updated || updated.length === 0) return { name: null, error: "Нет прав на переименование файлов" };

    revalidatePath(`/finance/counterparties/${link.counterparty_id}`);
    return { name: next.name, error: null };
  } catch (error) {
    return { name: null, error: errorText(error, "Не удалось переименовать файл") };
  }
}
