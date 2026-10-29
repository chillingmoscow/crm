"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { candidateError } from "@/lib/candidates/errors";
import type { Appointment, CandidateStatus, AppointmentOptions } from "@/lib/candidates/types";
import { saveCandidateAppointment } from "../actions";
import { Field, FieldSelect, localTimeToISO, wallTime, safeLink } from "./fields";
const outcomes = { scheduled: "Назначено", passed: "Пройдено", no_show: "Не пришёл", rejected: "Не подошёл", canceled: "Отменено" };
export function CandidateAppointmentDrawer({
  candidateId,
  appointment: a,
  initialKind,
  initialOutcome,
  canScheduleTrial,
  options,
  onClose,
  onSaved,
  schedulingOnly = false,
  eligibilityLoading = false,
  eligibilityError,
  onRetryEligibility,
}: {
  candidateId: string;
  appointment: Appointment | null;
  initialKind: Appointment["kind"];
  initialOutcome: Appointment["outcome"];
  canScheduleTrial: boolean;
  options: AppointmentOptions;
  onClose: () => void;
  onSaved: (saved: { id: string; revision: number; status: CandidateStatus }) => void;
  schedulingOnly?: boolean;
  eligibilityLoading?: boolean;
  eligibilityError?: string;
  onRetryEligibility?: () => void;
}) {
  const kind = a?.kind ?? initialKind;
  const defaultVenue = options.venues.find((venue) => venue.id === options.active_venue_id) ?? options.venues[0];
  const scheduling = schedulingOnly || initialOutcome === "scheduled";
  const [place, setPlace] = useState(a?.venue_id ?? (a?.location ? (safeLink(a.location) ? "__link__" : "__legacy__") : defaultVenue?.id ?? "")),
    [link, setLink] = useState(a?.location && safeLink(a.location) ? a.location : ""),
    [date, setDate] = useState(a?.appointment_date ?? ""),
    [time, setTime] = useState(a?.starts_at ? wallTime(a.starts_at, a.timezone).slice(11) : ""),
    [interviewer, setInterviewer] = useState(a?.interviewer_id ?? ""),
    [outcome, setOutcome] = useState(initialOutcome),
    [punctuality, setPunctuality] = useState(a?.interview_feedback?.punctuality ?? ""),
    [appearance, setAppearance] = useState(a?.interview_feedback?.appearance ?? ""),
    [communication, setCommunication] = useState(a?.interview_feedback?.communication ?? ""),
    [smiled, setSmiled] = useState(a?.interview_feedback?.smiled === undefined ? "" : String(a.interview_feedback.smiled)),
    [notes, setNotes] = useState(a?.notes ?? ""),
    [busy, start] = useTransition();
  const venue = options.venues.find((value) => value.id === place);
  const timezone = venue?.timezone ?? a?.timezone ?? defaultVenue?.timezone ?? "Europe/Moscow";
  const blocked = kind === "trial" && !a && !canScheduleTrial;
  const invalidPlace = kind === "trial" ? !venue : !venue && !(place === "__link__" && safeLink(link.trim())) && !(place === "__legacy__" && a?.location);
  const location = venue?.name ?? (place === "__link__" ? link.trim() : a?.location ?? "");
  const save = () =>
    start(async () => {
      try {
        const saved = await saveCandidateAppointment(candidateId, {
          ...(a ? { id: a.id, revision: a.revision } : {}),
          kind,
          venue_id: venue?.id ?? null,
          interview_feedback: kind === "interview" ? {
            ...(punctuality ? { punctuality } : {}),
            ...(appearance.trim() ? { appearance: appearance.trim() } : {}),
            ...(communication.trim() ? { communication: communication.trim() } : {}),
            ...(smiled ? { smiled: smiled === "true" } : {}),
          } : {},
          appointment_date: date,
          starts_at: time ? localTimeToISO(`${date}T${time}`, timezone) : null,
          timezone,
          location,
          interviewer_id: interviewer || null,
          outcome,
          notes,
        });
        toast.success("Встреча сохранена");
        onSaved({ ...saved, id: candidateId });
      } catch (e) {
        toast.error(
          candidateError(e, "Не удалось сохранить встречу"),
        );
      }
    });
  return (
    <EditDrawer
      open
      title={!scheduling ? kind === "interview" ? "Результат собеседования" : "Результат стажировки" : a ? "Изменить встречу" : kind === "trial" ? "Назначить стажировку" : "Назначить собеседование"}
      description={!scheduling ? "Дата, время и результат встречи" : "Дата, время, место и кто проводит встречу"}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || eligibilityLoading || !!eligibilityError || blocked || !date || invalidPlace || (kind === "interview" && (!time || (["passed", "rejected"].includes(outcome) && !notes.trim())))} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      {eligibilityLoading ? <p role="status" className="text-sm text-muted-foreground">Проверяем результат собеседования…</p> : eligibilityError ? (
        <div role="alert" className="space-y-3 text-sm"><p>{eligibilityError}</p><Button variant="outline" onClick={onRetryEligibility}>Повторить</Button></div>
      ) : blocked ? (
        <div className="space-y-3 text-sm"><p>Для назначения стажировки заполните результат последнего собеседования: «Пройдено» и комментарий.</p><Button variant="outline" asChild><Link onClick={onClose} href={`/people/candidates/${candidateId}`}>Открыть карточку кандидата</Link></Button></div>
      ) : null}
      {!blocked && !eligibilityError && <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Дата *">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={kind === "interview" ? "Время *" : "Время · необязательно"}>
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <FieldSelect
        label={kind === "trial" ? "Заведение *" : "Место встречи *"}
        value={place}
        onChange={setPlace}
        options={[
          { value: "", label: "Выберите место" },
          ...options.venues.map((value) => ({ value: value.id, label: value.name })),
          ...(kind === "interview" ? [{ value: "__link__", label: "Добавить ссылку" }] : []),
          ...(a?.location && place === "__legacy__" ? [{ value: "__legacy__", label: a.location }] : []),
        ]}
      />
      {place === "__link__" && <>
        <Field label="Ссылка на встречу *"><Input type="url" value={link} onChange={(event) => setLink(event.target.value)} maxLength={1000} placeholder="https://…" /></Field>
        {defaultVenue && <p className="text-xs text-muted-foreground">Время заведения «{defaultVenue.name}»</p>}
      </>}
      <FieldSelect
        label="Интервьюер"
        value={interviewer}
        onChange={setInterviewer}
        options={[
          { value: "", label: "Не назначен" },
          ...options.members.map((m) => ({ value: m.id, label: m.name })),
        ]}
      />
      {!scheduling && <>
      <FieldSelect
        label="Результат"
        value={outcome}
        onChange={(v) => setOutcome(v as typeof outcome)}
        options={Object.entries(outcomes).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      {kind === "interview" && ["passed", "rejected"].includes(outcome) && (
        <div className="space-y-4 border-t pt-4">
          <h3 className="text-sm font-semibold">Наблюдения на собеседовании</h3>
          <FieldSelect label="Пунктуальность" value={punctuality} onChange={(value) => setPunctuality(value as typeof punctuality)} options={[{ value: "", label: "Не отмечено" }, { value: "on_time", label: "Вовремя" }, { value: "late", label: "Опоздал" }]} />
          <Field label="Внешний вид"><Textarea value={appearance} onChange={(event) => setAppearance(event.target.value)} maxLength={2000} placeholder="Опрятность и внешний вид" /></Field>
          <Field label="Общение"><Textarea value={communication} onChange={(event) => setCommunication(event.target.value)} maxLength={2000} placeholder="Как общался и отвечал на вопросы" /></Field>
          <FieldSelect label="Улыбался" value={smiled} onChange={setSmiled} options={[{ value: "", label: "Не отмечено" }, { value: "true", label: "Да" }, { value: "false", label: "Нет" }]} />
        </div>
      )}
      <Field label={kind === "interview" && outcome !== "scheduled" ? `Комментарий по результатам${["passed", "rejected"].includes(outcome) ? " *" : ""}` : "Заметки"}>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={12000}
        />
      </Field>
      </>}
      </>}
    </EditDrawer>
  );
}
