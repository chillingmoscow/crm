"use client";
import { ChevronRight } from "lucide-react";
import type { Appointment, AppointmentOptions } from "@/lib/candidates/types";
import { APPOINTMENT_OUTCOME_CLASSES, appointmentOutcomeLabel } from "@/lib/candidates/appointment-labels";
import { dateLabel, safeLink, StatusBadge, wallTime } from "./fields";

export function CandidateAppointmentRow({ appointment: a, options, onOpen }: {
  appointment: Appointment; options: AppointmentOptions; onOpen: () => void;
}) {
  const venue = options.venues.find((value) => value.id === a.venue_id)?.name;
  const location = venue || (a.location && safeLink(a.location) ? "По ссылке" : a.location);
  const subtitle = [a.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : null, location].filter(Boolean).join(" · ");
  const status = appointmentOutcomeLabel(a.kind, a.outcome);
  return <button type="button" onClick={onOpen}
    aria-label={`Открыть ${a.kind === "interview" ? "собеседование" : "стажировку"}: ${dateLabel(a.appointment_date)}, ${status}`}
    className="flex w-full min-w-0 items-center gap-3 border-b py-4 text-left outline-none transition-colors last:border-b-0 last:pb-0 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
    <span className="min-w-0 flex-1 space-y-1">
      <span className="block text-sm font-medium">{dateLabel(a.appointment_date)}</span>
      {subtitle && <span className="block truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</span>}
    </span>
    <span className="shrink-0"><StatusBadge label={status} className={APPOINTMENT_OUTCOME_CLASSES[a.outcome]} /></span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
  </button>;
}
