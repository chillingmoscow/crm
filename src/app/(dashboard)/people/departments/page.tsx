import { redirect } from "next/navigation";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { DepartmentsClient } from "./_components/departments-client";
import { listDepartments } from "./actions";

export default async function DepartmentsPage() {
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  const can = await getCachedPermissionChecker();
  if (!can("people.view_roles")) redirect("/dashboard");
  const canManage = can("people.manage_roles");

  const [{ data: accountId }, departments] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    listDepartments(),
  ]);

  return (
    <DepartmentsClient
      initialDepartments={departments}
      accountId={(accountId as string | null) ?? null}
      canManage={Boolean(canManage)}
    />
  );
}
