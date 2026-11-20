"use server";

import { revalidatePath } from "next/cache";

import { getActiveContext } from "@/app/(dashboard)/inventory/actions-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getCachedPermissionChecker } from "@/lib/supabase/server";

export type StoreDepartmentScope = "unset" | "shared" | "department";

/** Одно изменение в записи истории: «Заведение: A → B». */
export type StoreHistoryChange =
  | { kind: "venue"; from: string | null; to: string | null }
  | {
      kind: "department";
      fromScope: StoreDepartmentScope;
      fromName: string | null;
      toScope: StoreDepartmentScope;
      toName: string | null;
    }
  | { kind: "archived" }
  | { kind: "restored" };

export type StoreHistoryEntry = {
  id: string;
  changedAt: string;
  /** null — изменение без человека: удаление заведения или подразделения. */
  actor: { id: string; name: string; avatarUrl: string | null; isMe: boolean } | null;
  /**
   * Изменения одного действия. Смена заведения сбрасывает подразделение в той
   * же транзакции — это одна запись с двумя строками, а не два события.
   */
  changes: StoreHistoryChange[];
};

type DepartmentHistoryRow = {
  id: string;
  changed_at: string;
  old_scope: StoreDepartmentScope;
  old_department_name: string | null;
  new_scope: StoreDepartmentScope;
  new_department_name: string | null;
  changed_by: string | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  action_code: string;
  user_id: string | null;
  details: {
    old_venue_id?: string | null;
    old_venue_name?: string | null;
    new_venue_id?: string | null;
    new_venue_name?: string | null;
  } | null;
};

const HISTORY_LIMIT = 50;
const STORE_AUDIT_ACTIONS = ["store.venue_changed", "store.archived", "store.restored"];

/**
 * История склада для карточки: смена заведения, архив и возврат — из общего
 * журнала (миграция 365), смена подразделения — из store_department_history
 * (миграция 307).
 *
 * Журнал читается service-role'ом: его политика пускает только с правом
 * org.view_audit, а историю своего склада должен видеть каждый, кто видит
 * справочник складов. Наружу уходят только события этого склада этого
 * аккаунта. Историю подразделения отдаём по прежнему правилу — клиентом
 * пользователя, её политика требует inventory.view_results.
 */
