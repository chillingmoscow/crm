"use client";
import { useState, useTransition } from "react";
import { CalendarDays, MapPin, MoreHorizontal, Pencil, UserRound, Video } from "lucide-react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import type { Appointment, AppointmentOptions } from "@/lib/candidates/types";
import { APPOINTMENT_TITLES, APPOINTMENT_OUTCOME_CLASSES, appointmentOutcomeLabel } from "@/lib/candidates/appointment-labels";
import { appointmentError } from "@/lib/candidates/errors";
import { saveCandidateAppointmentResult } from "../actions";
import { dateLabel, safeLink, StatusBadge, wallTime, Field, FieldSelect } from "./fields";

import { PUNCTUALITY_LABELS, SMILE_LABELS, APPEARANCE_OPTIONS, COMMUNICATION_OPTIONS, feedbackOptions } from "@/lib/candidates/interview-feedback";

const resultOptions = ["passed", "no_show", "rejected", "canceled"] as const;
function initialReport(a: Appointment) {
  return {
    outcome: a.outcome === "scheduled" ? "" : a.outcome,
    notes: a.notes ?? "", punctuality: a.interview_feedback.punctuality ?? "",
    appearance: a.interview_feedback.appearance ?? "", communication: a.interview_feedback.communication ?? "",
    smiled: a.interview_feedback.smiled === undefined ? "" : String(a.interview_feedback.smiled),
  };
}
type Report = ReturnType<typeof initialReport>;
function reportPayload(a: Appointment, report: Report) {
  return { outcome: report.outcome, notes: report.notes.trim(), interview_feedback: a.kind === "interview" ? {
    ...(report.punctuality ? { punctuality: report.punctuality } : {}),
    ...(report.appearance.trim() ? { appearance: report.appearance.trim() } : {}),
    ...(report.communication.trim() ? { communication: report.communication.trim() } : {}),
    ...(report.smiled ? { smiled: report.smiled === "occasionally" ? "occasionally" : report.smiled === "true" } : {}),
  } : {} };
}
export function CandidateAppointmentDetails({ candidateId, appointment: a, candidateName, options, editable, onClose, onSchedule, onSaved }: {
  candidateId: string; appointment: Appointment; candidateName: string; options: AppointmentOptions; editable: boolean;
  onClose: () => void; onSchedule: () => void; onSaved: () => Promise<void>;
}) {
  const [report, setReport] = useState(() => initialReport(a));
  const [pendingAction, setPendingAction] = useState<"close" | "schedule" | null>(null);
  const [busy, start] = useTransition();
  const change = (field: keyof Report, value: string) => setReport((current) => ({ ...current, [field]: value }));
  const payload = reportPayload(a, report);
  const dirty = JSON.stringify(payload) !== JSON.stringify(reportPayload(a, initialReport(a)));
  const commentRequired = a.kind === "interview" && ["passed", "rejected"].includes(report.outcome);
  const futureResult = commentRequired && !!a.starts_at && new Date(a.starts_at).getTime() > Date.now();
  const requestAction = (action: "close" | "schedule") => {
    if (busy) return;
    if (editable && dirty) setPendingAction(action);
    else if (action === "close") onClose(); else onSchedule();
  };
  const venue = options.venues.find((value) => value.id === a.venue_id)?.name;
  const interviewer = options.members.find((value) => value.id === a.interviewer_id)?.name;
  const url = a.location ? safeLink(a.location) : null;
  const save = () => start(async () => {
    try {
      await saveCandidateAppointmentResult(candidateId, { id: a.id, revision: a.revision, ...payload });
      await onSaved();
      toast.success(a.kind === "trial" ? "Результат стажировки сохранён" : "Результат собеседования сохранён");
    } catch (error) { toast.error(appointmentError(error, a.kind)); }
  });
  return <>
    <EditDrawer open title={APPOINTMENT_TITLES[a.kind]} description={candidateName}
      titleAccessory={<StatusBadge label={appointmentOutcomeLabel(a.kind, a.outcome)} className={APPOINTMENT_OUTCOME_CLASSES[a.outcome]} />}
      onOpenChange={(open) => { if (!open) requestAction("close"); }}
      footer={<><Button variant="outline" disabled={busy} onClick={() => requestAction("close")}>Закрыть</Button>{editable && <Button disabled={busy || !dirty || !report.outcome || (commentRequired && !report.notes.trim()) || futureResult} onClick={save}>Сохранить</Button>}</>}>
      <section aria-label="Данные назначения" className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><CalendarDays className="size-4" /></span>
            <dl className="min-w-0 space-y-1">
              <dt className="sr-only">Дата</dt><dd className="text-sm font-medium">{dateLabel(a.appointment_date)}</dd>
              <dt className="sr-only">Время</dt><dd className="text-[13px] text-muted-foreground">{a.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : "Время не указано"}</dd>
            </dl>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editable && <DropdownMenu>
              <DropdownMenuTrigger asChild><Button disabled={busy} size="icon" variant="ghost" className="size-8" aria-label={a.kind === "trial" ? "Действия со стажировкой" : "Действия с собеседованием"}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => requestAction("schedule")}><Pencil className="size-4" />Изменить назначение</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>}
          </div>
        </div>
        {(venue || a.location || (a.kind === "interview" && interviewer)) && <dl className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
          {(venue || a.location) && <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">{url ? <Video className="size-4" /> : <MapPin className="size-4" />}</span>
            <div className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">{a.kind === "trial" ? "Заведение" : "Место"}</dt><dd className="break-words">{url ? <a className="text-brand hover:underline" href={url} target="_blank" rel="noreferrer">Открыть ссылку</a> : venue || a.location}</dd></div>
          </div>}
          {a.kind === "interview" && interviewer && <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><UserRound className="size-4" /></span>
            <div className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">Интервьюер</dt><dd className="break-words">{interviewer}</dd></div>
          </div>}
        </dl>}
      </section>
      <section aria-label={a.kind === "trial" ? "Итоги стажировки" : "Итоги собеседования"} className="space-y-4">
        <h3 className="text-sm font-semibold">{a.kind === "trial" ? "Итоги стажировки" : "Итоги собеседования"}</h3>
        <FieldSelect label="Результат" value={report.outcome} onChange={(value) => change("outcome", value)} disabled={busy || !editable}
          options={[{ value: "", label: "Выберите результат" }, ...resultOptions.map((value) => ({ value, label: appointmentOutcomeLabel(a.kind, value) }))]} />
        <div className="space-y-1.5">
          <Field label={commentRequired ? "Заметки *" : "Заметки"}><Textarea aria-label="Заметки" aria-required={commentRequired} className="min-h-[120px] text-base font-normal leading-relaxed sm:text-sm" value={report.notes} rows={4} maxLength={12000} disabled={busy || !editable} placeholder={a.kind === "trial" ? "Как прошла стажировка, что получилось и над чем поработать" : "Впечатление о кандидате и причины решения"} onChange={(event) => change("notes", event.target.value)} /></Field>
        </div>
        {futureResult && <p className="text-xs leading-relaxed text-muted-foreground">Итог собеседования можно сохранить после указанного времени.</p>}
      </section>
      {a.kind === "interview" && <section aria-label="Наблюдения" className="space-y-4 border-t pt-5">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Наблюдения</h3><span className="text-xs text-muted-foreground">Необязательно</span></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldSelect label="Пунктуальность" value={report.punctuality} onChange={(value) => change("punctuality", value)} disabled={busy || !editable}
            options={[{ value: "", label: "Не отмечено" }, ...Object.entries(PUNCTUALITY_LABELS).map(([value, label]) => ({ value, label }))]} />
          <FieldSelect label="Улыбался" value={report.smiled} onChange={(value) => change("smiled", value)} disabled={busy || !editable}
            options={[{ value: "", label: "Не отмечено" }, ...Object.entries(SMILE_LABELS).map(([value, label]) => ({ value, label }))]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldSelect label="Внешний вид" value={report.appearance} onChange={(value) => change("appearance", value)} disabled={busy || !editable} options={feedbackOptions(APPEARANCE_OPTIONS, report.appearance)} />
          <FieldSelect label="Общение" value={report.communication} onChange={(value) => change("communication", value)} disabled={busy || !editable} options={feedbackOptions(COMMUNICATION_OPTIONS, report.communication)} />
        </div>
      </section>}
    </EditDrawer>
    <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Не сохранять изменения?</AlertDialogTitle><AlertDialogDescription>В результате есть несохранённые изменения.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Продолжить редактирование</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction; setPendingAction(null); if (action === "schedule") onSchedule(); else onClose(); }}>Не сохранять</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
