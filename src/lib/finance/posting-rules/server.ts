"use server";

import { revalidatePath } from "next/cache";

import { writeAuditEvent } from "@/lib/audit/write";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties, listCounterpartyGroups } from "@/lib/finance/counterparties";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunk } from "@/lib/supabase/fetch-all";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";

import type { RuleDirectories } from "./context";
import {
  normalizePostingRuleInput,
  parseStoredConditions,
  type PostingRuleInput,
} from "./input";
import { describePostingRule, type RuleNameKind, type RuleNames } from "./phrase";
import type { PostingRule } from "./types";

type RuleRow = {
  id: string;
  name: string | null;
  position: number;
  enabled: boolean;
  conditions: unknown;
  action_category_id: string | null;
  action_counterparty_id: string | null;
  action_venue_id: string | null;
};

const RULE_COLUMNS =
  "id, name, position, enabled, conditions, action_category_id, action_counterparty_id, action_venue_id";

function toRule(row: RuleRow): PostingRule {
  const actions: PostingRule["actions"] = {};
  if (row.action_category_id) actions.category_id = row.action_category_id;
  if (row.action_counterparty_id) actions.counterparty_id = row.action_counterparty_id;
  if (row.action_venue_id) actions.venue_id = row.action_venue_id;
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    enabled: row.enabled,
    // Испорченные условия → пустой список: правило не сработает и будет
    // помечено «Требует внимания».
    conditions: parseStoredConditions(row.conditions) ?? [],
    actions,
  };
}

function revalidateRules() {
  revalidatePath("/finance/rules");
  revalidatePath("/finance/transactions");
}

/** Правила активного аккаунта сверху вниз (под RLS: нужен доступ к операциям). */
export async function listPostingRules(): Promise<PostingRule[]> {
  const supabase = await createClient();
  const { data, error } = await asLooseDb(supabase)
    .from<RuleRow[]>("finance_posting_rules")
    .select(RULE_COLUMNS)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toRule);
}

/** Заведения из действий правил, которые уже в архиве. Не владельцу RLS
 *  архивные заведения не отдаёт, и правило с таким заведением выглядело бы
 *  рабочим; поэтому статус читаем служебным клиентом — только флаг архива и
 *  только заведений активного аккаунта. */
export async function listArchivedRuleVenueIds(rules: PostingRule[]): Promise<string[]> {
  const accountId = await getCachedActiveAccountId();
  const ids = [...new Set(rules.map((r) => r.actions.venue_id).filter((id): id is string => Boolean(id)))];
  if (!accountId || ids.length === 0) return [];
  const admin = createAdminClient();
  const archived: string[] = [];
  for (const part of chunk(ids, 200)) {
    const { data, error } = await asLooseDb(admin)
      .from<Array<{ id: string }>>("venues")
      .select("id")
      .eq("account_id", accountId)
      .in("id", part)
      .not("archived_at", "is", null);
    if (error) throw new Error(error.message);
    archived.push(...(data ?? []).map((v) => v.id));
  }
  return archived;
}

/** Справочники для фразы и пометки «Требует внимания» на странице правил.
 *  Заведения — вместе с архивными (владельцу их отдаёт RLS). */
export async function loadPostingRuleDirectories(): Promise<RuleDirectories> {
  const supabase = await createClient();
  const accountId = await getCachedActiveAccountId();
  const [counterparties, groups, bankAccounts, categories, venues] = await Promise.all([
    listCounterparties({ include_deleted: true }),
    listCounterpartyGroups(),
    listBankAccounts({ include_deleted: true }),
    listFinanceCategories({ include_archived: true }),
    accountId
      ? asLooseDb(supabase)
          .from<Array<{ id: string; name: string; archived_at: string | null }>>("venues")
          .select("id, name, archived_at")
          .eq("account_id", accountId)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  return {
    counterparties: counterparties.rows.map((c) => ({
      id: c.id,
      name: c.name,
      inn: c.inn,
      group_id: c.group_id,
      deleted_at: c.deleted_at,
    })),
    counterpartyGroups: groups.rows.map((g) => ({ id: g.id, name: g.name })),
    bankAccounts: bankAccounts.rows.map((a) => ({ id: a.id, name: a.name, deleted_at: a.deleted_at })),
    categories: categories.rows.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      archived_at: c.archived_at,
    })),
    venues: venues.data ?? [],
  };
}

type Session = { accountId: string; userId: string };
type Supabase = Awaited<ReturnType<typeof createClient>>;

async function requireManager(): Promise<Session | string> {
  const [can, user, accountId] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedUser(),
    getCachedActiveAccountId(),
  ]);
  if (!user || !accountId) return "Не авторизован";
  if (!can("finance.manage_posting_rules")) return "Недостаточно прав";
  return { accountId, userId: user.id };
}

