"use client";

import { DatePicker } from "@/components/ui/date-picker";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import {
  LAST_DAY_OF_MONTH,
  WEEKDAY_LABELS,
  describeSchedule,
} from "@/lib/finance/recurring-schedule";
import type { RecurringSchedule } from "@/types/finance";

export type ScheduleFieldsValue = {
  schedule: RecurringSchedule;
  starts_on: string;
  ends_on: string | null;
};

const FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Каждый месяц" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "quarterly", label: "Каждый квартал" },
];

const DAY_OPTIONS = [
  ...Array.from({ length: LAST_DAY_OF_MONTH - 1 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  })),
  { value: String(LAST_DAY_OF_MONTH), label: "Последний день" },
];

const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, i) => ({ value: String(i + 1), label }));

const QUARTER_MONTH_OPTIONS = [
  { value: "1", label: "Первый месяц" },
  { value: "2", label: "Второй месяц" },
  { value: "3", label: "Третий месяц" },
];

export function ScheduleFields({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: ScheduleFieldsValue;
  onChange: (next: ScheduleFieldsValue) => void;
  disabled?: boolean;
  errors?: { starts_on?: string; ends_on?: string };
}) {
  const { schedule } = value;
  const setSchedule = (next: RecurringSchedule) => onChange({ ...value, schedule: next });

  const changeFrequency = (frequency: string) => {
    if (frequency === schedule.frequency) return;
    const day = schedule.frequency === "weekly" ? 1 : schedule.dayOfMonth;
    if (frequency === "weekly") setSchedule({ frequency: "weekly", weekday: 1 });
    else if (frequency === "quarterly")
      setSchedule({ frequency: "quarterly", dayOfMonth: day, quarterMonth: 1 });
    else setSchedule({ frequency: "monthly", dayOfMonth: day });
  };

  return (
    <DrawerSection title="Расписание" description={describeSchedule(schedule)}>
      <Field label="Как часто" required>
        {(control) => (
          <OptionSelect
            {...control}
            value={schedule.frequency}
            onValueChange={changeFrequency}
            options={FREQUENCY_OPTIONS}
            disabled={disabled}
          />
        )}
      </Field>

      {schedule.frequency === "weekly" ? (
        <Field label="День недели" required>
          {(control) => (
            <OptionSelect
              {...control}
              value={String(schedule.weekday)}
              onValueChange={(v) => setSchedule({ frequency: "weekly", weekday: Number(v) })}
              options={WEEKDAY_OPTIONS}
              disabled={disabled}
            />
          )}
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {schedule.frequency === "quarterly" && (
            <Field label="Месяц квартала" required>
              {(control) => (
                <OptionSelect
                  {...control}
                  value={String(schedule.quarterMonth)}
                  onValueChange={(v) =>
                    setSchedule({ ...schedule, quarterMonth: Number(v) as 1 | 2 | 3 })
                  }
                  options={QUARTER_MONTH_OPTIONS}
                  disabled={disabled}
                />
              )}
            </Field>
          )}
          <Field label="Число месяца" required>
            {(control) => (
              <OptionSelect
                {...control}
                value={String(schedule.dayOfMonth)}
                onValueChange={(v) => setSchedule({ ...schedule, dayOfMonth: Number(v) })}
                options={DAY_OPTIONS}
                disabled={disabled}
              />
            )}
          </Field>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Начало" required error={errors?.starts_on}>
          {(control) => (
            <DatePicker
              {...control}
              value={value.starts_on}
              onChange={(starts_on) => onChange({ ...value, starts_on })}
              placeholder="Выберите дату"
              disabled={disabled}
            />
          )}
        </Field>
        <Field label="Окончание" error={errors?.ends_on}>
          {(control) => (
            <DatePicker
              {...control}
              value={value.ends_on ?? ""}
              onChange={(ends_on) => onChange({ ...value, ends_on: ends_on || null })}
              placeholder="Без окончания"
              disabled={disabled}
              clearable
            />
          )}
        </Field>
      </div>
    </DrawerSection>
  );
}
