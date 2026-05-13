import { redirect } from "next/navigation";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { DepartmentsClient } from "./_components/departments-client";
import { listDepartments } from "./actions";

export default async function DepartmentsPage() {
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "people.view_roles",
  });
  if (!canView) redirect("/dashboard");

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "people.manage_roles",
  });

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
