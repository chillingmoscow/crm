"use client";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
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
// Три значащие цифры: близкие месяцы различимы («4,46 млн» и «4,29 млн»).
const compact = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumSignificantDigits: 3,
});
/** Ширина места под один столбец: уже — ряд листается вбок. */
const MIN_SLOT = 36;
/** С этой ширины места подпись значения стоит над каждым столбцом. */
const LABEL_SLOT = 64;
/** Высота области столбцов (px): самый высокий столбец — во всю высоту. */
const PLOT = 160;

export type TrendSeries = {
  label: string;
  /** «₽», «%» или единица количества («шт. / день», «б.»). */
  unit: string;
  title?: string;
  points: {
    month: string;
    value: number | null;
    /** Вторая строка подсказки: «по 26 ноября», «12 из 14 смен». */
    note?: string | null;
  }[];
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
/** Короткая подпись над столбцом: «4,3 млн», «12,5 %», «3,2». */
const barLabel = (value: number, unit: string) =>
  unit === "%"
    ? formatShare(value)
    : Math.abs(value) >= 10000
      ? compact.format(value)
      : formatQuantity(unit === "₽" ? Math.round(value) : value);

/**
 * Динамика показателя по месяцам — столбцы от нуля (DS «Столбцы по месяцам»).
 * Выделенный месяц (`highlight`, по умолчанию — последний с данными) залит
 * брендом, остальные — светлее. Выбор месяца — как у «Графика по дням»:
 * одна остановка фокуса `role="slider"`, стрелки, Home/End; мышь и палец
 * выбирают столбец, подсказка над ним — месяц и точное значение.
 */
export function SalesTrend({
  series,
  title = "Динамика по месяцам",
  highlight,
}: {
  series: Record<string, TrendSeries>;
  title?: string;
  /** Месяц «2026-11», который выделен цветом: текущий или выбранный на странице. */
  highlight?: string;
}) {
  const [metric, setMetric] = useState(Object.keys(series)[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentSeries = series[metric] ?? Object.values(series)[0];
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const points = currentSeries.points;
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const hasValues = values.length > 0;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0].contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasValues]);
  const max = Math.max(0, ...values);
  const marked =
    (highlight && points.some((p) => p.month === highlight && p.value !== null)
      ? highlight
      : null) ?? [...points].reverse().find((p) => p.value !== null)?.month;
  const current =
    points.find((p) => p.month === selected) ??
    points.find((p) => p.month === marked);
  const currentIndex = current
    ? points.findIndex((p) => p.month === current.month)
    : -1;
  const slot = width ? Math.max(MIN_SLOT, width / Math.max(1, points.length)) : MIN_SLOT;
  const roomy = slot >= LABEL_SLOT;
  // Длинный ряд листается вбок; при показе и смене показателя — к последним месяцам.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [metric, points.length, width]);
  // Месяц, выбранный с клавиатуры, держим в видимой части ряда.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !selected || currentIndex < 0) return;
    const left = currentIndex * slot;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (left + slot > element.scrollLeft + element.clientWidth)
      element.scrollLeft = left + slot - element.clientWidth;
  }, [selected, currentIndex, slot]);
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const index = Math.floor((e.clientX - box.left) / slot);
    const p = points[Math.max(0, Math.min(points.length - 1, index))];
    if (p) setSelected(p.month);
  };
  // Подсказка — только у месяца, который выбирают сейчас (наведение, палец, стрелки).
  const tip = selected ? current : undefined;
  const step = Math.min(70, Math.round(900 / Math.max(1, points.length)));
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
      {hasValues ? (
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
          onBlur={() => setSelected(null)}
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
          <div ref={scroller} className="overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
            <div
              aria-hidden
              className="relative select-none"
              style={{ width: points.length * slot, minWidth: "100%" }}
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setSelected(null);
              }}
            >
              {/* Столбцы растут от нижнего края по очереди; при смене
                  показателя — заново (docs/motion.md). */}
              <div key={metric} className="flex items-end" style={{ height: PLOT + 24 }}>
                {points.map((p, i) => {
                  const isMarked = p.month === marked;
                  const isTip = tip?.month === p.month;
                  const h = p.value === null || max <= 0 ? 0 : Math.max(2, (Math.max(0, p.value) / max) * PLOT);
                  const showLabel = p.value !== null && (roomy || isMarked || isTip);
                  return (
                    <div
                      key={p.month}
                      className="flex h-full shrink-0 flex-col items-center justify-end px-[3px]"
                      style={{ width: slot }}
                    >
                      <span
                        className={cn(
                          "mb-1 whitespace-nowrap text-[11px] leading-4 tabular-nums transition-colors duration-200",
                          isMarked ? "font-medium text-foreground" : "text-muted-foreground",
                          !showLabel && "invisible",
                        )}
                      >
                        {p.value === null ? "—" : barLabel(p.value, currentSeries.unit)}
                      </span>
                      {p.value === null ? (
                        <span className="h-0.5 w-full max-w-10 rounded-full bg-border" />
                      ) : (
                        <span
                          className={cn(
                            // Задержка — inline; при «уменьшить движение» снимаем её (!important бьёт style).
                            "chart-bar-grow-y w-full max-w-10 rounded-t-[5px] transition-colors duration-200 motion-reduce:![animation-delay:0ms]",
                            isMarked
                              ? "bg-brand"
                              : isTip
                                ? "bg-brand/55"
                                : "bg-brand/25 dark:bg-brand/30",
                          )}
                          style={{ height: h, animationDelay: `${120 + i * step}ms` }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex border-t">
                {points.map((p, i) => {
                  const m = Number(p.month.slice(5, 7));
                  const showYear = i === 0 || m === 1;
                  return (
                    <span
                      key={p.month}
                      className={cn(
                        "shrink-0 pt-1.5 text-center text-[11px] leading-4",
                        p.month === marked ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                      style={{ width: slot }}
                    >
                      {shortMonths[m - 1]}
                      <span className={cn("block", !showYear && "invisible")}>
                        {p.month.slice(0, 4)}
                      </span>
                    </span>
                  );
                })}
              </div>
              {tip && currentIndex >= 0 && (
                // Сдвиг к центру столбца — на обёртке: анимация появления
                // задаёт transform и перебила бы translate.
                <div
                  className="pointer-events-none absolute z-10 -translate-x-1/2"
                  style={{
                    left: Math.min(
                      Math.max(currentIndex * slot + slot / 2, 70),
                      points.length * slot - 70,
                    ),
                    // Над столбцом, если помещается; у высокого — поверх его верха.
                    top: Math.max(
                      0,
                      PLOT -
                        64 -
                        (tip.value === null || max <= 0
                          ? 0
                          : (Math.max(0, tip.value) / max) * PLOT),
                    ),
                  }}
                >
                  <div className="motion-popper-in w-max max-w-[220px] rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                    <p className="font-medium first-letter:uppercase">{monthLabel(tip.month)}</p>
                    <p className="tabular-nums">
                      <TrendValue value={tip.value} unit={currentSeries.unit} />
                    </p>
                    {tip.note && <p className="text-muted-foreground">{tip.note}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="flex h-52 items-center justify-center text-sm text-muted-foreground">
          Нет данных для этого показателя
        </p>
      )}
    </section>
  );
}