type RefTable = {
  kind: RuleNameKind;
  table: string;
  archive: "archived_at" | "deleted_at" | null;
  missing: string;
  archived: string;
};

const REF_TABLES: Record<RuleNameKind, RefTable> = {
  counterparty: {
    kind: "counterparty",
    table: "counterparties",
    archive: "deleted_at",
    missing: "Контрагент не найден",
    archived: "Контрагент «%s» в архиве",
  },
  counterparty_group: {
    kind: "counterparty_group",
    table: "counterparty_groups",
    archive: null,
    missing: "Группа контрагентов не найдена",
    archived: "",
  },
  bank_account: {
    kind: "bank_account",
    table: "bank_accounts",
    archive: "deleted_at",
    missing: "Счёт не найден",
    archived: "Счёт «%s» в архиве",
  },
  category: {
    kind: "category",
    table: "finance_categories",
    archive: "archived_at",
    missing: "Статья не найдена",
    archived: "Статья «%s» в архиве",
  },
  venue: {
    kind: "venue",
    table: "venues",
    archive: "archived_at",
    missing: "Заведение не найдено",
    archived: "Заведение «%s» в архиве",
  },
};

function referencedIds(input: PostingRuleInput): Record<RuleNameKind, string[]> {
  const refs: Record<RuleNameKind, Set<string>> = {
    counterparty: new Set(),
    counterparty_group: new Set(),
    bank_account: new Set(),
    category: new Set(),
    venue: new Set(),
  };
  for (const c of input.conditions) {
    if (c.field === "counterparty") c.ids.forEach((id) => refs.counterparty.add(id));
    if (c.field === "counterparty_group") c.ids.forEach((id) => refs.counterparty_group.add(id));
    if (c.field === "bank_account") c.ids.forEach((id) => refs.bank_account.add(id));
  }
  if (input.actions.category_id) refs.category.add(input.actions.category_id);
  if (input.actions.counterparty_id) refs.counterparty.add(input.actions.counterparty_id);
  if (input.actions.venue_id) refs.venue.add(input.actions.venue_id);
  return Object.fromEntries(
    Object.entries(refs).map(([kind, ids]) => [kind, [...ids]]),
  ) as Record<RuleNameKind, string[]>;
}

/** Все id правила принадлежат аккаунту и не в архиве. Возвращает названия
 *  для журнала или текст ошибки. */
async function checkReferences(
  supabase: Supabase,
  accountId: string,
  input: PostingRuleInput,
): Promise<{ names: RuleNames } | { error: string }> {
  const found = new Map<string, string>();
  const refs = referencedIds(input);
  for (const kind of Object.keys(refs) as RuleNameKind[]) {
    const spec = REF_TABLES[kind];
    for (const ids of chunk(refs[kind], 200)) {
      const columns = spec.archive ? `id, name, ${spec.archive}` : "id, name";
      const { data, error } = await asLooseDb(supabase)
        .from<Array<Record<string, string | null>>>(spec.table)
        .select(columns)
        .eq("account_id", accountId)
        .in("id", ids);
      if (error) return { error: error.message };
      const rows = data ?? [];
      if (rows.length !== ids.length) return { error: spec.missing };
      for (const row of rows) {
        if (spec.archive && row[spec.archive]) {
          return { error: spec.archived.replace("%s", row.name ?? "") };
        }
        found.set(`${kind}:${row.id}`, row.name ?? "");
      }
    }
  }
  return { names: { lookup: (kind, id) => found.get(`${kind}:${id}`) ?? null } };
}

async function categoryTypesFor(
  supabase: Supabase,
  accountId: string,
  raw: unknown,
): Promise<Map<string, "income" | "expense" | "mixed">> {
  const id =
    raw && typeof raw === "object" && "actions" in raw
      ? (raw as { actions?: { category_id?: unknown } }).actions?.category_id
      : null;
  if (typeof id !== "string" || !id) return new Map();
  const { data } = await asLooseDb(supabase)
    .from<Array<{ id: string; type: "income" | "expense" | "mixed" }>>("finance_categories")
    .select("id, type")
    .eq("account_id", accountId)
    .eq("id", id);
  return new Map((data ?? []).map((c) => [c.id, c.type]));
}

function phraseOf(input: PostingRuleInput, names: RuleNames): string {
  const { conditions, actions } = describePostingRule(input, names);
  return `Если ${conditions} → ${actions}`;
}

