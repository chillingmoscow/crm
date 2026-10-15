"use client";
import { useState } from "react";
import { shiftAssignee, assignmentFields } from "@/lib/schedule/types";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { PALETTE_COLORS, paletteBg, paletteText } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { addDays, dateInZone, timeInZone } from "@/lib/schedule/utils";
import type {
  Checklist,
  ChecklistItem,
  ScheduleData,
  Shift,
  ShiftTemplate,
} from "@/lib/schedule/types";
export const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
  break_minutes: 0,
  arrival_minutes: 0,
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
    break_minutes: v.break_minutes,
    arrival_minutes: v.arrival_minutes,
    department_id: v.department_id,
    role_id: v.role_id,
    checklist_ids: v.checklist_ids,
  };
}
function Timing({
  value,
  set,
}: {
  value: typeof empty;
  set: (v: typeof empty) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Начало">
          <Input
            aria-label="Начало"
            type="time"
            required
            value={value.start_time.slice(0, 5)}
            onChange={(e) => set({ ...value, start_time: e.target.value })}
          />
        </Field>
        <Field label="Окончание">
          <Input
            aria-label="Окончание"
            type="time"
            required
            value={value.end_time.slice(0, 5)}
            onChange={(e) => set({ ...value, end_time: e.target.value })}
          />
        </Field>
      </div>
      {value.end_time <= value.start_time && (
        <p className="text-xs text-muted-foreground">
          Окончание на следующий день
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Перерыв, мин">
          <Input
            type="number"
            min={0}
            max={1439}
            value={value.break_minutes}
            onChange={(e) =>
              set({ ...value, break_minutes: Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Прийти раньше, мин">
          <Input
            type="number"
            min={0}
            max={240}
            value={value.arrival_minutes}
            onChange={(e) =>
              set({ ...value, arrival_minutes: Number(e.target.value) })
            }
          />
        </Field>
      </div>
    </>
  );
}
function Assignments({
  data,
  value,
  set,
}: {
  data: ScheduleData;
  value: typeof empty;
  set: (v: typeof empty) => void;
}) {
  return (
    <>
      <Field label="Подразделение">
        <select
          className={selectClass}
          value={value.department_id ?? ""}
          onChange={(e) =>
            set({
              ...value,
              department_id: e.target.value || null,
              role_id: null,
            })
          }
        >
          <option value="">Без подразделения</option>
          {data.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Позиция">
        <select
          className={selectClass}
          value={value.role_id ?? ""}
          onChange={(e) => set({ ...value, role_id: e.target.value || null })}
        >
          <option value="">Без позиции</option>
          {data.roles
            .filter((r) => r.department_id === value.department_id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
      </Field>
    </>
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
      <div className="flex gap-2">
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
function ChecklistSelection({
  data,
  ids,
  set,
}: {
  data: ScheduleData;
  ids: string[];
  set: (a: string[]) => void;
}) {
  const available = data.checklists.filter(
    (c) => (!!c.published_snapshot && !c.archived) || ids.includes(c.id),
  );
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium mb-2">Чек-листы смены</legend>
      {available.length ? (
        available.map((c) => (
          <label key={c.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(c.id)}
              onChange={(e) =>
                set(
                  e.target.checked
                    ? [...ids, c.id]
                    : ids.filter((id) => id !== c.id),
                )
              }
            />
            <span>
              {c.name}
              {!c.published && (
                <span className="text-destructive"> · есть черновик</span>
              )}
            </span>
          </label>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          Сначала создайте и опубликуйте чек-лист во вкладке «Чек-листы».
        </p>
      )}
    </fieldset>
  );
}
export function ShiftEditor({
  data,
  shift,
  day,
  userId,
  template,
  copy,
  onClose,
  save,
}: {
  data: ScheduleData;
  shift?: Shift;
  day: string;
  userId?: string | null;
  template?: ShiftTemplate;
  copy?: boolean;
  onClose: () => void;
  save: Save;
}) {
  const canAssign = data.permissions.includes("schedule.shift_assign");
  const seed = template ? timingValue(template) : empty;
  const [value, set] = useState({
    ...seed,
    name: shift?.title ?? template?.name ?? "Смена",
    color: shift?.color ?? seed.color,
    start_time: shift
      ? timeInZone(shift.starts_at, data.timezone)
      : seed.start_time,
    end_time: shift ? timeInZone(shift.ends_at, data.timezone) : seed.end_time,
    break_minutes: shift?.break_minutes ?? seed.break_minutes,
    arrival_minutes: shift?.arrival_minutes ?? seed.arrival_minutes,
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
  const selectedPayModel = payModel || casualEmployee?.model_id || "";
  const [note, setNote] = useState(shift?.note ?? "");
  const [templateId, setTemplateId] = useState(
    shift?.template_id ?? template?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const started = shift && data.runs.some((r) => r.shift_id === shift.id);
  const commit = async () => {
    setBusy(true);
    if (
      await save(copy ? "shift.copy" : shift ? "shift.edit" : "shift.create", {
        ...value,
        title: value.name,
        date,
        ...assignmentFields(who === "new-casual" ? null : who),
        payroll_model_id: casual ? selectedPayModel || null : null,
        casual_name: who === "new-casual" ? casualName.trim() : "",
        checklist_ids: casual ? [] : value.checklist_ids,
        note,
        template_id: templateId,
        ...(shift ? { id: shift.id, version: shift.version } : {}),
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
      title={
        copy
          ? "Копировать смену"
          : shift
            ? "Редактирование смены"
            : "Новая смена"
      }
      description={`${data.timezone}${shift?.published ? " · Опубликована, изменения будут видны сотруднику" : ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            disabled={
              busy ||
              (casual &&
                (!selectedPayModel ||
                  !value.role_id ||
                  (who === "new-casual" && !casualName.trim())))
            }
            onClick={commit}
          >
            {busy
              ? "Сохранение…"
              : copy
                ? "Создать копию"
                : shift
                  ? "Сохранить изменения"
                  : "Создать черновик"}
          </Button>
        </>
      }
    >
      {started && !copy && (
        <p className="text-sm text-muted-foreground">
          Чек-лист уже начат. Время, позицию, сотрудника и набор чек-листов
          менять нельзя.
        </p>
      )}
      <Field label="Шаблон">
        <select
          disabled={!!started && !copy}
          className={selectClass}
          value={templateId ?? ""}
          onChange={(e) => {
            const t = data.templates.find((t) => t.id === e.target.value);
            setTemplateId(t?.id ?? null);
            if (t) set(timingValue(t));
          }}
        >
          <option value="">Своя смена</option>
          {data.templates
            .filter((t) => !t.archived)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Название">
        <Input
          value={value.name}
          maxLength={160}
          onChange={(e) => set({ ...value, name: e.target.value })}
        />
      </Field>
      <Field label="Дата">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={!!started && !copy}
        />
      </Field>
      <fieldset disabled={!!started && !copy} className="grid gap-5">
        <Timing value={value} set={set} />
        <Assignments data={data} value={value} set={set} />
        <Field label="Сотрудник">
          <select
            className={selectClass}
            disabled={!canAssign}
            value={who ?? ""}
            onChange={(e) => {
              setWho(e.target.value || null);
              setPayModel("");
            }}
          >
            <option value="">Открытая смена, без сотрудника</option>
            {data.staff
              .filter(
                (s) =>
                  !value.role_id ||
                  s.role_id === value.role_id ||
                  data.qualifications.some(
                    (q) =>
                      q.user_id === s.user_id && q.role_id === value.role_id,
                  ),
              )
              .map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {[s.first_name, s.last_name].filter(Boolean).join(" ") ||
                    s.role_name}
                </option>
              ))}
            {(data.casualEmployees ?? [])
              .filter((e) => !value.role_id || e.role_id === value.role_id)
              .map((e) => (
                <option key={e.id} value={`payroll:${e.id}`}>
                  {e.name} · разовый
                </option>
              ))}
            {canAssign && data.permissions.includes("payroll.configure") && (
              <option value="new-casual">＋ Новый разовый сотрудник</option>
            )}
          </select>
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
              <select
                className={selectClass}
                value={selectedPayModel}
                onChange={(e) => setPayModel(e.target.value)}
              >
                <option value="">Выберите модель</option>
                {(data.payModels ?? [])
                  .filter(
                    (m) =>
                      m.role_name ===
                      data.roles.find((r) => r.id === value.role_id)?.name,
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </Field>
            <p className="text-xs text-muted-foreground">
              Без аккаунта. Опубликованная смена учитывается в зарплате после
              окончания, без отметки Quick Resto.
            </p>
          </div>
        )}
        {!casual && (
          <ChecklistSelection
            data={data}
            ids={value.checklist_ids}
            set={(ids) => set({ ...value, checklist_ids: ids })}
          />
        )}
      </fieldset>
      <Colors
        value={value.color}
        onChange={(color) => set({ ...value, color })}
      />
      <Field label="Заметка">
        <Textarea
          value={note}
          maxLength={5000}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
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
      : { ...empty },
  );
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    setBusy(true);
    if (
      await save(
        copy ? "template.copy" : template ? "template.edit" : "template.create",
        {
          ...value,
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
      <Field label="Название">
        <Input
          maxLength={160}
          value={value.name}
          onChange={(e) => set({ ...value, name: e.target.value })}
        />
      </Field>
      <Timing value={value} set={set} />
      <Assignments data={data} value={value} set={set} />
      <Colors
        value={value.color}
        onChange={(color) => set({ ...value, color })}
      />
      <ChecklistSelection
        data={data}
        ids={value.checklist_ids}
        set={(checklist_ids) => set({ ...value, checklist_ids })}
      />
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
          <select
            className={selectClass}
            value={value.kind}
            onChange={(e) => set({ ...value, kind: e.target.value })}
          >
            <option value="opening">Открытие</option>
            <option value="closing">Закрытие</option>
            <option value="other">Другой</option>
          </select>
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
        <select
          className={selectClass}
          value={value.department_id ?? ""}
          onChange={(e) =>
            set({ ...value, department_id: e.target.value || null })
          }
        >
          <option value="">Все подразделения</option>
          {data.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Приоритет">
        <select
          className={selectClass}
          value={value.priority}
          onChange={(e) => set({ ...value, priority: e.target.value })}
        >
          <option value="low">Низкий</option>
          <option value="medium">Средний</option>
          <option value="high">Высокий</option>
        </select>
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
            <select
              aria-label="Тип пункта"
              className={selectClass}
              value={i.kind}
              onChange={(e) =>
                update(i.id, { kind: e.target.value as ChecklistItem["kind"] })
              }
            >
              <option value="check">Чекбокс</option>
              <option value="photo">Фотография</option>
              <option value="number">Число</option>
              <option value="text">Текст</option>
              <option value="info">Информация</option>
            </select>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={i.required}
                disabled={i.kind === "info"}
                onChange={(e) => update(i.id, { required: e.target.checked })}
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
