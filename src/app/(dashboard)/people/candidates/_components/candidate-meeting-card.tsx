"use client";
import { useState } from "react";
import { ChevronDown, MoreHorizontal, Pencil, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Appointment, AppointmentOptions } from "@/lib/candidates/types";
import { interviewFeedbackEntries } from "@/lib/candidates/workflow";
import { safeLink } from "./fields";
const outcomes = { scheduled: "Назначено", passed: "Пройдено", no_show: "Не пришёл", rejected: "Не подошёл", canceled: "Отменено" };

export function CandidateMeetingCard({ appointment: a, options, editable, onSchedule, onResult }: {
  appointment: Appointment; options: AppointmentOptions; editable: boolean; onSchedule: () => void; onResult: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const feedback = interviewFeedbackEntries(a.interview_feedback);
  const url = a.location ? safeLink(a.location) : null;
  const venue = options.venues.find((value) => value.id === a.venue_id)?.name;
  const interviewer = options.members.find((value) => value.id === a.interviewer_id)?.name;
  return <article className="border-b py-4 last:border-b-0 last:pb-0">
    <div className="flex items-start gap-2">
      <button type="button" className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded} aria-controls={`meeting-${a.id}`} onClick={() => setExpanded((value) => !value)}>
        <ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        <span className="min-w-0 space-y-1">
          <span className="block text-sm font-medium">{a.kind === "interview" ? "Собеседование" : "Стажировка"}</span>
          <span className="block text-sm text-muted-foreground">{a.starts_at ? new Date(a.starts_at).toLocaleString("ru-RU", { timeZone: a.timezone, dateStyle: "short", timeStyle: "short" }) : a.appointment_date.split("-").reverse().join(".")}</span>
          <span className="block text-xs text-muted-foreground">{outcomes[a.outcome]}</span>
        </span>
      </button>
      {editable && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Действия со встречей ${a.appointment_date}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onSchedule}><Pencil className="size-4" />Изменить назначение</DropdownMenuItem>
          <DropdownMenuItem onSelect={onResult}><ClipboardCheck className="size-4" />{a.outcome === "scheduled" ? "Заполнить результат" : "Изменить результат"}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
    {expanded && <div id={`meeting-${a.id}`} className="ml-6 mt-4 space-y-3 text-sm">
      {(venue || a.location) && <p className="break-words">{url ? <a className="text-brand hover:underline" href={url} target="_blank" rel="noreferrer">Открыть ссылку на встречу</a> : venue || a.location}</p>}
      {interviewer && <p><span className="text-muted-foreground">Проводит: </span>{interviewer}</p>}
      {feedback.length > 0 && <dl className="space-y-1">{feedback.map(([label, value]) => <div key={label}><dt className="inline text-muted-foreground">{label}: </dt><dd className="inline whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>}
      {a.notes && <p className="whitespace-pre-wrap break-words">{a.notes}</p>}
      {a.outcome === "scheduled" && <p className="text-muted-foreground">Результат пока не заполнен.</p>}
    </div>}
  </article>;
}
