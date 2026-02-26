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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "platform.manage_roles",
  });
  if (!canManage) redirect("/dashboard");

  const [{ data: accountId }, { data: activeVenueId }] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("get_active_venue_id"),
  ]);

  // Fetch the role — accessible if it's a system role or belongs to the active account
  const { data: role } = await supabase
    .from("roles")
    .select("id, account_id, name, code, comment")
    .eq("id", roleId)
    .returns<{ id: string; account_id: string | null; name: string; code: string; comment: string | null }[]>()
    .maybeSingle();

  if (!role) redirect("/settings/roles");

  // Reject access to roles belonging to a different account
  if (role.account_id !== null && role.account_id !== accountId) {
    redirect("/settings/roles");
  }

  const [permissionsResult, rolePermsResult, venueRolesResult] =
    await Promise.all([
      supabase
        .from("permissions")
        .select("id, code, description, module")
        .order("module")
        .order("code"),
      supabase
        .rpc("get_effective_role_permissions", { p_role_ids: [roleId] }),
      activeVenueId
        ? supabase
            .from("user_venue_roles")
            .select("id")
            .eq("role_id", roleId)
            .eq("venue_id", activeVenueId as string)
            .eq("status", "active")
        : Promise.resolve({ data: [] as { id: string }[] }),
    ]);

  return (
    <RoleDetailPage
      role={role}
      permissions={permissionsResult.data ?? []}
      rolePermissions={rolePermsResult.data ?? []}
      accountId={(accountId as string | null) ?? null}
      staffCount={(venueRolesResult.data ?? []).length}
    />
  );
}
