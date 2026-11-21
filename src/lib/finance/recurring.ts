"use server";

import { revalidatePath } from "next/cache";

import { writeAuditEvent } from "@/lib/audit/write";
import { calendarDateInZone } from "@/lib/format/zoned-day";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";
import type {
  RecurringOccurrenceRow,
  RecurringSchedule,
  RecurringTemplateInput,
  RecurringTemplateListItem,
  RecurringTemplateRow,
} from "@/types/finance";

// Повторяющиеся платежи: шаблоны с расписанием и очередь ожидаемых платежей
// (миграция 377). Права и видимость принуждает RLS; здесь — человеческие
// сообщения, точка отсчёта порождения и журнал событий.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const NO_PERMISSION = "Нет прав на повторяющиеся платежи";
const ALREADY_RESOLVED = "Платёж уже разобран";
const TEMPLATE_GONE = "Не удалось сохранить: нет прав или шаблон уже удалён. Обновите страницу";

type Ctx = {
  supabase: Supabase;
  userId: string;
  accountId: string;
  timeZone: string;
  today: string;
  tomorrow: string;
};

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Пользователь, активный аккаунт и «сегодня/завтра» в поясе аккаунта. */
async function getCtx(): Promise<Ctx | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };
  const { data: accountId, error: accountErr } = await supabase.rpc("get_active_account_id");
  if (accountErr || !accountId) return { error: "Не удалось определить активный аккаунт" };
  const { data: tz } = await supabase.rpc("get_active_account_timezone");
  const timeZone = typeof tz === "string" && tz ? tz : "Europe/Moscow";
  const today = calendarDateInZone(new Date().toISOString(), timeZone);
  return {
    supabase,
    userId: user.id,
    accountId: accountId as unknown as string,
    timeZone,
    today,
    tomorrow: addDays(today, 1),
  };
}

async function requireManage(): Promise<string | null> {
  const can = await getCachedPermissionChecker();
  return can("finance.create_transaction") ? null : NO_PERMISSION;
}

function revalidateRecurring() {
  revalidatePath("/finance/recurring");
  revalidatePath("/finance/transactions");
  revalidatePath("/finance");
}

function scheduleColumns(s: RecurringSchedule) {
  return {
    frequency: s.frequency,
    day_of_month: s.frequency === "weekly" ? null : s.dayOfMonth,
    quarter_month: s.frequency === "quarterly" ? s.quarterMonth : null,
    weekday: s.frequency === "weekly" ? s.weekday : null,
  };
}

function validateInput(input: RecurringTemplateInput): string | null {
  if (!input.name.trim()) return "Укажите название";
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "Сумма должна быть больше нуля";
  if (!input.legal_entity_id || !input.bank_account_id) return "Выберите юрлицо и счёт";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.starts_on)) return "Укажите дату начала";
  if (input.ends_on && input.ends_on < input.starts_on) return "Дата окончания раньше даты начала";
  const s = input.schedule;
  if (s.frequency === "weekly") {
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) return "Неверный день недели";
  } else {
    if (!Number.isInteger(s.dayOfMonth) || s.dayOfMonth < 1 || s.dayOfMonth > 31) return "Неверный день месяца";
    if (s.frequency === "quarterly" && ![1, 2, 3].includes(s.quarterMonth)) return "Неверный месяц квартала";
  }
  return null;
}

/**
 * Валюта шаблона — валюта выбранного счёта, прочитанная на сервере (клиенту не
 * доверяем). Счёт читаем service-role клиентом в пределах аккаунта: у
 * создающего может не быть finance.view_bank_accounts.
 */
async function bankAccountCurrency(
  ctx: Ctx,
  input: RecurringTemplateInput,
): Promise<{ currency: string } | { error: string }> {
  const { data, error } = await createAdminClient()
    .from("bank_accounts")
    .select("currency, legal_entity_id")
    .eq("id", input.bank_account_id)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Счёт не найден. Обновите страницу" };
  if (data.legal_entity_id !== input.legal_entity_id) {
    return { error: "Счёт относится к другому юрлицу. Обновите страницу" };
  }
  return { currency: data.currency };
}

