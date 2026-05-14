"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { applyTheme } from "@/lib/theme";
import {
  User,
  Building2,
  Shield,
  LogOut,
  Settings,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ExternalLink,
  FileBadge2,
  Keyboard,
  Laptop,
  LayoutDashboard,
  LifeBuoy,
  Moon,
  Sun,
  Tags,
  Users,
  Wallet,
  ArrowLeftRight,
  BookOpen,
  Boxes,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { VenueSwitcher } from "@/components/shared/venue-switcher";
import { KbNavLink } from "@/app/(dashboard)/knowledge/_components/kb-nav-link";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Permission code, который нужен для видимости пункта (например
   *  "kb.view_pages"). Если задан — фильтрация идёт по нему вместо
   *  `roles`. Чёткое предпочтение: задавать permission, не roles. */
  permission?: string;
  /** Legacy: список role-кодов. Используется только если permission
   *  не задан. Постепенно мигрируем все пункты на permission и потом
   *  это поле уберём. */
  roles?: string[];
  /** Optional count badge (e.g. unread, pending invitations). */
  badge?: number | string;
};

type NavSection = {
  label: string;
  icon: LucideIcon;
  /** Section-level permission. Если не задано — секция видна, когда
   *  виден ХОТЯ БЫ ОДИН item (вычисляется автоматически). */
  permission?: string;
  /** Legacy fallback. Не задавать в новых секциях. */
  roles?: string[];
  items: NavItem[];
  /** When set, section renders as a direct top-level link (no toggle,
   *  no nested items). Use for "leaf" sections with no logical
   *  children — e.g. /knowledge, where the section IS the destination. */
  href?: string;
  /** Match the active state strictly (only exact pathname). Same
   *  semantic as NavItem.exact. Used together with href. */
  exact?: boolean;
};

// Permission-mapping для каждого пункта. См. supabase/migrations/*
// для исходного определения кодов; коды должны совпадать 1-в-1.
// Section-level permission НЕ задаём — section видна когда виден
// хотя бы один item (вычисляется в isSectionVisible ниже).
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Люди",
    icon: Users,
    items: [
      { title: "Сотрудники",   href: "/people/staff",       icon: User,   permission: "people.view_staff" },
      { title: "Должности",    href: "/people/roles",       icon: Shield, permission: "people.view_roles" },
      { title: "Подразделения", href: "/people/departments", icon: Boxes,  permission: "people.view_roles" },
    ],
  },
  {
    label: "Организация",
    icon: Building2,
    items: [
      { title: "Аккаунт",   href: "/org/account",        icon: Settings,   permission: "org.view_account" },
      { title: "Юрлица",    href: "/org/legal-entities", icon: FileBadge2, permission: "org.view_legal_entities" },
      { title: "Заведения", href: "/org/venues",         icon: Building2,  permission: "org.view_venues" },
      { title: "Журнал",    href: "/org/audit",          icon: ScrollText, permission: "org.view_audit" },
    ],
  },
  {
    // Финансы (стадии 4.x). Подпункты гейтятся каждый своим
    // finance.view_*; manage-уровень — на самих страницах.
    label: "Финансы",
    icon: Wallet,
    items: [
      // exact: чтобы Дашборд не выделялся, когда мы на /finance/categories
      // или другой дочерней странице.
      { title: "Дашборд",     href: "/finance",                icon: LayoutDashboard, exact: true, permission: "finance.view_dashboard" },
      { title: "Транзакции",  href: "/finance/transactions",   icon: ArrowLeftRight,                permission: "finance.view_transactions" },
      { title: "Счета",       href: "/finance/accounts",       icon: Wallet,                        permission: "finance.view_bank_accounts" },
      { title: "Статьи",      href: "/finance/categories",     icon: Tags,                          permission: "finance.view_categories" },
      { title: "Контрагенты", href: "/finance/counterparties", icon: Users,                         permission: "finance.view_counterparties" },
    ],
  },
  {
    // База знаний (стадия 8). Flat-section — клик по самому пункту
    // ведёт на /knowledge, без вложенных подпунктов и chevron'а.
    // permission — на section-уровне, потому что items пустой.
    label: "База знаний",
    icon: BookOpen,
    href: "/knowledge",
    permission: "kb.view_pages",
    items: [],
  },
  {
    label: "Настройки",
    icon: Settings,
    items: [
      { title: "Интеграции", href: "/settings/integrations", icon: Settings, permission: "settings.manage_integrations" },
    ],
  },
];

