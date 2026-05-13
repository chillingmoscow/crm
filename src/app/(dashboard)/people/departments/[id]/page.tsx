import { redirect } from "next/navigation";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { listAuditEvents } from "@/lib/audit/list";
import { getDepartment } from "../actions";
import { DepartmentDetailPage } from "./_components/department-detail-page";

export default async function DepartmentDetailServerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "people.view_roles",
  });
  if (!canView) redirect("/dashboard");

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "people.manage_roles",
  });

  const [{ data: accountId }, { department, roles, heads }, { data: allRoles }, { data: canViewAudit }] =
    await Promise.all([
      supabase.rpc("get_active_account_id"),
      getDepartment(id),
      supabase
        .from("roles")
        .select("id, name, code, icon, icon_color, account_id, department_id")
        .order("account_id", { nullsFirst: true })
        .order("name"),
      supabase.rpc("has_permission", { permission_code: "org.view_audit" }),
    ]);

  if (!department) redirect("/people/departments");
  if (
    department.account_id !==
    ((accountId as string | null) ?? null)
  ) {
    redirect("/people/departments");
  }

  const auditResult = canViewAudit
    ? await listAuditEvents({ entityType: "department", entityId: id })
    : { events: [], hasMore: false, error: null };

  return (
    <DepartmentDetailPage
      department={department}
      initialRoles={roles}
      initialHeads={heads}
      allRoles={allRoles ?? []}
      canManage={Boolean(canManage)}
      canViewAudit={Boolean(canViewAudit)}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
    />
  );
}
