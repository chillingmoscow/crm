"use client";
import { ColorDot } from "@/components/ui/color-dot";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  UserPlus,
  CalendarPlus,
  Clock,
  ArrowLeftRight,
} from "lucide-react";
import { TaskAssignDrawer } from "./task-assign-drawer";
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
import { Calendar } from "@/components/ui/calendar";
import { PeriodStepper, periodTriggerClass } from "@/components/shared/period-stepper";
import { TableControls, TableIconButton, TablePageHeader } from "@/components/shared/table";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PageFrame } from "@/components/shared/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { paletteBg, paletteDot, paletteText } from "@/lib/palette";
import { casualPayModel as pickCasualPayModel } from "@/lib/schedule/casual-pay-model";
import { cn } from "@/lib/utils";
import {
  addDays,
  dateInZone,
  dayLabel,
  instantInZone,
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
import { loadShiftAttendance, loadSchedule, scheduleCommand, shiftHistoryPage } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { ShiftAttendancePopover } from "./shift-attendance-popover";
import type { ShiftAttendanceMark } from "@/lib/payroll/types";
import { reviewedMark, type ShiftReviewDecision } from "@/lib/payroll/shift-attendance";
import { AttendanceAttentionNotice } from "@/app/(dashboard)/people/payroll/_components/attendance-attention";
import {
  ShiftEditor,
  TemplateEditor,
  type Save,
  isoWeekday,
} from "./editors";
import { EmployeePicker } from "./employee-picker";
import { EmployeeStrip } from "./employee-strip";
import { ApplyTemplateDialog } from "./apply-template-dialog";
import { ShiftDetails } from "./shift-details";
import {
  shiftSwap,
  SwapFooterActions,
  SwapRequestDrawer,
  SwapRequestsButton,
  SwapSection,
} from "./shift-swap";
import { canRequestSwap } from "@/lib/schedule/shift-swaps";
import { DrawerAvatar, DrawerStatus } from "@/components/ui/drawer-blocks";
import { templateTimesFor } from "@/lib/schedule/template-times";
import { CandidateTrialCard } from "./candidate-trial-card";
import {
  DROP_OK_CELL_CLASS,
  DROP_REFUSED_CELL_CLASS,
  GridRowPerson,
  TODAY_CELL_CLASS,
} from "./grid-row-person";
import { toast } from "sonner";
import { TemplateList } from "./template-list";
import { ViewMenu } from "./view-menu";
import { ScheduleImageMenu } from "./schedule-image-menu";
import { TemplateWeek } from "./template-week";
import { gridScrollClass, useGridFits } from "./use-grid-fits";
import { TemplateName } from "./template-name";
import { TaskHeaderTarget, TaskTitleTarget } from "./task-header-actions";
import {
  taskStatus,
  type CalendarTaskData,
  type TaskOccurrence,
} from "@/lib/schedule/tasks";
import { loadCalendarTasks } from "../tasks/actions";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
const WeighingReport = dynamic(
  () => import("../tasks/weighing-report").then((module) => module.WeighingReport),
  {
    loading: () => (
      <div
        role="status"
        aria-label="Загрузка взвешивания"
        className="mx-auto h-72 w-full max-w-[720px] animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
      />
    ),
  },
);
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
      /** Форма открыта из просмотра смены: отмена возвращает к просмотру. */
      returnTo?: string;
    }
  | { type: "template"; template?: ShiftTemplate; copy?: boolean };
type DragItem =
  | { kind: "shift"; shift: Shift }
  | { kind: "template"; template: ShiftTemplate }
  /** Сотрудник из полосы вида «По шаблонам». */
  | { kind: "employee"; userId: string };
/** Ячейка под курсором: сотрудник × день или (вид «По шаблонам») шаблон × день. */
type DropTarget = { day: string; ok: boolean } & (
  | { userId: string | null; templateId?: undefined }
  | { templateId: string; userId?: undefined }
);
const TODO_STATUSES = new Set<TaskOccurrence["status"]>(["assigned", "in_progress", "returned"]);

/**
 * Телефон, вкладка «Мои задачи»: задачи сотрудника на неделе — сначала что
 * сделать сейчас, потом на проверке, впереди и готовые. Нажатие открывает
 * задачу: чек-лист, фото и отправку отчёта.
 */
