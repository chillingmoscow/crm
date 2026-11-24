"use client";
import { useMemo } from "react";
import { DrawerAvatar } from "@/components/ui/drawer-blocks";
import { cn } from "@/lib/utils";
import { shiftAssignee, type ScheduleData } from "@/lib/schedule/types";
import { dateInZone } from "@/lib/schedule/utils";
import { employeeOptions } from "./employee-picker";

type Person = ReturnType<typeof employeeOptions>["staff"][number];

/**
 * Полоса сотрудников вида «По шаблонам» — зеркало полосы шаблонов вида
 * «По сотрудникам»: сотрудника перетаскивают в слот «шаблон × день».
 *
 * Строка на подразделение, подпись — в колонке шириной с колонку шаблонов
 * сетки ниже. Разовые — в подразделении своей должности; бывших разовых здесь
 * нет (их ставят через форму смены). Фильтр подразделения страницы оставляет
 * одну строку — так полоса остаётся короткой и при тридцати сотрудниках.
 * Счётчик у имени — смен на этой неделе.
 */
export function EmployeeStrip({
  data,
  days,
  department,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  data: ScheduleData;
  days: string[];
  /** Подразделение из фильтра страницы; null — все. */
  department: string | null;
  dragging: string | null;
  onDragStart: (userId: string) => void;
  onDragEnd: () => void;
}) {
  const weekShifts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const shift of data.shifts) {
      const assignee = shiftAssignee(shift);
      if (!assignee || !days.includes(dateInZone(shift.starts_at, data.timezone))) continue;
      counts.set(assignee, (counts.get(assignee) ?? 0) + 1);
    }
    return counts;
  }, [data.shifts, data.timezone, days]);

  const rows = useMemo(() => {
    const { staff, recent } = employeeOptions(data);
    const roleDepartment = new Map(data.roles.map((r) => [r.id, r.department_id]));
    const staffDepartment = new Map(data.staff.map((s) => [s.user_id, s.department_id ?? roleDepartment.get(s.role_id) ?? null]));
    const casualDepartment = new Map(
      (data.casualEmployees ?? []).map((e) => [`payroll:${e.id}`, roleDepartment.get(e.role_id) ?? null]),
    );
    const byDepartment = new Map<string | null, Person[]>();
    for (const person of [...staff, ...recent]) {
      const key = staffDepartment.get(person.value) ?? casualDepartment.get(person.value) ?? null;
      byDepartment.set(key, [...(byDepartment.get(key) ?? []), person]);
    }
    const sort = (list: Person[]) => list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const named = data.departments
      .filter((d) => byDepartment.has(d.id))
      .map((d) => ({ key: d.id, label: d.name, people: sort(byDepartment.get(d.id)!) }));
    const rest = byDepartment.get(null);
    return [
      ...named,
      ...(rest ? [{ key: "none", label: named.length ? "Без подразделения" : "Сотрудники", people: sort(rest) }] : []),
    ];
  }, [data]);

  const visible = department ? rows.filter((row) => row.key === department) : rows;

  return (
    <section aria-label="Сотрудники" className="hidden overflow-hidden rounded-lg border md:block">
      {visible.map((row, index) => (
        <div key={row.key} className={cn("flex", index > 0 && "border-t")}>
          <h2 className="w-[214px] shrink-0 bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground">
            {row.label}
            <span className="ml-1.5 tabular-nums opacity-70">{row.people.length}</span>
          </h2>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1 px-2 py-1.5">
            {row.people.map((o) => {
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
                    "flex h-7 cursor-grab items-center gap-1.5 rounded-full pl-0.5 pr-2.5 text-xs transition-colors hover:bg-muted active:cursor-grabbing",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    dragging === o.value && "opacity-40",
                  )}
                >
                  <DrawerAvatar name={o.name} src={o.avatar} size="sm" />
                  <span className="max-w-40 truncate">{o.name}</span>
                  {count > 0 && <span className="tabular-nums text-muted-foreground">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!visible.length && (
        <p className="px-4 py-2.5 text-sm text-muted-foreground">
          {department ? "В этом подразделении некого ставить на смену" : "Сотрудников для расписания пока нет"}
        </p>
      )}
    </section>
  );
}
