"use client";
import { ColorDot } from "@/components/ui/color-dot";
import { useState, type ReactNode } from "react";
import { BriefcaseBusiness, StickyNote } from "lucide-react";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerSummary,
  DrawerSummaryItem,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { dateInZone, dayLabel, timeInZone } from "@/lib/schedule/utils";
import {
  collapseHistory,
  describeShiftChange,
  shiftChangeTitle,
  type ShiftSnapshot,
} from "@/lib/schedule/shift-history";
import { Button } from "@/components/ui/button";
import {
  shiftAssignee,
  shiftTemplateLabel,
  type ScheduleData,
  type ScheduleEvent,
  type Shift,
} from "@/lib/schedule/types";


/** Сколько записей истории показываем сразу и добавляем по «Показать ещё». */
const HISTORY_PAGE = 5;

/**
 * Тело панели просмотра смены (тип «Просмотр» из дизайн-системы):
 * одна сводка и история изменений. Статус и действия — в шапке и подвале
 * EditDrawer у вызывающего.
 */
export function ShiftDetails({
  data,
  shift,
  history,
  historyHasMore = false,
  onLoadMoreHistory,
  personName,
  assignControl,
}: {
  data: ScheduleData;
  shift: Shift;
  /** null — история ещё загружается. */
  history: ScheduleEvent[] | null;
  /** На сервере есть записи старше загруженных. */
  historyHasMore?: boolean;
  onLoadMoreHistory?: () => Promise<void>;
  personName: (key: string | null) => string;
  /** Выбор сотрудника для тех, кто может только назначать. */
  assignControl?: ReactNode;
}) {
  const [visible, setVisible] = useState(HISTORY_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
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

  // Записи с конкретным заголовком; быстрые правки склеены, пустые скрыты.
  const entries = collapseHistory(history ?? []).flatMap((event) => {
    const details = (event.details ?? {}) as {
      before?: ShiftSnapshot | null;
      after?: ShiftSnapshot | null;
    };
    const title = shiftChangeTitle(event.action, details.before, details.after, ctx);
    if (!title) return [];
    const lines = describeShiftChange(event.action, details.before, details.after, ctx)
      // Строку, которая повторяет заголовок («Изменён цвет»), не дублируем.
      .filter((line) => line !== title);
    return [{ event, title, lines }];
  });
  const shown = entries.slice(0, visible);
  const canShowMore = entries.length > visible || historyHasMore;
  const showMore = async () => {
    if (entries.length <= visible && historyHasMore && onLoadMoreHistory) {
      setLoadingMore(true);
      try {
        await onLoadMoreHistory();
      } finally {
        setLoadingMore(false);
      }
    }
    setVisible((v) => v + HISTORY_PAGE);
  };

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
            icon={<ColorDot color={template.color} />}
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
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Изменений пока не было.</p>
        ) : (
          <>
            <DrawerTimeline>
              {shown.map(({ event, title, lines }, index) => {
                const who = actor(event.actor_id);
                return (
                  <DrawerTimelineItem
                    key={event.id}
                    last={index === shown.length - 1}
                    avatar={<DrawerAvatar name={who.label} src={who.avatar} />}
                    title={title}
                    meta={`${who.label} · ${when.format(new Date(event.created_at))}`}
                  >
                    {lines.length > 0 && lines.map((line) => <p key={line}>{line}</p>)}
                  </DrawerTimelineItem>
                );
              })}
            </DrawerTimeline>
            {canShowMore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                disabled={loadingMore}
                onClick={() => void showMore()}
              >
                {loadingMore ? "Загрузка…" : "Показать ещё"}
              </Button>
            )}
          </>
        )}
      </DrawerSection>
    </>
  );
}
