"use client";
import { CalendarDays, ChevronRight } from "lucide-react";
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
    className="group flex min-h-[76px] w-full min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors duration-150 ease-out hover:bg-muted/40 active:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60 motion-reduce:transition-none">
    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><CalendarDays className="size-4" /></span>
    <span className="min-w-0 flex-1 space-y-1">
      <span className="block text-sm font-medium">{dateLabel(a.appointment_date)}</span>
      {subtitle && <span className="block truncate text-[13px] text-muted-foreground">{subtitle}</span>}
    </span>
    <span className="shrink-0"><StatusBadge label={status} className={APPOINTMENT_OUTCOME_CLASSES[a.outcome]} /></span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground motion-reduce:transition-none" />
  </button>;
}
