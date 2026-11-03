"use server";

// Удержание по недостаче: пересчёт месяца и постановка строк в зарплатную ведомость.
//
// Расчёт и условия - src/lib/stock (deduction-posting.ts), запись - RPC
// post_inventory_deduction (миграция 309). Здесь только проводка между ними:
// права, чтение снимка серверным клиентом и уведомление об аномалии.
//
// Каждый экспорт файла - вызываемое извне серверное действие, поэтому каждое
// проверяет вызывающего само: аккаунт сессии и право ставить удержания в
// заведении (can_post_inventory_deduction). Серверный клиент читает данные месяца
// только после этой проверки.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import {
  describePostOutcome,
  monthLabel,
  postMonthlyDeduction,
  type PostDeps,
  type PostRpcResult,
} from "@/lib/stock/deduction-posting";
import type { HistoryMonth } from "@/lib/stock/deduction-anomaly";
import { buildMonthlySnapshot, businessMonthOf, monthBounds } from "@/lib/stock/monthly-snapshot";
import { actionErrorMessage, getActiveContext } from "../actions-shared";

export type DeductionActionResult = {
  error: string | null;
  /** Одна строка для человека: что произошло с месяцем. */
  summary: string | null;
  state?: "ready" | "incomplete" | "disabled";
  posted?: boolean;
  unchanged?: boolean;
  month?: string;
  /** Чего не хватает неполному месяцу (устойчивые ID источников). */
  unresolved?: string[];
  /** Проблемы данных заведения, у которых нет месяца. */
  dataProblems?: { undatedActs: string[]; actsWithoutVenue: string[] };
  /** Строки, поставленные уволенным сотрудникам. */
  inactive?: Array<{ employee_id: string; name: string; amount: number }>;
};

type Ctx = Awaited<ReturnType<typeof getActiveContext>>;

const MONTH_RE = /^\d{4}-\d{2}-01$/;
const ANOMALY_LINK = "/inventory/deduction";

type RawPostResult = {
  posted?: boolean;
  unchanged?: boolean;
  replayed?: boolean;
  snapshot_id?: string;
  reversed?: number;
  target_month?: string;
  displaced?: boolean;
  lines?: PostRpcResult["lines"];
  inactive?: PostRpcResult["inactive"];
};

/** Последний посчитанный снимок на каждый месяц; месяцы со сторно без замены не в счёте. */
async function loadHistory(admin: LooseDb, accountId: string, venueId: string): Promise<HistoryMonth[]> {
  const { data, error } = await admin
    .from<Array<{ month: string; shortage_total: number; captured_at: string; reversed_at: string | null }>>(
      "inventory_deduction_snapshots",
    )
    .select("month, shortage_total, captured_at, reversed_at")
    .eq("account_id", accountId)
    .eq("venue_id", venueId)
    .order("month", { ascending: false })
    .order("captured_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Не удалось прочитать историю расчётов: ${error.message}`);
  const seen = new Set<string>();
  const out: HistoryMonth[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.month)) continue;
    seen.add(row.month);
    if (row.reversed_at) continue;
    out.push({ month: row.month, total: Number(row.shortage_total) });
  }
  return out;
}

/** Получатели - те, у кого в заведении есть право ставить удержания. */
async function deductionRecipients(admin: LooseDb, venueId: string): Promise<string[]> {
  const perm = await admin.from<Array<{ id: string }>>("permissions").select("id").eq("code", "inventory.post_deductions");
  if (perm.error) throw new Error(perm.error.message);
  const permissionIds = (perm.data ?? []).map((p) => p.id);
  if (permissionIds.length === 0) return [];
  const granted = await admin
    .from<Array<{ role_id: string }>>("role_permissions")
    .select("role_id")
    .in("permission_id", permissionIds)
    .eq("granted", true);
  if (granted.error) throw new Error(granted.error.message);
  const roleIds = [...new Set((granted.data ?? []).map((r) => r.role_id))];
  if (roleIds.length === 0) return [];
  const members = await admin
    .from<Array<{ user_id: string }>>("user_venue_roles")
    .select("user_id")
    .eq("venue_id", venueId)
    .eq("status", "active")
    .is("fired_at", null)
    .in("role_id", roleIds);
  if (members.error) throw new Error(members.error.message);
  return [...new Set((members.data ?? []).map((m) => m.user_id))];
}

