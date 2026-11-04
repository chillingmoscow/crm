import "server-only";

// Удержание по недостаче: пересчёт месяца и постановка строк в зарплатную ведомость.
//
// ЭТО НЕ "use server": модуль внутренний, его функции вызывает другой серверный код
// (финализация и переоткрытие акта, разнесение списаний, привязка склада, сохранение
// правил). Здесь нет ни одной браузерной точки входа, потому что venueId, storeId и
// validFrom - параметры, которые подставляет серверный код, а не вызывающий из браузера.
// Единственное действие, доступное из браузера, - recalculateInventoryDeduction в
// _actions/deduction.ts (ручной пересчёт месяца выбранного заведения).
//
// Расчёт и условия - src/lib/stock (deduction-posting.ts), запись - RPC
// post_inventory_deduction (миграция 309). Здесь только проводка между ними:
// права, чтение снимка серверным клиентом и уведомление об аномалии.
//
// Каждая точка входа проверяет вызывающего сама: аккаунт сессии, принадлежность
// заведения этому аккаунту (venueBelongsToAccount) и право ставить удержания в заведении
// (can_post_inventory_deduction, по сессии пользователя). Серверный клиент читает данные
// месяца только после этих проверок.
//
// Граница доверия: суммы считает TypeScript, поэтому записывающие RPC
// (post_inventory_deduction, reverse_inventory_deduction) доступны ТОЛЬКО service_role
// и вызываются отсюда серверным клиентом; id проверенного пользователя уходит в p_actor.
// Из браузера они недоступны (миграция 309): иначе держатель права вписал бы любые суммы.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import {
  describePostOutcome,
  joinUniqueNotices,
  monthLabel,
  postMonthlyDeduction,
  type PostDeps,
  type PostRpcResult,
} from "@/lib/stock/deduction-posting";
import type { HistoryMonth } from "@/lib/stock/deduction-anomaly";
import { buildMonthlySnapshot, businessMonthOf, monthBounds } from "@/lib/stock/monthly-snapshot";
import { stockCalendarDate } from "@/lib/stock/writeoffs";
import { addDays } from "@/lib/sales/time";
import { assertVenueInAccount } from "@/lib/stock/deduction-guard";
import { whenAutopostEnabled } from "@/lib/stock/deduction-flag";
import { actionErrorMessage, getActiveContext } from "./actions-shared";

export type DeductionActionResult = {
  error: string | null;
  /** Ошибка - нехватка права ставить удержания в этом заведении (автопересчёт молчит о ней). */
  forbidden?: boolean;
  /** Одна строка для человека: что произошло с месяцем. */
  summary: string | null;
  state?: "ready" | "incomplete" | "disabled";
  posted?: boolean;
  unchanged?: boolean;
  month?: string;
  /** Чего не хватает неполному месяцу (устойчивые ID источников). */
  unresolved?: string[];
  /** Проблемы данных заведения, у которых нет месяца. */
  dataProblems?: { undatedActs: string[] };
  /** Строки, поставленные уволенным сотрудникам. */
  inactive?: Array<{ employee_id: string; name: string; amount: number }>;
};

type Ctx = Awaited<ReturnType<typeof getActiveContext>>;

