"use client";
import type { ReactNode } from "react";
import { RequiredMark } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  /** Обязательное поле — отметка как у общего `Field`. */
  required?: boolean;
  children: ReactNode;
}) {
  // Подпись как у общего `Field` (src/components/ui/field.tsx): 14px / 500,
  // отступ 8px. Жирность только у текста подписи — иначе её наследует поле
  // внутри `label`.
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm">
      <span className="font-medium">
        {label}
        {required && <RequiredMark />}
      </span>
      {children}
    </label>
  );
}
export function FieldSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <Field label={label} required={required}>
      <Select
        value={value || "__empty__"}
        onValueChange={(next) => onChange(next === "__empty__" ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label} aria-required={required || undefined} className="h-10 min-w-0 text-base font-normal sm:text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value || "__empty__"}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}
export function safeLink(value: string) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
export function localTimeToISO(value: string, timezone: string) {
  if (!value) return null;
  const wall = Date.parse(value + "Z");
  if (!Number.isFinite(wall)) throw new Error("Проверьте дату и время");
  let result = wall;
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const rendered = Date.parse(
      formatter.format(new Date(result)).replace(" ", "T") + "Z",
    );
    result += wall - rendered;
  }
  if (formatter.format(new Date(result)).replace(" ", "T") !== value)
    throw new Error("Это время отсутствует в выбранном часовом поясе");
  return new Date(result).toISOString();
}
export function wallTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(" ", "T");
}

