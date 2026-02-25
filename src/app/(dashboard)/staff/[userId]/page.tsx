import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffDetailPage } from "./_components/staff-detail-page";
import type { FullStaffProfile } from "../actions";

export default async function StaffMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const supabase = await createClient();
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

  // Target user's profile (bypasses RLS — admin)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRow } = await (admin as any)
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, telegram_id, gender, birth_date, address, employment_date, avatar_url, medical_book_number, medical_book_date, passport_photos, comment"
    )
    .eq("id", userId)
    .maybeSingle();

  if (!profileRow) redirect("/staff");

  // Target user's active UVR in this venue
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: targetUvr } = await (admin as any)
    .from("user_venue_roles")
    .select("id, role_id, roles(name, code)")
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle();

  if (!targetUvr) redirect("/staff");

  // Available roles
  const { data: roles } = await supabase
    .from("roles")
    .select("id, name, code")
    .order("name");

  // Map profile row to FullStaffProfile
  const row = profileRow as unknown as Record<string, unknown>;
  const staffProfile: FullStaffProfile = {
    id:                  row.id as string,
    first_name:          (row.first_name as string | null) ?? null,
    last_name:           (row.last_name as string | null) ?? null,
    phone:               (row.phone as string | null) ?? null,
    telegram_id:         (row.telegram_id as string | null) ?? null,
    gender:              (row.gender as string | null) ?? null,
    birth_date:          (row.birth_date as string | null) ?? null,
    address:             (row.address as string | null) ?? null,
    employment_date:     (row.employment_date as string | null) ?? null,
    avatar_url:          (row.avatar_url as string | null) ?? null,
    medical_book_number: (row.medical_book_number as string | null) ?? null,
    medical_book_date:   (row.medical_book_date as string | null) ?? null,
    passport_photos:     (row.passport_photos as string[] | null) ?? [],
    comment:             (row.comment as string | null) ?? null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uvrRow = targetUvr as any;

  return (
    <StaffDetailPage
      profile={staffProfile}
      email={targetAuthUser.email ?? ""}
      uvrId={uvrRow.id}
      roleName={uvrRow.roles?.name ?? ""}
      venueId={venueId}
      roles={roles ?? []}
      canEdit={canEdit}
      isMe={user.id === userId}
    />
  );
}
