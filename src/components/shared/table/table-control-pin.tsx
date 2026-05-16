"use client";

import type { ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type TableControlPinProps = {
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
};

export function TableControlPin({
  label,
  icon,
  active,
  clearLabel = "Очистить",
  onClear,
  children,
  align = "start",
  className,
  contentClassName,
}: TableControlPinProps) {
  return (
    <Popover>
      <div className="relative inline-flex">
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
              active
                ? cn("border-brand/20 bg-brand/10 text-brand hover:bg-brand/15", onClear ? "pr-8" : null)
                : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              className,
            )}
          >
            {icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{icon}</span> : null}
            <span className="truncate">{label}</span>
            {!active || !onClear ? <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
          </button>
        </PopoverTrigger>
        {active && onClear ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
            className="absolute right-1.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <PopoverContent align={align} className={cn("w-72 p-1", contentClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
