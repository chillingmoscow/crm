"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { revalidatePath } from "next/cache";
import type { Json, VenueType, WorkingHours } from "@/types/database";

type VenueData = {
  name: string;
  type: VenueType;
  address?: string;
  phone?: string;
  currency: string;
  timezone: string;
  workingHours: WorkingHours;
  comment?: string | null;
  defaultLegalEntityId?: string | null;
};

export async function createVenue(
  data: VenueData
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!account) return { id: null, error: "Аккаунт не найден" };

  const { data: venue, error } = await supabase
    .from("venues")
    .insert({
      account_id:    account.id,
      name:          data.name,
      type:          data.type,
      address:       data.address ?? null,
      phone:         data.phone ?? null,
      currency:      data.currency,
      timezone:      data.timezone,
      working_hours: data.workingHours as unknown as Json,
    })
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };

  // Auto-add owner to user_venue_roles for the new venue.
  // После Stage D venue-scoped refactor system-role marker — venue_id IS NULL.
  const { data: ownerRole } = await supabase
    .from("roles")
    .select("id")
    .eq("code", "owner")
    .is("venue_id", null)
    .single();

  if (ownerRole) {
    await supabase.from("user_venue_roles").insert({
      user_id:  user.id,
      venue_id: venue.id,
      role_id:  ownerRole.id,
    });
  }

  // Сидим preset кастомных ролей (Управляющий/Админ/Бухгалтер/Хостес/
  // Официант) в новом venue. Если ошибка — не валим: venue + owner UVR
  // уже созданы, юзер может позже добавить роли вручную в /people/roles.
  // RPC ещё не во вшитых Database-типах (миграция 167 свежая) — cast
  // чтобы развязать pipeline до регенерации `supabase gen types`.
  const rpc = (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  ).bind(supabase);
  const { error: seedError } = await rpc("seed_default_venue_roles", {
    p_venue_id: venue.id,
  });
  if (seedError) {
    console.error("[createVenue] seed_default_venue_roles failed", seedError);
  }

  revalidatePath("/org/venues");
  return { id: venue.id, error: null };
}

export async function updateVenue(
  id: string,
  data: VenueData
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("venues")
    .update({
      name:                    data.name,
      type:                    data.type,
      address:                 data.address ?? null,
      phone:                   data.phone ?? null,
      currency:                data.currency,
      timezone:                data.timezone,
      working_hours:           data.workingHours as unknown as Json,
      comment:                 data.comment ?? null,
      // Composite FK from migration 036 enforces that the legal entity
      // belongs to the venue's account. Passing undefined leaves the
      // column unchanged; null clears it.
      ...(data.defaultLegalEntityId !== undefined
        ? { default_legal_entity_id: data.defaultLegalEntityId }
        : {}),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/org/venues");
  return { error: null };
}

// ────────────────────────────────────────────────────────────────────────
//  Archive / Restore / Hard-delete — docs/CONVENTIONS.md §2
// ────────────────────────────────────────────────────────────────────────

export type VenueArchiveImpact = {
  documents: number;
  transactions: number;
  staff: number;
  departments: number;
  roles: number;
  invitations: number;
  halls: number;
  stores: number;
  bankAccounts: number;
};

/**
 * Считает связанные сущности заведения для preview в диалогах.
 * Возвращает 0 для всего, если venue не найдено / нет доступа.
 */
export async function getVenueArchiveImpact(
  id: string
): Promise<VenueArchiveImpact> {
  const supabase = await createClient();
  const db = asLooseDb(supabase);

  const zero: VenueArchiveImpact = {
    documents: 0, transactions: 0, staff: 0, departments: 0,
    roles: 0, invitations: 0, halls: 0, stores: 0, bankAccounts: 0,
  };

  // count={ count: 'exact', head: true } — не возвращает строки, только count
  const headOpts = { count: "exact" as const, head: true };

  const [
    documents, transactions, staff, departments,
    roles, invitations, halls, stores, bankAccounts,
  ] = await Promise.all([
    db.from("documents").select("id", headOpts).eq("venue_id", id),
    db.from("transactions").select("id", headOpts).eq("venue_id", id),
    db.from("user_venue_roles").select("user_id", headOpts).eq("venue_id", id),
    db.from("departments").select("id", headOpts).eq("venue_id", id),
    db.from("roles").select("id", headOpts).eq("venue_id", id),
    db.from("invitations").select("id", headOpts).eq("venue_id", id),
    db.from("venue_halls").select("id", headOpts).eq("venue_id", id),
    db.from("stores").select("id", headOpts).eq("local_venue_id", id),
    db.from("bank_accounts").select("id", headOpts).eq("venue_id", id),
  ]);

  return {
    documents:   documents.count ?? zero.documents,
    transactions: transactions.count ?? zero.transactions,
    staff:       staff.count ?? zero.staff,
    departments: departments.count ?? zero.departments,
    roles:       roles.count ?? zero.roles,
    invitations: invitations.count ?? zero.invitations,
    halls:       halls.count ?? zero.halls,
    stores:      stores.count ?? zero.stores,
    bankAccounts: bankAccounts.count ?? zero.bankAccounts,
  };
}

/**
 * Owner-check через venue.account_id → accounts.owner_id. Read-only.
 * Используем вместо has_permission в archive/restore/delete, потому что
 * has_permission резолвится через get_active_venue_id() — а после
 * архивации текущего venue active context сбрасывается (см. archiveVenue),
 * и has_permission вернёт false. Owner-check не зависит от active_venue.
 * archive/restore/delete по дизайну owner-only — это контрактное решение
 * (org.delete_venue уже owner-only в seed; org.manage_venues тоже).
 */
async function assertVenueOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  venueId: string,
  userId: string,
): Promise<{ ok: true; account_id: string; name: string } | { ok: false; error: string }> {
  const db = asLooseDb(supabase);
  const { data: venue } = await db
    .from<{ id: string; name: string; account_id: string; archived_at: string | null }>(
      "venues",
    )
    .select("id, name, account_id, archived_at")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return { ok: false, error: "Заведение не найдено" };

  const { data: account } = await db
    .from<{ owner_id: string }>("accounts")
    .select("owner_id")
    .eq("id", venue.account_id)
    .maybeSingle();
  if (!account || account.owner_id !== userId) {
    return { ok: false, error: "Действие доступно только владельцу аккаунта" };
  }
  return { ok: true, account_id: venue.account_id, name: venue.name };
}

/**
 * Архивирует заведение (soft-delete). Скрывает из всех живых списков,
 * связанные данные не трогаются. Идемпотентно: повторный вызов на
 * уже архивном venue → success без изменений. confirmName проверяется
 * на сервере; клиент использует это для UX.
 */
export async function archiveVenue(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertVenueOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  // archived_at/archived_by — миграция 198, ещё не в Database-типах,
  // используем asLooseDb (как другие свежие миграции в проекте).
  const db = asLooseDb(supabase);
  const { data: venueRow, error: fetchErr } = await db
    .from<{ id: string; name: string; archived_at: string | null }>("venues")
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!venueRow) return { error: "Заведение не найдено" };

  if (venueRow.archived_at) {
    // Идемпотентно: уже в архиве — успех без действия.
    return { error: null };
  }

  if (opts.confirmName.trim() !== venueRow.name.trim()) {
    return { error: "Введите название точно как у заведения" };
  }

  const { error: updateErr } = await db
    .from("venues")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user.id,
    })
    .eq("id", id);
  if (updateErr) return { error: updateErr.message };

  // Сброс active_venue_id у всех профилей, у которых это venue активное —
  // иначе get_active_venue_id() вернёт NULL (из-за archived_at-фильтра
  // в самой функции), но в profiles останется устаревшая ссылка.
  // Делаем через admin client, чтобы охватить всех юзеров (не только
  // текущего): RLS на profiles ограничивает write своим id.
  const admin = createAdminClient();
  await asLooseDb(admin)
    .from("profiles")
    .update({ active_venue_id: null })
    .eq("active_venue_id", id);

  revalidatePath("/org/venues");
  revalidatePath("/org/venues/archive");
  revalidatePath(`/org/venues/${id}`);
  // sidebar / venue switcher отрисовывается в dashboard layout
  revalidatePath("/", "layout");
  return { error: null };
}

