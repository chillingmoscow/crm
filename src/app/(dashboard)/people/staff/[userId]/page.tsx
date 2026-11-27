import type { Metadata } from "next";
import { StaffDoorCode } from "@/components/people/staff-door-code";
import { StaffTerminationStatus } from "../_components/staff-termination-status";
import { StaffRestoreStatus } from "../_components/staff-restore-status";
import { asLooseDb } from "@/lib/supabase/loose";
import { businessDate, zonedParts } from "@/lib/sales/time";
import { redirect } from "next/navigation";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffDetailPage } from "./_components/staff-detail-page";
import type { StaffProfile, StaffAccountDetails } from "../actions";
import { staffProfileIdentitySchema } from "@/lib/people/staff-identity";
import { getOfficialEmployment } from "../official-actions";
import { getActiveAccountTimezone } from "@/lib/settings/account";
import { loadOnShift } from "@/lib/people/staff-presence-server";
import { loadStaffMonthStats } from "@/lib/people/staff-card-stats";

export const metadata: Metadata = { title: "Сотрудник" };

// force-dynamic: Next 15 может статически закэшировать RSC payload для
// dynamic-сегмента при определённых условиях (особенно после
// revalidatePath не-этого пути). Симптом — после save юзер делает F5,
// видит ту же страницу со старыми (или вообще пустыми) полями. Эта
// страница user-specific + readsr из cookies (auth), кэшировать её
// бессмысленно — форсим dynamic'ы explicitly.
export const dynamic = "force-dynamic";

type TargetVenueRole = {
  id: string;
  role_id: string;
  terminal_pin: string | null;
  status: "active" | "fired";
  fired_at: string | null;
  fired_reason: string | null;
  // Колонка в БД называется created_at — это «когда сотрудник попал в
  // команду» (RPC get_venue_staff алиасит её в joined_at для фронта).
  created_at: string | null;
  roles: {
    name: string;
    code: string;
    department_id: string | null;
    departments: { id: string; name: string } | null;
  } | null;
};

type StaffTerminationRow = {
  state: string;
  error: string | null;
  door_revoked: boolean;
  shared_access: boolean;
  employee_id: number | null;
  guest_id: number | null;
  attempts: number;
};

