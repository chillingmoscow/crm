"use client";

import { useEffect, useRef, useState } from "react";

import { Money } from "./money";

const DURATION = 500;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Сумма, которая «досчитывается» до значения: при первом показе — от нуля,
 * при смене данных — от прежнего значения (дизайн-система, «Движение»).
 * При prefers-reduced-motion — сразу итоговое число. Неизвестная сумма —
 * прочерк, как у `Money`.
 */
export function AnimatedMoney(props: Parameters<typeof Money>[0]) {
  const target = typeof props.value === "number" && Number.isFinite(props.value) ? props.value : null;
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
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const value = begin + (target - begin) * easeOut(t);
      setShown(t < 1 ? Math.round(value) : target);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target]);
  return <Money {...props} value={shown} />;
}
