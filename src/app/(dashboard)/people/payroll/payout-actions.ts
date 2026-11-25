"use server";
import { z } from "zod";
import { actionResult, unwrapAction } from "@/lib/actions/result";
import { writeAuditEvent } from "@/lib/audit/write";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { addDays, businessDate } from "@/lib/sales/time";
import {
  DEFAULT_PAYOUT_SCHEDULES,
  PAYOUT_SCHEDULE_LABELS,
  firstPayoutWindow,
  planFirstPayout,
  recheckDue,
  type PayoutSchedule,
  type PayoutScheduleCode,
  type PlannedRow,
} from "@/lib/payroll/payout-plan";
import {
  cashAvailable,
  distributeCash,
  payoutMessage,
  type DueRow,
  type IssueLine,
  type RegisterCash,
} from "@/lib/payroll/payout-issue";
import { readRegisterCash } from "@/lib/payroll/payout-cash";
import type { PayrollData } from "@/lib/payroll/types";
import { loadPayrollOverview } from "./actions";
import { payrollScope, type PayrollScope } from "./payroll-scope";

// План выплат: черновик → утверждение → «Выдать сегодня» (наличные касс,
// распределение, проведение с кэшбокса, сообщение менеджерам) и «Выплачено»
// для строк переводом. Защита от переплаты — в базе (миграция 391), здесь
// суммы только пересчитываются и уменьшаются.

const SCHEDULES = ["main", "cleaner", "transfer"] as const;
const scheduleSchema = z.enum(SCHEDULES);

type PlanRecord = {
  id: string;
  schedule: PayoutScheduleCode;
  month: string;
  payout_no: number;
  window_from: string;
  window_to: string;
  state: "draft" | "approved" | "cancelled";
  version: number;
};
type RowRecord = {
  id: string;
  plan_id: string;
  employee_id: string;
  pay_date: string | null;
  amount: number;
  issued: number;
  state: "planned" | "partial" | "issued";
  breakdown: PlannedRow["breakdown"];
};
type SettingsRecord = {
  min_cash: number;
  chat_id: string | null;
  bank_account_id: string | null;
  schedules: Partial<Record<PayoutScheduleCode, Partial<PayoutSchedule>>>;
};
export type PayoutSettingsView = {
  min_cash: number;
  chat_id: string | null;
  bank_account_id: string | null;
  schedules: Record<PayoutScheduleCode, PayoutSchedule>;
  /** true — настройки ещё не сохранялись, показаны значения по умолчанию. */
  defaults: boolean;
};
export type PayoutRowView = PlannedRow & {
  id: string | null;
  name: string;
  role: string;
  avatarUrl: string | null;
  issued: number;
  state: "planned" | "partial" | "issued";
  /** Сколько вышло бы сейчас, с учётом новых выплат и штрафов; null — строка уже выдана. */
  fresh: number | null;
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
  /** Сотрудники вне плана (график «Переводом»): платят себе по счетам, выплаты вносят вручную. */
  outside: string[];
};
export type IssuePreview = {
  requestKey: string;
  registers: RegisterCash[];
  minimum: number;
  issuedToday: number;
  available: number;
  lines: IssueLine[];
  short: DueRow[];
  message: string;
  /** Почему выдать нельзя; null — можно. */
  problem: string | null;
  /** Выдать можно, но сообщение само не уйдёт. */
  warning: string | null;
};

const money = (n: number) => Math.round(n * 100) / 100;

function mergeSettings(row: SettingsRecord | null, data: PayrollData): PayoutSettingsView {
  const schedules = Object.fromEntries(
    SCHEDULES.map((code) => [code, { ...DEFAULT_PAYOUT_SCHEDULES[code], ...(row?.schedules?.[code] ?? {}) }]),
  ) as Record<PayoutScheduleCode, PayoutSchedule>;
  // До первой настройки — счета, с которых платили и раньше.
  const byName = (type: string, pattern: RegExp) =>
    data.banks.find((b) => b.type === type && pattern.test(b.name))?.id ?? null;
  schedules.transfer = { ...DEFAULT_PAYOUT_SCHEDULES.transfer };
  return {
    min_cash: Number(row?.min_cash ?? 120000),
    chat_id: row?.chat_id ?? null,
    bank_account_id: row?.bank_account_id ?? byName("cash", /кэшбокс/i),
    schedules,
    defaults: !row,
  };
}

