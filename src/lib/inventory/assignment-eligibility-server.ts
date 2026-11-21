import "server-only";

import type { LooseDb } from "@/lib/supabase/loose";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  INVENTORY_ASSIGNMENT_PERMISSIONS,
  buildAssignmentEligibility,
  type InventoryAssignmentEligibility,
} from "@/lib/inventory/act-assignment";

/** Сколько id ролей за один запрос к role_permissions. */
const ROLE_ID_CHUNK = 200;

/**
 * Загрузить, кого в аккаунте можно назначать исполнителем и проверяющим актов,
 * по заведениям. Путь прав тот же, что у has_permission (миграции 138, 237):
 * user_venue_roles (active, не уволен) → role_permissions (granted) →
 * permissions.code. Перекрытий прав на уровне аккаунта нет.
 *
 * Читается admin-клиентом: назначающему нужны права коллег, а не свои, и
 * RLS role/user_venue_roles под это не рассчитан. Отдаём только id людей —
 * имена грузит вызывающий.
 *
 * Ошибку чтения бросаем: на назначении это должен быть отказ, а не «молча
 * всем можно».
 */
export async function loadAssignmentEligibility(input: {
  admin: LooseDb;
  accountId: string;
}): Promise<InventoryAssignmentEligibility> {
  const [accountResult, venuesResult, permissionsResult] = await Promise.all([
    input.admin
      .from<{ owner_id: string | null }>("accounts")
      .select("owner_id")
      .eq("id", input.accountId)
      .maybeSingle(),
    input.admin.from<Array<{ id: string }>>("venues").select("id").eq("account_id", input.accountId),
    input.admin
      .from<Array<{ id: string; code: string }>>("permissions")
      .select("id, code")
      .in("code", [...INVENTORY_ASSIGNMENT_PERMISSIONS]),
  ]);
  if (accountResult.error) throw new Error(accountResult.error.message);
  if (venuesResult.error) throw new Error(venuesResult.error.message);
  if (permissionsResult.error) throw new Error(permissionsResult.error.message);

  const ownerId = accountResult.data?.owner_id ?? null;
  const venueIds = (venuesResult.data ?? []).map((venue) => venue.id);
  const codeByPermissionId = new Map(
    (permissionsResult.data ?? []).map((permission) => [permission.id, permission.code]),
  );
  if (venueIds.length === 0 || codeByPermissionId.size === 0) {
    return buildAssignmentEligibility({ ownerId, grants: [] });
  }

  // Сначала участники заведений этого аккаунта, потом права только их ролей.
  // Читать role_permissions целиком нельзя: это строки всех аккаунтов, а
  // PostgREST молча обрезает ответ на 1000 строк (CLAUDE.md, fetchAllRows).
  const memberships = await fetchAllRows<{ user_id: string; venue_id: string; role_id: string }>(() =>
    input.admin
      .from<Array<{ user_id: string; venue_id: string; role_id: string }>>("user_venue_roles")
      .select("user_id, venue_id, role_id")
      .in("venue_id", venueIds)
      .eq("status", "active")
      .is("fired_at", null),
  );
  const roleIds = Array.from(new Set(memberships.map((row) => row.role_id)));
  if (roleIds.length === 0) return buildAssignmentEligibility({ ownerId, grants: [] });

  // Порция ролей × три кода прав заведомо меньше 1000 строк, а список id не
  // раздувает URL запроса.
  const codesByRoleId = new Map<string, string[]>();
  for (const part of chunk(roleIds, ROLE_ID_CHUNK)) {
    const { data: rolePermissions, error: rolePermissionsError } = await input.admin
      .from<Array<{ role_id: string; permission_id: string }>>("role_permissions")
      .select("role_id, permission_id")
      .in("role_id", part)
      .in("permission_id", Array.from(codeByPermissionId.keys()))
      .eq("granted", true);
    if (rolePermissionsError) throw new Error(rolePermissionsError.message);
    for (const row of rolePermissions ?? []) {
      const code = codeByPermissionId.get(row.permission_id);
      if (!code) continue;
      const codes = codesByRoleId.get(row.role_id) ?? [];
      codes.push(code);
      codesByRoleId.set(row.role_id, codes);
    }
  }
  if (codesByRoleId.size === 0) return buildAssignmentEligibility({ ownerId, grants: [] });

  return buildAssignmentEligibility({
    ownerId,
    grants: memberships.filter((row) => codesByRoleId.has(row.role_id)).map((row) => ({
      userId: row.user_id,
      venueId: row.venue_id,
      permissionCodes: codesByRoleId.get(row.role_id) ?? [],
    })),
  });
}
