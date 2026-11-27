"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { AmountRoundingScale } from "@/lib/format/amount";
import { cn } from "@/lib/utils";
import { Money } from "./money";

// Мягкий досчёт: быстро трогается и долго, плавно доходит до значения
// (expo-out), как числа в интерфейсах Apple.
const DURATION = 1200;
const easeOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

const noop = () => () => {};
/**
 * Ожила ли страница: на сервере и во время гидратации — `false`, после неё и
 * при переходах внутри приложения — сразу `true`. Общий `useHydrated` даёт
 * `false` и на первом кадре каждого нового монтирования: при смене вкладки
 * (итоги монтируются заново) мелькнула бы заглушка.
 */
function usePageAlive(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Заглушка числа, пока страница не ожила: стартовый кадр досчёта («0 ₽») в
 * HTML с сервера выглядел бы как настоящий ноль, пока грузятся скрипты.
 */
function NumberSkeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-[0.8em] w-[5.5em] max-w-full animate-pulse rounded-md bg-muted align-baseline",
        className,
      )}
    />
  );
}

/**
 * Досчёт числа до `target` (docs/motion.md): при первом показе — от нуля,
 * при смене данных — от прежнего значения. Промежуточные кадры округляются
 * до `digits` знаков — той же точности, что у итогового значения, чтобы
 * дробная часть не «прыгала» в конце. `null` — значение неизвестно.
 * При prefers-reduced-motion — сразу итоговое число.
 */
export function useCountUp(target: number | null, digits = 0): number | null {
  const [shown, setShown] = useState<number | null>(target === null ? null : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target === null) {
      setShown(null);
      return;
    }
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(target);
      from.current = target;
      return;
    }
    const factor = 10 ** digits;
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const value = begin + (target - begin) * easeOut(t);
      setShown(t < 1 ? Math.round(value * factor) / factor : target);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target, digits]);
  return shown;
}

const finite = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Знаков после запятой у итоговой суммы — по тем же правилам, что у `Money`. */
function moneyDigits(value: number | null, scale: AmountRoundingScale | undefined, fraction: boolean | "auto" | undefined): AmountRoundingScale {
  if (scale !== undefined) return scale;
  if (fraction === "auto") return value !== null && Math.round(Math.abs(value) * 100) % 100 !== 0 ? 2 : 0;
  return fraction ? 2 : 0;
}

/**
 * Сумма, которая «досчитывается» до значения (дизайн-система, «Движение»).
 * Принимает всё, что `Money`, включая `scale` («Округление сумм» аккаунта).
 * Неизвестная сумма — прочерк, как у `Money`.
 */
export function AnimatedMoney(props: Parameters<typeof Money>[0]) {
  const target = finite(props.value);
  const digits = moneyDigits(target, props.scale, props.fraction);
  const shown = useCountUp(target, digits);
  const hydrated = usePageAlive();
  // До гидратации — заглушка, а не стартовый ноль; досчёт начнётся, когда
  // страница оживёт. Неизвестная сумма — сразу прочерк.
  if (!hydrated && target !== null) return <NumberSkeleton className={props.className} />;
  return <Money {...props} scale={digits} value={shown} />;
}

/**
 * Число, которое «досчитывается» до значения: счётчики, доли, часы — всё,
 * что не рубли. `format` превращает кадр в текст («12», «34,5 %», «58 ч»);
 * по умолчанию — целое с пробелами по разрядам. `digits` — знаков после
 * запятой у промежуточных кадров. Неизвестное значение — «—» серым.
 */
export function AnimatedNumber({
  value,
  digits = 0,
  format,
  className,
}: {
  value: number | null | undefined;
  digits?: number;
  format?: (value: number) => ReactNode;
  className?: string;
}) {
  const target = finite(value);
  const shown = useCountUp(target, digits);
  const hydrated = usePageAlive();
  if (!hydrated && target !== null) return <NumberSkeleton className={cn("w-[3em]", className)} />;
  if (shown === null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("tabular-nums", className)}>
      {format ? format(shown) : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(shown)}
    </span>
  );
}
