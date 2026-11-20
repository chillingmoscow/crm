import {
  Archive,
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  CalendarX2,
  CircleX,
  ClipboardCheck,
  ClipboardList,
  Eye,
  LayoutTemplate,
  ListChecks,
  MessageSquareText,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEvent } from "@/lib/audit/list";
import { ChangeLines } from "./change-lines";
import type { AuditEventSpec } from "./format";
import { formatAuditDate } from "./labels";

// «Расписание» в общем журнале: `schedule.*`. Смены, шаблоны, чек-листы,
// замены и задачи пишут триггеры (миграция 363) по внутренним историям
// расписания; видимость должностей и сообщения в Telegram — server actions.

const INFO = "text-brand bg-brand/10";
const SUCCESS = "text-emerald-700 bg-emerald-500/10 dark:text-emerald-400";
const DANGER = "text-destructive bg-destructive/10";
const MUTED = "text-muted-foreground bg-muted";

function text(e: AuditEvent, key: string): string {
  const value = e.details[key];
  return typeof value === "string" ? value : "";
}

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-medium">{children}</strong>;
}

/** «12.11» из `2026-11-12` — год в заголовке дня журнала и так виден. */
function dayMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}.${m[2]}` : value;
}

/** «смену «Бар» 12.11, 10:00–22:00» */
function Shift({ event }: { event: AuditEvent }) {
  const title = text(event, "title");
  const date = text(event, "date");
  const start = text(event, "start");
  const end = text(event, "end");
  const when = [date && dayMonth(date), start && end ? `${start}–${end}` : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      смену {title ? <Strong>«{title}»</Strong> : null}
      {when ? ` ${when}` : ""}
    </>
  );
}

/** « · Анна Иванова» — кто стоит на смене, если стоит. */
function onShift(e: AuditEvent): string {
  const employee = text(e, "employee");
  return employee ? ` · ${employee}` : "";
}

function named(e: AuditEvent, fallback: string): ReactNode {
  return <Strong>«{text(e, "name") || fallback}»</Strong>;
}

function Comment({ event }: { event: AuditEvent }) {
  const comment = text(event, "comment");
  if (!comment) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Комментарий: {comment.length > 200 ? `${comment.slice(0, 200)}…` : comment}
    </p>
  );
}

function spec(
  icon: LucideIcon,
  iconClass: string,
  buildHeadline: (e: AuditEvent) => ReactNode,
  buildDetails?: (e: AuditEvent) => ReactNode | null,
): AuditEventSpec {
  return { icon, iconClass, buildHeadline, buildDetails };
}

const changes = (e: AuditEvent) => <ChangeLines details={e.details} />;
const comment = (e: AuditEvent) => <Comment event={e} />;

function pluralShifts(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "смену";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "смены";
  return "смен";
}

function period(e: AuditEvent): string {
  const from = text(e, "from");
  const to = text(e, "to");
  if (!from) return "";
  if (!to || to === from) return ` на ${formatAuditDate(from)}`;
  return ` с ${formatAuditDate(from)} по ${formatAuditDate(to)}`;
}

function swapPeople(e: AuditEvent): ReactNode {
  return (
    <>
      <Strong>{text(e, "from_employee") || "сотрудник"}</Strong> →{" "}
      <Strong>{text(e, "to_employee") || "сотрудник"}</Strong>
    </>
  );
}

export const scheduleAuditSpecs: Record<string, AuditEventSpec> = {
  // ── Смены ────────────────────────────────────────────────────────────
  "schedule.shift.created": spec(CalendarPlus, INFO, (e) => (
    <>
      {e.details.copied ? "скопировал(а)" : "создал(а)"} <Shift event={e} />
      {onShift(e)}
    </>
  )),
  "schedule.shift.updated": spec(
    Pencil,
    INFO,
    (e) => (
      <>
        изменил(а) <Shift event={e} />
        {onShift(e)}
      </>
    ),
    changes,
  ),
  "schedule.shift.deleted": spec(CalendarX2, DANGER, (e) => (
    <>
      удалил(а) <Shift event={e} />
      {onShift(e)}
    </>
  )),
  "schedule.shift.published": spec(Send, SUCCESS, (e) => (
    <>
      опубликовал(а) <Shift event={e} />
      {onShift(e)}
    </>
  )),
  "schedule.shifts.published": spec(CalendarCheck, SUCCESS, (e) => {
    const count = Number(e.details.count ?? 0);
    return (
      <>
        опубликовал(а) <Strong>{count}</Strong> {pluralShifts(count)}
        {period(e)}
      </>
    );
  }),
  "schedule.shift.assigned": spec(UserCheck, INFO, (e) => {
    const employee = text(e, "employee");
    const previous = text(e, "previous_employee");
    return (
      <>
        {employee ? (
          <>
            поставил(а) <Strong>{employee}</Strong> на <Shift event={e} />
          </>
        ) : (
          <>
            снял(а) сотрудника со <Shift event={e} />
          </>
        )}
        {previous ? ` вместо: ${previous}` : ""}
      </>
    );
  }),

  // ── Шаблоны смен ─────────────────────────────────────────────────────
  "schedule.template.created": spec(LayoutTemplate, INFO, (e) => (
    <>
      {e.details.copied ? "скопировал(а)" : "создал(а)"} шаблон смены{" "}
      {named(e, "без названия")}
    </>
  )),
  "schedule.template.updated": spec(LayoutTemplate, INFO, (e) => (
    <>изменил(а) шаблон смены {named(e, "без названия")}</>
  )),
  "schedule.template.archived": spec(Archive, DANGER, (e) => (
    <>отправил(а) в архив шаблон смены {named(e, "без названия")}</>
  )),
  "schedule.template.restored": spec(RotateCcw, INFO, (e) => (
    <>вернул(а) из архива шаблон смены {named(e, "без названия")}</>
  )),
  "schedule.template.applied": spec(CalendarRange, INFO, (e) => {
    const count = Number(e.details.count ?? 0);
    const skipped = Number(e.details.skipped ?? 0);
    return (
      <>
        обновил(а) по шаблону {named(e, "без названия")}{" "}
        <Strong>{count}</Strong> {pluralShifts(count)}
        {text(e, "from") ? ` с ${formatAuditDate(text(e, "from"))}` : ""}
        {skipped > 0 ? ` · пропущено: ${skipped}` : ""}
      </>
    );
  }),

  // ── Чек-листы ────────────────────────────────────────────────────────
  "schedule.checklist.created": spec(ListChecks, INFO, (e) => (
    <>создал(а) чек-лист {named(e, "без названия")}</>
  )),
  "schedule.checklist.updated": spec(ListChecks, INFO, (e) => (
    <>изменил(а) чек-лист {named(e, "без названия")}</>
  )),
  "schedule.checklist.published": spec(Send, SUCCESS, (e) => (
    <>опубликовал(а) чек-лист {named(e, "без названия")}</>
  )),
  "schedule.checklist.archived": spec(Archive, DANGER, (e) => (
    <>отправил(а) в архив чек-лист {named(e, "без названия")}</>
  )),
  "schedule.checklist.restored": spec(RotateCcw, INFO, (e) => (
    <>вернул(а) из архива чек-лист {named(e, "без названия")}</>
  )),
  "schedule.run.approved": spec(
    ClipboardCheck,
    SUCCESS,
    (e) => (
      <>
        принял(а) чек-лист <Strong>«{text(e, "checklist") || "без названия"}»</Strong>
        {text(e, "employee") ? ` · ${text(e, "employee")}` : ""}
        {text(e, "date") ? `, смена ${dayMonth(text(e, "date"))}` : ""}
      </>
    ),
    comment,
  ),
  "schedule.run.returned": spec(
    Undo2,
    DANGER,
    (e) => (
      <>
        вернул(а) на доработку чек-лист{" "}
        <Strong>«{text(e, "checklist") || "без названия"}»</Strong>
        {text(e, "employee") ? ` · ${text(e, "employee")}` : ""}
        {text(e, "date") ? `, смена ${dayMonth(text(e, "date"))}` : ""}
      </>
    ),
    comment,
  ),
  "schedule.qualification.updated": spec(BadgeCheck, INFO, (e) => (
    <>
      изменил(а) допуски к должностям:{" "}
      <Strong>{text(e, "employee") || "сотрудник"}</Strong>
    </>
  )),

  // ── Замены ───────────────────────────────────────────────────────────
  "schedule.swap.requested": spec(
    ArrowLeftRight,
    INFO,
    (e) => (
      <>
        предложил(а) замену: {swapPeople(e)} на <Shift event={e} />
      </>
    ),
    comment,
  ),
  "schedule.swap.answered": spec(ArrowLeftRight, MUTED, (e) => (
    <>
      {e.details.answer === "accepted" ? "согласился(ась) выйти" : "отказался(ась) выйти"}{" "}
      на <Shift event={e} /> вместо{" "}
      <Strong>{text(e, "from_employee") || "коллеги"}</Strong>
    </>
  )),
  "schedule.swap.approved": spec(ArrowLeftRight, SUCCESS, (e) => (
    <>
      утвердил(а) замену: {swapPeople(e)} на <Shift event={e} />
    </>
  )),
  "schedule.swap.rejected": spec(
    CircleX,
    DANGER,
    (e) => (
      <>
        отклонил(а) замену: {swapPeople(e)} на <Shift event={e} />
      </>
    ),
    comment,
  ),
  "schedule.swap.cancelled": spec(Ban, MUTED, (e) => (
    <>
      отозвал(а) заявку на замену: {swapPeople(e)} на <Shift event={e} />
    </>
  )),

  // ── Задачи ───────────────────────────────────────────────────────────
  "schedule.task.created": spec(ClipboardList, INFO, (e) => (
    <>создал(а) задачу {named(e, "без названия")}</>
  )),
  "schedule.task.updated": spec(
    ClipboardList,
    INFO,
    (e) => <>изменил(а) задачу {named(e, "без названия")}</>,
    changes,
  ),
  "schedule.task.deleted": spec(Trash2, DANGER, (e) => (
    <>удалил(а) задачу {named(e, "без названия")}</>
  )),
  "schedule.task.assigned": spec(CalendarClock, INFO, (e) => (
    <>
      назначил(а) задачу {named(e, "без названия")}
      {text(e, "date") ? ` на ${formatAuditDate(text(e, "date"))}` : ""}
    </>
  )),
  "schedule.task_report.approved": spec(
    ClipboardCheck,
    SUCCESS,
    (e) => (
      <>
        принял(а) отчёт по задаче {named(e, "без названия")}
        {text(e, "employee") ? ` · ${text(e, "employee")}` : ""}
        {text(e, "date") ? `, ${formatAuditDate(text(e, "date"))}` : ""}
      </>
    ),
    comment,
  ),
  "schedule.task_report.returned": spec(
    Undo2,
    DANGER,
    (e) => (
      <>
        вернул(а) на доработку отчёт по задаче {named(e, "без названия")}
        {text(e, "employee") ? ` · ${text(e, "employee")}` : ""}
        {text(e, "date") ? `, ${formatAuditDate(text(e, "date"))}` : ""}
      </>
    ),
    comment,
  ),
  "schedule.task_settings.updated": spec(
    ClipboardList,
    INFO,
    (e) => (
      <>
        изменил(а) включение задач в заведении{" "}
        <Strong>
          «{text(e, "venue_name") ||
            (e.entity?.type === "venue" ? e.entity.name : "") ||
            "заведение"}»
        </Strong>
      </>
    ),
    changes,
  ),
  "schedule.messages.updated": spec(
    MessageSquareText,
    INFO,
    (e) => (
      <>
        изменил(а) сообщения о задачах и графике в Telegram для{" "}
        <Strong>«{text(e, "venue_name") || "заведения"}»</Strong>
      </>
    ),
    changes,
  ),

  // ── Должности в графике ──────────────────────────────────────────────
  "schedule.role.visibility_changed": spec(
    Eye,
    INFO,
    (e) => (
      <>
        {e.details.visible ? "показал(а)" : "скрыл(а)"} в расписании должность{" "}
        {named(e, "без названия")}
      </>
    ),
  ),
};

