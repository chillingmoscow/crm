"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { deleteAccountFile, uploadAttachment } from "@/lib/files/upload";
import type { AttachmentDocumentType } from "@/types/database";
import type {
  AccountFileRow,
  CounterpartyAttachmentRow,
  LegalEntityAttachmentRow,
  TransactionAttachmentRow,
} from "@/types/finance";

// ─── Joined "attachment + file" row shapes for list endpoints ───────────────
// The pivot rows by themselves don't carry name/size/MIME — those live
// on account_files. UI almost always wants the file metadata too, so the
// list endpoints below project a flattened shape.

export type TransactionAttachmentWithFile = TransactionAttachmentRow & {
  file: AccountFileRow;
};
export type CounterpartyAttachmentWithFile = CounterpartyAttachmentRow & {
  file: AccountFileRow;
};
export type LegalEntityAttachmentWithFile = LegalEntityAttachmentRow & {
  file: AccountFileRow;
};

// ─── Transaction attachments ─────────────────────────────────────────────────

export async function listTransactionAttachments(
  transactionId: string
): Promise<{ rows: TransactionAttachmentWithFile[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_attachments")
    .select("*, file:account_files(*)")
    .eq("transaction_id", transactionId);
  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []) as unknown as TransactionAttachmentWithFile[],
    error: null,
  };
}

export async function attachToTransaction(args: {
  transactionId: string;
  fileId: string;
  document_type?: AttachmentDocumentType;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("transaction_attachments").insert({
    transaction_id: args.transactionId,
    file_id:        args.fileId,
    document_type:  args.document_type ?? "receipt",
  });
  if (error) return { error: error.message };
  revalidatePath(`/finance/transactions/${args.transactionId}`);
  return { error: null };
}

export async function detachFromTransaction(args: {
  transactionId: string;
  fileId: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transaction_attachments")
    .delete()
    .eq("transaction_id", args.transactionId)
    .eq("file_id",        args.fileId);
  if (error) return { error: error.message };
  revalidatePath(`/finance/transactions/${args.transactionId}`);
  return { error: null };
}

// ─── Counterparty attachments ────────────────────────────────────────────────

export async function listCounterpartyAttachments(
  counterpartyId: string
): Promise<{ rows: CounterpartyAttachmentWithFile[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("counterparty_attachments")
    .select("*, file:account_files(*)")
    .eq("counterparty_id", counterpartyId)
    .order("document_date", { ascending: false, nullsFirst: false });
  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []) as unknown as CounterpartyAttachmentWithFile[],
    error: null,
  };
}

export async function attachToCounterparty(args: {
  counterpartyId: string;
  fileId: string;
  document_type?: AttachmentDocumentType;
  document_date?: string | null;
  document_number?: string | null;
  description?: string | null;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("counterparty_attachments").insert({
    counterparty_id: args.counterpartyId,
    file_id:         args.fileId,
    document_type:   args.document_type ?? "contract",
    document_date:   args.document_date ?? null,
    document_number: args.document_number ?? null,
    description:     args.description ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/finance/counterparties/${args.counterpartyId}`);
  return { error: null };
}

export async function detachFromCounterparty(args: {
  counterpartyId: string;
  fileId: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("counterparty_attachments")
    .delete()
    .eq("counterparty_id", args.counterpartyId)
    .eq("file_id",         args.fileId);
  if (error) return { error: error.message };
  revalidatePath(`/finance/counterparties/${args.counterpartyId}`);
  return { error: null };
}

// ─── Legal entity attachments ────────────────────────────────────────────────

export async function listLegalEntityAttachments(
  legalEntityId: string
): Promise<{ rows: LegalEntityAttachmentWithFile[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_entity_attachments")
    .select("*, file:account_files(*)")
    .eq("legal_entity_id", legalEntityId);
  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []) as unknown as LegalEntityAttachmentWithFile[],
    error: null,
  };
}

export async function attachToLegalEntity(args: {
  legalEntityId: string;
  fileId: string;
  document_type?: AttachmentDocumentType;
  description?: string | null;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("legal_entity_attachments").insert({
    legal_entity_id: args.legalEntityId,
    file_id:         args.fileId,
    document_type:   args.document_type ?? "registration_doc",
    description:     args.description ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/org/legal-entities/${args.legalEntityId}`);
  return { error: null };
}

export async function detachFromLegalEntity(args: {
  legalEntityId: string;
  fileId: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("legal_entity_attachments")
    .delete()
    .eq("legal_entity_id", args.legalEntityId)
    .eq("file_id",         args.fileId);
  if (error) return { error: error.message };
  revalidatePath(`/org/legal-entities/${args.legalEntityId}`);
  return { error: null };
}

// ─── Combined upload + attach (used by <AttachmentUploader>) ────────────────
//
// Client component flow:
//   1. user picks a file via <input type="file">,
//   2. component calls uploadAndAttach({parent, file}),
//   3. server action uploads the bytes to storage, inserts an
//      account_files row, then inserts the pivot row in one trip.
// If any step fails, the orphan storage object is removed by
// `uploadAttachment`'s rollback path (see lib/files/upload.ts).

export type AttachmentParent =
  | { kind: "transaction";   id: string }
  | { kind: "counterparty";  id: string }
  | { kind: "legal_entity";  id: string };

export async function uploadAndAttach(args: {
  parent: AttachmentParent;
  file: File;
  document_type?: AttachmentDocumentType;
}): Promise<{ fileId: string | null; error: string | null }> {
  const upload = await uploadAttachment({
    file: args.file,
    name: args.file.name,
    mime_type: args.file.type || "application/octet-stream",
  });
  if (upload.error || !upload.row) {
    return { fileId: null, error: upload.error ?? "Не удалось загрузить файл" };
  }

  let attachErr: string | null = null;
  switch (args.parent.kind) {
    case "transaction":
      ({ error: attachErr } = await attachToTransaction({
        transactionId: args.parent.id,
        fileId: upload.row.id,
        document_type: args.document_type,
      }));
      break;
    case "counterparty":
      ({ error: attachErr } = await attachToCounterparty({
        counterpartyId: args.parent.id,
        fileId: upload.row.id,
        document_type: args.document_type,
      }));
      break;
    case "legal_entity":
      ({ error: attachErr } = await attachToLegalEntity({
        legalEntityId: args.parent.id,
        fileId: upload.row.id,
        document_type: args.document_type,
      }));
      break;
  }

  if (attachErr) {
    // Roll back the orphan: storage object + account_files row. Common
    // attach failures (RLS denial on the pivot, bad parent id, unique
    // violation on (transaction_id, file_id), etc.) would otherwise
    // leave an unreferenced file accumulating in the bucket. Best-effort
    // — if cleanup itself fails, the original attach error wins.
    await deleteAccountFile(upload.row.id);
    return { fileId: null, error: attachErr };
  }
  return { fileId: upload.row.id, error: null };
}
