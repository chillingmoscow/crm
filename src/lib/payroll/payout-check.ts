import "server-only";
import { createHash } from "node:crypto";
import { errorText } from "@/lib/actions/error-text";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "@/lib/sales/finance-source";
import { cashMovementDefaults, normalizeCashMovements } from "@/lib/sales/cash-movements";
import { addDays, businessDate } from "@/lib/sales/time";
import { attention, closeAlert, closePlanAlerts, raiseAlert } from "./payout-alerts";
import { carryAlert, kpiAlert, kpiPlanAlert, reconcileAlert, rub, transferAlert } from "./payout-alert-text";
import { KPI_START } from "./kpi";
import { alcoholMonth, kpiMonthPeople, termsWithPlan } from "./kpi-month";
import { carryItems, carryWaiting } from "./payout-carry";
import { buildContext, cashPlan, money, payoutAudit, plan, planRows, type PayoutSourceData, type VenueHandle } from "./payout-engine";
import { scheduleWindow, type PayoutNo } from "./payout-plan";
import { reconcileDay } from "./payout-reconcile";
import { loadVenuePayoutData } from "./payout-source";

// Утренняя проверка выплат зарплаты (план выплат, этап 3): раз в день в 10:00
// по Москве, на следующее утро после выдачи (`/api/cron/payroll-payout-check`).
//
// 1. Сверка: выдача наличными за прошлые дни ↔ изъятие из кассы Quick Resto.
// 2. Выплаты переводом: окно прошло, а выплаты за месяц нет.
// 3. Автоперенос остатка месяца после второй выплаты.
//
// Что требует человека — карточка «Финансы → На разбор» и сообщение в чат
// отчётов (один раз, когда карточка появилась). Причина ушла сама — карточка
// закрывается сама.

/**
 * Сколько прошлых дней выдачи сверять. Изъятие ищется в смене дня выдачи, а
 * если там не сошлось — ещё и в следующей смене; не сошедшийся день
 * пересверяется каждое утро (касса могла выгрузить операции позже).
 */
const RECONCILE_DAYS = 7;
/** Через сколько дней после окна второй выплаты ожидание переноса становится карточкой. */
const CARRY_GRACE_DAYS = 3;
/** Сколько дней после окна заводить карточку о невнесённой выплате переводом. */
const TRANSFER_LOOKBACK_DAYS = 10;
/** Меньше этого остаток выплаты переводом не считаем невнесённой выплатой (копейки, округления). */
const TRANSFER_MIN_DUE = 1000;

export type CheckResult = {
  venueId: string;
  reconciled: { date: string; state: "matched" | "mismatch" }[];
  transfersMissing: number;
  carried: { planId: string; people: number; done: boolean }[];
  /** Сколько старших ждут итогов KPI за прошлый месяц. */
  kpiMissing: number;
  /** Сбой части проверки: причина без имён и сумм. */
  errors: string[];
  /** Проблема, о которой человек не узнает: ни карточки, ни отчёта. */
  unseen: boolean;
};

type Issue = { plan_id: string; business_date: string; request_key: string; lines: { row_id?: string; name?: string; amount?: number }[] | null };
type Check = { business_date: string; state: "matched" | "mismatch"; movement_ids: (number | string)[] };

