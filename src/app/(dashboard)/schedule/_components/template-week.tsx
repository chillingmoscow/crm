import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paletteBg } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { templateTimesFor } from "@/lib/schedule/template-times";
import { shiftTemplateLabel, type Shift, type ShiftTemplate } from "@/lib/schedule/types";
import type { TaskOccurrence } from "@/lib/schedule/tasks";
import { dateInZone, dayLabel } from "@/lib/schedule/utils";
import { isoWeekday } from "./editors";
import { TemplateName } from "./template-name";

export function TemplateWeek({
  days, today, timezone, templates, shifts, visibleShifts, tasks, showVacancies,
  onAssign, renderShift, renderTask, empty,
}: {
  days: string[];
  today: string;
  timezone: string;
  templates: ShiftTemplate[];
  shifts: Shift[];
  visibleShifts: Shift[];
  tasks: TaskOccurrence[];
  showVacancies: boolean;
  onAssign?: (day: string, template: ShiftTemplate) => void;
  renderShift: (shift: Shift, showTitle?: boolean) => ReactNode;
  renderTask: (task: TaskOccurrence) => ReactNode;
  empty: ReactNode;
}) {
  const active = new Map(templates.map((template) => [template.id, template]));
  const cells = new Map<string, Shift>();
  const otherShifts = new Map<string, Shift[]>();
  const visibleIds = new Set(visibleShifts.map((shift) => shift.id));
  const slotKey = (templateId: string, day: string) => `${templateId}:${day}`;

  for (const shift of shifts) {
    const day = dateInZone(shift.starts_at, timezone);
    const template = active.get(shift.template_id ?? "");
    if (template && templateTimesFor(template, isoWeekday(day))) {
      const key = slotKey(template.id, day);
      if (!cells.has(key)) {
        cells.set(key, shift);
        continue;
      }
    }
    // Existing shifts without an active slot, including historical duplicates.
    if (visibleIds.has(shift.id)) {
      const items = otherShifts.get(day) ?? [];
      items.push(shift);
      otherShifts.set(day, items);
    }
  }

  const tasksByShift = new Map<string, TaskOccurrence[]>();
  const tasksBySlot = new Map<string, TaskOccurrence[]>();
  const otherTasks = new Map<string, TaskOccurrence[]>();
  for (const task of tasks) {
    if (task.shift_id && visibleIds.has(task.shift_id)) {
      const items = tasksByShift.get(task.shift_id) ?? [];
      items.push(task);
      tasksByShift.set(task.shift_id, items);
      continue;
    }
    const template = active.get(task.snapshot.template_id ?? "");
    const hasSlot = template && templateTimesFor(template, isoWeekday(task.business_date));
    const target = hasSlot ? tasksBySlot : otherTasks;
    const key = hasSlot ? slotKey(template.id, task.business_date) : task.business_date;
    const items = target.get(key) ?? [];
    items.push(task);
    target.set(key, items);
  }

  const rows = showVacancies ? templates : templates.filter((template) =>
    days.some((day) => {
      const shift = cells.get(slotKey(template.id, day));
      return (shift && visibleIds.has(shift.id)) || tasksBySlot.has(slotKey(template.id, day));
    }),
  );
  if (!rows.length && !otherShifts.size && !otherTasks.size) return empty;

  const shiftWithTasks = (shift: Shift, showTitle = false) => (
    <div key={shift.id} className="grid gap-1.5">
      {renderShift(shift, showTitle)}
      {(tasksByShift.get(shift.id) ?? []).map(renderTask)}
    </div>
  );
  const cellClass = (day: string) => cn(
    "h-16 border-b border-l p-1.5 align-top",
    day === today && "bg-brand/[0.025]",
  );

  return (
    <div
      role="region"
      aria-label="Календарь по шаблонам смен"
      tabIndex={0}
      className="max-h-[72dvh] overflow-auto rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table aria-label="Расписание по шаблонам" className="w-full min-w-[900px] table-fixed border-separate border-spacing-0">
        <thead className="sticky top-0 z-20">
          <tr className="bg-muted text-muted-foreground">
            <th scope="col" className="sticky left-0 z-10 w-36 border-b bg-muted px-3 py-3 text-left text-xs font-medium sm:w-[214px] sm:px-4">
              Шаблоны смен · {rows.length}
            </th>
            {days.map((day) => (
              <th key={day} scope="col" className={cn("border-b border-l px-2 py-3 text-center text-xs font-medium", day === today && "bg-brand/10 text-brand")}>
                {dayLabel(day, { weekday: "short", day: "numeric" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((template) => (
            <tr key={template.id} className="group hover:bg-muted/30">
              <th scope="row" className="sticky left-0 z-10 border-b bg-card px-3 py-3 text-left align-top font-normal group-hover:bg-muted sm:px-4">
                <span className="flex items-start gap-2.5 text-[13px]">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", paletteBg(template.color))} aria-hidden />
                  <TemplateName {...template} />
                </span>
              </th>
              {days.map((day) => {
                const times = templateTimesFor(template, isoWeekday(day));
                const key = slotKey(template.id, day);
                const shift = cells.get(key);
                if (!times) return <td key={day} className={cellClass(day)} />;
                const time = `${times.start_time.slice(0, 5)}–${times.end_time.slice(0, 5)}`;
                return (
                  <td key={day} className={cellClass(day)}>
                    <div className="grid gap-1.5">
                      {shift && visibleIds.has(shift.id) && shiftWithTasks(shift)}
                      {!shift && showVacancies && (
                        onAssign ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onAssign(day, template)}
                            aria-label={`Назначить: ${shiftTemplateLabel(template)}, ${dayLabel(day)}, ${time}`}
                            className="h-auto min-h-12 w-full flex-col items-start gap-0.5 bg-muted/30 px-2 py-1.5 text-left"
                          >
                            <span className="text-[11px] font-normal tabular-nums text-muted-foreground">{time}</span>
                            <span className="flex items-center gap-1 text-xs"><Plus className="size-3.5" />Назначить</span>
                          </Button>
                        ) : (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            <span className="block text-[11px] tabular-nums">{time}</span>
                            Без сотрудника
                          </div>
                        )
                      )}
                      {(tasksBySlot.get(key) ?? []).map(renderTask)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {otherShifts.size > 0 && (
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-b bg-card px-3 py-3 text-left align-top text-[13px] font-medium sm:px-4">
                Другие смены
              </th>
              {days.map((day) => (
                <td key={day} className={cellClass(day)}>
                  <div className="grid gap-1.5">{otherShifts.get(day)?.map((shift) => shiftWithTasks(shift, true))}</div>
                </td>
              ))}
            </tr>
          )}
          {otherTasks.size > 0 && (
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-b bg-card px-3 py-3 text-left align-top text-[13px] font-medium sm:px-4">
                Другие задачи
              </th>
              {days.map((day) => (
                <td key={day} className={cellClass(day)}>
                  <div className="grid gap-1.5">{otherTasks.get(day)?.map(renderTask)}</div>
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
