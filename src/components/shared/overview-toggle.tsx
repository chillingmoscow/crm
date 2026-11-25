"use client";

import { useCallback, useLayoutEffect, useState, type ReactNode } from "react";
import { ChartNoAxesColumnIncreasing, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Открыт ли «Обзор» страницы (design-system, «Page header»): по умолчанию
 * открыт, выбор запоминается в браузере под ключом `storageKey`
 * («payroll.overview», «people.overview.staff»…).
 *
 * Выбор читается до первой отрисовки (layout-эффект), поэтому свёрнутый
 * «Обзор» не мелькает открытым. Третье значение — `known`: выбор уже
 * прочитан; пока его нет, данные обзора не запрашиваем.
 */
export function useOverviewOpen(storageKey: string) {
  const [open, setOpenState] = useState(true);
  const [known, setKnown] = useState(false);
  useLayoutEffect(() => {
    if (window.localStorage.getItem(storageKey) === "closed") setOpenState(false);
    setKnown(true);
  }, [storageKey]);
  const setOpen = useCallback(
    (next: boolean | ((value: boolean) => boolean)) =>
      setOpenState((value) => {
        const resolved = typeof next === "function" ? next(value) : next;
        window.localStorage.setItem(storageKey, resolved ? "open" : "closed");
        return resolved;
      }),
    [storageKey],
  );
  return [open, setOpen, known] as const;
}

/**
 * Кнопка «Обзор»: иконка, подпись (на телефоне только иконка) и шеврон,
 * который плавно поворачивается.
 * - `tabs` — справа в строке вкладок (эталон — «Зарплата»);
 * - `toolbar` — в ряду инструментов страницы без вкладок (сотрудники,
 *   кандидаты): outline 36px, открытый — синий.
 */
export function OverviewToggle({
  open,
  onOpenChange,
  label = "Обзор",
  ariaLabel,
  controls,
  variant = "tabs",
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label?: ReactNode;
  /** Полное название для экранного диктора: «Обзор: график и стоимость команды». */
  ariaLabel?: string;
  /** id панели — для `aria-controls`. */
  controls?: string;
  variant?: "tabs" | "toolbar";
  className?: string;
}) {
  const chevron = (
    <ChevronDown className={cn("motion-chevron size-3.5 shrink-0", open && "rotate-180")} />
  );
  const common = {
    type: "button" as const,
    "aria-expanded": open,
    "aria-controls": controls,
    "aria-label": ariaLabel,
    "data-tip": open ? "Скрыть обзор" : "Показать обзор",
    onClick: () => onOpenChange(!open),
  };
  if (variant === "toolbar") {
    return (
      <Button
        {...common}
        variant="outline"
        size="sm"
        className={cn(
          "touch-target gap-1.5 px-2 sm:px-3",
          open ? "border-brand text-brand hover:text-brand" : "text-muted-foreground",
          className,
        )}
      >
        <ChartNoAxesColumnIncreasing className="size-4" />
        <span className="hidden sm:inline">{label}</span>
        {chevron}
      </Button>
    );
  }
  return (
    <button
      {...common}
      className={cn(
        "touch-target mb-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors duration-300",
        open ? "text-brand" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <ChartNoAxesColumnIncreasing className="size-4" />
      {/* На телефоне — только иконка: место нужно вкладкам. */}
      <span className="hidden sm:inline">{label}</span>
      {chevron}
    </button>
  );
}

/**
 * Строка вкладок представления с правым слотом («Обзор»): вкладки слева,
 * справа — переключатели страницы. Стоит сразу под шапкой страницы.
 */
export function TabsRow({ tabs, aside, className }: { tabs: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-3", className)}>
      {tabs}
      {aside}
    </div>
  );
}

/**
 * Раскрывающаяся панель (docs/motion.md, `.motion-expand`): высота от нуля,
 * содержимое проявляется; свёрнутая не занимает места и недоступна с
 * клавиатуры. `replayOnOpen` перерисовывает содержимое при раскрытии — чтобы
 * графики внутри рисовались заново.
 */
export function ExpandPanel({
  open,
  children,
  className,
  id,
  replayOnOpen = false,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  replayOnOpen?: boolean;
}) {
  return (
    <div id={id} className={cn("motion-expand", className)} data-open={open} inert={!open}>
      <div key={replayOnOpen ? String(open) : undefined}>{children}</div>
    </div>
  );
}
