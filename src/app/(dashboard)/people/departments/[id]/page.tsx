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

  const [{ data: accountId }, { department, roles, heads }, { data: canViewAudit }] =
    await Promise.all([
      supabase.rpc("get_active_account_id"),
      getDepartment(id),
      supabase.rpc("has_permission", { permission_code: "org.view_audit" }),
    ]);

  if (!department) redirect("/people/departments");
  if (
    department.account_id !==
    ((accountId as string | null) ?? null)
  ) {
    redirect("/people/departments");
  }

  // Список ролей для прикрепления — скоупим к active account (плюс
  // системные с account_id = null). Иначе для multi-account юзера в
  // выпадашке появились бы кастомные роли из чужих аккаунтов.
  const { data: allRoles } = await supabase
    .from("roles")
    .select("id, name, code, icon, icon_color, account_id, department_id")
    .or(`account_id.is.null,account_id.eq.${accountId as string}`)
    .order("account_id", { nullsFirst: true })
    .order("name");

  // Профили created_by / updated_by для info-popover — паттерн из
  // role-detail-page.tsx.
  const auditUserIds = Array.from(
    new Set(
      [department.created_by, department.updated_by].filter(
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
    ((auditProfilesResult.data as
      | { id: string; first_name: string | null; last_name: string | null }[]
      | null) ?? []).map((p) => [p.id, p]),
  );

  const formatProfile = (uid: string | null): string | null => {
    if (!uid) return null;
    const p = profileMap.get(uid);
    if (!p) return null;
    const first = (p.first_name ?? "").trim();
    const last = (p.last_name ?? "").trim();
    if (!first && !last) return null;
    return last ? `${first} ${last.charAt(0)}.`.trim() : first;
  };

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
      createdByName={formatProfile(department.created_by)}
      updatedByName={formatProfile(department.updated_by)}
    />
  );
}
