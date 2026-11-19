"use client";
import { useState, useTransition } from "react";
import { CalendarDays, MapPin, MoreHorizontal, Pencil, UserRound, Video } from "lucide-react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection, DrawerStatus, DrawerSummary, DrawerSummaryItem } from "@/components/ui/drawer-blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import type { Appointment, AppointmentOptions } from "@/lib/candidates/types";
import { APPOINTMENT_OUTCOME_TONES, APPOINTMENT_TITLES, appointmentOutcomeLabel } from "@/lib/candidates/appointment-labels";
import { appointmentError } from "@/lib/candidates/errors";
import { saveCandidateAppointmentResult } from "../actions";
import { dateLabel, safeLink, wallTime, Field, FieldSelect } from "./fields";

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
  const [busy, start] = useTransition();
  const change = (field: keyof Report, value: string) => setReport((current) => ({ ...current, [field]: value }));
  const payload = reportPayload(a, report);
  const dirty = JSON.stringify(payload) !== JSON.stringify(reportPayload(a, initialReport(a)));
  const commentRequired = a.kind === "interview" && ["passed", "rejected"].includes(report.outcome);
  const futureResult = commentRequired && !!a.starts_at && new Date(a.starts_at).getTime() > Date.now();
  const { guard, dialog } = useDiscardGuard(editable && dirty, "В результате есть несохранённые изменения.");
  const requestAction = (action: "close" | "schedule") => {
    if (busy) return;
    guard(action === "close" ? onClose : onSchedule);
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
      titleAccessory={<DrawerStatus label={appointmentOutcomeLabel(a.kind, a.outcome)} tone={APPOINTMENT_OUTCOME_TONES[a.outcome]} />}
      onOpenChange={(open) => { if (!open) requestAction("close"); }}
      footer={<><Button variant="outline" disabled={busy} onClick={() => requestAction("close")}>Закрыть</Button>{editable && <Button disabled={busy || !dirty || !report.outcome || (commentRequired && !report.notes.trim()) || futureResult} onClick={save}>Сохранить</Button>}</>}>
      <DrawerSummary label="Данные назначения">
        <DrawerSummaryItem icon={<CalendarDays />}
          action={editable && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button disabled={busy} size="icon" variant="ghost" className="size-8" aria-label={a.kind === "trial" ? "Действия со стажировкой" : "Действия с собеседованием"}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => requestAction("schedule")}><Pencil className="size-4" />Изменить назначение</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>}>
          <span className="block font-medium">{dateLabel(a.appointment_date)}</span>
          <span className="block text-[13px] text-muted-foreground">{a.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : "Время не указано"}</span>
        </DrawerSummaryItem>
        {(venue || a.location) && <DrawerSummaryItem icon={url ? <Video /> : <MapPin />} label={a.kind === "trial" ? "Заведение" : "Место"}>
          {url ? <a className="text-brand hover:underline" href={url} target="_blank" rel="noreferrer">Открыть ссылку</a> : venue || a.location}
        </DrawerSummaryItem>}
        {a.kind === "interview" && interviewer && <DrawerSummaryItem icon={<UserRound />} label="Интервьюер">{interviewer}</DrawerSummaryItem>}
      </DrawerSummary>
      <DrawerSection title={a.kind === "trial" ? "Итоги стажировки" : "Итоги собеседования"}>
        <FieldSelect label="Результат" value={report.outcome} onChange={(value) => change("outcome", value)} disabled={busy || !editable}
          options={[{ value: "", label: "Выберите результат" }, ...resultOptions.map((value) => ({ value, label: appointmentOutcomeLabel(a.kind, value) }))]} />
        <div className="space-y-1.5">
          <Field label={commentRequired ? "Заметки *" : "Заметки"}><Textarea aria-label="Заметки" aria-required={commentRequired} className="min-h-[120px] text-base font-normal leading-relaxed sm:text-sm" value={report.notes} rows={4} maxLength={12000} disabled={busy || !editable} placeholder={a.kind === "trial" ? "Как прошла стажировка, что получилось и над чем поработать" : "Впечатление о кандидате и причины решения"} onChange={(event) => change("notes", event.target.value)} /></Field>
        </div>
        {futureResult && <p className="text-xs leading-relaxed text-muted-foreground">Итог собеседования можно сохранить после указанного времени.</p>}
      </DrawerSection>
      {a.kind === "interview" && <DrawerSection title="Наблюдения" actions={<span className="text-xs text-muted-foreground">Необязательно</span>}>
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
      </DrawerSection>}
    </EditDrawer>
    {dialog}
  </>;
}