// Контекст перехода → куда ведёт хлебная крошка «назад». Whitelist
// (а не произвольный URL) — чтобы не открывать дыру open-redirect.
const BACK_CONTEXTS: Record<string, { href: string; label: string }> = {
  inventory: { href: "/documents/inventory", label: "Акты инвентаризации" },
  schedule: { href: "/schedule", label: "Расписание" },
};

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ from?: string; tab?: string }>;
}) {
  const { userId } = await params;
  const { from, tab } = await searchParams;
  const back = (from && BACK_CONTEXTS[from]) || null;

  const supabase = await createClient();
  const db = asLooseDb(supabase);
  // Use admin client to bypass RLS for target user data
  const admin = createAdminClient();
  const adminDb = asLooseDb(admin);

  // Волна 1: кто смотрит, его права, активное заведение и аккаунт. Пользователь,
  // права и аккаунт кэшированы на запрос — layout их уже запросил.
  const [user, can, activeVenue, accountId] = await Promise.all([
    getCachedUser(),
    getCachedPermissionChecker(),
    supabase.rpc("get_active_venue_id"),
    getCachedActiveAccountId(),
  ]);
  if (!user) redirect("/login");

  // Гейт доступа к карточке сотрудника. Данные ниже читаются через
  // service-role (admin, в обход RLS), поэтому страницу обязательно закрываем
  // правом people.view_staff_details — иначе ПДн и документы доступны по прямому URL. Свою
  // информацию пользователь смотрит в /profile, отдельный доступ к карточке
  // сотрудника без права не нужен.
  if (!can("people.view_staff") || !can("people.view_staff_details")) redirect("/dashboard");

  const venueId = (activeVenue.data as string | null) ?? null;
  if (!venueId || !accountId) redirect("/onboarding");

  const canEdit = can("people.edit_staff");
  // Журнал и Активность грузятся при открытии вкладки; RLS на audit_logs
  // фильтрует по org.view_audit, флаг нужен фронту, чтобы показать вкладки.
  const canViewAudit = can("org.view_audit");
  const canViewPayroll = can("payroll.view");

  // Волна 2: всё, что зависит только от аккаунта, заведения и сотрудника, —
  // одним Promise.all. Запросы, которым нужен результат соседнего (членство,
  // email, владелец), идут цепочкой внутри волны, не отдельной волной.
  const uvrPromise = admin
    .from("user_venue_roles")
    .select(
      // departments embed disambiguated по FK roles_department_id_fkey
      // — без явного указателя PostgREST видит две связи (есть ещё
      // departments.head_role_id → roles) и возвращает ошибку.
      "id, role_id, terminal_pin, status, fired_at, fired_reason, created_at, roles(name, code, department_id, departments!roles_department_id_fkey(id, name))",
    )
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .in("status", ["active", "fired"])
    .returns<TargetVenueRole[]>()
    .maybeSingle()
    .then(({ data }) => data);
  // Read minimal, venue-scoped identity without GoTrue's full Auth serializer.
  // Legacy HR-only records can have NULL tokens / an infinite login ban.
  const identityPromise = db
    .rpc("get_staff_profile_identity", { p_user_id: userId })
    .then((result) => {
      if (result.error) throw new Error("Не удалось загрузить данные карточки сотрудника");
      return staffProfileIdentitySchema.nullable().parse(result.data);
    });
  const ownerPromise = admin
    .from("accounts")
    .select("owner_id")
    .eq("id", accountId)
    .maybeSingle()
    .then(({ data }) => (data as { owner_id: string | null } | null)?.owner_id ?? null);
  const candidatePromise = db
    .from<{ id: string; full_name: string }>("candidates")
    .select("id,full_name")
    .eq("account_id", accountId)
    .eq("hired_user_id", userId)
    .limit(1)
    .maybeSingle();
  // «Сегодня» в часовом поясе заведения — дефолт даты смены должности и
  // месяц показателей в шапке.
  const salesSettingsPromise = adminDb
    .from<{ timezone: string; day_start_hour: number }>("sales_settings")
    .select("timezone, day_start_hour")
    .eq("venue_id", venueId)
    .maybeSingle()
    .then(({ data }) => data);
  const canViewSchedule = can("schedule.view_all");
  const uvrState = (uvr: TargetVenueRole | null) =>
    uvr ? { id: uvr.id, fired: uvr.status === "fired" } : null;

  const [
    { data: profileRow },
    targetUvr,
    { data: accountDetailsRow },
    { data: importedLink },
    { data: roles },
    identity,
    ownerId,
    candidateLink,
    pendingInvite,
    door,
    termination,
    restoration,
    revokedDoorNumbers,
    salesSettings,
    officialEmployment,
    officialTermination,
    onShift,
    monthStats,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, first_name, last_name, phone, telegram_id, gender, birth_date, birth_date_set_at, address, avatar_url",
      )
      .eq("id", userId)
      .returns<StaffProfile[]>()
      .maybeSingle(),
    uvrPromise,
    admin
      .from("staff_account_details")
      .select(
        "account_id, user_id, employment_date, medical_book_number, medical_book_date, passport_photos, comment",
      )
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .returns<StaffAccountDetails[]>()
      .maybeSingle(),
    db
      .from<{ id: string }>("external_entity_links")
      .select("id")
      .eq("provider", "quickresto")
      .eq("entity_type", "staff")
      .eq("local_id", userId)
      .maybeSingle(),
    // Stage D: список ролей для смены — строго текущий venue. Owner
    // через staff-UI не назначается (он единственный, привязан к
    // владельцу аккаунта), поэтому system-роль (venue_id IS NULL)
    // не включаем. archived_at IS NULL — архивные роли не предлагаем для
    // назначения (RLS прячет их от обычных членов, но owner их видит).
    supabase
      .from("roles")
      .select("id, name, code")
      .eq("venue_id", venueId)
      .is("archived_at", null)
      .order("name"),
    identityPromise,
    ownerPromise,
    candidatePromise,
    // Неотозванное приглашение на email сотрудника.
    identityPromise.then((identity) =>
      identity?.email
        ? admin
            .from("invitations")
            .select("id")
            .eq("venue_id", venueId)
            .ilike("email", identity.email)
            .eq("status", "pending")
            .limit(1)
            .maybeSingle()
            .then(({ data }) => Boolean(data))
        : false,
    ),
    // Код замка показывается владельцу аккаунта для нанятых из кандидатов.
    Promise.all([ownerPromise, candidatePromise]).then(([owner, candidate]) =>
      owner === user.id && candidate.data
        ? adminDb
            .from<{ id: string }>("staff_door_codes")
            .select("id")
            .eq("account_id", accountId)
            .eq("user_id", userId)
            .is("revoked_at", null)
            .maybeSingle()
            .then(({ data }) => Boolean(data))
        : false,
    ),
    // Статус увольнения показывается только у уволенного.
    uvrPromise.then((uvr) => {
      const state = uvrState(uvr);
      return canEdit && state?.fired
        ? adminDb
            .from<StaffTerminationRow>("staff_terminations")
            .select("state,error,door_revoked,shared_access,employee_id,guest_id,attempts")
            .eq("account_id", accountId)
            .eq("uvr_id", state.id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => data)
        : null;
    }),
    // An unfinished «Восстановить» (error or in progress) replaces the dismissal status.
    uvrPromise.then((uvr) => {
      const state = uvrState(uvr);
      return canEdit && state?.fired
        ? adminDb
            .from<{ state: string; error: string | null; attempts: number }>("staff_restorations")
            .select("state,error,attempts")
            .eq("account_id", accountId)
            .eq("uvr_id", state.id)
            .not("state", "in", "(complete,cancelled)")
            .limit(1)
            .maybeSingle()
            .then(({ data }) => data)
        : null;
    }),
    // Номера отозванных кодов замка — владельцу, в статусе увольнения
    // (показываются, если увольнение отзывало замок).
    Promise.all([ownerPromise, uvrPromise]).then(([owner, uvr]) =>
      canEdit && owner === user.id && uvrState(uvr)?.fired
        ? adminDb
            .from<{ user_number: number; revoked_at: string | null }[]>("staff_door_codes")
            .select("user_number,revoked_at")
            .eq("account_id", accountId)
            .eq("user_id", userId)
            .then(({ data }) => data)
        : null,
    ),
    salesSettingsPromise,
    // Официальное трудоустройство — только с правом просмотра зарплаты.
    canViewPayroll ? getOfficialEmployment(userId) : null,
    // Окно «Уволить сотрудника» спрашивает дату официального увольнения, если
    // человек оформлен официально в этом заведении. Увольнять может и тот, кто
    // зарплату не видит (под RLS оформление ему не видно), поэтому читаем
    // service-role, но только факт открытого оформления и его дату начала:
    // заведение и сотрудник фиксированы, оклад и договор сюда не попадают.
    uvrPromise.then((uvr) =>
      canEdit && uvr && uvr.status !== "fired"
        ? loadOpenOfficialStart(accountId, venueId, userId)
        : null,
    ),
    // Точка «Сейчас на смене» у аватара — для работающих.
    uvrPromise.then((uvr) =>
      uvr && uvr.status !== "fired" ? loadOnShift(venueId, userId) : null,
    ),
    // Смены и «Начислено» за текущий месяц в шапке — по правам на график и
    // зарплату; у уволенного не показываем.
    Promise.all([uvrPromise, salesSettingsPromise]).then(([uvr, settings]) => {
      if (!uvr || uvr.status === "fired") return null;
      const clock = {
        timezone: settings?.timezone ?? "Europe/Moscow",
        dayStartHour: settings?.day_start_hour ?? 9,
      };
      return loadStaffMonthStats({
        venueId,
        userId,
        today: businessDate(new Date(), clock.timezone, clock.dayStartHour),
        clock,
        canViewSchedule,
        canViewPayroll,
      }).catch((error: unknown) => {
        console.error("staff month stats unavailable:", error instanceof Error ? error.message : error);
        return null;
      });
    }),
  ]);

  if (!profileRow) redirect("/people/staff");
  if (!targetUvr) redirect("/people/staff");
  if (!identity || identity.id !== userId) redirect("/people/staff");

  // Если для пары (account_id, user_id) ещё нет ряда в staff_account_details
  // — это норма (свежий сотрудник, тенант-данные пусты). Подсовываем
  // дефолты, чтобы UI знал «нечего показывать».
  const accountDetails: StaffAccountDetails = accountDetailsRow ?? {
    account_id: accountId,
    user_id: userId,
    employment_date: null,
    medical_book_number: null,
    medical_book_date: null,
    passport_photos: [],
    comment: null,
  };

  const isFired = targetUvr.status === "fired";

  // needs_password_setup ставит setImportedStaffEmailAndInvite при выдаче
  // приглашения и снимает acceptInvitation при успешной активации (см.
  // invite/accept/actions.ts). Это надёжный признак «приглашён, но ещё не
  // активировал» даже если строка-инвайт в `invitations` потерялась
  // (например, прежний инвайт уничтожался старым багом переотправки до #441),
  // — в отличие от has_pending_invite (зависит от строки) и email_confirmed
  // (у импортированного остаётся true после admin-смены email).
  const needsPasswordSetup = identity.needs_password_setup;

  const venueToday = businessDate(
    new Date(),
    salesSettings?.timezone ?? "Europe/Moscow",
    salesSettings?.day_start_hour ?? 9,
  );

  return (
    <>
      <StaffDetailPage
        candidateId={candidateLink.data?.id ?? null}
        doorCode={door ? <StaffDoorCode userId={userId} /> : null}
        terminationStatus={
          isFired && restoration ? (
            <StaffRestoreStatus uvrId={targetUvr.id} status={restoration} />
          ) : isFired && termination && termination.state !== "cancelled" ? (
            <StaffTerminationStatus
              uvrId={targetUvr.id}
              status={termination}
              doorNumbers={
                termination.door_revoked
                  ? revokedDoorNumbers
                      ?.filter((x) => x.revoked_at)
                      .map((x) => x.user_number)
                  : undefined
              }
            />
          ) : null
        }
        profile={profileRow}
        accountDetails={accountDetails}
        accountId={accountId}
        email={identity.email}
        uvrId={targetUvr.id}
        venueToday={venueToday}
        roleId={targetUvr.role_id}
        roleName={targetUvr.roles?.name ?? ""}
        roleCode={targetUvr.roles?.code ?? ""}
        departmentId={targetUvr.roles?.departments?.id ?? null}
        departmentName={targetUvr.roles?.departments?.name ?? null}
        // PIN кассы — только с правом редактировать сотрудников.
        terminalPin={canEdit ? targetUvr.terminal_pin : null}
        venueId={venueId}
        roles={roles ?? []}
        canEdit={canEdit}
        isFired={isFired}
        firedAt={targetUvr.fired_at}
        firedReason={targetUvr.fired_reason}
        isMe={user.id === userId}
        isAccountOwner={ownerId === userId}
        importedFromQuickResto={
          Boolean(importedLink) && !identity.from_candidate
        }
        joinedAt={targetUvr.created_at}
        userCreatedAt={identity.created_at}
        emailConfirmed={identity.email_confirmed}
        hasPendingInvite={pendingInvite}
        needsPasswordSetup={needsPasswordSetup}
        canViewAudit={canViewAudit}
        canConfigurePayroll={can("payroll.configure")}
        officialEmployment={officialEmployment}
        officialTermination={officialTermination}
        canViewPay={canViewPayroll || user.id === userId}
        onShift={Boolean(onShift?.userIds.includes(userId))}
        monthStats={monthStats}
        canViewShiftHeatmap={canViewSchedule || canViewPayroll}
        initialTab={tab === "documents" || tab === "pay" ? tab : "main"}
        backHref={back?.href}
        backLabel={back?.label}
      />
    </>
  );
}