function templateFields(input: RecurringTemplateInput, currency: string) {
  return {
    name: input.name.trim(),
    type: input.type,
    legal_entity_id: input.legal_entity_id,
    venue_id: input.venue_id,
    bank_account_id: input.bank_account_id,
    category_id: input.category_id,
    counterparty_id: input.counterparty_id,
    amount: input.amount,
    amount_varies: input.amount_varies,
    currency,
    description: input.description?.trim() || null,
    starts_on: input.starts_on,
    ends_on: input.ends_on,
    ...scheduleColumns(input.schedule),
  };
}

// ─── Шаблоны ────────────────────────────────────────────────────────────────

export async function createRecurringTemplate(
  input: RecurringTemplateInput,
): Promise<{ id: string | null; error: string | null }> {
  const denied = await requireManage();
  if (denied) return { id: null, error: denied };
  const invalid = validateInput(input);
  if (invalid) return { id: null, error: invalid };
  const ctx = await getCtx();
  if ("error" in ctx) return { id: null, error: ctx.error };
  const account = await bankAccountCurrency(ctx, input);
  if ("error" in account) return { id: null, error: account.error };

  // Прошлое задним числом не догоняем: порождение — с завтрашнего дня, а у шаблона
  // «из операции» — после дня этой операции.
  let materializeFrom = ctx.tomorrow;
  if (input.source_transaction_id) {
    const { data: src } = await ctx.supabase
      .from("transactions")
      .select("date")
      .eq("id", input.source_transaction_id)
      .maybeSingle();
    if (!src) return { id: null, error: "Исходная операция не найдена" };
    const next = addDays(calendarDateInZone(src.date, ctx.timeZone), 1);
    if (next > materializeFrom) materializeFrom = next;
  }

  const { data, error } = await ctx.supabase
    .from("finance_recurring_templates")
    .insert({
      ...templateFields(input, account.currency),
      account_id: ctx.accountId,
      source_transaction_id: input.source_transaction_id ?? null,
      materialize_from: materializeFrom,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { id: null, error: error?.message ?? "Не удалось создать шаблон" };

  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: input.venue_id,
    userId: ctx.userId,
    actionCode: "finance.recurring.created",
    entityType: "finance_recurring_template",
    entityId: data.id,
    details: { name: input.name.trim(), amount: input.amount, type: input.type },
  });
  revalidateRecurring();
  return { id: data.id, error: null };
}

const TRACKED_FIELDS = [
  "name",
  "amount",
  "amount_varies",
  "frequency",
  "day_of_month",
  "quarter_month",
  "weekday",
  "starts_on",
  "ends_on",
  "bank_account_id",
  "category_id",
  "counterparty_id",
  "venue_id",
  "description",
] as const;

export async function updateRecurringTemplate(
  id: string,
  input: RecurringTemplateInput,
): Promise<{ error: string | null }> {
  const denied = await requireManage();
  if (denied) return { error: denied };
  const invalid = validateInput(input);
  if (invalid) return { error: invalid };
  const ctx = await getCtx();
  if ("error" in ctx) return { error: ctx.error };

  const { data: before } = await ctx.supabase
    .from("finance_recurring_templates")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!before) return { error: TEMPLATE_GONE };
  const account = await bankAccountCurrency(ctx, input);
  if ("error" in account) return { error: account.error };

  const fields = templateFields(input, account.currency);
  const scheduleChanged =
    before.starts_on !== fields.starts_on ||
    before.frequency !== fields.frequency ||
    before.day_of_month !== fields.day_of_month ||
    before.quarter_month !== fields.quarter_month ||
    before.weekday !== fields.weekday;

  const { data, error } = await ctx.supabase
    .from("finance_recurring_templates")
    .update({
      ...fields,
      ...(scheduleChanged ? { materialize_from: ctx.tomorrow } : {}),
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("archived_at", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: TEMPLATE_GONE };

  const changes = TRACKED_FIELDS.filter(
    (f) => (before as Record<string, unknown>)[f] !== (fields as Record<string, unknown>)[f],
  ).map((f) => ({
    field: f,
    old: (before as Record<string, unknown>)[f] ?? null,
    new: (fields as Record<string, unknown>)[f] ?? null,
  }));
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: input.venue_id,
    userId: ctx.userId,
    actionCode: "finance.recurring.updated",
    entityType: "finance_recurring_template",
    entityId: id,
    details: { name: fields.name, changes },
  });
  revalidateRecurring();
  return { error: null };
}

