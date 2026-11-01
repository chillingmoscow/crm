import { StaffDoorCode } from "../../candidates/_components/staff-door-code";
import { StaffTerminationStatus } from "../_components/staff-termination-status";
import { asLooseDb } from "@/lib/supabase/loose";
import { redirect } from "next/navigation";
import {
  createClient,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffDetailPage } from "./_components/staff-detail-page";
import { listAuditEvents } from "@/lib/audit/list";
import type { StaffProfile, StaffAccountDetails } from "../actions";
import { staffProfileIdentitySchema } from "@/lib/people/staff-identity";

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

type VenueRow = { account_id: string | null };

// Контекст перехода → куда ведёт хлебная крошка «назад». Whitelist
// (а не произвольный URL) — чтобы не открывать дыру open-redirect.
const BACK_CONTEXTS: Record<string, { href: string; label: string }> = {
  inventory: { href: "/documents/inventory", label: "Акты инвентаризации" },
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
  type LooseQueryBuilder = {
    select: (columns: string) => LooseQueryBuilder;
    eq: (column: string, value: unknown) => LooseQueryBuilder;
    maybeSingle: () => Promise<{ data: unknown }>;
  };
  const db = supabase as unknown as {
    from: (table: string) => LooseQueryBuilder;
  };

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

  // Гейт доступа к карточке сотрудника. Данные ниже читаются через
  // service-role (admin, в обход RLS), поэтому страницу обязательно закрываем
  // правом people.view_staff — иначе её можно открыть по прямому URL. Свою
  // информацию пользователь смотрит в /profile, отдельный доступ к карточке
  // сотрудника без права не нужен.
  const can = await getCachedPermissionChecker();
  if (!can("people.view_staff")) redirect("/dashboard");

  // Current user's role → canEdit
  const { data: uvr } = await supabase
    .from("user_venue_roles")
    .select("roles(code)")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .maybeSingle();

  const activeRoleCode = (uvr?.roles as { code: string } | null)?.code ?? null;
  const canEdit = ["owner", "manager", "admin"].includes(activeRoleCode ?? "");

  // Текущее заведение → account_id (для запроса staff_account_details).
  const { data: venueRow } = await supabase
    .from("venues")
    .select("account_id")
    .eq("id", venueId)
    .returns<VenueRow[]>()
    .maybeSingle();

  if (!venueRow?.account_id) redirect("/onboarding");
  const accountId = venueRow.account_id;

  // Use admin client to bypass RLS for target user data
  const admin = createAdminClient();

  // Параллелим: персональный профиль (тир 1+2), UVR (terminal_pin + role),
  // тенант-данные (тир 3), QR-link, список ролей.
  const [
    { data: profileRow },
    { data: targetUvr },
    { data: accountDetailsRow },
    { data: importedLink },
    { data: roles },
    identityResult,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, first_name, last_name, phone, telegram_id, gender, birth_date, birth_date_set_at, address, avatar_url",
      )
      .eq("id", userId)
      .returns<StaffProfile[]>()
      .maybeSingle(),
    admin
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
      .maybeSingle(),
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
      .from("external_entity_links")
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
    // Read minimal, venue-scoped identity without GoTrue's full Auth serializer.
    // Legacy HR-only records can have NULL tokens / an infinite login ban.
    asLooseDb(supabase).rpc("get_staff_profile_identity", { p_user_id: userId }),
  ]);

  if (!profileRow) redirect("/people/staff");
  if (!targetUvr) redirect("/people/staff");
  if (identityResult.error)
    throw new Error("Не удалось загрузить данные карточки сотрудника");
  const identity = staffProfileIdentitySchema.nullable().parse(identityResult.data);
  if (!identity || identity.id !== userId) redirect("/people/staff");

  const { data: pendingInviteRow } = identity.email
    ? await admin
        .from("invitations")
        .select("id")
        .eq("venue_id", venueId)
        .ilike("email", identity.email)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Журнал + Активность. RLS на audit_logs фильтрует по org.view_audit;
  // canViewAudit нужен фронту, чтобы решить рендерить ли табы.
  const canViewAudit = can("org.view_audit");
  const [auditResult, activityResult] = canViewAudit
    ? await Promise.all([
        listAuditEvents({ entityType: "staff", entityId: userId }),
        listAuditEvents({ filterGroups: [{ actorIds: [userId] }] }),
      ])
    : [
        { events: [], hasMore: false, error: null },
        { events: [], hasMore: false, error: null },
      ];

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

  const candidateLink = await asLooseDb(supabase)
    .from<{ id: string; full_name: string }>("candidates")
    .select("id,full_name")
    .eq("account_id", accountId)
    .eq("hired_user_id", userId)
    .limit(1)
    .maybeSingle();

  const { data: accountOwner } = await admin
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("owner_id", user.id)
    .maybeSingle();
  const door =
    accountOwner && candidateLink.data
      ? await asLooseDb(admin)
          .from("staff_door_codes")
          .select("id")
          .eq("account_id", accountId)
          .eq("user_id", userId)
          .is("revoked_at", null)
          .maybeSingle()
      : null;
  const termination = can("people.edit_staff")
    ? await asLooseDb(admin)
        .from<{
          state: string;
          error: string | null;
          door_revoked: boolean;
          shared_access: boolean;
          employee_id: number | null;
          guest_id: number | null;
          attempts: number;
        }>("staff_terminations")
        .select(
          "state,error,door_revoked,shared_access,employee_id,guest_id,attempts",
        )
        .eq("account_id", accountId)
        .eq("uvr_id", targetUvr.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()
    : null;
  const revokedDoorNumbers =
    accountOwner && termination?.data?.door_revoked
      ? await asLooseDb(admin)
          .from<
            { user_number: number; revoked_at: string | null }[]
          >("staff_door_codes")
          .select("user_number,revoked_at")
          .eq("account_id", accountId)
          .eq("user_id", userId)
      : null;
  return (
    <>
      <StaffDetailPage
        candidateId={candidateLink.data?.id ?? null}
        doorCode={door?.data ? <StaffDoorCode userId={userId} /> : null}
        terminationStatus={
          isFired && termination?.data ? (
            <StaffTerminationStatus
              uvrId={targetUvr.id}
              status={termination.data}
              doorNumbers={revokedDoorNumbers?.data
                ?.filter((x) => x.revoked_at)
                .map((x) => x.user_number)}
            />
          ) : null
        }
        profile={profileRow}
        accountDetails={accountDetails}
        accountId={accountId}
        email={identity.email}
        uvrId={targetUvr.id}
        roleId={targetUvr.role_id}
        roleName={targetUvr.roles?.name ?? ""}
        roleCode={targetUvr.roles?.code ?? ""}
        departmentId={targetUvr.roles?.departments?.id ?? null}
        departmentName={targetUvr.roles?.departments?.name ?? null}
        terminalPin={targetUvr.terminal_pin}
        venueId={venueId}
        roles={roles ?? []}
        canEdit={canEdit}
        isFired={isFired}
        canRestore={
          !termination?.data ||
          termination.data.shared_access ||
          (!termination.data.employee_id &&
            !termination.data.guest_id &&
            !termination.data.door_revoked)
        }
        firedAt={targetUvr.fired_at}
        firedReason={targetUvr.fired_reason}
        isMe={user.id === userId}
        importedFromQuickResto={
          Boolean(importedLink) && !identity.from_candidate
        }
        joinedAt={targetUvr.created_at}
        userCreatedAt={identity.created_at}
        emailConfirmed={identity.email_confirmed}
        hasPendingInvite={Boolean(pendingInviteRow)}
        needsPasswordSetup={needsPasswordSetup}
        canViewAudit={Boolean(canViewAudit)}
        canConfigurePayroll={can("payroll.configure")}
        initialTab={tab === "documents" || tab === "pay" ? tab : "main"}
        initialAuditEvents={auditResult.events}
        initialAuditHasMore={auditResult.hasMore}
        initialActivityEvents={activityResult.events}
        initialActivityHasMore={activityResult.hasMore}
        backHref={back?.href}
        backLabel={back?.label}
      />
    </>
  );
}
