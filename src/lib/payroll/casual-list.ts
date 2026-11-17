import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { casualRoleIds, splitCasualName } from "./casual-name";

export type CasualStaffRow = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  roleName: string;
  /** null when the worker has no personal Quick Resto code yet. */
  pin: string | null;
  lastShiftAt: string | null;
};

// Casual workers of a venue for the staff page. The caller checks access.
export async function getCasualStaff(venueId: string, showPins: boolean) {
  const db = asLooseDb(createAdminClient());
  const [employees, roles, models, venue] = await Promise.all([
    db
      .from<{ id: string; name: string; role_name: string; quickresto_id: number | null; quickresto_pin: string | null; quickresto_provisioning: Record<string, unknown> | null }[]>("payroll_employees")
      .select("id,name,role_name,quickresto_id,quickresto_pin,quickresto_provisioning")
      .eq("venue_id", venueId)
      .eq("casual", true)
      .eq("active", true),
    db.from<{ id: string; name: string }[]>("roles").select("id,name").eq("venue_id", venueId),
    db
      .from<{ role_id: string | null; is_role_default: boolean; archived: boolean; monthly_amount: number; quickresto_role_id: number | null }[]>("payroll_models")
      .select("role_id,is_role_default,archived,monthly_amount,quickresto_role_id")
      .eq("venue_id", venueId),
    db.from<{ account_id: string }>("venues").select("account_id").eq("id", venueId).single(),
  ]);
  for (const r of [employees, roles, models, venue]) if (r.error) throw new Error(r.error.message);
  const people = employees.data ?? [];
  const [links, shifts] = await Promise.all([
    db
      .from<{ local_id: string }[]>("external_entity_links")
      .select("local_id")
      .eq("account_id", venue.data!.account_id)
      .eq("provider", "quickresto")
      .eq("entity_type", "role"),
    people.length
      ? db
          .from<{ payroll_employee_id: string; starts_at: string }[]>("schedule_shifts")
          .select("payroll_employee_id,starts_at")
          .eq("venue_id", venueId)
          .in("payroll_employee_id", people.map((p) => p.id))
          .lte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: false })
          .limit(2000)
      : { data: [], error: null },
  ]);
  if (links.error) throw new Error(links.error.message);
  if (shifts.error) throw new Error(shifts.error.message);
  const lastShift = new Map<string, string>();
  for (const s of shifts.data ?? []) if (!lastShift.has(s.payroll_employee_id)) lastShift.set(s.payroll_employee_id, s.starts_at);
  const eligible = casualRoleIds(models.data ?? [], (links.data ?? []).map((l) => l.local_id));
  const rows: CasualStaffRow[] = people
    .map((p) => {
      const linked = p.quickresto_id !== null && !!p.quickresto_pin;
      return {
        id: p.id,
        name: p.name,
        ...splitCasualName(p.name, p.quickresto_provisioning),
        roleName: p.role_name,
        pin: linked ? (showPins ? p.quickresto_pin : "••••") : null,
        lastShiftAt: lastShift.get(p.id) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return {
    employees: rows,
    roles: (roles.data ?? []).filter((r) => eligible.has(r.id)).sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}
