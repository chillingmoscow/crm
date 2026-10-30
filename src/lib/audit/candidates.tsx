import Link from "next/link";
import {
  CalendarDays,
  FilePlus2,
  MessageSquare,
  Pencil,
  Settings,
  UserPlus,
  Trash2,
} from "lucide-react";
import type { AuditEventSpec } from "./format";
import type { AuditEvent } from "./list";
import { STATUSES } from "@/lib/candidates/types";
import type { Appointment } from "@/lib/candidates/types";
import { appointmentOutcomeLabel } from "@/lib/candidates/appointment-labels";
import { interviewFeedbackEntries } from "@/lib/candidates/workflow";
import { formatAuditDate } from "./labels";

const labels: Record<string, string> = {
  full_name: "ФИО",
  phone: "Телефон",
  desired_position: "Желаемая должность",
  age: "Возраст",
  address: "Адрес",
  social: "Социальные сети",
  education: "Образование",
  experience: "Опыт работы",
  plans: "Планы",
  family_status: "Семейное положение",
  drivers_license: "Водительские права",
  salary_expectation: "Ожидания по зарплате",
  status: "Статус",
  responsible_id: "Кто вёл кандидата",
  hired_user_id: "Сотрудник",
  hired_venue_id: "Заведение",
  hired_role_id: "Должность",
  archived_at: "Дата архивации",
  form_id: "Форма Тильды",
  enabled: "Приём заявок",
  telegram_chat_id: "Чат Telegram",
  telegram_configured: "Уведомления Telegram настроены",
  webhook_secret: "Ключ подключения Тильды",
  telegram_token: "Подключение Telegram",
  store_ids: "Основные склады",
  master_store_ids: "Склады кальянных мастеров",
  staff_group_id: "Группа сотрудников Quick Resto",
  bonus_account_type_id: "Тип бонусного счёта",
  office_pool_initialized: "Пул кодов замка перенесён",
};
function value(field: string, input: unknown): string {
  if (input == null || input === "") return "Не указано";
  if (field === "status")
    return STATUSES[input as keyof typeof STATUSES] ?? "Не указан";
  if (field === "archived_at") return formatAuditDate(input);
  if (field === "hired_user_id" || field === "responsible_id")
    return "Сотрудник";
  if (field === "hired_venue_id") return "Выбрано заведение";
  if (field === "hired_role_id") return "Выбрана должность";
  if (typeof input === "boolean") return input ? "Да" : "Нет";
  if (Array.isArray(input))
    return input.length ? input.map(String).join(", ") : "Не указано";
  if (typeof input === "object")
    return (
      Object.values(input).filter(Boolean).map(String).join(", ") ||
      "Не указано"
    );
  return String(input);
}
function CandidateName({ event }: { event: AuditEvent }) {
  const name = String(event.details.name ?? "кандидата");
  return event.entity_id ? (
    <Link
      className="font-medium hover:underline"
      href={`/people/candidates/${event.entity_id}`}
    >
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}
function Changes({ details }: { details: Record<string, unknown> }) {
  const raw = details.changes;
  if (!raw || typeof raw !== "object") return null;
  const entries = Array.isArray(raw)
    ? raw.map((c) => [c.field, c] as const)
    : Object.entries(raw);
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {entries.map(([field, change]) => {
        const c = change as { old: unknown; new: unknown };
        return (
          <li key={field}>
            <span className="text-foreground">
              {labels[field] ?? "Поле анкеты"}:
            </span>{" "}
            <span className="line-through">{value(field, c.old)}</span> →{" "}
            <span className="font-medium text-foreground">
              {value(field, c.new)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
const meetingLabels: Record<string, string> = {
  kind: "Тип",
  appointment_date: "Дата",
  starts_at: "Время",
  location: "Место",
  interviewer_name: "Собеседование проводит",
  outcome: "Результат",
  notes: "Заметки",
  venue_name: "Заведение",
  interview_feedback: "Наблюдения на собеседовании",
};
function meetingValue(
  field: string,
  input: unknown,
  data: Record<string, unknown>,
): string {
  if (input == null || input === "") return "Не указано";
  if (field === "kind")
    return input === "trial" ? "Стажировка" : "Собеседование";
  if (field === "interview_feedback")
    return interviewFeedbackEntries(input as Appointment["interview_feedback"]).map(([label, item]) => `${label}: ${item}`).join("; ") || "Не заполнены";
  if (field === "outcome") return appointmentOutcomeLabel(data.kind === "trial" ? "trial" : "interview", String(input));
  if (field === "appointment_date") return formatAuditDate(input);
  if (field === "starts_at") {
    try {
      return new Date(String(input)).toLocaleString("ru-RU", {
        timeZone: String(data.timezone ?? "Europe/Moscow"),
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return formatAuditDate(input);
    }
  }
  return String(input);
}
function MeetingDetails({ event }: { event: AuditEvent }) {
  const before = (event.details.before ?? {}) as Record<string, unknown>,
    after = (event.details.after ?? {}) as Record<string, unknown>;
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {Object.entries(meetingLabels)
        .filter(([field]) => {
          if (field === "interview_feedback") {
            const oldFeedback = before[field] as Appointment["interview_feedback"] | undefined;
            const newFeedback = after[field] as Appointment["interview_feedback"] | undefined;
            return (interviewFeedbackEntries(oldFeedback).length > 0 || interviewFeedbackEntries(newFeedback).length > 0) && JSON.stringify(oldFeedback) !== JSON.stringify(newFeedback);
          }
          return before[field] !== after[field];
        })
        .map(([field, label]) => (
          <li key={field}>
            <span className="text-foreground">{label}:</span>{" "}
            {event.action_code.endsWith(".updated") ? (
              <>
                <span className="line-through">
                  {meetingValue(field, before[field], before)}
                </span>{" "}
                →{" "}
              </>
            ) : null}
            <span className="font-medium text-foreground">
              {meetingValue(field, after[field], after)}
            </span>
          </li>
        ))}
    </ul>
  );
}
const base = { iconClass: "text-brand bg-brand/10" };
export const candidateAuditSpecs: Record<string, AuditEventSpec> = {
  "candidate.created": {
    ...base,
    icon: FilePlus2,
    buildHeadline: (e) => (
      <>
        {e.actor ? "получил(а) анкету" : "получила анкету"}{" "}
        <CandidateName event={e} />
      </>
    ),
    buildDetails: (e) => (
      <p className="text-xs text-muted-foreground">
        {e.details.source === "notion"
          ? "Перенесено из Notion"
          : e.details.source === "tilda"
            ? "Заявка с сайта"
            : "Анкета добавлена"}
      </p>
    ),
  },
  "candidate.updated": {
    ...base,
    icon: Pencil,
    buildHeadline: (e) => (
      <>
        изменил(а) анкету <CandidateName event={e} />
      </>
    ),
    buildDetails: (e) => <Changes details={e.details} />,
  },
  "candidate.commented": {
    ...base,
    icon: MessageSquare,
    buildHeadline: (e) => (
      <>
        добавил(а) комментарий к анкете <CandidateName event={e} />
      </>
    ),
  },
  "candidate.comment.updated": {
    ...base,
    icon: Pencil,
    buildHeadline: (e) => <>изменил(а) свой комментарий к анкете <CandidateName event={e} /></>,
    buildDetails: (e) => <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground"><span className="line-through">{String(e.details.before ?? "")}</span> → {String(e.details.after ?? "")}</p>,
  },
  "candidate.comment.deleted": {
    ...base,
    icon: Trash2,
    buildHeadline: (e) => <>удалил(а) свой комментарий к анкете <CandidateName event={e} /></>,
  },
  "candidate.appointment.created": {
    ...base,
    icon: CalendarDays,
    buildHeadline: (e) => (
      <>
        назначил(а) {(e.details.after as { kind?: string } | undefined)?.kind === "trial" ? "стажировку" : "собеседование"} · <CandidateName event={e} />
      </>
    ),
    buildDetails: (e) => <MeetingDetails event={e} />,
  },
  "candidate.appointment.updated": {
    ...base,
    icon: CalendarDays,
    buildHeadline: (e) => (
      <>
        изменил(а) {(e.details.after as { kind?: string } | undefined)?.kind === "trial" ? "стажировку" : "собеседование"} · <CandidateName event={e} />
      </>
    ),
    buildDetails: (e) => <MeetingDetails event={e} />,
  },
  "candidate.file.created": {
    ...base,
    icon: FilePlus2,
    buildHeadline: (e) => (
      <>
        добавил(а) файл к анкете <CandidateName event={e} />
      </>
    ),
    buildDetails: (e) => (
      <p className="text-xs text-muted-foreground">
        {String(e.details.name_of_file ?? e.details.file_name ?? "")}
      </p>
    ),
  },
  "candidate.hired": {
    ...base,
    icon: UserPlus,
    buildHeadline: (e) =>
      e.entity_type === "staff" ? (
        <>принял(а) на работу «{String(e.details.name ?? "")}»</>
      ) : (
        <>
          оформил(а) кандидата <CandidateName event={e} />
        </>
      ),
    buildDetails: (e) =>
      e.details.changes ? (
        <Changes details={e.details} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {String(e.details.role_name ?? "")}
          {e.details.employment_date
            ? ` · с ${formatAuditDate(e.details.employment_date)}`
            : ""}
        </p>
      ),
  },
  "candidate.connection.updated": {
    ...base,
    icon: Settings,
    buildHeadline: () => <>изменил(а) приём заявок из Тильды</>,
    buildDetails: (e) => <Changes details={e.details} />,
  },
  "candidate.employment_settings.updated": {
    ...base,
    icon: Settings,
    buildHeadline: (e) => (
      <>изменил(а) настройки найма · {String(e.details.name ?? "")}</>
    ),
    buildDetails: (e) => <Changes details={e.details} />,
  },
};
