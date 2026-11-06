"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { shiftAssignee, assignmentFields } from "@/lib/schedule/types";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  SlidersHorizontal,
  Layers,
  Copy,
  Trash2,
  Pencil,
  Archive,
  Send,
  Users,
  ClipboardCheck,
  GripVertical,
  ListChecks,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { paletteBg, paletteText } from "@/lib/palette";
import { cn } from "@/lib/utils";
import {
  addDays,
  dateInZone,
  dayLabel,
  shiftHours,
  timeInZone,
  weekStart,
} from "@/lib/schedule/utils";
import type {
  Checklist,
  ChecklistRun,
  ScheduleData,
  Shift,
  ShiftTemplate,
  ScheduleEvent,
} from "@/lib/schedule/types";
import { loadSchedule, scheduleCommand, scheduleHistory } from "../actions";
import {
  ChecklistEditor,
  ShiftEditor,
  TemplateEditor,
  Field,
  selectClass,
  type Save,
  formatTemplateTimes,
} from "./editors";
import { RunPanel } from "./run-panel";
import { CandidateTrialCard } from "./candidate-trial-card";
import { toast } from "sonner";
import { ScheduleTasksTab } from "./tasks-tab";
import { TaskHeaderTarget } from "./task-header-actions";
import {
  taskStatus,
  type TaskData,
  type TaskOccurrence,
} from "@/lib/schedule/tasks";
import { loadTasks } from "../tasks/actions";
const CalendarTaskReport = dynamic(
  () => import("../tasks/tasks-client").then((module) => module.TaskReport),
  {
    loading: () => (
      <div
        role="status"
        aria-label="Загрузка отчёта задачи"
        className="mx-auto h-72 w-full max-w-[720px] animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
      />
    ),
  },
);
type Editor =
  | {
      type: "shift";
      shift?: Shift;
      day: string;
      userId?: string | null;
      template?: ShiftTemplate;
      copy?: boolean;
    }
  | { type: "template"; template?: ShiftTemplate; copy?: boolean }
  | { type: "checklist"; checklist?: Checklist };
