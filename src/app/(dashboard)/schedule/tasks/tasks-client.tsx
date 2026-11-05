"use client";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { Plus, Settings2, ArrowLeft, Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Answer, ChecklistItem } from "@/lib/schedule/types";
import { addDays, dayLabel } from "@/lib/schedule/utils";
import {
  missingItems,
  taskStatus,
  type TaskData,
  type TaskDefinition,
  type TaskInput,
  type TaskOccurrence,
  type TaskPreview,
} from "@/lib/schedule/tasks";
import {
  loadTasks,
  saveTask,
  saveTaskSettings,
  taskRunCommand,
  uploadTaskPhoto,
  taskPhotoUrl,
  taskHistory,
  previewTasks,
  retryTaskMessage,
} from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const actionLabels: Record<string, string> = {
  "definition.created": "Создан шаблон задачи",
  "definition.updated": "Изменён шаблон задачи",
  "definition.save": "Изменён шаблон задачи",
  "assignment.created": "Создано задание",
  "assignment.changed": "Изменено назначение",
  "settings.save": "Изменены настройки",
  "run.save": "Сохранён отчёт",
  "run.submit": "Отчёт сдан",
  "run.approve": "Выполнение принято",
  "run.return": "Отчёт возвращён",
  "result.settled": "Результат учтён",
};
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {isValidElement<{ id?: string }>(children)
        ? cloneElement(children, { id })
        : children}
    </div>
  );
}
function Check({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
function newItem(kind: ChecklistItem["kind"] = "check"): ChecklistItem {
  return {
    id: crypto.randomUUID(),
    title: "",
    hint: "",
    kind,
    required: kind !== "info",
    parent_id: null,
    min: null,
    max: null,
    unit: "",
    max_length: 2000,
  };
}
function TaskScreen({
  title,
  description,
  onBack,
  actions,
  children,
  dirty = false,
  busy = false,
}: {
  title: string;
  description?: string;
  onBack: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  dirty?: boolean;
  busy?: boolean;
}) {
  const [confirmExit, setConfirmExit] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    if ((screen.current?.getBoundingClientRect().top ?? 0) < 0)
      screen.current?.scrollIntoView({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  return (
    <section ref={screen} className="w-full max-w-[1400px] space-y-6">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background py-3">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => (dirty ? setConfirmExit(true) : onBack())}
        >
          <ArrowLeft className="mr-2 size-4" />К задачам
        </Button>
        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
      <header className="max-w-3xl space-y-2">
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-balance text-2xl font-semibold tracking-tight outline-none"
        >
          {title}
        </h2>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </header>
      {children}
      <Dialog open={confirmExit} onOpenChange={setConfirmExit}>
        <DialogContent hideClose>
          <DialogHeader>
            <DialogTitle>Выйти без сохранения?</DialogTitle>
            <DialogDescription>
              Несохранённые изменения будут потеряны.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmExit(false)}>
              Продолжить редактирование
            </Button>
            <Button onClick={onBack}>Выйти без сохранения</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function TasksClient({
  initial,
  active = true,
}: {
  initial: TaskData;
  active?: boolean;
}) {
  const [data, setData] = useState(initial),
    [tab, setTab] = useState<"tasks" | "definitions">("tasks"),
    [date, setDate] = useState(initial.today),
    [pendingReview, setPendingReview] = useState(false),
    [mine, setMine] = useState(
      !initial.permissions.includes("schedule.view_all"),
    );
  const [editor, setEditor] = useState<TaskDefinition | "new" | null>(null),
    [run, setRun] = useState<TaskOccurrence | null>(null),
    [settings, setSettings] = useState(false),
    [preview, setPreview] = useState<TaskPreview[] | null>(null),
    [busy, setBusy] = useState(false);
  const wasActive = useRef(active);
  useEffect(() => {
    const returning = active && !wasActive.current;
    wasActive.current = active;
    if (!returning) return;
    let alive = true;
    loadTasks()
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => {
        if (alive) toast.error("Не удалось обновить задачи");
      });
    return () => {
      alive = false;
    };
  }, [active]);
  const manage = data.permissions.includes("schedule.checklist_edit"),
    create = data.permissions.includes("schedule.checklist_create"),
    canSettings =
      manage &&
      data.permissions.includes("payroll.configure") &&
      data.permissions.includes("payroll.review");
  const refresh = async () => {
    const next = await loadTasks();
    setData(next);
    return next;
  };
  const occurrences = data.occurrences.filter((o) =>
    pendingReview
      ? o.status === "submitted"
      : o.business_date === date && (!mine || o.user_id === data.userId),
  );
  async function showPreview() {
    setBusy(true);
    try {
      const r = await previewTasks(data.today, addDays(data.today, 14));
      if (r.error) toast.error(r.error);
      else setPreview(r.rows ?? []);
    } catch {
      toast.error("Не удалось получить расписание");
    } finally {
      setBusy(false);
    }
  }
  if (editor)
    return (
      <DefinitionEditor
        task={editor}
        data={data}
        editable={editor === "new" ? create : manage}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          await refresh();
          setEditor(null);
        }}
      />
    );
  if (run)
    return (
      <TaskRun
        key={run.id}
        occurrence={run}
        data={data}
        onClose={() => setRun(null)}
        onSaved={async () => {
          const next = await refresh();
          setRun(next.occurrences.find((o) => o.id === run.id) ?? null);
        }}
      />
    );
  if (settings)
    return (
      <SettingsEditor
        data={data}
        onClose={() => setSettings(false)}
        onRefresh={async () => {
          await refresh();
        }}
        onSaved={async () => {
          await refresh();
          setSettings(false);
        }}
      />
    );
  if (preview)
    return (
      <TaskScreen
        title="Расписание задач на две недели"
        description="Включая черновики. Предпросмотр не создаёт задания и начисления."
        onBack={() => setPreview(null)}
      >
        <div className="divide-y">
          {preview.length ? (
            preview.map((item, index) => (
              <div
                key={index}
                className="grid gap-2 py-4 md:grid-cols-[150px_minmax(0,1fr)_minmax(180px,1fr)]"
              >
                <p className="text-sm text-muted-foreground">
                  {dayLabel(item.business_date)}
                </p>
                <div>
                  <p className="font-medium">{item.snapshot.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {!item.snapshot.enabled ? "Черновик · " : ""}
                    {
                      data.templates.find(
                        (t) => t.id === item.snapshot.template_id,
                      )?.name
                    }
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.assignment_count === 0
                    ? "Нет опубликованной смены"
                    : item.assignment_count > 1
                      ? "Несколько подходящих смен"
                      : item.employee || "Сотрудник не сопоставлен"}
                </p>
              </div>
            ))
          ) : (
            <p className="py-10 text-sm text-muted-foreground">
              Нет задач на этот период
            </p>
          )}
        </div>
      </TaskScreen>
    );
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Задачи по сменам
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Чек-листы, фотоотчёты и выполнение по сменам
          </p>
        </div>
        <div className="flex gap-2">
          {canSettings && (
            <Button variant="outline" onClick={() => setSettings(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Настройки
            </Button>
          )}
          {create && (
            <Button onClick={() => setEditor("new")}>
              <Plus className="mr-2 h-4 w-4" />
              Новая задача
            </Button>
          )}
        </div>
      </header>
      {!data.settings?.enabled_from && manage && (
        <p className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Автоматическое назначение ещё не включено. Подготовьте шаблоны,
          проверьте расписание и выберите дату перехода в настройках.
        </p>
      )}
      <div className="flex gap-6 border-b">
        {(
          [
            ["tasks", "По дням"],
            ["definitions", "Шаблоны задач"],
          ] as const
        )
          .filter(([t]) => t === "tasks" || manage || create)
          .map(([t, label]) => (
            <button
              key={t}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "pb-3 text-sm",
                tab === t
                  ? "border-b-2 border-primary font-medium"
                  : "text-muted-foreground",
              )}
            >
              {label}
              {t === "definitions" && ` · ${data.definitions.length}`}
            </button>
          ))}
      </div>
      {tab === "tasks" ? (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <Input
              type="date"
              className="w-44"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={data.occurrences.reduce(
                (min, o) => (o.business_date < min ? o.business_date : min),
                addDays(data.today, -31),
              )}
              disabled={pendingReview}
              max={addDays(data.today, 14)}
            />
            {data.permissions.includes("schedule.review") && (
              <Check checked={pendingReview} onChange={setPendingReview}>
                Ожидают проверки за все дни
              </Check>
            )}
            {data.permissions.includes("schedule.view_all") && (
              <Check checked={mine} onChange={setMine} disabled={pendingReview}>
                Только мои
              </Check>
            )}
            <span className="text-sm text-muted-foreground">
              {occurrences.length} задач
            </span>
          </div>
          <div className="divide-y">
            {occurrences.length ? (
              occurrences.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setRun(o)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 py-4 text-left hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{o.snapshot.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {o.employee_name || "Ответственный не назначен"}
                      {o.transferred ? " · Перенесённая задача" : ""}
                    </p>
                    {o.blocker && (
                      <p className="mt-1 text-sm text-destructive">
                        {o.blocker}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span
                      className={cn(
                        o.status === "completed"
                          ? "text-emerald-600"
                          : o.status === "missed"
                            ? "text-destructive"
                            : "text-muted-foreground",
                      )}
                    >
                      {taskStatus[o.status]}
                    </span>
                    <span className="text-muted-foreground">
                      {o.snapshot.review_mode === "auto"
                        ? "Автоприёмка"
                        : "Проверяет управляющий"}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {pendingReview
                  ? "Отчётов на проверку нет"
                  : "На этот день задач нет"}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Изменения применятся к следующим заданиям
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void showPreview()}
            >
              Проверить расписание
            </Button>
          </div>
          <div className="divide-y">
            {data.definitions.length ? (
              data.definitions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setEditor(t)}
                  className="flex w-full flex-wrap justify-between gap-3 py-4 text-left hover:bg-muted/40"
                >
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {data.templates.find((s) => s.id === t.template_id)
                        ?.name || "Шаблон недоступен"}{" "}
                      · {t.items.filter((i) => i.kind !== "info").length}{" "}
                      пунктов ·{" "}
                      {t.items.filter((i) => i.kind === "photo").length} фото
                    </p>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground sm:text-right">
                    <p>
                      {t.enabled ? "Включена" : "Черновик"} ·{" "}
                      {t.review_mode === "auto"
                        ? "Автоприёмка"
                        : "Проверка управляющим"}
                    </p>
                    <p>
                      Раз в {t.recurrence.interval}{" "}
                      {t.recurrence.unit === "week" ? "нед." : "мес."}, с{" "}
                      {dayLabel(t.recurrence.anchor)}
                    </p>
                  </div>
                </button>
              ))
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Создайте задачу и составьте её чек-лист
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
function DefinitionEditor({
  task,
  data,
  editable,
  onClose,
  onSaved,
}: {
  task: TaskDefinition | "new";
  data: TaskData;
  editable: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const canFinance = data.permissions.includes("payroll.configure"),
    canPublish = data.permissions.includes("schedule.checklist_publish");
  const [value, setValue] = useState<TaskInput>(() =>
      task === "new"
        ? {
            request_key: crypto.randomUUID(),
            name: "",
            instructions: "",
            template_id: data.templates[0]?.id ?? "",
            review_mode: "manager",
            items: [newItem()],
            recurrence: { unit: "week", interval: 1, anchor: data.today },
            starts_on: data.today,
            enabled: false,
            penalty_enabled: canFinance,
            fine_amount: null,
            reward_amount: null,
            predecessor_id: null,
            predecessor_offset: 0,
            equipment_groups: [],
          }
        : task,
    ),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const set = <K extends keyof TaskInput>(key: K, v: TaskInput[K]) => {
    setDirty(true);
    setValue((s) => ({ ...s, [key]: v }));
  };
  const item = (index: number, patch: Partial<ChecklistItem>) =>
    set(
      "items",
      value.items.map((x, i) => (i === index ? { ...x, ...patch } : x)),
    );
  async function submit() {
    setBusy(true);
    try {
      const r = await saveTask(value);
      if (r.error) toast.error(r.error);
      else {
        toast.success(
          r.existing
            ? "Задача уже создана. Загружена сохранённая версия"
            : "Задача сохранена",
        );
        await onSaved();
      }
    } catch {
      toast.error("Не удалось сохранить задачу");
    } finally {
      setBusy(false);
    }
  }
  return (
    <TaskScreen
      title={task === "new" ? "Новая задача" : task.name}
      description="Шаблон задачи. Изменения применятся к следующим заданиям."
      onBack={onClose}
      dirty={dirty}
      busy={busy}
      actions={
        editable && (
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Сохранение…" : "Сохранить задачу"}
          </Button>
        )
      }
    >
      <fieldset
        disabled={!editable || busy}
        className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_360px]"
      >
        <div className="min-w-0 space-y-8">
          <section className="space-y-5">
            <Field label="Название">
              <Input
                value={value.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Инструкция">
              <Textarea
                rows={7}
                value={value.instructions}
                onChange={(e) => set("instructions", e.target.value)}
              />
            </Field>
          </section>
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Чек-лист</h3>
              <span className="text-sm text-muted-foreground">
                {value.items.length} пунктов
              </span>
            </div>
            {value.items.map((x, i) => (
              <div key={x.id} className="space-y-3 border-b py-5 first:pt-0">
                <div className="flex items-start gap-3">
                  <span className="w-5 shrink-0 pt-2 text-sm tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <Textarea
                    rows={2}
                    className="min-h-16"
                    aria-label={`Пункт ${i + 1}`}
                    value={x.title}
                    onChange={(e) => item(i, { title: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Удалить пункт ${i + 1}`}
                    onClick={() =>
                      set(
                        "items",
                        value.items.filter((_, n) => n !== i),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    aria-label="Тип ответа"
                    className={cn(selectClass, "w-40")}
                    value={x.kind}
                    onChange={(e) =>
                      item(i, {
                        kind: e.target.value as ChecklistItem["kind"],
                        required:
                          e.target.value === "info" ? false : x.required,
                      })
                    }
                  >
                    <option value="check">Отметка</option>
                    <option value="photo">Фото</option>
                    <option value="text">Текст</option>
                    <option value="number">Число</option>
                    <option value="info">Подсказка</option>
                  </select>
                  {x.kind !== "info" && (
                    <Check
                      checked={x.required}
                      onChange={(v) => item(i, { required: v })}
                    >
                      Обязательно
                    </Check>
                  )}
                </div>
                <Textarea
                  aria-label={`Пояснение к пункту ${i + 1}`}
                  placeholder="Пояснение к пункту"
                  rows={2}
                  className="min-h-16"
                  value={x.hint}
                  onChange={(e) => item(i, { hint: e.target.value })}
                />
                {x.kind === "number" && (
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      aria-label="Минимум"
                      type="number"
                      placeholder="Минимум"
                      value={x.min ?? ""}
                      onChange={(e) =>
                        item(i, {
                          min:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                    <Input
                      aria-label="Максимум"
                      type="number"
                      placeholder="Максимум"
                      value={x.max ?? ""}
                      onChange={(e) =>
                        item(i, {
                          max:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                    <Input
                      aria-label="Единица"
                      placeholder="Ед."
                      value={x.unit}
                      onChange={(e) => item(i, { unit: e.target.value })}
                    />
                  </div>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => set("items", [...value.items, newItem()])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Добавить пункт
            </Button>
          </section>
        </div>
        <div className="min-w-0 space-y-8 border-t pt-8 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
          <section className="space-y-4">
            <h3 className="font-semibold">Назначение и приёмка</h3>
            <Field label="Ответственный по смене">
              <select
                className={selectClass}
                value={value.template_id}
                onChange={(e) => set("template_id", e.target.value)}
              >
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Приёмка">
              <select
                className={selectClass}
                value={value.review_mode}
                onChange={(e) =>
                  set("review_mode", e.target.value as "auto" | "manager")
                }
              >
                <option value="manager">Принимает управляющий</option>
                <option value="auto">Автоматически после полного отчёта</option>
              </select>
            </Field>
          </section>
          <section className="space-y-4">
            <h3 className="font-semibold">Повторение</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Повторять раз в">
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={value.recurrence.interval}
                  onChange={(e) =>
                    set("recurrence", {
                      ...value.recurrence,
                      interval: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Период">
                <select
                  className={selectClass}
                  value={value.recurrence.unit}
                  onChange={(e) =>
                    set("recurrence", {
                      ...value.recurrence,
                      unit: e.target.value as "week" | "month",
                    })
                  }
                >
                  <option value="week">Неделю</option>
                  <option value="month">Месяц</option>
                </select>
              </Field>
            </div>
            <Field label="Дата первого повторения">
              <Input
                type="date"
                value={value.recurrence.anchor}
                onChange={(e) =>
                  set("recurrence", {
                    ...value.recurrence,
                    anchor: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Назначать начиная с">
              <Input
                type="date"
                value={value.starts_on}
                onChange={(e) => set("starts_on", e.target.value)}
              />
            </Field>
          </section>
          <fieldset disabled={!canFinance} className="space-y-3">
            <legend className="font-medium">Начисления</legend>
            <Check
              checked={value.penalty_enabled}
              onChange={(v) => set("penalty_enabled", v)}
            >
              Применять правило за невыполнение
            </Check>
            {value.penalty_enabled && (
              <Field label="Штраф, ₽">
                <Input
                  type="number"
                  min={0}
                  value={value.fine_amount ?? ""}
                  placeholder="По правилам заведения"
                  onChange={(e) =>
                    set(
                      "fine_amount",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </Field>
            )}
            <Field label="Премия за выполнение после переноса">
              <Input
                type="number"
                min={0}
                value={value.reward_amount ?? ""}
                placeholder="Без премии"
                onChange={(e) =>
                  set(
                    "reward_amount",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Деньги или бонусы и предупреждения определяются правилами зарплаты
              заведения.
            </p>
          </fieldset>

          <section className="space-y-4">
            <h3 className="font-semibold">Связи и оборудование</h3>
            <Field label="Предыдущая задача">
              <select
                className={selectClass}
                value={value.predecessor_id ?? ""}
                onChange={(e) => {
                  setDirty(true);
                  setValue((s) => ({
                    ...s,
                    predecessor_id: e.target.value || null,
                    predecessor_offset: e.target.value ? 1 : 0,
                  }));
                }}
              >
                <option value="">Не зависит от другой задачи</option>
                {data.definitions
                  .filter((t) => t.id !== value.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </Field>
            {value.predecessor_id && (
              <Field label="Через сколько дней после неё">
                <Input
                  type="number"
                  min={1}
                  max={7}
                  value={value.predecessor_offset}
                  onChange={(e) =>
                    set("predecessor_offset", Number(e.target.value))
                  }
                />
              </Field>
            )}
            {value.equipment_groups.length > 0 && (
              <div className="space-y-2">
                <h2 className="font-medium">Группы оборудования по очереди</h2>
                {value.equipment_groups.map((g, i) => (
                  <Field key={i} label={`Группа ${i + 1}`}>
                    <Input
                      value={g.join(", ")}
                      onChange={(e) =>
                        set(
                          "equipment_groups",
                          value.equipment_groups.map((s, n) =>
                            n === i
                              ? e.target.value
                                  .split(/[,;\s]+/)
                                  .filter(Boolean)
                                  .map(Number)
                              : s,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                <p className="text-xs text-muted-foreground">
                  Группы сменяются при каждом повторении, независимо от начала
                  месяца.
                </p>
              </div>
            )}
          </section>
          <section className="border-t pt-6">
            <Check
              disabled={!canPublish}
              checked={value.enabled}
              onChange={(v) => set("enabled", v)}
            >
              Включить задачу в расписание
            </Check>
          </section>
        </div>
      </fieldset>
    </TaskScreen>
  );
}
function TaskRun({
  occurrence: o,
  data,
  onClose,
  onSaved,
}: {
  occurrence: TaskOccurrence;
  data: TaskData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(o.answers),
    [comment, setComment] = useState(o.review_comment),
    [correctUntil, setCorrectUntil] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [urls, setUrls] = useState<Record<string, string>>({}),
    [history, setHistory] = useState<Awaited<ReturnType<typeof taskHistory>>>(
      [],
    );
  useEffect(() => {
    setAnswers(o.answers);
    setDirty(false);
    setComment(o.review_comment);
  }, [o.answers, o.version, o.review_comment]);
  useEffect(() => {
    let alive = true;
    taskHistory(o.id)
      .then((h) => alive && setHistory(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [o.id, o.version]);
  useEffect(() => {
    let alive = true;
    const paths = Object.values(answers).filter(
      (a): a is string => typeof a === "string" && a.startsWith(o.id + "/"),
    );
    Promise.all(paths.map(async (p) => ({ p, r: await taskPhotoUrl(p) })))
      .then((rows) => {
        if (alive)
          setUrls(
            Object.fromEntries(
              rows.filter((x) => x.r.url).map((x) => [x.p, x.r.url!]),
            ),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [answers, o.id]);
  const editable =
      o.user_id === data.userId &&
      ["assigned", "in_progress", "returned"].includes(o.status),
    review =
      data.permissions.includes("schedule.review") &&
      o.status === "submitted" &&
      o.user_id !== data.userId;
  const setAnswer = (id: string, v: Answer) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setDirty(true);
  };
  async function act(action: string) {
    if (action === "run.submit") {
      const missing = missingItems(o.snapshot.items, answers);
      if (missing.length) {
        toast.error(`Заполните: ${missing[0]}`);
        return;
      }
    }
    if (
      action === "run.return" &&
      (!correctUntil ||
        !Number.isFinite(new Date(correctUntil).getTime()) ||
        new Date(correctUntil).getTime() <= Date.now())
    ) {
      toast.error("Укажите будущий срок исправления");
      return;
    }
    setBusy(true);
    try {
      const r = await taskRunCommand(action, {
        id: o.id,
        version: o.version,
        answers,
        comment,
        ...(action === "run.return"
          ? { correct_until: new Date(correctUntil).toISOString() }
          : {}),
      });
      if (r.error) toast.error(r.error);
      else {
        setDirty(false);
        toast.success(
          action === "run.save"
            ? "Отчёт сохранён"
            : action === "run.submit"
              ? o.snapshot.review_mode === "auto"
                ? "Задача выполнена"
                : "Отчёт отправлен на проверку"
              : action === "run.approve"
                ? "Выполнение принято"
                : "Отчёт возвращён",
        );
        await onSaved();
      }
    } catch {
      toast.error("Не удалось сохранить отчёт");
    } finally {
      setBusy(false);
    }
  }
  async function upload(id: string, file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await uploadTaskPhoto(o.id, id, form);
      if (r.error) toast.error(r.error);
      else if (r.path) setAnswer(id, r.path);
    } catch {
      toast.error("Не удалось загрузить фото");
    } finally {
      setBusy(false);
    }
  }
  const predecessor = data.occurrences.find(
    (p) => p.id === o.predecessor_occurrence_id,
  );
  return (
    <TaskScreen
      onBack={onClose}
      dirty={dirty}
      busy={busy}
      title={o.snapshot.name}
      description={`${taskStatus[o.status]} · ${o.employee_name || "Без назначения"}`}
      actions={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {editable && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act("run.save")}
              >
                Сохранить
              </Button>
              <Button disabled={busy} onClick={() => void act("run.submit")}>
                {o.snapshot.review_mode === "auto"
                  ? "Завершить"
                  : "Сдать на проверку"}
              </Button>
            </>
          )}
          {review && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act("run.return")}
              >
                Вернуть
              </Button>
              <Button disabled={busy} onClick={() => void act("run.approve")}>
                Принять
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="max-w-3xl space-y-6">
        {o.blocker && <p className="text-sm text-destructive">{o.blocker}</p>}
        {o.deadline_at && (
          <p className="text-sm text-muted-foreground">
            Сдать до{" "}
            {new Date(o.deadline_at).toLocaleString("ru-RU", {
              timeZone: data.timezone,
            })}
          </p>
        )}
        {o.review_comment && (
          <div className="rounded-md border bg-muted/30 p-4">
            <p className="text-sm font-medium">Замечания управляющего</p>
            <p className="text-sm">{o.review_comment}</p>
          </div>
        )}
        {o.equipment.length > 0 && (
          <p className="text-sm font-medium">
            В этот раз: камеры № {o.equipment.join(", ")}
          </p>
        )}
        {predecessor && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Предыдущая задача: {predecessor.snapshot.name}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              {predecessor.employee_name} · {taskStatus[predecessor.status]}
            </p>
            {predecessor.snapshot.items
              .filter((i) => i.kind === "photo")
              .map((i) => (
                <PriorPhoto key={i.id} path={predecessor.answers[i.id]} />
              ))}
          </details>
        )}
        {o.snapshot.instructions && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Инструкция
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {o.snapshot.instructions}
            </p>
            {o.snapshot.source_url && (
              <a
                href={o.snapshot.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm text-primary underline underline-offset-4"
              >
                Исходная инструкция с иллюстрациями
              </a>
            )}
          </details>
        )}
        <div className="space-y-5">
          {o.snapshot.items.map((i, index) => (
            <div key={i.id} className="space-y-2 border-b pb-4">
              <Label className="leading-relaxed">
                {index + 1}. {i.title}
                {i.required && i.kind !== "info" ? " *" : ""}
              </Label>
              {i.hint && (
                <p className="text-sm text-muted-foreground">{i.hint}</p>
              )}
              {i.kind === "check" ? (
                <Check
                  disabled={!editable || busy}
                  checked={answers[i.id] === true}
                  onChange={(v) => editable && !busy && setAnswer(i.id, v)}
                >
                  {answers[i.id] === true ? "Готово" : "Отметить выполнение"}
                </Check>
              ) : i.kind === "photo" ? (
                <div className="space-y-2">
                  {typeof answers[i.id] === "string" &&
                    urls[answers[i.id] as string] && (
                      <Image
                        src={urls[answers[i.id] as string]}
                        alt={i.title}
                        width={420}
                        height={280}
                        className="max-h-72 w-full rounded-md object-contain"
                        unoptimized
                      />
                    )}
                  {editable && (
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
                      <Camera className="h-4 w-4" />
                      {answers[i.id] ? "Заменить фото" : "Добавить фото"}
                      <input
                        aria-label={`Фото: ${i.title}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        className="sr-only"
                        disabled={busy}
                        onChange={(e) => void upload(i.id, e.target.files?.[0])}
                      />
                    </label>
                  )}
                </div>
              ) : i.kind === "text" ? (
                <Textarea
                  aria-label={i.title}
                  disabled={!editable || busy}
                  maxLength={i.max_length}
                  value={String(answers[i.id] ?? "")}
                  onChange={(e) => setAnswer(i.id, e.target.value)}
                />
              ) : i.kind === "number" ? (
                <Input
                  aria-label={i.title}
                  type="number"
                  disabled={!editable || busy}
                  min={i.min ?? undefined}
                  max={i.max ?? undefined}
                  value={
                    answers[i.id] === null ? "" : String(answers[i.id] ?? "")
                  }
                  onChange={(e) =>
                    setAnswer(
                      i.id,
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
        {review && (
          <div className="space-y-4">
            <Field label="Замечания">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Обязательно при возврате"
              />
            </Field>
            <Field label="Срок исправления при возврате">
              <Input
                type="datetime-local"
                value={correctUntil}
                onChange={(e) => setCorrectUntil(e.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Время вашего устройства. При возврате укажите срок в пределах 30
              дней.
            </p>
          </div>
        )}
        {history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              История
            </summary>
            <div className="mt-3 space-y-3">
              {history.map((h) => (
                <div key={h.id} className="text-sm">
                  <p>{actionLabels[h.action] || "Событие задачи"}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("ru-RU", {
                      timeZone: data.timezone,
                    })}
                  </p>
                  {h.details.comment && <p>{h.details.comment}</p>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </TaskScreen>
  );
}
function PriorPhoto({ path }: { path: Answer | undefined }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (typeof path === "string")
      taskPhotoUrl(path)
        .then((r) => alive && setUrl(r.url))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  return url ? (
    <Image
      src={url}
      alt="Фото предыдущей задачи"
      width={420}
      height={280}
      unoptimized
      className="mt-2 max-h-60 object-contain"
    />
  ) : null;
}
function SettingsEditor({
  data,
  onClose,
  onRefresh,
  onSaved,
}: {
  data: TaskData;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [from, setFrom] = useState(data.settings?.enabled_from ?? ""),
    [stopped, setStopped] = useState(data.settings?.legacy_stopped ?? false),
    [chat, setChat] = useState(data.settings?.chat_id ?? ""),
    [reminders, setReminders] = useState(
      data.settings?.reminder_chat_ids?.join(", ") ?? "",
    ),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await saveTaskSettings({
        version: data.settings?.version,
        enabled_from: from || null,
        legacy_stopped: stopped,
        chat_id: chat || null,
        reminder_chat_ids: reminders.split(/[,;\s]+/).filter(Boolean),
      });
      if (r.error) toast.error(r.error);
      else {
        toast.success("Настройки сохранены");
        await onSaved();
      }
    } catch {
      toast.error("Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }
  return (
    <TaskScreen
      title="Настройки задач"
      onBack={onClose}
      busy={busy}
      description="Автоматическое назначение, начисления и уведомления заведения."
      dirty={
        from !== (data.settings?.enabled_from ?? "") ||
        stopped !== (data.settings?.legacy_stopped ?? false) ||
        chat !== (data.settings?.chat_id ?? "") ||
        reminders !== (data.settings?.reminder_chat_ids?.join(", ") ?? "")
      }
      actions={
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Сохранение…" : "Сохранить настройки"}
        </Button>
      }
    >
      <fieldset
        disabled={busy}
        className="grid items-start gap-10 lg:grid-cols-2"
      >
        <section className="max-w-xl space-y-5">
          <h3 className="text-base font-semibold">
            Переход на задачи в Sheerly
          </h3>
          <p className="text-sm text-muted-foreground">
            Дата перехода включает назначение заданий и начисления по их
            результатам. Перед этим сверьте переходный период и отключите
            прежние обработчики задач и напоминаний.
          </p>
          <Field label="Включить с">
            <Input
              type="date"
              min={data.today}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Check checked={stopped} onChange={setStopped}>
            Прежние обработчики задач, начислений за задачи и напоминаний
            отключены
          </Check>
          {from && (
            <Button variant="outline" onClick={() => setFrom("")}>
              Остановить автоматическую обработку
            </Button>
          )}
        </section>
        <section className="max-w-xl space-y-5">
          <h3 className="text-base font-semibold">Уведомления</h3>
          <Field label="ID чата для списка задач">
            <Input
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              placeholder="−100…"
            />
          </Field>
          <Field label="Чаты напоминаний о сдаче графика">
            <Textarea
              value={reminders}
              onChange={(e) => setReminders(e.target.value)}
              placeholder="ID чатов через запятую"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Напоминания — в понедельник и среду в 14:00 по часовому поясу
            заведения. Список задач — ежедневно в 12:00.
          </p>
        </section>
      </fieldset>
      <TaskMessageErrors messages={data.messages} onSaved={onRefresh} />
    </TaskScreen>
  );
}
function TaskMessageErrors({
  messages,
  onSaved,
}: {
  messages: TaskData["messages"];
  onSaved: () => Promise<void>;
}) {
  const [evidence, setEvidence] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState<string | null>(null);
  if (!messages.length) return null;
  async function retry(id: string) {
    setBusy(id);
    try {
      const r = await retryTaskMessage(id, evidence[id] ?? "");
      if (r.error) toast.error(r.error);
      else {
        toast.success("Сообщение поставлено в очередь");
        await onSaved();
      }
    } catch {
      toast.error("Не удалось повторить отправку");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="space-y-4">
      <h2 className="font-medium">Сообщения требуют проверки</h2>
      {messages.map((m) => (
        <div key={m.id} className="space-y-2 border-b pb-4">
          <p className="text-sm">
            {dayLabel(m.business_date)} · чат {m.chat_id}
          </p>
          <p className="text-sm text-destructive">
            {m.error || "Ответ Telegram неизвестен"}
          </p>
          <Field label="Подтверждение отсутствия сообщения в чате">
            <Textarea
              value={evidence[m.id] ?? ""}
              onChange={(e) =>
                setEvidence((s) => ({ ...s, [m.id]: e.target.value }))
              }
            />
          </Field>
          <Button
            variant="outline"
            disabled={!!busy || (evidence[m.id]?.trim().length ?? 0) < 10}
            onClick={() => void retry(m.id)}
          >
            Повторить отправку
          </Button>
        </div>
      ))}
    </section>
  );
}
