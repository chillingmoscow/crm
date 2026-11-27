import "server-only";
import { writeAuditEvent } from "@/lib/audit/write";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseDb } from "@/lib/supabase/loose";
import { addDays, businessDate } from "@/lib/sales/time";
import {
  DEFAULT_PAYOUT_SCHEDULES,
  payoutPeriod,
  scheduleWindow,
  type PayoutNo,
  issueCap,
  planFirstPayout,
  recheckDue,
  type PayoutSchedule,
  type PayoutScheduleCode,
  type PlannedRow,
} from "./payout-plan";
import {
  NOBODY_DUE,
  cashAvailable,
  splitShortfall,
  distributeCash,
  payoutMessage,
  type DueRow,
  type IssueLine,
  type RegisterCash,
} from "./payout-issue";
import { readRegisterCash } from "./payout-cash";
import type { PayrollData } from "./types";

// Общее для плана выплат: настройки, расчёт строк, предпросмотр выдачи дня,
// проведение и сообщение менеджерам. Зовут и действия пользователя
// (people/payroll/payout-actions.ts), и автовыдача по расписанию (payout-auto.ts).

export const SCHEDULES = ["main", "cleaner", "transfer"] as const;

/** Заведение и клиенты: пользовательский (под RLS) или серверный. */
export type VenueHandle = { db: LooseDb; admin: LooseDb; accountId: string; venueId: string };

/** Данные ведомости, нужные плану выплат. */
export type PayoutSourceData = Pick<
  PayrollData,
  | "employees" | "accruals" | "adjustments" | "payments" | "allocations" | "transfers"
  | "officialExpected" | "settings" | "timezone" | "dayStartHour" | "banks"
>;

export const money = (n: number) => Math.round(n * 100) / 100;

export type PlanRecord = {
  id: string;
  schedule: PayoutScheduleCode;
  month: string;
  payout_no: PayoutNo;
  window_from: string;
  window_to: string;
  state: "draft" | "approved" | "cancelled";
  version: number;
};
export type RowRecord = {
  id: string;
  plan_id: string;
  employee_id: string;
  pay_date: string | null;
  amount: number;
  issued: number;
  state: "planned" | "partial" | "issued";
  breakdown: PlannedRow["breakdown"];
  /** Сумму поставили руками: при выдаче её режет только заработанное (`issueCap`). */
  manual: boolean;
};
export type SettingsRecord = {
  auto_issue?: boolean;
  min_cash: number;
  chat_id: string | null;
  bank_account_id: string | null;
  schedules: Partial<Record<PayoutScheduleCode, Partial<PayoutSchedule>>>;
};
export type PayoutSettingsView = {
  /** Автовыдача в 14:00 включена. */
  auto_issue: boolean;
  min_cash: number;
  chat_id: string | null;
  bank_account_id: string | null;
  schedules: Record<PayoutScheduleCode, PayoutSchedule>;
  /** true — настройки ещё не сохранялись, показаны значения по умолчанию. */
  defaults: boolean;
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
  /** Переведены на другой график после утверждения — по этому плану не выдаём. */
  movedSchedule: string[];
};

export function mergeSettings(row: SettingsRecord | null, data: Pick<PayrollData, "banks">): PayoutSettingsView {
  const schedules = Object.fromEntries(
    SCHEDULES.map((code) => [code, { ...DEFAULT_PAYOUT_SCHEDULES[code], ...(row?.schedules?.[code] ?? {}) }]),
  ) as Record<PayoutScheduleCode, PayoutSchedule>;
  // До первой настройки — счета, с которых платили и раньше.
  const byName = (type: string, pattern: RegExp) =>
    data.banks.find((b) => b.type === type && pattern.test(b.name))?.id ?? null;
  schedules.transfer = { ...DEFAULT_PAYOUT_SCHEDULES.transfer };
  // Дни клинера (20-е и 5-е) в настройках не правятся — берём из кода, даже
  // если сохранены прежние 18–22 и 3–7.
  schedules.cleaner = {
    ...schedules.cleaner,
    first: DEFAULT_PAYOUT_SCHEDULES.cleaner.first,
    second: DEFAULT_PAYOUT_SCHEDULES.cleaner.second,
  };
  return {
    auto_issue: row?.auto_issue === true,
    min_cash: Number(row?.min_cash ?? 120000),
    chat_id: row?.chat_id ?? null,
    bank_account_id: row?.bank_account_id ?? byName("cash", /кэшбокс/i),
    schedules,
    defaults: !row,
  };
}

