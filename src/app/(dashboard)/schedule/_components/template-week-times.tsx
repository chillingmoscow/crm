import { templateTimesFor } from "@/lib/schedule/template-times";
import type { ShiftTemplate } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

const DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

/**
 * Время шаблона неделей: 7 клеток ПН…ВС, в каждой начало и конец.
 * Все рабочие дни выглядят одинаково (без подсветки «особых» — она читалась
 * как «активный/неактивный»); нерабочие — «—».
 */
export function TemplateWeekTimes({
  template,
}: {
  template: Pick<ShiftTemplate, "start_time" | "end_time" | "variants">;
}) {
  const week = DAYS.map((label, i) => {
    const times = templateTimesFor(template, i + 1);
    return {
      label,
      start: times?.start_time.slice(0, 5) ?? null,
      end: times?.end_time.slice(0, 5) ?? null,
    };
  });
  return (
    <div
      role="list"
      aria-label="Время по дням недели"
      className="grid min-w-[252px] max-w-[440px] grid-cols-7 gap-0.5 tabular-nums sm:gap-1"
    >
      {week.map((d) => {
        return (
          <div
            key={d.label}
            role="listitem"
            aria-label={d.start ? `${d.label}: ${d.start}–${d.end}` : `${d.label}: не работает`}
            className={cn(
              "min-w-0 rounded-md px-0.5 py-1 text-center text-[11px] leading-tight",
              d.start ? "bg-muted/60" : "bg-muted/30 text-muted-foreground/60",
            )}
          >
            <span className="block text-[10px] font-medium text-muted-foreground">{d.label}</span>
            {d.start ? (
              <>
                <span className="block">{d.start}</span>
                <span className="block text-muted-foreground">{d.end}</span>
              </>
            ) : (
              <span className="block py-[7px]">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
