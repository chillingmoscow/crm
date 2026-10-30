"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { TimeInput, normalizeTimeInput } from "@/components/ui/time-input";
import { Input } from "@/components/ui/input";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { appointmentError } from "@/lib/candidates/errors";
import type { Appointment, CandidateStatus, AppointmentOptions } from "@/lib/candidates/types";
import { saveCandidateAppointment } from "../actions";
import { Field, FieldSelect, localTimeToISO, wallTime, safeLink } from "./fields";

type Draft = { source: string; place: string; link: string; date: string; time: string; interviewer: string };
export function CandidateAppointmentDrawer({ candidateId, appointment: a, initialKind, canScheduleTrial, options, onClose, onSaved,
  eligibilityLoading = false, eligibilityError, onRetryEligibility,
}: {
  candidateId: string; appointment: Appointment | null; initialKind: Appointment["kind"]; canScheduleTrial: boolean;
  options: AppointmentOptions; onClose: () => void;
  onSaved: (saved: { id: string; revision: number; status: CandidateStatus }) => void | Promise<void>;
  eligibilityLoading?: boolean; eligibilityError?: string; onRetryEligibility?: () => void;
}) {
  const kind = a?.kind ?? initialKind;
  const defaultVenue = options.venues.find((venue) => venue.id === options.active_venue_id) ?? options.venues[0];
  const seed: Draft = {
    source: a?.id ?? "new",
    place: a?.venue_id ?? (a?.location ? safeLink(a.location) ? "__link__" : "__legacy__" : defaultVenue?.id ?? ""),
    link: a?.location && safeLink(a.location) ? a.location : "",
    date: a?.appointment_date ?? "", time: a?.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : "", interviewer: a?.interviewer_id ?? "",
  };
  const [draft, setDraft] = useState(seed), [busy, start] = useTransition();
  // Async lookup may resolve an existing interview before fields become editable.
  const form = draft.source === seed.source ? draft : seed;
  const change = (field: keyof Draft, value: string) => setDraft({ ...form, [field]: value });
  const venue = options.venues.find((value) => value.id === form.place);
  const timezone = venue?.timezone ?? a?.timezone ?? defaultVenue?.timezone ?? "Europe/Moscow";
  const time = normalizeTimeInput(form.time);
  const blocked = kind === "trial" && !a && !canScheduleTrial;
  const invalidPlace = kind === "trial" ? !venue : !venue && !(form.place === "__link__" && safeLink(form.link.trim())) && !(form.place === "__legacy__" && a?.location);
  const save = () => start(async () => {
    try {
      const saved = await saveCandidateAppointment(candidateId, {
        ...(a ? { id: a.id, revision: a.revision } : {}), kind, venue_id: venue?.id ?? null,
        appointment_date: form.date, starts_at: time ? localTimeToISO(`${form.date}T${time}`, timezone) : null,
        timezone, location: venue?.name ?? (form.place === "__link__" ? form.link.trim() : a?.location ?? ""),
        interviewer_id: kind === "interview" ? form.interviewer || null : null,
      });
      toast.success(kind === "trial" ? a ? "Стажировка изменена" : "Стажировка назначена" : a ? "Собеседование изменено" : "Собеседование назначено");
      await onSaved({ ...saved, id: candidateId });
    } catch (error) { toast.error(appointmentError(error, kind)); }
  });
  return <EditDrawer open title={a ? "Изменить назначение" : kind === "trial" ? "Назначить стажировку" : "Назначить собеседование"}
    description={kind === "trial" ? "День, время и заведение" : "Дата, время, место и интервьюер"}
    onOpenChange={(open) => { if (!open && !busy) onClose(); }}
    footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button
      disabled={busy || eligibilityLoading || !!eligibilityError || blocked || !form.date || invalidPlace || time === undefined || (kind === "interview" && !time)} onClick={save}>Сохранить</Button></>}>
    {eligibilityLoading ? <p role="status" className="text-sm text-muted-foreground">Загружаем данные…</p> : eligibilityError ?
      <div role="alert" className="space-y-3 text-sm"><p>{eligibilityError}</p><Button variant="outline" onClick={onRetryEligibility}>Повторить</Button></div> : blocked ?
      <div className="space-y-3 text-sm"><p>Сначала заполните результат собеседования: «Пройдено» и комментарий.</p><Button variant="outline" asChild><Link onClick={onClose} href={`/people/candidates/${candidateId}`}>Открыть кандидата</Link></Button></div> : <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Дата *"><DatePicker value={form.date} onChange={(value) => change("date", value)} disabled={busy} /></Field>
          <Field label={kind === "interview" ? "Время *" : "Время · необязательно"}><TimeInput value={form.time} onChange={(value) => change("time", value)} disabled={busy} /></Field>
        </div>
        <FieldSelect label={kind === "trial" ? "Заведение *" : "Место собеседования *"} value={form.place} onChange={(value) => change("place", value)} disabled={busy}
          options={[{ value: "", label: "Выберите место" }, ...options.venues.map((value) => ({ value: value.id, label: value.name })),
            ...(kind === "interview" ? [{ value: "__link__", label: "Добавить ссылку" }] : []),
            ...(a?.location && form.place === "__legacy__" ? [{ value: "__legacy__", label: a.location }] : [])]} />
        {form.place === "__link__" && <Field label="Ссылка на собеседование *"><Input type="url" value={form.link} disabled={busy} onChange={(event) => change("link", event.target.value)} maxLength={1000} placeholder="https://…" /></Field>}
        {kind === "interview" && <FieldSelect label="Интервьюер" value={form.interviewer} onChange={(value) => change("interviewer", value)} disabled={busy}
          options={[{ value: "", label: "Не назначен" }, ...options.members.map((member) => ({ value: member.id, label: member.name }))]} />}
      </>}
  </EditDrawer>;
}