async function prepare(
  supabase: Supabase,
  session: Session,
  raw: unknown,
): Promise<{ input: PostingRuleInput; phrase: string } | { error: string }> {
  const normalized = normalizePostingRuleInput(
    raw,
    await categoryTypesFor(supabase, session.accountId, raw),
  );
  if (!normalized.ok) return { error: normalized.error };
  const refs = await checkReferences(supabase, session.accountId, normalized.value);
  if ("error" in refs) return refs;
  return { input: normalized.value, phrase: phraseOf(normalized.value, refs.names) };
}

function rowValues(input: PostingRuleInput) {
  return {
    name: input.name,
    enabled: input.enabled,
    conditions: input.conditions,
    action_category_id: input.actions.category_id ?? null,
    action_counterparty_id: input.actions.counterparty_id ?? null,
    action_venue_id: input.actions.venue_id ?? null,
  };
}

export async function createPostingRule(
  raw: unknown,
): Promise<{ id: string | null; error: string | null }> {
  const session = await requireManager();
  if (typeof session === "string") return { id: null, error: session };
  const supabase = await createClient();
  const prepared = await prepare(supabase, session, raw);
  if ("error" in prepared) return { id: null, error: prepared.error };

  const db = asLooseDb(supabase);
  const { data: last } = await db
    .from<Array<{ position: number }>>("finance_posting_rules")
    .select("position")
    .eq("account_id", session.accountId)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? 0) + 1;

  const { data, error } = await db
    .from<{ id: string }>("finance_posting_rules")
    .insert({
      account_id: session.accountId,
      position,
      ...rowValues(prepared.input),
    })
    .select("id")
    .single();
  if (error || !data) return { id: null, error: error?.message ?? "Не удалось создать правило" };

  await writeAuditEvent({
    accountId: session.accountId,
    userId: session.userId,
    actionCode: "finance.posting_rule.created",
    entityType: "finance_posting_rule",
    entityId: data.id,
    details: { name: prepared.input.name, phrase: prepared.phrase },
  });
  revalidateRules();
  return { id: data.id, error: null };
}

export async function updatePostingRule(id: string, raw: unknown): Promise<{ error: string | null }> {
  const session = await requireManager();
  if (typeof session === "string") return { error: session };
  const supabase = await createClient();
  const prepared = await prepare(supabase, session, raw);
  if ("error" in prepared) return { error: prepared.error };

  const { data, error } = await asLooseDb(supabase)
    .from<Array<{ id: string }>>("finance_posting_rules")
    .update(rowValues(prepared.input))
    .eq("id", id)
    .eq("account_id", session.accountId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Правило не найдено" };

  await writeAuditEvent({
    accountId: session.accountId,
    userId: session.userId,
    actionCode: "finance.posting_rule.updated",
    entityType: "finance_posting_rule",
    entityId: id,
    details: { name: prepared.input.name, phrase: prepared.phrase },
  });
  revalidateRules();
  return { error: null };
}

export async function setPostingRuleEnabled(
  id: string,
  enabled: boolean,
): Promise<{ error: string | null }> {
  const session = await requireManager();
  if (typeof session === "string") return { error: session };
  const supabase = await createClient();
  const { data, error } = await asLooseDb(supabase)
    .from<Array<{ id: string; name: string | null }>>("finance_posting_rules")
    .update({ enabled })
    .eq("id", id)
    .eq("account_id", session.accountId)
    .select("id, name");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Правило не найдено" };

  await writeAuditEvent({
    accountId: session.accountId,
    userId: session.userId,
    actionCode: "finance.posting_rule.updated",
    entityType: "finance_posting_rule",
    entityId: id,
    details: { name: data[0].name, enabled },
  });
  revalidateRules();
  return { error: null };
}

export async function deletePostingRule(id: string): Promise<{ error: string | null }> {
  const session = await requireManager();
  if (typeof session === "string") return { error: session };
  const supabase = await createClient();
  const { data, error } = await asLooseDb(supabase)
    .from<Array<{ id: string; name: string | null }>>("finance_posting_rules")
    .delete()
    .eq("id", id)
    .eq("account_id", session.accountId)
    .select("id, name");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Правило не найдено" };

  await writeAuditEvent({
    accountId: session.accountId,
    userId: session.userId,
    actionCode: "finance.posting_rule.deleted",
    entityType: "finance_posting_rule",
    entityId: id,
    details: { name: data[0].name },
  });
  revalidateRules();
  return { error: null };
}

export async function reorderPostingRules(ids: string[]): Promise<{ error: string | null }> {
  const session = await requireManager();
  if (typeof session === "string") return { error: session };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_posting_rules_reorder", { p_ids: ids });
  if (error) return { error: error.message };

  await writeAuditEvent({
    accountId: session.accountId,
    userId: session.userId,
    actionCode: "finance.posting_rule.order_changed",
    entityType: "finance_posting_rule",
    entityId: null,
    details: { count: ids.length },
  });
  revalidateRules();
  return { error: null };
}