async function loadSettingsRow(s: PayrollScope): Promise<SettingsRecord | null> {
  const r = await s.db
    .from<SettingsRecord>("payroll_payout_settings")
    .select("min_cash,chat_id,bank_account_id,schedules")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

type Context = {
  s: PayrollScope;
  data: PayrollData;
  today: string;
  settings: PayoutSettingsView;
  shifts: { employee_id: string; business_date: string }[];
};

/** Данные ведомости, сегодняшний рабочий день и опубликованные смены месяца. */
async function context(s: PayrollScope, month: string | null): Promise<Context> {
  const data = unwrapAction(await loadPayrollOverview());
  const today = businessDate(new Date(), data.timezone, data.dayStartHour);
  const settings = mergeSettings(await loadSettingsRow(s), data);
  const base = month ?? firstPayoutWindow(today)?.month ?? `${today.slice(0, 7)}-01`;
  const until = `${addDays(`${base.slice(0, 7)}-28`, 10).slice(0, 7)}-01`;
  // Окно первой выплаты заходит на 1-е число следующего месяца.
  const to = addDays(until, 2);
  const raw = await fetchAllRows<{ starts_at: string; user_id: string | null; payroll_employee_id: string | null }>(() =>
    s.db
      .from<{ starts_at: string; user_id: string | null; payroll_employee_id: string | null }[]>("schedule_shifts")
      .select("id,starts_at,user_id,payroll_employee_id")
      .eq("venue_id", s.venueId)
      .eq("published", true)
      .gte("starts_at", `${addDays(base, -1)}T00:00:00Z`)
      .lt("starts_at", `${to}T00:00:00Z`),
  );
  const byUser = new Map(data.employees.flatMap((e) => (e.local_user_id ? [[e.local_user_id, e.id] as const] : [])));
  const shifts = raw.flatMap((shift) => {
    const employee_id = shift.payroll_employee_id ?? (shift.user_id ? byUser.get(shift.user_id) : undefined);
    if (!employee_id) return [];
    return [{ employee_id, business_date: businessDate(new Date(shift.starts_at), data.timezone, data.dayStartHour) }];
  });
  return { s, data, today, settings, shifts };
}

function plan(ctx: Context, schedule: PayoutScheduleCode, month: string, window: { from: string; to: string }) {
  return planFirstPayout({
    data: ctx.data,
    schedules: ctx.settings.schedules,
    schedule,
    month,
    today: ctx.today,
    window,
    shifts: ctx.shifts,
  });
}

async function findPlan(s: PayrollScope, schedule: PayoutScheduleCode, month: string | null) {
  let query = s.db
    .from<PlanRecord[]>("payroll_payout_plans")
    .select("id,schedule,month,payout_no,window_from,window_to,state,version")
    .eq("venue_id", s.venueId)
    .eq("schedule", schedule)
    .eq("payout_no", 1)
    .neq("state", "cancelled");
  if (month) query = query.eq("month", month);
  const r = await query.order("month", { ascending: false }).limit(1);
  if (r.error) throw new Error(r.error.message);
  return r.data?.[0] ?? null;
}
async function planById(s: PayrollScope, id: string) {
  const r = await s.db
    .from<PlanRecord>("payroll_payout_plans")
    .select("id,schedule,month,payout_no,window_from,window_to,state,version")
    .eq("venue_id", s.venueId)
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) throw new Error("План недоступен");
  return r.data;
}
async function planRows(s: PayrollScope, planId: string) {
  const r = await s.db
    .from<RowRecord[]>("payroll_payout_rows")
    .select("id,plan_id,employee_id,pay_date,amount,issued,state,breakdown")
    .eq("venue_id", s.venueId)
    .eq("plan_id", planId);
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((row) => ({ ...row, amount: Number(row.amount), issued: Number(row.issued) }));
}

