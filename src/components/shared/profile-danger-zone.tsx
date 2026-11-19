import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Строка разрушительного действия во вкладке «Опасная зона» карточки
 * сущности: красная плитка-иконка, заголовок, что произойдёт, и кнопка
 * `destructive` справа. Само действие — через `ConfirmDialog`.
 * Один вид для сотрудника, должности и подразделения.
 */
export function ProfileDangerAction({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[14px] border bg-card px-5 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
        <Icon className="size-4 text-destructive" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
        <p className="text-base font-semibold leading-tight text-destructive">
          {title}
        </p>
        <p className="text-[13px] leading-snug text-muted-foreground">
          {description}
        </p>
      </div>
      <Button
        variant="destructive"
        className="shrink-0"
        onClick={onAction}
        disabled={disabled}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
