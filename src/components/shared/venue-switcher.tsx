"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { switchVenue } from "@/app/(dashboard)/actions";
import { VENUE_TYPES } from "@/lib/constants";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspaceAppearance } from "./workspace-appearance";
import appearance from "./workspace-appearance.module.css";

type Venue = {
  venue_id: string;
  venue_name: string;
  venue_type: string | null;
  role_code: string;
  role_name: string;
};

const VENUE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  VENUE_TYPES.map((t) => [t.value, t.label]),
);

function venueSubtitle(venue: Venue): string {
  const typeLabel =
    (venue.venue_type && VENUE_TYPE_LABELS[venue.venue_type]) || "Заведение";
  return `${typeLabel} · ${venue.role_name}`;
}

type Props = {
  venues: Venue[];
  activeVenueId: string | null;
};

// Deterministic palette for venue tiles. The active venue uses primary
// blue with a building icon; the rest get a hashed color + initial so
// the eye can scan the list without a real avatar field in the DB.
const VENUE_PALETTE = [
  "#f43f5e", // rose
  "#10b981", // emerald
  "#a78bfa", // violet
  "#f59e0b", // amber
  "#0ea5e9", // sky
  "#ec4899", // pink
];

function colorForVenue(venueId: string): string {
  let hash = 0;
  for (let i = 0; i < venueId.length; i++) {
    hash = (hash << 5) - hash + venueId.charCodeAt(i);
    hash |= 0;
  }
  return VENUE_PALETTE[Math.abs(hash) % VENUE_PALETTE.length];
}

function VenueTile({ venue, isActive }: { venue: Venue; isActive: boolean }) {
  if (isActive) {
    return (
      <div className="flex items-center justify-center size-8 rounded-lg bg-primary text-primary-foreground shrink-0">
        <Building2 className="w-4 h-4" />
      </div>
    );
  }
  const initial = venue.venue_name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="flex items-center justify-center size-8 rounded-lg text-white text-sm font-bold shrink-0"
      style={{ backgroundColor: colorForVenue(venue.venue_id) }}
    >
      {initial}
    </div>
  );
}

export function VenueSwitcher({ venues, activeVenueId }: Props) {
  const modern = useWorkspaceAppearance();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { state, isMobile } = useSidebar();
  // collapsed (→ поповер открывается сбоку, side="right") — только на
  // десктопе. На мобильном сайдбар — выезжающий Sheet; side="right" уводил
  // поповер за правый край экрана. !isMobile → на телефоне side="bottom".
  const collapsed = state === "collapsed" && !isMobile;

  const activeVenue = venues.find((v) => v.venue_id === activeVenueId) ?? null;

  const handleSwitch = (venueId: string) => {
    if (isPending) return;
    if (venueId === activeVenueId) { setIsOpen(false); return; }
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
      <SidebarMenuItem>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={activeVenue?.venue_name ?? "Заведение"}
              disabled={isPending}
              aria-label={`Выбрать заведение: ${activeVenue?.venue_name ?? "Заведение"}`}
              className={cn("data-[state=open]:bg-sidebar-accent", modern && appearance.venueTrigger, modern && collapsed && appearance.venueIconTrigger)}
            >
              <div className={cn("flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0", modern && appearance.venueMonogram)}>
                {modern ? (activeVenue?.venue_name.trim().charAt(0).toUpperCase() || <Building2 size={18} />) : <Building2 className="w-4 h-4" />}
              </div>
              <div className="flex flex-col min-w-0 flex-1 gap-0 text-left">
                <span className="truncate text-[13px] font-bold leading-tight">
                  {activeVenue?.venue_name ?? "Выберите заведение"}
                </span>
                {activeVenue?.role_name && (
                  <span className="truncate text-[11px] text-muted-foreground leading-tight">
                    {modern ? activeVenue.role_name : venueSubtitle(activeVenue)}
                  </span>
                )}
              </div>
              <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side={collapsed ? "right" : "bottom"}
            sideOffset={8}
            className={cn("w-[min(18rem,calc(100vw-1.5rem))] rounded-[10px] p-1.5", modern && appearance.venueMenu)}
          >
            <div className={modern ? appearance.venueMenuHeading : "px-2 py-1.5"}>
              <span className={modern ? undefined : "text-[11px] font-semibold tracking-wider uppercase text-muted-foreground"}>
                {modern ? "Заведения" : "Ваши заведения"}
              </span>
              {modern && <span>{venues.length}</span>}
            </div>
            <div className="flex flex-col">
              {venues.map((venue) => {
                const isActive = venue.venue_id === activeVenueId;
                return (
                  <button
                    key={venue.venue_id}
                    type="button"
                    onClick={() => handleSwitch(venue.venue_id)}
                    disabled={isPending}
                    aria-pressed={isActive}
                    className={cn(modern && appearance.venueOption, `flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors ${
                      isActive
                        ? "bg-accent"
                        : "hover:bg-accent/60"
                    } disabled:opacity-50`)}
                  >
                    {modern ? <span className={appearance.venueOptionIcon}>{venue.venue_name.trim().charAt(0).toUpperCase()}</span> : <VenueTile venue={venue} isActive={isActive} />}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate text-[13px] font-bold leading-tight">
                        {venue.venue_name}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground leading-tight">
                        {venueSubtitle(venue)}
                      </span>
                    </div>
                    {isActive && (
                      <span className={modern ? appearance.venueSelected : "text-primary"}><Check className="w-3.5 h-3.5 shrink-0" /></span>
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
