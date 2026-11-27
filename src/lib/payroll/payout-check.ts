import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "@/lib/sales/finance-source";
import { cashMovementDefaults, normalizeCashMovements } from "@/lib/sales/cash-movements";
import { addDays, businessDate } from "@/lib/sales/time";
import { attention, closeAlert } from "./payout-alerts";
import { carryAlert, reconcileAlert, rub, transferAlert } from "./payout-alert-text";
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

/** Сколько прошлых дней выдачи сверять: изъятие могут провести и позже. */
const RECONCILE_DAYS = 7;
/** Через сколько дней после окна второй выплаты ожидание переноса становится карточкой. */
const CARRY_GRACE_DAYS = 3;
/** Сколько дней после окна напоминать о невнесённой выплате переводом. */
const TRANSFER_LOOKBACK_DAYS = 10;

export type CheckResult = {
  venueId: string;
  reconciled: { date: string; state: "matched" | "mismatch" }[];
  transfersMissing: number;
  carried: { planId: string; people: number; done: boolean }[];
  /** Сбой части проверки: причина без имён и сумм. */
  errors: string[];
  /** Проблема, о которой человек не узнает: ни карточки, ни отчёта. */
  unseen: boolean;
};

type Issue = { plan_id: string; business_date: string; total: number | string; lines: { name?: string; amount?: number }[] | null };
type Check = { business_date: string; state: "matched" | "mismatch"; movement_ids: (number | string)[] };

