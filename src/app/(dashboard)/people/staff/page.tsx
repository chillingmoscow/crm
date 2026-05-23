import { redirect } from "next/navigation";
import { getCachedUser, createClient } from "@/lib/supabase/server";
import { StaffClient } from "./_components/staff-client";
import { getStaff, getPendingInvitations, getFiredStaff } from "./actions";

export default async function StaffPage() {
  // Phase 1 — auth + DB client in parallel (independent async operations)
  const [user, supabase] = await Promise.all([
    getCachedUser(),
    createClient(),
  ]);
  type LooseQueryBuilder = {
  select: (columns: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  in: (column: string, values: string[]) => LooseQueryBuilder;
};

const db = supabase as unknown as { from: (table: string) => LooseQueryBuilder };
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active_venue_id) redirect("/onboarding");
  const venueId = profile.active_venue_id;

  // Гейт доступа к разделу «Сотрудники». Данные ниже тянутся через
  // service-role (getStaff и т.п., в обход RLS), поэтому страницу обязательно
  // закрываем правом people.view_staff — иначе её можно открыть по прямому URL.
  const { data: canViewStaff } = await supabase.rpc("has_permission", {
    permission_code: "people.view_staff",
  });
  if (!canViewStaff) redirect("/dashboard");

  // Stage D: roles + departments теперь venue-scoped, фильтруем строго
  // по active venue. Owner — единственная system role (venue_id IS NULL),
  // в дроп фильтра по должностям на этой странице её не показываем —
  // она не имеет отдельного департамента и не выбирается как фильтр.
  const [{ data: roles }, { data: departments }] = await Promise.all([
    supabase
      .from("roles")
      .select("id, name, code")
      .eq("venue_id", venueId)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name")
      .eq("venue_id", venueId)
      .order("name"),
  ]);

  // Phase 3 — all four queries need venueId; run them all in parallel
  const [{ data: uvr }, staff, invitations, firedStaff] = await Promise.all([
    supabase
      .from("user_venue_roles")
      .select("roles(code)")
      .eq("user_id", user.id)
      .eq("venue_id", venueId)
      .maybeSingle(),
    getStaff(venueId),
    getPendingInvitations(venueId),
    getFiredStaff(venueId),
  ]);

  const activeRoleCode =
    (uvr?.roles as { code: string } | null)?.code ?? null;

  const userIds = staff.map((member) => member.user_id);
  let importedLinks: { local_id: string }[] = [];

  if (userIds.length > 0) {
    const importedResult = (await db
      .from("external_entity_links")
      .select("local_id")
      .eq("provider", "quickresto")
      .eq("entity_type", "staff")
      .in("local_id", userIds)) as unknown as { data: { local_id: string }[] | null };

    importedLinks = importedResult.data ?? [];
  }

  const importedIds = new Set(importedLinks.map((row) => row.local_id));
  // Email'ы с неотозванным приглашением — надёжный признак «приглашён, но ещё
  // не активировал» для сотрудника, который уже в списке staff (импортированный
  // с выданным email). Бейдж «Ожидает» и переотправку ведём по этому признаку,
  // а не по email_confirmed (он у такого сотрудника может остаться true).
  const pendingInviteEmails = new Set(
    invitations.map((inv) => inv.email.toLowerCase()),
  );
  const enrichedStaff = staff.map((member) => ({
    ...member,
    imported_from_quickresto: importedIds.has(member.user_id),
    has_pending_invite: member.email
      ? pendingInviteEmails.has(member.email.toLowerCase())
      : false,
  }));

  // Не показываем pending-приглашение как отдельную карточку, если этот email
  // уже активный сотрудник venue. Так бывает при выдаче email импортированному
  // сотруднику (setImportedStaffEmailAndInvite): токен-приглашение нужен только
  // для установки пароля, а сам человек уже в списке staff (Codex P2 на #437).
  const activeStaffEmails = new Set(
    staff.map((m) => m.email?.toLowerCase()).filter((e): e is string => Boolean(e)),
  );
  const visibleInvitations = invitations.filter(
    (inv) => !activeStaffEmails.has(inv.email.toLowerCase()),
  );

  return (
    <StaffClient
      staff={enrichedStaff}
      invitations={visibleInvitations}
      firedStaff={firedStaff}
      roles={roles ?? []}
      departments={departments ?? []}
      venueId={venueId}
      currentUserId={user.id}
      activeRoleCode={activeRoleCode}
    />
  );
}
