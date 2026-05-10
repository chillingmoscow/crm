import { redirect } from "next/navigation";

import { createClient, getCachedUser } from "@/lib/supabase/server";
import { TableLabClient } from "./_components/table-lab-client";

const ALLOWED_ROLES = new Set(["owner", "admin", "manager"]);

export default async function TableLabPage() {
  const [user, supabase] = await Promise.all([
    getCachedUser(),
    createClient(),
  ]);

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active_venue_id) redirect("/onboarding");

  const { data: membership } = await supabase
    .from("user_venue_roles")
    .select("roles(code)")
    .eq("user_id", user.id)
    .eq("venue_id", profile.active_venue_id)
    .eq("status", "active")
    .maybeSingle();

  const roleCode = (membership?.roles as { code: string } | null)?.code ?? null;
  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) redirect("/dashboard");

  return <TableLabClient />;
}
