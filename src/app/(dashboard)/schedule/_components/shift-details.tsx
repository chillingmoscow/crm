"use client";
import type { ReactNode } from "react";
import { BriefcaseBusiness, StickyNote } from "lucide-react";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerSummary,
  DrawerSummaryItem,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { cn } from "@/lib/utils";
import { paletteBg } from "@/lib/palette";
import { dateInZone, dayLabel, timeInZone } from "@/lib/schedule/utils";
import { describeShiftChange, type ShiftSnapshot } from "@/lib/schedule/shift-history";
import {
  shiftAssignee,
  shiftTemplateLabel,
  type ScheduleData,
  type ScheduleEvent,
  type Shift,
} from "@/lib/schedule/types";

const actionLabels: Record<string, string> = {
  "shift.create": "Смена создана",
  "shift.copy": "Создана копией другой смены",
  "shift.edit": "Смена изменена",
  "shift.assign": "Изменён сотрудник",
  "shift.publish": "Смена опубликована",
  "shift.delete": "Смена удалена",
};

/**
 * Тело панели просмотра смены (тип «Просмотр» из дизайн-системы):
 * одна сводка и история изменений. Статус и действия — в шапке и подвале
 * EditDrawer у вызывающего.
 */
export function ShiftDetails({
  data,
  shift,
  history,
  personName,
  assignControl,
}: {
  data: ScheduleData;
  shift: Shift;
  /** null — история ещё загружается. */
  history: ScheduleEvent[] | null;
  personName: (key: string | null) => string;
  /** Выбор сотрудника для тех, кто может только назначать. */
  assignControl?: ReactNode;
}) {
  const tz = data.timezone;
  const assignee = shiftAssignee(shift);
  const staffMember = data.staff.find((s) => s.user_id === assignee);
  const casual = data.casualEmployees?.find((e) => e.id === shift.payroll_employee_id);
  const role = data.roles.find((r) => r.id === shift.role_id);
  const department = data.departments.find((d) => d.id === shift.department_id);
  const template = data.templates.find((t) => t.id === shift.template_id);
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
      <DrawerSummary label="Данные смены">
        <DrawerSummaryItem
          avatar
          icon={<DrawerAvatar name={assignee ? personName(assignee) : "?"} src={staffMember?.avatar_url} />}
          label={casual ? "Разовый сотрудник · начисление по графику" : staffMember?.role_name ?? "Сотрудник"}
        >
          {assignControl ?? (assignee ? personName(assignee) : "Сотрудник не назначен")}
        </DrawerSummaryItem>
        {template ? (
          <DrawerSummaryItem
            icon={<span className={cn("size-3 rounded-full", paletteBg(template.color))} />}
            label={["Шаблон", role?.name, department?.name].filter(Boolean).join(" · ")}
          >
            {shiftTemplateLabel(template)}
          </DrawerSummaryItem>
        ) : (
          role && (
            <DrawerSummaryItem icon={<BriefcaseBusiness />} label={department?.name ?? "Должность"}>
              {role.name}
            </DrawerSummaryItem>
          )
        )}
        {shift.note && (
          <DrawerSummaryItem icon={<StickyNote />} label="Заметка">
            <span className="whitespace-pre-wrap">{shift.note}</span>
          </DrawerSummaryItem>
        )}
      </DrawerSummary>

      <DrawerSection title="История изменений">
        {history === null ? (
          <div className="space-y-3" aria-label="Загрузка истории">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Изменений пока не было.</p>
        ) : (
          <DrawerTimeline>
            {history.map((event, index) => {
              const details = (event.details ?? {}) as {
                before?: ShiftSnapshot | null;
                after?: ShiftSnapshot | null;
              };
              const who = actor(event.actor_id);
              const changes = describeShiftChange(event.action, details.before, details.after, ctx);
              return (
                <DrawerTimelineItem
                  key={event.id}
                  last={index === history.length - 1}
                  avatar={<DrawerAvatar name={who.label} src={who.avatar} />}
                  title={actionLabels[event.action] ?? event.action}
                  meta={`${who.label} · ${when.format(new Date(event.created_at))}`}
                >
                  {changes.length === 0 && event.action === "shift.edit" ? (
                    <p className="text-muted-foreground">Сохранена без изменений</p>
                  ) : (
                    changes.map((line) => <p key={line}>{line}</p>)
                  )}
                </DrawerTimelineItem>
              );
            })}
          </DrawerTimeline>
        )}
      </DrawerSection>
    </>
  );
}
