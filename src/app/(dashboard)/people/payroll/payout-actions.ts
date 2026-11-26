"use server";
import { z } from "zod";
import { actionResult, unwrapAction } from "@/lib/actions/result";
import { writeAuditEvent } from "@/lib/audit/write";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import {
  PAYOUT_SCHEDULE_LABELS,
  firstPayoutWindow,
  recheckDue,
  type PayoutScheduleCode,
  type PlannedRow,
} from "@/lib/payroll/payout-plan";
import type { IssueLine } from "@/lib/payroll/payout-issue";
import {
  SCHEDULES,
  buildContext,
  buildPreview,
  executeCashIssue,
  findPlan,
  loadSettingsRow,
  money,
  plan,
  planById,
  planRows,
  sendIssueMessage,
  type Context,
  type IssuePreview as EngineIssuePreview,
  type MessageState as EngineMessageState,
  type PayoutSettingsView as EnginePayoutSettingsView,
  type PayoutSourceData,
  type RowRecord,
} from "@/lib/payroll/payout-engine";
import { loadPayrollOverview } from "./actions";
import { payrollScope, type PayrollScope } from "./payroll-scope";

// Типы для экранов. В "use server"-файле нельзя `export … from`: только
// объявления типов и async-функции.
export type IssuePreview = EngineIssuePreview;
export type MessageState = EngineMessageState;
export type PayoutSettingsView = EnginePayoutSettingsView;

// План выплат: черновик → утверждение → «Выдать сегодня» (наличные касс,
// распределение, проведение с кэшбокса, сообщение менеджерам) и «Выплачено»
// для строк переводом. Защита от переплаты — в базе (миграция 391), здесь
// суммы только пересчитываются и уменьшаются.

const scheduleSchema = z.enum(SCHEDULES);

export type PayoutRowView = PlannedRow & {
  id: string | null;
  name: string;
  role: string;
  avatarUrl: string | null;
  issued: number;
  state: "planned" | "partial" | "issued";
  /**
   * Сколько выдадим по строке при выдаче (вместе с уже выданным): сумма плана,
   * срезанная свежим потолком, если после формирования появились выплаты или
   * штрафы. Пересчёт формулы сюда не входит — план не «плывёт» от прогноза.
   * null — строка выдана.
   */
  willIssue: number | null;
  /** Выплачено за месяц на сейчас: ручные выплаты, авансы и выданное по плану. */
  paidNow: number;
  /** Вне плана (график «Переводом»): платят себе по счетам, выплаты вносят вручную. */
  outside: boolean;
  /** Дни опубликованных смен сотрудника в окне выплаты — подсказка при выборе дня. */
  shiftDays: string[];
};
export type PayoutPlanView = {
  schedule: PayoutScheduleCode;
  today: string;
  window: { month: string; from: string; to: string } | null;
  plan: { id: string; state: "draft" | "approved" | "cancelled"; version: number; month: string } | null;
  rows: PayoutRowView[];
  settings: PayoutSettingsView;
  banks: { id: string; name: string; type: string }[];
  canPay: boolean;
  canIssue: boolean;
  /** Нет доступа к графику работы всей команды: дни и прогноз по сменам недоступны. */
  shiftsHidden: boolean;
};
/** Данные ведомости пользователя для плана выплат. */
async function userData(): Promise<PayoutSourceData> {
  return unwrapAction(await loadPayrollOverview());
}
async function context(s: PayrollScope, month: string | null): Promise<Context> {
  return buildContext(s, await userData(), month);
}

async function loadPayoutPlanImpl(schedule: PayoutScheduleCode): Promise<PayoutPlanView> {
  scheduleSchema.parse(schedule);
  const s = await payrollScope("payroll.view");
  return planView(s, schedule, await context(s, null));
}

/**
 * План для экрана из уже прочитанных данных: действия плана отдают его сразу,
 * без второй загрузки всей зарплаты (раньше «Сформировать план» грузил её трижды).
 */
