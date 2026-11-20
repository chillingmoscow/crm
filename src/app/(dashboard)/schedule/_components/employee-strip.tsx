"use client";
import { useMemo, useState } from "react";
import { GripVertical, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DrawerAvatar } from "@/components/ui/drawer-blocks";
import { cn } from "@/lib/utils";
import { shiftAssignee, type ScheduleData } from "@/lib/schedule/types";
import { dateInZone } from "@/lib/schedule/utils";
import { employeeOptions } from "./employee-picker";

/**
 * Полоса сотрудников вида «По шаблонам» — зеркало полосы шаблонов вида
 * «По сотрудникам»: сотрудника перетаскивают в слот «шаблон × день».
 * Сверху штатные, ниже разовые; бывшие разовые — только по поиску.
 * Счётчик у имени — смен на этой неделе: кто уже занят в конкретный день,
 * видно при наведении на ячейку («Уже есть смена»).
 */
export function EmployeeStrip({
  data,
  days,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  data: ScheduleData;
  days: string[];
  dragging: string | null;
  onDragStart: (userId: string) => void;
  onDragEnd: () => void;
}) {
  const [search, setSearch] = useState("");
  const { staff, recent, former } = useMemo(() => employeeOptions(data), [data]);
  const weekShifts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const shift of data.shifts) {
      const assignee = shiftAssignee(shift);
      if (!assignee || !days.includes(dateInZone(shift.starts_at, data.timezone))) continue;
      counts.set(assignee, (counts.get(assignee) ?? 0) + 1);
    }
    return counts;
  }, [data.shifts, data.timezone, days]);

  const query = search.trim().toLowerCase();
  const match = (o: { name: string; hint: string }) =>
    !query || `${o.name} ${o.hint}`.toLowerCase().includes(query);
  const groups = [
    { label: "Сотрудники", items: staff.filter(match) },
    { label: "Разовые", items: [...recent, ...(query ? former : [])].filter(match) },
  ].filter((group) => group.items.length);

  return (
    <section aria-label="Сотрудники" className="hidden gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 md:grid">
      <div className="flex items-center gap-4">
        <h2 className="shrink-0 text-xs font-semibold text-muted-foreground">Сотрудники</h2>
        <div className="relative w-56">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Имя или должность"
            aria-label="Найти сотрудника"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-1.5">
          {groups.length > 1 && (
            <span className="mr-1 text-xs text-muted-foreground">{group.label}</span>
          )}
          {group.items.map((o) => {
            const count = weekShifts.get(o.value) ?? 0;
            return (
              <button
                key={o.value}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/sheerly-employee", o.value);
                  e.dataTransfer.effectAllowed = "copy";
                  onDragStart(o.value);
                }}
                onDragEnd={onDragEnd}
                aria-label={`${o.name}, ${o.hint}. Смен на неделе: ${count}`}
                data-tip={`${o.hint} · смен на неделе: ${count}`}
                className={cn(
                  "flex h-8 cursor-grab items-center gap-1.5 rounded-md border bg-background pl-1 pr-2 text-xs active:cursor-grabbing",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  dragging === o.value && "opacity-40",
                )}
              >
                <GripVertical aria-hidden className="size-3 text-muted-foreground opacity-60" />
                <DrawerAvatar name={o.name} src={o.avatar} size="sm" />
                <span className="max-w-40 truncate">{o.name}</span>
                {count > 0 && <span className="tabular-nums text-muted-foreground">{count}</span>}
              </button>
            );
          })}
        </div>
      ))}
      {!groups.length && (
        <p className="text-sm text-muted-foreground">
          {query ? "Сотрудник не найден" : "Сотрудников для расписания пока нет"}
        </p>
      )}
    </section>
  );
}
