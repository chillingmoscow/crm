"use client";
import { useState } from "react";
import { Clock } from "lucide-react";
import { Input } from "./input";

/** A keyboard time field. Accepts 9:30, 0930 or 9 and normalizes to HH:mm. */
export function normalizeTimeInput(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return "";
  let hours: string, minutes: string;
  if (/^\d{1,2}:\d{1,2}$/.test(raw)) [hours, minutes] = raw.split(":");
  else if (/^\d{3,4}$/.test(raw)) { hours = raw.slice(0, -2); minutes = raw.slice(-2); }
  else if (/^\d{1,2}$/.test(raw)) { hours = raw; minutes = "00"; }
  else return undefined;
  if (Number(hours) > 23 || Number(minutes) > 59) return undefined;
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}
export function TimeInput({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && normalizeTimeInput(value) === undefined;
  return <span className="space-y-1.5">
    <span className="relative block">
      <Clock aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
      <Input type="text" inputMode="numeric" aria-label="Время" aria-invalid={invalid || undefined} autoComplete="off"
        placeholder="ЧЧ:ММ" maxLength={5} value={value} disabled={disabled} className="pl-9 tabular-nums"
        onChange={(event) => onChange(event.target.value.replace(/[^\d:]/g, ""))}
        onBlur={() => { setTouched(true); const next = normalizeTimeInput(value); if (next !== undefined) onChange(next); }} />
    </span>
    {invalid && <span role="alert" className="block text-xs font-normal text-destructive">Введите время от 00:00 до 23:59</span>}
  </span>;
}