type Venue = {
  venue_id: string;
  venue_name: string;
  venue_type: string | null;
  role_code: string;
  role_name: string;
};

interface AppSidebarProps {
  userName: string;
  userEmail: string;
  /** URL аватарки из profiles.avatar_url. null → инициалы fallback. */
  userAvatarUrl: string | null;
  venues: Venue[];
  activeVenueId: string | null;
  activeRoleCode: string | null;
  /** Used in the profile popover subtitle: "<Роль> · <Аккаунт>" */
  activeRoleName: string | null;
  accountName: string | null;
  /** Список permission codes текущего пользователя в активном venue.
   *  Сайдбар фильтрует пункты по этому списку (вместо hardcoded
   *  ролей). Передаётся из dashboard layout через RPC list_my_permissions. */
  userPermissions: string[];
  /** Количество сотрудников активного venue, у которых сейчас «висит»
   *  событие (ДР в ближайшие 7 дней / медкнижка ≤30 дн.). Рендерится
   *  бейджем на пункте «Сотрудники». 0 = не показываем. Источник —
   *  RPC count_venue_staff_attention (миграция 144). */
  staffAttentionCount?: number;
  /** SSR-полученное состояние KB-сайдбара из cookie `kb_sidebar_hidden`.
   *  Прокидывается дальше в `KbNavLink` как `initialHidden`, чтобы первый
   *  рендер иконки «База знаний» использовал правильный цвет (muted vs
   *  active) до того как hydration-effect поднимет module-store
   *  (Codex P2 на PR #129). */
  kbSidebarHidden?: boolean;
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarBody {...props} />
      <SidebarRail />
      <TogglePill />
    </Sidebar>
  );
}

/**
 * Маленькая «таблетка» на правом краю сайдбара (matches `EQanD` из .pen).
 * Появляется на hover, разворачивает или сворачивает в зависимости
 * от текущего состояния. Иконка повёрнута в нужную сторону.
 *
 * Hover-affordance работает через `group` класс на корне Sidebar
 * (навешивает shadcn-примитив).
 */
function TogglePill() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
      className={cn(
        "absolute top-14 right-0 translate-x-1/2 z-50",
        "flex items-center justify-center w-5 h-7 rounded-md",
        "bg-background border border-border shadow-md",
        "text-muted-foreground hover:text-foreground hover:bg-accent",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        "transition-opacity duration-150",
      )}
    >
      <Icon className="w-3 h-3" />
    </button>
  );
}

