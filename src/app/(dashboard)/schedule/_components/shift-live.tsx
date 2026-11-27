"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const MINUTE = 60_000;

/**
 * Текущий момент для сетки расписания: обновляется на границе каждой минуты
 * и только на видимой вкладке; при возвращении на вкладку — сразу.
 *
 * `initial` — момент, когда сервер рисовал страницу: с ним идущие смены и
 * часы в шапке есть в первой же разметке, и сетка не перестраивается после
 * загрузки скриптов. Разметка при гидратации совпадает — значение приходит
 * пропом, а не из часов устройства; сразу после монтирования время берётся
 * уже с устройства. Без `initial` — `null` до монтирования.
 */
export function useMinuteNow(initial?: number): number | null {
  const [now, setNow] = useState<number | null>(initial ?? null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      const at = Date.now();
      setNow(at);
      timer = setTimeout(tick, MINUTE - (at % MINUTE) + 50);
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}

/** Смена идёт: уже началась и ещё не закончилась. */
export function shiftRunning(shift: { starts_at: string; ends_at: string }, now: number | null) {
  return now !== null && Date.parse(shift.starts_at) <= now && now < Date.parse(shift.ends_at);
}

/** Доля прошедшей части смены, 0…1. */
export function shiftElapsed(shift: { starts_at: string; ends_at: string }, now: number) {
  const start = Date.parse(shift.starts_at);
  const span = Date.parse(shift.ends_at) - start;
  return span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : 0;
}

/**
 * Точка «смена идёт»: спокойно расходящееся кольцо (`.shift-live-dot` в
 * globals.css). Цвет — `className` (по умолчанию цвет текста карточки).
 */
export function LiveDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("shift-live-dot bg-current", className)} />;
}

/**
 * Отметка «сейчас» на идущей смене: тонкая полоска у нижнего края карточки,
 * закрашенная на прошедшую часть смены. Край заливки — текущий момент.
 */
export function ShiftNowMark({ elapsed }: { elapsed: number }) {
  return (
    <span aria-hidden className="shift-now-track pointer-events-none absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full">
      <span
        className="shift-now-fill block h-full rounded-full"
        style={{ transform: `scaleX(${elapsed})` }}
      />
    </span>
  );
}

/**
 * Линия «сейчас» в списке смен дня (вид «Список» и телефон): смены там идут
 * по времени начала, и линия стоит между начавшимися и будущими.
 */
export function NowLine({ time }: { time: string }) {
  // Та же раскладка, что у смены в списке: время в колонке w-11, точка —
  // на полоске цвета шаблона, линия — через всё содержимое.
  return (
    <div role="separator" aria-label={`Сейчас ${time}`} className="flex items-center gap-3 px-2 text-xs font-medium text-brand">
      <span className="w-11 shrink-0 text-right tabular-nums">{time}</span>
      <span aria-hidden className="relative h-2 w-[3px] shrink-0">
        <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" />
      </span>
      <span aria-hidden className="h-px flex-1 bg-brand/50 dark:bg-brand/70" />
    </div>
  );
}

/**
 * Время заведения рядом с сегодняшним днём в заголовке сетки: у недельной
 * сетки нет оси времени, поэтому «сейчас» — часы в столбце текущего дня.
 */
export function TodayClock({ time }: { time: string | null }) {
  // Время не отрывается от точки и при узком столбце уходит строкой ниже
  // целиком, без висящего разделителя. До монтирования время неизвестно —
  // место под него занято невидимым «00:00», и шапка не подрастает.
  return (
    <span
      aria-hidden={time ? undefined : true}
      className={cn(
        "ml-1.5 inline-flex items-center gap-1 whitespace-nowrap font-normal tabular-nums",
        !time && "invisible",
      )}
    >
      <span aria-hidden className="size-1 rounded-full bg-current" />
      {time && <span className="sr-only">сейчас </span>}
      {time ?? "00:00"}
    </span>
  );
}
