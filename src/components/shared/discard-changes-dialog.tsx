"use client";

import { useState, type ReactNode } from "react";
import { Undo2 } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";

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
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title="Не сохранять изменения?"
      description={description}
      confirmLabel="Не сохранять"
      cancelLabel="Продолжить редактирование"
      tone="warning"
      icon={Undo2}
      onConfirm={() => {
        const action = pending;
        setPending(null);
        action?.();
      }}
    />
  );
  return { guard, dialog };
}
