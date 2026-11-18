"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { Label } from "./label";

/** Пропсы, которые `Field` отдаёт полю: связь с подписью, подсказкой и ошибкой. */
export type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
};

export type FieldProps = {
  /** Подпись над полем. */
  label: React.ReactNode;
  /**
   * Поле. Функция получает `id` и `aria-*` — их нужно раздать контролу:
   * `{(control) => <Input {...control} value={…} />}`. Работает с `Input`,
   * `Textarea`, `OptionSelect`, `DatePicker`, `TimePicker`, `MonthPicker`.
   */
  children: (control: FieldControlProps) => React.ReactNode;
  /**
   * Явный id поля. Если не задан, берётся `useId()` — но в разметку он
   * попадает только после гидратации (см. DS «Radix-обёртки: id из `useId`
   * не отдаём в SSR-разметку»): иначе подсказка или ошибка, появившиеся
   * уже на клиенте, получат другой id, чем серверный `aria-describedby`.
   */
  id?: string;
  /** Обязательное поле: красная звёздочка у подписи + `aria-required`. */
  required?: boolean;
  /** Подсказка под полем, одна строка — только если меняет результат. */
  hint?: React.ReactNode;
  /** Текст ошибки под полем. Пока он есть, у поля `aria-invalid`. */
  error?: React.ReactNode;
  className?: string;
};

/**
 * Поле формы: подпись, контрол, подсказка, ошибка — одной разметкой
 * (DS «Form States»). Подпись `Label` 14px связана с полем через
 * `htmlFor`/`id`, подсказка и ошибка — через `aria-describedby`.
 *
 * @example
 * ```tsx
 * <Field label="Номер" required hint="Как в медкнижке" error={errors.number}>
 *   {(control) => <Input {...control} value={number} onChange={…} />}
 * </Field>
 * ```
 */
export function Field({
  label,
  children,
  id: explicitId,
  required = false,
  hint,
  error,
  className,
}: FieldProps) {
  const generatedId = React.useId();
  const hydrated = useHydrated();
  // Явный id стабилен и на сервере, и на клиенте; сгенерированный —
  // только после гидратации.
  const id = explicitId ?? (hydrated ? generatedId : undefined);
  const hintId = id && hint ? `${id}-hint` : undefined;
  const errorId = id && error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          // Обязательность для скринридера передаёт aria-required на поле,
          // поэтому сама звёздочка скрыта.
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
