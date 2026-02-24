"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { switchVenue } from "@/app/(dashboard)/actions";
import { toast } from "sonner";

type Venue = {
  venue_id: string;
  venue_name: string;
  role_code: string;
  role_name: string;
};

type Props = {
  venues: Venue[];
  activeVenueId: string | null;
};

export function VenueSwitcher({ venues, activeVenueId }: Props) {
  const [isOpen, setIsOpen]        = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const activeVenue = venues.find((v) => v.venue_id === activeVenueId) ?? null;

  const handleSwitch = (venueId: string) => {
    if (venueId === activeVenueId || isPending) return;
    startTransition(async () => {
      const result = await switchVenue(venueId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setIsOpen(false);
      router.refresh();
    });
  };

  return (
    <SidebarMenu>
      {/* Venue list — shown above trigger when open */}
      {isOpen && (
        <>
          {venues.map((venue) => (
            <SidebarMenuItem key={venue.venue_id}>
              <SidebarMenuButton
                onClick={() => handleSwitch(venue.venue_id)}
                isActive={venue.venue_id === activeVenueId}
                tooltip={venue.venue_name}
                disabled={isPending}
                className="text-sm"
              >
                <Building2 />
                <span className="truncate">{venue.venue_name}</span>
                {venue.venue_id === activeVenueId && (
                  <Check className="ml-auto w-4 h-4 shrink-0" />
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarSeparator />
        </>
      )}

      {/* Trigger: current venue */}
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          onClick={() => setIsOpen((v) => !v)}
          tooltip={activeVenue?.venue_name ?? "Заведение"}
          disabled={isPending}
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0 flex-1 gap-0">
            <span className="truncate text-sm font-medium leading-tight">
              {activeVenue?.venue_name ?? "Выберите заведение"}
            </span>
            {activeVenue?.role_name && (
              <span className="truncate text-xs text-muted-foreground leading-tight">
                {activeVenue.role_name}
              </span>
            )}
          </div>
          <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
