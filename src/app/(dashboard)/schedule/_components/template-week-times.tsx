import { templateTimesFor } from "@/lib/schedule/template-times";
import type { ShiftTemplate } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

const DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

/**
 * Время шаблона неделей: 7 клеток ПН…ВС, в каждой начало и конец.
 * Дни, где время отличается от самого частого, подсвечены; нерабочие — «—».
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
  const counts = new Map<string, number>();
  for (const d of week) if (d.start) counts.set(`${d.start}–${d.end}`, (counts.get(`${d.start}–${d.end}`) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <div
      role="list"
      aria-label="Время по дням недели"
      className="grid min-w-[252px] max-w-[440px] grid-cols-7 gap-0.5 tabular-nums sm:gap-1"
    >
      {week.map((d) => {
        const odd = !!d.start && counts.size > 1 && `${d.start}–${d.end}` !== usual;
        return (
          <div
            key={d.label}
            role="listitem"
            aria-label={d.start ? `${d.label}: ${d.start}–${d.end}` : `${d.label}: не работает`}
            className={cn(
              "min-w-0 rounded-md px-0.5 py-1 text-center text-[11px] leading-tight",
              !d.start ? "bg-muted/40 text-muted-foreground/60" : odd ? "bg-brand/10 text-brand" : "bg-muted/60",
            )}
          >
            <span className={cn("block text-[10px] font-medium", !odd && "text-muted-foreground")}>{d.label}</span>
            {d.start ? (
              <>
                <span className="block">{d.start}</span>
                <span className={cn("block", !odd && "text-muted-foreground")}>{d.end}</span>
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
