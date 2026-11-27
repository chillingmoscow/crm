"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { countRu } from "@/lib/format/plural";
import { heatmapWeeks, type HeatmapDay } from "@/lib/people/staff-activity";

/**
 * Год смен сотрудника, как вклады на GitHub: клетка — рабочий день,
 * насыщенность — часы за день, столбец — неделя с понедельника. Подсказка
 * у клетки — дата и часы. Шкала — на `brand` с прозрачностью, поэтому
 * одинаково читается в светлой и тёмной теме. Появление — недели
 * проявляются слева направо (`.heatmap-week-in`, docs/motion.md).
 */

const LEVEL_CLASS: Record<HeatmapDay["level"], string> = {
  // Пустой день — тот же тон в обеих темах: на светлой bg-muted почти не виден.
  0: "bg-foreground/[0.07]",
  1: "bg-brand/25",
  2: "bg-brand/45",
  3: "bg-brand/70",
  4: "bg-brand",
};

const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const monthShort = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" });
const weekdayLong = new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const dayMonthYear = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const hoursFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** «12 ч», «10,5 ч». */
export const formatHours = (hours: number) => `${hoursFormat.format(hours)} ч`;

function dayLabel(date: string, today: string) {
  const d = utc(date);
  const weekday = weekdayLong.format(d);
  const day = (date.slice(0, 4) === today.slice(0, 4) ? dayMonth : dayMonthYear)
    .format(d)
    .replace(/\s*г\.$/, "");
  return `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${day}`;
}

const WEEKDAYS = ["пн", "", "ср", "", "пт", "", ""];

export function ShiftHeatmap({
  hours,
  today,
}: {
  hours: Record<string, number>;
  today: string;
}) {
  const weeks = useMemo(() => heatmapWeeks(hours, today), [hours, today]);
  const scroller = useRef<HTMLDivElement>(null);
  // На узком экране год не помещается: показываем последние недели, старые —
  // прокруткой влево.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const days = weeks.flat().filter((d) => !d.future && d.hours > 0);
  const total = days.reduce((sum, d) => sum + d.hours, 0);
  // Подпись месяца — над первой неделей, которая в нём начинается.
  const monthLabels = weeks.map((week, i) => {
    const first = week[0].date;
    const prev = i > 0 ? weeks[i - 1][0].date : null;
    return !prev || prev.slice(0, 7) !== first.slice(0, 7)
      ? monthShort.format(utc(first)).replace(".", "")
      : "";
  });
  // Первая подпись над неполным месяцем налезает на вторую — прячем её.
  if (monthLabels[0] && monthLabels.slice(1, 3).some(Boolean)) monthLabels[0] = "";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {days.length > 0
          ? `${countRu(days.length, "рабочий день", "рабочих дня", "рабочих дней")} · ${formatHours(Math.round(total))} за год`
          : "За год смен нет"}
      </p>
      <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1">
        <div
          role="img"
          aria-label={`Смены за год: ${countRu(days.length, "рабочий день", "рабочих дня", "рабочих дней")}, ${formatHours(Math.round(total))}`}
          className="inline-grid grid-flow-col gap-[2px]"
          style={{
            gridTemplateRows: "auto repeat(7, 10px)",
            gridTemplateColumns: `20px repeat(${weeks.length}, 10px)`,
          }}
        >
          <span />
          {WEEKDAYS.map((label, i) => (
            <span
              key={i}
              aria-hidden
              className="whitespace-nowrap pr-1 text-xs leading-[10px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
          {weeks.map((week, w) => (
            <WeekColumn
              key={week[0].date}
              week={week}
              index={w}
              label={monthLabels[w]}
              today={today}
            />
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground"
      >
        Меньше
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className={cn("size-[10px] rounded-[2px]", LEVEL_CLASS[level])} />
        ))}
        Больше
      </div>
    </div>
  );
}

function WeekColumn({
  week,
  index,
  label,
  today,
}: {
  week: HeatmapDay[];
  index: number;
  label: string;
  today: string;
}) {
  return (
    <>
      <span
        aria-hidden
        className="h-4 overflow-visible whitespace-nowrap text-xs leading-4 text-muted-foreground"
      >
        {label}
      </span>
      {week.map((day) =>
        day.future ? (
          <span key={day.date} aria-hidden />
        ) : (
          <span
            key={day.date}
            data-tip={`${dayLabel(day.date, today)} · ${day.hours > 0 ? formatHours(day.hours) : "смен нет"}`}
            className={cn(
              "heatmap-week-in size-[10px] rounded-[2px] transition-colors duration-200",
              LEVEL_CLASS[day.level],
              day.date === today && "ring-1 ring-foreground/40 ring-offset-1 ring-offset-card",
            )}
            style={{ animationDelay: `${index * 12}ms` }}
          />
        ),
      )}
    </>
  );
}