export async function loadSettingsRow(s: VenueHandle): Promise<SettingsRecord | null> {
  const r = await s.db
    .from<SettingsRecord>("payroll_payout_settings")
    .select("auto_issue,min_cash,chat_id,bank_account_id,schedules")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export type Context = {
  s: VenueHandle;
  data: PayoutSourceData;
  today: string;
  settings: PayoutSettingsView;
  shifts: { employee_id: string; business_date: string }[];
};

/** Данные ведомости, сегодняшний рабочий день и опубликованные смены месяца. */
export async function buildContext(s: VenueHandle, data: PayoutSourceData, month: string | null): Promise<Context> {
  const today = businessDate(new Date(), data.timezone, data.dayStartHour);
  const settings = mergeSettings(await loadSettingsRow(s), data);
  const base = month ?? payoutPeriod(today).month;
  const until = `${addDays(`${base.slice(0, 7)}-28`, 10).slice(0, 7)}-01`;
  // Вторая выплата за M — до 16-го M+1: смены нужны и на эти дни.
  const to = addDays(until, 17);
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

/** План одного графика на выплату `payoutNo` за M: дни — по окну графика. */
export function plan(ctx: Context, schedule: PayoutScheduleCode, month: string, payoutNo: PayoutNo = 1) {
  return planFirstPayout({
    data: ctx.data,
    schedules: ctx.settings.schedules,
    schedule,
    month,
    today: ctx.today,
    window: scheduleWindow(ctx.settings.schedules[schedule], payoutNo, month),
    shifts: ctx.shifts,
    payoutNo,
  });
}

/** Наличные графики в одном плане (Павел, 27.11): «Основной» и «Клинер». */
export const CASH_PLAN_SCHEDULES: PayoutScheduleCode[] = ["main", "cleaner"];
export function inPlan(employeeSchedule: PayoutScheduleCode | null | undefined, planSchedule: PayoutScheduleCode) {
  const own = employeeSchedule ?? "main";
  return own === planSchedule || (planSchedule === "main" && own === "cleaner");
}
/** Все строки плана: для плана наличных — по всем наличным графикам. */
export function cashPlan(ctx: Context, schedule: PayoutScheduleCode, month: string, payoutNo: PayoutNo) {
  const codes = schedule === "main" ? CASH_PLAN_SCHEDULES : [schedule];
  return codes.flatMap((code) => plan(ctx, code, month, payoutNo));
}

export async function findPlan(s: VenueHandle, schedule: PayoutScheduleCode, month: string | null, payoutNo: PayoutNo | null = 1) {
  let query = s.db
    .from<PlanRecord[]>("payroll_payout_plans")
    .select("id,schedule,month,payout_no,window_from,window_to,state,version")
    .eq("venue_id", s.venueId)
    .eq("schedule", schedule)
    .neq("state", "cancelled");
  if (payoutNo) query = query.eq("payout_no", payoutNo);
  if (month) query = query.eq("month", month);
  const r = await query.order("month", { ascending: false }).order("payout_no", { ascending: false }).limit(1);
  if (r.error) throw new Error(r.error.message);
  return r.data?.[0] ?? null;
}
export async function planById(s: VenueHandle, id: string) {
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
export async function planRows(s: VenueHandle, planId: string) {
  const r = await s.db
    .from<RowRecord[]>("payroll_payout_rows")
    .select("id,plan_id,employee_id,pay_date,amount,issued,state,breakdown,manual")
    .eq("venue_id", s.venueId)
    .eq("plan_id", planId);
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((row) => ({ ...row, amount: Number(row.amount), issued: Number(row.issued) }));
}

export async function issuedToday(s: VenueHandle, today: string) {
  const r = await s.db
    .from<{ total: number }[]>("payroll_payout_issues")
    .select("total")
    .eq("venue_id", s.venueId)
    .eq("business_date", today)
    .eq("method", "cash");
  if (r.error) throw new Error(r.error.message);
  return money((r.data ?? []).reduce((sum, row) => sum + Number(row.total), 0));
}

export async function buildPreview(
  s: VenueHandle,
  data: PayoutSourceData,
  planId: string,
): Promise<IssuePreview & { ctx: Context; plan: PlanRecord }> {
  const current = await planById(s, planId);
  if (current.state !== "approved") throw new Error("Сначала утвердите план");
  const ctx = await buildContext(s, data, current.month);
  const schedule = ctx.settings.schedules[current.schedule];
  if (schedule.method !== "cash") throw new Error("Этот график выдаётся переводом: отмечайте «Выплачено» по строке");
  const window = { from: current.window_from, to: current.window_to };
  // Свежий потолок: ручные выплаты и штрафы после утверждения. Саму сумму плана не пересчитываем.
  const fresh = new Map(cashPlan(ctx, current.schedule, current.month, current.payout_no).map((r) => [r.employee_id, r.breakdown]));
  const todays = (await planRows(s, planId)).filter((row) => row.state !== "issued" && row.pay_date === ctx.today);
  const employeeOf = (id: string) => ctx.data.employees.find((e) => e.id === id);
  // Сотрудника перевели на другой график после утверждения — по этому плану не выдаём.
  const moved = todays.filter((row) => !inPlan(employeeOf(row.employee_id)?.payout_schedule, current.schedule));
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
      // Ручную сумму (аванс) режет только заработанное — см. issueCap.
      const b = fresh.get(row.employee_id);
      const { due, capped } = recheckDue(row, b ? issueCap(b, row.manual) : 0, schedule.step);
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
      ? NOBODY_DUE
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
    movedSchedule: moved.map((r) => employeeOf(r.employee_id)?.name ?? "Сотрудник"),
    ctx,
    plan: current,
  };
}

type IssueRecord = { id: string; message: string | null; message_sent_at: string | null; message_error: string | null; total: number };
const UNCERTAIN = "Telegram не подтвердил доставку: проверьте чат менеджеров";

/** Отправляет сообщение выдачи один раз: строку забирает тот, кто первым сменил её статус. */
/** sent — отправлено; sending — отправляет параллельный запрос; failed — отправить вручную. */
export type MessageState = "sent" | "sending" | "failed";

export async function sendIssueMessage(s: VenueHandle, issueId: string, chatId: string | null): Promise<MessageState> {
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


/** Запись в журнал от пользователя или от автовыдачи (userId null — «Система»). */
export function payoutAudit(
  s: VenueHandle,
  userId: string | null,
  actionCode: string,
  entityId: string | null,
  details: Record<string, unknown>,
) {
  return writeAuditEvent({
    accountId: s.accountId,
    venueId: s.venueId,
    userId,
    actionCode,
    entityType: "payroll_payout_plan",
    entityId,
    details,
  });
}

/**
 * Проводит выдачу по готовому предпросмотру: строки дня, перенос дня тем, кому
 * не досталось ничего (в той же транзакции), журнал, сообщение менеджерам.
 * `call` — RPC от пользователя (payroll_payout_issue) или от сервера
 * (payroll_payout_issue_system). Ошибка `call` — ничего не проведено. После
 * него деньги уже записаны: сбои сообщения и журнала не бросаются, а
 * возвращаются как messageState "failed".
 */
export async function executeCashIssue(
  s: VenueHandle,
  preview: IssuePreview & { ctx: Context; plan: PlanRecord },
  requestKey: string,
  userId: string | null,
  call: (input: Record<string, unknown>) => Promise<string>,
): Promise<{ issueId: string; messageState: MessageState; notMoved: string[] }> {
  const { moves, notMoved } = splitShortfall(preview.lines, preview.short);
  const issueId = await call({
    request_key: requestKey,
    plan_id: preview.plan.id,
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
    moves: moves.map((row) => ({ row_id: row.row_id, pay_date: row.next_pay_date })),
  });
  let messageState: MessageState = "failed";
  try {
    messageState = await sendIssueMessage(s, issueId, preview.ctx.settings.chat_id);
  } catch (e) {
    console.error("[payroll-payout] сообщение после выдачи не отправлено", e);
  }
  try {
    // В журнал — одной строкой на выдачу, с переносами, которые правда применились.
    const stored = await s.admin
      .from<{ moves: { name: string; from: string | null; to: string }[] }>("payroll_payout_issues")
      .select("moves")
      .eq("id", issueId)
      .single();
    await payoutAudit(s, userId, "payroll.payout_plan.issued", preview.plan.id, {
      month: preview.plan.month,
      schedule: preview.plan.schedule,
      method: "cash",
      total: money(preview.lines.reduce((sum, l) => sum + l.amount, 0)),
      lines: preview.lines.map((l) => ({ employee_id: l.employee_id, name: l.name, amount: l.amount })),
      moves: stored.data?.moves ?? [],
      not_moved: notMoved,
      business_date: preview.ctx.today,
      message_sent: messageState === "sent",
      automatic: userId === null,
    });
  } catch (e) {
    console.error("[payroll-payout] журнал выдачи не записан", e);
  }
  return { issueId, messageState, notMoved };
}
