"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Подтверждение действия, которое нельзя или трудно отменить.
 * Правила — `docs/design-system.md`, «Modal»: заголовок называет объект
 * («Удалить документ „Паспорт“?»), кнопка повторяет глагол с объектом
 * («Удалить документ»), вторая кнопка всегда «Отмена».
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  busy = false,
  restriction,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Подпись кнопки во время выполнения: «Удаляем…». */
  pendingLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /**
   * Почему действие сейчас недоступно. Показывается в теле, кнопка
   * подтверждения выключена: разрушительное действие не прячем, а объясняем.
   */
  restriction?: ReactNode;
  /** Ошибка выполнения: остаётся в диалоге, а не уходит в тост. */
  error?: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {restriction || error ? (
          <p role="alert" className="text-sm text-destructive">
            {restriction || error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={busy || !!restriction}
            onClick={onConfirm}
          >
            {busy && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