/** Общая часть пауза/возобновление/архив/восстановление: правка + `.select("id")` + журнал. */
async function mutateTemplate(
  id: string,
  opts: {
    patch: (ctx: Ctx) => Record<string, unknown>;
    liveOnly: boolean; // true — только живой шаблон, false — только архивный
    /** Требуемое состояние паузы: "paused" — на паузе, "active" — не на паузе. */
    pauseState?: "paused" | "active";
    emptyMessage?: string;
    actionCode: string;
  },
): Promise<{ error: string | null }> {
  const denied = await requireManage();
  if (denied) return { error: denied };
  const ctx = await getCtx();
  if ("error" in ctx) return { error: ctx.error };

  let query = ctx.supabase
    .from("finance_recurring_templates")
    .update({ ...opts.patch(ctx), updated_by: ctx.userId, updated_at: new Date().toISOString() })
    .eq("id", id);
  query = opts.liveOnly ? query.is("archived_at", null) : query.not("archived_at", "is", null);
  if (opts.pauseState === "paused") query = query.not("paused_at", "is", null);
  if (opts.pauseState === "active") query = query.is("paused_at", null);
  const { data, error } = await query.select("id, name, venue_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: opts.emptyMessage ?? TEMPLATE_GONE };

  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: data[0].venue_id,
    userId: ctx.userId,
    actionCode: opts.actionCode,
    entityType: "finance_recurring_template",
    entityId: id,
    details: { name: data[0].name },
  });
  revalidateRecurring();
  return { error: null };
}

export async function pauseRecurringTemplate(id: string) {
  return mutateTemplate(id, {
    patch: () => ({ paused_at: new Date().toISOString() }),
    liveOnly: true,
    pauseState: "active",
    emptyMessage: "Шаблон уже на паузе",
    actionCode: "finance.recurring.paused",
  });
}

export async function resumeRecurringTemplate(id: string) {
  return mutateTemplate(id, {
    patch: (ctx) => ({ paused_at: null, materialize_from: ctx.tomorrow }),
    liveOnly: true,
    pauseState: "paused",
    emptyMessage: "Шаблон уже активен",
    actionCode: "finance.recurring.resumed",
  });
}

export async function archiveRecurringTemplate(id: string) {
  return mutateTemplate(id, {
    patch: (ctx) => ({ archived_at: new Date().toISOString(), archived_by: ctx.userId }),
    liveOnly: true,
    actionCode: "finance.recurring.archived",
  });
}

export async function restoreRecurringTemplate(id: string) {
  // Дни архива не догоняем: порождение продолжается с завтрашнего дня.
  return mutateTemplate(id, {
    patch: (ctx) => ({ archived_at: null, archived_by: null, materialize_from: ctx.tomorrow }),
    liveOnly: false,
    actionCode: "finance.recurring.restored",
  });
}

