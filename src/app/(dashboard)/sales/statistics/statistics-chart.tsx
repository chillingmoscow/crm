"use client";
import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money } from "@/lib/sales/format";
import {
  statisticsSeries,
  type StatisticsRow,
} from "@/lib/sales/statistics-view";

const metrics = {
  turnover: ["Оборот", "₽"],
  tips_total: ["Чаевые", "₽"],
  averageCheck: ["Средний чек", "₽"],
  alcoholRevenue: ["Продажи алкоголя", "₽"],
  alcoholShare: ["Доля алкоголя", "%"],
  regularRevenue: ["Оборот постоянных гостей", "₽"],
  regularShare: ["Доля постоянных гостей", "%"],
} as const;
const label = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(month + "-01T12:00:00Z"));

export function StatisticsChart({ rows }: { rows: StatisticsRow[] }) {
  const [metric, setMetric] = useState<keyof typeof metrics>("turnover");
  const [selected, setSelected] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const points = statisticsSeries(rows, metric);
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
  return (
    <section
      className="min-w-0 rounded-lg border p-4 sm:p-6"
      aria-label="Динамика продаж"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Динамика по месяцам</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            aria-live="polite"
          >
            {money(current?.value ?? null)}
            {current?.value != null && ` ${metrics[metric][1]}`}
            {current && (
              <span className="ml-3 text-sm font-normal text-muted-foreground">
                {label(current.month)}
              </span>
            )}
          </p>
        </div>
        <Select
          value={metric}
          onValueChange={(v) => {
            setMetric(v as keyof typeof metrics);
            setSelected(null);
          }}
        >
          <SelectTrigger
            className="w-full sm:w-64"
            aria-label="Показатель графика"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(metrics).map(([key, [text]]) => (
              <SelectItem key={key} value={key}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {values.length ? (
        <div
          className="mt-5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-md"
          tabIndex={0}
          role="group"
          aria-label={`${metrics[metric][0]}. Стрелки влево и вправо выбирают месяц.`}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const index = points.findIndex((p) => p.month === current?.month);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? points.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        index + (e.key === "ArrowLeft" ? -1 : 1),
                      ),
                    );
            setSelected(points[next].month);
          }}
        >
          <svg
            className="h-52 w-full overflow-visible"
            ref={svg}
            viewBox={`0 0 ${width} 225`}
            role="img"
            aria-label={`${metrics[metric][0]} по месяцам. Значения также доступны в таблице.`}
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
                  {new Intl.NumberFormat("ru-RU", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(max - f * (max - min))}
                </text>
              </g>
            ))}
            <path
              d={path}
              fill="none"
              className="stroke-brand"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <g key={p.month}>
                {p.value !== null && (
                  <circle
                    cx={x(i)}
                    cy={y(p.value)}
                    r={current?.month === p.month ? 5 : 3}
                    className="fill-brand stroke-background"
                    strokeWidth="2"
                  >
                    <title>
                      {label(p.month)}: {money(p.value)} {metrics[metric][1]}
                    </title>
                  </circle>
                )}
                <rect
                  x={x(i) - plotWidth / 2 / Math.max(1, points.length - 1)}
                  y="15"
                  width={plotWidth / Math.max(1, points.length - 1)}
                  height="180"
                  fill="transparent"
                  onPointerEnter={() => setSelected(p.month)}
                >
                  <title>
                    {label(p.month)}: {money(p.value)}{" "}
                    {p.value !== null ? metrics[metric][1] : ""}
                  </title>
                </rect>
                {labelIndices.has(i) && (
                  <text
                    x={x(i)}
                    y="219"
                    textAnchor="middle"
                    className="fill-muted-foreground text-xs"
                  >
                    {label(p.month)}
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
