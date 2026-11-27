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
  telegramId: string | null;
  /** Уволен, но доступ ещё не закрыт (Quick Resto или чаты): строка остаётся с «Повторить». */
  dismissal: { state: "pending" | "working" | "error"; error: string | null } | null;
};

// Casual workers of a venue for the staff page. The caller checks access.
// `showContacts` — Telegram ID, как контакты штатных: с правом на детали
// сотрудников или на их ведение; иначе null.
export async function getCasualStaff(
  venueId: string,
  { showPins, showContacts }: { showPins: boolean; showContacts: boolean },
  accountId: string,
) {
  const db = asLooseDb(createAdminClient());
  // Связи должностей с Quick Resto — в той же волне по аккаунту, который знает
  // вызывающий (раньше — отдельный шаг за аккаунтом заведения).
  const [employees, dismissals, roles, departments, models, links] = await Promise.all([
    // Неактивные тоже читаем: среди них уволенные с незакрытым доступом.
    db
      .from<{ id: string; name: string; role_id: string | null; role_name: string; quickresto_pin: string | null; telegram_id: string | null; active: boolean }[]>("payroll_employees")
      .select("id,name,role_id,role_name,quickresto_pin,telegram_id,active")
      .eq("venue_id", venueId)
      .eq("casual", true),
    db
      .from<{ employee_id: string; state: "pending" | "working" | "error"; error: string | null }[]>("payroll_casual_dismissals")
      .select("employee_id,state,error")
      .eq("venue_id", venueId)
      .neq("state", "complete"),
    db
      .from<{ id: string; name: string; department_id: string | null }[]>("roles")
      .select("id,name,department_id")
      .eq("venue_id", venueId),
    db.from<{ id: string; name: string }[]>("departments").select("id,name").eq("venue_id", venueId),
    db
      .from<{ role_id: string | null; is_role_default: boolean; archived: boolean; monthly_amount: number; quickresto_role_id: number | null }[]>("payroll_models")
      .select("role_id,is_role_default,archived,monthly_amount,quickresto_role_id")
      .eq("venue_id", venueId),
    db
      .from<{ local_id: string }[]>("external_entity_links")
      .select("local_id")
      .eq("account_id", accountId)
      .eq("provider", "quickresto")
      .eq("entity_type", "role"),
  ]);
  for (const r of [employees, dismissals, roles, departments, models, links]) if (r.error) throw new Error(r.error.message);
  const open = new Map((dismissals.data ?? []).map((d) => [d.employee_id, d]));
  const people = (employees.data ?? []).filter((p) => p.active || open.has(p.id));
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
      telegramId: showContacts ? p.telegram_id : null,
      dismissal: open.has(p.id) ? { state: open.get(p.id)!.state, error: open.get(p.id)!.error } : null,
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
