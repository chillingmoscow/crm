import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id")
    .eq("id", user!.id)
    .returns<{ active_venue_id: string | null }[]>()
    .maybeSingle();

  if (!profile?.active_venue_id) {
    redirect("/onboarding");
  }

  return (
    <div className="p-6 md:p-8 w-full">
      <h1 className="text-2xl font-semibold">Дашборд</h1>
      <p className="text-muted-foreground mt-1">Добро пожаловать в систему</p>
    </div>
  );
}
