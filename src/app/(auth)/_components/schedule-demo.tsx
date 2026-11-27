"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { paletteBg, paletteText, type PaletteColor } from "@/lib/palette";
import { personInitials } from "@/lib/format/initials";
import { StatusBadge } from "@/components/ui/status-badge";
import { AnimatedNumber } from "@/components/shared/animated-money";

/**
 * Мини-демо на странице входа: недельная сетка расписания сама заполняется
 * сменами, публикуется и через паузу начинается следующая неделя. Люди и
 * смены выдуманы — реальных данных здесь нет.
 *
 * Движение (docs/motion.md, «Демо расписания на входе»): смена проявляется
 * `.table-row-in` с шагом 320 мс, заполненная неделя стоит ~3 с и гаснет за
 * 200 мс. При «Уменьшить движение» неделя сразу заполнена и стоит на месте.
 */

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

const PEOPLE = [
  { name: "Анна Белова", role: "Официант" },
  { name: "Тимур Исаев", role: "Бармен" },
  { name: "Вера Котова", role: "Повар" },
  { name: "Глеб Шумов", role: "Хостес" },
  { name: "Лиза Мельник", role: "Официант" },
] as const;

type Template = { color: PaletteColor; time: string; hours: number };

const TEMPLATES = {
  day: { color: "blue", time: "10–22", hours: 12 },
  evening: { color: "purple", time: "16–02", hours: 10 },
  kitchen: { color: "green", time: "09–21", hours: 12 },
  short: { color: "orange", time: "12–18", hours: 6 },
} satisfies Record<string, Template>;

type TemplateKey = keyof typeof TEMPLATES;
/** [сотрудник, день, шаблон] */
type Shift = readonly [number, number, TemplateKey];

const WEEKS: { label: string; shifts: Shift[] }[] = [
  {
    label: "24–30 ноября",
    shifts: [
      [0, 0, "day"], [2, 0, "kitchen"], [1, 0, "evening"],
      [3, 1, "short"], [4, 1, "day"], [2, 1, "kitchen"],
      [0, 2, "day"], [1, 2, "evening"],
      [3, 3, "short"], [4, 3, "day"], [2, 3, "kitchen"],
      [0, 4, "day"], [1, 4, "evening"], [3, 4, "short"],
      [4, 5, "day"], [2, 5, "kitchen"], [1, 5, "evening"],
      [0, 6, "day"], [3, 6, "short"],
    ],
  },
  {
    label: "1–7 декабря",
    shifts: [
      [4, 0, "day"], [1, 0, "evening"],
      [0, 1, "day"], [2, 1, "kitchen"], [3, 1, "short"],
      [4, 2, "day"], [2, 2, "kitchen"],
      [0, 3, "day"], [1, 3, "evening"], [3, 3, "short"],
      [4, 4, "day"], [2, 4, "kitchen"], [1, 4, "evening"],
      [0, 5, "day"], [3, 5, "short"], [1, 5, "evening"],
      [4, 6, "day"], [2, 6, "kitchen"],
    ],
  },
  {
    label: "8–14 декабря",
    shifts: [
      [0, 0, "day"], [2, 0, "kitchen"],
      [1, 1, "evening"], [4, 1, "day"],
      [0, 2, "day"], [3, 2, "short"], [2, 2, "kitchen"],
      [4, 3, "day"], [1, 3, "evening"],
      [0, 4, "day"], [2, 4, "kitchen"], [3, 4, "short"], [1, 4, "evening"],
      [4, 5, "day"], [3, 5, "short"], [1, 5, "evening"],
      [0, 6, "day"], [2, 6, "kitchen"],
    ],
  },
];

const STEP_MS = 320;
const HOLD_MS = 3200;
const CLEAR_MS = 200;
const GAP_MS = 500;

type Phase = "fill" | "hold" | "clear";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function ScheduleDemo() {
  const reduced = useReducedMotion();
  const [week, setWeek] = useState(0);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<Phase>("fill");

  const shifts = WEEKS[week]!.shifts;

  useEffect(() => {
    if (reduced) return;
    let timer: number;
    if (phase === "fill") {
      timer = window.setTimeout(() => {
        if (count + 1 >= shifts.length) setPhase("hold");
        setCount((c) => Math.min(c + 1, shifts.length));
      }, count === 0 ? GAP_MS : STEP_MS);
    } else if (phase === "hold") {
      timer = window.setTimeout(() => setPhase("clear"), HOLD_MS);
    } else {
      timer = window.setTimeout(() => {
        setWeek((w) => (w + 1) % WEEKS.length);
        setCount(0);
        setPhase("fill");
      }, CLEAR_MS);
    }
    return () => window.clearTimeout(timer);
  }, [reduced, phase, count, shifts.length]);

  // Уменьшенное движение: неделя заполнена и опубликована, ничего не идёт.
  const shown = reduced ? shifts.length : count;
  const published = reduced || phase !== "fill";
  const visible = shifts.slice(0, shown);
  const cell = new Map(visible.map(([p, d, t]) => [`${p}:${d}`, t]));
  const hours = PEOPLE.map((_, p) =>
    visible.reduce((sum, [sp, , t]) => (sp === p ? sum + TEMPLATES[t].hours : sum), 0),
  );

  return (
    <div
      aria-hidden
      className="w-full max-w-[520px] select-none rounded-lg border bg-background p-4 text-foreground shadow"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Расписание</p>
          <p className="text-xs text-muted-foreground">{WEEKS[week]!.label}</p>
        </div>
        {published ? (
          <StatusBadge tone="success">Опубликовано</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Черновик · {shown}</StatusBadge>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1.8fr)_repeat(7,minmax(0,1fr))_minmax(0,0.8fr)] gap-1 text-xs">
        <span />
        {DAYS.map((day) => (
          <span key={day} className="pb-1 text-center font-medium text-muted-foreground">
            {day}
          </span>
        ))}
        <span className="pb-1 text-right font-medium text-muted-foreground">Часы</span>

        {PEOPLE.map((person, p) => (
          <Row
            key={person.name}
            name={person.name}
            hours={hours[p]!}
            clearing={phase === "clear"}
            cells={DAYS.map((_, d) => cell.get(`${p}:${d}`) ?? null)}
            weekKey={week}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  name,
  hours,
  cells,
  clearing,
  weekKey,
}: {
  name: string;
  hours: number;
  cells: (TemplateKey | null)[];
  clearing: boolean;
  weekKey: number;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2 py-1">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {personInitials(name)}
        </span>
        <span className="truncate font-medium">{name.split(" ")[0]}</span>
      </span>
      {cells.map((t, d) => (
        <span key={d} className="flex h-8 items-stretch rounded-md bg-muted/40">
          {t && (
            // Гаснет обёртка: у проявления `.table-row-in` заполнение `both`,
            // и оно перебило бы прозрачность самой смены.
            <span
              key={`${weekKey}:${t}`}
              className={cn(
                "flex w-full transition-opacity duration-200 ease-in",
                clearing && "opacity-0",
              )}
            >
              <span
                className={cn(
                  "table-row-in flex w-full items-center justify-center rounded-md font-medium tabular-nums",
                  paletteBg(TEMPLATES[t].color),
                  paletteText(TEMPLATES[t].color),
                )}
              >
                {TEMPLATES[t].time}
              </span>
            </span>
          )}
        </span>
      ))}
      <span className="flex items-center justify-end font-medium text-muted-foreground">
        <AnimatedNumber value={hours} />
      </span>
    </>
  );
}
