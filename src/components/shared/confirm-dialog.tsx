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
  confirmDisabled = false,
  restriction,
  error,
  onConfirm,
  children,
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
  /** Кнопка подтверждения неактивна, пока не выполнено условие (например, не указана причина). */
  confirmDisabled?: boolean;
  /**
   * Почему действие сейчас недоступно. Показывается в теле, кнопка
   * подтверждения выключена: разрушительное действие не прячем, а объясняем.
   */
  restriction?: ReactNode;
  /** Ошибка выполнения: остаётся в диалоге, а не уходит в тост. */
  error?: ReactNode;
  onConfirm: () => void;
  /** Поля между текстом и кнопками: например, причина удаления. */
  children?: ReactNode;
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
        {children}
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
            disabled={busy || confirmDisabled || !!restriction}
            onClick={onConfirm}
          >
            {busy && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
