import { APPOINTMENT_TITLES, appointmentOutcomeLabel } from "./appointment-labels.ts";
import { STATUSES } from "./types.ts";
import type { Appointment, Candidate, CandidateEvent, CandidateStatus } from "./types.ts";

/**
 * «Ход подбора» во вкладке «Коммуникация»: только шаги пути кандидата —
 * анкета пришла, смена этапа, назначения, переносы и итоги встреч. Правки
 * полей, комментарии и файлы остаются в «Журнале».
 */
export type TimelineItem = {
  id: string;
  at: string;
  title: string;
  detail: string | null;
  actor: string | null;
};

// Назначение встречи меняет этап той же операцией: обе записи журнала
// получают одно время. Смену этапа в таком случае не показываем отдельно.
const SAME_OPERATION_MS = 5_000;
const TIME_ZONE = "Europe/Moscow";

const SUBMITTED: Record<Candidate["source"], string> = {
  tilda: "Анкета пришла с сайта",
  notion: "Анкета перенесена из прежней базы",
  manual: "Анкета добавлена вручную",
};

const STAGE_TITLES: Partial<Record<CandidateStatus, string>> = {
  new: "Возвращена в новые анкеты",
  review: "Можно рассмотреть",
  interview: "Этап «Собеседование»",
  trial: "Этап «Стажировка»",
  rejected: "Не подходит",
  hired: "Принят на работу",
};

const MEETING_CREATED: Record<Appointment["kind"], string> = {
  interview: "Назначено собеседование",
  trial: "Назначена стажировка",
};
const MEETING_MOVED: Record<Appointment["kind"], string> = {
  interview: "Собеседование перенесено",
  trial: "Стажировка перенесена",
};

type MeetingSnapshot = Partial<
  Pick<Appointment, "kind" | "appointment_date" | "starts_at" | "timezone" | "outcome">
>;

/** «21 ноября, 14:00» во времени места встречи; без времени — только дата. */
export function meetingWhen(meeting: MeetingSnapshot): string | null {
  if (!meeting.appointment_date) return null;
  const date = new Date(`${meeting.appointment_date}T12:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  if (!meeting.starts_at) return date;
  const time = new Date(meeting.starts_at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: meeting.timezone || TIME_ZONE,
  });
  return `${date}, ${time}`;
}

const statusChange = (event: CandidateEvent) => {
  const change = (event.details.changes as Record<string, { new?: unknown }> | undefined)?.status;
  const next = change?.new;
  return typeof next === "string" && next in STATUSES ? (next as CandidateStatus) : null;
};

export function candidateTimeline(
  candidate: Pick<Candidate, "submitted_at" | "source">,
  events: CandidateEvent[],
): TimelineItem[] {
  const ordered = [...events].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const meetingsCreated = ordered.filter((e) => e.kind === "appointment_created");
  const items: TimelineItem[] = [
    {
      id: "submitted",
      at: candidate.submitted_at,
      title: SUBMITTED[candidate.source] ?? "Анкета пришла",
      detail: null,
      actor: null,
    },
  ];
  for (const event of ordered) {
    const actor = event.actor_name && event.actor_name !== "Система" ? event.actor_name : null;
    if (event.kind === "appointment_created" || event.kind === "appointment_updated") {
      const before = (event.details.before ?? null) as MeetingSnapshot | null;
      const after = (event.details.after ?? null) as MeetingSnapshot | null;
      const kind = after?.kind ?? before?.kind;
      if (!after || !kind) continue;
      if (event.kind === "appointment_created") {
        const when = meetingWhen(after);
        items.push({ id: event.id, at: event.created_at, title: MEETING_CREATED[kind], detail: when ? `на ${when}` : null, actor });
        continue;
      }
      const moved =
        before?.appointment_date !== after.appointment_date || before?.starts_at !== after.starts_at;
      if (moved) {
        const when = meetingWhen(after);
        items.push({ id: `${event.id}:moved`, at: event.created_at, title: MEETING_MOVED[kind], detail: when ? `на ${when}` : null, actor });
      }
      if (after.outcome && after.outcome !== before?.outcome && after.outcome !== "scheduled") {
        items.push({
          id: `${event.id}:outcome`,
          at: event.created_at,
          title: `${APPOINTMENT_TITLES[kind]}: ${appointmentOutcomeLabel(kind, after.outcome).toLowerCase()}`,
          detail: null,
          actor,
        });
      }
      continue;
    }
    const next = statusChange(event);
    if (!next) continue;
    const coveredByMeeting =
      (next === "interview" || next === "trial") &&
      meetingsCreated.some(
        (m) =>
          (m.details.after as MeetingSnapshot | undefined)?.kind === next &&
          Math.abs(Date.parse(m.created_at) - Date.parse(event.created_at)) <= SAME_OPERATION_MS,
      );
    if (coveredByMeeting) continue;
    items.push({ id: event.id, at: event.created_at, title: STAGE_TITLES[next] ?? STATUSES[next], detail: null, actor });
  }
  return items;
}

/** «14 ноября, 12:30»; год — только если не текущий. */
export function timelineDate(at: string, now = new Date()): string {
  const date = new Date(at);
  const year = (d: Date) => d.toLocaleDateString("ru-RU", { year: "numeric", timeZone: TIME_ZONE });
  const day = date
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      ...(year(date) !== year(now) ? { year: "numeric" as const } : {}),
      timeZone: TIME_ZONE,
    })
    .replace(" г.", "");
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
  return `${day}, ${time}`;
}
