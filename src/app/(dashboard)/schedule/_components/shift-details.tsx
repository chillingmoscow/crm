"use client";
/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileSection } from "@/components/shared/profile-section";
import { cn } from "@/lib/utils";
import { paletteBg } from "@/lib/palette";
import { dateInZone, dayLabel, shiftHours, timeInZone } from "@/lib/schedule/utils";
import { describeShiftChange, type ShiftSnapshot } from "@/lib/schedule/shift-history";
import {
  shiftAssignee,
  shiftTemplateLabel,
  type ScheduleData,
  type ScheduleEvent,
  type Shift,
  type ShiftTemplate,
} from "@/lib/schedule/types";

const actionLabels: Record<string, string> = {
  "shift.create": "Смена создана",
  "shift.copy": "Создана копией другой смены",
  "shift.edit": "Смена изменена",
  "shift.assign": "Изменён сотрудник",
  "shift.publish": "Смена опубликована",
  "shift.delete": "Смена удалена",
};

function Initials({ name, src }: { name: string; src?: string | null }) {
  return src ? (
    <img src={src} alt="" className="size-8 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Содержимое карточки смены: основные данные и полная история изменений. */
export function ShiftDetails({
  data,
  shift,
  template,
  history,
  personName,
  canPublish,
  busy,
  onPublish,
  assignControl,
}: {
  data: ScheduleData;
  shift: Shift;
  template?: ShiftTemplate;
  /** null — история ещё загружается. */
  history: ScheduleEvent[] | null;
  personName: (key: string | null) => string;
  canPublish: boolean;
  busy: boolean;
  onPublish: () => void;
  /** Выбор сотрудника для тех, кто может только назначать. */
  assignControl?: ReactNode;
}) {
  const tz = data.timezone;
  const assignee = shiftAssignee(shift);
  const staffMember = data.staff.find((s) => s.user_id === assignee);
  const role = data.roles.find((r) => r.id === shift.role_id);
  const department = data.departments.find((d) => d.id === shift.department_id);
  const linkedTemplate = data.templates.find((t) => t.id === shift.template_id);
  const hours = shiftHours(shift.starts_at, shift.ends_at).toLocaleString("ru", {
    maximumFractionDigits: 1,
  });
  const ctx = {
    date: (iso: string) => dayLabel(dateInZone(iso, tz), { day: "numeric", month: "short" }),
    time: (iso: string) => timeInZone(iso, tz),
    person: (key: string | null) => (key ? personName(key) : "без сотрудника"),
    role: (id: string | null) => data.roles.find((r) => r.id === id)?.name ?? "без должности",
    template: (id: string | null) => {
      const t = data.templates.find((x) => x.id === id);
      return t ? shiftTemplateLabel(t) : "шаблон";
    },
  };
  const actor = (id: string | null) => {
    const person = data.staff.find((s) => s.user_id === id);
    const label = person
      ? [person.first_name, person.last_name].filter(Boolean).join(" ") || person.role_name
      : "Система";
    return { label: id === data.userId ? `${label} (вы)` : label, avatar: person?.avatar_url };
  };
  const when = new Intl.DateTimeFormat("ru", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <ProfileSection
        title="Смена"
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
              shift.published
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {shift.published ? "Опубликована" : "Черновик"}
          </span>
        }
      >
        <dl className="-my-2 divide-y">
          <Row label="Дата">
            <span className="first-letter:uppercase">
              {dayLabel(dateInZone(shift.starts_at, tz), { weekday: "long", day: "numeric", month: "long" })}
            </span>
          </Row>
          <Row label="Время">
            <span className="tabular-nums">
              {timeInZone(shift.starts_at, tz)}–{timeInZone(shift.ends_at, tz)}
            </span>
            <span className="text-muted-foreground"> · {hours} ч</span>
          </Row>
          <Row label="Сотрудник">
            {assignControl ?? (
              <span className="flex items-center gap-2.5">
                {assignee && <Initials name={personName(assignee)} src={staffMember?.avatar_url} />}
                <span className="min-w-0">
                  <span className="block">{assignee ? personName(assignee) : "Открытая смена, без сотрудника"}</span>
                  {shift.payroll_employee_id && (
                    <span className="block text-xs text-muted-foreground">Разовый · начисление по графику</span>
                  )}
                </span>
              </span>
            )}
          </Row>
          <Row label="Должность">
            {role?.name ?? "Без должности"}
            {department && <span className="text-muted-foreground"> · {department.name}</span>}
          </Row>
          <Row label="Шаблон">
            {linkedTemplate ? (
              <span className="inline-flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", paletteBg(linkedTemplate.color))} />
                {shiftTemplateLabel(template ?? linkedTemplate)}
              </span>
            ) : (
              <span className="text-muted-foreground">Своя смена</span>
            )}
          </Row>
          {shift.note && (
            <Row label="Заметка">
              <span className="whitespace-pre-wrap">{shift.note}</span>
            </Row>
          )}
        </dl>
        {!shift.published && canPublish && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-sm text-muted-foreground">Сотрудник увидит смену после публикации.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={onPublish}>
              <Send />
              Опубликовать
            </Button>
          </div>
        )}
      </ProfileSection>

      <ProfileSection title="История изменений">
        {history === null ? (
          <div className="space-y-3" aria-label="Загрузка истории">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Изменений пока не было.</p>
        ) : (
          <ol className="relative space-y-4">
            {history.map((event, index) => {
              const details = (event.details ?? {}) as {
                before?: ShiftSnapshot | null;
                after?: ShiftSnapshot | null;
              };
              const who = actor(event.actor_id);
              const changes = describeShiftChange(event.action, details.before, details.after, ctx);
              return (
                <li key={event.id} className="relative flex gap-3">
                  {index < history.length - 1 && (
                    <span aria-hidden className="absolute left-4 top-9 -bottom-4 w-px bg-border" />
                  )}
                  <Initials name={who.label} src={who.avatar} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-medium">{actionLabels[event.action] ?? event.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {who.label} · {when.format(new Date(event.created_at))}
                    </p>
                    {changes.length === 0 && event.action === "shift.edit" && (
                      <p className="mt-1 text-[13px] text-muted-foreground">Сохранена без изменений</p>
                    )}
                    {changes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[13px]">
                        {changes.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </ProfileSection>
    </>
  );
}
