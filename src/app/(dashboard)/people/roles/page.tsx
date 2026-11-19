import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  createClient,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { RolesClient } from "./_components/roles-client";
import type { RoleStaffMember } from "./_components/role-staff-cell";

export const metadata: Metadata = { title: "Должности" };

export default async function RolesPage() {
  const supabase = await createClient();
  type LooseQueryBuilder = {
  select: (columns: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  in: (column: string, values: string[]) => LooseQueryBuilder;
  maybeSingle: () => Promise<{ data: unknown }>;
};

const db = supabase as unknown as { from: (table: string) => LooseQueryBuilder };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // List view is gated on view_roles (owner/admin/manager).
  // Per-row edit affordances and mutations are still gated on
  // people.manage_roles via RLS on the roles/role_permissions tables.
  const can = await getCachedPermissionChecker();
  if (!can("people.view_roles")) redirect("/dashboard");

  const [{ data: accountId }, { data: activeVenueId }] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("get_active_venue_id"),
  ]);

  // Stage D venue-scoped: фильтр по venue_id = activeVenueId
  // (видна owner system + custom-роли активного venue). RLS уже
  // ограничивает дополнительно, но фильтр снижает выборку.
  const [rolesResult, permissionsResult, departmentsResult] = await Promise.all([
    supabase
      .from("roles")
      .select("id, venue_id, name, code, comment, icon, icon_color, department_id")
      .or(
        activeVenueId
          ? `venue_id.is.null,venue_id.eq.${activeVenueId}`
          : "venue_id.is.null"
      )
      .order("venue_id", { nullsFirst: true })
      .order("name"),
    supabase
      .from("permissions")
      .select("id, code, description, module")
      .order("module")
      .order("code"),
    activeVenueId
      ? supabase
          .from("departments")
          .select("id, name")
          .eq("venue_id", activeVenueId)
          .order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  type RoleRow = {
    id: string;
    venue_id: string | null;
    name: string;
    code: string;
    comment: string | null;
    icon: string | null;
    icon_color: string | null;
    department_id: string | null;
  };
  const roles = (rolesResult.data as unknown as RoleRow[] | null) ?? [];
  const permissions = permissionsResult.data ?? [];
  const roleIds = roles.map((r) => r.id);

  let importedRoleLinks: { local_id: string }[] = [];
  if (accountId && roleIds.length > 0) {
    const result = (await db
      .from("external_entity_links")
      .select("local_id")
      .eq("account_id", accountId)
      .eq("provider", "quickresto")
      .eq("entity_type", "role")
      .in("local_id", roleIds)) as unknown as { data: { local_id: string }[] | null };
    importedRoleLinks = result.data ?? [];
  }
  const importedRoleIds = importedRoleLinks.map((row) => row.local_id);

  const [rolePermsResult, venueRolesResult] = await Promise.all([
    roleIds.length > 0
      ? supabase.rpc("get_effective_role_permissions", {
          p_role_ids: roleIds,
        })
      : (Promise.resolve({ data: [] as { role_id: string; permission_id: string; granted: boolean }[] })),
    activeVenueId
      ? supabase
          .from("user_venue_roles")
          .select("role_id, user_id")
          .eq("venue_id", activeVenueId as string)
          .eq("status", "active")
      : (Promise.resolve({ data: [] as { role_id: string; user_id: string }[] })),
  ]);

  // Люди на должностях — для аватаров и карточки по наведению в колонке
  // «Сотрудники». Без профиля (нет доступа или удалён) человек всё равно
  // считается: имя заменяется на «Без имени».
  const venueRoles = venueRolesResult.data ?? [];
  const userIds = Array.from(new Set(venueRoles.map((r) => r.user_id)));
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", userIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const staffByRole: Record<string, RoleStaffMember[]> = {};
  for (const row of venueRoles) {
    const p = profileById.get(row.user_id);
    const name =
      [p?.first_name, p?.last_name].filter((x) => x?.trim()).join(" ") ||
      "Без имени";
    (staffByRole[row.role_id] ??= []).push({
      id: row.user_id,
      name,
      avatarUrl: p?.avatar_url ?? null,
    });
  }
  const collator = new Intl.Collator("ru", { sensitivity: "base" });
  for (const list of Object.values(staffByRole))
    list.sort((a, b) => collator.compare(a.name, b.name));

  return (
    <RolesClient
      roles={roles}
      permissions={permissions}
      rolePermissions={rolePermsResult.data ?? []}
      accountId={accountId ?? null}
      activeVenueId={activeVenueId ?? null}
      staffByRole={staffByRole}
      importedRoleIds={importedRoleIds}
      departments={departmentsResult.data ?? []}
    />
  );
}