/**
 * Дата начала открытого официального оформления сотрудника в заведении (нет
 * даты увольнения, не отменено) и «сегодня» по часовому поясу аккаунта, как в
 * базе. null — оформления нет, дата официального увольнения не нужна.
 */
async function loadOpenOfficialStart(
  accountId: string,
  venueId: string,
  userId: string,
): Promise<{ startsOn: string; today: string } | null> {
  // Зарплатная карточка и её открытое оформление — одним запросом (встроенная
  // выборка по FK), пояс аккаунта — параллельно.
  const [employee, timezone] = await Promise.all([
    asLooseDb(createAdminClient())
      .from<{ id: string; payroll_official_employments: { starts_on: string }[] }>(
        "payroll_employees",
      )
      .select(
        "id, payroll_official_employments!payroll_official_employments_employee_fkey(starts_on)",
      )
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .eq("local_user_id", userId)
      .is("payroll_official_employments.archived_at", null)
      .is("payroll_official_employments.ends_on", null)
      .order("starts_on", {
        referencedTable: "payroll_official_employments",
        ascending: false,
      })
      .maybeSingle(),
    getActiveAccountTimezone(),
  ]);
  if (employee.error) throw new Error("Не удалось загрузить данные карточки сотрудника");
  const open = employee.data?.payroll_official_employments[0];
  if (!open) return null;
  const today = zonedParts(new Date(), timezone).date;
  return { startsOn: open.starts_on, today };
}