function SidebarBody({
  userName,
  userEmail,
  userAvatarUrl,
  venues,
  activeVenueId,
  activeRoleCode,
  userPermissions,
  staffAttentionCount = 0,
  kbSidebarHidden = false,
}: AppSidebarProps) {
  // activeRoleName / accountName в SidebarBody не нужны — раньше
  // прокидывались в ProfileMenu для верхнего user-блока, который убран.
  // Остаются в AppSidebarProps чтобы не ломать сигнатуру у layout.tsx
  // (могут пригодиться в будущем).
  const userPermissionsSet = useMemo(
    () => new Set(userPermissions),
    [userPermissions],
  );

  // Item visible iff:
  //  - permission задан И входит в userPermissions, ИЛИ
  //  - legacy roles задан И activeRoleCode входит в roles, ИЛИ
  //  - ни permission, ни roles не заданы (показываем всем)
  const isItemVisible = (item: NavItem): boolean => {
    if (item.permission) return userPermissionsSet.has(item.permission);
    if (item.roles) return !activeRoleCode || item.roles.includes(activeRoleCode);
    return true;
  };

  // Section visible iff:
  //  - section.permission задан И входит в userPermissions, ИЛИ
  //  - есть хотя бы один visible item, ИЛИ
  //  - flat-section (href есть) И legacy roles fallback пропускает
  const isSectionVisible = (section: NavSection): boolean => {
    if (section.permission) return userPermissionsSet.has(section.permission);
    if (section.items.some((i) => isItemVisible(i))) return true;
    if (section.href) {
      // flat-section без items и без permission — fallback на legacy roles
      if (section.roles) return !activeRoleCode || section.roles.includes(activeRoleCode);
      return true;
    }
    return false;
  };
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Не удалось выйти");
      return;
    }
    router.push("/login");
  };

  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((s) => ({
        ...s,
        items: s.items.filter(isItemVisible).map((item) =>
          // Бейдж на «Сотрудники»: количество staff с активным событием
          // (ДР / медкнижка). RPC count_venue_staff_attention считает
          // ровно тех, у кого есть бейдж в строке списка — циферка =
          // «сколько строк подсвечены».
          item.href === "/people/staff" && staffAttentionCount > 0
            ? { ...item, badge: staffAttentionCount }
            : item,
        ),
      }))
        .filter(isSectionVisible)
        // Keep flat sections (href set) even если items пустой.
        .filter((s) => s.href !== undefined || s.items.length > 0),
    // Зависим от set, не от исходного массива — Set ссылается на тот
    // же массив, идентичность стабильна между рендерами с одним
    // userPermissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userPermissionsSet, activeRoleCode, staffAttentionCount],
  );

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const section of visibleSections) {
      const hasActive = section.items.some((item) =>
        item.exact ? pathname === item.href : pathname.startsWith(item.href),
      );
      if (hasActive) initial.add(section.label);
    }
    return initial;
  });

  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <>
      <SidebarHeader className="p-2 group-data-[collapsible=icon]:p-3">
        {collapsed ? (
          // Brand label in icon mode (matches cYr2B `Brand` 40×40).
          // Toggling lives in the hover pill on the right edge — see <TogglePill>.
          <div
            aria-hidden
            className="flex aspect-square size-10 items-center justify-center rounded-[10px] bg-primary text-primary-foreground"
          >
            <Building2 className="w-[18px] h-[18px]" />
          </div>
        ) : (
          <VenueSwitcher venues={venues} activeVenueId={activeVenueId} />
        )}
      </SidebarHeader>

      <SidebarContent
        className={cn(
          "px-2 py-2 gap-3",
          collapsed && "px-3 gap-1 items-center",
        )}
      >
        {visibleSections.map((section) => {
          // Flat sections (href set) — render as direct top-level link
          // in both collapsed and expanded modes.
          if (section.href) {
            // Спецкейс — «База знаний». KbNavLink дополнительно
            // обрабатывает click-toggle (когда юзер уже на /knowledge)
            // и hover-peek для overlay-сайдбара. Все остальные flat-
            // секции остаются на дефолтных Flat[Expanded|Collapsed]Link.
            if (section.href === "/knowledge") {
              return (
                <KbNavLink
                  key={section.label}
                  collapsed={collapsed}
                  initialHidden={kbSidebarHidden}
                />
              );
            }
            return collapsed ? (
              <FlatCollapsedLink
                key={section.label}
                section={section}
                pathname={pathname}
              />
            ) : (
              <FlatExpandedLink
                key={section.label}
                section={section}
                pathname={pathname}
              />
            );
          }
          return collapsed ? (
            <CollapsedSectionFlyout
              key={section.label}
              section={section}
              pathname={pathname}
            />
          ) : (
            <ExpandedSection
              key={section.label}
              section={section}
              pathname={pathname}
              isOpen={openSections.has(section.label)}
              onToggle={() => toggleSection(section.label)}
            />
          );
        })}
      </SidebarContent>

      {/* h-16 (64px) лочим явно — без этого высота footer'а зависит от
          контента (button + paddings ≈ 64px expanded, ≈ 48px collapsed
          из-за того что collapsed = только аватар без текста). Любое
          расхождение видно на стыке с KbTreeNav «Корзина» (тоже h-16),
          линии border-top перестают совпадать по горизонтали. */}
      <SidebarFooter className="h-16 p-2 border-t border-sidebar-border flex items-center justify-stretch group-data-[collapsible=icon]:p-3 group-data-[collapsible=icon]:justify-center">
        {collapsed ? (
          <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={userName}
                className="size-8 rounded-full overflow-hidden shrink-0 mx-auto"
              >
                <UserAvatar
                  name={userName}
                  avatarUrl={userAvatarUrl}
                  size={32}
                />
              </button>
            </PopoverTrigger>
            <ProfileMenu
              onSignOut={handleSignOut}
              onClose={() => setUserMenuOpen(false)}
            />
          </Popover>
        ) : (
          <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-sidebar-accent w-full data-[state=open]:bg-sidebar-accent"
              >
                <div className="size-8 rounded-full overflow-hidden shrink-0">
                  <UserAvatar
                    name={userName}
                    avatarUrl={userAvatarUrl}
                    size={32}
                  />
                </div>
                <div className="flex flex-col min-w-0 flex-1 gap-0">
                  <span className="truncate text-[13px] font-semibold leading-tight">
                    {userName}
                  </span>
                  {userEmail && (
                    <span className="truncate text-[11px] text-muted-foreground leading-tight">
                      {userEmail}
                    </span>
                  )}
                </div>
                <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <ProfileMenu
              onSignOut={handleSignOut}
              onClose={() => setUserMenuOpen(false)}
            />
          </Popover>
        )}
      </SidebarFooter>
    </>
  );
}

