"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";

export type OptionSelectOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type OptionSelectGroup = {
  label?: string;
  options: OptionSelectOption[];
};

// Radix Select не принимает пустую строку как значение пункта, а нативные
// `<select>` в проекте используют "" как «не выбрано». Подменяем на маркер.
const EMPTY = "__option_select_empty__";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

/**
 * OptionSelect — замена нативного `<select>` на стилизованный shadcn Select
 * с тем же контрактом значения: строка, пустая строка = «не выбрано».
 *
 * Пункт с `value: ""` допустим (например «Все подразделения» или
 * «Без должности»). Если такого пункта нет и `value === ""`, показывается
 * `placeholder`.
 *
 * @example
 * ```tsx
 * <OptionSelect
 *   aria-label="Тип"
 *   value={kind}
 *   onValueChange={setKind}
 *   options={[{ value: "opening", label: "Открытие" }]}
 * />
 * ```
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  groups,
  placeholder = "Не выбрано",
  disabled,
  id,
  name,
  required,
  className,
  contentClassName,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** Плоский список пунктов. Можно сочетать с `groups` — тогда они идут первыми. */
  options?: OptionSelectOption[];
  /** Пункты, разбитые на группы с подписью. */
  groups?: OptionSelectGroup[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  /** Классы триггера (по умолчанию h-10, как у `<Input>`). */
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const all = [...(options ?? []), ...(groups ?? []).flatMap((g) => g.options)];
  const known = all.some((o) => o.value === value);
  const item = (o: OptionSelectOption) => (
    <SelectItem key={o.value || EMPTY} value={encode(o.value)} disabled={o.disabled}>
      {o.label}
    </SelectItem>
  );
  return (
    <Select
      // Неизвестное значение (например, пустое без пункта «не выбрано»)
      // показывает placeholder вместо пустого триггера.
      value={known ? encode(value) : ""}
      onValueChange={(next) => onValueChange(decode(next))}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        // Radix открывает список по pointerdown и не знает про
        // `<fieldset disabled>`, а Chrome шлёт pointerdown и в отключённую
        // кнопку. Нативный `<select>` в такой fieldset не открывался — держим так же.
        onPointerDown={(event) => {
          if (event.currentTarget.matches(":disabled")) event.preventDefault();
        }}
        className={cn("h-10 bg-background text-left shadow-none", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={cn("max-h-[min(24rem,var(--radix-select-content-available-height))]", contentClassName)}>
        {options?.map(item)}
        {groups?.map((group, index) => (
          <React.Fragment key={group.label ?? index}>
            {(index > 0 || !!options?.length) && group.options.length > 0 && <SelectSeparator />}
            <SelectGroup>
              {group.label && group.options.length > 0 && (
                <SelectLabel className="text-xs font-medium text-muted-foreground">{group.label}</SelectLabel>
              )}
              {group.options.map(item)}
            </SelectGroup>
          </React.Fragment>
        ))}
      </SelectContent>
      {/* Значение для формы — сами, а не через `name`/`required` Radix:
          тот отдал бы в FormData внутренний маркер пустого пункта, и
          `required` пропускал бы «не выбрано». Скрытый input ведёт себя
          как нативный `<select>`: "" не проходит `required`, disabled не
          уходит в FormData. */}
      {(name || required) && (
        <input
          aria-hidden
          tabIndex={-1}
          className="sr-only"
          name={name}
          value={value}
          required={required}
          disabled={disabled}
          onChange={() => {}}
        />
      )}
    </Select>
  );
}
