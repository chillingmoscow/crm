import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { StaffClient } from "./_components/staff-client";
import { getStaff, getPendingInvitations, getFiredStaff, getOfficialStaffUserIds } from "./actions";
import { getCasualStaff } from "@/lib/payroll/casual-list";

export const metadata: Metadata = { title: "Сотрудники" };

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
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

  const [{ data: profile }, can] = await Promise.all([
    supabase
      .from("profiles")
      .select("active_venue_id")
      .eq("id", user.id)
      .maybeSingle(),
    getCachedPermissionChecker(),
  ]);

  if (!profile?.active_venue_id) redirect("/onboarding");
  const venueId = profile.active_venue_id;

  // Гейт доступа к разделу «Сотрудники». Данные ниже тянутся через
  // service-role (getStaff и т.п., в обход RLS), поэтому страницу обязательно
  // закрываем правом people.view_staff — иначе её можно открыть по прямому URL.
  if (!can("people.view_staff")) redirect("/dashboard");

  // Stage D: roles + departments теперь venue-scoped, фильтруем строго
  // по active venue. Owner — единственная system role (venue_id IS NULL),
  // в дроп фильтра по должностям на этой странице её не показываем —
  // она не имеет отдельного департамента и не выбирается как фильтр.
  const [
    { data: roles },
    { data: departments },
    { data: uvr },
    staff,
    invitations,
    firedStaff,
    officialUserIds,
    pinResult,
    casual,
  ] = await Promise.all([
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
    supabase
      .from("user_venue_roles")
      .select("roles(code)")
      .eq("user_id", user.id)
      .eq("venue_id", venueId)
      .maybeSingle(),
    getStaff(venueId),
    getPendingInvitations(venueId),
    getFiredStaff(venueId),
    // Без права просмотра зарплаты база отдаёт пустоту — метки и фильтра нет.
    can("payroll.view") ? getOfficialStaffUserIds(venueId) : Promise.resolve<string[]>([]),
    // PIN кассы и разовые — в той же волне, а не следом: каждый запрос к базе
    // с сервера стоит 20–50 мс, и цепочка заметно тормозила переход в раздел.
    // PIN читаем всегда, а показываем только старшим ролям (ниже).
    db
      .from("user_venue_roles")
      .select("id, terminal_pin")
      .eq("venue_id", venueId) as unknown as Promise<{ data: { id: string; terminal_pin: string | null }[] | null }>,
    // Unavailable until the database update for casual workers is applied.
    getCasualStaff(venueId, can("people.edit_staff")).catch((error: unknown) => {
      console.error("casual staff unavailable:", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  const activeRoleCode =
    (uvr?.roles as { code: string } | null)?.code ?? null;
  // То же право, что проверяют карточка сотрудника и серверные действия:
  // раньше здесь сверялся код должности, и человек с правом на своей должности
  // не видел «Добавить» в списке.
  const canEdit = can("people.edit_staff");
  // Тот же набор, что открывает карточку сотрудника: без него сервер не отдаёт
  // контакты и даты коллег (миграция 359), а карточка редиректит.
  const canSeeStaffDetails =
    can("people.view_staff") && can("people.view_staff_details");
  // The till PIN column: codes are shown only to the venue's senior roles.
  const canSeePins = ["owner", "manager", "admin"].includes(activeRoleCode ?? "");
  const pins = new Map(canSeePins ? (pinResult.data ?? []).map((row) => [row.id, row.terminal_pin]) : []);

  // Email'ы с неотозванным приглашением — надёжный признак «приглашён, но ещё
  // не активировал» для сотрудника, который уже в списке staff (импортированный
  // с выданным email). Бейдж «Ожидает» и переотправку ведём по этому признаку,
  // а не по email_confirmed (он у такого сотрудника может остаться true).
  const pendingInviteEmails = new Set(
    invitations.map((inv) => inv.email.toLowerCase()),
  );
  const enrichedStaff = staff.map((member) => ({
    ...member,
    terminal_pin: pins.get(member.uvr_id) ?? null,
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
      canEditStaff={canEdit}
      canConvertCasual={canEdit && can("payroll.configure")}
      canSeeStaffDetails={canSeeStaffDetails}
      casual={casual}
      officialUserIds={officialUserIds}
      openAddCasual={(await searchParams).add === "casual" && canEdit && !!casual}
    />
  );
}
