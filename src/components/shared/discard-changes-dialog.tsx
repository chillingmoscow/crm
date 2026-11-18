"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Защита несохранённых изменений в боковой панели-форме (EditDrawer).
 * Правило — `docs/design-system.md`, «Боковая панель»: форма, ввод которой
 * трудно восстановить, спрашивает подтверждение при закрытии с изменениями.
 *
 * `guard(action)` сразу выполняет действие, если изменений нет, иначе
 * показывает «Не сохранять изменения?» и выполняет его только после
 * подтверждения. `dialog` нужно отрисовать рядом с панелью.
 *
 * @example
 * ```tsx
 * const { guard, dialog } = useDiscardGuard(dirty);
 * <EditDrawer onOpenChange={(open) => { if (!open && !busy) guard(onClose); }} … />
 * {dialog}
 * ```
 */
export function useDiscardGuard(
  dirty: boolean,
  description: ReactNode = "Внесённые изменения будут потеряны.",
) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (action: () => void) => {
    if (dirty) setPending(() => action);
    else action();
  };
  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Не сохранять изменения?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Продолжить редактирование</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const action = pending;
              setPending(null);
              action?.();
            }}
          >
            Не сохранять
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { guard, dialog };
}
