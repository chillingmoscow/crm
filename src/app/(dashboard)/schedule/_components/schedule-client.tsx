"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { shiftAssignee, assignmentFields, shiftTemplateLabel } from "@/lib/schedule/types";
import {
  CalendarDays,
  ChevronDown,
  Plus,
  Layers,
  Copy,
  Trash2,
  Send,
  Users,
  GripVertical,
  ListChecks,
  CheckCircle2,
  Eye,
  Pencil,
  UserMinus,
  UserPlus,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Calendar } from "@/components/ui/calendar";
import { PeriodStepper, periodTriggerClass } from "@/components/shared/period-stepper";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { TableControls, TableIconButton, TablePageHeader } from "@/components/shared/table";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PageFrame } from "@/components/shared/page-frame";
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
  ScheduleData,
  Shift,
  ShiftTemplate,
  ScheduleEvent,
} from "@/lib/schedule/types";
import { loadShiftAttendance, loadSchedule, scheduleCommand, scheduleHistory } from "../actions";
import { ShiftAttendancePopover } from "./shift-attendance-popover";
import type { ShiftAttendanceMark } from "@/lib/payroll/types";
import {
  ShiftEditor,
  TemplateEditor,
  Field,
  type Save,
  formatTemplateTimes,
  isoWeekday,
} from "./editors";
import { EmployeePicker } from "./employee-picker";
import { ApplyTemplateDialog } from "./apply-template-dialog";
import { templateTimesFor } from "@/lib/schedule/template-times";
import { CandidateTrialCard } from "./candidate-trial-card";
import { toast } from "sonner";
import { TemplateList } from "./template-list";
import { ViewMenu } from "./view-menu";
import { TemplateWeek } from "./template-week";
import { TemplateName } from "./template-name";
import { TaskHeaderTarget, TaskTitleTarget } from "./task-header-actions";
import {
  taskStatus,
  type CalendarTaskData,
  type TaskOccurrence,
} from "@/lib/schedule/tasks";
import { loadCalendarTasks } from "../tasks/actions";
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
      templateSlot?: boolean;
      copy?: boolean;
    }
  | { type: "template"; template?: ShiftTemplate; copy?: boolean };
type DragItem =
  | { kind: "shift"; shift: Shift }
  | { kind: "template"; template: ShiftTemplate };
