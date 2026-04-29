"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
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
