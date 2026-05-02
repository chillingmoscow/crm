"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
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
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  roles: string[];
  /** Optional count badge (e.g. unread, pending invitations). */
  badge?: number | string;
};

type NavSection = {
  label: string;
  icon: LucideIcon;
  roles: string[];
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Люди",
    icon: Users,
    roles: ["owner", "manager", "admin"],
    items: [
      { title: "Сотрудники", href: "/people/staff", icon: User,   roles: ["owner", "manager", "admin"] },
      { title: "Должности",  href: "/people/roles", icon: Shield, roles: ["owner", "admin"] },
    ],
  },
  {
    label: "Организация",
    icon: Building2,
    roles: ["owner", "admin", "accountant"],
    items: [
      { title: "Аккаунт",   href: "/org/account",         icon: Settings,    roles: ["owner"] },
      { title: "Юрлица",    href: "/org/legal-entities",  icon: FileBadge2,  roles: ["owner", "admin", "accountant"] },
      { title: "Заведения", href: "/org/venues",          icon: Building2,   roles: ["owner"] },
    ],
  },
  {
    // Финансы (стадии 4.x). Подпункты добавляются по мере готовности —
    // /finance/transactions появится в 4.5. Все четыре роли по матрице
    // 034 имеют view_dashboard / view_categories / view_counterparties /
    // view_bank_accounts; manage-уровень гейтится на самих страницах.
    label: "Финансы",
    icon: Wallet,
    roles: ["owner", "admin", "accountant", "manager"],
    items: [
      // exact: чтобы Дашборд не выделялся, когда мы на /finance/categories
      // или другой дочерней странице.
      { title: "Дашборд",     href: "/finance",                icon: LayoutDashboard, exact: true, roles: ["owner", "admin", "accountant", "manager"] },
      { title: "Транзакции",  href: "/finance/transactions",   icon: ArrowLeftRight,                roles: ["owner", "admin", "accountant", "manager"] },
      { title: "Счета",       href: "/finance/accounts",       icon: Wallet,                        roles: ["owner", "admin", "accountant", "manager"] },
      { title: "Статьи",      href: "/finance/categories",     icon: Tags,                          roles: ["owner", "admin", "accountant", "manager"] },
      { title: "Контрагенты", href: "/finance/counterparties", icon: Users,                         roles: ["owner", "admin", "accountant", "manager"] },
    ],
  },
  {
    // База знаний (стадия 8). Видимость по матрице kb_*: все шесть ролей
    // имеют kb.view_pages; manage-уровень гейтится на самих экранах.
    label: "База знаний",
    icon: BookOpen,
    roles: ["owner", "admin", "accountant", "manager", "hostess", "waiter"],
    items: [
      { title: "База знаний", href: "/knowledge", icon: BookOpen,
        roles: ["owner", "admin", "accountant", "manager", "hostess", "waiter"] },
    ],
  },
  {
    label: "Настройки",
    icon: Settings,
    roles: ["owner"],
    items: [
      { title: "Интеграции", href: "/settings/integrations", icon: Settings, roles: ["owner"] },
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
  venues: Venue[];
  activeVenueId: string | null;
  activeRoleCode: string | null;
  /** Used in the profile popover subtitle: "<Роль> · <Аккаунт>" */
  activeRoleName: string | null;
  accountName: string | null;
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
  venues,
  activeVenueId,
  activeRoleCode,
  activeRoleName,
  accountName,
}: AppSidebarProps) {
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
      NAV_SECTIONS.filter((s) => !activeRoleCode || s.roles.includes(activeRoleCode))
        .map((s) => ({
          ...s,
          items: s.items.filter(
            (item) => !activeRoleCode || item.roles.includes(activeRoleCode),
          ),
        }))
        .filter((s) => s.items.length > 0),
    [activeRoleCode],
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
        {visibleSections.map((section) =>
          collapsed ? (
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
          ),
        )}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t border-sidebar-border group-data-[collapsible=icon]:p-3">
        {collapsed ? (
          <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={userName}
                className="flex items-center justify-center size-8 rounded-full bg-violet-400 text-white text-[13px] font-bold shrink-0 mx-auto"
              >
                {userName.charAt(0).toUpperCase()}
              </button>
            </PopoverTrigger>
            <ProfileMenu
              userName={userName}
              userEmail={userEmail}
              roleName={activeRoleName}
              accountName={accountName}
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
                <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-violet-400 text-white text-[13px] font-bold shrink-0">
                  {userName.charAt(0).toUpperCase()}
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
              userName={userName}
              userEmail={userEmail}
              roleName={activeRoleName}
              accountName={accountName}
              onSignOut={handleSignOut}
              onClose={() => setUserMenuOpen(false)}
            />
          </Popover>
        )}
      </SidebarFooter>
    </>
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={section.label}
          className={cn(
            "flex items-center justify-center size-10 rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
            (hasActiveChild || open) && "bg-sidebar-accent",
          )}
        >
          <SectionIcon className="w-[18px] h-[18px]" />
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
                <span className="truncate">{item.title}</span>
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Profile menu popover (matches zs57t in sheerly.pen) ─────────

function ProfileMenu({
  userName,
  userEmail,
  roleName,
  accountName,
  onSignOut,
  onClose,
}: {
  userName: string;
  userEmail: string;
  roleName: string | null;
  accountName: string | null;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const subtitle = [roleName, accountName].filter(Boolean).join(" · ") || userEmail;

  return (
    <PopoverContent
      align="start"
      side="top"
      sideOffset={8}
      className="w-[280px] p-0 rounded-xl overflow-hidden"
    >
      {/* User row — brand-tinted avatar + name + role · account */}
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
        <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-brand text-white text-[12px] font-bold shrink-0">
          {userName.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col gap-px min-w-0 flex-1">
          <span className="truncate text-[13px] font-semibold leading-tight">
            {userName}
          </span>
          {subtitle && (
            <span className="truncate text-[11px] text-muted-foreground leading-tight">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      <div className="h-px bg-border" />

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
              onClick={() => setTheme(value)}
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