async function runRecalculation(ctx: Ctx, venueId: string, month: string): Promise<DeductionActionResult> {
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не авторизован", summary: null };
  const accountId = ctx.accountId;
  if (!MONTH_RE.test(month)) return { error: "Месяц задаётся первым числом, например 2026-10-01", summary: null };
  monthBounds(month);

  // Права проверяются по ролям именно этого заведения: акт может принадлежать
  // не тому заведению, которое сейчас активно у пользователя.
  const userDb = asLooseDb(ctx.supabase);
  const can = await userDb.rpc("can_post_inventory_deduction", { p_venue: venueId });
  if (can.error || can.data !== true)
    return { error: "Недостаточно прав, чтобы ставить удержания по недостаче в этом заведении", summary: null };

  const admin = asLooseDb(createAdminClient());
  const deps: PostDeps = {
    buildSnapshot: () => buildMonthlySnapshot(admin, { accountId, venueId, month }),
    loadHistory: () => loadHistory(admin, accountId, venueId),
    post: async ({ venueId: v, month: m, lines, snapshot }) => {
      const { data, error } = await userDb.rpc("post_inventory_deduction", {
        p_venue: v,
        p_month: m,
        p_lines: lines,
        p_snapshot: snapshot,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as RawPostResult;
      return {
        posted: r.posted === true,
        unchanged: r.unchanged === true,
        replayed: r.replayed === true,
        snapshotId: r.snapshot_id ?? null,
        reversed: r.reversed ?? 0,
        targetMonth: r.target_month ?? null,
        displaced: r.displaced === true,
        lines: r.lines ?? [],
        inactive: r.inactive ?? [],
      };
    },
    notifyAnomaly: async (info) => {
      const recipients = await deductionRecipients(admin, info.venueId);
      if (recipients.length === 0) return;
      const money = (n: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n)} ₽`;
      const rows = recipients.map((userId) => ({
        user_id: userId,
        venue_id: info.venueId,
        type: "inventory.deduction_anomaly",
        category: "inventory",
        title: `Недостача за ${monthLabel(info.month)} заметно выше обычной`,
        body:
          `Недостача заведения ${money(info.total)} при медиане прошлых трёх месяцев ${money(info.median)}` +
          (info.ratio ? ` (в ${info.ratio} раза больше)` : "") +
          ". Строки удержания уже поставлены в ведомость: проверьте акты месяца.",
        link: ANOMALY_LINK,
        actor_user_id: ctx.user!.id,
        entity_type: "inventory_deduction_snapshot",
        entity_id: info.snapshotId,
      }));
      const { error } = await admin.from("notifications").insert(rows);
      if (error) throw new Error(error.message);
    },
    newId: () => randomUUID(),
  };

  const out = await postMonthlyDeduction(deps);
  if (out.state === "ready" && out.posted) revalidatePath("/inventory");
  return {
    error: null,
    summary: describePostOutcome(out),
    state: out.state,
    posted: out.posted,
    unchanged: out.state === "ready" ? out.unchanged : false,
    month: out.month,
    ...(out.state === "incomplete" ? { unresolved: out.unresolved, dataProblems: out.dataProblems } : {}),
    ...(out.state === "ready" ? { inactive: out.result.inactive } : {}),
  };
}

/** Заведение и месяц акта: месяц по бизнес-дню акта в таймзоне заведения (как в снимке месяца). */
async function resolveDocumentMonth(
  admin: LooseDb,
  accountId: string,
  documentId: string,
): Promise<{ venueId: string; month: string } | { error: string }> {
  const doc = await admin
    .from<{ venue_id: string | null; invoice_date: string | null; document_kind: string }>("documents")
    .select("venue_id, invoice_date, document_kind")
    .eq("id", documentId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (doc.error || !doc.data) return { error: "Акт не найден" };
  if (doc.data.document_kind !== "inventory") return { error: "Это не акт инвентаризации" };
  if (!doc.data.venue_id) return { error: "У акта нет заведения: склад не привязан, месяц удержания определить нельзя" };
  if (!doc.data.invoice_date) return { error: "У акта нет бизнес-даты: месяц удержания определить нельзя" };
  const venue = await admin
    .from<{ timezone: string | null }>("venues")
    .select("timezone")
    .eq("id", doc.data.venue_id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (venue.error || !venue.data?.timezone) return { error: "У заведения не задана таймзона" };
  try {
    return { venueId: doc.data.venue_id, month: `${businessMonthOf(doc.data.invoice_date, venue.data.timezone)}-01` };
  } catch {
    return { error: "Дата акта не читается: месяц удержания определить нельзя" };
  }
}

/** Пересчёт месяца заведения вручную: тот же путь, что и автоматический после финализации акта. */
export async function recalculateInventoryDeduction(input: {
  venueId: string;
  month: string;
}): Promise<DeductionActionResult> {
  try {
    const ctx = await getActiveContext();
    return await runRecalculation(ctx, input.venueId, input.month);
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось пересчитать удержание"), summary: null };
  }
}

/** Пересчёт месяца того акта, который только что проведён. */
export async function recalculateInventoryDeductionForDocument(input: {
  documentId: string;
}): Promise<DeductionActionResult> {
  try {
    const ctx = await getActiveContext();
    if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не авторизован", summary: null };
    const admin = asLooseDb(createAdminClient());
    const where = await resolveDocumentMonth(admin, ctx.accountId, input.documentId);
    if ("error" in where) return { error: where.error, summary: null };
    return await runRecalculation(ctx, where.venueId, where.month);
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось пересчитать удержание"), summary: null };
  }
}

/**
 * Сторно строк месяца акта без замены: итоги акта переоткрыты, расчёт больше не
 * соответствует действительности. Если строк нет - ничего не делает. Строки в
 * зафиксированном периоде не сторнируются: возвращается явная ошибка.
 */
export async function reverseInventoryDeductionForDocument(input: {
  documentId: string;
  reason: string;
}): Promise<{ error: string | null; reversed: number; summary: string | null }> {
  try {
    const ctx = await getActiveContext();
    if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не авторизован", reversed: 0, summary: null };
    const admin = asLooseDb(createAdminClient());
    const where = await resolveDocumentMonth(admin, ctx.accountId, input.documentId);
    if ("error" in where) return { error: where.error, reversed: 0, summary: null };

    // Есть ли вообще живые строки месяца: без них сторнировать нечего и права не нужны.
    const snaps = await admin
      .from<Array<{ id: string }>>("inventory_deduction_snapshots")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("venue_id", where.venueId)
      .eq("month", where.month);
    if (snaps.error) return { error: snaps.error.message, reversed: 0, summary: null };
    const snapshotIds = (snaps.data ?? []).map((s) => s.id);
    if (snapshotIds.length === 0) return { error: null, reversed: 0, summary: null };
    const live = await admin
      .from<Array<{ id: string }>>("payroll_adjustments")
      .select("id")
      .eq("account_id", ctx.accountId)
      .in("inventory_snapshot_id", snapshotIds)
      .is("deleted_at", null)
      .limit(1);
    if (live.error) return { error: live.error.message, reversed: 0, summary: null };
    if ((live.data ?? []).length === 0) return { error: null, reversed: 0, summary: null };

    const { data, error } = await asLooseDb(ctx.supabase).rpc("reverse_inventory_deduction", {
      p_venue: where.venueId,
      p_month: where.month,
      p_reason: input.reason,
    });
    if (error) return { error: error.message, reversed: 0, summary: null };
    const reversed = Number((data as { reversed?: number } | null)?.reversed ?? 0);
    revalidatePath("/inventory");
    return {
      error: null,
      reversed,
      summary: `Удержание за ${monthLabel(where.month)} сторнировано (строк: ${reversed}): итоги акта переоткрыты, месяц нужно пересчитать после повторной фиксации.`,
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось сторнировать удержание"), reversed: 0, summary: null };
  }
}
