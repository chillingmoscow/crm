import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { DepartmentsClient } from "./_components/departments-client";
import { listDepartments } from "./actions";
import { loadVenueStaffByRole } from "@/lib/people/venue-staff-by-role";
import type { StaffStackMember } from "@/components/people/staff-stack-cell";

export const metadata: Metadata = { title: "Подразделения" };

export default async function DepartmentsPage() {
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  const can = await getCachedPermissionChecker();
  if (!can("people.view_roles")) redirect("/dashboard");
  const canManage = can("people.manage_roles");

  const [{ data: accountId }, { data: activeVenueId }, departments] =
    await Promise.all([
      supabase.rpc("get_active_account_id"),
      supabase.rpc("get_active_venue_id"),
      listDepartments(),
    ]);

  // Люди подразделения — все, кто сейчас на его должностях: аватары и
  // список по наведению в «Сотрудниках», как в списке должностей.
  const venueId = (activeVenueId as string | null) ?? null;
  const [staffByRole, { data: venueRoles }] = await Promise.all([
    loadVenueStaffByRole(supabase, venueId),
    venueId
      ? supabase
          .from("roles")
          .select("id, department_id")
          .eq("venue_id", venueId)
          .not("department_id", "is", null)
      : Promise.resolve({ data: [] as { id: string; department_id: string | null }[] }),
  ]);
  const staffByDepartment: Record<string, StaffStackMember[]> = {};
  const collator = new Intl.Collator("ru", { sensitivity: "base" });
  for (const role of venueRoles ?? []) {
    if (!role.department_id) continue;
    const list = (staffByDepartment[role.department_id] ??= []);
    for (const person of staffByRole[role.id] ?? [])
      if (!list.some((p) => p.id === person.id)) list.push(person);
  }
  for (const list of Object.values(staffByDepartment))
    list.sort((a, b) => collator.compare(a.name, b.name));

  return (
    <DepartmentsClient
      initialDepartments={departments}
      staffByDepartment={staffByDepartment}
      accountId={(accountId as string | null) ?? null}
      canManage={Boolean(canManage)}
    />
  );
}