type DropTarget = { day: string; userId: string | null; ok: boolean };
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
  section = "calendar",
  initialCalendarTasks = null,
  initialShowTasks,
  initialDate,
  initialView,
}: {
  initial: ScheduleData;
  section?: "calendar" | "templates";
  initialCalendarTasks?: CalendarTaskData | null;
  initialShowTasks?: boolean;
  initialDate?: string;
  initialView?: "templates";
}) {
  const [data, setData] = useState(initial);
  const tab = section;
  const [screenTitle, setScreenTitle] = useState<string | null>(null);
  const [taskHeaderTarget, setTaskHeaderTarget] =
    useState<HTMLDivElement | null>(null);
  const [week, setWeek] = useState(
    weekStart(initialDate ?? dateInZone(new Date(), initial.timezone)),
  );
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  useEffect(() => {
    if (initialDate) setWeek(weekStart(initialDate));
  }, [initialDate]);
  const [showTasks, setShowTasks] = useState(
    initialShowTasks ?? !initial.permissions.includes("schedule.view_all"),
  );
  const [calendarTasks, setCalendarTasks] = useState(initialCalendarTasks);
  const [calendarTasksWeek, setCalendarTasksWeek] = useState(week);
  const serverTasksWeek = useRef(initialCalendarTasks ? week : null);
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
    if (!enabled) serverTasksWeek.current = null;
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
  const refreshCalendarTasks = useCallback(async (refreshSchedule = false) => {
    const request = ++tasksRequest.current;
    try {
      const [next, schedule] = await Promise.all([
        loadCalendarTasks({ from: week, to: addDays(week, 6) }),
        refreshSchedule ? loadSchedule() : null,
      ]);
      if (request === tasksRequest.current) {
        if (schedule) setData(schedule);
        setCalendarTasks(next);
        setCalendarTasksWeek(week);
        setTasksError(false);
      }
      return next;
    } catch (error) {
      if (request === tasksRequest.current) {
        setTasksError(true);
      }
      throw error;
    }
  }, [week]);
  useEffect(() => {
    if (!showTasks || tab !== "calendar") return;
    if (serverTasksWeek.current !== week) {
      serverTasksWeek.current = null;
      void refreshCalendarTasks().catch(() => {});
    }
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refreshCalendarTasks(true).catch(() => {});
    }, 60000);
    return () => {
      // This counter invalidates requests started by both the initial load and later polling.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      tasksRequest.current++;
      clearInterval(timer);
    };
  }, [showTasks, tab, week, refreshCalendarTasks]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [publication, setPublication] = useState("all");
  const [view, setView] = useState(
    initial.permissions.includes("schedule.view_all") ? initialView ?? "week" : "week",
  );
  const changeView = (next: string) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "templates") url.searchParams.set("view", next);
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  };
  const [editor, setEditor] = useState<Editor | null>(null);
  const [applyTemplate, setApplyTemplate] = useState<{
    id: string;
    previousTitle: string;
  } | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const dragActive = useRef(false);
  // Состояние меняем после dragstart: правка DOM внутри обработчика
  // портит снимок перетаскиваемой карточки в Chrome.
  const startDrag = (item: DragItem) => {
    dragActive.current = true;
    setTimeout(() => {
      if (dragActive.current) setDragItem(item);
    }, 0);
  };
  const endDrag = () => {
    dragActive.current = false;
    setDragItem(null);
    setDropTarget(null);
    setOverTrash(false);
  };
  const [selected, setSelected] = useState<Shift | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ScheduleEvent[]>([]);
  const can = useCallback(
    (p: string) => data.permissions.includes("schedule." + p),
    [data.permissions],
  );
  const canPlan = can("view_all");
  const templateView = canPlan && view === "templates";
  const canViewAttendance = canPlan && data.permissions.includes("payroll.view");
  const [attendance, setAttendance] = useState<{
    week: string;
    marks: Record<string, ShiftAttendanceMark>;
  } | null>(null);
  useEffect(() => {
    if (tab !== "calendar" || !canViewAttendance) return;
    let active = true;
    const load = () => {
      void loadShiftAttendance(week)
        .then((marks) => {
          if (active) setAttendance({ week, marks });
        })
        .catch(() => {
          if (active) setAttendance(null);
        });
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tab, canViewAttendance, week, data.shifts]);
  const attendanceMark = (shift: Shift) => {
    if (!canViewAttendance || !shift.published || !shiftAssignee(shift) || attendance?.week !== week) return;
    const mark = attendance.marks[shift.id];
    if (mark && (mark.shiftVersion !== undefined
      ? mark.shiftVersion === shift.version
      : mark.syncedAt && Date.parse(mark.syncedAt) >= Date.parse(shift.updated_at))) return mark;
  };
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
      avatar_url: null,
      show_in_schedule: true,
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
  const weekDateShifts = data.shifts.filter((shift) =>
    days.includes(dateInZone(shift.starts_at, data.timezone)),
  );
  const weekShifts = weekDateShifts.filter(
    (s) =>
      (!search ||
        (shiftAssignee(s)
          ? matchingStaff.has(shiftAssignee(s)!)
          : "без сотрудника открытые смены".includes(search))) &&
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
      ((!s.user_id.startsWith("payroll:") && s.show_in_schedule) ||
        weekShifts.some((shift) => shiftAssignee(shift) === s.user_id)) &&
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
  const plannedTasks: TaskOccurrence[] = canPlan
    ? (calendarTasks?.plans ?? [])
        .filter(
          (plan) =>
            plan.business_date > (calendarTasks?.today ?? "") &&
            !calendarTasks?.occurrences.some(
              (o) =>
                o.definition_id === plan.definition_id &&
                o.business_date === plan.business_date,
            ),
        )
        .map((plan) => {
          const matches = data.shifts.filter(
            (shift) =>
              shift.template_id === plan.snapshot.template_id &&
              dateInZone(shift.starts_at, data.timezone) === plan.business_date,
          );
          const shift = matches.length === 1 ? matches[0] : null;
          const person = data.staff.find((p) => p.user_id === shift?.user_id);
          return {
            id: `plan:${plan.definition_id}:${plan.business_date}`,
            planned: true,
            venue_id: data.venueId,
            definition_id: plan.definition_id,
            business_date: plan.business_date,
            shift_id: shift?.id ?? null,
            employee_id: null,
            user_id: shift?.user_id ?? null,
            employee_name: person
              ? [person.first_name, person.last_name].filter(Boolean).join(" ")
              : plan.employee,
            snapshot: plan.snapshot,
            answers: {},
            status: "assigned",
            transferred: false,
            deadline_at: null,
            submitted_at: null,
            completed_at: null,
            review_comment: "",
            blocker:
              plan.snapshot.instruction_page_id &&
              !plan.snapshot.instruction_snapshot
                ? "Страница инструкции недоступна"
                : matches.length > 1
                  ? "Несколько подходящих смен"
                  : !shift
                    ? "Смена ещё не назначена"
                    : "",
            version: 0,
            adjustment_id: null,
            equipment: [],
          };
        })
    : [];
  const weekTasks =
    showTasks && calendarTasksWeek === week
      ? [...(calendarTasks?.occurrences ?? []), ...plannedTasks].filter(
          (task) => {
            if (
              !days.includes(task.business_date) ||
              (publication === "draft" && !task.planned)
            )
            return false;
          const assignee = taskRowId(task);
          if (assignee ? !visibleStaffIds.has(assignee) : !canPlan)
            return false;
            const shift = data.shifts.find(
              (entry) => entry.id === task.shift_id,
            );
            if (
              shift &&
              ((publication === "published" && !shift.published) ||
                (publication === "draft" && shift.published))
            )
              return false;
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
          },
        )
      : [];
  const taskCard = (task: TaskOccurrence, compact = true) => (
    <button
      key={task.id}
      onClick={() => setSelectedTask(task)}
      aria-label={`Задача: ${task.snapshot.name}, ${task.planned ? "План" : taskStatus[task.status]}`}
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
          {task.planned && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              План
            </span>
          )}
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
  const occupied = (userId: string | null, day: string, except?: string) =>
    !!userId && data.shifts.some((shift) =>
      shift.id !== except && shiftAssignee(shift) === userId &&
      dateInZone(shift.starts_at, data.timezone) === day,
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
    templateSlot = false,
  ) =>
    setEditor({
      type: "shift",
      day,
      userId: can("shift_assign") ? userId : null,
      template,
      templateSlot,
    });
  /** Смена вернулась в свою же ячейку — сохранять нечего. */
  const sameCell = (item: DragItem, day: string, userId: string | null) =>
    item.kind === "shift" &&
    dateInZone(item.shift.starts_at, data.timezone) === day &&
    shiftAssignee(item.shift) === userId;
  const canDrop = (item: DragItem, day: string, userId: string | null) =>
    item.kind === "template"
      ? can("shift_create") && !occupied(userId, day)
      : can("shift_edit") && !occupied(userId, day, item.shift.id);
  const dragOver = (e: React.DragEvent, day: string, userId: string | null) => {
    if (!dragItem) return;
    const ok = sameCell(dragItem, day, userId) || canDrop(dragItem, day, userId);
    if (ok) {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragItem.kind === "template" ? "copy" : "move";
    }
    if (dropTarget?.day !== day || dropTarget.userId !== userId || dropTarget.ok !== ok)
      setDropTarget({ day, userId, ok });
  };
  const dragLeave = (e: React.DragEvent, day: string, userId: string | null) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropTarget((current) =>
      current?.day === day && current.userId === userId ? null : current,
    );
  };
  const confirmDelete = (shift: Shift) =>
    setConfirmation({
      title: "Удалить смену?",
      description:
        "Смена будет удалена из расписания. Смену с начатым выполнением удалить нельзя.",
      action: async () => {
        if (
          await save("shift.delete", {
            id: shift.id,
            version: shift.version,
          })
        )
          setSelected((current) => (current?.id === shift.id ? null : current));
      },
    });
  const unassign = (shift: Shift) =>
    void save("shift.assign", {
      id: shift.id,
      version: shift.version,
      user_id: null,
      payroll_employee_id: null,
      payroll_model_id: null,
    });
  const drop = async (
    e: React.DragEvent,
    day: string,
    userId: string | null,
  ) => {
    e.preventDefault();
    const item = dragItem;
    endDrag();
    const template = data.templates.find(
      (t) => t.id === e.dataTransfer.getData("application/sheerly-template"),
    );
    if (template && can("shift_create")) {
      if (occupied(userId, day)) return;
      create(day, userId, template);
      return;
    }
    const shift = data.shifts.find(
      (s) => s.id === e.dataTransfer.getData("application/sheerly-shift"),
    );
    if (!shift || (item && sameCell(item, day, userId))) return;
    if (
      dateInZone(shift.starts_at, data.timezone) === day &&
      shiftAssignee(shift) === userId
    )
      return;
    if (!can("shift_edit") || occupied(userId, day, shift.id)) return;
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
  const cellTemplates = (day: string) =>
    data.templates.filter(
      (t) => !t.archived && templateTimesFor(t, isoWeekday(day)) !== null,
    );
  const templatesById = new Map(data.templates.map((template) => [template.id, template]));
  const shiftTemplate = (shift: Shift) => {
    const template = shift.template_id ? templatesById.get(shift.template_id) : undefined;
    return template?.subtitle && (shift.title === template.name || shift.title === shiftTemplateLabel(template))
      ? template
      : undefined;
  };
  const selectedTemplate = selected ? shiftTemplate(selected) : undefined;
  const card = (s: Shift, mode: "shift" | "full" | "template" = "shift") => {
    const mark = attendanceMark(s);
    const template = shiftTemplate(s);
    const assignee = shiftAssignee(s);
    const assignOpenShift = mode === "template" && !assignee && can("shift_assign");
    const assigneeLabel = assignOpenShift ? "Назначить" : name(assignee);
    const day = dateInZone(s.starts_at, data.timezone);
    const assignSlot = () =>
      setEditor({ type: "shift", shift: s, day, templateSlot: true });
    const dragged = dragItem?.kind === "shift" && dragItem.shift.id === s.id;
    return (
    <ContextMenu key={s.id} modal={false}>
    <ContextMenuTrigger asChild>
    <div className="relative min-w-0">
    <button
      draggable={can("shift_edit")}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/sheerly-shift", s.id);
        e.dataTransfer.effectAllowed = "move";
        startDrag({ kind: "shift", shift: s });
      }}
      onDragEnd={endDrag}
      onClick={() => {
        if (assignOpenShift) {
          assignSlot();
        } else {
          setSelected(s);
        }
      }}
      aria-label={mode === "template"
        ? `${assigneeLabel}: ${template ? shiftTemplateLabel(template) : s.title}, ${dayLabel(dateInZone(s.starts_at, data.timezone))}`
        : undefined}
      className={cn(
        "w-full rounded-md px-1.5 py-2 text-left grid gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity hover:opacity-80",
        can("shift_edit") && "cursor-grab active:cursor-grabbing",
        dragged && "opacity-40",
        paletteBg(s.color),
        paletteText(s.color),
      )}
    >
      <span className={cn("whitespace-nowrap text-[11px] font-semibold tabular-nums", mark && "pr-5")}>
        {timeInZone(s.starts_at, data.timezone)}–
        {timeInZone(s.ends_at, data.timezone)}
      </span>
      {mode !== "template" && (
        template
          ? <span className="text-xs"><TemplateName {...template} /></span>
          : <span className={cn("text-xs", mode === "shift" && "truncate")}>{s.title}</span>
      )}
      {mode !== "shift" && <span className={cn("break-words text-xs", mode === "template" && "font-medium")}>{assigneeLabel}</span>}
      {!s.published && (
        <span className="flex gap-1 items-center text-[10px]">
          <span className="size-1.5 rounded-full bg-current" />
          Черновик
        </span>
      )}
    </button>
    {mark && <ShiftAttendancePopover shiftId={s.id} version={s.version} mark={mark} canReview={data.permissions.includes("payroll.review")} />}
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuLabel>
        {timeInZone(s.starts_at, data.timezone)}–{timeInZone(s.ends_at, data.timezone)} · {name(assignee)}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={() => setSelected(s)}>
        <Eye />
        Открыть
      </ContextMenuItem>
      {can("shift_edit") && (
        <ContextMenuItem onSelect={() => setEditor({ type: "shift", shift: s, day })}>
          <Pencil />
          Изменить
        </ContextMenuItem>
      )}
      {can("shift_copy") && (
        <ContextMenuItem onSelect={() => setEditor({ type: "shift", shift: s, day, copy: true })}>
          <Copy />
          Копировать на другой день
        </ContextMenuItem>
      )}
      {!s.published && can("shift_publish") && (
        <ContextMenuItem disabled={busy} onSelect={() => void publishShifts([s]).then((ok) => ok && toast.success("Смена опубликована"))}>
          <Send />
          Опубликовать
        </ContextMenuItem>
      )}
      {can("shift_assign") && (assignee ? (
        <ContextMenuItem onSelect={() => unassign(s)}>
          <UserMinus />
          Снять сотрудника
        </ContextMenuItem>
      ) : s.template_id && can("shift_create") ? (
        <ContextMenuItem onSelect={assignSlot}>
          <UserPlus />
          Назначить сотрудника
        </ContextMenuItem>
      ) : null)}
      {can("shift_delete") && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => confirmDelete(s)}>
            <Trash2 />
            Удалить
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
    </ContextMenu>
    );
  };
  /** Полупрозрачная «тень» смены в ячейке, куда она упадёт. */
  const dropGhost = (day: string, userId: string | null) => {
    if (!dragItem || dropTarget?.day !== day || dropTarget.userId !== userId) return null;
    if (!dropTarget.ok)
      return (
        <div className="rounded-md border border-dashed border-destructive/50 bg-destructive/5 px-1.5 py-2 text-[11px] text-destructive">
          {dragItem.kind === "shift" && !can("shift_edit") ? "Нет права переносить" : "Уже есть смена в этот день"}
        </div>
      );
    if (sameCell(dragItem, day, userId)) return null;
    const color = dragItem.kind === "shift" ? dragItem.shift.color : dragItem.template.color;
    const times = dragItem.kind === "shift"
      ? `${timeInZone(dragItem.shift.starts_at, data.timezone)}–${timeInZone(dragItem.shift.ends_at, data.timezone)}`
      : (() => {
          const t = templateTimesFor(dragItem.template, isoWeekday(day));
          return t ? `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}` : "Шаблон не действует в этот день";
        })();
    const title = dragItem.kind === "shift"
      ? (shiftTemplate(dragItem.shift) ? shiftTemplateLabel(shiftTemplate(dragItem.shift)!) : dragItem.shift.title)
      : shiftTemplateLabel(dragItem.template);
    return (
      <div
        aria-hidden
        className={cn(
          "pointer-events-none grid gap-1 rounded-md border-2 border-dashed border-current px-1.5 py-2 opacity-70",
          paletteBg(color),
          paletteText(color),
        )}
      >
        <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums">{times}</span>
        <span className="truncate text-xs">{title}</span>
      </div>
    );
  };
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
  const calendarVisible = tab === "calendar" && !(selectedTask && calendarTasks);
  const canPublish = can("shift_publish") && draftShifts.length > 0;
  const filtersActive = department !== "all" || publication !== "all";
  const today = dateInZone(new Date(), data.timezone);
  return (
    <TaskTitleTarget.Provider value={setScreenTitle}>
    <PageFrame className="space-y-6">
      {calendarVisible && (
        <>
          <PageBreadcrumb>
            <nav aria-label="Навигация по разделам" className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-muted-foreground">График работы</span>
              <span aria-hidden="true" className="text-muted-foreground">/</span>
              <span className="truncate">Расписание</span>
            </nav>
          </PageBreadcrumb>
          <TablePageHeader
            title="Расписание"
            className="md:flex-wrap md:items-center [&>div:last-child]:max-w-full"
            actions={
              <TableControls
                search={{
                  value: query,
                  onChange: setQuery,
                  open: searchOpen,
                  onOpenChange: setSearchOpen,
                  placeholder: "Найти сотрудника",
                }}
                filters={{
                  active: filters || filtersActive,
                  onClick: () => setFilters(!filters),
                }}
                secondaryActions={
                  <>
                    {can("shift_create") && !templateView && (
                      <TableIconButton
                        label={templatesOpen ? "Скрыть шаблоны смен" : "Показать шаблоны смен"}
                        active={templatesOpen}
                        onClick={() => setTemplatesOpen(!templatesOpen)}
                      >
                        <Layers />
                      </TableIconButton>
                    )}
                    <TableIconButton
                      label={showTasks ? "Скрыть задачи" : "Показать задачи"}
                      active={showTasks}
                      onClick={() => toggleTasks(!showTasks)}
                    >
                      <ListChecks />
                    </TableIconButton>
                    <ViewMenu
                      value={templateView ? "templates" : view === "list" ? "list" : "week"}
                      onChange={changeView}
                      canPlan={canPlan}
                    />
                  </>
                }
                primaryActions={
                  <>
                    {can("shift_create") && (
                      <Button size="sm" className="h-8 sm:h-9" variant={canPublish ? "outline" : "default"} onClick={() => create(today)}>
                        <Plus />
                        Новая смена
                      </Button>
                    )}
                    {canPublish && (
                      <Button size="sm" className="h-8 sm:h-9" disabled={busy} onClick={publish}>
                        <Send />
                        Опубликовать · {draftShifts.length}
                      </Button>
                    )}
                  </>
                }
              />
            }
          />
        </>
      )}
      {tab === "calendar" && !calendarVisible && (
        <TablePageHeader
          title={screenTitle ?? "Расписание"}
          actions={<div ref={setTaskHeaderTarget} className="flex flex-wrap items-center gap-2" />}
        />
      )}
        {tab === "calendar" && (
          <section className="space-y-5">
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
                <div className="flex flex-wrap items-center gap-2">
                  <PeriodStepper
                    previous="Предыдущая неделя"
                    next="Следующая неделя"
                    onPrevious={() => setWeek(addDays(week, -7))}
                    onNext={() => setWeek(addDays(week, 7))}
                  >
                    <Popover open={weekPickerOpen} onOpenChange={setWeekPickerOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" className={periodTriggerClass} aria-label="Выбрать неделю расписания">
                          <CalendarDays className="size-4 shrink-0" />
                          <span className="whitespace-nowrap">
                            {dayLabel(days[0], { day: "numeric", month: "short" })} –{" "}
                            {dayLabel(days[6], { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <ChevronDown className="size-3 shrink-0" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-auto p-0">
                        <Calendar
                          mode="single"
                          locale={ru}
                          weekStartsOn={1}
                          defaultMonth={new Date(week + "T12:00:00")}
                          selected={new Date(week + "T12:00:00")}
                          captionLayout="dropdown"
                          onSelect={(date) => {
                            if (!date) return;
                            setWeek(weekStart(format(date, "yyyy-MM-dd")));
                            setWeekPickerOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </PeriodStepper>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                        setWeek(
                          weekStart(dateInZone(new Date(), data.timezone)),
                        )
                    }
                  >
                    Сегодня
                  </Button>
                  {(filters || filtersActive) && (
                    <div className="flex flex-wrap items-center gap-2 sm:ml-2" aria-label="Фильтры расписания">
                      <TableFilterChip
                        label="Подразделение"
                        value={department === "all" ? "" : department}
                        options={[
                          { value: "", label: "Все подразделения" },
                          ...data.departments.map(({ id, name }) => ({ value: id, label: name })),
                        ]}
                        onChange={(value) => setDepartment(value || "all")}
                      />
                      {canPlan && (
                        <TableFilterChip
                          label="Публикация"
                          value={publication === "all" ? "" : publication}
                          options={[
                            { value: "", label: "Все смены" },
                            { value: "draft", label: "Черновики" },
                            { value: "published", label: "Опубликованные" },
                          ]}
                          onChange={(value) => setPublication(value || "all")}
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
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
                </div>
              </div>
              {showTasks && tasksError && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 text-sm text-destructive"
                >
                  <span>Не удалось загрузить задачи</span>
                  <Button
                    variant="outline"
                    size="sm"
                      onClick={() =>
                        void refreshCalendarTasks().catch(() => {})
                      }
                  >
                    Повторить
                  </Button>
                </div>
              )}
              {templatesOpen && !templateView && (
                <section aria-label="Шаблоны смен" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2.5">
                  <h2 className="shrink-0 text-xs font-semibold text-muted-foreground">Шаблоны смен</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {data.templates.filter((t) => !t.archived).map((t) => (
                      <Button
                        key={t.id}
                        variant="ghost"
                        size="sm"
                        draggable
                        className={cn("h-8 cursor-grab gap-1.5 px-2 active:cursor-grabbing", paletteBg(t.color), paletteText(t.color))}
                        title={formatTemplateTimes(t)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/sheerly-template", t.id);
                          e.dataTransfer.effectAllowed = "copy";
                          startDrag({ kind: "template", template: t });
                        }}
                        onDragEnd={endDrag}
                        onClick={() => create(days[0], null, t)}
                      >
                        <GripVertical className="size-3 opacity-60" />
                        {shiftTemplateLabel(t)}
                      </Button>
                    ))}
                    {!data.templates.some((t) => !t.archived) && (
                      <span className="text-sm text-muted-foreground">Шаблонов пока нет</span>
                    )}
                  </div>
                </section>
              )}
              {templateView ? (
                <TemplateWeek
                  days={days}
                  today={today}
                  timezone={data.timezone}
                  templates={data.templates.filter((template) => !template.archived &&
                    (department === "all" || template.department_id === department))}
                  shifts={weekDateShifts}
                  visibleShifts={weekShifts}
                  tasks={weekTasks}
                  showVacancies={!search && publication === "all"}
                  onAssign={can("shift_create") && can("shift_assign")
                    ? (day, template) => create(day, null, template, true)
                    : undefined}
                  renderShift={(shift, showTitle) => card(shift, showTitle ? "full" : "template")}
                  renderTask={(task) => taskCard(task)}
                  empty={noData(Layers, "Нет смен по выбранным условиям", "Проверьте шаблоны смен или сбросьте фильтры.")}
                />
              ) : !staff.length &&
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
                      "hidden max-h-[72dvh] overflow-auto rounded-lg border bg-card md:block",
                      view === "list" && "md:hidden",
                    )}
                  >
                    <table aria-label="Расписание на неделю" className="w-full min-w-[900px] table-fixed border-separate border-spacing-0">
                      <thead className="sticky top-0 z-20">
                        <tr className="bg-muted text-muted-foreground">
                          <th scope="col" className="sticky left-0 z-10 w-[214px] border-b bg-muted px-4 py-3 text-left text-xs font-medium">
                            Сотрудники · {staff.length}
                          </th>
                          {days.map((d) => (
                            <th
                              key={d}
                              scope="col"
                              className={cn(
                                "border-b border-l px-2 py-3 text-center text-xs font-medium",
                                d === today && "bg-brand/10 text-brand",
                              )}
                            >
                              {dayLabel(d, { weekday: "short", day: "numeric" })}
                            </th>
                          ))}
                          <th scope="col" className="w-16 border-b border-l p-2 text-xs font-medium">
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
                            avatar: s.avatar_url,
                          })),
                          ...(canPlan && (openShifts.length > 0 || weekTasks.some((task) => !taskRowId(task)))
                            ? [
                                {
                                  id: null,
                                  label: "Без сотрудника",
                                  role: "Требуется назначение",
                                  avatar: null,
                                },
                              ]
                            : []),
                        ].map((s) => (
                          <tr key={s.id ?? "open"} className="group hover:bg-muted/30">
                            <th scope="row" className="sticky left-0 z-10 border-b bg-card px-4 py-3 text-left font-normal group-hover:bg-muted">
                              <div className="flex items-center gap-3">
                                {s.id ? (
                                  <PersonAvatar name={s.label} src={s.avatar} />
                                ) : (
                                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                    <Users className="size-4" />
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <p className="break-words text-[13px] font-medium">
                                    {s.label}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {s.role}
                                  </p>
                                </div>
                              </div>
                            </th>
                            {days.map((d) => (
                              <ContextMenu key={d} modal={false}>
                              <ContextMenuTrigger asChild disabled={!can("shift_create")}>
                              <td
                                onDragOver={(e) => dragOver(e, d, s.id)}
                                onDragLeave={(e) => dragLeave(e, d, s.id)}
                                onDrop={(e) => void drop(e, d, s.id)}
                                className={cn(
                                  "h-16 border-b border-l p-1.5 align-top transition-colors",
                                  d === today && "bg-brand/[0.025]",
                                  dropTarget?.day === d && dropTarget.userId === s.id &&
                                    (dropTarget.ok ? "bg-brand/[0.06]" : "bg-destructive/[0.04]"),
                                )}
                              >
                                <div className="grid gap-1.5">
                                  {dropGhost(d, s.id)}
                                  {personShifts(s.id, d).map((shift) => card(shift))}
                                  {weekTasks
                                    .filter(
                                      (task) =>
                                        task.business_date === d &&
                                        taskRowId(task) === s.id,
                                    )
                                    .map((task) => taskCard(task))}
                                  {can("shift_create") && !occupied(s.id, d) && !(dropTarget?.day === d && dropTarget.userId === s.id) && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`Добавить смену: ${s.label}, ${dayLabel(d)}`}
                                      onClick={() => create(d, s.id)}
                                      className="h-8 w-full text-muted-foreground/70"
                                    >
                                      <Plus className="size-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuLabel>
                                  {s.label} · {dayLabel(d, { weekday: "short", day: "numeric", month: "short" })}
                                </ContextMenuLabel>
                                {occupied(s.id, d) ? (
                                  <ContextMenuItem disabled>У сотрудника уже есть смена в этот день</ContextMenuItem>
                                ) : (
                                  <>
                                    <ContextMenuItem onSelect={() => create(d, s.id)}>
                                      <Plus />
                                      Новая смена
                                    </ContextMenuItem>
                                    {cellTemplates(d).length > 0 && (
                                      <ContextMenuSub>
                                        <ContextMenuSubTrigger>
                                          <Layers />
                                          По шаблону
                                        </ContextMenuSubTrigger>
                                        <ContextMenuSubContent>
                                          {cellTemplates(d).map((t) => (
                                            <ContextMenuItem key={t.id} onSelect={() => create(d, s.id, t)}>
                                              <span className={cn("size-2.5 shrink-0 rounded-full", paletteBg(t.color))} />
                                              <span className="flex-1 truncate">{shiftTemplateLabel(t)}</span>
                                              <span className="text-xs tabular-nums text-muted-foreground">
                                                {(() => {
                                                  const times = templateTimesFor(t, isoWeekday(d));
                                                  return times ? `${times.start_time.slice(0, 5)}–${times.end_time.slice(0, 5)}` : "";
                                                })()}
                                              </span>
                                            </ContextMenuItem>
                                          ))}
                                        </ContextMenuSubContent>
                                      </ContextMenuSub>
                                    )}
                                  </>
                                )}
                              </ContextMenuContent>
                              </ContextMenu>
                            ))}
                            <td className="border-b border-l text-center text-xs font-medium tabular-nums">
                              {personShifts(s.id)
                                .reduce(
                                  (sum, s) =>
                                    sum +
                                    shiftHours(
                                      s.starts_at,
                                      s.ends_at,
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
                          <tr className="bg-muted/50">
                            <th
                              colSpan={9}
                              className="border-b px-4 py-2 text-left text-xs font-medium text-muted-foreground"
                            >
                              Стажировки · {trialCandidates.length}
                            </th>
                          </tr>
                        )}
                        {trialCandidates.map((candidate) => (
                            <tr
                              key={candidate.candidate_id}
                            >
                            <th scope="row" className="sticky left-0 z-10 border-b bg-card px-4 py-3 text-left font-normal">
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
                                <td
                                  key={day}
                                  className="border-b border-l p-2 align-top"
                                >
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
                            <td className="border-b border-l text-center text-xs text-muted-foreground">
                              —
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted">
                          <th scope="row" className="sticky left-0 z-10 bg-muted px-4 py-3 text-left text-xs font-medium">
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
                      className={cn(
                        "space-y-6",
                        view !== "list" && "md:hidden",
                      )}
                  >
                    {days.map((d) => (
                      <section key={d} className="overflow-hidden rounded-lg border bg-card">
                        <h3 className={cn("border-b bg-muted/50 px-4 py-3 text-sm font-medium first-letter:uppercase", d === today && "text-brand")}>
                          {dayLabel(d, {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })}
                        </h3>
                        <div className="space-y-2 p-3">
                          {weekShifts
                            .filter(
                              (s) =>
                                dateInZone(s.starts_at, data.timezone) === d,
                            )
                            .map((shift) => card(shift, canPlan ? "full" : "shift"))}
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
                              (s) =>
                                dateInZone(s.starts_at, data.timezone) === d,
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
                {showTasks && calendarTasks && calendarTasksWeek === week && (
                  <span>Задач на неделе: {weekTasks.length}</span>
                )}
              </div>
            </>
          )}
          </section>
            )}
        {tab === "templates" && (
          <TemplateList
            templates={data.templates}
            tableId={`schedule.templates.${data.userId}.${data.venueId}`}
            can={can}
            onCreate={() => setEditor({ type: "template" })}
            onEdit={(template) => setEditor({ type: "template", template })}
            onCopy={(template) =>
              setEditor({ type: "template", template, copy: true })
            }
            onArchive={(template) =>
              void save("template.archive", {
                id: template.id,
                version: template.version,
              })
            }
          />
        )}
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
          save={async (action, input) => {
            const saved = await save(action, input);
            const before = editor.template;
            // Смены хранят копию полей шаблона — предлагаем обновить их.
            if (
              saved &&
              action === "template.edit" &&
              before &&
              can("shift_edit") &&
              data.shifts.some((shift) => shift.template_id === before.id)
            )
              setApplyTemplate({ id: before.id, previousTitle: before.name });
            return saved;
          }}
        />
      )}
      {applyTemplate && !editor && (() => {
        const template = data.templates.find((t) => t.id === applyTemplate.id);
        return template ? (
          <ApplyTemplateDialog
            template={template}
            previousTitle={applyTemplate.previousTitle}
            shifts={data.shifts}
            timezone={data.timezone}
            onClose={() => setApplyTemplate(null)}
            onApplied={refresh}
          />
        ) : null;
      })()}
      {dragItem?.kind === "shift" && can("shift_delete") && (
        <div
          role="region"
          aria-label="Удалить смену"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (!overTrash) setOverTrash(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverTrash(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const shift = dragItem.shift;
            endDrag();
            confirmDelete(shift);
          }}
          className={cn(
            "fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-dashed px-5 py-3 text-sm font-medium shadow-lg transition-all animate-in fade-in-0 slide-in-from-bottom-4",
            overTrash
              ? "scale-105 border-destructive bg-destructive text-destructive-foreground"
              : "border-destructive/40 bg-background text-destructive",
          )}
        >
          <Trash2 className="size-4" />
          {overTrash ? "Отпустите, чтобы удалить" : "Перетащите сюда, чтобы удалить"}
        </div>
      )}
      {selected && (
        <EditDrawer
          open
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
          title={selectedTemplate ? shiftTemplateLabel(selectedTemplate) : selected.title}
          description={`${dayLabel(dateInZone(selected.starts_at, data.timezone))} · ${timeInZone(selected.starts_at, data.timezone)}–${timeInZone(selected.ends_at, data.timezone)} · ${selected.published ? "Опубликована" : "Черновик"}`}
          footer={
            <>
              {can("shift_delete") && (
                <Button
                  variant="ghost"
                  className="text-destructive mr-auto"
                  aria-label="Удалить смену"
                  onClick={() => confirmDelete(selected)}
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
              <EmployeePicker
                data={data}
                value={shiftAssignee(selected)}
                emptyLabel="Без сотрудника"
                includeCasual={data.permissions.includes("payroll.configure")}
                onChange={async (next) => {
                  if (
                    await save("shift.assign", {
                      id: selected.id,
                      version: selected.version,
                      ...assignmentFields(next),
                      payroll_model_id: next?.startsWith("payroll:")
                        ? (data.casualEmployees?.find(
                            (p) => p.id === next.slice(8),
                          )?.model_id ?? null)
                        : null,
                    })
                  )
                    setSelected(null);
                }}
              />
            </Field>
          )}
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
    </PageFrame>
    </TaskTitleTarget.Provider>
  );
}
