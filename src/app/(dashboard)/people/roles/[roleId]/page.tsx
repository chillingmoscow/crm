import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listAuditEvents } from "@/lib/audit/list";
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

  const [{ data: accountId }, { data: activeVenueId }] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("get_active_venue_id"),
  ]);

  // Fetch the role with audit fields (created_at/updated_at + by) for the
  // info card on the «Основное» tab. See migration 052.
  const { data: role } = await supabase
    .from("roles")
    .select("id, venue_id, name, code, comment, icon, icon_color, department_id, created_at, updated_at, created_by, updated_by")
    .eq("id", roleId)
    .returns<{
      id: string;
      venue_id: string | null;
      name: string;
      code: string;
      comment: string | null;
      icon: string | null;
      icon_color: string | null;
      department_id: string | null;
      created_at: string | null;
      updated_at: string | null;
      created_by: string | null;
      updated_by: string | null;
    }[]>()
    .maybeSingle();

  if (!role) redirect("/people/roles");

  // Reject access если venue не активный (для venue-scoped). System owner
  // (venue_id NULL) виден всегда.
  if (role.venue_id !== null && role.venue_id !== activeVenueId) {
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

  // Журнал. Префетчим первую страницу для таба «Журнал», если у юзера
  // есть `org.view_audit`. Без него фетч пропускаем (RLS всё равно
  // выдаст пусто, экономим запрос).
  const { data: canViewAudit } = await supabase.rpc("has_permission", {
    permission_code: "org.view_audit",
  });
  const auditResult = canViewAudit
    ? await listAuditEvents({ entityType: "role", entityId: roleId })
    : { events: [], hasMore: false, error: null };

  const [permissionsResult, rolePermsResult, importedRoleResult, departmentsResult] =
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
      activeVenueId
        ? supabase
            .from("departments")
            .select("id, name")
            .eq("venue_id", activeVenueId as string)
            .order("name")
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
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
      departments={departmentsResult.data ?? []}
      canViewAudit={Boolean(canViewAudit)}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
    />
  );
}
