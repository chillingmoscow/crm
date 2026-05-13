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
  // Колонка в БД называется created_at — это «когда сотрудник попал в
  // команду» (RPC get_venue_staff алиасит её в joined_at для фронта).
  created_at: string | null;
  roles: { name: string; code: string } | null;
};

type VenueRow = { account_id: string | null };

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
      .select("id, role_id, terminal_pin, created_at, roles(name, code)")
      .eq("user_id", userId)
      .eq("venue_id", venueId)
      .eq("status", "active")
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
    supabase.from("roles").select("id, name, code").order("name"),
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

  return (
    <StaffDetailPage
      profile={profileRow}
      accountDetails={accountDetails}
      accountId={accountId}
      email={targetAuthUser.email ?? ""}
      uvrId={targetUvr.id}
      roleId={targetUvr.role_id}
      roleName={targetUvr.roles?.name ?? ""}
      terminalPin={targetUvr.terminal_pin}
      venueId={venueId}
      roles={roles ?? []}
      canEdit={canEdit}
      isMe={user.id === userId}
      importedFromQuickResto={Boolean(importedLink)}
      joinedAt={targetUvr.created_at}
      userCreatedAt={targetAuthUser.created_at ?? null}
      emailConfirmed={Boolean(targetAuthUser.email_confirmed_at)}
      canViewAudit={Boolean(canViewAudit)}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
      initialActivityEvents={activityResult.events}
      initialActivityHasMore={activityResult.hasMore}
    />
  );
}
