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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { VenueSwitcher } from "@/components/venue-switcher";

const navSections = [
  {
    label: "Персонал",
    items: [{ title: "Сотрудники", href: "/staff", icon: User }],
  },
  {
    label: "Настройки",
    items: [
      { title: "Заведения", href: "/settings/venues", icon: Building2 },
      { title: "Должности", href: "/settings/roles", icon: Shield },
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
}

export function AppSidebar({ userName, venues, activeVenueId }: AppSidebarProps) {
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

  return (
    <Sidebar collapsible="icon">
      {/* Header */}
      <SidebarHeader className="border-b px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="CRM Platform">
              <Link href="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                  C
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold text-sm">CRM Platform</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Content: venue switcher + nav */}
      <SidebarContent>
        {/* Venue switcher */}
        <SidebarGroup>
          <VenueSwitcher venues={venues} activeVenueId={activeVenueId} />
        </SidebarGroup>

        <SidebarSeparator />

        {navSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
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
