"use server";

import { errorText } from "@/lib/actions/error-text";
import { writeAuditEvent } from "@/lib/audit/write";
import { uploadAndAttach } from "@/lib/files/attachments";
import { deleteAccountFile } from "@/lib/files/upload";
import { createClient, getCachedActiveAccountId, getCachedUser } from "@/lib/supabase/server";

/**
 * Документы контрагента с записью в журнал контрагента. Права — те же RLS,
 * что у общих действий с файлами; журнал пишем только после того, как
 * запись правда прошла.
 */

async function actor(): Promise<{ accountId: string; userId: string } | null> {
  const [user, accountId] = await Promise.all([getCachedUser(), getCachedActiveAccountId()]);
  return user && accountId ? { accountId, userId: user.id } : null;
}

export async function uploadCounterpartyDocument(
  counterpartyId: string,
  file: File,
): Promise<{ error: string | null }> {
  try {
    const { fileId, error } = await uploadAndAttach({
      parent: { kind: "counterparty", id: counterpartyId },
      file,
    });
    if (error || !fileId) return { error: errorText(error, "Не удалось загрузить файл") };
    const who = await actor();
    if (who) {
      await writeAuditEvent({
        ...who,
        actionCode: "finance.counterparty_document.created",
        entityType: "counterparty",
        entityId: counterpartyId,
        details: { name: file.name, file_id: fileId },
      });
    }
    return { error: null };
  } catch (error) {
    return { error: errorText(error, "Не удалось загрузить файл") };
  }
}

export async function deleteCounterpartyDocument(fileId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { data: link } = await supabase
      .from("counterparty_attachments")
      .select("counterparty_id, file:account_files(name)")
      .eq("file_id", fileId)
      .maybeSingle();
    if (!link) return { error: "Файл не найден или доступ закрыт" };

    const { error } = await deleteAccountFile(fileId);
    if (error) return { error: errorText({ message: error }, "Не удалось удалить файл") };

    const who = await actor();
    if (who) {
      const file = link.file as { name?: string } | null;
      await writeAuditEvent({
        ...who,
        actionCode: "finance.counterparty_document.deleted",
        entityType: "counterparty",
        entityId: link.counterparty_id,
        details: { name: file?.name ?? null, file_id: fileId },
      });
    }
    return { error: null };
  } catch (error) {
    return { error: errorText(error, "Не удалось удалить файл") };
  }
}
