"use client";

import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { DAYS_OF_WEEK, type DayKey } from "@/lib/constants";
import type { WorkingHours } from "@/types/database";

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: { open: "10:00", close: "22:00", closed: false },
  tue: { open: "10:00", close: "22:00", closed: false },
  wed: { open: "10:00", close: "22:00", closed: false },
  thu: { open: "10:00", close: "22:00", closed: false },
  fri: { open: "10:00", close: "23:00", closed: false },
  sat: { open: "11:00", close: "23:00", closed: false },
  sun: { open: "11:00", close: "22:00", closed: false },
};

const FULL_DAY: Record<DayKey, string> = {
  mon: "понедельник",
  tue: "вторник",
  wed: "среда",
  thu: "четверг",
  fri: "пятница",
  sat: "суббота",
  sun: "воскресенье",
};

/** Сравнение графиков без учёта порядка ключей — для «есть изменения». */
export function sameWorkingHours(a: WorkingHours, b: WorkingHours): boolean {
  return DAYS_OF_WEEK.every(({ key }) => {
    const x = a[key];
    const y = b[key];
    return (
      (x?.closed ?? false) === (y?.closed ?? false) &&
      (x?.open ?? "") === (y?.open ?? "") &&
      (x?.close ?? "") === (y?.close ?? "")
    );
  });
}

/**
 * Часы работы по дням: переключатель «работает» и интервал. Одна разметка
 * для панели создания и карточки заведения.
 */
export function WorkingHoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: WorkingHours;
  onChange: (next: WorkingHours) => void;
  disabled?: boolean;
}) {
  const setDay = (day: DayKey, patch: Partial<NonNullable<WorkingHours[DayKey]>>) =>
    onChange({
      ...value,
      [day]: {
        open: value[day]?.open ?? "10:00",
        close: value[day]?.close ?? "22:00",
        closed: value[day]?.closed ?? false,
        ...patch,
      },
    });

  return (
    <ul className="flex flex-col gap-2">
      {DAYS_OF_WEEK.map(({ key, label }) => {
        const day = value[key];
        const closed = day?.closed ?? false;
        return (
          <li key={key} className="flex min-h-10 flex-wrap items-center gap-3">
            <span className="w-7 text-sm font-medium text-muted-foreground">{label}</span>
            <Switch
              checked={!closed}
              onCheckedChange={(on) => setDay(key, { closed: !on })}
              disabled={disabled}
              aria-label={`Рабочий день: ${FULL_DAY[key]}`}
            />
            {closed ? (
              <span className="text-sm text-muted-foreground">Выходной</span>
            ) : (
              <div className="flex items-center gap-2">
                <TimePicker
                  value={day?.open ?? "10:00"}
                  onChange={(v) => setDay(key, { open: v })}
                  disabled={disabled}
                  label={`Открытие, ${FULL_DAY[key]}`}
                  clearable={false}
                  className="h-9 w-28"
                />
                <span aria-hidden className="text-sm text-muted-foreground">
                  –
                </span>
                <TimePicker
                  value={day?.close ?? "22:00"}
                  onChange={(v) => setDay(key, { close: v })}
                  disabled={disabled}
                  label={`Закрытие, ${FULL_DAY[key]}`}
                  clearable={false}
                  className="h-9 w-28"
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
