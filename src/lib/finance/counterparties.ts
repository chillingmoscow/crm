"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { findPartyByInn } from "@/lib/dadata/party";
import type {
  CounterpartyFormInput,
  CounterpartyGroupFormInput,
  CounterpartyGroupRow,
  CounterpartyRow,
} from "@/types/finance";

// ─── Read helpers ────────────────────────────────────────────────────────────

export type ListCounterpartiesOptions = {
  /** When true, includes soft-deleted rows (deleted_at is not null). */
  include_deleted?: boolean;
  group_id?: string | null;
  /** Substring search (ILIKE) over name / inn / contact_person. */
  q?: string;
};

export async function listCounterparties(
  opts: ListCounterpartiesOptions = {}
): Promise<{ rows: CounterpartyRow[]; error: string | null }> {
  const supabase = await createClient();
  let query = supabase.from("counterparties").select("*");

  if (!opts.include_deleted) query = query.is("deleted_at", null);
  if (opts.group_id !== undefined) {
    query = opts.group_id === null
      ? query.is("group_id", null)
      : query.eq("group_id", opts.group_id);
  }
  if (opts.q && opts.q.trim()) {
    const term = `%${opts.q.trim()}%`;
    query = query.or(
      `name.ilike.${term},inn.ilike.${term},contact_person.ilike.${term}`
    );
  }

  const { data, error } = await query.order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as CounterpartyRow[], error: null };
}

export async function getCounterparty(
  id: string
): Promise<{ row: CounterpartyRow | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("counterparties")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as CounterpartyRow | null) ?? null, error: null };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createCounterparty(
  input: CounterpartyFormInput
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
    .from("counterparties")
    .insert({
      account_id:     accountId as unknown as string,
      created_by:     user.id,
      name:           input.name,
      legal_form:     input.legal_form ?? "OOO",
      inn:            input.inn ?? null,
      kpp:            input.kpp ?? null,
      ogrn:           input.ogrn ?? null,
      contact_person: input.contact_person ?? null,
      phone:          input.phone ?? null,
      email:          input.email ?? null,
      address:        input.address ?? null,
      description:    input.description ?? null,
      group_id:       input.group_id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать контрагента" };
  }

  revalidatePath("/finance/counterparties");
  return { id: data.id, error: null };
}

export async function updateCounterparty(
  id: string,
  patch: Partial<CounterpartyFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("counterparties")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/finance/counterparties");
  revalidatePath(`/finance/counterparties/${id}`);
  return { error: null };
}

/**
 * Soft delete a counterparty. Composite FK on transactions does
 * ON DELETE SET NULL (counterparty_id) (migration 040), but we still
 * prefer soft delete so historical transactions retain the link.
 */
export async function softDeleteCounterparty(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("counterparties")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      is_active:  false,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/counterparties");
  return { error: null };
}

export async function restoreCounterparty(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("counterparties")
    .update({ deleted_at: null, deleted_by: null, is_active: true })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/counterparties");
  return { error: null };
}

/**
 * Refresh registry fields from DaData using the counterparty's current
 * INN. Updates ONLY DaData-derived fields (name, legal_form, kpp, ogrn,
 * legal address, etc.) and leaves user-edited extras (group, contact
 * person, phone, email, description) alone.
 */
export async function syncCounterpartyFromDadata(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: row, error: fetchErr } = await supabase
    .from("counterparties")
    .select("id, inn")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!row?.inn) return { error: "У контрагента не указан ИНН" };

  let party;
  try {
    party = await findPartyByInn(row.inn);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Ошибка обращения к DaData",
    };
  }
  if (!party) return { error: "По этому ИНН ничего не найдено в DaData" };

  const { error: updateErr } = await supabase
    .from("counterparties")
    .update({
      name:             party.name,
      legal_form:       party.legalForm,
      kpp:              party.kpp,
      ogrn:             party.ogrn,
      address:          party.legalAddress,
      dadata_synced_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
      updated_by:       user.id,
    })
    .eq("id", id);
  if (updateErr) return { error: updateErr.message };

  revalidatePath("/finance/counterparties");
  revalidatePath(`/finance/counterparties/${id}`);
  return { error: null };
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export async function listCounterpartyGroups(): Promise<{
  rows: CounterpartyGroupRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("counterparty_groups")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as CounterpartyGroupRow[], error: null };
}

export async function createCounterpartyGroup(
  input: CounterpartyGroupFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }
  const { data, error } = await supabase
    .from("counterparty_groups")
    .insert({
      account_id:  accountId as unknown as string,
      name:        input.name,
      description: input.description ?? null,
      sort_order:  input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать группу" };
  }
  revalidatePath("/finance/settings/counterparty-groups");
  return { id: data.id, error: null };
}

export async function updateCounterpartyGroup(
  id: string,
  patch: Partial<CounterpartyGroupFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("counterparty_groups")
    .update(patch)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/settings/counterparty-groups");
  return { error: null };
}

export async function deleteCounterpartyGroup(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("counterparty_groups")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/settings/counterparty-groups");
  return { error: null };
}
