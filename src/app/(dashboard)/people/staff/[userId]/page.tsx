import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffDetailPage } from "./_components/staff-detail-page";
import type { FullStaffProfile } from "../actions";

type TargetVenueRole = {
  id: string;
  role_id: string;
  roles: { name: string; code: string } | null;
};

export default async function StaffMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

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

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("active_venue_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!myProfile?.active_venue_id) redirect("/onboarding");
  const venueId = myProfile.active_venue_id;

  // Current user's role → canEdit
  const { data: uvr } = await supabase
    .from("user_venue_roles")
    .select("roles(code)")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .maybeSingle();

  const activeRoleCode = (uvr?.roles as { code: string } | null)?.code ?? null;
  const canEdit = ["owner", "manager", "admin"].includes(activeRoleCode ?? "");

  // Use admin client to bypass RLS for target user data
  const admin = createAdminClient();

  // Target user email
  const {
    data: { user: targetAuthUser },
  } = await admin.auth.admin.getUserById(userId);
  if (!targetAuthUser) redirect("/staff");

  const { data: profileRow } = await admin
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, telegram_id, gender, birth_date, address, employment_date, avatar_url, medical_book_number, medical_book_date, passport_photos, comment, terminal_pin"
    )
    .eq("id", userId)
    .returns<FullStaffProfile[]>()
    .maybeSingle();

  if (!profileRow) redirect("/staff");

  // Target user's active UVR in this venue
  const { data: targetUvr } = await admin
    .from("user_venue_roles")
    .select("id, role_id, roles(name, code)")
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .eq("status", "active")
    .returns<TargetVenueRole[]>()
    .maybeSingle();

  if (!targetUvr) redirect("/staff");

  const { data: importedLink } = await db
    .from("external_entity_links")
    .select("id")
    .eq("provider", "quickresto")
    .eq("entity_type", "staff")
    .eq("local_id", userId)
    .maybeSingle();

  // Available roles
  const { data: roles } = await supabase
    .from("roles")
    .select("id, name, code")
    .order("name");

  return (
    <StaffDetailPage
      profile={{
        ...profileRow,
        passport_photos: profileRow.passport_photos ?? [],
      }}
      email={targetAuthUser.email ?? ""}
      uvrId={targetUvr.id}
      roleId={targetUvr.role_id}
      roleName={targetUvr.roles?.name ?? ""}
      venueId={venueId}
      roles={roles ?? []}
      canEdit={canEdit}
      isMe={user.id === userId}
      importedFromQuickResto={Boolean(importedLink)}
    />
  );
}
