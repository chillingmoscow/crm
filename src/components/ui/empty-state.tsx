/**
 * EmptyState — реиспользуемый паттерн «нет данных» по дизайн-системе Sheerly.
 *
 * Размещение: внутри карточки (Card) или сразу после header'а страницы.
 * Структура: круглая 80×80 иконка с border + title (18px semibold) +
 * subtitle (13px muted) + опциональный CTA.
 *
 * См. Q4FzoZ → Section/Empty States & Tooltips.
 */

import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 bg-muted rounded-xl p-8 min-h-[320px] text-center",
        className,
      )}
    >
      <div className="flex items-center justify-center size-20 rounded-full bg-background border border-border shrink-0">
        <Icon className="w-7 h-7 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1.5 max-w-[360px]">
        <p className="text-[18px] font-semibold text-foreground leading-tight">
          {title}
        </p>
        {description && (
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
