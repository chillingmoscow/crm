"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Элемент, который плавно появляется и плавно уходит (docs/motion.md):
 * пока `show` выключено, он остаётся на экране с прежним содержимым,
 * доигрывает уход и только потом пропадает. Для чипов фильтров, пинов
 * сортировки и кнопок в ряду условий.
 */
export function MotionPresence({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(show);
  const [settled, setSettled] = useState(false);
  const [last, setLast] = useState<ReactNode>(children);
  useEffect(() => {
    if (show) {
      setMounted(true);
      setLast(children);
    } else {
      setSettled(false);
    }
  }, [show, children]);
  if (!mounted && !show) return null;
  return (
    <span
      className={cn("motion-chip", className)}
      data-state={show ? "open" : "closed"}
      // После появления — без ограничений ширины и обрезки (кольцо фокуса, длинный текст).
      data-settled={show && settled ? "true" : undefined}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (show) setSettled(true);
        else setMounted(false);
      }}
    >
      {show ? children : last}
    </span>
  );
}
