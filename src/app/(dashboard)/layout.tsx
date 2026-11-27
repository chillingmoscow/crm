import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCachedUser, getCachedActiveAccountId, getCachedPermissions, createClient } from "@/lib/supabase/server";
import { SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/shared/sidebar";
import { WorkspaceSidebarProvider } from "@/components/shared/workspace-sidebar-provider";
import { KB_MENU_COOKIE } from "@/lib/knowledge/shell";
import { WorkspaceAppearance } from "@/components/shared/workspace-appearance";
import { DashboardTopbar } from "@/components/shared/dashboard-topbar";
import { PushPromptBanner } from "@/components/shared/push-prompt-banner";
import { PUSH_PROMPT_COOKIE, parsePushPrompt } from "@/lib/ui/push-prompt-pref";
import { TableWidthProvider } from "@/components/shared/table/table-width-context";
import { TABLE_WIDTH_COOKIE } from "@/lib/ui/table-width-pref";
import { PageHeaderActionsProvider } from "@/components/shared/page-header-actions";
import { HotkeysDialogProvider } from "@/components/shared/hotkeys-dialog";
import { PageTransition } from "@/components/shared/page-transition";
import { CommandPaletteProvider } from "@/components/shared/command-palette";
import { KbSearchProvider } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
import { ImpersonationBanner } from "@/components/shared/impersonation-banner";
import { readActiveImpersonation } from "@/lib/impersonation/session";
import { syncPendingInvitationsForUser } from "@/lib/people/invitations/sync-pending";
import { countInbox } from "@/lib/finance/recurring";
import { countCertificateAlerts } from "@/lib/finance/certificates-actions";
import { countActsInWork } from "@/lib/inventory/acts-in-work";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // getCachedUser deduplicates the Supabase Auth API call across this render tree
  // (layout + all child pages get the same user object from React cache)
  const [user, supabase] = await Promise.all([
    getCachedUser(),
    createClient(),
  ]);
  if (!user) redirect("/login");

  // profile + venues in parallel — saves one sequential round-trip
  const [{ data: profile }, { data: venues }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, active_venue_id, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("get_user_venues"),
  ]);

  let activeVenueId = profile?.active_venue_id ?? null;

  // Safety net: sync pending invitations only for users without an active venue.
  if (!activeVenueId) {
    await syncPendingInvitationsForUser({ userId: user.id, email: user.email });

    // After syncing invitations, try to resolve an active venue immediately to avoid
    // rendering dashboard shell and then redirecting in nested pages.
    const { data: membership } = await supabase
      .from("user_venue_roles")
      .select("venue_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (membership?.venue_id) {
      await supabase
        .from("profiles")
        .update({ active_venue_id: membership.venue_id })
        .eq("id", user.id);
      activeVenueId = membership.venue_id;
    }
  }

  if (!activeVenueId) {
    redirect("/onboarding");
  }

  const userName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email?.split("@")[0] ||
    "Пользователь";

  const venueList = (venues ?? []) as {
    venue_id: string;
    venue_name: string;
    venue_type: string | null;
    role_code: string;
    role_name: string;
  }[];

  // Role code + human-readable name for the currently active venue
  const activeVenue = venueList.find((v) => v.venue_id === activeVenueId);
  const activeRoleCode = activeVenue?.role_code ?? null;
  const activeRoleName = activeVenue?.role_name ?? null;

  // Account name + список permission'ов + счётчик "событий по сотрудникам"
  // параллельно. Permissions нужны для permission-based фильтрации
  // sidebar'а (см. AppSidebar → userPermissions prop). staffAttention —
  // количество сотрудников venue с активным событием (ДР в ближайшие
  // 7 дней / медкнижка ≤30 дн.), рендерится бейджем на пункте
  // «Сотрудники». Cached-обёртки гарантируют что user/account RPC
  // вызываются ровно один раз на RSC-дерево.
  // count_venue_staff_attention — миграция 144, RPC ещё не в типах БД.
  // Каст через unknown — следующая регенерация database.ts уберёт его.
  const supabaseUntyped = supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  const [accountId, userPermissions, attentionRes, candidateCountRes, inboxCount, certificateAlertCount, actsInWorkCount] = await Promise.all([
    getCachedActiveAccountId(),
    getCachedPermissions(),
    supabaseUntyped.rpc("count_venue_staff_attention", { p_venue_id: activeVenueId }),
    supabaseUntyped.rpc("candidate_new_count", {}),
    // Бейдж «На разбор» — только тем, кто может разобрать платёж.
    getCachedPermissions().then((codes) =>
      codes.includes("finance.view_transactions") && codes.includes("finance.create_transaction")
        ? countInbox().catch(() => 0)
        : 0,
    ),
    // Бейдж «Контрагенты»: истекающие и просроченные сертификаты.
    getCachedPermissions().then((codes) =>
      codes.includes("finance.view_counterparties") ? countCertificateAlerts().catch(() => 0) : 0,
    ),
    // Бейдж «Акты инвентаризации»: акты заведения в работе (права — внутри).
    countActsInWork(activeVenueId).catch(() => 0),
  ]);
  let accountName: string | null = null;
  // KB-поиск (Cmd+K) поднят на dashboard-layout, чтобы работать из
  // любого раздела. aiAskEnabled — та же логика, что была в
  // knowledge/layout: kb.ask_ai в правах + accounts.ai_enabled.
  let aiAskEnabled = false;
  if (accountId) {
    const { data: account } = await supabase
      .from("accounts")
      .select("name, ai_enabled")
      .eq("id", accountId)
      .maybeSingle();
    accountName = account?.name ?? null;
    aiAskEnabled =
      userPermissions.includes("kb.ask_ai") && Boolean(account?.ai_enabled);
  }
  // RPC возвращает int; на ошибке/null трактуем как 0 (бейдж не рисуем).
  const staffAttentionCount =
    typeof attentionRes?.data === "number" && attentionRes.data > 0
      ? attentionRes.data
      : 0;

  // Восстановим состояние main-сайдбара (открыт/свёрнут) из cookie
  // `sidebar_state`, который WorkspaceSidebarProvider пишет на каждый toggle
  // вне базы знаний.
  // Без SSR-чтения после reload'а сайдбар каждый раз возвращался в
  // expanded (default), даже если юзер свернул его.
  const cookieStore = await cookies();
  const sidebarStateCookie = cookieStore.get("sidebar_state")?.value;
  const sidebarDefaultOpen = sidebarStateCookie !== "false";

  // KB-сайдбар скрыт/виден — состояние пишется кликом на иконку «База
  // знаний» в main-сайдбаре когда юзер уже на /knowledge (см.
  // KbNavLink + kb-sidebar-visibility-store). Читаем его и здесь
  // (помимо knowledge/layout), чтобы main-сайдбар на любом маршруте
  // мог отрендерить иконку в правильном цвете без post-hydration
  // flicker'а (Codex P2 на PR #129).
  const kbSidebarHidden = cookieStore.get("kb_sidebar_hidden")?.value === "true";
  // Ширины таблиц с прошлого захода и решение о баннере уведомлений —
  // чтобы страница сразу рисовалась такой, какой станет после загрузки.
  const tableWidths = cookieStore.get(TABLE_WIDTH_COOKIE)?.value;
  const pushPrompt = parsePushPrompt(cookieStore.get(PUSH_PROMPT_COOKIE)?.value);

  // Режим «смотрю за другого пользователя» (см. src/lib/impersonation).
  // readActiveImpersonation сверяет билет и с пользователем, и с
  // session_id: билет, переживший выход из аккаунта, до баннера не дойдёт.
  const activeImpersonation = await readActiveImpersonation();

  return (
    // delayDuration=500 — задержка перед показом, чтобы tooltip не
    // выскакивал моментально при beit-курсорах и случайных проходах.
    // Должно совпадать с вложенным TooltipProvider в SidebarProvider
    // (components/ui/sidebar.tsx), иначе значение оттуда перекрывает это.
    <WorkspaceAppearance>
    <TooltipProvider delayDuration={500} skipDelayDuration={500}>
    <WorkspaceSidebarProvider
      appDefaultOpen={sidebarDefaultOpen}
      // В базе знаний меню по умолчанию свёрнуто; развёрнутое там
      // запоминается отдельно (src/lib/knowledge/shell.ts).
      kbDefaultOpen={cookieStore.get(KB_MENU_COOKIE)?.value === "true"}
      // Баннер режима просмотра — fixed, поэтому из потока он выпадает и
      // накрыл бы верх сайдбара и контента. Освобождаем ему место отступом
      // на всём враппере; box-border оставляет общую высоту равной экрану.
      className={activeImpersonation ? "pt-[var(--impersonation-offset)]" : undefined}
      style={
        activeImpersonation
          ? ({ "--impersonation-offset": "49px" } as React.CSSProperties)
          : undefined
      }
    >
      {activeImpersonation && (
        <ImpersonationBanner
          targetName={userName}
          roleName={activeRoleName}
          venueName={activeVenue?.venue_name ?? null}
        />
      )}
      <AppSidebar
        userName={userName}
        userEmail={user.email ?? ""}
        userAvatarUrl={profile?.avatar_url ?? null}
        venues={venueList}
        activeVenueId={activeVenueId}
        activeRoleCode={activeRoleCode}
        activeRoleName={activeRoleName}
        accountName={accountName}
        userPermissions={userPermissions}
        staffAttentionCount={staffAttentionCount}
        candidateAccountId={accountId}
        newCandidatesCount={typeof candidateCountRes?.data === "number" ? candidateCountRes.data : 0}
        inboxCount={inboxCount}
        certificateAlertCount={certificateAlertCount}
        actsInWorkCount={actsInWorkCount}
        kbSidebarHidden={kbSidebarHidden}
        isImpersonating={Boolean(activeImpersonation)}
      />
      {/* min-w-0: SidebarInset и вложенный <main> — флекс-элементы с
          дефолтным min-width:auto. Без этого широкий потомок (напр. таблица
          итогов с горизонтальным скроллом) распирает контент шире вьюпорта →
          справа появляется «белая полоса» (страница скроллится по
          горизонтали). overflow-x-clip — страховка от любого случайного
          горизонтального переполнения; clip (в отличие от hidden/auto) не
          создаёт scroll-контейнер, поэтому sticky-шапки таблиц продолжают
          липнуть к верху страницы. */}
      <SidebarInset className="min-w-0">
        <KbSearchProvider aiAskEnabled={aiAskEnabled}>
          <PageHeaderActionsProvider>
            {/* Top bar: [trigger | breadcrumb] … [actions | bell].
                На /knowledge скрывается — KB рендерит собственный topbar
                (см. components/shared/dashboard-topbar.tsx). */}
            {!activeImpersonation && <PushPromptBanner initial={pushPrompt} />}
            <DashboardTopbar />
            <CommandPaletteProvider userPermissions={userPermissions} activeRoleCode={activeRoleCode} />
            <TableWidthProvider value={tableWidths}>
              <PageTransition className="flex min-w-0 flex-1 flex-col overflow-x-clip">{children}</PageTransition>
            </TableWidthProvider>
          </PageHeaderActionsProvider>
        </KbSearchProvider>
        <HotkeysDialogProvider />
      </SidebarInset>
    </WorkspaceSidebarProvider>
    </TooltipProvider>
    </WorkspaceAppearance>
  );
}
