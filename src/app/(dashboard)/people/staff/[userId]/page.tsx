import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StaffDetailPage } from "./_components/staff-detail-page";
import { listAuditEvents } from "@/lib/audit/list";
import type { StaffProfile, StaffAccountDetails } from "../actions";

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
  searchParams: Promise<{ from?: string }>;
}) {
  const { userId } = await params;
  const { from } = await searchParams;
  const back = (from && BACK_CONTEXTS[from]) || null;

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

  // Гейт доступа к карточке сотрудника. Данные ниже читаются через
  // service-role (admin, в обход RLS), поэтому страницу обязательно закрываем
  // правом people.view_staff — иначе её можно открыть по прямому URL. Свою
  // информацию пользователь смотрит в /profile, отдельный доступ к карточке
  // сотрудника без права не нужен.
  const { data: canViewStaff } = await supabase.rpc("has_permission", {
    permission_code: "people.view_staff",
  });
  if (!canViewStaff) redirect("/dashboard");

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

  // Target user email
  const {
    data: { user: targetAuthUser },
  } = await admin.auth.admin.getUserById(userId);
  if (!targetAuthUser) redirect("/people/staff");

  // Параллелим: персональный профиль (тир 1+2), UVR (terminal_pin + role),
  // тенант-данные (тир 3), QR-link, список ролей.
  const [
    { data: profileRow },
    { data: targetUvr },
    { data: accountDetailsRow },
    { data: importedLink },
    { data: roles },
    { data: pendingInviteRow },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, first_name, last_name, phone, telegram_id, gender, birth_date, birth_date_set_at, address, avatar_url"
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
        "account_id, user_id, employment_date, medical_book_number, medical_book_date, passport_photos, comment"
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
    // Есть ли неотозванное приглашение на email этого юзера в текущем venue.
    // Надёжный признак «приглашён, но ещё не активировал» — в отличие от
    // email_confirmed, который у импортированного сотрудника после смены email
    // может остаться true (admin email_confirm:false не снимает подтверждение).
    admin
      .from("invitations")
      .select("id")
      .eq("venue_id", venueId)
      .ilike("email", targetAuthUser.email ?? "__no_email__")
      .eq("status", "pending")
      .limit(1)
      .maybeSingle(),
  ]);

  if (!profileRow) redirect("/people/staff");
  if (!targetUvr) redirect("/people/staff");

  // Журнал + Активность. RLS на audit_logs фильтрует по org.view_audit;
  // canViewAudit нужен фронту, чтобы решить рендерить ли табы.
  const { data: canViewAudit } = await supabase.rpc("has_permission", {
    permission_code: "org.view_audit",
  });
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
    account_id:          accountId,
    user_id:             userId,
    employment_date:     null,
    medical_book_number: null,
    medical_book_date:   null,
    passport_photos:     [],
    comment:             null,
  };

  const isFired = targetUvr.status === "fired";

  // needs_password_setup ставит setImportedStaffEmailAndInvite при выдаче
  // приглашения и снимает acceptInvitation при успешной активации (см.
  // invite/accept/actions.ts). Это надёжный признак «приглашён, но ещё не
  // активировал» даже если строка-инвайт в `invitations` потерялась
  // (например, прежний инвайт уничтожался старым багом переотправки до #441),
  // — в отличие от has_pending_invite (зависит от строки) и email_confirmed
  // (у импортированного остаётся true после admin-смены email).
  const needsPasswordSetup =
    (targetAuthUser.user_metadata as { needs_password_setup?: boolean } | null)
      ?.needs_password_setup === true;

  return (
    <StaffDetailPage
      profile={profileRow}
      accountDetails={accountDetails}
      accountId={accountId}
      email={targetAuthUser.email ?? ""}
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
      firedAt={targetUvr.fired_at}
      firedReason={targetUvr.fired_reason}
      isMe={user.id === userId}
      importedFromQuickResto={Boolean(importedLink)}
      joinedAt={targetUvr.created_at}
      userCreatedAt={targetAuthUser.created_at ?? null}
      emailConfirmed={Boolean(targetAuthUser.email_confirmed_at)}
      hasPendingInvite={Boolean(pendingInviteRow)}
      needsPasswordSetup={needsPasswordSetup}
      canViewAudit={Boolean(canViewAudit)}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
      initialActivityEvents={activityResult.events}
      initialActivityHasMore={activityResult.hasMore}
      backHref={back?.href}
      backLabel={back?.label}
    />
  );
}
