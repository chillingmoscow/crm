"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { ExpandPanel } from "@/components/shared/overview-toggle";
import { cn } from "@/lib/utils";

/**
 * Сворачиваемый блок вместо нативного `<details>` (design-system, «Не
 * делать»): кнопка с `aria-expanded` и плавно поворачивающимся шевроном
 * (`.motion-chevron`), содержимое раскрывается `ExpandPanel`.
 * - `chevron="start"` — шеврон-стрелка слева от подписи (как маркер `<details>`);
 * - `chevron="end"` — строка во всю ширину, шеврон вниз справа.
 * Состояние — своё (`defaultOpen`) или снаружи (`open` + `onOpenChange`).
 */
export function Disclosure({
  title,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  chevron = "start",
  className,
  triggerClassName,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  chevron?: "start" | "end";
  className?: string;
  triggerClassName?: string;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const id = useId();
  const toggle = () => {
    if (controlled === undefined) setOwn(!open);
    onOpenChange?.(!open);
  };
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className={cn(
          "items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          chevron === "end" ? "flex w-full flex-wrap gap-2" : "inline-flex w-fit",
          triggerClassName,
        )}
      >
        {chevron === "start" && (
          <ChevronRight
            aria-hidden
            className={cn("motion-chevron size-4 shrink-0 text-muted-foreground", open && "rotate-90")}
          />
        )}
        {title}
        {chevron === "end" && (
          <ChevronDown
            aria-hidden
            className={cn("motion-chevron size-4 shrink-0 text-muted-foreground", open && "rotate-180")}
          />
        )}
      </button>
      <ExpandPanel open={open} id={id}>
        {children}
      </ExpandPanel>
    </div>
  );
}