async function planView(s: PayrollScope, schedule: PayoutScheduleCode, firstCtx: Context): Promise<PayoutPlanView> {
  const window = firstPayoutWindow(firstCtx.today);
  // Вне окна показываем последний план графика, если он есть.
  const saved = await findPlan(s, schedule, window?.month ?? null);
  const ctx = saved && saved.month !== window?.month ? await context(s, saved.month) : firstCtx;
  const month = saved?.month ?? window?.month ?? null;
  const span = saved ? { from: saved.window_from, to: saved.window_to } : window;
  const fresh = month && span ? plan(ctx, schedule, month, span) : [];
  const freshBy = new Map(fresh.map((r) => [r.employee_id, r]));
  const step = ctx.settings.schedules[schedule].step;
  const shiftDays = (id: string) =>
    span
      ? [...new Set(ctx.shifts
          .filter((x) => x.employee_id === id && x.business_date >= span.from && x.business_date <= span.to)
          .map((x) => x.business_date))].sort()
      : [];
  const employees = new Map(ctx.data.employees.map((e) => [e.id, e]));
  const person = (id: string) => {
    const e = employees.get(id);
    return { name: e?.name ?? "Сотрудник", role: e?.role_name ?? "", avatarUrl: e?.avatar_url ?? null };
  };
  const rows: PayoutRowView[] = saved
    ? (await planRows(s, saved.id)).map((row) => ({
        employee_id: row.employee_id,
        pay_date: row.pay_date,
        amount: row.amount,
        breakdown: row.breakdown,
        id: row.id,
        ...person(row.employee_id),
        issued: row.issued,
        state: row.state,
        // Так же, как при выдаче: план режет только свежий потолок (recheckDue).
        willIssue: row.state === "issued"
          ? null
          : money(recheckDue(row, freshBy.get(row.employee_id)?.breakdown.ceiling ?? 0, step).due + row.issued),
        paidNow: freshBy.get(row.employee_id)?.breakdown.paid ?? row.breakdown.paid,
        outside: false,
        shiftDays: shiftDays(row.employee_id),
      }))
    : fresh.map((row) => ({
        ...row, id: null, ...person(row.employee_id), issued: 0, state: "planned" as const, willIssue: row.amount,
        paidNow: row.breakdown.paid, outside: false, shiftDays: shiftDays(row.employee_id),
      }));
  // Вне плана — строками со статусом, без сумм к выплате.
  const outside: PayoutRowView[] =
    month && span
      ? plan(ctx, "transfer", month, span).map((row) => ({
          ...row, amount: 0, pay_date: null, id: null, ...person(row.employee_id), issued: 0, state: "planned" as const,
          willIssue: null, paidNow: row.breakdown.paid, outside: true, shiftDays: [],
        }))
      : [];
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  rows.push(...outside.sort((a, b) => a.name.localeCompare(b.name, "ru")));
  return {
    schedule,
    today: ctx.today,
    window: saved ? { month: saved.month, from: saved.window_from, to: saved.window_to } : window,
    plan: saved ? { id: saved.id, state: saved.state, version: saved.version, month: saved.month } : null,
    rows,
    settings: ctx.settings,
    banks: ctx.data.banks.filter((b) => b.type === "cash" || b.type === "checking").map((b) => ({ id: b.id, name: b.name, type: b.type })),
    canPay: s.permissions.includes("payroll.pay"),
    canIssue: s.permissions.includes("payroll.pay") && s.permissions.includes("finance.create_transaction"),
    shiftsHidden: !s.permissions.includes("schedule.view_all"),
  };
}

/**
 * Выплаты по плану: право на выплаты и на просмотр зарплаты. Без просмотра
 * выплаты и строки плана скрыты политиками, и расчёт увидел бы «выплачено 0».
 */
async function payScope() {
  const s = await payrollScope("payroll.pay");
  if (!s.permissions.includes("payroll.view")) throw new Error("Нужен доступ к просмотру зарплаты");
  return s;
}

async function employeeName(s: PayrollScope, id: string): Promise<string> {
  const r = await s.db.from<{ name: string }>("payroll_employees").select("name").eq("venue_id", s.venueId).eq("id", id).maybeSingle();
  return r.data?.name ?? "Сотрудник";
}

function audit(s: PayrollScope, actionCode: string, entityId: string | null, details: Record<string, unknown>) {
  return writeAuditEvent({
    accountId: s.accountId,
    venueId: s.venueId,
    userId: s.user.id,
    actionCode,
    entityType: "payroll_payout_plan",
    entityId,
    details,
  });
}

