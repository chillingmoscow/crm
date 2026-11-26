"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { formatQuantity, formatShare, monthLabel } from "@/lib/sales/format";

const shortMonths = [
  "янв.",
  "февр.",
  "март",
  "апр.",
  "май",
  "июнь",
  "июль",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];
const axisLabel = (month: string) =>
  `${shortMonths[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
const compact = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export type TrendSeries = {
  label: string;
  /** «₽», «%» или единица количества («шт. / день», «б.»). */
  unit: string;
  title?: string;
  points: { month: string; value: number | null }[];
};

/** Значение в единицах ряда: деньги — `Money`, доля — «12,5 %», прочее — число с единицей. */
function TrendValue({ value, unit }: { value: number | null; unit: string }) {
  if (unit === "₽") return <Money value={value} />;
  if (unit === "%") return <>{formatShare(value)}</>;
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {formatQuantity(value)}
      <span className="ml-1 text-[0.85em] font-normal text-muted-foreground">
        {unit}
      </span>
    </>
  );
}
const valueText = (value: number | null, unit: string) =>
  value === null
    ? "нет данных"
    : unit === "%"
      ? formatShare(value)
      : `${formatQuantity(unit === "₽" ? Math.round(value) : value)} ${unit}`;

/**
 * Динамика показателя по месяцам. Выбор месяца — как у дневного графика
 * зарплаты (DS «График по дням»): одна остановка фокуса `role="slider"`,
 * стрелки, Home/End; мышь и палец выбирают ближайший месяц.
 */
export function SalesTrend({
  series,
  title = "Динамика по месяцам",
}: {
  series: Record<string, TrendSeries>;
  title?: string;
}) {
  const [metric, setMetric] = useState(Object.keys(series)[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentSeries = series[metric] ?? Object.values(series)[0];
  const [selected, setSelected] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const points = currentSeries.points;
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0].contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [values.length, metric]);
  const plotWidth = Math.max(1, width - 100);
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const x = (i: number) =>
    64 + (points.length < 2 ? 0.5 : i / (points.length - 1)) * plotWidth;
  const y = (value: number) => 190 - ((value - min) / (max - min)) * 160;
  const current =
    points.find((p) => p.month === selected) ??
    [...points].reverse().find((p) => p.value !== null);
  const currentIndex = current
    ? points.findIndex((p) => p.month === current.month)
    : -1;
  const labelCount = Math.min(points.length, width < 640 ? 3 : 5);
  const labelIndices = new Set(
    Array.from({ length: labelCount }, (_, i) =>
      Math.round((i * (points.length - 1)) / Math.max(1, labelCount - 1)),
    ),
  );
  let path = "",
    gap = true;
  points.forEach((p, i) => {
    if (p.value === null) {
      gap = true;
      return;
    }
    path += `${gap ? "M" : "L"}${x(i)},${y(p.value)} `;
    gap = false;
  });
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const ratio = points.length < 2 ? 0 : (px - 64) / plotWidth;
    const index = Math.round(ratio * (points.length - 1));
    const p = points[Math.max(0, Math.min(points.length - 1, index))];
    if (p) setSelected(p.month);
  };
  return (
    <section
      className="min-w-0 rounded-lg border bg-card p-4 sm:p-5"
      aria-label="Динамика продаж"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {currentSeries.title ?? title}
          </p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            aria-live="polite"
          >
            <TrendValue value={current?.value ?? null} unit={currentSeries.unit} />
            {current && (
              <span className="ml-3 text-sm font-normal text-muted-foreground">
                {monthLabel(current.month)}
              </span>
            )}
          </p>
        </div>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="max-w-full gap-2 font-normal"
              aria-label={`Показатель графика: ${currentSeries.label}`}
            >
              <span className="truncate">{currentSeries.label}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 max-w-[calc(100vw-24px)] p-1"
          >
            {Object.entries(series).map(([key, { label }]) => (
              <button
                key={key}
                type="button"
                aria-pressed={key === metric}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  key === metric && "bg-accent",
                )}
                onClick={() => {
                  setMetric(key);
                  setSelected(null);
                  setPickerOpen(false);
                }}
              >
                {label}
                {key === metric && <Check className="size-3.5 shrink-0" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      {values.length ? (
        <div
          className="mt-5 rounded-md outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          tabIndex={0}
          role="slider"
          aria-label={`${currentSeries.label} по месяцам`}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, points.length - 1)}
          aria-valuenow={Math.max(0, currentIndex)}
          aria-valuetext={
            current
              ? `${monthLabel(current.month)}: ${valueText(current.value, currentSeries.unit)}`
              : undefined
          }
          onKeyDown={(e) => {
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(e.key)
            )
              return;
            e.preventDefault();
            if (e.key === "Escape") {
              setSelected(null);
              return;
            }
            const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1;
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? points.length - 1
                  : Math.max(0, Math.min(points.length - 1, currentIndex + step));
            setSelected(points[next].month);
          }}
        >
          <svg
            className="h-52 w-full touch-pan-y overflow-visible"
            ref={svg}
            viewBox={`0 0 ${width} 225`}
            aria-hidden
            onPointerMove={pick}
            onPointerDown={pick}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1="64"
                  x2={width - 36}
                  y1={30 + f * 160}
                  y2={30 + f * 160}
                  className="stroke-border"
                  strokeDasharray="3 5"
                />
                <text
                  x="54"
                  y={34 + f * 160}
                  textAnchor="end"
                  className="fill-muted-foreground text-xs"
                >
                  {compact.format(max - f * (max - min))}
                </text>
              </g>
            ))}
            {current && currentIndex >= 0 && (
              <line
                x1={x(currentIndex)}
                x2={x(currentIndex)}
                y1="22"
                y2="198"
                className="stroke-border"
              />
            )}
            {/* Линия рисуется слева направо, при смене показателя — заново
                (docs/motion.md). */}
            <path
              key={metric}
              d={path}
              fill="none"
              pathLength={1}
              className="stroke-brand chart-line-draw"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <g key={p.month}>
                {p.value !== null && (
                  <circle
                    key={metric}
                    cx={x(i)}
                    cy={y(p.value)}
                    r={current?.month === p.month ? 5 : 3}
                    className="fill-brand stroke-background chart-fill-in"
                    strokeWidth="2"
                  />
                )}
                {labelIndices.has(i) && (
                  <text
                    x={x(i)}
                    y="219"
                    textAnchor="middle"
                    className="fill-muted-foreground text-xs"
                  >
                    {axisLabel(p.month)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <p className="flex h-52 items-center justify-center text-sm text-muted-foreground">
          Нет данных для этого показателя
        </p>
      )}
    </section>
  );
}