async function loadPayoutPlanImpl(schedule: PayoutScheduleCode): Promise<PayoutPlanView> {
  scheduleSchema.parse(schedule);
  const s = await payrollScope("payroll.view");
  const firstCtx = await context(s, null);
  const window = firstPayoutWindow(firstCtx.today);
  // Вне окна показываем последний план графика, если он есть.
  const saved = await findPlan(s, schedule, window?.month ?? null);
  const ctx = saved && saved.month !== window?.month ? await context(s, saved.month) : firstCtx;
  const month = saved?.month ?? window?.month ?? null;
  const span = saved ? { from: saved.window_from, to: saved.window_to } : window;
  const fresh = month && span ? plan(ctx, schedule, month, span) : [];
  const freshBy = new Map(fresh.map((r) => [r.employee_id, r]));
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
        fresh: row.state === "issued" ? null : money((freshBy.get(row.employee_id)?.amount ?? 0) + row.issued),
      }))
    : fresh.map((row) => ({ ...row, id: null, ...person(row.employee_id), issued: 0, state: "planned", fresh: row.amount }));
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
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
    outside: ctx.data.employees
      .filter((e) => e.active && !e.casual && e.payout_schedule === "transfer")
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "ru")),
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

async function savePayoutPlanImpl(schedule: PayoutScheduleCode): Promise<string> {
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
  return id;
}

