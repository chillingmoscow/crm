import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RolesClient } from "./_components/roles-client";

export default async function RolesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "platform.manage_roles",
  });
  if (!canManage) redirect("/dashboard");

  const { data: accountId } = await supabase.rpc("get_active_account_id");

  const [rolesResult, permissionsResult] = await Promise.all([
    supabase
      .from("roles")
      .select("id, account_id, name, code")
      .or(
        accountId
          ? `account_id.is.null,account_id.eq.${accountId}`
          : "account_id.is.null"
      )
      .order("account_id", { nullsFirst: true })
      .order("name"),
    supabase
      .from("permissions")
      .select("id, code, description, module")
      .order("module")
      .order("code"),
  ]);

  const roles = rolesResult.data ?? [];
  const permissions = permissionsResult.data ?? [];

  const roleIds = roles.map((r) => r.id);
  const { data: rolePermissions } =
    roleIds.length > 0
      ? await supabase
          .from("role_permissions")
          .select("role_id, permission_id, granted")
          .in("role_id", roleIds)
      : { data: [] };

  return (
    <RolesClient
      roles={roles}
      permissions={permissions}
      rolePermissions={rolePermissions ?? []}
      accountId={(accountId as string | null) ?? null}
    />
  );
}