/**
 * Восстанавливает заведение из архива. Снимает флаг archived_at —
 * venue снова доступно во всех списках. profiles.active_venue_id
 * НЕ восстанавливается (пользователь сам переключится на venue).
 */
export async function restoreVenue(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertVenueOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  // venues_select_archived_owner пустит owner'а к archived row
  const db = asLooseDb(supabase);
  const { data: venueRow, error: fetchErr } = await db
    .from<{ id: string; archived_at: string | null }>("venues")
    .select("id, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!venueRow) return { error: "Заведение не найдено" };
  if (!venueRow.archived_at) return { error: null }; // уже live

  const { error: updateErr } = await db
    .from("venues")
    .update({ archived_at: null, archived_by: null })
    .eq("id", id);
  if (updateErr) return { error: updateErr.message };

  revalidatePath("/org/venues");
  revalidatePath("/org/venues/archive");
  revalidatePath(`/org/venues/${id}`);
  revalidatePath("/", "layout");
  return { error: null };
}

/**
 * Полное удаление заведения с каскадом. По миграции 197+198:
 *   - CASCADE: departments, invitations (с role_id CASCADE), roles
 *     (с role_permissions + UVR + invitations CASCADE), user_venue_roles,
 *     venue_halls (→ hall_layouts).
 *   - SET NULL: audit_logs, bank_accounts.venue_id, documents.venue_id,
 *     notifications.venue_id, profiles.active_venue_id, stores.local_venue_id,
 *     transactions.venue_id.
 * RESTRICT-блокеров в текущей схеме нет; precheck сохранён как защита
 * на будущее (новые FK с RESTRICT нужно отлавливать сразу).
 */
export async function deleteVenue(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertVenueOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  if (opts.confirmName.trim() !== ownerCheck.name.trim()) {
    return { error: "Введите название точно как у заведения" };
  }

  // audit-событие venue.deleted эмитится триггером venues_audit_trigger
  // (миграция 156+198) перед физическим DELETE.
  const { error: deleteErr } = await supabase
    .from("venues")
    .delete()
    .eq("id", id);
  if (deleteErr) return { error: deleteErr.message };

  revalidatePath("/org/venues");
  revalidatePath("/org/venues/archive");
  revalidatePath("/", "layout");
  return { error: null };
}