// ── Flat sections (no nested items) — direct top-level link ────

function FlatExpandedLink({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  const Icon = section.icon;
  const href = section.href!;
  const isActive = section.exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        // Match ExpandedSection trigger geometry so flat + nested
        // sections sit on the same baseline.
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <Icon className="w-[18px] h-[18px] shrink-0" />
      <span className="flex-1 text-left">{section.label}</span>
    </Link>
  );
}

function FlatCollapsedLink({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  const Icon = section.icon;
  const href = section.href!;
  const isActive = section.exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-label={section.label}
      title={section.label}
      className={cn(
        "flex items-center justify-center size-10 rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
        isActive && "bg-sidebar-accent",
      )}
    >
      <Icon className="w-[18px] h-[18px]" />
    </Link>
  );
}

// ── Expanded mode: section trigger that toggles inline children ─

function ExpandedSection({
  section,
  pathname,
  isOpen,
  onToggle,
}: {
  section: NavSection;
  pathname: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const SectionIcon = section.icon;
  const ChevronIcon = isOpen ? ChevronDown : ChevronRight;
  const hasActiveChild = section.items.some((item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href),
  );
  // Сумма бейджей всех дочерних item'ов (числовых). Показываем рядом с
  // chevron'ом, когда секция СВЁРНУТА — иначе бейдж уже виден на самом
  // item'е. Это позволяет юзеру понять «там что-то ждёт меня», не
  // открывая секцию.
  const collapsedBadgeSum = section.items.reduce(
    (sum, i) => sum + (typeof i.badge === "number" ? i.badge : 0),
    0,
  );

  return (
    // Group · gap 4px between Trigger and Nested
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          // Trigger: padding [8,10], gap 10, font 14/500, rounded 8
          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
          hasActiveChild && !isOpen && "bg-sidebar-accent",
        )}
      >
        <SectionIcon className="w-[18px] h-[18px] shrink-0" />
        <span className="flex-1 text-left">{section.label}</span>
        {!isOpen && collapsedBadgeSum > 0 && (
          <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[11px] font-semibold px-1.5">
            {collapsedBadgeSum}
          </span>
        )}
        <ChevronIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      </button>
      {isOpen && (
        // Nested: padding [6,0,6,18] — 6px vertical, 18px from left
        // (the 18px puts the guide line under the trigger's icon)
        <div className="py-1.5 pl-[18px]">
          {/* Items: 1px guide line + 8px left pad + 2px gap between items */}
          <div className="border-l border-sidebar-border pl-2 flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    // Sub-item: padding [7,10], gap 8, rounded 6, text 13/500
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                    isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <span className="flex-1 truncate">{item.title}</span>
                  {item.badge !== undefined && (
                    <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[11px] font-semibold px-1.5">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsed mode: 40×40 icon button that opens a popover flyout ─

function CollapsedSectionFlyout({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const SectionIcon = section.icon;
  const hasActiveChild = section.items.some((item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href),
  );
  // В collapsed-режиме мы не показываем циферку (нет места), только
  // точку — чтобы юзер видел «в этой секции что-то ждёт» и кликнул.
  const hasAnyBadge = section.items.some(
    (i) => typeof i.badge === "number" && i.badge > 0,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={section.label}
          className={cn(
            "relative flex items-center justify-center size-10 rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
            (hasActiveChild || open) && "bg-sidebar-accent",
          )}
        >
          <SectionIcon className="w-[18px] h-[18px]" />
          {hasAnyBadge && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-[200px] p-1.5 rounded-[10px]"
      >
        <div className="px-2 py-1.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            {section.label}
          </span>
        </div>
        <div className="flex flex-col">
          {section.items.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-2.5 text-[13px] text-popover-foreground transition-colors hover:bg-accent",
                  isActive && "bg-accent font-medium",
                )}
              >
                <ItemIcon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{item.title}</span>
                {item.badge !== undefined && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[11px] font-semibold px-1.5">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── User avatar with fallback to initials ──────────────────────

function UserAvatar({
  name,
  avatarUrl,
  size = 32,
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
}) {
  const initial = name.charAt(0).toUpperCase() || "?";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className="w-full h-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="w-full h-full flex items-center justify-center bg-violet-400 text-white font-bold"
      style={{ fontSize: Math.max(11, Math.round(size * 0.4)) }}
      aria-label={name}
    >
      {initial}
    </span>
  );
}

// ── Profile menu popover (matches zs57t in sheerly.pen) ─────────

function ProfileMenu({
  onSignOut,
  onClose,
}: {
  onSignOut: () => void;
  onClose: () => void;
}) {
  // Note: верхний user-блок (name + role · account + avatar) намеренно
  // убран — он дублировал trigger-кнопку в футере сайдбара (на которую
  // и навешан этот popover). См. фидбек 2026-05-13.

  return (
    <PopoverContent
      align="start"
      side="top"
      sideOffset={8}
      className="w-[280px] p-0 rounded-xl overflow-hidden"
    >
      {/* Theme switcher — Light / Dark / System */}
      <div className="px-3 py-2.5">
        <ThemeSwitcher />
      </div>

      <div className="h-px bg-border" />

      {/* Menu items */}
      <div className="p-1.5 flex flex-col gap-px">
        <Link
          href="/profile"
          onClick={onClose}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium hover:bg-accent transition-colors"
        >
          <Settings className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="flex-1">Настройки профиля</span>
        </Link>
        <a
          href="https://sheerly.app/help"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium hover:bg-accent transition-colors"
        >
          <LifeBuoy className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="flex-1">Помощь и поддержка</span>
          <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
        </a>
        <button
          type="button"
          onClick={() => {
            onClose();
            // TODO: open hotkeys modal — placeholder for now
            window.dispatchEvent(new CustomEvent("hotkeys:open"));
          }}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium hover:bg-accent transition-colors w-full text-left"
        >
          <Keyboard className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="flex-1">Горячие клавиши</span>
          <kbd className="inline-flex items-center px-1 py-px rounded-[3px] bg-muted border border-border text-[9px] font-semibold text-muted-foreground font-mono">
            ⌘ ?
          </kbd>
        </button>
      </div>

      <div className="h-px bg-border" />

      {/* Logout */}
      <div className="px-1.5 pt-1.5 pb-2">
        <button
          type="button"
          onClick={() => {
            onClose();
            onSignOut();
          }}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-semibold text-destructive hover:bg-destructive/5 transition-colors w-full text-left"
        >
          <LogOut className="w-3.5 h-3.5" />
          Выйти из аккаунта
        </button>
      </div>
    </PopoverContent>
  );
}

// ── Theme switcher (3-button toggle group) ─────────────────────

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Avoid hydration mismatch — next-themes resolves theme client-side
  useEffect(() => {
    setMounted(true);
  }, []);
  const current = mounted ? theme ?? "system" : "system";

  const options = [
    { value: "light",  icon: Sun,    label: "Светлая" },
    { value: "dark",   icon: Moon,   label: "Тёмная" },
    { value: "system", icon: Laptop, label: "Системная" },
  ] as const;

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">Тема</span>
      <div className="flex items-center gap-px p-0.5 rounded-md bg-muted">
        {options.map(({ value, icon: Icon, label }) => {
          const active = current === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => applyTheme(value, setTheme)}
              aria-label={label}
              title={label}
              className={cn(
                "flex items-center justify-center px-2 py-1 rounded-[5px] transition-colors",
                active
                  ? "bg-background text-foreground border border-border shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-3 h-3" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

