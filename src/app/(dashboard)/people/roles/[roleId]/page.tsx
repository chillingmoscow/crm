import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoleDetailPage } from "./_components/role-detail-page";

export default async function RoleDetailServerPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  const supabase = await createClient();
  type LooseQueryBuilder = {
    select: (columns: string) => LooseQueryBuilder;
    eq: (column: string, value: unknown) => LooseQueryBuilder;
    maybeSingle: () => Promise<{ data: unknown }>;
  };
  const db = supabase as unknown as { from: (table: string) => LooseQueryBuilder };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Detail view is gated on view_roles. Edit operations on the page
  // (and underlying role_permissions / account_role_permissions writes)
  // are still gated on people.manage_roles via RLS.
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "people.view_roles",
  });
  if (!canView) redirect("/dashboard");

  const { data: accountId } = await supabase.rpc("get_active_account_id");

  // Fetch the role with audit fields (created_at/updated_at + by) for the
  // info card on the «Основное» tab. See migration 052.
  const { data: role } = await supabase
    .from("roles")
    .select("id, account_id, name, code, comment, icon, icon_color, created_at, updated_at, created_by, updated_by")
    .eq("id", roleId)
    .returns<{
      id: string;
      account_id: string | null;
      name: string;
      code: string;
      comment: string | null;
      icon: string | null;
      icon_color: string | null;
      created_at: string | null;
      updated_at: string | null;
      created_by: string | null;
      updated_by: string | null;
    }[]>()
    .maybeSingle();

  if (!role) redirect("/people/roles");

  // Reject access to roles belonging to a different account
  if (role.account_id !== null && role.account_id !== accountId) {
    redirect("/people/roles");
  }

  // Profiles for created_by / updated_by (one batched call when both present)
  const auditUserIds = Array.from(
    new Set(
      [role.created_by, role.updated_by].filter(
        (x): x is string => x !== null,
      ),
    ),
  );
  const auditProfilesResult = auditUserIds.length
    ? await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", auditUserIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };

  const profileMap = new Map(
    ((auditProfilesResult.data as { id: string; first_name: string | null; last_name: string | null }[] | null) ?? []).map(
      (p) => [p.id, p],
    ),
  );

  const formatProfile = (id: string | null): string | null => {
    if (!id) return null;
    const p = profileMap.get(id);
    if (!p) return null;
    const first = (p.first_name ?? "").trim();
    const last = (p.last_name ?? "").trim();
    if (!first && !last) return null;
    return last ? `${first} ${last.charAt(0)}.`.trim() : first;
  };

  const [permissionsResult, rolePermsResult, importedRoleResult] =
    await Promise.all([
      supabase
        .from("permissions")
        .select("id, code, description, module")
        .order("module")
        .order("code"),
      supabase
        .rpc("get_effective_role_permissions", { p_role_ids: [roleId] }),
      (db
        .from("external_entity_links")
        .select("id")
        .eq("provider", "quickresto")
        .eq("entity_type", "role")
        .eq("local_id", roleId)
        .maybeSingle()) as unknown as Promise<{ data: { id: string } | null }>,
    ]);

  return (
    <RoleDetailPage
      role={role}
      permissions={permissionsResult.data ?? []}
      rolePermissions={rolePermsResult.data ?? []}
      accountId={accountId ?? null}
      importedFromQuickResto={Boolean(importedRoleResult.data?.id)}
      createdByName={formatProfile(role.created_by)}
      updatedByName={formatProfile(role.updated_by)}
    />
  );
}
