import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { casualRoleIds } from "./casual-name";

// Every active casual worker of the venue is in the staff list. Before
// 27.11.2026 only workers with a Sheerly-issued PIN were listed, and a worker
// carried over from Quick Resto (no such PIN) was in the schedule and payroll
// but missing from «Сотрудники».
export type CasualStaffRow = {
  id: string;
  name: string;
  roleId: string | null;
  roleName: string;
  departmentId: string | null;
  departmentName: string | null;
  /** «••••» when the viewer may not see codes; null — Sheerly has not issued a till code yet. */
  pin: string | null;
};

// Casual workers of a venue for the staff page. The caller checks access.
export async function getCasualStaff(venueId: string, showPins: boolean) {
  const db = asLooseDb(createAdminClient());
  const [employees, roles, departments, models, venue] = await Promise.all([
    db
      .from<{ id: string; name: string; role_id: string | null; role_name: string; quickresto_pin: string | null }[]>("payroll_employees")
      .select("id,name,role_id,role_name,quickresto_pin")
      .eq("venue_id", venueId)
      .eq("casual", true)
      .eq("active", true),
    db
      .from<{ id: string; name: string; department_id: string | null }[]>("roles")
      .select("id,name,department_id")
      .eq("venue_id", venueId),
    db.from<{ id: string; name: string }[]>("departments").select("id,name").eq("venue_id", venueId),
    db
      .from<{ role_id: string | null; is_role_default: boolean; archived: boolean; monthly_amount: number; quickresto_role_id: number | null }[]>("payroll_models")
      .select("role_id,is_role_default,archived,monthly_amount,quickresto_role_id")
      .eq("venue_id", venueId),
    db.from<{ account_id: string }>("venues").select("account_id").eq("id", venueId).single(),
  ]);
  for (const r of [employees, roles, departments, models, venue]) if (r.error) throw new Error(r.error.message);
  const people = employees.data ?? [];
  const links = await db
    .from<{ local_id: string }[]>("external_entity_links")
    .select("local_id")
    .eq("account_id", venue.data!.account_id)
    .eq("provider", "quickresto")
    .eq("entity_type", "role");
  if (links.error) throw new Error(links.error.message);
  const eligible = casualRoleIds(models.data ?? [], (links.data ?? []).map((l) => l.local_id));
  const roleById = new Map((roles.data ?? []).map((r) => [r.id, r]));
  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
  const rows: CasualStaffRow[] = people.map((p) => {
    const role = p.role_id ? roleById.get(p.role_id) : undefined;
    return {
      id: p.id,
      name: p.name,
      roleId: p.role_id,
      roleName: p.role_name,
      departmentId: role?.department_id ?? null,
      departmentName: (role?.department_id && departmentName.get(role.department_id)) || null,
      pin: p.quickresto_pin === null ? null : showPins ? p.quickresto_pin : "••••",
    };
  });
  return {
    employees: rows,
    roles: (roles.data ?? [])
      .filter((r) => eligible.has(r.id))
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}