const MONTH_RE = /^\d{4}-\d{2}-01$/;
const ANOMALY_LINK = "/documents/deduction";

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
  // monthBounds бросает на несуществующую дату (например 2026-02-30); результат здесь не нужен.
  monthBounds(month);

  // Заведение должно принадлежать аккаунту сессии - до любого чтения и построения. Право
  // "есть роль в заведении" ниже этого не гарантирует: роли могут быть в заведениях двух аккаунтов.
  const admin = asLooseDb(createAdminClient());
  try {
    await assertVenueInAccount(admin, accountId, venueId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Заведение недоступно", forbidden: true, summary: null };
  }

  // Права проверяются по ролям именно этого заведения: акт может принадлежать
  // не тому заведению, которое сейчас активно у пользователя.
  const userDb = asLooseDb(ctx.supabase);
  const can = await userDb.rpc("can_post_inventory_deduction", { p_venue: venueId });
  if (can.error) {
    // Проверка права не выполнилась: это сбой, а не отказ. Он не должен выглядеть как «нет права».
    console.error("[deduction] проверка права ставить удержания не выполнилась", { venueId, error: can.error });
    return {
      error: "Не удалось проверить право ставить удержания по недостаче. Попробуйте ещё раз",
      summary: null,
    };
  }
  if (can.data !== true)
    return {
      error: "Недостаточно прав, чтобы ставить удержания по недостаче в этом заведении",
      forbidden: true,
      summary: null,
    };
  const actorId = ctx.user.id;

  const deps: PostDeps = {
    buildSnapshot: () => buildMonthlySnapshot(admin, { accountId, venueId, month }),
    loadHistory: () => loadHistory(admin, accountId, venueId),
    post: async ({ venueId: v, month: m, lines, snapshot }) => {
      // Записывающий RPC - только service_role, исполнитель передаётся явно.
      const { data, error } = await admin.rpc("post_inventory_deduction", {
        p_actor: actorId,
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
    reverse: async ({ venueId: v, month: m, reason }) => {
      const { data, error } = await admin.rpc("reverse_inventory_deduction", {
        p_actor: actorId,
        p_venue: v,
        p_month: m,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      return { reversed: Number((data as { reversed?: number } | null)?.reversed ?? 0) };
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
  if (out.state === "ready" && out.posted) {
    revalidatePath("/inventory");
    revalidatePath("/documents/deduction");
  }
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
): Promise<{ venueId: string; month: string } | { error: string; silent?: boolean }> {
  const doc = await admin
    .from<{ venue_id: string | null; invoice_date: string | null; document_kind: string }>("documents")
    .select("venue_id, invoice_date, document_kind")
    .eq("id", documentId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (doc.error || !doc.data) return { error: "Акт не найден" };
  if (doc.data.document_kind !== "inventory") return { error: "Это не акт инвентаризации" };
  if (!doc.data.venue_id)
    return { error: "У акта нет заведения: склад не привязан, месяц удержания определить нельзя", silent: true };
  if (!doc.data.invoice_date)
    return { error: "У акта нет бизнес-даты: месяц удержания определить нельзя", silent: true };
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

/** Пересчёт месяца заведения: тот же путь, что и автоматический. Браузерная обёртка - _actions/deduction.ts. */
export async function recalculateInventoryDeductionMonth(input: {
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
    if ("error" in where) {
      // Акт без заведения или без бизнес-даты не может нести удержания: пользователю без права
      // (а право зависит от заведения, которого нет) о них говорить нечего. Остальное - настоящая ошибка.
      if (where.silent) return { error: null, reversed: 0, summary: null };
      return { error: where.error, reversed: 0, summary: null };
    }

    // Заведение акта - этого аккаунта, и право по сессии есть: только после этого читается
    // что-либо о снимках месяца (иначе ответ "0 строк" выдавал бы, есть ли у месяца удержание).
    try {
      await assertVenueInAccount(admin, ctx.accountId, where.venueId);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Заведение недоступно", reversed: 0, summary: null };
    }
    const can = await asLooseDb(ctx.supabase).rpc("can_post_inventory_deduction", { p_venue: where.venueId });
    // Нет права ставить удержания - молчим целиком: ни ошибки, ни пояснения. Переоткрытие акта
    // обычная операция, а удержание может быть выключено или не относиться к этому человеку;
    // ответ без права не должен ничего говорить и о том, есть ли у месяца удержание.
    if (can.error) {
      // Молчание правильно для «права нет», но здесь проверка не выполнилась: пользователь с правом
      // переоткрывает акт, а живые строки остаются. Это нельзя оставлять без следа.
      console.error("[deduction] проверка права при переоткрытии акта не выполнилась: строки не сторнированы", {
        documentId: input.documentId,
        venueId: where.venueId,
        error: can.error,
      });
      return { error: null, reversed: 0, summary: null };
    }
    if (can.data !== true) return { error: null, reversed: 0, summary: null };

    // Есть ли вообще живые строки месяца: без них сторнировать нечего.
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

    // Запись - серверным клиентом от имени этого пользователя.
    const { data, error } = await admin.rpc("reverse_inventory_deduction", {
      p_actor: ctx.user.id,
      p_venue: where.venueId,
      p_month: where.month,
      p_reason: input.reason,
    });
    if (error) return { error: error.message, reversed: 0, summary: null };
    const reversed = Number((data as { reversed?: number } | null)?.reversed ?? 0);
    revalidatePath("/inventory");
    revalidatePath("/documents/deduction");
    return {
      error: null,
      reversed,
      summary: `Удержание за ${monthLabel(where.month)} сторнировано (строк: ${reversed}): итоги акта переоткрыты, месяц нужно пересчитать после повторной фиксации.`,
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось сторнировать удержание"), reversed: 0, summary: null };
  }
}

// ── Автоматический пересчёт ──────────────────────────────────

export type AutoDeductionTrigger =
  /** Итоги акта подведены. */
  | { kind: "document"; documentId: string }
  /** Поставили, сменили или сняли плательщика за акт списания. */
  | { kind: "writeoff"; venueId: string; externalId: number }
  /** Склад привязали к другому подразделению. */
  | { kind: "store"; storeId: string }
  /** Склад привязали к другому заведению (или отвязали): пересчитать нужно и прежнее, и новое. */
  | { kind: "store-venue"; storeId: string; venueIds: Array<string | null> }
  /** Сохранена новая версия правил удержаний. */
  | { kind: "rules"; venueId: string; validFrom: string }
  /** Изменились подведённые акты этих месяцев (например, правило исключения применено задним числом). */
  | { kind: "months"; items: Array<{ venueId: string; month: string }> };

const PERMIT_SUFFIX = "Пересчитайте месяц вручную.";

/**
 * Пояснение человеку, который вызвал событие. Ничего не пропадает: отказ по праву и любая
 * ошибка возвращаются текстом и пишутся в журнал сервера (по ним видно, что после события
 * месяц не поставился).
 */
function autoNotice(r: DeductionActionResult, trigger?: AutoDeductionTrigger): string | null {
  if (r.forbidden) {
    console.warn("[deduction] автопересчёт отклонён по праву", { trigger, error: r.error });
    return `Удержание по недостаче не пересчитано: ${r.error ?? "нет права"}. Месяц пересчитает пользователь с правом ставить удержания.`;
  }
  if (r.error) {
    console.error("[deduction] автопересчёт не выполнен", { trigger, error: r.error });
    return `Удержание по недостаче не пересчитано: ${r.error}. ${PERMIT_SUFFIX}`;
  }
  return r.summary;
}

/**
 * Пересчёт месяца после события, которое могло изменить результат. Идемпотентен по
 * содержимому: повторный вызов с тем же итогом ничего не добавляет.
 *
 * Включается ТОЛЬКО переменной INVENTORY_DEDUCTION_AUTOPOST=1 - на всех путях
 * сразу, не на одном: выключенная функция должна оставаться выключенной везде.
 * Событие, вызвавшее пересчёт, к этому моменту уже выполнено, поэтому сбой здесь
 * никогда не превращается в его ошибку: возвращается пояснение (или null).
 */
export async function autoRecalculateInventoryDeduction(
  trigger: AutoDeductionTrigger,
): Promise<string | null> {
  // Выключено по умолчанию: без INVENTORY_DEDUCTION_AUTOPOST=1 пересчёт даже не начинается.
  return (await whenAutopostEnabled(process.env, () => runAutoRecalculation(trigger))) ?? null;
}

async function runAutoRecalculation(trigger: AutoDeductionTrigger): Promise<string | null> {
  try {
    if (trigger.kind === "document")
      return autoNotice(await recalculateInventoryDeductionForDocument({ documentId: trigger.documentId }), trigger);

    const ctx = await getActiveContext();
    if (ctx.error || !ctx.user || !ctx.accountId) return null;
    const admin = asLooseDb(createAdminClient());
    const accountId = ctx.accountId;

    const venueTimezone = async (venueId: string) => {
      const v = await admin
        .from<{ timezone: string | null }>("venues")
        .select("timezone")
        .eq("id", venueId)
        .eq("account_id", accountId)
        .maybeSingle();
      return v.data?.timezone ?? null;
    };

    if (trigger.kind === "writeoff") {
      const w = await admin
        .from<{ business_date: string }>("stock_writeoff_documents")
        .select("business_date")
        .eq("account_id", accountId)
        .eq("venue_id", trigger.venueId)
        .eq("external_id", trigger.externalId)
        .maybeSingle();
      if (!w.data) return null;
      return autoNotice(await runRecalculation(ctx, trigger.venueId, `${w.data.business_date.slice(0, 7)}-01`), trigger);
    }

    if (trigger.kind === "rules") {
      const tz = await venueTimezone(trigger.venueId);
      if (!tz) return null;
      const today = stockCalendarDate(new Date().toISOString(), tz);
      // Версия с датой впереди ещё не действует: считать по ней нечего.
      if (trigger.validFrom > today) return null;
      return autoNotice(await runRecalculation(ctx, trigger.venueId, `${today.slice(0, 7)}-01`), trigger);
    }

    if (trigger.kind === "months") {
      const unique = new Map<string, { venueId: string; month: string }>();
      for (const item of trigger.items) unique.set(`${item.venueId}|${item.month}`, item);
      const notices: string[] = [];
      for (const item of [...unique.values()].sort((a, b) => a.month.localeCompare(b.month) || a.venueId.localeCompare(b.venueId))) {
        const n = autoNotice(await runRecalculation(ctx, item.venueId, item.month), trigger);
        if (n) notices.push(n);
      }
      return joinUniqueNotices(notices);
    }

    if (trigger.kind === "store-venue") {
      const notices: string[] = [];
      for (const venueId of new Set(trigger.venueIds)) {
        if (!venueId) continue;
        const n = await recalculateStoreMonths(ctx, admin, trigger, trigger.storeId, venueId);
        if (n) notices.push(n);
      }
      return joinUniqueNotices(notices);
    }

    // Склад. Затрагиваются месяцы его проведённых актов, но только текущий и прошлый.
    const store = await admin
      .from<{ local_venue_id: string | null }>("stores")
      .select("local_venue_id")
      .eq("id", trigger.storeId)
      .eq("account_id", accountId)
      .maybeSingle();
    const venueId = store.data?.local_venue_id;
    if (!venueId) return null;
    return await recalculateStoreMonths(ctx, admin, trigger, trigger.storeId, venueId);
  } catch (error) {
    console.error("[deduction] автопересчёт не выполнен", { trigger, error });
    return `Удержание по недостаче не пересчитано из-за ошибки. ${PERMIT_SUFFIX}`;
  }
}

/**
 * Месяцы проведённых актов склада в заведении (только текущий и прошлый: привязка меняет
 * плательщика вперёд, давно выплаченные месяцы не пересчитываются сами) и пересчёт каждого.
 */
async function recalculateStoreMonths(
  ctx: Ctx,
  admin: LooseDb,
  trigger: AutoDeductionTrigger,
  storeId: string,
  venueId: string,
): Promise<string | null> {
  const accountId = ctx.accountId!;
  const v = await admin
    .from<{ timezone: string | null }>("venues")
    .select("timezone")
    .eq("id", venueId)
    .eq("account_id", accountId)
    .maybeSingle();
  const tz = v.data?.timezone ?? null;
  if (!tz) return null;
  const today = stockCalendarDate(new Date().toISOString(), tz);
  const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
  const earliest = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  const acts = await admin
    .from<Array<{ invoice_date: string | null }>>("documents")
    .select("invoice_date")
    .eq("account_id", accountId)
    .eq("document_kind", "inventory")
    .eq("store_id", storeId)
    .eq("status", "processed")
    .eq("processed", true)
    .is("archived_at", null)
    // Запас в двое суток: в таймзоне к востоку от UTC первые часы месяца лежат
    // в предыдущих сутках по UTC, и жёсткая граница их отрезала бы. Точную
    // границу ставит businessMonthOf ниже — здесь только предфильтр.
    .gte("invoice_date", `${addDays(`${earliest}-01`, -2)}T00:00:00Z`)
    .limit(1000);
  if (acts.error) return `Удержание по недостаче не пересчитано: ${acts.error.message}. ${PERMIT_SUFFIX}`;
  const months = new Set<string>();
  for (const a of acts.data ?? []) {
    if (!a.invoice_date) continue;
    try {
      const m = businessMonthOf(a.invoice_date, tz);
      if (m >= earliest) months.add(`${m}-01`);
    } catch {
      // Дата не читается: этот акт месяц не определяет (снимок месяца назовёт его проблемой данных).
    }
  }
  const notices: string[] = [];
  for (const month of [...months].sort()) {
    const n = autoNotice(await runRecalculation(ctx, venueId, month), trigger);
    if (n) notices.push(n);
  }
  // Один месяц за другим дают одно и то же пояснение (например об отказе по праву): без повторов.
  return joinUniqueNotices(notices);
}
