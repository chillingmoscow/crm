"use client";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, ArrowLeft, Camera, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import {
  Tabs,
  ProfileTabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { ProfileSection } from "@/components/shared/profile-section";
import {
  TaskHeaderActions,
  TaskPageTitle,
} from "../_components/task-header-actions";
import { InstructionPagePicker, InstructionBody } from "./instruction-page";
import { TaskList } from "./task-list";
import { DeleteTaskDialog } from "./delete-task-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Answer, ChecklistItem } from "@/lib/schedule/types";
import { dayLabel } from "@/lib/schedule/utils";
import {
  missingItems,
  taskStatus,
  type TaskData,
  type TaskDefinition,
  type TaskInput,
  type TaskOccurrence,
} from "@/lib/schedule/tasks";
import {
  loadTasks,
  saveTask,
  saveTaskSettings,
  taskRunCommand,
  uploadTaskPhoto,
  taskPhotoUrl,
  taskHistory,
  retryTaskMessage,
} from "./actions";

const actionLabels: Record<string, string> = {
  "definition.created": "Создан шаблон задачи",
  "definition.updated": "Изменён шаблон задачи",
  "definition.save": "Изменён шаблон задачи",
  "assignment.created": "Создано задание",
  "assignment.changed": "Изменено назначение",
  "assignment.deadline_extended": "Продлён срок задания",
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
      <Checkbox
        className="mt-0.5 shrink-0"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span>{children}</span>
    </label>
  );
}
function TaskSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || "__none"}
      onValueChange={(next) => onChange(next === "__none" ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value || "__none"}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="space-y-1">
        <Label
          htmlFor={id}
          className="cursor-pointer text-sm font-medium leading-5"
        >
          {label}
        </Label>
        {description && (
          <p className="text-[13px] leading-snug text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
function plural(count: number, one: string, few: string, many: string) {
  const key = new Intl.PluralRules("ru-RU").select(count);
  return key === "one" ? one : key === "few" ? few : many;
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
function ChecklistText({
  value,
  onChange,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    };
    resize();
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) {
        width = field.clientWidth;
        resize();
      }
    });
    let width = field.clientWidth;
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  return (
    <Textarea
      {...props}
      ref={ref}
      value={value}
      onChange={onChange}
      rows={1}
      className="min-h-9 overflow-hidden py-2 leading-5"
    />
  );
}
function TaskScreen({
  title,
  description,
  onBack,
  actions,
  children,
  dirty = false,
  busy = false,
  backLabel = "К задачам",
  backHref = "/schedule/tasks",
  showFooterActions = true,
  wide = false,
}: {
  title: string;
  backLabel?: string;
  backHref?: string;
  showFooterActions?: boolean;
  wide?: boolean;
  description?: string;
  onBack: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  dirty?: boolean;
  busy?: boolean;
}) {
  const [confirmExit, setConfirmExit] = useState(false);
  const [exitHref, setExitHref] = useState<string | null>(null);
  const router = useRouter();
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    if ((screen.current?.getBoundingClientRect().top ?? 0) < 0)
      screen.current?.scrollIntoView({ block: "start" });
    screen.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    const guardLink = (event: MouseEvent) => {
      if (
        !dirty ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href);
      if (
        url.origin !== window.location.origin ||
        url.href === window.location.href
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setExitHref(url.pathname + url.search + url.hash);
      setConfirmExit(true);
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("click", guardLink, true);
    };
  }, [dirty]);
  return (
    <section
      ref={screen}
      tabIndex={-1}
      className={wide ? "w-full space-y-5 outline-none" : "mx-auto w-full max-w-[720px] space-y-5 outline-none"}
    >
      <TaskPageTitle title={title} />
      <TaskHeaderActions>{actions}</TaskHeaderActions>
      <PageBreadcrumb>
        <a
          href={backHref}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            if (!busy) {
              setExitHref(null);
              if (dirty) setConfirmExit(true);
              else onBack();
            }
          }}
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </a>
      </PageBreadcrumb>
      {description && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children}
      {showFooterActions && actions && (
        <div className="flex flex-wrap justify-end gap-2 pb-3">{actions}</div>
      )}
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
            <Button
              onClick={() => (exitHref ? router.push(exitHref) : onBack())}
            >
              Выйти без сохранения
            </Button>
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
  const [data, setData] = useState(initial);
  const [editor, setEditor] = useState<TaskDefinition | "new" | null>(null);
  const [settings, setSettings] = useState(false);
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
    create = data.permissions.includes("schedule.checklist_create");
  const canSettings =
      manage &&
      data.permissions.includes("payroll.configure") &&
      data.permissions.includes("payroll.review");
  const refresh = async () => {
    const next = await loadTasks();
    setData(next);
    return next;
  };
    return (
    <>
      <div hidden={!!editor || settings} className="space-y-4">
        <TaskPageTitle title={null} />
        <TaskList
        data={data}
          onOpen={setEditor}
          onCreate={create ? () => setEditor("new") : undefined}
          onSettings={canSettings ? () => setSettings(true) : undefined}
          onRefresh={refresh}
      />
      {manage && (!data.settings?.enabled_from || data.settings?.paused) && (
        <p className="text-[13px] text-muted-foreground">
          {data.settings?.paused
            ? "Автоматическая обработка приостановлена."
            : "Автоматическое назначение ещё не включено."}
          {canSettings && (
            <button
              className="ml-1.5 hover:text-foreground hover:underline"
              onClick={() => setSettings(true)}
            >
              Настроить
            </button>
          )}
        </p>
      )}
    </div>
      {editor ? (
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
      ) : settings ? (
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
      ) : null}
    </>
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
  const [deleting, setDeleting] = useState(false);
  const canFinance = data.permissions.includes("payroll.configure"),
    canPublish = data.permissions.includes("schedule.checklist_publish");
  const [value, setValue] = useState<TaskInput>(() =>
      task === "new"
        ? {
            request_key: crypto.randomUUID(),
            name: "",
            instructions: "",
            instruction_page_id: null,
            template_id: null,
            review_mode: "manager",
            items: [],
            recurrence: { unit: "week", interval: 1, anchor: data.today },
            starts_on: data.today,
            enabled: false,
            penalty_enabled: canFinance,
            fine_amount: null,
            reward_amount: null,
            equipment_groups: [],
          }
        : task,
    ),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const recurrence = value.recurrence ?? {
    unit: "week" as const,
    interval: 1,
    anchor: data.today,
  };
  const [equipmentTexts, setEquipmentTexts] = useState(() =>
    value.equipment_groups.map((group) => group.join(", ")),
  );
  const [expandedHints, setExpandedHints] = useState(() =>
    value.items.filter((point) => point.hint).map((point) => point.id),
  );
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
    if (
      value.enabled &&
      (!value.template_id || !value.recurrence || !value.items.length)
    ) {
      toast.error("Для включения задачи укажите смену, повтор и чек-лист");
      return;
    }
    const equipmentGroups = equipmentTexts.map((text) =>
      text
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map(Number),
    );
    if (
      equipmentGroups.some(
        (group) =>
          group.length === 0 ||
          group.some((n) => !Number.isInteger(n) || n < 1 || n > 999),
      )
    ) {
      toast.error("Укажите в группах целые номера оборудования от 1 до 999");
      return;
    }
    setBusy(true);
    try {
      const r = await saveTask({ ...value, equipment_groups: equipmentGroups });
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
      wide
      showFooterActions={false}
      title={task === "new" ? "Новая задача" : task.name}
      onBack={onClose}
      dirty={dirty}
      busy={busy}
      actions={
        editable && (
          <>
            {task !== "new" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDeleting(true)}
                className="gap-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" />
                Удалить задачу
              </Button>
            )}
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Сохранение…" : "Сохранить задачу"}
          </Button>
          </>
        )
      }
    >
      <Tabs defaultValue="main" className="w-full">
        <ProfileTabsList>
          <TabsTrigger value="main">Основное</TabsTrigger>
          <TabsTrigger value="checklist">Чек-лист</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
        </ProfileTabsList>
        <fieldset disabled={!editable || busy} className="min-w-0">
          <TabsContent value="main" className="mx-auto w-full max-w-[720px] space-y-5">
        <ProfileSection title="Основное">
          <Field label="Название">
            <Input
              value={value.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Что нужно сделать"
            />
          </Field>
              <InstructionPagePicker
                data={data}
                value={value.instruction_page_id}
                onChange={(id) => set("instruction_page_id", id)}
                name={value.name}
                disabled={!editable || busy}
            />
              {!value.instruction_page_id && value.instructions && (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Прежний текст инструкции
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                    {value.instructions}
                  </p>
                </details>
              )}
        </ProfileSection>
          </TabsContent>
          <TabsContent value="checklist" className="mx-auto w-full max-w-[720px] space-y-5">
        <ProfileSection
          title="Чек-лист"
          actions={
            <span className="text-[13px] text-muted-foreground">
              {value.items.length}{" "}
              {plural(value.items.length, "пункт", "пункта", "пунктов")}
            </span>
          }
        >
          <div className="divide-y">
            {value.items.map((x, i) => (
                  <div
                    key={x.id}
                    className="space-y-3 py-4 first:pt-0 last:pb-0"
                  >
                <div className="flex items-start gap-3">
                  <span className="w-4 shrink-0 pt-2.5 text-sm tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <ChecklistText
                      aria-label={`Пункт ${i + 1}`}
                      value={x.title}
                      onChange={(e) => item(i, { title: e.target.value })}
                    />
                    <div className="-mr-10 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mr-0">
                      <div className="w-28 shrink-0">
                        <TaskSelect
                          label={`Тип ответа для пункта ${i + 1}`}
                          disabled={!editable || busy}
                          value={x.kind}
                          onChange={(kind) =>
                            item(i, {
                              kind: kind as ChecklistItem["kind"],
                                  required:
                                    kind === "info" ? false : x.required,
                            })
                          }
                          options={[
                            { value: "check", label: "Отметка" },
                            { value: "photo", label: "Фото" },
                            { value: "text", label: "Текст" },
                            { value: "number", label: "Число" },
                            { value: "info", label: "Подсказка" },
                          ]}
                        />
                      </div>
                      {x.kind !== "info" && (
                        <Check
                          checked={x.required}
                          onChange={(required) => item(i, { required })}
                        >
                          Обязательно
                        </Check>
                      )}
                      {!expandedHints.includes(x.id) && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-[13px] text-muted-foreground"
                          aria-label={`Добавить пояснение к пункту ${i + 1}`}
                          onClick={() =>
                            setExpandedHints((ids) => [...ids, x.id])
                          }
                        >
                          Добавить пояснение
                        </Button>
                      )}
                    </div>
                    {expandedHints.includes(x.id) && (
                          <div className="flex items-start gap-2">
                      <ChecklistText
                        aria-label={`Пояснение к пункту ${i + 1}`}
                        placeholder="Пояснение к пункту"
                        value={x.hint}
                              onChange={(e) =>
                                item(i, { hint: e.target.value })
                              }
                      />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-9 shrink-0 text-muted-foreground"
                              aria-label={`Убрать пояснение к пункту ${i + 1}`}
                              onClick={() => {
                                if (x.hint) item(i, { hint: "" });
                                setExpandedHints((ids) =>
                                  ids.filter((id) => id !== x.id),
                                );
                              }}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                    )}
                    {x.kind === "number" && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Минимум">
                          <Input
                            type="number"
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
                        </Field>
                        <Field label="Максимум">
                          <Input
                            type="number"
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
                        </Field>
                        <Field label="Единица">
                          <Input
                            value={x.unit}
                                onChange={(e) =>
                                  item(i, { unit: e.target.value })
                                }
                            placeholder="шт., °C, мл"
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground"
                    aria-label={`Удалить пункт ${i + 1}`}
                    onClick={() =>
                      set(
                        "items",
                        value.items.filter((_, n) => n !== i),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => set("items", [...value.items, newItem()])}
          >
            <Plus className="mr-2 size-4" />
            Добавить пункт
          </Button>
        </ProfileSection>
          </TabsContent>
          <TabsContent value="settings" className="mx-auto w-full max-w-[720px] space-y-5">
        <ProfileSection title="Выполнение">
          <Field label="Шаблон смены">
            <TaskSelect
              disabled={!editable || busy}
                  value={value.template_id ?? ""}
                  onChange={(template) => set("template_id", template || null)}
              options={[
                { value: "", label: "Выберите шаблон смены" },
                ...data.templates.map((template) => ({
                  value: template.id,
                  label: template.name,
                })),
              ]}
            />
          </Field>
          <p className="-mt-1 text-[13px] leading-snug text-muted-foreground">
                Задачу получит сотрудник, назначенный на этот шаблон в
                расписании.
          </p>
          <Check
            checked={value.review_mode === "manager"}
            onChange={(required) =>
              set("review_mode", required ? "manager" : "auto")
            }
            disabled={!editable || busy}
          >
            Требуется приёмка
          </Check>
        </ProfileSection>

        <ProfileSection title="Повторение">
              <SwitchRow
                label="Повторять задачу"
                checked={value.recurrence !== null}
                onChange={(enabled) =>
                  set("recurrence", enabled ? recurrence : null)
                }
                disabled={!editable || busy}
              />
              <fieldset
                disabled={value.recurrence === null}
                className="space-y-4"
              >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Повторять раз в">
              <Input
                type="number"
                min={1}
                max={52}
                      value={recurrence.interval}
                onChange={(e) =>
                  set("recurrence", {
                          ...recurrence,
                    interval: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Период">
              <TaskSelect
                disabled={!editable || busy}
                      value={recurrence.unit}
                onChange={(unit) =>
                  set("recurrence", {
                          ...recurrence,
                    unit: unit as "week" | "month",
                  })
                }
                options={[
                  { value: "week", label: "Неделю" },
                  { value: "month", label: "Месяц" },
                ]}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Первое повторение">
              <DatePicker
                disabled={!editable || busy}
                      value={recurrence.anchor}
                clearable={false}
                onChange={(anchor) =>
                        set("recurrence", { ...recurrence, anchor })
                }
              />
            </Field>
            <Field label="Назначать с">
              <DatePicker
                disabled={!editable || busy}
                value={value.starts_on}
                clearable={false}
                onChange={(date) => set("starts_on", date)}
              />
            </Field>
          </div>
              </fieldset>
          <div className="border-t pt-4">
            <SwitchRow
              label="Автоматически назначать задачу"
              checked={value.enabled}
              disabled={!editable || busy || !canPublish}
              onChange={(enabled) => set("enabled", enabled)}
            />
          </div>
        </ProfileSection>

        <ProfileSection title="Начисления">
          <fieldset disabled={!canFinance} className="min-w-0 space-y-4">
            <SwitchRow
              label="Учитывать невыполнение"
              checked={value.penalty_enabled}
              disabled={!editable || busy || !canFinance}
              onChange={(enabled) => set("penalty_enabled", enabled)}
            />
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
            <p className="text-[13px] leading-snug text-muted-foreground">
                  Деньги, бонусы и предупреждения определяются правилами
                  зарплаты заведения.
            </p>
          </fieldset>
        </ProfileSection>

        {equipmentTexts.length > 0 && (
          <ProfileSection
            title="Оборудование"
            description="Группы сменяются при каждом повторении, независимо от начала месяца."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {equipmentTexts.map((text, i) => (
                <Field key={i} label={`Группа ${i + 1}`}>
                  <Input
                    aria-label={`Группа оборудования ${i + 1}`}
                    value={text}
                    onChange={(e) => {
                      setDirty(true);
                      setEquipmentTexts((groups) =>
                        groups.map((group, n) =>
                          n === i ? e.target.value : group,
                        ),
                      );
                    }}
                  />
                </Field>
              ))}
            </div>
          </ProfileSection>
        )}
          </TabsContent>
      </fieldset>
      </Tabs>
      <DeleteTaskDialog
        task={deleting && task !== "new" ? task : null}
        onClose={() => setDeleting(false)}
        onDeleted={onSaved}
      />
    </TaskScreen>
  );
}
export function TaskReport({
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
    if (o.planned) return;
    taskHistory(o.id)
      .then((h) => alive && setHistory(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [o.id, o.version, o.planned]);
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
      !o.planned &&
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
  return (
    <TaskScreen
      onBack={onClose}
      backLabel="К графику"
      backHref="/schedule"
      dirty={dirty}
      busy={busy}
      title={o.snapshot.name}
      description={`${o.planned ? "План" : taskStatus[o.status]} · ${o.employee_name || "Без назначения"}`}
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
        {o.planned && (
          <p className="text-sm text-muted-foreground">
            Предварительное назначение. Отчёт станет доступен после
            автоматического создания задания.
          </p>
        )}
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
        {o.snapshot.instruction_snapshot ? (
          <details open>
            <summary className="cursor-pointer text-sm font-medium">
              Инструкция: {o.snapshot.instruction_snapshot.title}
            </summary>
            <InstructionBody
              instruction={o.snapshot.instruction_snapshot}
              kbAccess={data.permissions.includes("kb.view_pages")}
            />
          </details>
        ) : (
          (o.snapshot.instructions || o.snapshot.source_url) && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Инструкция
            </summary>
            {o.snapshot.instructions && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {o.snapshot.instructions}
              </p>
            )}
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
          )
        )}
        <ProfileSection title="Отчёт">
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
        </ProfileSection>
        {review && (
          <div className="space-y-4">
            <Field label="Замечания">
              <Textarea
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setDirty(true);
                }}
                placeholder="Обязательно при возврате"
              />
            </Field>
            <Field label="Срок исправления при возврате">
              <Input
                type="datetime-local"
                value={correctUntil}
                onChange={(e) => {
                  setCorrectUntil(e.target.value);
                  setDirty(true);
                }}
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
    [paused, setPaused] = useState(data.settings?.paused ?? false),
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
        paused,
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
      dirty={
        from !== (data.settings?.enabled_from ?? "") ||
        paused !== (data.settings?.paused ?? false) ||
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
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <ProfileSection
          title="Автоматическая обработка"
          description="Перед включением сверьте переходный период и отключите прежние сценарии задач и напоминаний."
        >
          <Field label="Дата перехода">
            <DatePicker
              disabled={busy || Boolean(data.settings?.enabled_from)}
              fromDate={new Date(data.today + "T00:00:00")}
              value={from}
              onChange={setFrom}
              clearable={!data.settings?.enabled_from}
            />
          </Field>
          <Check checked={stopped} onChange={setStopped} disabled={busy}>
            Прежние сценарии задач, начислений и напоминаний отключены
          </Check>
          {from && (
            <div className="border-t pt-4">
              <SwitchRow
                label="Обрабатывать задачи автоматически"
                description="Пауза сохраняет дату перехода и существующие отчёты. Изменения применятся после сохранения."
                checked={!paused}
                disabled={busy}
                onChange={(enabled) => setPaused(!enabled)}
              />
            </div>
          )}
        </ProfileSection>
        <ProfileSection title="Уведомления">
          <Field label="ID чата для списка задач">
            <Input
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              placeholder="−100…"
            />
          </Field>
          <Field label="Чаты напоминаний о сдаче графика">
            <Textarea
              rows={3}
              value={reminders}
              onChange={(e) => setReminders(e.target.value)}
              placeholder="ID чатов через запятую"
            />
          </Field>
          <p className="text-[13px] leading-snug text-muted-foreground">
            Список задач: ежедневно в 12:00. Напоминания: понедельник и среда в
            14:00 по времени заведения.
          </p>
        </ProfileSection>
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
    <ProfileSection title="Сообщения требуют проверки">
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
    </ProfileSection>
  );
}
