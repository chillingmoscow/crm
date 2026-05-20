"use server";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
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
  archived_at: string | null;
  archived_by: string | null;
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
  // Codex P1 #373: полагаться только на RLS нельзя — owner получает и
  // live, и archived через legal_entities_select_archived_owner
  // (PERMISSIVE → OR). Архивные просочились бы во все выборы юрлица.
  // Фильтруем archived_at IS NULL явно; архив-страница использует свой
  // запрос с снятым фильтром.
  const { data, error } = await supabase
    .from("legal_entities")
    .select("*")
    .is("archived_at" as never, null)
    .order("created_at", { ascending: true });
  if (error) return { rows: [], error: error.message };
  // archived_at/_by — миграция 200, ещё не в Database-типах
  return { rows: (data ?? []) as unknown as LegalEntityRow[], error: null };
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

// ────────────────────────────────────────────────────────────────────────
//  Archive / Restore / Hard-delete — docs/CONVENTIONS.md §2
//
//  Юрлица — **archive-only по дизайну**: hard-delete блокируется FK с
//  ON DELETE RESTRICT (bank_accounts, transactions, venues
//  default_legal_entity_id — миграции 036/040/053). UI скрывает кнопку
//  «Удалить навсегда» с tooltip-объяснением.
//
//  Action deleteLegalEntity сохранён для технической полноты — он
//  отработает, если все RESTRICT-ссылки сняты вручную (например,
//  миграция данных). RESTRICT-precheck возвращает дружелюбную ошибку
//  и список блокеров, чтобы пользователь понял что нужно сделать.
// ────────────────────────────────────────────────────────────────────────

export type LegalEntityArchiveImpact = {
  bankAccounts: number;
  transactions: number;
  attachments: number;
  /** Заведения, использующие это юрлицо как default. */
  venuesAsDefault: number;
};

