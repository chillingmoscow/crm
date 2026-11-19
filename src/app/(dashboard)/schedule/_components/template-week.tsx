import type { DragEvent, ReactNode } from "react";
import { ColorDot } from "@/components/ui/color-dot";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { templateTimesFor } from "@/lib/schedule/template-times";
import { shiftTemplateLabel, type Shift, type ShiftTemplate } from "@/lib/schedule/types";
import type { TaskOccurrence } from "@/lib/schedule/tasks";
import { dateInZone, dayLabel } from "@/lib/schedule/utils";
import { isoWeekday } from "./editors";
import { TemplateName } from "./template-name";
import { DROP_OK_CELL_CLASS, DROP_REFUSED_CELL_CLASS, TODAY_CELL_CLASS } from "./grid-row-person";

/** Перетаскивание в слот «шаблон × день» (только таблица, на md+). */
export type SlotDrop = {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  /** Курсор над этой ячейкой: можно бросить или нельзя. */
  target: "ok" | "refused" | null;
  /** Тень или запрет поверх ячейки — не в потоке, строка не растёт. */
  ghost: ReactNode;
};

export function TemplateWeek({
  days, today, timezone, templates, shifts, visibleShifts, tasks, showVacancies,
  onAssign, slotDrop, renderShift, renderTask, empty,
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
  slotDrop?: (day: string, template: ShiftTemplate) => SlotDrop;
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
    day === today && TODAY_CELL_CLASS,
  );
  /** Пустой слот: тихое время слота; «+» при наведении и фокусе, на телефоне
   *  виден всегда (наведения нет). */
  const slotButton = (day: string, template: ShiftTemplate, time: string, mobile = false, covered = false) => onAssign && (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onAssign(day, template)}
      aria-label={`Назначить: ${shiftTemplateLabel(template)}, ${dayLabel(day)}, ${time}`}
      data-tip="Назначить сотрудника"
      className={cn(
        "group/slot relative w-full px-1 text-xs font-normal tabular-nums text-muted-foreground/70 hover:text-foreground",
        mobile ? "touch-target h-10 justify-start px-2" : "h-8",
        // Под «тенью» кнопку прячем, но место оставляем.
        covered && "invisible",
      )}
    >
      {time}
      <Plus
        aria-hidden
        className={cn(
          "absolute right-1 size-3.5 transition-opacity",
          mobile ? "right-2" : "opacity-0 group-hover/slot:opacity-100 group-focus-visible/slot:opacity-100",
        )}
      />
    </Button>
  );
  /** Телефон: таблица 900 px не читается на 390 px, поэтому неделя идёт
   *  списком по дням (как в виде «По сотрудникам»): в дне — слоты шаблонов,
   *  которые в этот день работают, затем смены и задачи вне слотов. */
  const mobileSlots = (day: string) => rows.flatMap((template) => {
    const times = templateTimesFor(template, isoWeekday(day));
    if (!times) return [];
    const key = slotKey(template.id, day);
    const cellShift = cells.get(key);
    const shift = cellShift && visibleIds.has(cellShift.id) ? cellShift : null;
    const vacant = !cellShift && showVacancies && Boolean(onAssign);
    const slotTasks = tasksBySlot.get(key) ?? [];
    if (!shift && !vacant && !slotTasks.length) return [];
    const time = `${times.start_time.slice(0, 5)}–${times.end_time.slice(0, 5)}`;
    return [{ template, key, shift, vacant, slotTasks, time }];
  });

  return (
    <>
    <div className="space-y-6 md:hidden">
      {days.map((day) => {
        const slots = mobileSlots(day);
        const extraShifts = otherShifts.get(day) ?? [];
        const extraTasks = otherTasks.get(day) ?? [];
        return (
          <section key={day} className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b bg-muted/50 py-1.5 pl-4 pr-2">
              <h3 className={cn("py-1.5 text-sm font-medium first-letter:uppercase", day === today && "text-brand")}>
                {dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}
              </h3>
            </div>
            <div className="grid gap-3 p-3">
              {slots.map(({ template, key, shift, vacant, slotTasks, time }) => (
                <div key={key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3">
                  <span className="flex min-w-0 items-center gap-2 py-2 text-[13px]">
                    <ColorDot color={template.color} />
                    <TemplateName {...template} />
                  </span>
                  <div className="grid min-w-0 gap-1.5">
                    {shift && shiftWithTasks(shift)}
                    {vacant && slotButton(day, template, time, true)}
                    {slotTasks.map(renderTask)}
                  </div>
                </div>
              ))}
              {extraShifts.length > 0 && (
                <div className="grid gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Другие смены</p>
                  {extraShifts.map((shift) => shiftWithTasks(shift, true))}
                </div>
              )}
              {extraTasks.length > 0 && (
                <div className="grid gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Другие задачи</p>
                  {extraTasks.map(renderTask)}
                </div>
              )}
              {!slots.length && !extraShifts.length && !extraTasks.length && (
                <p className="text-sm text-muted-foreground">Смен нет</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
    <div
      role="region"
      aria-label="Календарь по шаблонам смен"
      tabIndex={0}
      className="hidden max-h-[72dvh] overflow-auto rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block"
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
                <span className="flex items-center gap-2.5 text-[13px]">
                  <ColorDot color={template.color} />
                  <TemplateName {...template} />
                </span>
              </th>
              {days.map((day) => {
                const times = templateTimesFor(template, isoWeekday(day));
                const key = slotKey(template.id, day);
                const shift = cells.get(key);
                const drop = slotDrop?.(day, template);
                const dropProps = drop && {
                  onDragOver: drop.onDragOver,
                  onDragLeave: drop.onDragLeave,
                  onDrop: drop.onDrop,
                };
                const tdClass = cn(
                  cellClass(day),
                  "relative transition-colors",
                  drop?.target === "ok" && DROP_OK_CELL_CLASS,
                  drop?.target === "refused" && DROP_REFUSED_CELL_CLASS,
                );
                if (!times) return <td key={day} className={tdClass} {...dropProps}>{drop?.ghost}</td>;
                const time = `${times.start_time.slice(0, 5)}–${times.end_time.slice(0, 5)}`;
                return (
                  <td key={day} className={tdClass} {...dropProps}>
                    {drop?.ghost}
                    <div className="grid gap-1.5">
                      {shift && visibleIds.has(shift.id) && shiftWithTasks(shift)}
                      {!shift && showVacancies && slotButton(day, template, time, false, Boolean(drop?.target))}
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
    </>
  );
}
