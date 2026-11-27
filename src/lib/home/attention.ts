import "server-only";

import { loadAttendanceAttention } from "@/app/(dashboard)/people/payroll/actions";
import { formatRub } from "@/components/shared/money";
import { countInbox } from "@/lib/finance/recurring";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import { getNomenclatureSyncState } from "@/lib/inventory/nomenclature-sync";
import { dayWindow } from "@/lib/sales/time";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

import {
  ATTENTION_KINDS,
  attendanceTitle,
  candidatesTitle,
  capitalize,
  financeInboxTitle,
  inventoryActsTitle,
  inventoryReviewDetail,
  nextDaysText,
  payoutName,
  peopleDative,
  unassignedShiftsTitle,
  type AttentionItem,
  type AttentionKind,
} from "./attention-text";
import { getHomeContext, type HomeContext } from "./context";
import { addDaysIso, relativeDayLabel } from "./today";

export type { AttentionItem, AttentionKind } from "./attention-text";

/** Смены без сотрудника ищем на столько рабочих дней вперёд, включая сегодня. */
const UNASSIGNED_DAYS = 3;
/** Номенклатура синхронизируется раз в три часа; дольше семи — что-то сломалось. */
const SYNC_STALE_MS = 7 * 60 * 60 * 1000;

type Source = (ctx: HomeContext) => Promise<AttentionItem | null>;

/**
 * Кто видит пункт. Право — то же, что открывает экран, куда ведёт кнопка:
 * иначе пункт звал бы туда, где человеку нечего сделать.
 */
const ACCESS: Record<AttentionKind, (can: (code: string) => boolean) => boolean> = {
  quickresto_sync: (can) => can("inventory.sync_quickresto"),
  finance_inbox: (can) => can("finance.view_transactions") && can("finance.create_transaction"),
  unassigned_shifts: (can) => can("schedule.view_all"),
  attendance: (can) => can("payroll.view"),
  candidates: (can) => can("people.manage_candidates"),
  // Те же права, что открывают «Документы → Инвентаризация».
  inventory_acts: (can) => can("inventory.view_documents") || can("inventory.fill_assigned_documents"),
  payout_plan: (can) => can("payroll.view"),
};