function MyTasks({
  tasks,
  loading,
  error,
  today,
  onRetry,
  card,
}: {
  tasks: TaskOccurrence[];
  loading: boolean;
  error: boolean;
  today: string;
  onRetry: () => void;
  card: (task: TaskOccurrence) => React.ReactNode;
}) {
  if (error)
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
        Не удалось загрузить задачи
        <Button variant="outline" size="sm" onClick={onRetry}>Повторить</Button>
      </div>
    );
  if (loading)
    return (
      <div role="status" aria-label="Загрузка задач" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        ))}
      </div>
    );
  const byDate = (a: TaskOccurrence, b: TaskOccurrence) => a.business_date.localeCompare(b.business_date);
  const groups = [
    {
      label: "Сделать",
      items: tasks.filter((t) => TODO_STATUSES.has(t.status) && t.business_date <= today),
    },
    { label: "На проверке", items: tasks.filter((t) => t.status === "submitted") },
    {
      label: "Впереди",
      items: tasks.filter((t) => TODO_STATUSES.has(t.status) && t.business_date > today),
    },
    {
      label: "Готово",
      items: tasks.filter((t) => ["completed", "missed", "blocked"].includes(t.status)),
    },
  ].filter((group) => group.items.length);
  if (!groups.length)
    return (
      <EmptyState
        icon={ListChecks}
        title="Задач на этой неделе нет"
        description="Задачи появятся, когда их назначат на ваши смены."
        className="min-h-0 p-6"
      />
    );
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground">
            {group.label} · {group.items.length}
          </h2>
          {group.items.sort(byDate).map((task) => (
            <div key={task.id}>
              <p className="mb-1 text-xs text-muted-foreground">
                {task.business_date === today ? "Сегодня" : dayLabel(task.business_date)}
              </p>
              {card(task)}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Префикс id черновика, который ещё сохраняется. */
const PENDING_SHIFT = "pending:";

export function ScheduleClient({
  initial,
  section = "calendar",
  initialCalendarTasks = null,
  initialShowTasks,
  initialDate,
  initialView,
  initialSwap,
}: {
  initial: ScheduleData;
  section?: "calendar" | "templates";
  initialCalendarTasks?: CalendarTaskData | null;
  initialShowTasks?: boolean;
  initialDate?: string;
  /** Вид из адреса (`?view=`) важнее запомненного на устройстве. */
  initialView?: "templates" | "list" | "week";
  /** Заявка на замену из уведомления (`?swap=`): открыть её смену. */
  initialSwap?: string;
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
  // Пояс заведения показываем, только если он не совпадает с поясом
  // устройства, и смещением («UTC+3»), а не техническим именем. Считается
  // после монтирования: на сервере пояс устройства неизвестен.
  const [venueOffset, setVenueOffset] = useState<string | null>(null);
  useEffect(() => {
    const offset = (timeZone?: string) =>
      new Intl.DateTimeFormat("ru-RU", { timeZone, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    try {
      const venue = offset(data.timezone);
      setVenueOffset(venue && venue !== offset() ? venue.replace("GMT", "UTC") : null);
    } catch {
      setVenueOffset(null);
    }
  }, [data.timezone]);
  const [showTasks, setShowTasks] = useState(
    initialShowTasks ?? !initial.permissions.includes("schedule.view_all"),
  );
  const [calendarTasks, setCalendarTasks] = useState(initialCalendarTasks);
  const [calendarTasksWeek, setCalendarTasksWeek] = useState(week);
  const serverTasksWeek = useRef(initialCalendarTasks ? week : null);
  const [tasksError, setTasksError] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskOccurrence | null>(null);
  /** Телефон: вкладка «Мои задачи» вместо расписания. */
  const [mobileTasks, setMobileTasks] = useState(false);
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
        loadCalendarTasks({ from: week, to: addDays(week, 6) }).then(unwrapAction),
        refreshSchedule ? loadSchedule().then(unwrapAction) : null,
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
    if (!(showTasks || mobileTasks) || tab !== "calendar") return;
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
  }, [showTasks, mobileTasks, tab, week, refreshCalendarTasks]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState(false);
  /** Полоса шаблонов («По сотрудникам») или сотрудников («По шаблонам»). */
  const [stripOpen, setStripOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [publication, setPublication] = useState("all");
  const [view, setView] = useState<string>(
    initial.permissions.includes("schedule.view_all") ? initialView ?? "week" : "week",
  );
  // Выбранный вид запоминается на устройстве, как показ задач: «Список»
  // открывается списком и при следующем заходе. Вид из адреса важнее.
  const viewKey = `schedule.view.${initial.venueId}.${initial.userId}`;
  useEffect(() => {
    if (initialView || !initial.permissions.includes("schedule.view_all")) return;
    try {
      const saved = localStorage.getItem(viewKey);
      if (saved === "list" || saved === "templates" || saved === "week") setView(saved);
    } catch {}
  }, [initialView, initial.permissions, viewKey]);
  const changeView = (next: string) => {
    setView(next);
    try {
      localStorage.setItem(viewKey, next);
    } catch {}
    const url = new URL(window.location.href);
    if (next === "templates") url.searchParams.set("view", next);
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  };
  const [editor, setEditor] = useState<Editor | null>(null);
  /** «Задача на день»: день и, из меню смены, её шаблон. */
  const [taskAssign, setTaskAssign] = useState<{ day: string; template?: string | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [templateOverlay, setTemplateOverlay] = useState<ShiftTemplate | null>(null);
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
  /** Смена, для которой сотрудник ищет замену (панель «Замена смены»). */
  const [swapFor, setSwapFor] = useState<Shift | null>(null);
  const openedSwap = useRef(false);
  useEffect(() => {
    if (!initialSwap || openedSwap.current) return;
    openedSwap.current = true;
    const swap = data.swaps.find((entry) => entry.id === initialSwap);
    const shift = swap && data.shifts.find((entry) => entry.id === swap.shift_id);
    if (shift) setSelected(shift);
    else toast.info("Заявка на замену больше недоступна");
  }, [initialSwap, data.swaps, data.shifts]);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    action: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ScheduleEvent[] | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const can = useCallback(
    (p: string) => data.permissions.includes("schedule." + p),
    [data.permissions],
  );
  const canPlan = can("view_all");
  const templateView = canPlan && view === "templates";
  const canViewAttendance = canPlan && data.permissions.includes("payroll.view");
  const canOpenStaff =
    data.permissions.includes("people.view_staff") &&
    data.permissions.includes("people.view_staff_details");
  // Карточку кандидата открывает только тот, кто работает с кандидатами.
  const canOpenCandidates = data.permissions.includes("people.manage_candidates");
  const [attendance, setAttendance] = useState<{
    week: string;
    marks: Record<string, ShiftAttendanceMark>;
  } | null>(null);
  useEffect(() => {
    if (tab !== "calendar" || !canViewAttendance) return;
    let active = true;
    const load = () => {
      void loadShiftAttendance(week)
        .then(unwrapAction)
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
  // Решение по смене сохранено: значок меняется сразу, не дожидаясь
  // пересчёта дня; уведомление «ждут проверки» перечитывается.
  const [attentionKey, setAttentionKey] = useState(0);
  const weekGrid = useGridFits();
  const markReviewed = (shiftId: string, decision: ShiftReviewDecision, reason: string) => {
    setAttendance((prev) => {
      const mark = prev?.marks[shiftId];
      if (!prev || !mark) return prev;
      return { ...prev, marks: { ...prev.marks, [shiftId]: { ...reviewedMark(mark, decision, reason), sourceState: "pending" } } };
    });
    setAttentionKey((key) => key + 1);
  };
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
      setData(unwrapAction(await loadSchedule()));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось обновить расписание",
      );
      throw e;
    }
  }, []);
  const save: Save = async (action, input, success) => {
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
      toast.success(success ?? "Изменения сохранены");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    }
  };
  /**
   * Перетаскивание: смена встаёт на место сразу, команда и перечитывание
   * расписания идут в фоне, без уведомления об успехе. Пока идут другие
   * такие сохранения, свежие данные не применяем — иначе ответ первого
   * броска на миг откатил бы второй. При ошибке — сообщение и данные сервера.
   */
  const pendingDrops = useRef(0);
  const saveInstantly = async (
    action: string,
    input: unknown,
    apply: (shifts: Shift[]) => Shift[],
  ) => {
    const before = data.shifts;
    pendingDrops.current += 1;
    setData((d) => ({ ...d, shifts: apply(d.shifts) }));
    let ok = false;
    try {
      const r = await scheduleCommand(action, input);
      if (r.error) toast.error(r.error);
      else ok = true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
    pendingDrops.current -= 1;
    if (pendingDrops.current > 0) return ok;
    try {
      const fresh = unwrapAction(await loadSchedule());
      if (pendingDrops.current === 0) setData(fresh);
    } catch {
      if (!ok) setData((d) => ({ ...d, shifts: before }));
      else toast.warning("Изменения сохранены. Обновите страницу, чтобы увидеть их.");
    }
    return ok;
  };
  /** Начало и конец смены по дню и времени; конец раньше начала — следующие сутки. */
  const shiftSpan = (day: string, start: string, end: string) => {
    const starts_at = instantInZone(day, start, data.timezone);
    const endDay = end.slice(0, 5) <= start.slice(0, 5) ? addDays(day, 1) : day;
    const ends_at = instantInZone(endDay, end, data.timezone);
    return starts_at && ends_at ? { starts_at, ends_at } : null;
  };
  const patchShift = (id: string, patch: Partial<Shift>) => (shifts: Shift[]) =>
    shifts.map((shift) => (shift.id === id ? { ...shift, ...patch } : shift));
  /** Сохранение шаблона; после правки предлагаем обновить смены по нему. */
  const saveTemplate = (before?: ShiftTemplate): Save => async (action, input) => {
    const saved = await save(action, input);
    if (
      saved &&
      action === "template.edit" &&
      before &&
      can("shift_edit") &&
      data.shifts.some((shift) => shift.template_id === before.id)
    )
      setApplyTemplate({ id: before.id, previousTitle: before.name });
    return saved;
  };
  useEffect(() => {
    let alive = true;
    setHistory(null);
    setHistoryHasMore(false);
    if (selected)
      shiftHistoryPage(selected.id)
        .then(unwrapAction)
        .then((page) => {
          if (!alive) return;
          setHistory(page.events);
          setHistoryHasMore(page.hasMore);
        })
        .catch(() => {
          if (alive) setHistory([]);
        });
    return () => {
      alive = false;
    };
  }, [selected]);
  /** Следующая страница истории (старее последней загруженной записи). */
  const loadMoreHistory = async () => {
    if (!selected || !history?.length) return;
    try {
      const last = history[history.length - 1];
      const page = unwrapAction(await shiftHistoryPage(selected.id, { created_at: last.created_at, id: last.id }));
      setHistory((current) => [...(current ?? []), ...page.events]);
      setHistoryHasMore(page.hasMore);
    } catch {
      toast.error("Не удалось загрузить историю");
    }
  };
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
  // Опубликованный график видят все; без права планирования своя строка — первой.
  const staff = roster.filter(
    (s) =>
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
  if (!canPlan) {
    const mine = staff.findIndex((s) => s.user_id === data.userId);
    if (mine > 0) staff.unshift(...staff.splice(mine, 1));
  }
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
      aria-label={`Задача: ${task.snapshot.name}, ${task.planned ? "запланирована" : taskStatus[task.status]}`}
      // Будущая регулярная задача ещё не создана — пунктир и часы вместо
      // непонятного «План»; кто получит — в подсказке.
      data-tip={
        task.planned
          ? `Появится у сотрудника в день смены · ${task.employee_name || "смена ещё не назначена"}`
          : `${task.employee_name || "Без сотрудника"} · ${taskStatus[task.status]}`
      }
      className={cn(
        "flex w-full items-start gap-1.5 rounded-md border bg-background px-2 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        task.planned && "border-dashed text-muted-foreground",
        task.status === "completed" && "text-muted-foreground",
        task.status === "missed" && "border-destructive/30",
      )}
    >
      {task.planned ? (
        <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      ) : task.status === "completed" ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        {/* Название целиком — без обрезки. */}
        <span className={cn("break-words", compact ? "leading-4" : "block text-sm font-medium")}>
          {task.snapshot.name}
        </span>
        {!compact && (
          <span className="mt-1 block text-[13px] text-muted-foreground">
            {task.employee_name || "Без сотрудника"} · {taskStatus[task.status]}
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
      confirmLabel: "Опубликовать смены",
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
  /** Модель оплаты разового — по правилу расчёта зарплаты (как в форме). */
  const casualPayModel = (
    userId: string | null,
    shift: { role_id: string | null; department_id?: string | null; starts_at?: string | null },
  ) => {
    const casual = data.casualEmployees?.find((e) => `payroll:${e.id}` === userId);
    if (!casual) return null;
    return pickCasualPayModel({
      employee: casual,
      shift,
      models: data.payModels ?? [],
      roles: data.roles,
      sameDepartmentRateFrom: data.sameDepartmentRateFrom,
    });
  };
  /**
   * Шаблон в ячейку сотрудника — сразу черновик смены, без формы: сотрудник,
   * день, время, должность и цвет уже известны. Форма открывается, только если
   * назначать сотрудников нельзя.
   */
  const placeTemplate = async (template: ShiftTemplate, day: string, userId: string | null) => {
    const times = templateTimesFor(template, isoWeekday(day));
    if (!times || occupied(userId, day) || templateTaken(template.id, day)) return;
    if (!userId || !can("shift_assign")) {
      create(day, userId, template);
      return;
    }
    const casual = data.casualEmployees?.find((e) => `payroll:${e.id}` === userId);
    // Если модель оплаты разового нельзя подобрать однозначно — открываем форму.
    const payModel = casualPayModel(userId, {
      role_id: template.role_id,
      department_id: template.department_id,
      starts_at: instantInZone(day, times.start_time, data.timezone),
    });
    if (casual && !payModel) {
      create(day, userId, template);
      return;
    }
    const input = {
      name: template.name,
      title: template.name,
      color: template.color,
      start_time: times.start_time,
      end_time: times.end_time,
      department_id: template.department_id,
      role_id: template.role_id,
      checklist_ids: casual ? [] : template.checklist_ids,
      date: day,
      ...assignmentFields(userId),
      payroll_model_id: payModel,
      note: "",
      template_id: template.id,
    };
    const span = shiftSpan(day, times.start_time, times.end_time);
    // Черновик-заглушка до ответа сервера; настоящий придёт с перечитыванием.
    const draft: Shift | null = span && {
      id: `${PENDING_SHIFT}${crypto.randomUUID()}`,
      venue_id: data.venueId,
      ...assignmentFields(userId),
      payroll_model_id: payModel,
      role_id: template.role_id,
      department_id: template.department_id,
      template_id: template.id,
      title: template.name,
      color: template.color,
      ...span,
      break_minutes: template.break_minutes,
      arrival_minutes: template.arrival_minutes,
      note: "",
      checklist_snapshots: {},
      checklist_ids: input.checklist_ids,
      published: false,
      version: 0,
      updated_at: new Date().toISOString(),
    };
    await saveInstantly("shift.create", input, (shifts) => (draft ? [...shifts, draft] : shifts));
  };
  /** В списке перенос — на другой день у того же сотрудника. */
  const listDropUser = dragItem?.kind === "shift" ? shiftAssignee(dragItem.shift) : null;
  /** Смена вернулась в свою же ячейку — сохранять нечего. */
  const sameCell = (item: DragItem, day: string, userId: string | null) =>
    item.kind === "shift" &&
    dateInZone(item.shift.starts_at, data.timezone) === day &&
    shiftAssignee(item.shift) === userId;
  /** По шаблону в день может быть только одна смена (правило сервера). */
  const takenTemplateSlots = useMemo(
    () =>
      new Set(
        data.shifts
          .filter((shift) => shift.template_id)
          .map((shift) => `${shift.template_id}:${dateInZone(shift.starts_at, data.timezone)}`),
      ),
    [data.shifts, data.timezone],
  );
  const templateTaken = (templateId: string, day: string) => takenTemplateSlots.has(`${templateId}:${day}`);
  const canDrop = (item: DragItem, day: string, userId: string | null) =>
    item.kind === "template"
      ? can("shift_create") &&
        !occupied(userId, day) &&
        !templateTaken(item.template.id, day) &&
        templateTimesFor(item.template, isoWeekday(day)) !== null
      : item.kind === "shift" && can("shift_edit") && !occupied(userId, day, item.shift.id);
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
  /** row — сотрудник (вид «По сотрудникам») или шаблон (вид «По шаблонам»). */
  const dragLeave = (e: React.DragEvent, day: string, row: string | null) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropTarget((current) =>
      current?.day === day && (current.templateId ?? current.userId) === row ? null : current,
    );
  };
  /** Смена вернулась в свой же слот шаблона. */
  const sameSlot = (shift: Shift, template: ShiftTemplate, day: string) =>
    shift.template_id === template.id && dateInZone(shift.starts_at, data.timezone) === day;
  /** Смена в слоте без сотрудника (карточка «Назначить») — её можно занять броском. */
  const openSlotShift = (template: ShiftTemplate, day: string) => {
    const shift = data.shifts.find((s) => sameSlot(s, template, day));
    return shift && !shiftAssignee(shift) ? shift : undefined;
  };
  /**
   * Вид «По шаблонам»: почему в слот «шаблон × день» бросить нельзя (null —
   * можно). Сотрудник из полосы ставится в слот работающего в этот день
   * шаблона — пустой или со сменой без сотрудника, — если у него в этот день
   * ещё нет смены; смена переносится только в слот своего шаблона на другой день.
   */
  const slotRefusal = (item: DragItem, template: ShiftTemplate, day: string): string | null => {
    if (item.kind === "template") return "Перетащите сотрудника";
    if (item.kind === "shift" && sameSlot(item.shift, template, day)) return null;
    if (item.kind === "employee" ? !can("shift_create") || !can("shift_assign") : !can("shift_edit"))
      return "Нет права";
    if (item.kind === "shift" && item.shift.template_id !== template.id) return "Другой шаблон";
    if (!templateTimesFor(template, isoWeekday(day))) return "Шаблон не работает в этот день";
    const takesOpenShift = item.kind === "employee" && Boolean(openSlotShift(template, day));
    if (templateTaken(template.id, day) && !takesOpenShift) return "Шаблон уже занят";
    const busy = item.kind === "employee"
      ? occupied(item.userId, day)
      : occupied(shiftAssignee(item.shift), day, item.shift.id);
    return busy ? "Уже есть смена" : null;
  };
  const slotDragOver = (e: React.DragEvent, day: string, template: ShiftTemplate) => {
    if (!dragItem) return;
    const ok = slotRefusal(dragItem, template, day) === null;
    if (ok) {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragItem.kind === "shift" ? "move" : "copy";
    }
    if (dropTarget?.day !== day || dropTarget.templateId !== template.id || dropTarget.ok !== ok)
      setDropTarget({ day, templateId: template.id, ok });
  };
  /**
   * Сотрудник в пустой слот — сразу черновик смены по шаблону (как шаблон
   * в ячейку сотрудника), в слот со сменой без сотрудника — назначение на
   * неё (как «Назначить»); смена в слот своего шаблона на другой день —
   * перенос со временем шаблона на этот день.
   */
  const dropOnSlot = async (e: React.DragEvent, day: string, template: ShiftTemplate) => {
    e.preventDefault();
    endDrag();
    const userId = e.dataTransfer.getData("application/sheerly-employee");
    const shift = data.shifts.find(
      (s) => s.id === e.dataTransfer.getData("application/sheerly-shift"),
    );
    const item: DragItem | null = userId
      ? { kind: "employee", userId }
      : shift ? { kind: "shift", shift } : null;
    if (!item || slotRefusal(item, template, day) !== null) return;
    if (item.kind === "employee") {
      const open = openSlotShift(template, day);
      if (open) await assignOpenShift(open, item.userId, day);
      else await placeTemplate(template, day, item.userId);
      return;
    }
    if (item.kind !== "shift" || sameSlot(item.shift, template, day)) return;
    const times = templateTimesFor(template, isoWeekday(day));
    if (!times) return;
    const assignee = shiftAssignee(item.shift);
    const span = shiftSpan(day, times.start_time, times.end_time);
    await saveInstantly(
      "shift.edit",
      {
        ...item.shift,
        date: day,
        start_time: times.start_time.slice(0, 5),
        end_time: times.end_time.slice(0, 5),
        ...assignmentFields(assignee),
        payroll_model_id: casualPayModel(assignee, item.shift),
      },
      span ? patchShift(item.shift.id, span) : (shifts) => shifts,
    );
  };
  /** Сотрудника — на смену без сотрудника. Разовый без однозначной ставки — через форму «Назначить». */
  const assignOpenShift = async (shift: Shift, userId: string, day: string) => {
    const casual = data.casualEmployees?.some((e) => `payroll:${e.id}` === userId);
    const payModel = casualPayModel(userId, shift);
    if (casual && !payModel) {
      // Брошенный сотрудник подставлен в форму: остаётся выбрать ставку.
      setEditor({ type: "shift", shift, day, templateSlot: true, userId });
      return;
    }
    await saveInstantly(
      "shift.assign",
      {
        ...assignmentFields(userId),
        payroll_model_id: payModel,
        id: shift.id,
        version: shift.version,
      },
      patchShift(shift.id, { ...assignmentFields(userId), payroll_model_id: payModel }),
    );
  };
  const confirmDelete = (shift: Shift) =>
    setConfirmation({
      title: shift.published ? "Удалить смену?" : "Удалить черновик смены?",
      description: shift.published
        ? `${name(shiftAssignee(shift))} больше не увидит эту смену в расписании. Если смена уже засчитана в зарплату, начисление за этот день пересчитается. Нельзя удалить смену с начатым чек-листом или уже выплаченную.`
        : "Черновик ещё не видели сотрудники — он просто исчезнет из расписания.",
      confirmLabel: shift.published ? "Удалить смену" : "Удалить черновик",
      destructive: true,
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
      await placeTemplate(template, day, userId);
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
    const start_time = timeInZone(shift.starts_at, data.timezone);
    const end_time = timeInZone(shift.ends_at, data.timezone);
    const payroll_model_id = casualPayModel(userId, shift);
    const span = shiftSpan(day, start_time, end_time);
    await saveInstantly(
      "shift.edit",
      {
        ...shift,
        date: day,
        start_time,
        end_time,
        ...assignmentFields(userId),
        payroll_model_id,
      },
      patchShift(shift.id, { ...span, ...assignmentFields(userId), payroll_model_id }),
    );
  };
  /** Брошенная в корзину смена удаляется сразу, без вопроса. */
  const deleteDropped = async (shift: Shift) => {
    if (
      await saveInstantly("shift.delete", { id: shift.id, version: shift.version }, (shifts) =>
        shifts.filter((s) => s.id !== shift.id),
      )
    )
      setSelected((current) => (current?.id === shift.id ? null : current));
  };
  const cellTemplates = (day: string) =>
    data.templates.filter(
      (t) => !t.archived && templateTimesFor(t, isoWeekday(day)) !== null && !templateTaken(t.id, day),
    );
  const templatesById = new Map(data.templates.map((template) => [template.id, template]));
  /**
   * Шаблон смены для показа. Смена по шаблону всегда называется как шаблон
   * сейчас: её собственное название — копия на момент создания, оно
   * устаревает при переименовании шаблона и у смен из переноса старого
   * графика («Менеджер №1» при шаблоне «Менеджер · день»).
   */
  // Цвет и название смены берём у её шаблона: у смены хранится копия на
  // момент создания, и после перекраски шаблона она устаревает.
  const shiftTemplate = (shift: Shift) =>
    shift.template_id ? templatesById.get(shift.template_id) : undefined;
  const selectedTemplate = selected ? shiftTemplate(selected) : undefined;
  const selectedSwap = selected ? shiftSwap(data.swaps, selected.id) : null;
  const selectedSwapActive =
    !!selectedSwap && selectedSwap.status === "pending" && Date.parse(selected!.ends_at) > Date.now();
  // У управляющего главная кнопка при открытой заявке — «Утвердить замену».
  const selectedSwapDecision = selectedSwapActive && can("shift_assign");
  const selectedCanRequestSwap =
    !!selected && !selectedSwapActive && canRequestSwap(selected, data.userId, false, Date.now()) &&
    !data.runs.some((run) => run.shift_id === selected.id);
  /**
   * Смена в виде «Список» — как в календаре: время колонкой слева, полоска
   * цвета шаблона, название и сотрудник; статус — только у черновика
   * (опубликованная — обычное состояние, её не подписываем).
   */
  /** Пометка «есть открытая заявка на замену» в карточке смены. */
  const swapMark = (s: Shift) => {
    const swap = shiftSwap(data.swaps, s.id);
    if (swap?.status !== "pending" || Date.parse(s.ends_at) <= Date.now()) return null;
    const tip = `Заявка на замену: вместо — ${name(swap.to_user_id)}`;
    return (
      <span data-tip={tip} className="inline-flex shrink-0 align-middle">
        <ArrowLeftRight aria-hidden className="size-3.5" />
        <span className="sr-only">{tip}</span>
      </span>
    );
  };
  const listCardBody = (s: Shift, assignee: string | null, mark: unknown) => {
    const template = shiftTemplate(s);
    const title = template ? template.name : s.title;
    const subtitle = template?.subtitle ?? null;
    const avatar = data.staff.find((p) => p.user_id === assignee)?.avatar_url;
    const person = assignee ? name(assignee) : "Без сотрудника";
    const hours = Math.round(shiftHours(s.starts_at, s.ends_at) * 10) / 10;
    return (
      <>
        <span className="w-11 shrink-0 text-right text-xs leading-snug tabular-nums">
          <span className="block font-semibold">{timeInZone(s.starts_at, data.timezone)}</span>
          <span className="block text-muted-foreground">{timeInZone(s.ends_at, data.timezone)}</span>
        </span>
        <span aria-hidden className={cn("w-[3px] shrink-0 rounded-full", paletteDot(template?.color ?? s.color))} />
        <span className="min-w-0 flex-1">
          {/* Главное — кто работает: сотрудник жирным, ниже смена и часы. */}
          <span className="flex min-w-0 items-center gap-1.5">
            <DrawerAvatar name={person} src={avatar} size="sm" />
            <span className={cn("truncate text-sm font-semibold", !assignee && "font-normal text-muted-foreground")}>
              {person}
            </span>
            {swapMark(s)}
            {/* На телефоне бейдж — в этой строке, справа он резал бы имя. */}
            {!s.published && (
              <span className="shrink-0 sm:hidden">
                <DrawerStatus label="Черновик" tone="neutral" />
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {[title, subtitle, `${hours.toLocaleString("ru")} ч`].filter(Boolean).join(" · ")}
          </span>
        </span>
        {!s.published && (
          <span className={cn("hidden self-center sm:block", mark ? "mr-6" : undefined)}>
            <DrawerStatus label="Черновик" tone="neutral" />
          </span>
        )}
      </>
    );
  };
  const card = (s: Shift, mode: "shift" | "full" | "template" | "list" = "shift") => {
    const mark = attendanceMark(s);
    const template = shiftTemplate(s);
    const assignee = shiftAssignee(s);
    const assignOpenShift = mode === "template" && !assignee && can("shift_assign");
    const assigneeLabel = assignOpenShift ? "Назначить" : name(assignee);
    const day = dateInZone(s.starts_at, data.timezone);
    const assignSlot = () =>
      setEditor({ type: "shift", shift: s, day, templateSlot: true });
    const dragged = dragItem?.kind === "shift" && dragItem.shift.id === s.id;
    // Заглушка до ответа сервера: у неё ещё нет настоящего id.
    const pending = s.id.startsWith(PENDING_SHIFT);
    return (
    <ContextMenu key={s.id} modal={false}>
    <ContextMenuTrigger asChild>
    <div className="relative min-w-0">
    <button
      draggable={can("shift_edit") && !pending}
      disabled={pending}
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
        "w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        can("shift_edit") && "cursor-grab active:cursor-grabbing",
        dragged && "opacity-40",
        mode === "list"
          ? "flex items-stretch gap-3 px-2 py-1.5 transition-colors hover:bg-muted/60"
          : cn("grid gap-1 px-1.5 py-2 transition-opacity hover:opacity-80", paletteBg(template?.color ?? s.color), paletteText(template?.color ?? s.color)),
      )}
    >
      {mode === "list" ? listCardBody(s, assignee, mark) : (
      <>
      {mode === "template" ? (
        <>
          {/* «По шаблонам» строка — уже смена, поэтому в карточке главное —
              кто работает: фото и имя крупно, время ниже и тише. */}
          <span className={cn("flex min-w-0 items-center gap-1", mark && "pr-5")}>
            {assignee && (
              <DrawerAvatar
                name={assigneeLabel}
                src={data.staff.find((p) => p.user_id === assignee)?.avatar_url}
                size="sm"
              />
            )}
            {/* Длинная фамилия в узкой колонке переносится по слогам с дефисом,
                а не обрывается посреди слова. */}
            <span className="min-w-0 hyphens-auto break-words text-[13px] font-semibold leading-tight">{assigneeLabel}</span>
            {swapMark(s)}
          </span>
          <span className="text-xs tabular-nums opacity-75">
            {timeInZone(s.starts_at, data.timezone)}–<wbr />
            {timeInZone(s.ends_at, data.timezone)}
          </span>
        </>
      ) : (
        <>
          {/* В узкой колонке (таблица на минимальной ширине) время переносится
              после тире, а не обрезается: 12px «13:00–00:30» не всегда влезает. */}
          <span className={cn("text-xs font-semibold tabular-nums", mark && "pr-5")}>
            {timeInZone(s.starts_at, data.timezone)}–<wbr />
            {timeInZone(s.ends_at, data.timezone)}
            {swapMark(s) && <> {swapMark(s)}</>}
          </span>
          {template
            ? <span className="text-xs"><TemplateName {...template} /></span>
            : <span className={cn("text-xs", mode === "shift" && "truncate")}>{s.title}</span>}
          {mode === "full" && <span className="break-words text-xs">{assigneeLabel}</span>}
        </>
      )}
      {!s.published && (
        <span className="flex gap-1 items-center text-xs">
          {/* Точка в подписи 12px — `ColorDot` sm, цвета текста карточки. */}
          <ColorDot color={null} size="sm" className="border-0 bg-current" />
          Черновик
        </span>
      )}
      </>
      )}
    </button>
    {mark && (
      <ShiftAttendancePopover
        shiftId={s.id}
        version={s.version}
        mark={mark}
        canReview={data.permissions.includes("payroll.review")}
        onReviewed={(decision, reason) => markReviewed(s.id, decision, reason)}
      />
    )}
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
      {can("shift_assign") && !assignee && s.template_id && can("shift_create") && (
        <ContextMenuItem onSelect={assignSlot}>
          <UserPlus />
          Назначить сотрудника
        </ContextMenuItem>
      )}
      {can("shift_assign") && assignee && (
        <ContextMenuItem onSelect={assignSlot}>
          <UserPlus />
          Заменить сотрудника
        </ContextMenuItem>
      )}
      {can("checklist_edit") && s.template_id && (
        <ContextMenuItem onSelect={() => setTaskAssign({ day, template: s.template_id })}>
          <ListChecks />
          Добавить задачу
        </ContextMenuItem>
      )}
      {can("shift_delete") && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => confirmDelete(s)}>
            <Trash2 />
            {s.published ? "Удалить смену" : "Удалить черновик"}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
    </ContextMenu>
    );
  };
  /**
   * «Тень» и запрет в ячейке, куда упадёт перетаскиваемое. Лежат поверх ячейки (absolute),
   * а не в потоке — иначе строка растягивается и сетка дёргается.
   */
  const refusalBox = (text: string) => (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-1.5 z-[1] flex items-center justify-center rounded-md border border-dashed border-destructive/60 bg-background/85 px-1 text-center text-xs font-medium leading-tight text-destructive"
    >
      {text}
    </div>
  );
  // Непрозрачная подложка: тень может лечь на карточку (смена без сотрудника
  // в виде «По шаблонам»), а цвет шаблона полупрозрачный.
  const ghostBox = (color: string | null, times: string, title: string) => (
    <div aria-hidden className="pointer-events-none absolute inset-1.5 z-[1] rounded-md bg-card">
      <div
        className={cn(
          "flex h-full flex-col gap-0.5 overflow-hidden rounded-md border-2 border-dashed border-current px-1.5 py-1.5",
          paletteBg(color),
          paletteText(color),
        )}
      >
        <span className="truncate text-xs font-semibold tabular-nums">{times}</span>
        <span className="truncate text-xs">{title}</span>
      </div>
    </div>
  );
  const dropGhost = (day: string, userId: string | null) => {
    if (!dragItem || dragItem.kind === "employee") return null;
    if (dropTarget?.day !== day || dropTarget.userId !== userId) return null;
    if (!dropTarget.ok)
      return refusalBox(
        dragItem.kind === "shift" && !can("shift_edit")
          ? "Нет права"
          : dragItem.kind === "template" && !templateTimesFor(dragItem.template, isoWeekday(day))
            ? "Шаблон не работает в этот день"
            : dragItem.kind === "template" && templateTaken(dragItem.template.id, day)
              ? "Шаблон уже занят"
              : "Уже есть смена",
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
    return ghostBox(color, times, title);
  };
  /** «Тень» в слоте вида «По шаблонам»: время слота и кто встанет на смену. */
  const slotGhost = (day: string, template: ShiftTemplate) => {
    if (!dragItem || dropTarget?.day !== day || dropTarget.templateId !== template.id) return null;
    const refusal = slotRefusal(dragItem, template, day);
    if (refusal) return refusalBox(refusal);
    if (dragItem.kind === "shift" && sameSlot(dragItem.shift, template, day)) return null;
    const t = templateTimesFor(template, isoWeekday(day));
    if (!t || dragItem.kind === "template") return null;
    const assignee = dragItem.kind === "employee" ? dragItem.userId : shiftAssignee(dragItem.shift);
    // На смену без сотрудника встаёт с её временем — оно могло быть своим.
    const open = dragItem.kind === "employee" ? openSlotShift(template, day) : undefined;
    const times = open
      ? `${timeInZone(open.starts_at, data.timezone)}–${timeInZone(open.ends_at, data.timezone)}`
      : `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}`;
    return ghostBox(template.color, times, name(assignee));
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
  const myTasks = calendarTasksWeek === week
    ? (calendarTasks?.occurrences ?? []).filter(
        (task) => task.user_id === data.userId && days.includes(task.business_date),
      )
    : [];
  const myOpenTasks = myTasks.filter(
    (task) => TODO_STATUSES.has(task.status) && task.business_date <= today,
  ).length;
  // День для «Новая смена» / «Задача» из шапки: сегодня, если он на открытой
  // неделе, иначе её первый день — иначе смена уезжает с экрана.
  const addDay = days.includes(today) ? today : days[0];
  // Период и «Сегодня» стоят в шапке слева, инструменты — в той же строке справа.
  const periodControls = (
    <>
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
    </>
  );
  const pendingReports =
    showTasks && pendingTaskReports.length > 0 ? (
      <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-8 sm:h-9">
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
    ) : null;
  return (
    <TaskTitleTarget.Provider value={setScreenTitle}>
    <PageFrame className="space-y-6">
      {calendarVisible && (
        <>
          <Breadcrumbs
            items={[{ label: "График работы" }, { label: "Расписание" }]}
          />
          <TablePageHeader
            title="Расписание"
            period={periodControls}
            actions={
              <>
              {can("shift_assign") && <SwapRequestsButton data={data} onOpen={setSelected} />}
              {pendingReports}
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
                        label={stripOpen ? "Скрыть шаблоны смен" : "Показать шаблоны смен"}
                        active={stripOpen}
                        onClick={() => setStripOpen(!stripOpen)}
                      >
                        <Layers />
                      </TableIconButton>
                    )}
                    {/* На телефоне вида-таблицы нет — перетаскивать некуда. */}
                    {can("shift_create") && can("shift_assign") && templateView && (
                      <span className="hidden md:inline-flex">
                        <TableIconButton
                          label={stripOpen ? "Скрыть сотрудников" : "Показать сотрудников"}
                          active={stripOpen}
                          onClick={() => setStripOpen(!stripOpen)}
                        >
                          <Users />
                        </TableIconButton>
                      </span>
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
                    {canPlan && (
                      <ScheduleImageMenu
                        week={week}
                        department={department === "all" ? null : department}
                        venueId={data.venueId}
                      />
                    )}
                  </>
                }
                primaryActions={
                  <>
                    {can("shift_create") && can("checklist_edit") ? (
                      // Как «Добавить операцию» в финансах: что добавить — по стрелке.
                      <Popover open={addOpen} onOpenChange={setAddOpen}>
                        <PopoverTrigger asChild>
                          <Button size="sm" className="h-8 gap-1.5 sm:h-9" variant={canPublish ? "outline" : "default"}>
                            <Plus />
                            Добавить
                            <ChevronDown className="opacity-80" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-60 p-1">
                          {[
                            { key: "shift", icon: CalendarPlus, label: "Смена", hint: "Сотруднику на день" },
                            { key: "task", icon: ListChecks, label: "Задача", hint: "Разово на день — кто будет на смене" },
                          ].map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => {
                                setAddOpen(false);
                                if (item.key === "shift") create(addDay);
                                else setTaskAssign({ day: addDay });
                              }}
                              className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            >
                              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                                <item.icon className="size-3.5" />
                              </span>
                              <span>
                                <span className="block">{item.label}</span>
                                <span className="block text-xs text-muted-foreground">{item.hint}</span>
                              </span>
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    ) : can("shift_create") ? (
                      <Button size="sm" className="h-8 sm:h-9" variant={canPublish ? "outline" : "default"} onClick={() => create(addDay)}>
                        <Plus />
                        Новая смена
                      </Button>
                    ) : can("checklist_edit") ? (
                      <Button size="sm" className="h-8 sm:h-9" variant={canPublish ? "outline" : "default"} onClick={() => setTaskAssign({ day: addDay })}>
                        <Plus />
                        Задача на день
                      </Button>
                    ) : null}
                    {canPublish && (
                      <Button size="sm" className="h-8 sm:h-9" disabled={busy} onClick={publish}>
                        <Send />
                        Опубликовать · {draftShifts.length}
                      </Button>
                    )}
                  </>
                }
              />
              </>
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
              {selectedTask.snapshot.kind === "stock_count" ? (
                <WeighingReport
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
              ) : (
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
              )}
            </TaskHeaderTarget.Provider>
          ) : (
            <>
              <Tabs
                value={mobileTasks ? "tasks" : "schedule"}
                onValueChange={(value) => setMobileTasks(value === "tasks")}
                className={cn(tabStyle.tabs, "md:hidden")}
              >
                <TabsList aria-label="Разделы графика">
                  <TabsTrigger value="schedule">График</TabsTrigger>
                  <TabsTrigger value="tasks">
                    Мои задачи{myOpenTasks > 0 ? ` · ${myOpenTasks}` : ""}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {mobileTasks && (
                <div className="md:hidden">
                  <MyTasks
                    tasks={myTasks}
                    loading={!calendarTasks || calendarTasksWeek !== week}
                    error={tasksError}
                    today={today}
                    onRetry={() => void refreshCalendarTasks().catch(() => {})}
                    card={(task) => taskCard(task, false)}
                  />
                </div>
              )}
              <div className={cn("space-y-5", mobileTasks && "max-md:hidden")}>
              {(filters || filtersActive) && (
                <div className="flex flex-wrap items-center gap-2" aria-label="Фильтры расписания">
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
              {/* Месяц сегодняшнего дня и месяцы показанной недели: невыверенный
                  выход прошлой недели виден, даже когда листаешь вперёд. */}
              {canViewAttendance && (
                <AttendanceAttentionNotice
                  months={[today.slice(0, 7), days[0].slice(0, 7), days[6].slice(0, 7)]}
                  refreshKey={attentionKey}
                />
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
                      onClick={() =>
                        void refreshCalendarTasks().catch(() => {})
                      }
                  >
                    Повторить
                  </Button>
                </div>
              )}
              {stripOpen && !templateView && (
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
              {stripOpen && templateView && can("shift_create") && can("shift_assign") && (
                <EmployeeStrip
                  data={data}
                  days={days}
                  department={department === "all" ? null : department}
                  dragging={dragItem?.kind === "employee" ? dragItem.userId : null}
                  onDragStart={(userId) => startDrag({ kind: "employee", userId })}
                  onDragEnd={endDrag}
                />
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
                  slotDrop={(day, template) => ({
                    onDragOver: (e) => slotDragOver(e, day, template),
                    onDragLeave: (e) => dragLeave(e, day, template.id),
                    onDrop: (e) => void dropOnSlot(e, day, template),
                    target: dropTarget?.day === day && dropTarget.templateId === template.id
                      ? (dropTarget.ok ? "ok" : "refused")
                      : null,
                    ghost: slotGhost(day, template),
                  })}
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
                    ref={weekGrid.ref}
                    className={cn(
                      "hidden rounded-lg border bg-card md:block",
                      gridScrollClass(weekGrid.fits),
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
                                  role: "",
                                  avatar: null,
                                },
                              ]
                            : []),
                        ].map((s) => (
                          <tr key={s.id ?? "open"} className="group hover:bg-muted/30">
                            <th scope="row" className="sticky left-0 z-10 border-b bg-card px-4 py-3 text-left font-normal group-hover:bg-muted">
                              <GridRowPerson
                                name={s.label}
                                subtitle={s.role}
                                avatarSrc={s.avatar}
                                icon={s.id ? undefined : <Users className="size-4" />}
                                href={s.id && canOpenStaff ? `/people/staff/${s.id}?from=schedule` : null}
                              />
                            </th>
                            {days.map((d) => (
                              <ContextMenu key={d} modal={false}>
                              <ContextMenuTrigger asChild disabled={!can("shift_create") && !can("checklist_edit")}>
                              <td
                                onDragOver={(e) => dragOver(e, d, s.id)}
                                onDragLeave={(e) => dragLeave(e, d, s.id)}
                                onDrop={(e) => void drop(e, d, s.id)}
                                className={cn(
                                  "relative h-16 border-b border-l p-1.5 align-top transition-colors",
                                  d === today && TODAY_CELL_CLASS,
                                  dropTarget?.day === d && dropTarget.userId === s.id &&
                                    (dropTarget.ok ? DROP_OK_CELL_CLASS : DROP_REFUSED_CELL_CLASS),
                                )}
                              >
                                {dropGhost(d, s.id)}
                                <div className="grid gap-1.5">
                                  {personShifts(s.id, d).map((shift) => card(shift))}
                                  {weekTasks
                                    .filter(
                                      (task) =>
                                        task.business_date === d &&
                                        taskRowId(task) === s.id,
                                    )
                                    .map((task) => taskCard(task))}
                                  {can("shift_create") && !occupied(s.id, d) && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`Добавить смену: ${s.label}, ${dayLabel(d)}`}
                                      onClick={() => create(d, s.id)}
                                      className={cn(
                                        "h-8 w-full text-muted-foreground/70",
                                        // Под «тенью» кнопку прячем, но место оставляем.
                                        dropTarget?.day === d && dropTarget.userId === s.id && "invisible",
                                      )}
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
                                            <ContextMenuItem key={t.id} onSelect={() => void placeTemplate(t, d, s.id)}>
                                              <ColorDot color={t.color} size="md" />
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
                                {can("checklist_edit") && (
                                  <ContextMenuItem onSelect={() => setTaskAssign({ day: d })}>
                                    <ListChecks />
                                    Задача на день
                                  </ContextMenuItem>
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
                                .toLocaleString("ru", { maximumFractionDigits: 1 })}{" "}ч
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
                            // Строка стажировки устроена как строка сотрудника:
                            // аватар, имя 13px, подпись 12px, те же отступы ячеек.
                            <tr
                              key={candidate.candidate_id}
                              className="group hover:bg-muted/30"
                            >
                            <th scope="row" className="sticky left-0 z-10 border-b bg-card px-4 py-3 text-left font-normal group-hover:bg-muted">
                              <GridRowPerson
                                name={candidate.full_name}
                                subtitle={`${candidate.hired_user_id ? "Принят на работу" : "Кандидат"}${candidate.desired_position ? ` · ${candidate.desired_position}` : ""}`}
                                href={canOpenCandidates ? `/people/candidates/${candidate.candidate_id}` : null}
                              />
                            </th>
                            {days.map((day) => (
                                <td
                                  key={day}
                                  className={cn(
                                    "h-16 border-b border-l p-1.5 align-top",
                                    day === today && TODAY_CELL_CLASS,
                                  )}
                                >
                                <div className="grid gap-1.5">
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
                                        linked={canOpenCandidates}
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
                      {/* Итоги прижаты к низу окна сетки: при длинном списке
                          последняя строка не обрезается контейнером, а строки
                          прокручиваются под ней (как под закреплённой шапкой). */}
                      <tfoot className="sticky bottom-0 z-20 [&_td]:shadow-[0_-1px_0_hsl(var(--border))] [&_th]:shadow-[0_-1px_0_hsl(var(--border))]">
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
                                .toLocaleString("ru", { maximumFractionDigits: 1 })}{" "}ч
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
                              .toLocaleString("ru", { maximumFractionDigits: 1 })}{" "}ч
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
                      <section
                        key={d}
                        // В списке смену переносят на другой день у того же
                        // сотрудника; шаблоны сюда не бросают — нет сотрудника.
                        onDragOver={(e) => dragItem?.kind === "shift" && dragOver(e, d, listDropUser)}
                        onDragLeave={(e) => dragLeave(e, d, listDropUser)}
                        onDrop={(e) => dragItem?.kind === "shift" && void drop(e, d, listDropUser)}
                        className={cn(
                          "overflow-hidden rounded-lg border bg-card transition-colors",
                          dropTarget?.day === d && dropTarget.userId === listDropUser &&
                            (dropTarget.ok ? "border-brand/40" : "border-destructive/40"),
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 border-b bg-muted/50 py-1.5 pl-4 pr-2">
                          <h3 className={cn("py-1.5 text-sm font-medium first-letter:uppercase", d === today && "text-brand")}>
                            {dayLabel(d, {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            })}
                          </h3>
                          {can("shift_create") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="touch-target size-8 text-muted-foreground"
                              aria-label={`Добавить смену: ${dayLabel(d)}`}
                              data-tip="Добавить смену"
                              onClick={() => create(d)}
                            >
                              <Plus className="size-4" />
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2 p-3">
                          {weekShifts
                            .filter(
                              (s) =>
                                dateInZone(s.starts_at, data.timezone) === d,
                            )
                            .map((shift) => card(shift, "list"))}
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
                                linked={canOpenCandidates}
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
                          {/* Место под тень: появляется у всех дней сразу при
                              начале переноса, поэтому при движении ничего не
                              прыгает; тень — в дне под курсором. */}
                          {dragItem?.kind === "shift" && (
                            <div aria-hidden className="relative h-14">
                              {dropGhost(d, listDropUser)}
                            </div>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {venueOffset && <span>Время заведения: {venueOffset}</span>}
                {showTasks && calendarTasks && calendarTasksWeek === week && (
                  <span>Задач на неделе: {weekTasks.length}</span>
                )}
              </div>
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
            onArchive={(template) => {
              const label = shiftTemplateLabel(template);
              const run = () =>
                save(
                  "template.archive",
                  { id: template.id, version: template.version },
                  template.archived
                    ? `Шаблон «${label}» восстановлен`
                    : `Шаблон «${label}» в архиве`,
                );
              // Восстановление — сразу; архив — с объяснением, что это не удаление.
              if (template.archived) return void run();
              setConfirmation({
                title: `Убрать шаблон «${label}» в архив?`,
                description:
                  "Это не удаление. Шаблон пропадёт из выбора при создании смен, а уже созданные по нему смены останутся в расписании как есть. Вернуть шаблон можно в любой момент: кнопка архива над списком, затем «Восстановить».",
                confirmLabel: "Убрать в архив",
                action: async () => {
                  await run();
                },
              });
            }}
          />
        )}
      {taskAssign && (
        <TaskAssignDrawer
          data={data}
          day={taskAssign.day}
          template={taskAssign.template}
          personName={name}
          onClose={() => setTaskAssign(null)}
          onDone={() => {
            setTaskAssign(null);
            // Назначенную задачу сразу видно в расписании.
            if (!showTasks) toggleTasks(true);
            else void refreshCalendarTasks(true);
          }}
        />
      )}
      {editor?.type === "shift" && (() => {
        const { returnTo, ...shiftEditor } = editor;
        return (
          <ShiftEditor
            key={`${editor.shift?.id ?? "new"}-${editor.copy}`}
            data={data}
            {...shiftEditor}
            onClose={() => setEditor(null)}
            // «Изменить» из просмотра: «Отмена» возвращает к просмотру той же
            // смены (со свежими данными), а не закрывает всё.
            onCancel={returnTo ? () => {
              setEditor(null);
              setSelected(data.shifts.find((s) => s.id === returnTo) ?? null);
            } : undefined}
            save={save}
            onEditTemplate={setTemplateOverlay}
          />
        );
      })()}
      {editor?.type === "template" && (
        <TemplateEditor
          key={`${editor.template?.id ?? "new"}-${editor.copy}`}
          data={data}
          {...editor}
          onClose={() => setEditor(null)}
          save={saveTemplate(editor.template)}
        />
      )}
      {templateOverlay && (
        <TemplateEditor
          key={`overlay-${templateOverlay.id}`}
          data={data}
          template={templateOverlay}
          onClose={() => setTemplateOverlay(null)}
          save={saveTemplate(templateOverlay)}
        />
      )}
      {applyTemplate && editor?.type !== "template" && !templateOverlay && (() => {
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
            void deleteDropped(shift);
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
          titleAccessory={
            <DrawerStatus
              label={selected.published ? "Опубликована" : "Черновик"}
              tone={selected.published ? "success" : "neutral"}
            />
          }
          description={[
            dayLabel(dateInZone(selected.starts_at, data.timezone), { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (c) => c.toUpperCase()),
            `${timeInZone(selected.starts_at, data.timezone)}–${timeInZone(selected.ends_at, data.timezone)}`,
            `${shiftHours(selected.starts_at, selected.ends_at).toLocaleString("ru", { maximumFractionDigits: 1 })} ч`,
          ].join(" · ")}
          // Без единой кнопки подвал не рисуем: иначе у сотрудника без прав
          // внизу панели остаётся пустая полоса с рамкой.
          footer={
            can("shift_delete") || can("shift_edit") || (!selected.published && can("shift_publish")) ||
            selectedSwapActive || selectedCanRequestSwap ? (
            <>
              {can("shift_delete") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-auto text-destructive hover:text-destructive"
                  aria-label={selected.published ? "Удалить смену" : "Удалить черновик"}
                  data-tip={selected.published ? "Удалить смену" : "Удалить черновик"}
                  onClick={() => confirmDelete(selected)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
              {(selectedSwapActive || selectedCanRequestSwap) && (
                <SwapFooterActions
                  data={data}
                  shift={selected}
                  swap={selectedSwap}
                  canRequest={selectedCanRequestSwap}
                  onRequest={() => {
                    setSwapFor(selected);
                    setSelected(null);
                  }}
                  refresh={refresh}
                  onDone={() => setSelected(null)}
                />
              )}
              {can("shift_edit") && (
                <Button
                  variant={(!selected.published && can("shift_publish")) || selectedSwapDecision ? "outline" : "default"}
                  onClick={() => {
                    setEditor({
                      type: "shift",
                      shift: selected,
                      day: dateInZone(selected.starts_at, data.timezone),
                      returnTo: selected.id,
                    });
                    setSelected(null);
                  }}
                >
                  Изменить
                </Button>
              )}
              {!selected.published && can("shift_publish") && (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (await publishShifts([selected])) {
                      toast.success("Смена опубликована");
                      setSelected(null);
                    }
                  }}
                >
                  <Send />
                  Опубликовать
                </Button>
              )}
            </>
            ) : undefined
          }
        >
          <ShiftDetails
            key={selected.id}
            data={data}
            shift={selected}
            history={history}
            historyHasMore={historyHasMore}
            onLoadMoreHistory={loadMoreHistory}
            personName={name}
            showHistory={canPlan}
            swap={selectedSwap ? <SwapSection data={data} swap={selectedSwap} shift={selected} /> : undefined}
            assignControl={can("shift_assign") && !can("shift_edit") ? (
              <EmployeePicker
                data={data}
                value={shiftAssignee(selected)}
                includeCasual={data.permissions.includes("payroll.configure")}
                onChange={async (next) => {
                  if (
                    await save("shift.assign", {
                      id: selected.id,
                      version: selected.version,
                      ...assignmentFields(next),
                      payroll_model_id: casualPayModel(next, selected),
                    })
                  )
                    setSelected(null);
                }}
              />
            ) : undefined}
          />
        </EditDrawer>
      )}
      {swapFor && (
        <SwapRequestDrawer data={data} shift={swapFor} refresh={refresh} onClose={() => setSwapFor(null)} />
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
              variant={confirmation?.destructive ? "destructive" : "default"}
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
              {confirmation?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageFrame>
    </TaskTitleTarget.Provider>
  );
}