export async function listStoreHistory(
  storeId: string,
): Promise<{ entries: StoreHistoryEntry[]; error: string | null }> {
  const ctx = await getActiveContext("inventory.view_stores");
  if (ctx.error || !ctx.accountId || !ctx.user) {
    return { entries: [], error: ctx.error ?? "Не удалось определить аккаунт" };
  }
  const userId = ctx.user.id;
  const can = await getCachedPermissionChecker();
  const admin = asLooseDb(createAdminClient());

  // Журнал ниже читается service-role'ом, поэтому сначала проверяем, что сам
  // склад виден пользователю (stores_select пускает к складам своих заведений,
  // все склады — только с manage_stores / view_all_venues). Иначе по чужому id
  // можно было бы прочитать историю склада, которого в списке у человека нет.
  // Заодно берём видимые заведения: названия остальных в истории не раскрываем.
  const [{ data: visibleStore }, { data: visibleVenues }, { data: accountVenues }] = await Promise.all([
    asLooseDb(ctx.supabase)
      .from<{ id: string }>("stores")
      .select("id")
      .eq("id", storeId)
      .eq("account_id", ctx.accountId)
      .maybeSingle(),
    asLooseDb(ctx.supabase).from<Array<{ id: string }>>("venues").select("id").eq("account_id", ctx.accountId),
    // Только id: отличить удалённое заведение от существующего, но скрытого.
    admin.from<Array<{ id: string }>>("venues").select("id").eq("account_id", ctx.accountId),
  ]);
  if (!visibleStore?.id) return { entries: [], error: "Склад не найден" };
  const visibleVenueIds = new Set((visibleVenues ?? []).map((venue) => venue.id));
  const existingVenueIds = new Set((accountVenues ?? []).map((venue) => venue.id));
  // Кто видит все склады аккаунта, видит и название удалённого заведения
  // (снимок в журнале); остальным раскрываем только свои заведения.
  const accountWide = can("inventory.manage_stores") || can("inventory.view_all_venues");
  const venueName = (id: string | null | undefined, name: string | null | undefined) => {
    // События до миграции 365 писало приложение — без id заведения, только с
    // названием. Проверить видимость нечем: название раскрываем тем, кто
    // видит все склады аккаунта.
    if (!id) return name ? (accountWide ? name : "Другое заведение (нет доступа)") : null;
    if (visibleVenueIds.has(id)) return name ?? "Заведение удалено";
    if (accountWide && !existingVenueIds.has(id)) return name ? `${name} (удалено)` : "Заведение удалено";
    return "Другое заведение (нет доступа)";
  };

  const [audit, departments] = await Promise.all([
    admin
      .from<AuditRow[]>("audit_logs")
      .select("id, created_at, action_code, user_id, details")
      .eq("account_id", ctx.accountId)
      .eq("entity_type", "store")
      .eq("entity_id", storeId)
      .in("action_code", STORE_AUDIT_ACTIONS)
      .order("created_at", { ascending: false })
      .range(0, HISTORY_LIMIT - 1),
    can("inventory.view_results")
      ? asLooseDb(ctx.supabase)
          .from<DepartmentHistoryRow[]>("store_department_history")
          .select("id, changed_at, old_scope, old_department_name, new_scope, new_department_name, changed_by")
          .eq("account_id", ctx.accountId)
          .eq("store_id", storeId)
          .order("changed_at", { ascending: false })
          .range(0, HISTORY_LIMIT - 1)
      : Promise.resolve({ data: [] as DepartmentHistoryRow[], error: null }),
  ]);
  if (audit.error || departments.error) {
    console.error("[stores] history read failed", audit.error ?? departments.error);
    return { entries: [], error: "Не удалось загрузить историю" };
  }

  type Raw = { id: string; at: string; actorId: string | null; order: number; change: StoreHistoryChange };
  const raw: Raw[] = [
    ...(audit.data ?? []).map((row): Raw => ({
      id: row.id,
      at: row.created_at,
      actorId: row.user_id,
      // Заведение первым в записи: подразделение сбрасывается из-за него.
      order: 0,
      change:
        row.action_code === "store.venue_changed"
          ? {
              kind: "venue",
              from: venueName(row.details?.old_venue_id, row.details?.old_venue_name),
              to: venueName(row.details?.new_venue_id, row.details?.new_venue_name),
            }
          : row.action_code === "store.archived"
            ? { kind: "archived" }
            : { kind: "restored" },
    })),
    ...(departments.data ?? []).map((row): Raw => ({
      id: row.id,
      at: row.changed_at,
      actorId: row.changed_by,
      order: 1,
      change: {
        kind: "department",
        fromScope: row.old_scope,
        fromName: row.old_department_name,
        toScope: row.new_scope,
        toName: row.new_department_name,
      },
    })),
  ];

  // Одно действие = одна транзакция: у его строк одинаковые время (now()
  // транзакции) и автор.
  const groups = new Map<string, Raw[]>();
  for (const item of raw) {
    const key = `${new Date(item.at).getTime()}|${item.actorId ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  // Имена авторов — service-role'ом и только по id из этой истории: коллега
  // мог уволиться, и пользовательский клиент его профиль не отдаст. Читаем
  // только имя и фото, без контактов.
  const actorIds = [...new Set(raw.map((item) => item.actorId).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = actorIds.length
    ? await admin
        .from<Array<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>>("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", actorIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const entries: StoreHistoryEntry[] = [...groups.values()]
    .map((items) => {
      items.sort((a, b) => a.order - b.order);
      const first = items[0];
      const profile = first.actorId ? profileById.get(first.actorId) : undefined;
      const name = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() : "";
      return {
        id: first.id,
        changedAt: first.at,
        actor: first.actorId
          ? { id: first.actorId, name: name || "Сотрудник", avatarUrl: profile?.avatar_url ?? null, isMe: first.actorId === userId }
          : null,
        changes: items.map((item) => item.change),
      };
    })
    .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
    .slice(0, HISTORY_LIMIT);

  return { entries, error: null };
}

/**
 * Архив склада и возврат из него (миграция 365, RPC set_store_archived).
 * Архив прячет склад из справочника; акты и расчёт недостачи не меняются.
 */
export async function setStoreArchived(
  storeId: string,
  archived: boolean,
): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_stores");
  if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить аккаунт" };
  const { error } = await asLooseDb(ctx.supabase).rpc("set_store_archived", {
    p_store_id: storeId,
    p_archived: archived,
  });
  if (error) {
    console.error("[stores] archive toggle failed", error);
    return {
      error:
        (error as { code?: string }).code === "P0001"
          ? error.message
          : "Не удалось изменить архив. Повторите попытку",
    };
  }
  revalidatePath("/org/stores");
  return { error: null };
}
