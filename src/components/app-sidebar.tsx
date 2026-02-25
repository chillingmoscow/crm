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
import { VenueSwitcher } from "@/components/venue-switcher";

// Roles that can access each nav item
const NAV_SECTIONS = [
  {
    label: "Персонал",
    roles: ["owner", "manager", "admin"],
    items: [
      { title: "Сотрудники", href: "/staff",          icon: User,   roles: ["owner", "manager", "admin"] },
      { title: "Должности",  href: "/settings/roles", icon: Shield, roles: ["owner", "admin"] },
    ],
  },
  {
    label: "Сеть",
    roles: ["owner"],
    items: [
      { title: "Заведения",  href: "/settings/venues",   icon: Building2, roles: ["owner"] },
      { title: "Настройки",  href: "/settings/account",  icon: Settings,  roles: ["owner"] },
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
              {section.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.href)}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
                  <Link href="/settings/profile">
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
