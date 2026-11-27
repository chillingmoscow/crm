import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { StaffClient } from "./_components/staff-client";
import { getStaff, getPendingInvitations, getFiredStaff, getOfficialStaffUserIds } from "./actions";
import { getCasualStaff } from "@/lib/payroll/casual-list";
import { loadOnShift } from "@/lib/people/staff-presence-server";

export const metadata: Metadata = { title: "Сотрудники" };

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  // Волна 1: пользователь, права и активное заведение — параллельно (раньше
  // профиль за заведением читался вторым шагом).
  const supabase = await createClient();
  const [user, can, { data: activeVenueId }, accountId] = await Promise.all([
    getCachedUser(),
    getCachedPermissionChecker(),
    supabase.rpc("get_active_venue_id"),
    getCachedActiveAccountId(),
  ]);
  type LooseQueryBuilder = {
  select: (columns: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  in: (column: string, values: string[]) => LooseQueryBuilder;
};

const db = supabase as unknown as { from: (table: string) => LooseQueryBuilder };
  if (!user) redirect("/login");
  if (!activeVenueId) redirect("/onboarding");
  const venueId = activeVenueId as string;

  // Гейт доступа к разделу «Сотрудники». Данные ниже тянутся через
  // service-role (getStaff и т.п., в обход RLS), поэтому страницу обязательно
  // закрываем правом people.view_staff — иначе её можно открыть по прямому URL.
  if (!can("people.view_staff")) redirect("/dashboard");

  // Stage D: roles + departments теперь venue-scoped, фильтруем строго
  // по active venue. Owner — единственная system role (venue_id IS NULL),
  // в дроп фильтра по должностям на этой странице её не показываем —
  // она не имеет отдельного департамента и не выбирается как фильтр.
  const canEdit = can("people.edit_staff");
  // PIN кассы — одно правило в списке (штатные и разовые) и в карточке: его
  // видит и меняет тот, кто ведёт сотрудников (people.edit_staff).
  const canSeePins = canEdit;
  const [
    { data: roles },
    { data: departments },
    staff,
    invitations,
    firedStaff,
    officialUserIds,
    pinResult,
    casual,
    onShift,
  ] = await Promise.all([
    // Архивные должности не предлагаются ни в «Добавить», ни в фильтре.
    supabase
      .from("roles")
      .select("id, name, code")
      .eq("venue_id", venueId)
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name")
      .eq("venue_id", venueId)
      .order("name"),
    getStaff(venueId),
    getPendingInvitations(venueId),
    getFiredStaff(venueId),
    // Без права просмотра зарплаты база отдаёт пустоту — метки и фильтра нет.
    can("payroll.view") ? getOfficialStaffUserIds(venueId) : Promise.resolve<string[]>([]),
    // PIN кассы и разовые — в той же волне, а не следом: каждый запрос к базе
    // с сервера стоит 20–50 мс, и цепочка заметно тормозила переход в раздел.
    canSeePins
      ? (db
          .from("user_venue_roles")
          .select("id, terminal_pin")
          .eq("venue_id", venueId) as unknown as Promise<{ data: { id: string; terminal_pin: string | null }[] | null }>)
      : Promise.resolve({ data: null }),
    // Unavailable until the database update for casual workers is applied.
    (accountId ? getCasualStaff(
          venueId,
          {
            showPins: canSeePins,
            // Telegram ID разового — по тем же правам, что контакты штатных.
            showContacts: canEdit || (can("people.view_staff") && can("people.view_staff_details")),
          },
          accountId,
        ) : Promise.resolve(null)).catch((error: unknown) => {
      console.error("casual staff unavailable:", error instanceof Error ? error.message : error);
      return null;
    }),
    // Точка «Сейчас на смене» на аватаре: график и отметки, без подробностей.
    loadOnShift(venueId),
  ]);

  // «Пригласить» и «Разовый» — по праву приглашать: его же проверяют база
  // (invitations, payroll_casual_scope) и серверные действия.
  const canInvite = can("people.invite_staff");
  // Тот же набор, что открывает карточку сотрудника: без него сервер не отдаёт
  // контакты и даты коллег (миграция 359), а карточка редиректит.
  const canSeeStaffDetails =
    can("people.view_staff") && can("people.view_staff_details");
  const pins = new Map((pinResult.data ?? []).map((row) => [row.id, row.terminal_pin]));

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
      canInviteStaff={canInvite}
      canViewPayroll={can("payroll.view")}
      // Перевод разового без кода заводит его в Quick Resto — это право
      // приглашать; плюс карточка (edit_staff) и зарплата (payroll.configure).
      canConvertCasual={canEdit && canInvite && can("payroll.configure")}
      canSeeStaffDetails={canSeeStaffDetails}
      casual={casual}
      officialUserIds={officialUserIds}
      onShiftUserIds={onShift.userIds}
      onShiftEmployeeIds={onShift.employeeIds}
      openAddCasual={(await searchParams).add === "casual" && canInvite && !!casual}
    />
  );
}