async function reconcile(s: VenueHandle, data: PayoutSourceData, today: string, venueName: string, out: CheckResult) {
  const from = addDays(today, -RECONCILE_DAYS);
  const through = addDays(today, -1);
  const issues = await s.admin
    .from<Issue[]>("payroll_payout_issues")
    .select("plan_id,business_date,total,lines")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("method", "cash")
    .gte("business_date", from)
    .lte("business_date", through);
  if (issues.error) throw new Error(issues.error.message);
  const days = new Map<string, { total: number; planId: string; lines: Map<string, number> }>();
  for (const issue of issues.data ?? []) {
    const day = days.get(issue.business_date) ?? { total: 0, planId: issue.plan_id, lines: new Map() };
    day.total = money(day.total + Number(issue.total));
    for (const l of issue.lines ?? []) {
      const name = l.name ?? "Сотрудник";
      day.lines.set(name, money((day.lines.get(name) ?? 0) + Number(l.amount ?? 0)));
    }
    days.set(issue.business_date, day);
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
  // Сошедшийся день больше не сверяем; не сошедшийся — каждое утро, пока не сойдётся или не выйдет срок.
  const due = [...days.entries()]
    .filter(([date, day]) => day.total > 0 && byDate.get(date)?.state !== "matched")
    .sort(([a], [b]) => a.localeCompare(b));
  if (!due.length) return;

  const request = { timezone: data.timezone, dayStartHour: data.dayStartHour };
  const { source } = await financeSource({ account_id: s.accountId, venue_id: s.venueId, business_date: today, request });
  const first = due[0][0];
  const movements = normalizeCashMovements(
    await source.cashMovements(`${addDays(first, -1)}T00:00:00.000Z`, `${addDays(today, 1)}T00:00:00.000Z`),
    { from: first, through, timezone: data.timezone },
  );
  const tips = new RegExp(cashMovementDefaults.tipsPattern, "iu");

  for (const [date, day] of due) {
    // Изъятие засчитывается только одному дню.
    const used = new Set<number>();
    for (const c of byDate.values()) if (c.business_date !== date) for (const id of c.movement_ids) used.add(Number(id));
    const lines = [...day.lines.entries()].map(([name, amount]) => ({ name, amount }));
    const result = reconcileDay({
      issued: day.total,
      withdrawals: movements
        .filter((m) => m.type === "cashOut" && m.date === date && !used.has(m.id))
        .map((m) => ({ id: m.id, amount: m.amountCents / 100, comment: m.comment })),
      names: lines.map((l) => l.name),
      tips,
    });
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

/** Выплата переводом (по счёту): окно выплаты за прошлый месяц прошло, а выплаты нет. */
async function checkTransfers(s: VenueHandle, data: PayoutSourceData, today: string, venueName: string, out: CheckResult) {
  const ctx = await buildContext(s, data, null);
  const startsOn = data.settings?.starts_on ?? "2026-09-01";
  const month = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
  if (month < startsOn) return;
  const payments = new Map(data.payments.filter((p) => p.state === "posted").map((p) => [p.id, p]));
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  for (const payoutNo of [1, 2] as PayoutNo[]) {
    const window = scheduleWindow(ctx.settings.schedules.transfer, payoutNo, month);
    if (!(window.to < today && window.to >= addDays(today, -TRANSFER_LOOKBACK_DAYS))) continue;
    for (const row of plan(ctx, "transfer", month, payoutNo)) {
      const key = `${row.employee_id}:${month}:${payoutNo}`;
      // Счёт оплачивают около окна: засчитываем выплату за месяц с недели до его начала.
      const paid = data.allocations.some((a) => {
        const p = payments.get(a.payment_id);
        return a.employee_id === row.employee_id && a.month === month && !!p && p.kind !== "tips" && !p.official_month
          && p.occurred_at.slice(0, 10) >= addDays(window.from, -7);
      });
      if (paid || row.amount <= 0) {
        await closeAlert(s, "transfer", key);
        continue;
      }
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

/** Автоперенос остатка месяца по вторым планам, чьё окно прошло. */
async function carry(s: VenueHandle, data: PayoutSourceData, today: string, venueName: string, out: CheckResult) {
  const plans = await s.admin
    .from<{ id: string; month: string; window_to: string }[]>("payroll_payout_plans")
    .select("id,month,window_to")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("schedule", "main")
    .eq("payout_no", 2)
    .eq("state", "approved")
    .is("carried_at", null)
    .lt("window_to", today);
  if (plans.error) throw new Error(plans.error.message);
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  for (const p of plans.data ?? []) {
    const ctx = await buildContext(s, data, p.month);
    const fresh = new Map(cashPlan(ctx, "main", p.month, 2).map((r) => [r.employee_id, r.amount]));
    const rows = await planRows(s, p.id);
    const waiting = carryWaiting(rows, fresh);
    let reasons = waiting.map((w) => ({ employee_id: w.employee_id as string | null, reason: `не выдано по плану ${rub(w.remainder)}` }));
    let response: CarryResponse | null = null;
    // Пока по плану не всё выдано — не переносим никого: иначе поздняя выдача за M задвоится.
    if (!waiting.length) {
      const r = await s.admin.rpc("payroll_payout_carry_system", {
        p_account: s.accountId,
        p_venue: s.venueId,
        p_plan: p.id,
        p_items: carryItems(data, p.month, rows.map((row) => row.employee_id)),
      });
      if (r.error) reasons = [{ employee_id: null, reason: r.error.message }];
      else {
        response = r.data as CarryResponse;
        reasons = response.blocked.map((b) => ({ employee_id: b.employee_id, reason: b.reason }));
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
    }
    const done = response?.done === true;
    out.carried.push({ planId: p.id, people: carried.length, done });
    if (done) {
      await closeAlert(s, "carry", p.id);
      continue;
    }
    if (today < addDays(p.window_to, CARRY_GRACE_DAYS)) continue;
    const text = carryAlert(p.month, reasons.map((r) => ({
      name: r.employee_id ? (names.get(r.employee_id) ?? "Сотрудник") : "Весь план",
      reason: r.reason,
    })));
    const seen = await attention(
      s,
      { kind: "carry", key: p.id, planId: p.id, ...text },
      `Зарплата, ${venueName}: ${text.title}. Подробности — в «Финансы → На разбор».`,
    );
    if (!seen.seen) out.unseen = true;
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
    const out: CheckResult = { venueId: v.venue_id, reconciled: [], transfersMissing: 0, carried: [], errors: [], unseen: false };
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
    for (const [label, step] of [["сверка", reconcile], ["переводы", checkTransfers], ["перенос", carry]] as const) {
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
