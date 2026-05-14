import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RolesClient } from "./_components/roles-client";

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
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "people.view_roles",
  });
  if (!canView) redirect("/dashboard");

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
          .select("role_id")
          .eq("venue_id", activeVenueId as string)
          .eq("status", "active")
      : (Promise.resolve({ data: [] as { role_id: string }[] })),
  ]);

  const staffCountByRole: Record<string, number> = {};
  for (const row of venueRolesResult.data ?? []) {
    staffCountByRole[row.role_id] = (staffCountByRole[row.role_id] ?? 0) + 1;
  }

  return (
    <RolesClient
      roles={roles}
      permissions={permissions}
      rolePermissions={rolePermsResult.data ?? []}
      accountId={accountId ?? null}
      activeVenueId={activeVenueId ?? null}
      staffCountByRole={staffCountByRole}
      importedRoleIds={importedRoleIds}
      departments={departmentsResult.data ?? []}
    />
  );
}