const runLabel = {
  in_progress: "В процессе",
  submitted: "Ожидает проверки",
  returned: "На доработке",
  approved: "Утверждено",
};
const eventLabels: Record<string, string> = {
  "shift.create": "Создана смена",
  "shift.copy": "Создана копия",
  "shift.edit": "Изменена смена",
  "shift.assign": "Назначен сотрудник",
  "shift.publish": "Опубликована смена",
  "shift.delete": "Удалена смена",
};
export function ScheduleClient({
  initial,
  initialTab = "calendar",
  initialTasks = null,
  initialCalendarTasks = null,
  initialShowTasks,
  initialDate,
}: {
  initial: ScheduleData;
  initialTab?: string;
  initialTasks?: TaskData | null;
  initialCalendarTasks?: TaskData | null;
  initialShowTasks?: boolean;
  initialDate?: string;
}) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState(initialTab);
  const [tasksVisited, setTasksVisited] = useState(initialTab === "tasks");
  const [taskHeaderTarget, setTaskHeaderTarget] =
    useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setTab(initialTab);
    if (initialTab === "tasks") setTasksVisited(true);
  }, [initialTab]);
  useEffect(() => {
    const restoreTab = () => {
      const next =
        new URL(window.location.href).searchParams.get("tab") ?? "calendar";
      const valid = [
        "calendar",
        "tasks",
        "templates",
        "checklists",
        "review",
        "team",
      ].includes(next)
        ? next
        : "calendar";
      setTab(valid);
      if (valid === "tasks") setTasksVisited(true);
    };
    window.addEventListener("popstate", restoreTab);
    return () => window.removeEventListener("popstate", restoreTab);
  }, []);
  const [week, setWeek] = useState(
    weekStart(initialDate ?? dateInZone(new Date(), initial.timezone)),
  );
  useEffect(() => {
    if (initialDate) setWeek(weekStart(initialDate));
  }, [initialDate]);
  const [showTasks, setShowTasks] = useState(
    initialShowTasks ?? !initial.permissions.includes("schedule.view_all"),
  );
  const [calendarTasks, setCalendarTasks] = useState(initialCalendarTasks);
  const [calendarTasksWeek, setCalendarTasksWeek] = useState(week);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskOccurrence | null>(null);
  const tasksRequest = useRef(0);
  useEffect(() => {
    if (initialShowTasks !== undefined) {
      setShowTasks(initialShowTasks);
      return;
    }
    try {
      const saved = localStorage.getItem(
        `schedule.tasks.${initial.venueId}.${initial.userId}`,
      );
      if (saved !== null) setShowTasks(saved === "true");
    } catch {}
  }, [initialShowTasks, initial.venueId, initial.userId]);
  const toggleTasks = (enabled: boolean) => {
    setShowTasks(enabled);
    try {
      localStorage.setItem(
        `schedule.tasks.${initial.venueId}.${initial.userId}`,
        String(enabled),
      );
    } catch {}
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set("showTasks", "1");
    else url.searchParams.delete("showTasks");
    window.history.replaceState(null, "", url);
  };
  const refreshCalendarTasks = useCallback(async () => {
    const request = ++tasksRequest.current;
    try {
      const [next, schedule] = await Promise.all([
        loadTasks({ from: week, to: addDays(week, 6) }),
        loadSchedule(),
      ]);
      if (request === tasksRequest.current) {
        setData(schedule);
        setCalendarTasks(next);
        setCalendarTasksWeek(week);
        setTasksError(false);
        setTasksLoading(false);
      }
      return next;
    } catch (error) {
      if (request === tasksRequest.current) {
        setTasksError(true);
        setTasksLoading(false);
      }
      throw error;
    }
  }, [week]);
  useEffect(() => {
    if (!showTasks || tab !== "calendar") return;
    setTasksLoading(true);
    void refreshCalendarTasks().catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refreshCalendarTasks().catch(() => {});
    }, 60000);
    return () => {
      // This counter invalidates requests started by both the initial load and later polling.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      tasksRequest.current++;
      clearInterval(timer);
    };
  }, [showTasks, tab, refreshCalendarTasks]);
  const [filters, setFilters] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [publication, setPublication] = useState("all");
  const [view, setView] = useState("week");
  const [archive, setArchive] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [run, setRun] = useState<ChecklistRun | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [qualification, setQualification] = useState(false);
  const [qualUser, setQualUser] = useState("");
  const [qualRole, setQualRole] = useState("");
  const [history, setHistory] = useState<ScheduleEvent[]>([]);
  const [reviewChecklist, setReviewChecklist] = useState("all");
  const [reviewStatus, setReviewStatus] = useState("all");
  const can = useCallback(
    (p: string) => data.permissions.includes("schedule." + p),
    [data.permissions],
  );
  const canPlan = can("view_all");
  const canConfigureTasks =
    canPlan || can("checklist_create") || can("checklist_edit");
  const pendingTaskReports = can("review")
    ? (calendarTasks?.occurrences ?? []).filter(
        (task) => task.status === "submitted" && task.user_id !== data.userId,
      )
    : [];
  const refresh = useCallback(async () => {
    try {
      setData(await loadSchedule());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось обновить график",
      );
      throw e;
    }
  }, []);
  const save: Save = async (action, input) => {
    try {
      const r = await scheduleCommand(action, input);
      if (r.error) {
        toast.error(r.error);
        return false;
      }
      try {
        await refresh();
      } catch {
        toast.warning(
          "Изменения сохранены. Обновите страницу, чтобы увидеть их.",
        );
        return true;
      }
      toast.success("Изменения сохранены");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    }
  };
  useEffect(() => {
    let alive = true;
    if (selected)
      scheduleHistory(selected.id)
        .then((h) => {
          if (alive) setHistory(h);
        })
        .catch(() => {
          if (alive) setHistory([]);
        });
    return () => {
      alive = false;
    };
  }, [selected]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const search = query.trim().toLowerCase();
  const roster = [
    ...data.staff,
    ...(data.casualEmployees ?? []).map((e) => ({
      user_id: `payroll:${e.id}`,
      first_name: e.name,
      last_name: null,
      role_id: e.role_id,
      role_name: `${e.role_name} · разовый`,
      department_id:
        data.roles.find((r) => r.id === e.role_id)?.department_id ?? null,
    })),
  ];
  const matchingStaff = new Set(
    roster
      .filter((s) =>
        `${s.first_name ?? ""} ${s.last_name ?? ""} ${s.role_name}`
          .toLowerCase()
          .includes(search),
      )
      .map((s) => s.user_id),
  );
  const weekShifts = data.shifts.filter(
    (s) =>
      days.includes(dateInZone(s.starts_at, data.timezone)) &&
      (!search ||
        (shiftAssignee(s)
          ? matchingStaff.has(shiftAssignee(s)!)
          : "открытые смены".includes(search))) &&
      (department === "all" || s.department_id === department) &&
      (publication === "all" ||
        (publication === "draft" ? !s.published : s.published)),
  );
  const trialDay = (
    trial: NonNullable<ScheduleData["candidateTrials"]>[number],
  ) =>
    trial.starts_at
      ? dateInZone(trial.starts_at, data.timezone)
      : trial.appointment_date;
  const weekTrials = (data.candidateTrials ?? []).filter(
    (trial) =>
      days.includes(trialDay(trial)) &&
      department === "all" &&
      `${trial.full_name} ${trial.desired_position ?? ""} стажировка кандидат`
        .toLowerCase()
        .includes(search),
  );
  const trialCandidates = [
    ...new Map(weekTrials.map((trial) => [trial.candidate_id, trial])).values(),
  ];
  const staff = roster.filter(
    (s) =>
      (canPlan || s.user_id === data.userId) &&
      (department === "all" ||
        s.department_id === department ||
        weekShifts.some(
          (w) =>
            shiftAssignee(w) === s.user_id && w.department_id === department,
        )) &&
      matchingStaff.has(s.user_id),
  );
  const rosterIds = new Set(roster.map((person) => person.user_id));
  const visibleStaffIds = new Set(staff.map((person) => person.user_id));
  const taskRowId = (task: TaskOccurrence) =>
    task.user_id && rosterIds.has(task.user_id) ? task.user_id : null;
  const weekTasks =
    showTasks && calendarTasksWeek === week
      ? (calendarTasks?.occurrences ?? []).filter((task) => {
          if (!days.includes(task.business_date) || publication === "draft")
            return false;
          const assignee = taskRowId(task);
          if (assignee ? !visibleStaffIds.has(assignee) : !canPlan)
            return false;
          const shift = data.shifts.find((entry) => entry.id === task.shift_id);
          if (
            department !== "all" &&
            shift &&
            shift.department_id !== department
          )
            return false;
          return (
            Boolean(assignee) ||
            ((!search ||
              `${task.employee_name ?? "без сотрудника"}`
                .toLowerCase()
                .includes(search)) &&
              (department === "all" || shift?.department_id === department))
          );
        })
      : [];
  const taskCard = (task: TaskOccurrence, compact = true) => (
    <button
      key={task.id}
      onClick={() => setSelectedTask(task)}
      aria-label={`Задача: ${task.snapshot.name}, ${taskStatus[task.status]}`}
      title={`${task.snapshot.name} · ${task.employee_name || "Без назначения"} · ${taskStatus[task.status]}`}
      className={cn(
        "flex w-full items-start gap-1.5 rounded-md border bg-background px-2 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        task.status === "completed" && "text-muted-foreground",
        task.status === "missed" && "border-destructive/30",
      )}
    >
      {task.status === "completed" ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={
            compact ? "line-clamp-2 leading-4" : "block text-sm font-medium"
          }
        >
          {task.snapshot.name}
        </span>
        {!compact && (
          <span className="mt-1 block text-[13px] text-muted-foreground">
            {task.employee_name || "Без назначения"} · {taskStatus[task.status]}
          </span>
        )}
      </span>
    </button>
  );
  const draftShifts = weekShifts.filter((s) => !s.published);
  const openShifts = weekShifts.filter((s) => !shiftAssignee(s));
  const name = (id: string | null) => {
    const s = roster.find((s) => s.user_id === id);
    return s
      ? [s.first_name, s.last_name].filter(Boolean).join(" ") || s.role_name
      : "Без сотрудника";
  };
  const personShifts = (id: string | null, day?: string) =>
    weekShifts.filter(
      (s) =>
        shiftAssignee(s) === id &&
        (!day || dateInZone(s.starts_at, data.timezone) === day),
    );
  const publish = () =>
    setConfirmation({
      title: "Опубликовать смены?",
      description: `Количество смен для публикации: ${draftShifts.length}. Будут опубликованы черновики выбранной недели с учётом фильтров.`,
      action: async () => {
        const r = await publishShifts(draftShifts);
        if (r) toast.success("Смены опубликованы");
      },
    });
  const publishShifts = async (shifts: Shift[]) => {
    setBusy(true);
    try {
      const result = await scheduleCommand("shift.publish_many", {
        shifts: shifts.map((s) => ({ id: s.id, version: s.version })),
      });
      if (result.error) toast.error(result.error);
      else await refresh();
      return !result.error;
    } catch {
      toast.error(
        "Не удалось обновить публикацию. Проверьте соединение и обновите страницу.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const create = (
    day = days[0],
    userId: string | null = null,
    template?: ShiftTemplate,
  ) =>
    setEditor({
      type: "shift",
      day,
      userId: can("shift_assign") ? userId : null,
      template,
    });
  const drop = async (
    e: React.DragEvent,
    day: string,
    userId: string | null,
  ) => {
    e.preventDefault();
    const template = data.templates.find(
      (t) => t.id === e.dataTransfer.getData("application/sheerly-template"),
    );
    if (template && can("shift_create")) {
      create(day, userId, template);
      return;
    }
    const shift = data.shifts.find(
      (s) => s.id === e.dataTransfer.getData("application/sheerly-shift"),
    );
    if (!shift || !can("shift_edit")) return;
    await save("shift.edit", {
      ...shift,
      date: day,
      start_time: timeInZone(shift.starts_at, data.timezone),
      end_time: timeInZone(shift.ends_at, data.timezone),
      ...assignmentFields(userId),
      payroll_model_id: userId?.startsWith("payroll:")
        ? (data.casualEmployees?.find((e) => e.id === userId.slice(8))
            ?.model_id ?? null)
        : null,
    });
  };
  const startRun = async (shift: Shift, checklistId: string) => {
    const existing = data.runs.find(
      (r) => r.shift_id === shift.id && r.checklist_id === checklistId,
    );
    if (existing) {
      setSelected(null);
      setRun(existing);
      return;
    }
    setBusy(true);
    try {
      const r = await scheduleCommand("run.start", {
        shift_id: shift.id,
        checklist_id: checklistId,
      });
      if (r.error) toast.error(r.error);
      else {
        const next = await loadSchedule();
        setData(next);
        const found = next.runs.find((x) => x.id === r.id);
        if (found) {
          setSelected(null);
          setRun(found);
        }
      }
    } catch {
      toast.error("Не удалось открыть выполнение. Проверьте соединение.");
    } finally {
      setBusy(false);
    }
  };
  const card = (s: Shift) => (
    <button
      key={s.id}
      draggable={can("shift_edit")}
      onDragStart={(e) =>
        e.dataTransfer.setData("application/sheerly-shift", s.id)
      }
      onClick={() => setSelected(s)}
      className={cn(
        "w-full rounded-md p-2 text-left grid gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity hover:opacity-80",
        paletteBg(s.color),
        paletteText(s.color),
      )}
    >
      <span className="text-xs font-semibold tabular-nums">
        {timeInZone(s.starts_at, data.timezone)}–
        {timeInZone(s.ends_at, data.timezone)}
      </span>
      <span className="text-[11px] truncate">{s.title}</span>
      {!s.published && (
        <span className="flex gap-1 items-center text-[10px]">
          <span className="size-1.5 rounded-full bg-current" />
          Черновик
        </span>
      )}
    </button>
  );
  const noData = (
    icon: typeof CalendarDays,
    title: string,
    description: string,
    action?: React.ReactNode,
  ) => (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
    />
  );
  return (
    <div className="w-full min-w-0 p-4 md:p-8 space-y-6 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">График работы</h1>
        <div
          ref={setTaskHeaderTarget}
          className="flex flex-wrap items-center gap-2"
        >
          {tab === "calendar" && !selectedTask && can("shift_create") && (
            <Button
              variant="outline"
              onClick={() => create(dateInZone(new Date(), data.timezone))}
            >
              <Plus className="size-4 mr-2" />
              Смена
            </Button>
          )}
          {tab === "calendar" &&
            !selectedTask &&
            can("shift_publish") &&
            draftShifts.length > 0 && (
              <Button disabled={busy} onClick={publish}>
                <Send className="size-4 mr-2" />
                Опубликовать · {draftShifts.length}
              </Button>
            )}
          {tab === "templates" && can("template_create") && (
            <Button onClick={() => setEditor({ type: "template" })}>
              <Plus className="size-4 mr-2" />
              Шаблон
            </Button>
          )}
          {tab === "checklists" && can("checklist_create") && (
            <Button onClick={() => setEditor({ type: "checklist" })}>
              <Plus className="size-4 mr-2" />
              Чек-лист
            </Button>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(t) => {
          setTab(t);
          setArchive(false);
          if (t === "tasks") setTasksVisited(true);
          const url = new URL(window.location.href);
          if (t === "calendar") url.searchParams.delete("tab");
          else url.searchParams.set("tab", t);
          window.history.pushState(null, "", url);
        }}
      >
        <TabsList className="overflow-x-auto justify-start">
          <TabsTrigger value="calendar">
            {canPlan ? "Расписание" : "Мои смены"}
          </TabsTrigger>
          {canConfigureTasks && <TabsTrigger value="tasks">Задачи</TabsTrigger>}
          {[
            "template_create",
            "template_edit",
            "template_copy",
            "template_archive",
            "shift_create",
          ].some(can) && (
            <TabsTrigger value="templates">Шаблоны смен</TabsTrigger>
          )}
          {[
            "checklist_create",
            "checklist_edit",
            "checklist_publish",
            "checklist_archive",
            "review",
          ].some(can) && (
            <TabsTrigger value="checklists">Чек-листы</TabsTrigger>
          )}
          {can("review") && (
            <TabsTrigger value="review">
              Проверка
              {data.runs.filter((r) => r.status === "submitted").length > 0 && (
                <span className="ml-2 rounded-full bg-muted px-2 text-xs">
                  {data.runs.filter((r) => r.status === "submitted").length}
                </span>
              )}
            </TabsTrigger>
          )}
          {canPlan && <TabsTrigger value="team">Команда</TabsTrigger>}
        </TabsList>
        <TabsContent
          value="calendar"
          className="space-y-5"
          forceMount={selectedTask ? true : undefined}
          hidden={tab !== "calendar"}
        >
          {selectedTask && calendarTasks ? (
            <TaskHeaderTarget.Provider
              value={tab === "calendar" ? taskHeaderTarget : null}
            >
              <CalendarTaskReport
                key={selectedTask.id}
                occurrence={selectedTask}
                data={calendarTasks}
                onClose={() => setSelectedTask(null)}
                onSaved={async () => {
                  const next = await refreshCalendarTasks();
                  setSelectedTask(
                    next.occurrences.find(
                      (task) => task.id === selectedTask.id,
                    ) ?? null,
                  );
                }}
              />
            </TaskHeaderTarget.Provider>
          ) : (
            <>
              <div className="flex flex-wrap justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Предыдущая неделя"
                    onClick={() => setWeek(addDays(week, -7))}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-base font-semibold min-w-48 text-center">
                    {dayLabel(days[0], { day: "numeric", month: "short" })} –{" "}
                    {dayLabel(days[6], {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Следующая неделя"
                    onClick={() => setWeek(addDays(week, 7))}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setWeek(weekStart(dateInZone(new Date(), data.timezone)))
                    }
                  >
                    Сегодня
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="mr-2 flex items-center gap-2">
                    <Switch
                      id="calendar-show-tasks"
                      checked={showTasks}
                      onCheckedChange={toggleTasks}
                    />
                    <Label
                      htmlFor="calendar-show-tasks"
                      className="cursor-pointer whitespace-nowrap text-sm"
                    >
                      Показать задачи
                    </Label>
                  </div>
                  {showTasks && pendingTaskReports.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm">
                          На приёмке · {pendingTaskReports.length}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="max-h-[70vh] w-96 max-w-[calc(100vw-32px)] overflow-y-auto p-3"
                      >
                        <p className="mb-1 text-sm font-semibold">
                          Отчёты на приёмке
                        </p>
                        <p className="mb-3 text-[13px] text-muted-foreground">
                          За все дни, включая прошлые недели
                        </p>
                        <div className="space-y-2">
                          {pendingTaskReports.map((task) => (
                            <div key={task.id}>
                              <p className="mb-1 text-xs text-muted-foreground">
                                {dayLabel(task.business_date)}
                              </p>
                              {taskCard(task, false)}
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  {can("shift_create") && (
                    <Button
                      variant={templatesOpen ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setTemplatesOpen(!templatesOpen)}
                      aria-expanded={templatesOpen}
                    >
                      <Layers className="size-4 mr-2" />
                      Шаблоны
                    </Button>
                  )}
                  <Button
                    variant={filters ? "secondary" : "ghost"}
                    size="sm"
                    aria-expanded={filters}
                    onClick={() => setFilters(!filters)}
                  >
                    <SlidersHorizontal className="size-4 mr-2" />
                    Фильтры
                    {(department !== "all" ||
                      query ||
                      publication !== "all") && (
                      <span className="ml-2 size-1.5 rounded-full bg-brand" />
                    )}
                  </Button>
                  <select
                    aria-label="Вид графика"
                    className={cn(selectClass, "w-auto hidden md:block h-9")}
                    value={view}
                    onChange={(e) => setView(e.target.value)}
                  >
                    <option value="week">Неделя</option>
                    <option value="list">Список</option>
                  </select>
                </div>
              </div>
              {showTasks && tasksLoading && !calendarTasks && (
                <p role="status" className="text-sm text-muted-foreground">
                  Загружаем задачи…
                </p>
              )}
              {showTasks && tasksError && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 text-sm text-destructive"
                >
                  <span>Не удалось загрузить задачи</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshCalendarTasks().catch(() => {})}
                  >
                    Повторить
                  </Button>
                </div>
              )}
              {showTasks &&
                !tasksLoading &&
                !tasksError &&
                !weekTasks.length && (
                  <p className="text-sm text-muted-foreground">
                    На этой неделе назначенных задач нет
                  </p>
                )}
              {filters && (
                <div className="flex flex-wrap gap-3 items-end rounded-lg bg-muted/50 p-3">
                  <div className="min-w-48 flex-1">
                    <Input
                      aria-label="Поиск сотрудника"
                      placeholder="Найти сотрудника"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="Подразделение"
                    className={cn(selectClass, "w-auto")}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    <option value="all">Все подразделения</option>
                    {data.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {canPlan && (
                    <select
                      aria-label="Состояние публикации"
                      className={cn(selectClass, "w-auto")}
                      value={publication}
                      onChange={(e) => setPublication(e.target.value)}
                    >
                      <option value="all">Все смены</option>
                      <option value="draft">Черновики</option>
                      <option value="published">Опубликованные</option>
                    </select>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDepartment("all");
                      setQuery("");
                      setPublication("all");
                    }}
                  >
                    Сбросить
                  </Button>
                </div>
              )}
              {templatesOpen && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground mr-2">
                    Перетащите в календарь или выберите шаблон
                  </span>
                  {data.templates
                    .filter((t) => !t.archived)
                    .map((t) => (
                      <button
                        key={t.id}
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/sheerly-template",
                            t.id,
                          )
                        }
                        onClick={() => create(days[0], null, t)}
                        className={cn(
                          "flex gap-2 items-center px-3 py-2 text-xs rounded-lg focus-visible:ring-2 focus-visible:ring-ring",
                          paletteBg(t.color),
                          paletteText(t.color),
                        )}
                      >
                        <GripVertical className="size-3" />
                        {t.name}
                        <span>{formatTemplateTimes(t)}</span>
                      </button>
                    ))}
                  {!data.templates.some((t) => !t.archived) && (
                    <span className="text-sm text-muted-foreground">
                      Шаблонов пока нет
                    </span>
                  )}
                </div>
              )}
              {!staff.length &&
              !openShifts.length &&
              !weekTrials.length &&
              !weekTasks.length ? (
                noData(
                  Users,
                  "Нет сотрудников для выбранных условий",
                  "Сбросьте фильтры или добавьте сотрудников в разделе «Люди».",
                  canPlan ? (
                    <Button asChild variant="outline">
                      <Link href="/people/staff">Перейти к сотрудникам</Link>
                    </Button>
                  ) : undefined,
                )
              ) : (
                <>
                  <div
                    className={cn(
                      "overflow-x-auto rounded-xl border hidden md:block",
                      view === "list" && "md:hidden",
                    )}
                  >
                    <table className="w-full border-collapse table-fixed min-w-[1000px]">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="w-[200px] p-4 text-left text-xs font-medium">
                            Сотрудники · {staff.length}
                          </th>
                          {days.map((d) => (
                            <th
                              key={d}
                              className={cn(
                                "border-l p-3 text-center font-medium",
                                d === dateInZone(new Date(), data.timezone) &&
                                  "bg-brand/5 text-brand",
                              )}
                            >
                              <span className="block text-xs text-muted-foreground mb-1">
                                {dayLabel(d, { weekday: "short" })}
                              </span>
                              <span className="text-base">
                                {dayLabel(d, { day: "numeric" })}
                              </span>
                            </th>
                          ))}
                          <th className="w-16 p-2 border-l text-xs font-medium text-muted-foreground">
                            Часы
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...staff.map((s) => ({
                            id: s.user_id,
                            label: name(s.user_id),
                            role: s.role_name,
                          })),
                          ...(canPlan
                            ? [
                                {
                                  id: null,
                                  label: "Открытые смены",
                                  role: "Без сотрудника",
                                },
                              ]
                            : []),
                        ].map((s) => (
                          <tr key={s.id ?? "open"} className="border-t">
                            <th className="px-4 py-3 text-left font-normal">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full size-8 bg-muted flex items-center justify-center text-xs shrink-0">
                                  {s.id ? (
                                    s.label
                                      .split(" ")
                                      .map((w) => w[0])
                                      .slice(0, 2)
                                      .join("")
                                  ) : (
                                    <Users className="size-4" />
                                  )}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate">
                                    {s.label}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground truncate">
                                    {s.role}
                                  </p>
                                </div>
                              </div>
                            </th>
                            {days.map((d) => (
                              <td
                                key={d}
                                onDragOver={(e) => {
                                  if (can("shift_edit") || can("shift_create"))
                                    e.preventDefault();
                                }}
                                onDrop={(e) => void drop(e, d, s.id)}
                                className={cn(
                                  "border-l p-1.5 align-top h-[80px]",
                                  d === dateInZone(new Date(), data.timezone) &&
                                    "bg-brand/[0.025]",
                                )}
                              >
                                <div className="grid gap-1.5">
                                  {personShifts(s.id, d).map(card)}
                                  {weekTasks
                                    .filter(
                                      (task) =>
                                        task.business_date === d &&
                                        taskRowId(task) === s.id,
                                    )
                                    .map((task) => taskCard(task))}
                                  {can("shift_create") && (
                                    <button
                                      aria-label={`Добавить смену: ${s.label}, ${dayLabel(d)}`}
                                      onClick={() => create(d, s.id)}
                                      className="flex items-center justify-center w-full rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground min-h-8 focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                      <Plus className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            ))}
                            <td className="border-l text-center text-xs font-medium tabular-nums">
                              {personShifts(s.id)
                                .reduce(
                                  (sum, s) =>
                                    sum +
                                    shiftHours(
                                      s.starts_at,
                                      s.ends_at,
                                      s.break_minutes,
                                    ),
                                  0,
                                )
                                .toLocaleString("ru", {
                                  maximumFractionDigits: 1,
                                })}
                            </td>
                          </tr>
                        ))}
                        {trialCandidates.length > 0 && (
                          <tr className="border-t bg-muted/30">
                            <th
                              colSpan={9}
                              className="px-4 py-2 text-left text-xs font-medium text-muted-foreground"
                            >
                              Стажировки · {trialCandidates.length}
                            </th>
                          </tr>
                        )}
                        {trialCandidates.map((candidate) => (
                          <tr key={candidate.candidate_id} className="border-t">
                            <th className="px-4 py-3 text-left font-normal">
                              <Link
                                href={`/people/candidates/${candidate.candidate_id}`}
                                className="block break-words text-xs font-medium hover:underline"
                              >
                                {candidate.full_name}
                              </Link>
                              <span className="mt-1 block text-[11px] text-muted-foreground">
                                {candidate.hired_user_id
                                  ? "Принят на работу"
                                  : "Кандидат"}
                                {candidate.desired_position
                                  ? ` · ${candidate.desired_position}`
                                  : ""}
                              </span>
                            </th>
                            {days.map((day) => (
                              <td key={day} className="border-l p-2 align-top">
                                <div className="space-y-2">
                                  {weekTrials
                                    .filter(
                                      (trial) =>
                                        trial.candidate_id ===
                                          candidate.candidate_id &&
                                        trialDay(trial) === day,
                                    )
                                    .map((trial) => (
                                      <CandidateTrialCard
                                        key={trial.id}
                                        trial={trial}
                                        timezone={data.timezone}
                                      />
                                    ))}
                                </div>
                              </td>
                            ))}
                            <td className="border-l text-center text-xs text-muted-foreground">
                              —
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/50">
                          <th className="p-3 text-left text-xs font-medium">
                            Всего часов
                          </th>
                          {days.map((d) => (
                            <td
                              key={d}
                              className="p-3 border-l text-center text-xs text-muted-foreground tabular-nums"
                            >
                              {weekShifts
                                .filter(
                                  (s) =>
                                    dateInZone(s.starts_at, data.timezone) ===
                                    d,
                                )
                                .reduce(
                                  (sum, s) =>
                                    sum +
                                    shiftHours(
                                      s.starts_at,
                                      s.ends_at,
                                      s.break_minutes,
                                    ),
                                  0,
                                )
                                .toLocaleString("ru", {
                                  maximumFractionDigits: 1,
                                })}
                            </td>
                          ))}
                          <td className="border-l text-center text-xs font-semibold">
                            {weekShifts
                              .reduce(
                                (sum, s) =>
                                  sum +
                                  shiftHours(
                                    s.starts_at,
                                    s.ends_at,
                                    s.break_minutes,
                                  ),
                                0,
                              )
                              .toLocaleString("ru", {
                                maximumFractionDigits: 1,
                              })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div
                    className={cn("space-y-6", view !== "list" && "md:hidden")}
                  >
                    {days.map((d) => (
                      <section key={d}>
                        <h3 className="text-sm font-semibold mb-3">
                          {dayLabel(d, {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })}
                        </h3>
                        <div className="space-y-2">
                          {weekShifts
                            .filter(
                              (s) =>
                                dateInZone(s.starts_at, data.timezone) === d,
                            )
                            .map((s) => (
                              <div
                                key={s.id}
                                className="flex gap-4 items-center"
                              >
                                <div className="flex-1">{card(s)}</div>
                                {canPlan && (
                                  <span className="text-xs text-muted-foreground w-36">
                                    {name(shiftAssignee(s))}
                                  </span>
                                )}
                              </div>
                            ))}
                          {weekTasks
                            .filter((task) => task.business_date === d)
                            .map((task) => taskCard(task, false))}
                          {weekTrials
                            .filter((trial) => trialDay(trial) === d)
                            .map((trial) => (
                              <CandidateTrialCard
                                key={trial.id}
                                trial={trial}
                                timezone={data.timezone}
                                showName
                              />
                            ))}
                          {!weekShifts.some(
                            (s) => dateInZone(s.starts_at, data.timezone) === d,
                          ) &&
                            !weekTrials.some(
                              (trial) => trialDay(trial) === d,
                            ) &&
                            !weekTasks.some(
                              (task) => task.business_date === d,
                            ) && (
                              <p className="text-sm text-muted-foreground">
                                Смен нет
                              </p>
                            )}
                          {can("shift_create") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => create(d)}
                            >
                              <Plus className="size-4 mr-2" />
                              Добавить смену
                            </Button>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>Часовой пояс: {data.timezone}</span>
                <span>Часы указаны за вычетом перерывов</span>
                {showTasks && <span>Задач на неделе: {weekTasks.length}</span>}
                {canPlan && <span>Черновики видны только планировщикам</span>}
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent
          value="tasks"
          forceMount={tasksVisited ? true : undefined}
          hidden={tab !== "tasks"}
        >
          <TaskHeaderTarget.Provider
            value={tab === "tasks" ? taskHeaderTarget : null}
          >
            {tasksVisited && (
              <ScheduleTasksTab
                initial={initialTasks}
                active={tab === "tasks"}
              />
            )}
          </TaskHeaderTarget.Provider>
        </TabsContent>
        <TabsContent value="templates" className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={!archive ? "secondary" : "ghost"}
              onClick={() => setArchive(false)}
            >
              Активные
            </Button>
            <Button
              size="sm"
              variant={archive ? "secondary" : "ghost"}
              onClick={() => setArchive(true)}
            >
              Архив
            </Button>
          </div>
          {!data.templates.some((t) => t.archived === archive) ? (
            noData(
              Layers,
              archive ? "Архив пуст" : "Создайте первый шаблон",
              "Сохраните время, цвет и чек-листы, чтобы быстро планировать повторяющиеся смены.",
            )
          ) : (
            <div className="divide-y border-y">
              {data.templates
                .filter((t) => t.archived === archive)
                .map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center gap-4 py-4"
                  >
                    <span
                      className={cn("size-3 rounded-full", paletteBg(t.color))}
                    />
                    <div className="flex-1 min-w-40">
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatTemplateTimes(t)} · перерыв {t.break_minutes} мин
                        · чек-листов {t.checklist_ids.length}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {can("template_edit") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Изменить ${t.name}`}
                          onClick={() =>
                            setEditor({ type: "template", template: t })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {can("template_copy") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Копировать ${t.name}`}
                          onClick={() =>
                            setEditor({
                              type: "template",
                              template: t,
                              copy: true,
                            })
                          }
                        >
                          <Copy className="size-4" />
                        </Button>
                      )}
                      {can("template_archive") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void save("template.archive", {
                              id: t.id,
                              version: t.version,
                            })
                          }
                        >
                          <Archive className="size-4 mr-2" />
                          {archive ? "Восстановить" : "В архив"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="checklists" className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={!archive ? "secondary" : "ghost"}
              onClick={() => setArchive(false)}
            >
              Активные
            </Button>
            <Button
              size="sm"
              variant={archive ? "secondary" : "ghost"}
              onClick={() => setArchive(true)}
            >
              Архив
            </Button>
          </div>
          {!data.checklists.some((c) => c.archived === archive) ? (
            noData(
              ClipboardCheck,
              archive ? "Архив пуст" : "Создайте чек-лист смены",
              "Добавьте задачи открытия, закрытия или проверки, затем опубликуйте чек-лист.",
            )
          ) : (
            <div className="divide-y border-y">
              {data.checklists
                .filter((c) => c.archived === archive)
                .map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-4 py-4"
                  >
                    <ClipboardCheck className="size-5 text-muted-foreground" />
                    <div className="flex-1 min-w-40">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {c.published ? "Опубликован" : "Черновик"} · v
                        {c.version} · {c.items.length} пунктов · {c.duration}{" "}
                        мин
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {can("review") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReviewChecklist(c.id);
                            setReviewStatus("all");
                            setTab("review");
                          }}
                        >
                          Выполнения ·{" "}
                          {
                            data.runs.filter((r) => r.checklist_id === c.id)
                              .length
                          }
                        </Button>
                      )}
                      {can("checklist_edit") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Изменить ${c.name}`}
                          onClick={() =>
                            setEditor({ type: "checklist", checklist: c })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {can("checklist_publish") && !c.published && !archive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void save("checklist.publish", {
                              id: c.id,
                              version: c.version,
                            })
                          }
                        >
                          Опубликовать
                        </Button>
                      )}
                      {can("checklist_archive") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void save("checklist.archive", {
                              id: c.id,
                              version: c.version,
                            })
                          }
                        >
                          {archive ? "Восстановить" : "В архив"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="review" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <select
              className={selectClass}
              aria-label="Чек-лист для проверки"
              value={reviewChecklist}
              onChange={(e) => setReviewChecklist(e.target.value)}
            >
              <option value="all">Все чек-листы</option>
              {data.checklists.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              aria-label="Статус выполнения"
              value={reviewStatus}
              onChange={(e) => setReviewStatus(e.target.value)}
            >
              <option value="all">Все статусы</option>
              {Object.entries(runLabel).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            {Object.entries(runLabel)
              .map(
                ([status, label]) =>
                  `${label}: ${data.runs.filter((r) => (reviewChecklist === "all" || r.checklist_id === reviewChecklist) && r.status === status).length}`,
              )
              .join(" · ")}
          </p>
          {!data.runs.length ? (
            noData(
              ClipboardCheck,
              "Выполнений пока нет",
              "Здесь появятся чек-листы, которые сотрудники начали или отправили на проверку.",
            )
          ) : (
            <div className="divide-y border-y">
              {data.runs
                .filter(
                  (r) =>
                    (reviewChecklist === "all" ||
                      r.checklist_id === reviewChecklist) &&
                    (reviewStatus === "all" || r.status === reviewStatus),
                )
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRun(r)}
                    className="flex gap-4 items-center py-4 text-left w-full hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ClipboardCheck className="size-5 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{r.snapshot.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {name(r.user_id)} · v{r.snapshot.version} ·{" "}
                        {dayLabel(dateInZone(r.started_at, data.timezone))}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "text-xs rounded-full px-3 py-1",
                        r.status === "submitted"
                          ? "bg-brand/10 text-brand"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {runLabel[r.status]}
                    </span>
                  </button>
                ))}
              {!data.runs.some(
                (r) =>
                  (reviewChecklist === "all" ||
                    r.checklist_id === reviewChecklist) &&
                  (reviewStatus === "all" || r.status === reviewStatus),
              ) && (
                <p className="py-6 text-sm text-muted-foreground">
                  Нет выполнений для выбранных условий
                </p>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="team" className="space-y-6">
          <div className="flex flex-wrap justify-between gap-4 items-center">
            <p className="text-sm text-muted-foreground">
              Подразделения и основные позиции настраиваются в разделе «Люди».
            </p>
            {data.permissions.includes("people.view_roles") && (
              <Button variant="outline" asChild>
                <Link href="/people/departments">Подразделения</Link>
              </Button>
            )}
            {can("qualifications") && (
              <Button variant="outline" onClick={() => setQualification(true)}>
                Дополнительные позиции
              </Button>
            )}
          </div>
          <div className="divide-y border-y">
            {data.staff.map((s) => (
              <div key={s.user_id} className="py-4 flex gap-4 justify-between">
                <div>
                  <p className="text-sm font-medium">{name(s.user_id)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {s.role_name} ·{" "}
                    {data.departments.find((d) => d.id === s.department_id)
                      ?.name ?? "Без подразделения"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.qualifications
                    .filter((q) => q.user_id === s.user_id)
                    .map(
                      (q) => data.roles.find((r) => r.id === q.role_id)?.name,
                    )
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      {editor?.type === "shift" && (
        <ShiftEditor
          key={`${editor.shift?.id ?? "new"}-${editor.copy}`}
          data={data}
          {...editor}
          onClose={() => setEditor(null)}
          save={save}
        />
      )}
      {editor?.type === "template" && (
        <TemplateEditor
          key={`${editor.template?.id ?? "new"}-${editor.copy}`}
          data={data}
          {...editor}
          onClose={() => setEditor(null)}
          save={save}
        />
      )}
      {editor?.type === "checklist" && (
        <ChecklistEditor
          key={editor.checklist?.id ?? "new"}
          data={data}
          {...editor}
          onClose={() => setEditor(null)}
          save={save}
        />
      )}
      {selected && (
        <EditDrawer
          open
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
          title={selected.title}
          description={`${dayLabel(dateInZone(selected.starts_at, data.timezone))} · ${timeInZone(selected.starts_at, data.timezone)}–${timeInZone(selected.ends_at, data.timezone)} · ${selected.published ? "Опубликована" : "Черновик"}`}
          footer={
            <>
              {can("shift_delete") && (
                <Button
                  variant="ghost"
                  className="text-destructive mr-auto"
                  aria-label="Удалить смену"
                  onClick={() =>
                    setConfirmation({
                      title: "Удалить смену?",
                      description:
                        "Смена будет удалена из расписания. Смену с начатым выполнением удалить нельзя.",
                      action: async () => {
                        if (
                          await save("shift.delete", {
                            id: selected.id,
                            version: selected.version,
                          })
                        )
                          setSelected(null);
                      },
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
              {can("shift_copy") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditor({
                      type: "shift",
                      shift: selected,
                      day: dateInZone(selected.starts_at, data.timezone),
                      copy: true,
                    });
                    setSelected(null);
                  }}
                >
                  <Copy className="size-4 mr-2" />
                  Копировать
                </Button>
              )}
              {can("shift_edit") && (
                <Button
                  onClick={() => {
                    setEditor({
                      type: "shift",
                      shift: selected,
                      day: dateInZone(selected.starts_at, data.timezone),
                    });
                    setSelected(null);
                  }}
                >
                  Изменить
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p>
              {name(shiftAssignee(selected))}
              {selected.payroll_employee_id && (
                <span className="text-muted-foreground">
                  {" "}
                  · начисление по графику
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              {data.roles.find((r) => r.id === selected.role_id)?.name ??
                "Без позиции"}{" "}
              ·{" "}
              {data.departments.find((d) => d.id === selected.department_id)
                ?.name ?? "Без подразделения"}
            </p>
            <p>
              Перерыв {selected.break_minutes} мин · прийти за{" "}
              {selected.arrival_minutes} мин
            </p>
            {selected.note && (
              <p className="whitespace-pre-wrap pt-2">{selected.note}</p>
            )}
          </div>
          {!selected.published && can("shift_publish") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (await publishShifts([selected])) setSelected(null);
              }}
            >
              Опубликовать смену
            </Button>
          )}
          {can("shift_assign") && !can("shift_edit") && (
            <Field label="Назначить сотрудника">
              <select
                className={selectClass}
                value={shiftAssignee(selected) ?? ""}
                onChange={async (e) => {
                  if (
                    await save("shift.assign", {
                      id: selected.id,
                      version: selected.version,
                      ...assignmentFields(e.target.value || null),
                      payroll_model_id: e.target.value.startsWith("payroll:")
                        ? (data.casualEmployees?.find(
                            (p) => p.id === e.target.value.slice(8),
                          )?.model_id ?? null)
                        : null,
                    })
                  )
                    setSelected(null);
                }}
              >
                <option value="">Без сотрудника</option>
                {selected.payroll_employee_id && (
                  <option value={shiftAssignee(selected)!}>
                    {name(shiftAssignee(selected))}
                  </option>
                )}
                {data.staff.map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {name(s.user_id)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <h3 className="text-base font-semibold">Чек-листы смены</h3>
          {!selected.checklist_ids.length && (
            <p className="text-sm text-muted-foreground">Чек-листов нет</p>
          )}
          {selected.checklist_ids.map((id) => {
            const c = data.checklists.find((c) => c.id === id);
            const r = data.runs.find(
              (r) => r.shift_id === selected.id && r.checklist_id === id,
            );
            return (
              <div key={id} className="border-b pb-4 grid gap-2">
                <p className="text-sm font-medium">
                  {r?.snapshot.name ??
                    selected.checklist_snapshots?.[id]?.name ??
                    c?.name ??
                    "Чек-лист"}
                </p>
                <span className="text-xs text-muted-foreground">
                  {r
                    ? runLabel[r.status]
                    : !selected.checklist_snapshots?.[id]
                      ? "Требует публикации"
                      : "Не начат"}
                </span>
                {selected.published && selected.user_id === data.userId && (
                  <Button
                    disabled={
                      busy || (!r && !selected.checklist_snapshots?.[id])
                    }
                    variant="outline"
                    onClick={() => void startRun(selected, id)}
                  >
                    {r ? "Открыть выполнение" : "Начать чек-лист"}
                  </Button>
                )}
                {r && can("review") && selected.user_id !== data.userId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(null);
                      setRun(r);
                    }}
                  >
                    Открыть выполнение
                  </Button>
                )}
              </div>
            );
          })}
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              История изменений
            </summary>
            <div className="mt-4 space-y-3">
              {history.map((e) => (
                <div key={e.id} className="text-sm">
                  <p>{eventLabels[e.action] ?? e.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("ru", {
                      timeZone: data.timezone,
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(e.created_at))}
                  </p>
                </div>
              ))}
            </div>
          </details>
        </EditDrawer>
      )}
      {run && (
        <RunPanel
          key={run.id}
          run={run}
          data={data}
          onClose={() => setRun(null)}
          onUpdated={refresh}
        />
      )}
      {qualification && (
        <EditDrawer
          open
          onOpenChange={setQualification}
          title="Дополнительные позиции"
          description="Допускают сотрудника к смене на другой позиции. Права доступа не меняются."
          footer={
            <Button variant="outline" onClick={() => setQualification(false)}>
              Готово
            </Button>
          }
        >
          <Field label="Сотрудник">
            <select
              className={selectClass}
              value={qualUser}
              onChange={(e) => setQualUser(e.target.value)}
            >
              <option value="">Выберите сотрудника</option>
              {data.staff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {name(s.user_id)}
                </option>
              ))}
            </select>
          </Field>
          {qualUser && (
            <>
              <p className="text-sm text-muted-foreground">
                Основная позиция:{" "}
                {data.staff.find((s) => s.user_id === qualUser)?.role_name}
              </p>
              {data.qualifications
                .filter((q) => q.user_id === qualUser)
                .map((q) => (
                  <div key={q.id} className="flex items-center justify-between">
                    <span className="text-sm">
                      {data.roles.find((r) => r.id === q.role_id)?.name}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Убрать позицию"
                      onClick={() =>
                        void save("qualification.save", {
                          user_id: qualUser,
                          role_id: q.role_id,
                          remove: true,
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              <Field label="Добавить позицию">
                <select
                  className={selectClass}
                  value={qualRole}
                  onChange={(e) => setQualRole(e.target.value)}
                >
                  <option value="">Выберите позицию</option>
                  {data.roles
                    .filter(
                      (r) =>
                        r.id !==
                          data.staff.find((s) => s.user_id === qualUser)
                            ?.role_id &&
                        !data.qualifications.some(
                          (q) => q.user_id === qualUser && q.role_id === r.id,
                        ),
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Button
                disabled={!qualRole}
                onClick={async () => {
                  if (
                    await save("qualification.save", {
                      user_id: qualUser,
                      role_id: qualRole,
                      remove: false,
                    })
                  )
                    setQualRole("");
                }}
              >
                Добавить позицию
              </Button>
            </>
          )}
        </EditDrawer>
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(o) => {
          if (!o && !busy) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Отмена
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await confirmation?.action();
                  setConfirmation(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmation?.title === "Удалить смену?"
                ? "Удалить смену"
                : "Опубликовать смены"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
