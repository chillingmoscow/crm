"use server";

import { createClient } from "@/lib/supabase/server";
import { findPartyByInn } from "@/lib/dadata/party";
import { revalidatePath } from "next/cache";
import type { LegalForm, TaxSystem } from "@/types/database";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LegalEntityRow {
  id: string;
  account_id: string;
  name: string;
  short_name: string | null;
  legal_form: LegalForm;

  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  okpo: string | null;
  okved: string | null;

  tax_system: TaxSystem | null;
  vat_payer: boolean;

  legal_address: string | null;
  actual_address: string | null;
  postal_address: string | null;

  director_name: string | null;
  director_position: string | null;
  accountant_name: string | null;
  signature_basis: string | null;

  phone: string | null;
  email: string | null;
  website: string | null;

  default_bank_name: string | null;
  default_bik: string | null;
  default_account_number: string | null;
  default_corr_account: string | null;

  dadata_synced_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export type LegalEntityFormInput = {
  name: string;
  short_name?: string | null;
  legal_form: LegalForm;

  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  okpo?: string | null;
  okved?: string | null;

  tax_system?: TaxSystem | null;
  vat_payer?: boolean;

  legal_address?: string | null;
  actual_address?: string | null;
  postal_address?: string | null;

  director_name?: string | null;
  director_position?: string | null;
  accountant_name?: string | null;
  signature_basis?: string | null;

  phone?: string | null;
  email?: string | null;
  website?: string | null;

  default_bank_name?: string | null;
  default_bik?: string | null;
  default_account_number?: string | null;
  default_corr_account?: string | null;
};

// ─── Read helpers ────────────────────────────────────────────────────────────

/**
 * List legal entities in the active account. RLS filters by
 * account_id = get_active_account_id() AND requires
 * org.view_legal_entities (see migration 034).
 */
export async function listLegalEntities(): Promise<{
  rows: LegalEntityRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_entities")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as LegalEntityRow[], error: null };
}

/**
 * Fetch a single legal entity by id. Returns null if not found / not
 * accessible to the caller (RLS hides cross-tenant rows).
 */
export async function getLegalEntity(
  id: string
): Promise<{ row: LegalEntityRow | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_entities")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as LegalEntityRow | null) ?? null, error: null };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Create a legal entity in the active account. Caller must have
 * org.manage_legal_entities — RLS enforces this.
 */
export async function createLegalEntity(
  input: LegalEntityFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }

  const { data, error } = await supabase
    .from("legal_entities")
    .insert({
      account_id: accountId as unknown as string,
      created_by: user.id,
      name:                   input.name,
      short_name:             input.short_name ?? null,
      legal_form:             input.legal_form,
      inn:                    input.inn ?? null,
      kpp:                    input.kpp ?? null,
      ogrn:                   input.ogrn ?? null,
      okpo:                   input.okpo ?? null,
      okved:                  input.okved ?? null,
      tax_system:             input.tax_system ?? null,
      vat_payer:              input.vat_payer ?? false,
      legal_address:          input.legal_address ?? null,
      actual_address:         input.actual_address ?? null,
      postal_address:         input.postal_address ?? null,
      director_name:          input.director_name ?? null,
      director_position:      input.director_position ?? null,
      accountant_name:        input.accountant_name ?? null,
      signature_basis:        input.signature_basis ?? null,
      phone:                  input.phone ?? null,
      email:                  input.email ?? null,
      website:                input.website ?? null,
      default_bank_name:      input.default_bank_name ?? null,
      default_bik:            input.default_bik ?? null,
      default_account_number: input.default_account_number ?? null,
      default_corr_account:   input.default_corr_account ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать юрлицо" };
  }

  revalidatePath("/org/legal-entities");
  return { id: data.id, error: null };
}

/**
 * Patch a legal entity. RLS gates on org.manage_legal_entities and
 * tenant match. Pass only the fields you want to change.
 */
export async function updateLegalEntity(
  id: string,
  patch: Partial<LegalEntityFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("legal_entities")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/org/legal-entities");
  revalidatePath(`/org/legal-entities/${id}`);
  return { error: null };
}

/**
 * Soft-deactivate a legal entity by toggling is_active = false. Hard
 * delete is gated on org.delete_legal_entity (owner only). Hard delete
 * also fails if any venue still has it as default_legal_entity_id —
 * that's enforced by the ON DELETE RESTRICT FK from migration 036.
 */
export async function deactivateLegalEntity(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("legal_entities")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/org/legal-entities");
  return { error: null };
}

/**
 * Hard delete a legal entity. Only owner has this in the default
 * matrix; RLS will reject for everyone else.
 */
export async function deleteLegalEntity(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("legal_entities").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/org/legal-entities");
  return { error: null };
}

/**
 * Refresh registry fields from DaData using the entity's current INN.
 * Updates ONLY DaData-derived fields and does not touch user-edited
 * extras (banking, accountant, signature basis, etc.).
 *
 * Returns { error } on failure. Sets dadata_synced_at to now() on success.
 */
export async function syncLegalEntityFromDadata(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: row, error: fetchErr } = await supabase
    .from("legal_entities")
    .select("id, inn")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!row?.inn) return { error: "У юрлица не указан ИНН" };

  let party;
  try {
    party = await findPartyByInn(row.inn);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Ошибка обращения к DaData",
    };
  }
  if (!party) {
    return { error: "По этому ИНН ничего не найдено в DaData" };
  }

  const { error: updateErr } = await supabase
    .from("legal_entities")
    .update({
      name:               party.name,
      short_name:         party.shortName,
      legal_form:         party.legalForm,
      kpp:                party.kpp,
      ogrn:               party.ogrn,
      okpo:               party.okpo,
      okved:              party.okved,
      legal_address:      party.legalAddress,
      director_name:      party.directorName,
      director_position:  party.directorPosition,
      dadata_synced_at:   new Date().toISOString(),
      updated_at:         new Date().toISOString(),
      updated_by:         user.id,
    })
    .eq("id", id);

  if (updateErr) return { error: updateErr.message };

  revalidatePath("/org/legal-entities");
  revalidatePath(`/org/legal-entities/${id}`);
  return { error: null };
}
