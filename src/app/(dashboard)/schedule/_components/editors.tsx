"use client";
import { useId, useState } from "react";
import { shiftAssignee, assignmentFields } from "@/lib/schedule/types";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { EmployeePicker } from "./employee-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { ProfileSection } from "@/components/shared/profile-section";
import { PALETTE_COLORS, paletteBg, paletteText } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { shiftTemplateLabel } from "@/lib/schedule/types";
import { addDays, dateInZone, dayLabel, timeInZone } from "@/lib/schedule/utils";
import {
  MAX_TEMPLATE_VARIANTS,
  templateTimesFor,
  validateVariants,
  type TemplateVariant,
} from "@/lib/schedule/template-times";
import type {
  Checklist,
  ChecklistItem,
  ScheduleData,
  Shift,
  ShiftTemplate,
} from "@/lib/schedule/types";
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
export type Save = (action: string, input: unknown) => Promise<boolean>;
const empty = {
  name: "",
  color: "blue",
  start_time: "09:00",
  end_time: "17:00",
  department_id: null as string | null,
  role_id: null as string | null,
  checklist_ids: [] as string[],
};
function timingValue(v: typeof empty): typeof empty {
  return {
    name: v.name,
    color: v.color,
    start_time: v.start_time,
    end_time: v.end_time,
    department_id: v.department_id,
    role_id: v.role_id,
    checklist_ids: v.checklist_ids,
  };
}
function TimeRange({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (v: { start_time: string; end_time: string }) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Начало">
          <TimePicker
            clearable={false}
            value={start.slice(0, 5)}
            onChange={(v) => onChange({ start_time: v, end_time: end })}
          />
        </Field>
        <Field label="Окончание">
          <TimePicker
            clearable={false}
            value={end.slice(0, 5)}
            onChange={(v) => onChange({ start_time: start, end_time: v })}
          />
        </Field>
      </div>
      {end.slice(0, 5) <= start.slice(0, 5) && (
        <p className="text-xs text-muted-foreground">
          Окончание на следующий день
        </p>
      )}
    </div>
  );
}
function Timing({
  value,
  set,
  onTimeEdit,
}: {
  value: typeof empty;
  set: (v: typeof empty) => void;
  onTimeEdit?: () => void;
}) {
  return (
    <TimeRange
      start={value.start_time}
      end={value.end_time}
      onChange={(t) => {
        onTimeEdit?.();
        set({ ...value, ...t });
      }}
    />
  );
}
const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
/** ISO-день недели (1=ПН…7=ВС) для даты YYYY-MM-DD. */
export function isoWeekday(date: string) {
  return ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
}
/** «ПН–ПТ», «ПН, СР, ПТ», «СБ–ВС» — дни подряд сворачиваются в диапазон. */
export function formatDays(days: number[]) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const from = WEEKDAYS[sorted[i] - 1];
    const to = WEEKDAYS[sorted[j] - 1];
    parts.push(
      j - i >= 2
        ? `${from}–${to}`
        : sorted
            .slice(i, j + 1)
            .map((d) => WEEKDAYS[d - 1])
            .join(", "),
    );
    i = j + 1;
  }
  return parts.join(", ");
}
/** Время шаблона одной строкой: «09:00–17:00» или «ПН–ПТ 09:00–17:00 · СБ 10:00–18:00». */
export function formatTemplateTimes(t: ShiftTemplate) {
  const range = (v: { start_time: string; end_time: string }) =>
    `${v.start_time.slice(0, 5)}–${v.end_time.slice(0, 5)}`;
  if (!t.variants?.length) return range(t);
  return t.variants.map((v) => `${formatDays(v.days)} ${range(v)}`).join(" · ");
}
function Variants({
  variants,
  set,
}: {
  variants: TemplateVariant[];
  set: (v: TemplateVariant[]) => void;
}) {
  const used = new Set(variants.flatMap((v) => v.days));
  const free = ALL_DAYS.filter((d) => !used.has(d));
  const toggle = (index: number, day: number) =>
    set(
      variants.map((v, i) =>
        i === index
          ? {
              ...v,
              days: v.days.includes(day)
                ? v.days.filter((d) => d !== day)
                : [...v.days, day].sort((a, b) => a - b),
            }
          : // День может быть только в одном варианте — забираем его у соседа.
            { ...v, days: v.days.filter((d) => d !== day) },
      ),
    );
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium mb-2">Время по дням недели</legend>
      {variants.map((v, index) => (
        <div key={index} className="grid gap-3 border-b pb-3">
          <div className="flex items-center justify-between gap-2">
            <div
              role="group"
              aria-label={`Дни варианта ${index + 1}`}
              className="flex min-w-0 flex-wrap gap-1"
            >
              {WEEKDAYS.map((label, i) => {
                const day = i + 1;
                const on = v.days.includes(day);
                return (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => toggle(index, day)}
                    className="h-8 min-w-7 px-1 text-xs sm:min-w-9 sm:px-2"
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Удалить вариант ${index + 1}`}
              disabled={variants.length === 1}
              onClick={() => set(variants.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <TimeRange
            start={v.start_time}
            end={v.end_time}
            onChange={(t) =>
              set(variants.map((x, i) => (i === index ? { ...x, ...t } : x)))
            }
          />
        </div>
      ))}
      {free.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatDays(free)} — шаблон не работает
        </p>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={variants.length >= MAX_TEMPLATE_VARIANTS}
          onClick={() => {
            const last = variants[variants.length - 1];
            set([
              ...variants,
              {
                days: free,
                start_time: last?.start_time ?? "09:00",
                end_time: last?.end_time ?? "17:00",
              },
            ]);
          }}
        >
          <Plus className="size-4" />
          Добавить вариант
        </Button>
      </div>
    </fieldset>
  );
}
function ShiftRoleField<T extends Pick<typeof empty, "department_id" | "role_id">>({
  data,
  value,
  set,
}: {
  data: ScheduleData;
  value: T;
  set: (v: T) => void;
}) {
  const hintId = useId();
  const role = data.roles.find((item) => item.id === value.role_id);
  const department = data.departments.find((item) => item.id === role?.department_id);
  return (
    <div className="space-y-2">
      <Field label="Должность на смене">
        <OptionSelect
          aria-label="Должность на смене"
          aria-describedby={hintId}
          value={value.role_id ?? ""}
          onValueChange={(id) => {
            const selected = data.roles.find((item) => item.id === id);
            set({
              ...value,
              role_id: selected?.id ?? null,
              department_id: selected?.department_id ?? null,
            });
          }}
          options={[
            { value: "", label: "Без должности на смене" },
            ...data.roles.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </Field>
      <p id={hintId} className="text-xs text-muted-foreground">
        {department
          ? `Подразделение — «${department.name}». `
          : "Подразделение подставляется из выбранной должности. "}
        Можно назначить любого свободного сотрудника заведения.
        {department && (
          <span className="mt-1 block">
            В своём подразделении сотрудник получает свою ставку. Для подмены из другого
            подразделения действует ставка должности на смене.
          </span>
        )}
      </p>
    </div>
  );
}
function Colors({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium mb-2">Цвет смены</legend>
      <div className="flex flex-wrap gap-1 sm:gap-2">
        {PALETTE_COLORS.filter(
          (c) => !["default", "brown"].includes(c.name),
        ).map((c) => (
          <button
            key={c.name}
            type="button"
            aria-label={c.label}
            aria-pressed={c.name === value}
            onClick={() => onChange(c.name)}
            className={cn(
              "size-8 rounded-full border-2 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-ring",
              paletteBg(c.name),
              paletteText(c.name),
              value === c.name ? "border-foreground" : "border-transparent",
            )}
          >
            {value === c.name ? "✓" : ""}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ShiftEditor({
  data,
  shift,
  day,
  userId,
  template,
  templateSlot = false,
  copy,
  onClose,
  save,
}: {
  data: ScheduleData;
  shift?: Shift;
  day: string;
  userId?: string | null;
  template?: ShiftTemplate;
  templateSlot?: boolean;
  copy?: boolean;
  onClose: () => void;
  save: Save;
}) {
  const canAssign = data.permissions.includes("schedule.shift_assign");
  // Новая смена из шаблона: время — из варианта на день недели даты начала.
  const seed = template
    ? {
        ...timingValue(template),
        ...(templateTimesFor(template, isoWeekday(day)) ?? {}),
      }
    : empty;
  const [value, set] = useState({
    ...seed,
    name: shift?.title ?? template?.name ?? "Смена",
    color: shift?.color ?? seed.color,
    start_time: shift
      ? timeInZone(shift.starts_at, data.timezone)
      : seed.start_time,
    end_time: shift ? timeInZone(shift.ends_at, data.timezone) : seed.end_time,
    department_id: shift?.department_id ?? seed.department_id,
    role_id: shift?.role_id ?? seed.role_id,
    checklist_ids: shift?.checklist_ids ?? seed.checklist_ids,
  });
  const [date, setDate] = useState(
    shift
      ? copy
        ? addDays(dateInZone(shift.starts_at, data.timezone), 1)
        : dateInZone(shift.starts_at, data.timezone)
      : day,
  );
  const [who, setWho] = useState(
    shift && !copy
      ? shiftAssignee(shift)
      : canAssign
        ? shift
          ? shiftAssignee(shift)
          : (userId ?? null)
        : null,
  );
  const [casualName, setCasualName] = useState("");
  const [payModel, setPayModel] = useState(shift?.payroll_model_id ?? "");
  const casual = who === "new-casual" || !!who?.startsWith("payroll:");
  const casualEmployee = data.casualEmployees?.find(
    (e) => `payroll:${e.id}` === who,
  );
  const candidatePayModel = payModel || casualEmployee?.model_id || "";
  const [note, setNote] = useState(shift?.note ?? "");
  const [templateId, setTemplateId] = useState(
    shift?.template_id ?? template?.id ?? null,
  );
  const chosen = data.templates.find((t) => t.id === templateId);
  const chosenTimes = chosen
    ? templateTimesFor(chosen, isoWeekday(date))
    : null;
  // Смена по шаблону берёт из шаблона название, цвет, должность и время на
  // день недели даты. Если что-то нужно поменять — это уже своя смена.
  const templateValue = chosen
    ? {
        ...value,
        name: chosen.name,
        color: chosen.color,
        role_id: chosen.role_id,
        department_id: chosen.department_id,
        ...(chosenTimes ?? {}),
      }
    : value;
  const hhmm = (t: string) => t.slice(0, 5);
  // Существующая смена по шаблону, у которой сейчас свои значения.
  const deviation = shift && chosen && shift.template_id === chosen.id
    ? [
        hhmm(value.start_time) !== hhmm(templateValue.start_time) ||
        hhmm(value.end_time) !== hhmm(templateValue.end_time)
          ? `время ${hhmm(value.start_time)}–${hhmm(value.end_time)}`
          : null,
        value.role_id !== templateValue.role_id
          ? `должность «${data.roles.find((r) => r.id === value.role_id)?.name ?? "без должности"}»`
          : null,
        value.name !== chosen.name && value.name !== shiftTemplateLabel(chosen)
          ? `название «${value.name}»`
          : null,
      ].filter(Boolean)
    : [];
  const detachFromTemplate = () => {
    // Своя смена стартует с текущих значений шаблона.
    if (deviation.length === 0) set(templateValue);
    setTemplateId(null);
  };
  const selectedPayModel = data.payModels?.some(
    (model) =>
      model.id === candidatePayModel &&
      model.role_name ===
        data.roles.find((role) => role.id === templateValue.role_id)?.name,
  )
    ? candidatePayModel
    : "";
  const [busy, setBusy] = useState(false);
  const started = shift && data.runs.some((r) => r.shift_id === shift.id);
  const unavailable = new Set(templateSlot
    ? data.shifts.filter((item) => item.id !== shift?.id &&
        dateInZone(item.starts_at, data.timezone) === date).map(shiftAssignee)
    : []);
  const selectedEmployee = assignmentFields(who === "new-casual" ? null : who);
  const payrollModelId = casual ? selectedPayModel || null : null;
  const commit = async () => {
    setBusy(true);
    const assignment = { ...selectedEmployee, payroll_model_id: payrollModelId };
    const saved = templateSlot
      ? shift
        ? await save("shift.assign", { ...assignment, id: shift.id, version: shift.version })
        : await save("shift.create_template_slot", {
            ...assignment, date, template_id: template?.id, template_version: template?.version,
          })
      : await save(copy ? "shift.copy" : shift ? "shift.edit" : "shift.create", {
          ...templateValue,
          title: templateValue.name,
          date,
          ...assignment,
          casual_name: who === "new-casual" ? casualName.trim() : "",
          checklist_ids: casual ? [] : value.checklist_ids,
          note,
          template_id: templateId,
          ...(shift ? { id: shift.id, version: shift.version } : {}),
        });
    if (saved) onClose();
    setBusy(false);
  };
  const employeeFields = (
    <>
      <Field label="Сотрудник">
        <EmployeePicker
          data={data}
          disabled={!canAssign}
          value={who}
          onChange={(next) => {
            setWho(next);
            setPayModel("");
          }}
          unavailable={unavailable}
          emptyLabel={templateSlot ? undefined : "Открытая смена, без сотрудника"}
          includeCasual={!templateSlot || data.permissions.includes("payroll.configure")}
          allowNewCasual={!templateSlot && canAssign && data.permissions.includes("payroll.configure")}
        />
      </Field>
      {casual && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
          {who === "new-casual" && (
            <Field label="Имя и фамилия">
              <Input
                value={casualName}
                maxLength={160}
                placeholder="Например, Полина Вознесенская"
                onChange={(e) => setCasualName(e.target.value)}
              />
            </Field>
          )}
          <Field label="Модель оплаты этой смены">
            <OptionSelect
              aria-label="Модель оплаты этой смены"
              placeholder="Выберите модель"
              value={selectedPayModel}
              onValueChange={setPayModel}
              options={(data.payModels ?? [])
                .filter(
                  (m) =>
                    m.role_name ===
                    data.roles.find((r) => r.id === templateValue.role_id)?.name,
                )
                .map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Без аккаунта. Опубликованная смена учитывается в зарплате после
            окончания, без отметки Quick Resto.
          </p>
        </div>
      )}
    </>
  );
  return (
    <EditDrawer
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      title={
        templateSlot ? "Назначить сотрудника" : copy
          ? "Копировать смену"
          : shift
            ? "Редактирование смены"
            : "Новая смена"
      }
      description={templateSlot
        ? `${chosen && chosen.name === value.name ? shiftTemplateLabel(chosen) : value.name} · ${dayLabel(date)} · ${value.start_time.slice(0, 5)}–${value.end_time.slice(0, 5)}`
        : shift?.published && !copy ? "Смена опубликована — изменения сразу увидит сотрудник" : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            disabled={
              busy ||
              (!templateSlot && !!chosen && !chosenTimes) ||
              (templateSlot && (!who || unavailable.has(who))) ||
              (casual &&
                (!selectedPayModel ||
                  !templateValue.role_id ||
                  (who === "new-casual" && !casualName.trim())))
            }
            onClick={commit}
          >
            {busy
              ? "Сохранение…"
              : templateSlot ? (shift ? "Назначить" : "Назначить в черновик")
              : copy
                ? "Создать копию"
                : shift
                  ? "Сохранить изменения"
                  : "Создать черновик"}
          </Button>
        </>
      }
    >
      {templateSlot ? employeeFields : (
        <>
          {started && !copy && (
            <p className="text-sm text-muted-foreground">
              Отчёт смены уже начат. Время, должность и сотрудника менять нельзя.
            </p>
          )}
          <Field label="Шаблон">
            <OptionSelect
              aria-label="Шаблон"
              disabled={!!started && !copy}
              value={templateId ?? ""}
              onValueChange={(id) => {
                const t = data.templates.find((t) => t.id === id);
                setTemplateId(t?.id ?? null);
                if (t) set({ ...value, ...timingValue(t), name: t.name });
              }}
              options={[
                { value: "", label: "Своя смена — время и должность вручную" },
                ...data.templates
                  .filter(
                    (t) =>
                      t.id === templateId ||
                      (!t.archived && templateTimesFor(t, isoWeekday(date)) !== null),
                  )
                  .map((t) => ({ value: t.id, label: shiftTemplateLabel(t) })),
              ]}
            />
          </Field>
          {chosen ? (
            <div className="-mt-2 rounded-lg border bg-muted/30 p-3.5 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <span className={cn("size-2.5 shrink-0 rounded-full", paletteBg(chosen.color))} />
                {shiftTemplateLabel(chosen)}
              </div>
              <p className="mt-1 text-muted-foreground">
                {chosenTimes ? (
                  <span className="tabular-nums">
                    {hhmm(chosenTimes.start_time)}–{hhmm(chosenTimes.end_time)}
                  </span>
                ) : (
                  <span className="text-destructive">Шаблон не работает в этот день недели</span>
                )}
                {" · "}
                {data.roles.find((r) => r.id === chosen.role_id)?.name ?? "без должности"}
              </p>
              {deviation.length > 0 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Сейчас у смены {deviation.join(", ")}. При сохранении она станет как в шаблоне.
                </p>
              )}
              {!(started && !copy) && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mt-1.5 h-auto p-0 text-xs"
                  onClick={detachFromTemplate}
                >
                  {deviation.length > 0
                    ? "Оставить свои значения — сделать своей сменой"
                    : "Изменить время или должность — сделать своей сменой"}
                </Button>
              )}
            </div>
          ) : (
            <Field label="Название">
              <Input
                value={value.name}
                maxLength={160}
                placeholder="Например, Инвентаризация или Банкет"
                onChange={(e) => set({ ...value, name: e.target.value })}
              />
            </Field>
          )}
          <Field label="Дата">
            <DatePicker
              clearable={false}
              value={date}
              onChange={(next) => next && setDate(next)}
              disabled={!!started && !copy}
            />
          </Field>
          <fieldset disabled={!!started && !copy} className="grid gap-5">
            {!chosen && (
              <>
                <Timing value={value} set={set} />
                <ShiftRoleField data={data} value={value} set={set} />
              </>
            )}
            {employeeFields}
          </fieldset>
          {!chosen && (
            <Colors
              value={value.color}
              onChange={(color) => set({ ...value, color })}
            />
          )}
          <Field label="Заметка">
            <Textarea
              value={note}
              maxLength={5000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </>
      )}
    </EditDrawer>
  );
}
export function TemplateEditor({
  data,
  template,
  copy,
  onClose,
  save,
}: {
  data: ScheduleData;
  template?: ShiftTemplate;
  copy?: boolean;
  onClose: () => void;
  save: Save;
}) {
  const [value, set] = useState(
    template
      ? { ...template, name: template.name + (copy ? " (копия)" : "") }
      : { ...empty, subtitle: "" },
  );
  // Шаблон без вариантов показываем одним вариантом на все дни.
  const [variants, setVariants] = useState<TemplateVariant[]>(
    template?.variants?.length
      ? template.variants
      : [
          {
            days: ALL_DAYS,
            start_time: (template ?? empty).start_time,
            end_time: (template ?? empty).end_time,
          },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    const problem = validateVariants(variants);
    setError(problem);
    if (problem) return;
    // Один вариант на все дни — обычный шаблон без вариантов.
    const everyDay =
      variants.length === 1 &&
      ALL_DAYS.every((d) => variants[0].days.includes(d));
    setBusy(true);
    if (
      await save(
        copy ? "template.copy" : template ? "template.edit" : "template.create",
        {
          ...value,
          start_time: variants[0].start_time,
          end_time: variants[0].end_time,
          variants: everyDay ? [] : variants,
          ...(template ? { id: template.id, version: template.version } : {}),
        },
      )
    )
      onClose();
    setBusy(false);
  };
  return (
    <EditDrawer
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      title={
        copy
          ? "Копировать шаблон"
          : template
            ? "Редактирование шаблона"
            : "Новый шаблон"
      }
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={commit}>
            {busy ? "Сохранение…" : "Сохранить шаблон"}
          </Button>
        </>
      }
    >
      <ProfileSection title="Основное">
        <Field label="Название">
          <Input
            maxLength={160}
            value={value.name}
            onChange={(e) => set({ ...value, name: e.target.value })}
          />
        </Field>
        <Field label="Подзаголовок">
          <Input
            maxLength={80}
            value={value.subtitle}
            placeholder="Например, вечер или полная смена"
            onChange={(e) => set({ ...value, subtitle: e.target.value })}
          />
        </Field>
        <Colors
          value={value.color}
          onChange={(color) => set({ ...value, color })}
        />
      </ProfileSection>
      <ProfileSection title="Расписание">
        <Variants
          variants={variants}
          set={(next) => {
            setVariants(next);
            setError(null);
          }}
        />
          {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}
      </ProfileSection>
      <ProfileSection title="Назначение">
        <ShiftRoleField data={data} value={value} set={set} />
      </ProfileSection>
    </EditDrawer>
  );
}
function newItem(parent_id: string | null = null): ChecklistItem {
  return {
    id: crypto.randomUUID(),
    title: "",
    hint: "",
    kind: "check",
    required: true,
    parent_id,
    min: null,
    max: null,
    unit: "",
    max_length: 500,
  };
}
export function ChecklistEditor({
  data,
  checklist,
  onClose,
  save,
}: {
  data: ScheduleData;
  checklist?: Checklist;
  onClose: () => void;
  save: Save;
}) {
  const [value, set] = useState(
    checklist ?? {
      name: "",
      description: "",
      kind: "opening",
      department_id: null as string | null,
      duration: 15,
      priority: "medium",
      items: [] as ChecklistItem[],
    },
  );
  const [busy, setBusy] = useState(false);
  const update = (id: string, patch: Partial<ChecklistItem>) =>
    set({
      ...value,
      items: value.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  const move = (index: number, delta: number) => {
    const a = [...value.items];
    const target = index + delta;
    if (target < 0 || target >= a.length) return;
    [a[index], a[target]] = [a[target], a[index]];
    set({ ...value, items: a });
  };
  const commit = async () => {
    setBusy(true);
    if (
      await save(checklist ? "checklist.edit" : "checklist.create", {
        ...value,
        ...(checklist ? { id: checklist.id, version: checklist.version } : {}),
      })
    )
      onClose();
    setBusy(false);
  };
  return (
    <EditDrawer
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      title={checklist ? "Редактирование чек-листа" : "Новый чек-лист"}
      description="После изменения чек-лист нужно опубликовать. Начатые выполнения сохранят прежнюю версию."
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={commit}>
            {busy ? "Сохранение…" : "Сохранить черновик"}
          </Button>
        </>
      }
    >
      <Field label="Название">
        <Input
          value={value.name}
          maxLength={160}
          onChange={(e) => set({ ...value, name: e.target.value })}
        />
      </Field>
      <Field label="Описание">
        <Textarea
          value={value.description}
          onChange={(e) => set({ ...value, description: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Тип">
          <OptionSelect
            aria-label="Тип"
            value={value.kind}
            onValueChange={(kind) => set({ ...value, kind })}
            options={[
              { value: "opening", label: "Открытие" },
              { value: "closing", label: "Закрытие" },
              { value: "other", label: "Другой" },
            ]}
          />
        </Field>
        <Field label="Длительность, мин">
          <Input
            type="number"
            min={0}
            max={1440}
            value={value.duration}
            onChange={(e) =>
              set({ ...value, duration: Number(e.target.value) })
            }
          />
        </Field>
      </div>
      <Field label="Подразделение">
        <OptionSelect
          aria-label="Подразделение"
          value={value.department_id ?? ""}
          onValueChange={(id) => set({ ...value, department_id: id || null })}
          options={[
            { value: "", label: "Все подразделения" },
            ...data.departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </Field>
      <Field label="Приоритет">
        <OptionSelect
          aria-label="Приоритет"
          value={value.priority}
          onValueChange={(priority) => set({ ...value, priority })}
          options={[
            { value: "low", label: "Низкий" },
            { value: "medium", label: "Средний" },
            { value: "high", label: "Высокий" },
          ]}
        />
      </Field>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">
          Пункты · {value.items.length}
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => set({ ...value, items: [...value.items, newItem()] })}
        >
          <Plus className="size-4 mr-2" />
          Добавить пункт
        </Button>
      </div>
      {!value.items.length && (
        <p className="text-sm text-muted-foreground">
          Добавьте задачи, которые сотрудник выполнит во время смены.
        </p>
      )}
      {value.items.map((i, index) => (
        <div
          key={i.id}
          className={cn("grid gap-3 border-b pb-5", i.parent_id && "ml-5")}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{index + 1}</span>
            <Input
              aria-label={`Название пункта ${index + 1}`}
              value={i.title}
              placeholder="Что нужно сделать"
              onChange={(e) => update(i.id, { title: e.target.value })}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Поднять пункт"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Опустить пункт"
              disabled={index === value.items.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Удалить пункт"
              onClick={() =>
                set({
                  ...value,
                  items: value.items.filter(
                    (p) => p.id !== i.id && p.parent_id !== i.id,
                  ),
                })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <OptionSelect
              aria-label="Тип пункта"
              value={i.kind}
              onValueChange={(kind) =>
                update(i.id, { kind: kind as ChecklistItem["kind"] })
              }
              options={[
                { value: "check", label: "Чекбокс" },
                { value: "photo", label: "Фотография" },
                { value: "number", label: "Число" },
                { value: "text", label: "Текст" },
                { value: "info", label: "Информация" },
              ]}
            />
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={i.required}
                disabled={i.kind === "info"}
                onCheckedChange={(checked) => update(i.id, { required: checked === true })}
              />
              Обязательный пункт
            </label>
          </div>
          <Input
            aria-label="Подсказка"
            value={i.hint}
            placeholder="Подсказка сотруднику"
            onChange={(e) => update(i.id, { hint: e.target.value })}
          />
          {i.kind === "number" && (
            <div className="grid grid-cols-3 gap-2">
              <Input
                aria-label="Минимум"
                type="number"
                value={i.min ?? ""}
                placeholder="Минимум"
                onChange={(e) =>
                  update(i.id, {
                    min: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <Input
                aria-label="Максимум"
                type="number"
                value={i.max ?? ""}
                placeholder="Максимум"
                onChange={(e) =>
                  update(i.id, {
                    max: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <Input
                aria-label="Единица измерения"
                value={i.unit}
                placeholder="°C, ₽…"
                onChange={(e) => update(i.id, { unit: e.target.value })}
              />
            </div>
          )}
          {i.kind === "text" && (
            <Field label="Лимит символов">
              <Input
                type="number"
                min={1}
                max={10000}
                value={i.max_length}
                onChange={(e) =>
                  update(i.id, { max_length: Number(e.target.value) })
                }
              />
            </Field>
          )}
          {!i.parent_id && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                const a = [...value.items];
                a.splice(index + 1, 0, newItem(i.id));
                set({ ...value, items: a });
              }}
            >
              Добавить подпункт
            </Button>
          )}
        </div>
      ))}
    </EditDrawer>
  );
}
