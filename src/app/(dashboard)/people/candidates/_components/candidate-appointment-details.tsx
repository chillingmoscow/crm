"use client";
import { MoreHorizontal, Pencil, ClipboardCheck } from "lucide-react";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Appointment, AppointmentOptions } from "@/lib/candidates/types";
import { APPOINTMENT_TITLES, APPOINTMENT_OUTCOME_CLASSES, appointmentOutcomeLabel } from "@/lib/candidates/appointment-labels";
import { interviewFeedbackEntries } from "@/lib/candidates/workflow";
import { dateLabel, safeLink, StatusBadge, wallTime } from "./fields";

export function CandidateAppointmentDetails({ appointment: a, candidateName, options, editable, onClose, onSchedule, onResult }: {
  appointment: Appointment; candidateName: string; options: AppointmentOptions; editable: boolean;
  onClose: () => void; onSchedule: () => void; onResult: () => void;
}) {
  const venue = options.venues.find((value) => value.id === a.venue_id)?.name;
  const interviewer = options.members.find((value) => value.id === a.interviewer_id)?.name;
  const url = a.location ? safeLink(a.location) : null;
  const feedback = interviewFeedbackEntries(a.interview_feedback);
  return <EditDrawer open title={APPOINTMENT_TITLES[a.kind]} description={candidateName} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<><Button variant="outline" onClick={onClose}>Закрыть</Button>{editable && a.outcome === "scheduled" && <Button onClick={onResult}>Заполнить результат</Button>}</>}>
    <div className="flex items-center justify-between gap-3">
      <StatusBadge label={appointmentOutcomeLabel(a.kind, a.outcome)} className={APPOINTMENT_OUTCOME_CLASSES[a.outcome]} />
      {editable && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={a.kind === "trial" ? "Действия со стажировкой" : "Действия с собеседованием"}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onSchedule}><Pencil className="size-4" />Изменить назначение</DropdownMenuItem>
          <DropdownMenuItem onSelect={onResult}><ClipboardCheck className="size-4" />{a.outcome === "scheduled" ? "Заполнить результат" : "Изменить результат"}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
    <dl className="space-y-4 text-sm">
      <div><dt className="text-muted-foreground">Дата</dt><dd className="mt-1">{dateLabel(a.appointment_date)}</dd></div>
      <div><dt className="text-muted-foreground">Время</dt><dd className="mt-1">{a.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : "Не указано"}</dd></div>
      {(venue || a.location) && <div><dt className="text-muted-foreground">{a.kind === "trial" ? "Заведение" : "Место собеседования"}</dt><dd className="mt-1 break-words">{url ? <a className="text-brand hover:underline" href={url} target="_blank" rel="noreferrer">Открыть ссылку</a> : venue || a.location}</dd></div>}
      {a.kind === "interview" && interviewer && <div><dt className="text-muted-foreground">Интервьюер</dt><dd className="mt-1">{interviewer}</dd></div>}
    </dl>
    <section className="space-y-3 border-t pt-5">
      <h3 className="text-sm font-semibold">{a.kind === "trial" ? "Итоги стажировки" : "Итоги собеседования"}</h3>
      {feedback.length > 0 && <dl className="space-y-2 text-sm">{feedback.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>}
      {a.notes && <p className="whitespace-pre-wrap break-words text-sm">{a.notes}</p>}
      {a.outcome === "scheduled" && <p className="text-sm text-muted-foreground">Результат пока не заполнен.</p>}
      {!a.notes && !feedback.length && a.outcome !== "scheduled" && <p className="text-sm text-muted-foreground">Комментарий не добавлен.</p>}
    </section>
  </EditDrawer>;
}