async function savePayoutPlanImpl(schedule: PayoutScheduleCode): Promise<PayoutPlanView> {
  scheduleSchema.parse(schedule);
  const s = await payScope();
  const ctx = await context(s, null);
  const window = firstPayoutWindow(ctx.today);
  if (!window) throw new Error("Сейчас не окно первой выплаты: оно с 25-го по 1-е число");
  const rows = plan(ctx, schedule, window.month, window);
  const before = await findPlan(s, schedule, window.month);
  const r = await s.client.rpc("payroll_payout_plan_save", {
    p_input: {
      schedule,
      month: window.month,
      payout_no: 1,
      window_from: window.from,
      window_to: window.to,
      rows: rows.map((row) => ({
        employee_id: row.employee_id,
        pay_date: row.pay_date,
        amount: row.amount,
        breakdown: row.breakdown,
      })),
    },
  });
  if (r.error) throw new Error(r.error.message);
  const id = r.data as string;
  await audit(s, before ? "payroll.payout_plan.recalculated" : "payroll.payout_plan.created", id, {
    month: window.month,
    schedule,
    schedule_label: PAYOUT_SCHEDULE_LABELS[schedule],
    rows: rows.length,
    total: money(rows.reduce((sum, row) => sum + row.amount, 0)),
  });
  return planView(s, schedule, ctx);
}

