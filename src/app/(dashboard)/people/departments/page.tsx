import { redirect } from "next/navigation";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { DepartmentsClient } from "./_components/departments-client";
import { listDepartments } from "./actions";

// На проде после создания подразделения юзер возвращался к списку и не
// видел новой строки — RSC payload оставался в кэше. revalidatePath
// в action'ах помогает, но force-dynamic — страховка от per-request
// статики (страница в любом случае user-/account-specific).
export const dynamic = "force-dynamic";

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