async function assertLegalEntityOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  legalEntityId: string,
  userId: string,
): Promise<{ ok: true; account_id: string; name: string } | { ok: false; error: string }> {
  const db = asLooseDb(supabase);
  const { data: row } = await db
    .from<{ id: string; name: string; account_id: string }>("legal_entities")
    .select("id, name, account_id")
    .eq("id", legalEntityId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Юрлицо не найдено" };

  const { data: account } = await supabase
    .from("accounts")
    .select("owner_id")
    .eq("id", row.account_id)
    .maybeSingle();
  if (!account || account.owner_id !== userId) {
    return { ok: false, error: "Действие доступно только владельцу аккаунта" };
  }
  return { ok: true, account_id: row.account_id, name: row.name };
}

export async function getLegalEntityArchiveImpact(
  id: string
): Promise<LegalEntityArchiveImpact> {
  const supabase = await createClient();
  const headOpts = { count: "exact" as const, head: true };

  const [bankAccounts, transactions, attachments, venuesAsDefault] = await Promise.all([
    supabase.from("bank_accounts").select("id", headOpts).eq("legal_entity_id", id),
    supabase.from("transactions").select("id", headOpts).eq("legal_entity_id", id),
    supabase.from("legal_entity_attachments").select("id", headOpts).eq("legal_entity_id", id),
    supabase.from("venues").select("id", headOpts).eq("default_legal_entity_id", id),
  ]);

  return {
    bankAccounts: bankAccounts.count ?? 0,
    transactions: transactions.count ?? 0,
    attachments: attachments.count ?? 0,
    venuesAsDefault: venuesAsDefault.count ?? 0,
  };
}

/**
 * Архивирует юрлицо. Соответствует docs/CONVENTIONS.md §2.
 * Раньше эта семантика была `deactivateLegalEntity` (is_active=false);
 * миграция 200 переименовала колонку и расширила контракт.
 */
export async function archiveLegalEntity(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertLegalEntityOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  // archived_at — миграция 200, ещё не в Database-типах → asLooseDb
  const db = asLooseDb(supabase);
  const { data: row } = await db
    .from<{ id: string; name: string; archived_at: string | null }>("legal_entities")
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Юрлицо не найдено" };
  if (row.archived_at) return { error: null }; // идемпотентно

  if (opts.confirmName.trim() !== row.name.trim()) {
    return { error: "Введите название точно как у юрлица" };
  }

  const { error } = await db
    .from("legal_entities")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user.id,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/org/legal-entities");
  revalidatePath("/org/legal-entities/archive");
  revalidatePath(`/org/legal-entities/${id}`);
  return { error: null };
}

/**
 * Backwards-compat alias на archiveLegalEntity. Использует имя юрлица
 * для confirmName (т.к. старый контракт его не требовал).
 * @deprecated Используй archiveLegalEntity.
 */
export async function deactivateLegalEntity(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("legal_entities")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Юрлицо не найдено" };
  return archiveLegalEntity(id, { confirmName: row.name });
}

export async function restoreLegalEntity(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertLegalEntityOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  const db = asLooseDb(supabase);
  const { error } = await db
    .from("legal_entities")
    .update({
      archived_at: null,
      archived_by: null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/org/legal-entities");
  revalidatePath("/org/legal-entities/archive");
  revalidatePath(`/org/legal-entities/${id}`);
  return { error: null };
}

/**
 * Hard delete. Технически возможен, но **в текущей схеме всегда упадёт**
 * на RESTRICT FK если есть привязки. UI скрывает кнопку. Action оставлен
 * для технической полноты (например, после ручной миграции данных).
 *
 * Permission `org.delete_legal_entity` уже существует с миграции 034
 * (owner-only). RLS legal_entities_delete его проверяет.
 */
export async function deleteLegalEntity(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertLegalEntityOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  if (opts.confirmName.trim() !== ownerCheck.name.trim()) {
    return { error: "Введите название точно как у юрлица" };
  }

  // RESTRICT-precheck: считаем блокеры и возвращаем дружелюбную ошибку
  const impact = await getLegalEntityArchiveImpact(id);
  const blockers = [
    { label: "Банк-счетов", count: impact.bankAccounts },
    { label: "Транзакций", count: impact.transactions },
    { label: "Заведений (по умолчанию)", count: impact.venuesAsDefault },
  ].filter((b) => b.count > 0);
  if (blockers.length > 0) {
    return {
      error:
        "Нельзя удалить — есть блокирующие связи: " +
        blockers.map((b) => `${b.label}: ${b.count}`).join("; ") +
        ". Уберите эти ссылки или используйте «Архивировать».",
    };
  }

  const { error } = await supabase.from("legal_entities").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/org/legal-entities");
  revalidatePath("/org/legal-entities/archive");
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

// ─── Venue ↔ legal entity link ───────────────────────────────────────────────

export interface AccountVenueRow {
  id: string;
  name: string;
  default_legal_entity_id: string | null;
}

/**
 * List all venues of the active account along with their current
 * default_legal_entity_id. Used on the legal-entity detail page to
 * show which venues are attached and offer attach/detach toggles.
 *
 * Important: explicitly filters by get_active_account_id(). The
 * venues_select_member RLS policy (migration 020) only checks active
 * membership by venue_id, NOT account, so a user who is a member of
 * venues across multiple accounts would otherwise see foreign-account
 * venues here. Trying to attach those would fail at the composite FK
 * (migration 036) and produce confusing UI errors.
 */
export async function listAccountVenues(): Promise<{
  rows: AccountVenueRow[];
  error: string | null;
}> {
  const supabase = await createClient();

  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return {
      rows: [],
      error: accountErr?.message ?? "Не удалось определить активный аккаунт",
    };
  }

  const { data, error } = await supabase
    .from("venues")
    .select("id, name, default_legal_entity_id")
    .eq("account_id", accountId as unknown as string)
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AccountVenueRow[], error: null };
}

/**
 * Attach a venue to a legal entity (set venue.default_legal_entity_id).
 * Composite FK from migration 036 enforces tenant consistency.
 */
export async function attachVenueToLegalEntity(
  legalEntityId: string,
  venueId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("venues")
    .update({ default_legal_entity_id: legalEntityId })
    .eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath(`/org/legal-entities/${legalEntityId}`);
  revalidatePath(`/org/venues/${venueId}`);
  return { error: null };
}

/**
 * Detach a venue from its current legal entity (set NULL). Composite FK
 * with a NULL part is always valid under MATCH SIMPLE.
 */
export async function detachVenueFromLegalEntity(
  venueId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("venues")
    .update({ default_legal_entity_id: null })
    .eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath("/org/legal-entities");
  revalidatePath(`/org/venues/${venueId}`);
  return { error: null };
}