const rowUpdateSchema = z.object({
  rowId: z.string().uuid(),
  amount: z.number().min(0, "Сумма не может быть отрицательной").max(1_000_000_000),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
async function updatePayoutRowImpl(rowId: string, amount: number, payDate: string | null): Promise<PayoutPlanView> {
  const input = rowUpdateSchema.parse({ rowId, amount, payDate });
  const s = await payScope();
  const before = await s.db
    .from<RowRecord & { amount: number }>("payroll_payout_rows")
    .select("id,plan_id,employee_id,amount,pay_date")
    .eq("venue_id", s.venueId)
    .eq("id", input.rowId)
    .maybeSingle();
  if (before.error) throw new Error(before.error.message);
  if (!before.data) throw new Error("Строка плана недоступна");
  const r = await s.client.rpc("payroll_payout_row_update", {
    p_row: input.rowId,
    p_amount: money(input.amount),
    p_pay_date: input.payDate,
  });
  if (r.error) throw new Error(r.error.message);
  await audit(s, "payroll.payout_plan.row_changed", before.data.plan_id, {
    employee_id: before.data.employee_id,
    employee_name: await employeeName(s, before.data.employee_id),
    amount: money(input.amount),
    previous_amount: Number(before.data.amount),
    pay_date: input.payDate,
    previous_pay_date: before.data.pay_date,
  });
  return planView(s, "main", await context(s, null));
}

async function setPayoutPlanStateImpl(planId: string, state: "approved" | "cancelled"): Promise<PayoutPlanView> {
  z.string().uuid().parse(planId);
  z.enum(["approved", "cancelled"]).parse(state);
  const s = await payScope();
  const current = await planById(s, planId);
  const r = await s.client.rpc("payroll_payout_plan_state", { p_plan: planId, p_state: state });
  if (r.error) throw new Error(r.error.message);
  const rows = await planRows(s, planId);
  await audit(s, `payroll.payout_plan.${state}`, planId, {
    month: current.month,
    schedule: current.schedule,
    schedule_label: PAYOUT_SCHEDULE_LABELS[current.schedule],
    total: money(rows.reduce((sum, row) => sum + row.amount, 0)),
  });
  return planView(s, current.schedule, await context(s, null));
}

async function previewPayoutTodayImpl(planId: string): Promise<IssuePreview> {
  z.string().uuid().parse(planId);
  const s = await payScope();
  const { ctx: _ctx, plan: _plan, ...preview } = await buildPreview(s, await userData(), planId);
  void _ctx;
  void _plan;
  return preview;
}

const lineSchema = z.object({
  row_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  name: z.string(),
  amount: z.number().positive(),
  next_pay_date: z.string().nullable(),
  close: z.boolean(),
});
async function issuePayoutTodayImpl(planId: string, requestKey: string, expected: IssueLine[]) {
  z.string().uuid().parse(planId);
  z.string().uuid().parse(requestKey);
  const wanted = z.array(lineSchema).min(1).max(500).parse(expected);
  const s = await payScope();
  if (!s.permissions.includes("finance.create_transaction")) throw new Error("Нет доступа к финансовым операциям");

  // Повтор после обрыва связи: выдача по этому ключу уже проведена — только сообщение.
  const existing = await s.db
    .from<{ id: string; message: string | null; total: number }>("payroll_payout_issues")
    .select("id,message,total")
    .eq("venue_id", s.venueId)
    .eq("request_key", requestKey)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const sent = await sendIssueMessage(s, existing.data.id, (await loadSettingsRow(s))?.chat_id ?? null);
    return { issueId: existing.data.id, messageState: sent, message: existing.data.message ?? "", notMoved: [] as string[] };
  }

  const preview = await buildPreview(s, await userData(), planId);
  if (preview.problem) throw new Error(preview.problem);
  const key = (l: { row_id: string; amount: number }) => `${l.row_id}:${money(l.amount)}`;
  const same =
    preview.lines.length === wanted.length &&
    [...preview.lines.map(key)].sort().join() === [...wanted.map(key)].sort().join();
  if (!same) throw new Error("Наличные или суммы изменились, проверьте ещё раз");
  const result = await executeCashIssue(s, preview, requestKey, s.user.id, async (input) => {
    const r = await s.db.rpc("payroll_payout_issue", { p_input: input });
    if (r.error) throw new Error(r.error.message);
    return r.data as string;
  });
  return { issueId: result.issueId, messageState: result.messageState, message: preview.message, notMoved: result.notMoved };
}

const settingsSchema = z.object({
  min_cash: z.number().min(0, "Минимум не может быть отрицательным").max(1_000_000_000),
  chat_id: z.string().trim().regex(/^(-?\d+)?$/, "Укажите числовой ID чата"),
  bank_account_id: z.string().uuid().nullable(),
  schedules: z.object({
    main: z.object({ step: z.number().int().min(1).max(100000), reserve: z.number().min(0).max(1_000_000) }),
    cleaner: z.object({ step: z.number().int().min(1).max(100000), reserve: z.number().min(0).max(1_000_000) }),
    // Переводом: без шага, запаса и счёта по умолчанию — счёт выбирают при оплате.
    transfer: z.object({}).optional(),
  }),
  assignments: z.array(z.object({ employee_id: z.string().uuid(), schedule: scheduleSchema })).max(1000),
});
export type PayoutSettingsInput = z.input<typeof settingsSchema>;
async function savePayoutSettingsImpl(input: PayoutSettingsInput) {
  const value = settingsSchema.parse(input);
  const s = await payrollScope("payroll.configure");
  const previous = await loadSettingsRow(s);
  const chat = value.chat_id || null;
  // В чат уходят имена и суммы: принимаем только чат, где состоит бот аккаунта.
  if (chat && chat !== previous?.chat_id) {
    const bot = await loadTelegramBot(s.admin, s.accountId);
    if (!bot) throw new Error("Сначала подключите Telegram-бота в интеграциях");
    let own;
    try {
      own = await bot.getOwnMembership(chat);
    } catch {
      throw new Error("Telegram не ответил, чат не проверен. Сохраните ещё раз через минуту");
    }
    if (own.uncertain) throw new Error("Telegram не ответил, чат не проверен. Сохраните ещё раз через минуту");
    if (!own.ok) {
      throw new Error(
        /chat not found/i.test(own.description ?? "")
          ? "Telegram не нашёл чат с таким ID. Проверьте ID: у групп он начинается с -100"
          : `Telegram не дал проверить чат: ${own.description ?? "неизвестная ошибка"}`,
      );
    }
    if (!["member", "administrator", "creator"].includes(own.result?.status ?? "")) {
      throw new Error("Бот не состоит в этом чате. Добавьте бота в чат менеджеров и сохраните снова");
    }
  }
  const r = await s.client.rpc("payroll_payout_save_settings", {
    p_input: { ...value, chat_id: value.chat_id || null },
  });
  if (r.error) throw new Error(r.error.message);
  await writeAuditEvent({
    accountId: s.accountId,
    venueId: s.venueId,
    userId: s.user.id,
    actionCode: "payroll.payout_settings.updated",
    entityType: "payroll_payout_settings",
    entityId: s.venueId,
    details: {
      min_cash: value.min_cash,
      chat_id: chat,
      previous_chat_id: previous?.chat_id ?? null,
      steps: { main: value.schedules.main.step, cleaner: value.schedules.cleaner.step },
      reserves: { main: value.schedules.main.reserve, cleaner: value.schedules.cleaner.reserve },
      assignments: value.assignments.length,
    },
  });
}

/** Сотрудники заведения с их графиком — для карточки настроек. */
async function loadPayoutAssignmentsImpl() {
  const s = await payrollScope("payroll.configure");
  const r = await s.db
    .from<{ id: string; name: string; payout_schedule: PayoutScheduleCode; active: boolean; casual: boolean | null }[]>("payroll_employees")
    .select("id,name,payout_schedule,active,casual")
    .eq("venue_id", s.venueId)
    .eq("active", true)
    .order("name");
  if (r.error) throw new Error(r.error.message);
  const settings = await loadSettingsRow(s);
  return {
    employees: (r.data ?? []).filter((e) => !e.casual).map((e) => ({ id: e.id, name: e.name, schedule: e.payout_schedule })),
    saved: settings,
  };
}

async function setPayoutAutoImpl(enabled: boolean) {
  z.boolean().parse(enabled);
  const s = await payrollScope("payroll.configure");
  // Автовыдача проводит деньги: включает только тот, кто может выдавать сам.
  if (enabled && !(s.permissions.includes("payroll.pay") && s.permissions.includes("finance.create_transaction")))
    throw new Error("Включить автовыдачу могут те, у кого есть права на выплаты и операции в финансах");
  const r = await s.db.rpc("payroll_payout_set_auto", { p_enabled: enabled });
  if (r.error) throw new Error(r.error.message);
  await writeAuditEvent({
    accountId: s.accountId,
    venueId: s.venueId,
    userId: s.user.id,
    actionCode: "payroll.payout_settings.updated",
    entityType: "payroll_payout_settings",
    entityId: s.venueId,
    details: { auto_issue: enabled },
  });
}

export type PayoutAssignments = Awaited<ReturnType<typeof loadPayoutAssignmentsImpl>>;

// Действия возвращают ошибку текстом, а не исключением (см. lib/actions/result).
export async function loadPayoutPlan(schedule: PayoutScheduleCode) {
  return actionResult(() => loadPayoutPlanImpl(schedule), "Не удалось загрузить план выплат");
}
export async function savePayoutPlan(schedule: PayoutScheduleCode) {
  return actionResult(() => savePayoutPlanImpl(schedule), "Не удалось сформировать план выплат");
}
export async function updatePayoutRow(rowId: string, amount: number, payDate: string | null) {
  return actionResult(() => updatePayoutRowImpl(rowId, amount, payDate), "Не удалось сохранить строку плана");
}
export async function setPayoutPlanState(planId: string, state: "approved" | "cancelled") {
  return actionResult(() => setPayoutPlanStateImpl(planId, state), "Не удалось изменить план выплат");
}
export async function previewPayoutToday(planId: string) {
  return actionResult(() => previewPayoutTodayImpl(planId), "Не удалось проверить наличные в кассах");
}
export async function issuePayoutToday(planId: string, requestKey: string, expected: IssueLine[]) {
  return actionResult(() => issuePayoutTodayImpl(planId, requestKey, expected), "Не удалось провести выдачу");
}
export async function savePayoutSettings(input: PayoutSettingsInput) {
  return actionResult(() => savePayoutSettingsImpl(input), "Не удалось сохранить график выплат");
}
export async function setPayoutAuto(enabled: boolean) {
  return actionResult(() => setPayoutAutoImpl(enabled), "Не удалось переключить автовыдачу");
}
export async function loadPayoutAssignments() {
  return actionResult(() => loadPayoutAssignmentsImpl(), "Не удалось загрузить график выплат");
}
