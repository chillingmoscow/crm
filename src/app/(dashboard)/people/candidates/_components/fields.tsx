"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium">
      {label}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base font-normal outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 sm:text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function StatusBadge({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <span className="truncate" title={label}>
        {label}
      </span>
    </span>
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

export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100,
    b = a % 10;
  return a > 10 && a < 20
    ? forms[2]
    : b === 1
      ? forms[0]
      : b > 1 && b < 5
        ? forms[1]
        : forms[2];
}
