import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Строка разрушительного действия во вкладке «Опасная зона» карточки
 * сущности: плитка-иконка, заголовок, что произойдёт, и кнопка справа.
 * Красного здесь мало: значок и текст кнопки. Залитая красная кнопка —
 * только в `ConfirmDialog`, на шаге, после которого действие не отменить.
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
        <p className="text-base font-semibold leading-tight">
          {title}
        </p>
        <p className="text-[13px] leading-snug text-muted-foreground">
          {description}
        </p>
      </div>
      <Button
        variant="outline"
        className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onAction}
        disabled={disabled}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