/** Ключ платежа строки выдачи — как в базе: md5(ключ выдачи || строка)::uuid (миграция 392). */
function paymentKey(issueKey: string, rowId: string): string {
  const h = createHash("md5").update(`${issueKey}${rowId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Шаблоны чаевых, сейфа и такси — из правил кассовых операций заведения, иначе по умолчанию. */
async function movementPatterns(s: VenueHandle) {
  const r = await s.admin
    .from<{ config: Record<string, unknown> }[]>("cash_movement_rules")
    .select("config")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .order("version", { ascending: false })
    .limit(1);
  const config = r.error ? {} : (r.data?.[0]?.config ?? {});
  const pick = (key: "tipsPattern" | "safePattern" | "taxiPattern") => {
    const value = config[key];
    try {
      return new RegExp(typeof value === "string" && value ? value : cashMovementDefaults[key], "iu");
    } catch {
      return new RegExp(cashMovementDefaults[key], "iu");
    }
  };
  return { tips: pick("tipsPattern"), other: [pick("safePattern"), pick("taxiPattern")] };
}

async function reconcile(s: VenueHandle, data: PayoutSourceData, today: string, venueName: string, out: CheckResult) {
  const from = addDays(today, -RECONCILE_DAYS);
  const through = addDays(today, -1);
  const issues = await s.admin
    .from<Issue[]>("payroll_payout_issues")
    .select("plan_id,business_date,request_key,lines")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("method", "cash")
    .gte("business_date", from)
    .lte("business_date", through);
  if (issues.error) throw new Error(issues.error.message);
  // Сколько выдано на самом деле: платежи выдачи, которые не отменили после неё.
  const keyed = (issues.data ?? []).flatMap((issue) =>
    (issue.lines ?? []).flatMap((l) => (l.row_id ? [{ issue, line: l, key: paymentKey(issue.request_key, l.row_id) }] : [])));
  const posted = new Set<string>();
  for (let i = 0; i < keyed.length; i += 100) {
    const r = await s.admin
      .from<{ request_key: string }[]>("payroll_payments")
      .select("request_key")
      .eq("venue_id", s.venueId)
      .eq("state", "posted")
      .in("request_key", keyed.slice(i, i + 100).map((k) => k.key));
    if (r.error) throw new Error(r.error.message);
    for (const p of r.data ?? []) posted.add(p.request_key);
  }
  const days = new Map<string, { total: number; planId: string; lines: Map<string, number> }>();
  for (const { issue, line, key } of keyed) {
    const day = days.get(issue.business_date) ?? { total: 0, planId: issue.plan_id, lines: new Map() };
    days.set(issue.business_date, day);
    if (!posted.has(key)) continue;
    const name = line.name ?? "Сотрудник";
    day.total = money(day.total + Number(line.amount ?? 0));
    day.lines.set(name, money((day.lines.get(name) ?? 0) + Number(line.amount ?? 0)));
  }
  if (!days.size) return;

  const checks = await s.admin
    .from<Check[]>("payroll_payout_withdrawals")
    .select("business_date,state,movement_ids")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .gte("business_date", addDays(today, -60));
  if (checks.error) throw new Error(checks.error.message);
  const byDate = new Map((checks.data ?? []).map((c) => [c.business_date, c]));
  // Выдачу дня целиком отменили — сверять нечего.
  for (const [date, day] of days) if (day.total <= 0) await closeAlert(s, "reconcile", date);
  // Сошедшийся день больше не сверяем; не сошедшийся — каждое утро, пока не сойдётся или не выйдет срок.
  const due = [...days.entries()]
    .filter(([date, day]) => day.total > 0 && byDate.get(date)?.state !== "matched")
    .sort(([a], [b]) => a.localeCompare(b));
  if (!due.length) return;

  const request = { timezone: data.timezone, dayStartHour: data.dayStartHour };
  const { source } = await financeSource({ account_id: s.accountId, venue_id: s.venueId, business_date: today, request });
  const first = due[0][0];
  const raw = await source.cashMovements(`${addDays(first, -1)}T00:00:00.000Z`, `${addDays(today, 1)}T00:00:00.000Z`);
  // Удалённые в кассе операции не считаем — и не роняем из-за них всю сверку.
  const movements = normalizeCashMovements(
    Array.isArray(raw) ? raw.filter((r) => !(r && typeof r === "object" && (r as { deleted?: unknown }).deleted === true)) : raw,
    { from: first, through: today, timezone: data.timezone },
  );
  const { tips, other } = await movementPatterns(s);

  for (const [date, day] of due) {
    // Изъятие засчитывается только одному дню.
    const used = new Set<number>();
    for (const c of byDate.values()) if (c.business_date !== date) for (const id of c.movement_ids) used.add(Number(id));
    const lines = [...day.lines.entries()].map(([name, amount]) => ({ name, amount }));
    const candidates = (dates: string[]) => movements
      .filter((m) => m.type === "cashOut" && dates.includes(m.date) && !used.has(m.id))
      .map((m) => ({ id: m.id, amount: m.amountCents / 100, comment: m.comment }));
    const match = (dates: string[]) => reconcileDay({ issued: day.total, withdrawals: candidates(dates), names: lines.map((l) => l.name), tips, other });
    // Сначала смена дня выдачи; изъятие могли провести и в следующую смену.
    let result = match([date]);
    if (result.state === "mismatch") {
      const wider = match([date, addDays(date, 1)]);
      if (wider.state === "matched") result = wider;
    }
    const saved = await s.admin.from("payroll_payout_withdrawals").upsert(
      {
        account_id: s.accountId,
        venue_id: s.venueId,
        business_date: date,
        issued: day.total,
        withdrawn: result.withdrawn,
        state: result.state,
        movement_ids: result.ids,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "venue_id,business_date" },
    );
    if (saved.error) throw new Error(saved.error.message);
    byDate.set(date, { business_date: date, state: result.state, movement_ids: result.ids });
    out.reconciled.push({ date, state: result.state });
    const previous = (checks.data ?? []).find((c) => c.business_date === date)?.state;
    if (previous !== result.state) {
      await payoutAudit(s, null, "payroll.payout_plan.reconciled", day.planId, {
        business_date: date,
        issued: day.total,
        withdrawn: result.withdrawn,
        state: result.state,
      }).catch(() => console.error(`[payroll-payout-check] ${s.venueId}: журнал сверки не записан`));
    }
    if (result.state === "matched") {
      await closeAlert(s, "reconcile", date);
      continue;
    }
    const text = reconcileAlert({ date, issued: day.total, withdrawn: result.withdrawn, lines });
    const seen = await attention(
      s,
      { kind: "reconcile", key: date, planId: day.planId, businessDate: date, ...text },
      `Зарплата, ${venueName}: ${text.title}. Подробности — в «Финансы → На разбор».`,
    );
    if (!seen.seen) out.unseen = true;
  }
}

/**
 * Выплата переводом (по счёту): окно выплаты за прошлый месяц прошло, а по
 * расчёту этой выплаты сотруднику всё ещё причитается. Открытые карточки
 * прежних окон пересматриваются каждое утро: внесли выплату — закрываются.
 */
async function checkTransfers(s: VenueHandle, data: PayoutSourceData, today: string, venueName: string, out: CheckResult) {
  const ctx = await buildContext(s, data, null);
  const startsOn = data.settings?.starts_on ?? "2026-09-01";
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  const open = await s.admin
    .from<{ key: string }[]>("payroll_payout_alerts")
    .select("key")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("kind", "transfer")
    .eq("status", "open");
  if (open.error) throw new Error(open.error.message);
  const openKeys = new Set((open.data ?? []).map((a) => a.key));
  // Окна, которые смотрим: прошлый месяц (обе выплаты) и месяцы открытых карточек.
  const windows = new Map<string, { month: string; payoutNo: PayoutNo }>();
  const lastMonth = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
  for (const payoutNo of [1, 2] as PayoutNo[]) windows.set(`${lastMonth}:${payoutNo}`, { month: lastMonth, payoutNo });
  for (const key of openKeys) {
    const [, month, no] = key.split(":");
    if (month && (no === "1" || no === "2")) windows.set(`${month}:${no}`, { month, payoutNo: Number(no) as PayoutNo });
  }
  for (const { month, payoutNo } of windows.values()) {
    if (month < startsOn) continue;
    const window = scheduleWindow(ctx.settings.schedules.transfer, payoutNo, month);
    if (window.to >= today) continue;
    const fresh = window.to >= addDays(today, -TRANSFER_LOOKBACK_DAYS);
    for (const row of plan(ctx, "transfer", month, payoutNo)) {
      const key = `${row.employee_id}:${month}:${payoutNo}`;
      if (row.amount < TRANSFER_MIN_DUE) {
        await closeAlert(s, "transfer", key);
        continue;
      }
      // Старое окно без открытой карточки (закрыли «Всё верно» или срок вышел) — не заводим заново.
      if (!fresh && !openKeys.has(key)) continue;
      out.transfersMissing++;
      const text = transferAlert({ month, payoutNo, name: names.get(row.employee_id) ?? "Сотрудник", amount: row.amount });
      const seen = await attention(
        s,
        { kind: "transfer", key, businessDate: window.to, ...text },
        `Зарплата, ${venueName}: ${text.title}, ${rub(row.amount)}. Подробности — в «Финансы → На разбор».`,
      );
      if (!seen.seen) out.unseen = true;
    }
  }
}

type CarryResponse = {
  carried: { employee_id: string; amount: number }[];
  blocked: { employee_id: string; reason: string }[];
  done: boolean;
};

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/**
 * Автоперенос остатка месяца по вторым планам, чьё окно прошло — по порядку
 * месяцев. Кто не перенесён за ранний месяц, не переносится и за следующий:
 * иначе остаток раннего месяца приедет в уже перенесённый и застрянет там.
 * После каждого переноса данные перечитываются.
 */
async function carry(s: VenueHandle, initial: PayoutSourceData, today: string, venueName: string, out: CheckResult) {
  const plans = await s.admin
    .from<{ id: string; month: string; window_to: string }[]>("payroll_payout_plans")
    .select("id,month,window_to")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("schedule", "main")
    .eq("payout_no", 2)
    .eq("state", "approved")
    .is("carried_at", null)
    .lt("window_to", today)
    .order("month", { ascending: true });
  if (plans.error) throw new Error(plans.error.message);
  let data = initial;
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  /** Сотрудник → почему его остаток за ранний месяц ещё не перенесён. */
  const pending = new Map<string, string>();
  for (const p of plans.data ?? []) {
    const monthName = MONTHS[Number(p.month.slice(5, 7)) - 1] ?? "прошлый месяц";
    const ctx = await buildContext(s, data, p.month);
    const fresh = new Map(cashPlan(ctx, "main", p.month, 2).map((r) => [r.employee_id, r.amount]));
    const rows = await planRows(s, p.id);
    const waiting = carryWaiting(rows, fresh);
    let reasons = waiting.map((w) => ({ employee_id: w.employee_id as string | null, reason: `не выдано по плану ${rub(w.remainder)}` }));
    let response: CarryResponse | null = null;
    if (waiting.length) {
      // Пока по плану не всё выдано — не переносим никого: иначе поздняя выдача за M задвоится.
      for (const row of rows) pending.set(row.employee_id, `ждёт перенос за ${monthName}`);
    } else {
      const { items, held } = carryItems(data, p.month, rows.map((row) => row.employee_id));
      const holds = [
        ...held,
        ...rows.filter((row) => pending.has(row.employee_id))
          .map((row) => ({ employee_id: row.employee_id, hold: pending.get(row.employee_id) ?? "ждёт перенос за прошлый месяц" })),
      ];
      const holding = new Set(holds.map((h) => h.employee_id));
      const r = await s.admin.rpc("payroll_payout_carry_system", {
        p_account: s.accountId,
        p_venue: s.venueId,
        p_plan: p.id,
        p_items: [...items.filter((i) => !holding.has(i.employee_id)), ...holds],
      });
      if (r.error) {
        reasons = [{ employee_id: null, reason: errorText(r.error, "перенос не удался, повторим завтра") }];
        for (const row of rows) pending.set(row.employee_id, `ждёт перенос за ${monthName}`);
      } else {
        response = r.data as CarryResponse;
        reasons = response.blocked.map((b) => ({ employee_id: b.employee_id, reason: errorText({ message: b.reason }, "перенос не удался, повторим завтра") }));
        for (const b of response.blocked) pending.set(b.employee_id, `ждёт перенос за ${monthName}`);
      }
    }
    const carried = response?.carried ?? [];
    if (carried.length) {
      await payoutAudit(s, null, "payroll.payout_plan.carried", p.id, {
        month: p.month,
        lines: carried.map((c) => ({ employee_id: c.employee_id, name: names.get(c.employee_id) ?? "Сотрудник", amount: Number(c.amount) })),
        total: money(carried.reduce((sum, c) => sum + Number(c.amount), 0)),
        automatic: true,
      }).catch(() => console.error(`[payroll-payout-check] ${s.venueId}: журнал переноса не записан`));
      // Следующий месяц считается по свежим переносам.
      data = await loadVenuePayoutData(s.admin, s.accountId, s.venueId);
    }
    const done = response?.done === true;
    out.carried.push({ planId: p.id, people: carried.length, done });
    if (done) {
      await closePlanAlerts(s, "carry", p.id);
      continue;
    }
    if (today < addDays(p.window_to, CARRY_GRACE_DAYS)) continue;
    const text = carryAlert(p.month, reasons.map((r) => ({
      name: r.employee_id ? (names.get(r.employee_id) ?? "Сотрудник") : "Весь план",
      reason: r.reason,
    })));
    // Ключ — план и набор причин: закрытая «Всё верно» карточка молчит, пока
    // причины те же, а новая причина — новая карточка (старая закрывается).
    const key = `${p.id}:${createHash("md5").update(text.lines.join("\n")).digest("hex").slice(0, 12)}`;
    await closePlanAlerts(s, "carry", p.id, key);
    const seen = await attention(
      s,
      { kind: "carry", key, planId: p.id, ...text },
      `Зарплата, ${venueName}: ${text.title}. Подробности — в «Финансы → На разбор».`,
    );
    if (!seen.seen) out.unseen = true;
  }
}

const monthBefore = (month: string) => {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * KPI старших: с 1-го числа — карточка «KPI за прошлый месяц не подведены»,
 * пока не сохранены итоги всех; и «План продаж алкоголя не задан», пока у
 * условий текущего месяца есть пункт плана, а плана нет. Без сообщения в чат.
 */
async function checkKpi(s: VenueHandle, _data: PayoutSourceData, today: string, _venueName: string, out: CheckResult) {
  const venue = { admin: s.admin, accountId: s.accountId, venueId: s.venueId };
  const current = `${today.slice(0, 7)}-01`;
  const month = monthBefore(current);
  if (month >= KPI_START) {
    const base = await kpiMonthPeople(venue, month);
    const missing = base.people.filter((p) => !base.reviews.has(p.employeeId));
    out.kpiMissing = missing.length;
    if (missing.length) {
      const roleIds = [...new Set(missing.map((p) => p.roleId))];
      const roles = await s.admin.from<{ id: string; name: string }[]>("roles").select("id,name").in("id", roleIds);
      if (roles.error) throw new Error(roles.error.message);
      const names = new Map((roles.data ?? []).map((r) => [r.id, r.name]));
      const text = kpiAlert(month, missing.map((p) => ({
        name: base.employees.get(p.employeeId)?.name ?? "Сотрудник",
        role: names.get(p.roleId) ?? "",
      })));
      if ((await raiseAlert(s, { kind: "kpi", key: month, businessDate: month, ...text })) === "failed") out.unseen = true;
    } else {
      await closeAlert(s, "kpi", month);
    }
  }
  if (current >= KPI_START) {
    const now = await kpiMonthPeople(venue, current);
    const needsPlan = termsWithPlan(now.terms, now.people.map((p) => p.termsId));
    const { plan } = await alcoholMonth(venue, current);
    if (needsPlan && plan.target === null) {
      // Ссылка ведёт во вкладку «KPI» этого месяца: там план месяца задаётся строкой «План не задан».
      if ((await raiseAlert(s, { kind: "kpi_plan", key: current, businessDate: current, ...kpiPlanAlert(current) })) === "failed") out.unseen = true;
    } else {
      await closeAlert(s, "kpi_plan", current);
    }
  }
}

export async function runPayoutChecks(now = new Date()): Promise<CheckResult[]> {
  if (process.env.PAYROLL_PAYOUT_AUTO === "off") return [];
  const admin = asLooseDb(createAdminClient());
  const venues = await admin
    .from<{ account_id: string; venue_id: string }[]>("payroll_payout_settings")
    .select("account_id,venue_id");
  if (venues.error) throw new Error(venues.error.message);
  const ids = (venues.data ?? []).map((v) => v.venue_id);
  const live = ids.length
    ? await admin.from<{ id: string; name: string }[]>("venues").select("id,name").in("id", ids).is("archived_at", null)
    : { data: [], error: null };
  if (live.error) throw new Error(live.error.message);
  const names = new Map((live.data ?? []).map((v) => [v.id, v.name]));
  const results: CheckResult[] = [];
  for (const v of (venues.data ?? []).filter((x) => names.has(x.venue_id))) {
    const s: VenueHandle = { db: admin, admin, accountId: v.account_id, venueId: v.venue_id };
    const venueName = names.get(v.venue_id) ?? "заведение";
    const out: CheckResult = { venueId: v.venue_id, reconciled: [], transfersMissing: 0, carried: [], kpiMissing: 0, errors: [], unseen: false };
    results.push(out);
    let data: PayoutSourceData;
    let today: string;
    try {
      data = await loadVenuePayoutData(admin, v.account_id, v.venue_id);
      today = businessDate(now, data.timezone, data.dayStartHour);
    } catch (e) {
      out.errors.push(`данные: ${e instanceof Error ? e.message : "ошибка"}`);
      continue;
    }
    // Каждая проверка — отдельно: сбой Quick Resto не мешает переносу.
    for (const [label, step] of [["сверка", reconcile], ["переводы", checkTransfers], ["перенос", carry], ["KPI", checkKpi]] as const) {
      try {
        await step(s, data, today, venueName, out);
      } catch (e) {
        const reason = e instanceof Error ? e.message : "ошибка";
        console.error(`[payroll-payout-check] ${v.venue_id}/${label}: ${reason}`);
        out.errors.push(`${label}: ${reason}`);
      }
    }
  }
  return results;
}
