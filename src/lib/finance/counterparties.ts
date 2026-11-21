"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { asLooseDb } from "@/lib/supabase/loose";
import { findPartyByInn } from "@/lib/dadata/party";
import { writeAuditEvent } from "@/lib/audit/write";
import type {
  CounterpartyFormInput,
  CounterpartyGroupFormInput,
  CounterpartyGroupRow,
  CounterpartyRow,
} from "@/types/finance";

const NO_ROW_CHANGED = "Не удалось сохранить: нет прав или запись уже удалена. Обновите страницу";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Контрагенты видны в списке, карточке и в форме операции. */
function revalidateCounterparties(id?: string) {
  revalidatePath("/finance/counterparties");
  if (id) revalidatePath(`/finance/counterparties/${id}`);
  revalidatePath("/finance/transactions");
}

// ─── Read helpers ────────────────────────────────────────────────────────────

export type ListCounterpartiesOptions = {
  /** When true, includes soft-deleted rows (deleted_at is not null). */
  include_deleted?: boolean;
  group_id?: string | null;
};

export async function listCounterparties(
  opts: ListCounterpartiesOptions = {}
): Promise<{ rows: CounterpartyRow[]; error: string | null }> {
  const supabase = await createClient();
  // Все страницы, а не первая тысяча: PostgREST молча обрезает ответ, и
  // контрагенты после тысячного по алфавиту пропадали бы из выбора в
  // операциях и из условий правил разнесения.
  const build = () => {
    let query = asLooseDb(supabase).from<CounterpartyRow[]>("counterparties").select("*");
    if (!opts.include_deleted) query = query.is("deleted_at", null);
    if (opts.group_id !== undefined) {
      query = opts.group_id === null
        ? query.is("group_id", null)
        : query.eq("group_id", opts.group_id);
    }
    return query.order("name", { ascending: true });
  };
  try {
    return { rows: await fetchAllRows<CounterpartyRow>(build), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "Не удалось загрузить контрагентов" };
  }
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

/**
 * Проверка реквизитов до записи: понятная ошибка вместо отказа базы.
 * ИНН — 10 цифр у организации, 12 у ИП и физлица; дубль ИНН среди живых
 * контрагентов почти всегда означает, что контрагента завели второй раз.
 */
async function validateCounterparty(
  supabase: Supabase,
  input: Partial<CounterpartyFormInput>,
  exceptId?: string,
): Promise<string | null> {
  if (input.name !== undefined && !input.name.trim()) return "Укажите название контрагента";
  const inn = input.inn?.trim();
  if (inn) {
    if (!/^\d{10}$|^\d{12}$/.test(inn)) return "ИНН: 10 цифр у организации или 12 у ИП";
    const { data } = await supabase
      .from("counterparties")
      .select("id, name")
      .eq("inn", inn)
      .is("deleted_at", null);
    const twin = (data ?? []).find((row) => row.id !== exceptId);
    if (twin) return `Контрагент с ИНН ${inn} уже есть: «${twin.name}»`;
  }
  const kpp = input.kpp?.trim();
  if (kpp && !/^\d{4}[\dA-Z]{2}\d{3}$/.test(kpp)) return "КПП: 9 знаков";
  const ogrn = input.ogrn?.trim();
  if (ogrn && !/^\d{13}$|^\d{15}$/.test(ogrn)) return "ОГРН: 13 цифр, ОГРНИП: 15";
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Проверьте адрес почты";
  return null;
}

/** Пустые строки уходят в базу как null, текст — без пробелов по краям. */
function normalize(input: Partial<CounterpartyFormInput>): Partial<CounterpartyFormInput> {
  // Только поля формы: аккаунт, архив, авторство и сверку с ЕГРЮЛ из запроса
  // не принимаем, даже если их прислали в обход интерфейса.
  const out: Partial<CounterpartyFormInput> = {};
  if (input.name !== undefined) out.name = String(input.name).trim();
  if (input.legal_form !== undefined) out.legal_form = input.legal_form;
  if (input.group_id !== undefined) out.group_id = input.group_id || null;
  for (const key of [
    "inn",
    "kpp",
    "ogrn",
    "contact_person",
    "phone",
    "email",
    "address",
    "description",
  ] as const) {
    if (input[key] !== undefined) out[key] = input[key] ? String(input[key]).trim() || null : null;
  }
  return out;
}

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

  const clean = normalize(input) as CounterpartyFormInput;
  const invalid = await validateCounterparty(supabase, clean);
  if (invalid) return { id: null, error: invalid };

  const { data, error } = await supabase
    .from("counterparties")
    .insert({
      account_id:     accountId as unknown as string,
      created_by:     user.id,
      name:           clean.name,
      legal_form:     clean.legal_form ?? "OOO",
      inn:            clean.inn ?? null,
      kpp:            clean.kpp ?? null,
      ogrn:           clean.ogrn ?? null,
      contact_person: clean.contact_person ?? null,
      phone:          clean.phone ?? null,
      email:          clean.email ?? null,
      address:        clean.address ?? null,
      description:    clean.description ?? null,
      group_id:       clean.group_id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать контрагента" };
  }

  revalidateCounterparties();
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

  const clean = normalize(patch);
  // Проверяем только изменённые реквизиты: старые записи (импорт, ручной
  // ввод до проверок) не должны мешать поправить, например, телефон.
  const { data: current } = await supabase
    .from("counterparties")
    .select("inn, kpp, ogrn, email")
    .eq("id", id)
    .maybeSingle();
  const toValidate: Partial<CounterpartyFormInput> = { name: clean.name };
  for (const key of ["inn", "kpp", "ogrn", "email"] as const) {
    if (clean[key] !== undefined && (clean[key] ?? null) !== (current?.[key] ?? null)) {
      toValidate[key] = clean[key];
    }
  }
  const invalid = await validateCounterparty(supabase, toValidate, id);
  if (invalid) return { error: invalid };

  const { data: changed, error } = await supabase
    .from("counterparties")
    .update({
      ...clean,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  // RLS не даёт ошибку, а молча не меняет строку: без прав — честный отказ.
  if (!changed?.length) return { error: NO_ROW_CHANGED };

  revalidateCounterparties(id);
  return { error: null };
}

// ────────────────────────────────────────────────────────────────────────
//  Archive / Restore / Hard-delete — docs/CONVENTIONS.md §2
// ────────────────────────────────────────────────────────────────────────

export type CounterpartyArchiveImpact = {
  /** Транзакции с этим контрагентом (SET NULL — данные сохранятся). */
  transactions: number;
  /** Загруженные документы (CASCADE — удалятся вместе). */
  attachments: number;
  /** Связки «ингредиент ↔ поставщик» (CASCADE — удалятся). */
  ingredient_suppliers: number;
};

/**
 * Owner-check через accounts.owner_id — не зависит от active_venue_id
 * (см. venues actions.ts assertVenueOwner для контекста и обоснования).
 * archive/restore/delete по дизайну owner-only.
 */
async function assertCounterpartyOwner(
  supabase: Supabase,
  counterpartyId: string,
  userId: string,
): Promise<{ ok: true; account_id: string; name: string } | { ok: false; error: string }> {
  const { data: row } = await supabase
    .from("counterparties")
    .select("id, name, account_id")
    .eq("id", counterpartyId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Контрагент не найден" };

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

/**
 * Считает связанные сущности контрагента для preview в диалогах.
 */
export async function getCounterpartyArchiveImpact(
  id: string
): Promise<CounterpartyArchiveImpact> {
  const supabase = await createClient();
  const headOpts = { count: "exact" as const, head: true };
  const db = asLooseDb(supabase);

  const [transactions, attachments, ingredient_suppliers] = await Promise.all([
    supabase.from("transactions").select("id", headOpts).eq("counterparty_id", id),
    supabase.from("counterparty_attachments").select("id", headOpts).eq("counterparty_id", id),
    // ingredient_suppliers — миграция 185, ещё не в Database-типах
    db.from("ingredient_suppliers").select("id", headOpts).eq("counterparty_id", id),
  ]);

  return {
    transactions: transactions.count ?? 0,
    attachments: attachments.count ?? 0,
    ingredient_suppliers: ingredient_suppliers.count ?? 0,
  };
}

/**
 * Архивирует контрагента (soft-delete). Скрывает из всех живых списков
 * и выборов; транзакции сохраняют ссылку (composite FK ON DELETE SET
 * NULL (counterparty_id), миграция 040). Идемпотентно: повторный вызов
 * на уже архивном → no-op success. confirmName проверяется на сервере.
 *
 * Колонка `deleted_at` — legacy-имя (см. docs/CONVENTIONS.md §2: не
 * мигрируем, адаптер на уровне action).
 */
export async function archiveCounterparty(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertCounterpartyOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  const { data: row, error: fetchErr } = await supabase
    .from("counterparties")
    .select("id, name, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!row) return { error: "Контрагент не найден" };

  if (row.deleted_at) return { error: null }; // идемпотентно

  if (opts.confirmName.trim() !== row.name.trim()) {
    return { error: "Введите название точно как у контрагента" };
  }

  const { data: changed, error: updateErr } = await supabase
    .from("counterparties")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      is_active:  false,
    })
    .eq("id", id)
    .select("id");
  if (updateErr) return { error: updateErr.message };
  // RLS не даёт ошибку, а молча не меняет строку: без прав — честный отказ.
  if (!changed?.length) return { error: NO_ROW_CHANGED };

  revalidateCounterparties(id);
  return { error: null };
}

export async function restoreCounterparty(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertCounterpartyOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  // Пока контрагент лежал в архиве, его могли завести заново с тем же ИНН.
  const { data: row } = await supabase
    .from("counterparties")
    .select("inn")
    .eq("id", id)
    .maybeSingle();
  if (row?.inn) {
    const { data: twins } = await supabase
      .from("counterparties")
      .select("id, name")
      .eq("inn", row.inn)
      .is("deleted_at", null)
      .neq("id", id);
    const twin = twins?.[0];
    if (twin) {
      return {
        error: `Контрагент с ИНН ${row.inn} уже есть: «${twin.name}». Отправьте его в архив, чтобы вернуть этого`,
      };
    }
  }

  const { data: changed, error } = await supabase
    .from("counterparties")
    .update({ deleted_at: null, deleted_by: null, is_active: true })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  // RLS не даёт ошибку, а молча не меняет строку: без прав — честный отказ.
  if (!changed?.length) return { error: NO_ROW_CHANGED };

  revalidateCounterparties(id);
  return { error: null };
}

/**
 * Полное удаление контрагента с каскадом.
 *   - CASCADE: counterparty_attachments, ingredient_suppliers.
 *   - SET NULL: transactions.counterparty_id (history-bearing, сохраняем).
 * RESTRICT-блокеров в текущей схеме нет; precheck сохранён как защита
 * на будущее. Требует отдельного права `finance.delete_counterparty`
 * (owner-only по дефолту, миграция 199).
 */
export async function deleteCounterparty(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertCounterpartyOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  if (opts.confirmName.trim() !== ownerCheck.name.trim()) {
    return { error: "Введите название точно как у контрагента" };
  }

  const { data: changed, error } = await supabase.from("counterparties").delete().eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  // RLS не даёт ошибку, а молча не меняет строку: без прав — честный отказ.
  if (!changed?.length) return { error: NO_ROW_CHANGED };

  revalidateCounterparties();
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
      error: err instanceof Error ? err.message : "Не удалось получить данные по ИНН",
    };
  }
  if (!party) return { error: "По этому ИНН ничего не найдено в ЕГРЮЛ" };

  const { data: changed, error: updateErr } = await supabase
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
    .eq("id", id)
    .select("id");
  if (updateErr) return { error: updateErr.message };
  // RLS не даёт ошибку, а молча не меняет строку: без прав — честный отказ.
  if (!changed?.length) return { error: NO_ROW_CHANGED };

  revalidateCounterparties(id);
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

async function duplicateGroupName(
  supabase: Supabase,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("counterparty_groups")
    .select("id, name")
    .ilike("name", name.replace(/[\\%_]/g, (c) => `\\${c}`));
  // ilike — только предфильтр (PostgREST читает `*` как `%`).
  const lower = name.trim().toLocaleLowerCase("ru");
  return (data ?? []).some(
    (row) => row.id !== exceptId && row.name.trim().toLocaleLowerCase("ru") === lower,
  );
}

export async function createCounterpartyGroup(
  input: CounterpartyGroupFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const name = input.name.trim();
  if (!name) return { id: null, error: "Укажите название группы" };

  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }
  if (await duplicateGroupName(supabase, name)) {
    return { id: null, error: `Группа «${name}» уже есть` };
  }
  const { data, error } = await supabase
    .from("counterparty_groups")
    .insert({
      account_id:  accountId as unknown as string,
      name,
      description: input.description?.trim() || null,
      sort_order:  input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать группу" };
  }
  await writeAuditEvent({
    accountId: accountId as unknown as string,
    userId: user.id,
    actionCode: "finance.counterparty_group.created",
    entityType: "counterparty_group",
    entityId: data.id,
    details: { name },
  });
  revalidateCounterparties();
  return { id: data.id, error: null };
}

export async function updateCounterpartyGroup(
  id: string,
  patch: Partial<CounterpartyGroupFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: group } = await supabase
    .from("counterparty_groups")
    .select("id, account_id, name")
    .eq("id", id)
    .maybeSingle();
  if (!group) return { error: "Группа не найдена" };

  // Только поля формы, без аккаунта.
  const next: Partial<CounterpartyGroupFormInput> = {};
  if (patch.description !== undefined) next.description = patch.description?.trim() || null;
  if (patch.sort_order !== undefined) next.sort_order = Number(patch.sort_order) || 0;
  if (patch.name !== undefined) {
    next.name = String(patch.name).trim();
    if (!next.name) return { error: "Укажите название группы" };
    if (next.name !== group.name && (await duplicateGroupName(supabase, next.name, id))) {
      return { error: `Группа «${next.name}» уже есть` };
    }
  }

  const { data: changed, error } = await supabase
    .from("counterparty_groups")
    .update(next)
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  // RLS не даёт ошибку, а молча не меняет строку: без прав — честный отказ.
  if (!changed?.length) return { error: NO_ROW_CHANGED };
  if (next.name !== undefined && next.name !== group.name) {
    await writeAuditEvent({
      accountId: group.account_id,
      userId: user.id,
      actionCode: "finance.counterparty_group.updated",
      entityType: "counterparty_group",
      entityId: id,
      details: { name: next.name, changes: [{ field: "name", old: group.name, new: next.name }] },
    });
  }
  revalidateCounterparties();
  return { error: null };
}

/** Контрагенты группы не удаляются: они остаются без группы (FK ON DELETE SET NULL). */
export async function deleteCounterpartyGroup(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: group } = await supabase
    .from("counterparty_groups")
    .select("id, account_id, name")
    .eq("id", id)
    .maybeSingle();
  if (!group) return { error: "Группа не найдена" };

  const { data: changed, error } = await supabase
    .from("counterparty_groups")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  // RLS не даёт ошибку, а молча не меняет строку: без прав — честный отказ.
  if (!changed?.length) return { error: NO_ROW_CHANGED };
  await writeAuditEvent({
    accountId: group.account_id,
    userId: user.id,
    actionCode: "finance.counterparty_group.deleted",
    entityType: "counterparty_group",
    entityId: id,
    details: { name: group.name },
  });
  revalidateCounterparties();
  return { error: null };
}