const SOURCES: Record<AttentionKind, Source> = {
  quickresto_sync: async (ctx) => {
    const state = await getNomenclatureSyncState(ctx.accountId);
    const now = new Date();
    if (state.result && !state.result.ok)
      return {
        kind: "quickresto_sync",
        count: 1,
        tone: "danger",
        title: "Синхронизация с Quick Resto не прошла",
        detail: `Последняя попытка: ${formatDayMonthTime(state.result.finishedAt, now, ctx.timezone)}`,
        href: "/catalog/ingredients",
        action: "Открыть",
      };
    if (state.syncedAt && now.getTime() - Date.parse(state.syncedAt) > SYNC_STALE_MS)
      return {
        kind: "quickresto_sync",
        count: 1,
        tone: "warning",
        title: "Номенклатура Quick Resto давно не обновлялась",
        detail: `Последнее обновление: ${formatDayMonthTime(state.syncedAt, now, ctx.timezone)}`,
        href: "/catalog/ingredients",
        action: "Открыть",
      };
    return null;
  },

  finance_inbox: async () => {
    const count = await countInbox();
    if (count <= 0) return null;
    return {
      kind: "finance_inbox",
      count,
      tone: "danger",
      title: financeInboxTitle(count),
      detail: "Ожидаемые платежи, по которым нужно решение",
      href: "/finance/inbox",
      action: "Разобрать",
    };
  },

  unassigned_shifts: async (ctx) => {
    const db = asLooseDb(await createClient());
    const until = dayWindow(addDaysIso(ctx.businessDay, UNASSIGNED_DAYS - 1), ctx.timezone, ctx.dayStartHour).end;
    const { count, error } = await db
      .from("schedule_shifts")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", ctx.venueId)
      .is("user_id", null)
      .is("payroll_employee_id", null)
      .gte("starts_at", new Date().toISOString())
      .lt("starts_at", new Date(until).toISOString());
    if (error) throw new Error(error.message);
    if (!count) return null;
    return {
      kind: "unassigned_shifts",
      count,
      tone: "warning",
      title: unassignedShiftsTitle(count),
      detail: nextDaysText(UNASSIGNED_DAYS),
      href: "/schedule",
      action: "Назначить",
    };
  },

  attendance: async (ctx) => {
    const month = ctx.businessDay.slice(0, 7);
    // В начале месяца прошлый ещё может быть не закрыт — смотрим и его.
    const previous = addDaysIso(`${month}-01`, -1).slice(0, 7);
    const result = await loadAttendanceAttention([previous, month]);
    if (!result.ok) throw new Error(result.error);
    const due = result.data.filter((m) => m.count > 0);
    const count = due.reduce((sum, m) => sum + m.count, 0);
    if (!count) return null;
    return {
      kind: "attendance",
      count,
      tone: "warning",
      title: attendanceTitle(count),
      detail: "Нет отметки Quick Resto или она расходится с графиком",
      href: `/schedule/attendance?month=${due[0].month}`,
      action: "Проверить",
    };
  },

  candidates: async () => {
    const db = asLooseDb(await createClient());
    const { data, error } = await db.rpc("candidate_new_count", {});
    if (error) throw new Error(error.message);
    const count = typeof data === "number" ? data : 0;
    if (count <= 0) return null;
    return {
      kind: "candidates",
      count,
      tone: "info",
      title: candidatesTitle(count),
      detail: "Ждут первого просмотра",
      href: "/people/candidates",
      action: "Посмотреть",
    };
  },

  inventory_acts: async (ctx) => {
    const db = asLooseDb(await createClient());
    // Только числа: непроведённых актов может быть больше, чем отдаёт выборка.
    const open = () =>
      db
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("document_kind", "inventory")
        .eq("venue_id", ctx.venueId)
        .is("archived_at", null);
    const [all, review] = await Promise.all([
      open().neq("status", "processed"),
      open().eq("status", "ready_for_review"),
    ]);
    if (all.error) throw new Error(all.error.message);
    if (review.error) throw new Error(review.error.message);
    const count = all.count ?? 0;
    if (!count) return null;
    const ready = review.count ?? 0;
    return {
      kind: "inventory_acts",
      count,
      tone: ready > 0 ? "warning" : "neutral",
      title: inventoryActsTitle(count),
      detail: inventoryReviewDetail(ready, count),
      href: "/documents/inventory",
      action: "Открыть",
    };
  },

  payout_plan: async (ctx) => {
    const db = asLooseDb(await createClient());
    const plans = await db
      .from<{ id: string; month: string; payout_no: number; state: string }[]>("payroll_payout_plans")
      .select("id,month,payout_no,state")
      .eq("venue_id", ctx.venueId)
      .eq("schedule", "main")
      .neq("state", "cancelled")
      .order("month", { ascending: false })
      .order("payout_no", { ascending: false })
      .limit(1);
    if (plans.error) throw new Error(plans.error.message);
    const plan = plans.data?.[0];
    if (!plan) return null;
    const rows = await db
      .from<{ pay_date: string | null; amount: number; issued: number }[]>("payroll_payout_rows")
      .select("pay_date,amount,issued")
      .eq("venue_id", ctx.venueId)
      .eq("plan_id", plan.id);
    if (rows.error) throw new Error(rows.error.message);
    const due = (rows.data ?? [])
      .map((r) => ({ date: r.pay_date, left: Number(r.amount) - Number(r.issued) }))
      .filter((r) => r.left > 0.004);
    if (!due.length) return null;
    const name = payoutName(plan.month, plan.payout_no);
    if (plan.state === "draft") {
      const total = due.reduce((sum, r) => sum + r.left, 0);
      return {
        kind: "payout_plan",
        count: 1,
        tone: "info",
        title: "План выплат ждёт утверждения",
        detail: `${capitalize(name)} · ${formatRub(total)} · ${peopleDative(due.length)}`,
        href: "/people/payroll?tab=plan",
        action: "Проверить",
      };
    }
    // Утверждённый план: ближайший день выплаты, на который ещё есть что выдать.
    const next = due
      .map((r) => r.date)
      .filter((d): d is string => !!d)
      .sort()[0];
    const day = next ? due.filter((r) => r.date === next) : due;
    const total = day.reduce((sum, r) => sum + r.left, 0);
    const when = next
      ? next < ctx.businessDay
        ? `просрочена с ${formatDayMonth(next)}`
        : (relativeDayLabel(next, ctx.businessDay)?.toLowerCase() ?? formatDayMonth(next))
      : null;
    return {
      kind: "payout_plan",
      count: 1,
      tone: next && next < ctx.businessDay ? "warning" : "neutral",
      title: when ? `Ближайшая выплата: ${when}` : "Ближайшая выплата",
      detail: `${capitalize(name)} · ${formatRub(total)} · ${peopleDative(day.length)}`,
      href: "/people/payroll?tab=plan",
      action: "Открыть план",
    };
  },
};

/**
 * Очередь «Требует внимания» на главной: каждый пункт — дело с кнопкой, куда
 * идти. Пункты, на которые у человека нет прав, не считаются вовсе. Источники
 * читаются параллельно; сбой одного не роняет очередь — он попадает в
 * `failed`, а остальные пункты показываются.
 */
export async function getAttentionItems(): Promise<{
  items: AttentionItem[];
  failed: AttentionKind[];
}> {
  const ctx = await getHomeContext();
  if (!ctx) return { items: [], failed: [] };
  const can = (code: string) => ctx.permissions.has(code);
  const kinds = ATTENTION_KINDS.filter((kind) => ACCESS[kind](can));
  const results = await Promise.allSettled(kinds.map((kind) => SOURCES[kind](ctx)));
  const items: AttentionItem[] = [];
  const failed: AttentionKind[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      if (result.value) items.push(result.value);
    } else {
      console.error(`[home-attention] ${kinds[i]}:`, result.reason);
      failed.push(kinds[i]);
    }
  });
  return { items, failed };
}

/** Есть ли у человека хоть один источник очереди — показывать ли блок вообще. */
export function canSeeAttention(permissions: Set<string>): boolean {
  const can = (code: string) => permissions.has(code);
  return ATTENTION_KINDS.some((kind) => ACCESS[kind](can));
}