export async function deleteRecurringTemplate(id: string): Promise<{ error: string | null }> {
  const can = await getCachedPermissionChecker();
  if (!can("finance.delete_transaction")) return { error: "Нет прав на удаление" };
  const ctx = await getCtx();
  if ("error" in ctx) return { error: ctx.error };

  const { data, error } = await ctx.supabase
    .from("finance_recurring_templates")
    .delete()
    .eq("id", id)
    .not("archived_at", "is", null)
    .select("id, name, venue_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Удалить можно только архивный шаблон; возможно, он уже удалён" };
  }
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: data[0].venue_id,
    userId: ctx.userId,
    actionCode: "finance.recurring.deleted",
    entityType: "finance_recurring_template",
    entityId: id,
    details: { name: data[0].name },
  });
  revalidateRecurring();
  return { error: null };
}

/**
 * Ожидаемые платежи шаблона: сколько ждут разбора (`pending`, удалятся вместе
 * с шаблоном и не меняются при его правке) и сколько проведено (операции
 * останутся в «Транзакциях»). Видимость — по RLS ожидаемых платежей.
 */
export async function getRecurringTemplateImpact(
  id: string,
): Promise<{ pending: number; posted: number; error: string | null }> {
  const supabase = await createClient();
  const count = (status: "pending" | "posted") =>
    supabase
      .from("finance_recurring_occurrences")
      .select("id", { count: "exact", head: true })
      .eq("template_id", id)
      .eq("status", status);
  const [pending, posted] = await Promise.all([count("pending"), count("posted")]);
  const error = pending.error?.message ?? posted.error?.message ?? null;
  return { pending: pending.count ?? 0, posted: posted.count ?? 0, error };
}

export async function listRecurringTemplates(opts: {
  archived: boolean;
}): Promise<{ items: RecurringTemplateListItem[]; error: string | null }> {
  const supabase = await createClient();
  const base = supabase.from("finance_recurring_templates").select("*");
  const { data, error } = await (opts.archived
    ? base.not("archived_at", "is", null).order("archived_at", { ascending: false })
    : base.is("archived_at", null).order("name"));
  if (error) return { items: [], error: error.message };
  const rows = (data ?? []) as RecurringTemplateRow[];
  const items = await Promise.all(
    rows.map(async (row): Promise<RecurringTemplateListItem> => {
      if (opts.archived || row.paused_at) return { ...row, next_due: null };
      const { data: next } = await supabase.rpc("finance_recurring_next_due", { p_template_id: row.id });
      return { ...row, next_due: typeof next === "string" ? next : null };
    }),
  );
  return { items, error: null };
}

// ─── Очередь ожидаемых платежей ─────────────────────────────────────────────

function inboxQuery(supabase: Supabase, today: string, head: boolean) {
  return supabase
    .from("finance_recurring_occurrences")
    .select("*", head ? { count: "exact", head: true } : undefined)
    .eq("status", "pending")
    .or(`postponed_to.is.null,postponed_to.lte.${today}`);
}

export async function listInbox(): Promise<{ items: RecurringOccurrenceRow[]; error: string | null }> {
  const ctx = await getCtx();
  if ("error" in ctx) return { items: [], error: ctx.error };
  // Порождаем недостающие сроки сейчас — cron может быть ещё не отработавшим.
  const { error: materializeError } = await ctx.supabase.rpc("finance_recurring_materialize_mine");
  if (materializeError) console.error(`[recurring] materialize_mine: ${materializeError.message}`);
  try {
    const items = await fetchAllRows<RecurringOccurrenceRow>(() =>
      asLooseDb(ctx.supabase)
        .from<RecurringOccurrenceRow[]>("finance_recurring_occurrences")
        .select("*")
        .eq("status", "pending")
        .or(`postponed_to.is.null,postponed_to.lte.${ctx.today}`)
        .order("due_date"),
    );
    return { items, error: null };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : "Не удалось загрузить платежи" };
  }
}