const rowUpdateSchema = z.object({
  rowId: z.string().uuid(),
  amount: z.number().min(0, "Сумма не может быть отрицательной").max(1_000_000_000),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
async function updatePayoutRowImpl(rowId: string, amount: number, payDate: string | null) {
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
}

async function setPayoutPlanStateImpl(planId: string, state: "approved" | "cancelled") {
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
}

async function issuedToday(s: PayrollScope, today: string) {
  const r = await s.db
    .from<{ total: number }[]>("payroll_payout_issues")
    .select("total")
    .eq("venue_id", s.venueId)
    .eq("business_date", today)
    .eq("method", "cash");
  if (r.error) throw new Error(r.error.message);
  return money((r.data ?? []).reduce((sum, row) => sum + Number(row.total), 0));
}

async function buildPreview(s: PayrollScope, planId: string): Promise<IssuePreview & { ctx: Context; plan: PlanRecord }> {
  const current = await planById(s, planId);
  if (current.state !== "approved") throw new Error("Сначала утвердите план");
  const ctx = await context(s, current.month);
  const schedule = ctx.settings.schedules[current.schedule];
  if (schedule.method !== "cash") throw new Error("Этот график выдаётся переводом: отмечайте «Выплачено» по строке");
  const window = { from: current.window_from, to: current.window_to };
  // Свежий потолок: ручные выплаты и штрафы после утверждения. Саму сумму плана не пересчитываем.
  const ceilings = new Map(plan(ctx, current.schedule, current.month, window).map((r) => [r.employee_id, r.breakdown.ceiling]));
  const todays = (await planRows(s, planId)).filter((row) => row.state !== "issued" && row.pay_date === ctx.today);
  const employeeOf = (id: string) => ctx.data.employees.find((e) => e.id === id);
  // Сотрудника перевели на другой график после утверждения — по этому плану не выдаём.
  const moved = todays.filter((row) => (employeeOf(row.employee_id)?.payout_schedule ?? "main") !== current.schedule);
  const rows = todays.filter((row) => !moved.includes(row));
  // В сообщении — имя и фамилия, как в карточке сотрудника.
  const names = new Map(rows.map((row) => [row.employee_id, employeeOf(row.employee_id)?.name ?? "Сотрудник"]));
  const due: DueRow[] = rows
    .map((row) => {
      const nextShift = ctx.shifts
        .filter((x) => x.employee_id === row.employee_id && x.business_date > ctx.today && x.business_date <= window.to)
        .map((x) => x.business_date)
        .sort()[0];
      // Сумма только уменьшается: новые ручные выплаты и штрафы снижают потолок.
      const { due, capped } = recheckDue(row, ceilings.get(row.employee_id) ?? 0, schedule.step);
      return {
        row_id: row.id,
        employee_id: row.employee_id,
        name: names.get(row.employee_id) ?? "Сотрудник",
        due: money(due),
        capped,
        next_pay_date: nextShift ?? null,
      };
    })
    .filter((row) => row.due > 0);
  const registers = await readRegisterCash(s.accountId, s.venueId, ctx.today);
  const minimum = ctx.settings.min_cash;
  const already = await issuedToday(s, ctx.today);
  const available = registers ? cashAvailable(registers, minimum, already) : 0;
  const { lines, short } = distributeCash(due, available, schedule.step);
  const problem = !ctx.settings.bank_account_id
    ? "Выберите кассу для выдачи в настройках графика выплат"
    : !due.length
      ? "Сегодня по плану выдавать некому"
      : !registers
        ? "Нет данных о наличных в кассах"
        : available <= 0 || !lines.length
          ? "В кассах меньше минимума"
          : null;
  return {
    requestKey: crypto.randomUUID(),
    registers: registers ?? [],
    minimum,
    issuedToday: already,
    available,
    lines,
    short,
    message: lines.length ? payoutMessage(lines) : "",
    problem,
    warning: [
      ctx.settings.chat_id ? null : "Не указан чат менеджеров: сообщение придётся отправить вручную",
      moved.length
        ? `На другом графике выплат, по этому плану не выдаём: ${moved.map((r) => employeeOf(r.employee_id)?.name ?? "Сотрудник").join(", ")}`
        : null,
    ].filter(Boolean).join(". ") || null,
    ctx,
    plan: current,
  };
}

async function previewPayoutTodayImpl(planId: string): Promise<IssuePreview> {
  z.string().uuid().parse(planId);
  const s = await payScope();
  const { ctx: _ctx, plan: _plan, ...preview } = await buildPreview(s, planId);
  void _ctx;
  void _plan;
  return preview;
}

type IssueRecord = { id: string; message: string | null; message_sent_at: string | null; message_error: string | null; total: number };
const UNCERTAIN = "Telegram не подтвердил доставку: проверьте чат менеджеров";

/** Отправляет сообщение выдачи один раз: строку забирает тот, кто первым сменил её статус. */
/** sent — отправлено; sending — отправляет параллельный запрос; failed — отправить вручную. */
export type MessageState = "sent" | "sending" | "failed";

async function sendIssueMessage(s: PayrollScope, issueId: string, chatId: string | null): Promise<MessageState> {
  const read = await s.admin
    .from<IssueRecord>("payroll_payout_issues")
    .select("id,message,message_sent_at,message_error,total")
    .eq("id", issueId)
    .eq("venue_id", s.venueId)
    .single();
  if (read.error || !read.data) throw new Error("Выдача не найдена");
  const issue = read.data;
  if (issue.message_sent_at) return "sent";
  if (!issue.message || !chatId) return "failed";
  // Сообщение отправляет первый запрос (повтор пришёл, пока он работал).
  if (issue.message_error === "sending") return "sending";
  if (issue.message_error === UNCERTAIN) return "failed";
  let claim = s.admin.from<{ id: string }[]>("payroll_payout_issues").update({ message_error: "sending" }).eq("id", issueId).is("message_sent_at", null);
  claim = issue.message_error === null ? claim.is("message_error", null) : claim.eq("message_error", issue.message_error);
  const claimed = await claim.select("id");
  if (claimed.error || !claimed.data?.length) return "sending";
  let error: string | null = null;
  try {
    const bot = await loadTelegramBot(s.admin, s.accountId);
    if (!bot) error = "Telegram-бот не подключён";
    else {
      const sent = await bot.sendMessage(chatId, issue.message);
      if (!sent.ok) error = sent.uncertain ? UNCERTAIN : `Telegram: ${sent.description ?? "сообщение не отправлено"}`;
    }
  } catch (e) {
    error = e instanceof Error && /[а-яё]/i.test(e.message) ? e.message : "Telegram не ответил";
  }
  const done = await s.admin
    .from("payroll_payout_issues")
    .update(error ? { message_error: error } : { message_sent_at: new Date().toISOString(), message_error: null })
    .eq("id", issueId);
  if (done.error) console.error("[payroll-payout] статус сообщения не записан", done.error.message);
  return error ? "failed" : "sent";
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

  const preview = await buildPreview(s, planId);
  if (preview.problem) throw new Error(preview.problem);
  const key = (l: { row_id: string; amount: number }) => `${l.row_id}:${money(l.amount)}`;
  const same =
    preview.lines.length === wanted.length &&
    [...preview.lines.map(key)].sort().join() === [...wanted.map(key)].sort().join();
  if (!same) throw new Error("Наличные или суммы изменились, проверьте ещё раз");

  const r = await s.client.rpc("payroll_payout_issue", {
    p_input: {
      request_key: requestKey,
      plan_id: planId,
      method: "cash",
      bank_account_id: preview.ctx.settings.bank_account_id,
      date: new Date().toISOString(),
      business_date: preview.ctx.today,
      message: preview.message,
      cash: {
        registers: preview.registers,
        minimum: preview.minimum,
        issued_today: preview.issuedToday,
        available: preview.available,
      },
      lines: preview.lines.map((l) => ({ row_id: l.row_id, amount: l.amount, next_pay_date: l.next_pay_date, close: l.close })),
    },
  });
  if (r.error) throw new Error(r.error.message);
  const issueId = r.data as string;
  const total = money(preview.lines.reduce((sum, l) => sum + l.amount, 0));
  // Кому сегодня не хватило совсем — переносим на следующую смену в окне.
  // Перенос пишется в журнал; не вышло — говорим, у кого выбрать день вручную.
  const notMoved: string[] = [];
  const after = await planRows(s, planId);
  for (const row of preview.short) {
    if (preview.lines.some((l) => l.row_id === row.row_id)) continue;
    const current = after.find((r) => r.id === row.row_id);
    if (!current) continue;
    if (!row.next_pay_date) {
      notMoved.push(row.name);
      continue;
    }
    const moved = await s.client.rpc("payroll_payout_row_update", {
      p_row: row.row_id,
      p_amount: current.amount,
      p_pay_date: row.next_pay_date,
    });
    if (moved.error) {
      console.error("[payroll-payout] день не перенесён", moved.error.message);
      notMoved.push(row.name);
      continue;
    }
    await audit(s, "payroll.payout_plan.row_changed", planId, {
      employee_id: row.employee_id,
      employee_name: row.name,
      amount: current.amount,
      previous_amount: current.amount,
      pay_date: row.next_pay_date,
      previous_pay_date: current.pay_date,
      reason: "Не хватило наличных: перенесено на следующую смену",
    });
  }
  const sent = await sendIssueMessage(s, issueId, preview.ctx.settings.chat_id);
  await audit(s, "payroll.payout_plan.issued", planId, {
    month: preview.plan.month,
    schedule: preview.plan.schedule,
    method: "cash",
    total,
    lines: preview.lines.map((l) => ({ employee_id: l.employee_id, name: l.name, amount: l.amount })),
    business_date: preview.ctx.today,
    message_sent: sent === "sent",
  });
  return { issueId, messageState: sent, message: preview.message, notMoved };
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
export async function loadPayoutAssignments() {
  return actionResult(() => loadPayoutAssignmentsImpl(), "Не удалось загрузить график выплат");
}
