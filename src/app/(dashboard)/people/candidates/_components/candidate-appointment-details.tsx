"use client";
import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
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
    ...(report.smiled ? { smiled: report.smiled === "true" } : {}),
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
      onOpenChange={(open) => { if (!open) requestAction("close"); }}
      footer={<><Button variant="outline" disabled={busy} onClick={() => requestAction("close")}>Закрыть</Button>{editable && <Button disabled={busy || !dirty || !report.outcome || (commentRequired && !report.notes.trim()) || futureResult} onClick={save}>Сохранить</Button>}</>}>
      <div className="flex items-center justify-between gap-3">
        <StatusBadge label={appointmentOutcomeLabel(a.kind, a.outcome)} className={APPOINTMENT_OUTCOME_CLASSES[a.outcome]} />
        {editable && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button disabled={busy} size="icon" variant="ghost" aria-label={a.kind === "trial" ? "Действия со стажировкой" : "Действия с собеседованием"}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => requestAction("schedule")}><Pencil className="size-4" />Изменить назначение</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <div><dt className="text-xs text-muted-foreground">Дата</dt><dd className="mt-1">{dateLabel(a.appointment_date)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Время</dt><dd className="mt-1">{a.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : "Не указано"}</dd></div>
        {(venue || a.location) && <div><dt className="text-xs text-muted-foreground">{a.kind === "trial" ? "Заведение" : "Место"}</dt><dd className="mt-1 break-words">{url ? <a className="text-brand hover:underline" href={url} target="_blank" rel="noreferrer">Открыть ссылку</a> : venue || a.location}</dd></div>}
        {a.kind === "interview" && interviewer && <div><dt className="text-xs text-muted-foreground">Интервьюер</dt><dd className="mt-1">{interviewer}</dd></div>}
      </dl>
      <div className="space-y-4 border-t pt-5">
        <FieldSelect label="Результат" value={report.outcome} onChange={(value) => change("outcome", value)} disabled={busy || !editable}
          options={[{ value: "", label: "Выберите результат" }, ...resultOptions.map((value) => ({ value, label: appointmentOutcomeLabel(a.kind, value) }))]} />
        <Field label={commentRequired ? "Комментарий по результатам *" : "Заметки"}><Textarea value={report.notes} rows={3} maxLength={12000} disabled={busy || !editable} placeholder="Как прошло, что важно учесть" onChange={(event) => change("notes", event.target.value)} /></Field>
        {futureResult && <p className="text-xs text-muted-foreground">Итог собеседования можно сохранить после указанного времени.</p>}
      </div>
      {a.kind === "interview" && <div className="space-y-4 border-t pt-5">
        <p className="text-xs font-medium text-muted-foreground">Наблюдения · необязательно</p>
        <div className="grid grid-cols-2 gap-3">
          <FieldSelect label="Пунктуальность" value={report.punctuality} onChange={(value) => change("punctuality", value)} disabled={busy || !editable}
            options={[{ value: "", label: "Не отмечено" }, { value: "on_time", label: "Вовремя" }, { value: "late", label: "Опоздал" }]} />
          <FieldSelect label="Улыбался" value={report.smiled} onChange={(value) => change("smiled", value)} disabled={busy || !editable}
            options={[{ value: "", label: "Не отмечено" }, { value: "true", label: "Да" }, { value: "false", label: "Нет" }]} />
        </div>
        <Field label="Внешний вид"><Textarea rows={2} value={report.appearance} maxLength={2000} disabled={busy || !editable} placeholder="Опрятность и внешний вид" onChange={(event) => change("appearance", event.target.value)} /></Field>
        <Field label="Общение"><Textarea rows={2} value={report.communication} maxLength={2000} disabled={busy || !editable} placeholder="Как общался и отвечал" onChange={(event) => change("communication", event.target.value)} /></Field>
      </div>}
    </EditDrawer>
    <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Не сохранять изменения?</AlertDialogTitle><AlertDialogDescription>В результате есть несохранённые изменения.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Продолжить редактирование</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction; setPendingAction(null); if (action === "schedule") onSchedule(); else onClose(); }}>Не сохранять</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
