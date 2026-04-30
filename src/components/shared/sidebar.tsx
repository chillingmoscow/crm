"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  User,
  Building2,
  Shield,
  LogOut,
  Settings,
  ChevronUp,
  FileBadge2,
  LayoutDashboard,
  Tags,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { VenueSwitcher } from "@/components/shared/venue-switcher";

// Sidebar nav grouped by block (docs/MERGE_PLAN.md §2.1).
// CRM block will join in stage 5. Finance subitems are added here as
// each page lands — keeping the sidebar a faithful index of what's
// actually shippable, not a list of 404s.
const NAV_SECTIONS = [
  {
    label: "Люди",
    roles: ["owner", "manager", "admin"],
    items: [
      { title: "Сотрудники", href: "/people/staff", icon: User,   roles: ["owner", "manager", "admin"] },
      { title: "Должности",  href: "/people/roles", icon: Shield, roles: ["owner", "admin"] },
    ],
  },
  {
    label: "Организация",
    roles: ["owner", "admin", "accountant"],
    items: [
      { title: "Аккаунт",   href: "/org/account",         icon: Settings,    roles: ["owner"] },
      { title: "Юрлица",    href: "/org/legal-entities",  icon: FileBadge2,  roles: ["owner", "admin", "accountant"] },
      { title: "Заведения", href: "/org/venues",          icon: Building2,   roles: ["owner"] },
    ],
  },
  {
    // Финансы (стадии 4.x). Подпункты добавляются по мере готовности —
    // /finance/transactions и /finance/accounts появятся в 4.4 и 4.5.
    // Все четыре роли по матрице 034 имеют view_dashboard / view_categories
    // / view_counterparties; manage-уровень гейтится на самих страницах.
    label: "Финансы",
    roles: ["owner", "admin", "accountant", "manager"],
    items: [
      // exact: чтобы Дашборд не выделялся, когда мы на /finance/categories
      // или другой дочерней странице.
      { title: "Дашборд",     href: "/finance",                icon: LayoutDashboard, exact: true, roles: ["owner", "admin", "accountant", "manager"] },
      { title: "Статьи",      href: "/finance/categories",     icon: Tags,                          roles: ["owner", "admin", "accountant", "manager"] },
      { title: "Контрагенты", href: "/finance/counterparties", icon: Users,                         roles: ["owner", "admin", "accountant", "manager"] },
    ],
  },
  {
    label: "Настройки",
    roles: ["owner"],
    items: [
      { title: "Интеграции", href: "/settings/integrations", icon: Settings, roles: ["owner"] },
    ],
  },
];

type Venue = {
  venue_id: string;
  venue_name: string;
  role_code: string;
  role_name: string;
};

interface AppSidebarProps {
  userName: string;
  venues: Venue[];
  activeVenueId: string | null;
  activeRoleCode: string | null;
}

export function AppSidebar({ userName, venues, activeVenueId, activeRoleCode }: AppSidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Не удалось выйти");
      return;
    }
    router.push("/login");
  };

  // Filter sections/items by the user's role in the active venue
  const visibleSections = NAV_SECTIONS
    .filter((s) => !activeRoleCode || s.roles.includes(activeRoleCode))
    .map((s) => ({
      ...s,
      items: s.items.filter((item) => !activeRoleCode || item.roles.includes(activeRoleCode)),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      {/* Content: venue switcher + nav */}
      <SidebarContent>
        {/* Venue switcher at the top */}
        <SidebarGroup className="border-b">
          <VenueSwitcher venues={venues} activeVenueId={activeVenueId} />
        </SidebarGroup>

        {visibleSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 px-2">
              {section.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {section.items.map((item) => {
                // exact items match only when the path is identical —
                // for things like the Финансы dashboard at /finance,
                // which would otherwise highlight on every /finance/*.
                const isActive =
                  "exact" in item && item.exact
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Footer: user info + expandable menu */}
      <SidebarFooter className="border-t">
        <SidebarMenu>
          {/* Actions appear above the user button when open */}
          {userMenuOpen && (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Настройки профиля">
                  <Link href="/profile">
                    <Settings />
                    <span>Настройки профиля</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleSignOut}
                  tooltip="Выйти"
                  className="text-muted-foreground"
                >
                  <LogOut />
                  <span>Выйти</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarSeparator />
            </>
          )}

          {/* User button */}
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => setUserMenuOpen((v) => !v)}
              tooltip={userName}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-muted text-sm font-medium shrink-0">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0 flex-1 gap-0">
                <span className="truncate text-sm font-medium leading-tight">
                  {userName}
                </span>
              </div>
              <ChevronUp
                className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                  userMenuOpen ? "" : "rotate-180"
                }`}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