export async function countInbox(): Promise<number> {
  const ctx = await getCtx();
  if ("error" in ctx) return 0;
  // Страховка от молчащего cron, как в listInbox: счётчик сам порождает
  // наступившие сроки. После первого запуска за день совпадений нет — дёшево.
  const { error: materializeError } = await ctx.supabase.rpc("finance_recurring_materialize_mine");
  if (materializeError) console.error(`[recurring] materialize_mine: ${materializeError.message}`);
  const { count, error } = await inboxQuery(ctx.supabase, ctx.today, true);
  if (error) console.error(`[recurring] countInbox: ${error.message}`);
  return count ?? 0;
}

async function auditOccurrence(
  ctx: Ctx,
  row: { id: string; name: string; venue_id: string | null; due_date: string; amount: number },
  actionCode: string,
  extra: Record<string, unknown> = {},
) {
  await writeAuditEvent({
    accountId: ctx.accountId,
    venueId: row.venue_id,
    userId: ctx.userId,
    actionCode,
    entityType: "finance_recurring_occurrence",
    entityId: row.id,
    details: { name: row.name, due_date: row.due_date, amount: row.amount, ...extra },
  });
}

export async function postOccurrence(
  id: string,
  patch: {
    amount: number;
    date: string;
    bank_account_id: string;
    category_id: string | null;
    counterparty_id: string | null;
    venue_id: string | null;
    description: string | null;
  },
): Promise<{ transactionId: string | null; error: string | null }> {
  const denied = await requireManage();
  if (denied) return { transactionId: null, error: denied };
  const ctx = await getCtx();
  if ("error" in ctx) return { transactionId: null, error: ctx.error };

  const { data, error } = await ctx.supabase.rpc("finance_recurring_post", {
    p_occurrence: id,
    p_amount: patch.amount,
    p_date: patch.date,
    p_bank_account: patch.bank_account_id,
    p_category: patch.category_id,
    p_counterparty: patch.counterparty_id,
    p_venue: patch.venue_id,
    p_description: patch.description,
  });
  if (error || !data) {
    return { transactionId: null, error: error?.message ?? "Не удалось провести платёж" };
  }

  const { data: occ } = await ctx.supabase
    .from("finance_recurring_occurrences")
    .select("id, name, venue_id, due_date")
    .eq("id", id)
    .maybeSingle();
  await auditOccurrence(
    ctx,
    {
      id,
      name: occ?.name ?? "",
      venue_id: patch.venue_id ?? occ?.venue_id ?? null,
      due_date: occ?.due_date ?? "",
      amount: patch.amount,
    },
    "finance.recurring_occurrence.posted",
    { transaction_id: data },
  );
  revalidateRecurring();
  revalidatePath("/finance/accounts");
  return { transactionId: data as string, error: null };
}

export async function skipOccurrence(id: string): Promise<{ error: string | null }> {
  const denied = await requireManage();
  if (denied) return { error: denied };
  const ctx = await getCtx();
  if ("error" in ctx) return { error: ctx.error };

  const { data, error } = await ctx.supabase
    .from("finance_recurring_occurrences")
    .update({ status: "skipped", resolved_by: ctx.userId, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, name, venue_id, due_date, amount");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: ALREADY_RESOLVED };

  await auditOccurrence(ctx, data[0], "finance.recurring_occurrence.skipped");
  revalidateRecurring();
  return { error: null };
}

export async function postponeOccurrence(id: string, to: string): Promise<{ error: string | null }> {
  const denied = await requireManage();
  if (denied) return { error: denied };
  const ctx = await getCtx();
  if ("error" in ctx) return { error: ctx.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to <= ctx.today) {
    return { error: "Перенести можно только на дату позже сегодняшней" };
  }

  const { data, error } = await ctx.supabase
    .from("finance_recurring_occurrences")
    .update({ postponed_to: to })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, name, venue_id, due_date, amount");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: ALREADY_RESOLVED };

  await auditOccurrence(ctx, data[0], "finance.recurring_occurrence.postponed", { postponed_to: to });
  revalidateRecurring();
  return { error: null };
}
