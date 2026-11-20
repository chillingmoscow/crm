"use client";

import { useEffect, useState } from "react";

/**
 * Момент времени в часовом поясе пользователя — без расхождения при гидратации.
 *
 * Наивный `new Date(x).toLocaleString("ru-RU")` прямо в разметке не годится,
 * даже в клиентском компоненте: Next всё равно отрисовывает его на сервере, а
 * там часовой пояс UTC. React сравнивает серверную разметку с ПЕРВЫМ клиентским
 * рендером, и у пользователя в другом поясе они не совпадают — предупреждение о
 * гидратации и подмена текста на глазах.
 *
 * Поэтому первый рендер на обеих сторонах одинаковый (фиксированный пояс), а
 * на местное время переключаемся уже после монтирования — это обычное
 * обновление состояния, которое React не сверяет с сервером.
 */

const FIXED_ZONE = "Europe/Moscow";

export type LocalDateTimeVariant =
  /** «20.11.2026, 14:30» — по умолчанию. */
  | "datetime"
  /** «20.11.2026» — дата в ячейке таблицы. */
  | "date"
  /** «16 ноября, 14:30» (год — только если не текущий) — в лентах и журналах. */
  | "dayTime";

function format(value: string, variant: LocalDateTimeVariant, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const zone = timeZone ? { timeZone } : {};
  if (variant === "date") {
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...zone,
    });
  }
  if (variant === "dayTime") {
    const year = (d: Date) =>
      Number(d.toLocaleDateString("en-US", { year: "numeric", ...zone }));
    const day = date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      ...(year(date) !== year(new Date()) ? { year: "numeric" as const } : {}),
      ...zone,
    });
    const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", ...zone });
    return `${day.replace(/ г\.$/, "")}, ${time}`;
  }
  return date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", ...zone });
}

/** Тот же текст строкой — для `data-tip`, `aria-label` и подписей. */
export function useLocalDateTime(
  value: string | null | undefined,
  variant: LocalDateTimeVariant = "datetime",
  fallback = "—",
): string {
  const [text, setText] = useState(() =>
    value ? format(value, variant, FIXED_ZONE) : fallback,
  );

  useEffect(() => {
    setText(value ? format(value, variant) : fallback);
  }, [value, variant, fallback]);

  return text;
}

/**
 * То же время строкой «20.11.2026, 14:30» — для атрибутов (`data-tip`), куда
 * компонент не вставить. Короткая форма `useLocalDateTime(value, "datetime")`.
 */
export function useLocalDateTimeText(
  value: string | null | undefined,
  fallback = "—",
): string {
  return useLocalDateTime(value, "datetime", fallback);
}

export function LocalDateTime({
  value,
  variant = "datetime",
  fallback = "—",
}: {
  value: string | null | undefined;
  variant?: LocalDateTimeVariant;
  fallback?: string;
}) {
  return <>{useLocalDateTime(value, variant, fallback)}</>;
}
