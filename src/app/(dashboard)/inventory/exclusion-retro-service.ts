import "server-only";

// Ретроактивное применение и снятие правила исключения на уже загруженных
// актах. НЕ "use server": вызывают серверные действия (создание/удаление
// правила из акта и из списка исключений заведения).
//
// Что меняется, решают чистые planApply/planRemove (src/lib/inventory/
// exclusion-retro.ts); здесь — чтение строк и актов, определение
// зафиксированных месяцев, запись, журнал актов и пересчёт удержания.

import type { LooseDb, LooseQuery } from "@/lib/supabase/loose";
import {
  buildExclusionMatcher,
  groupDescendants,
  type ExclusionRuleRow,
  type GroupNode,
} from "@/lib/inventory/exclusion-rules";
import {
  planApply,
  planRemove,
  settledFinalizedLines,
  type RetroLine,
  type RetroPatch,
} from "@/lib/inventory/exclusion-retro";
import { businessMonthOf } from "@/lib/stock/monthly-snapshot";
import { monthLabel } from "@/lib/stock/deduction-posting";
import { isDeductionAutopostEnabled } from "@/lib/stock/deduction-flag";
import { RESORT_STATUS, revalidateInventoryResultPages } from "./actions-shared";
import { autoRecalculateInventoryDeduction } from "./deduction-service";

/** Причина на строке, если у правила своей нет. */
export const DEFAULT_RULE_EXCLUDE_REASON = "Исключать всегда";

/** Часовой пояс заведения по умолчанию (как у колонки venues.timezone). */
const DEFAULT_VENUE_TIMEZONE = "Europe/Moscow";

const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 300;

type RuleRow = ExclusionRuleRow & { status: string; metadata: Record<string, unknown> | null };

type ItemRow = {
  id: string;
  document_id: string;
  ingredient_id: string | null;
  external_product_id: string | null;
  excluded_from_totals: boolean | null;
  exclusion_rule_id: string | null;
  exclusion_rule_dismissed_at: string | null;
  finalized_at: string | null;
  finalized_excluded_from_totals: boolean | null;
};

type DocumentRow = {
  id: string;
  venue_id: string | null;
  invoice_date: string | null;
};

export type RetroMonth = { venueId: string; month: string };

export type RetroResult = {
  touchedDocuments: number;
  /** Акты, в которых правило изменило хотя бы одну строку. */
  documentIds: string[];
  /** Месяцы подведённых актов, где изменился утверждённый снимок (YYYY-MM-01). */
  months: RetroMonth[];
  /** Пояснение про пересчёт удержания (или null). */
  notice: string | null;
};

const ITEM_COLUMNS =
  "id, document_id, ingredient_id, external_product_id, excluded_from_totals, exclusion_rule_id, exclusion_rule_dismissed_at, finalized_at, finalized_excluded_from_totals";

function chunks<T>(rows: T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Все строки запроса постранично: PostgREST по умолчанию отдаёт не больше 1000. */
async function fetchAll<T>(build: () => LooseQuery<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().order("id").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function itemsQuery(admin: LooseDb, accountId: string) {
  return admin.from<ItemRow[]>("document_items").select(ITEM_COLUMNS).eq("account_id", accountId);
}

/** Строки, на которые правило может действовать (до проверки приоритета). */
async function loadCandidateLines(
  admin: LooseDb,
  accountId: string,
  rule: RuleRow,
  groups: GroupNode[],
): Promise<{ items: ItemRow[]; groupIdByIngredientId: Map<string, string | null> }> {
  const byId = new Map<string, ItemRow>();
  const groupIdByIngredientId = new Map<string, string | null>();

  if (rule.target_kind === "product") {
    if (rule.ingredient_id) {
      const id = rule.ingredient_id;
      for (const row of await fetchAll(() => itemsQuery(admin, accountId).eq("ingredient_id", id))) byId.set(row.id, row);
    }
    if (rule.external_product_id) {
      const ext = rule.external_product_id;
      for (const row of await fetchAll(() => itemsQuery(admin, accountId).eq("external_product_id", ext))) byId.set(row.id, row);
    }
  } else if (rule.target_kind === "group" && rule.ingredient_group_id) {
    const groupIds = [...groupDescendants(rule.ingredient_group_id, groups)];
    for (const part of chunks(groupIds)) {
      const ingredients = await fetchAll(() =>
        admin
          .from<Array<{ id: string; group_id: string | null }>>("ingredients")
          .select("id, group_id")
          .eq("account_id", accountId)
          .in("group_id", part),
      );
      for (const ing of ingredients) groupIdByIngredientId.set(ing.id, ing.group_id);
    }
    for (const part of chunks([...groupIdByIngredientId.keys()])) {
      for (const row of await fetchAll(() => itemsQuery(admin, accountId).in("ingredient_id", part))) byId.set(row.id, row);
    }
  }

  // Группы ингредиентов строк, найденных по товару: нужны для проверки приоритета.
  const missing = [...new Set([...byId.values()].map((r) => r.ingredient_id).filter((id): id is string => !!id))]
    .filter((id) => !groupIdByIngredientId.has(id));
  for (const part of chunks(missing)) {
    const { data, error } = await admin
      .from<Array<{ id: string; group_id: string | null }>>("ingredients")
      .select("id, group_id")
      .eq("account_id", accountId)
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const ing of data ?? []) groupIdByIngredientId.set(ing.id, ing.group_id);
  }
  return { items: [...byId.values()], groupIdByIngredientId };
}

/** Инвентаризационные акты строк (архивные — удалённые в Quick Resto — не трогаем). */
async function loadDocuments(admin: LooseDb, accountId: string, documentIds: string[]) {
  const result = new Map<string, DocumentRow>();
  for (const part of chunks(documentIds)) {
    const { data, error } = await admin
      .from<DocumentRow[]>("documents")
      .select("id, venue_id, invoice_date")
      .eq("account_id", accountId)
      .eq("document_kind", "inventory")
      .is("archived_at", null)
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) result.set(d.id, d);
  }
  return result;
}

/**
 * Бизнес-месяц каждого акта (YYYY-MM-01) и множество актов зафиксированных
 * месяцев: есть зарплатный период заведения акта за этот месяц не в статусе
 * черновика. Акт без заведения или без даты ни к какому месяцу не относится и
 * считается незафиксированным.
 */
async function resolveMonths(admin: LooseDb, accountId: string, documents: Map<string, DocumentRow>) {
  const venueIds = [...new Set([...documents.values()].map((d) => d.venue_id).filter((v): v is string => !!v))];
  const timezoneByVenue = new Map<string, string | null>();
  const lockedKeys = new Set<string>();
  for (const part of chunks(venueIds)) {
    const [venues, periods] = await Promise.all([
      admin
        .from<Array<{ id: string; timezone: string | null }>>("venues")
        .select("id, timezone")
        .eq("account_id", accountId)
        .in("id", part),
      admin
        .from<Array<{ venue_id: string; month: string }>>("payroll_periods")
        .select("venue_id, month")
        .eq("account_id", accountId)
        .neq("status", "draft")
        .in("venue_id", part),
    ]);
    if (venues.error) throw new Error(venues.error.message);
    if (periods.error) throw new Error(periods.error.message);
    for (const v of venues.data ?? []) timezoneByVenue.set(v.id, v.timezone);
    for (const p of periods.data ?? []) lockedKeys.add(`${p.venue_id}|${p.month.slice(0, 7)}-01`);
  }

  const monthByDocument = new Map<string, RetroMonth>();
  const locked = new Set<string>();
  for (const d of documents.values()) {
    if (!d.venue_id || !d.invoice_date) continue;
    // Пояс не задан — берём пояс по умолчанию, а не пропускаем проверку фиксации.
    const tz = timezoneByVenue.get(d.venue_id) || DEFAULT_VENUE_TIMEZONE;
    let month: string;
    try {
      month = `${businessMonthOf(d.invoice_date, tz)}-01`;
    } catch {
      continue; // Дата не читается — месяц не определить.
    }
    monthByDocument.set(d.id, { venueId: d.venue_id, month });
    if (lockedKeys.has(`${d.venue_id}|${month}`)) locked.add(d.id);
  }
  return { monthByDocument, locked };
}

/** Строки актов, участвующие в активном пересорте. */
async function loadActiveResortItemIds(admin: LooseDb, accountId: string, documentIds: string[]) {
  const result = new Set<string>();
  for (const part of chunks(documentIds)) {
    const { data: resorts, error } = await admin
      .from<Array<{ id: string }>>("inventory_result_resorts")
      .select("id")
      .eq("account_id", accountId)
      .eq("status", RESORT_STATUS.active)
      .in("document_id", part);
    if (error) throw new Error(error.message);
    const resortIds = (resorts ?? []).map((r) => r.id);
    for (const resortPart of chunks(resortIds)) {
      const { data: items, error: itemsError } = await admin
        .from<Array<{ document_item_id: string }>>("inventory_result_resort_items")
        .select("document_item_id")
        .eq("account_id", accountId)
        .in("resort_id", resortPart);
      if (itemsError) throw new Error(itemsError.message);
      for (const i of items ?? []) result.add(i.document_item_id);
    }
  }
  return result;
}

async function writePatches(input: {
  admin: LooseDb;
  accountId: string;
  rule: RuleRow;
  userId: string;
  patches: RetroPatch[];
  exclude: boolean;
  now: string;
}): Promise<RetroPatch[]> {
  const { admin, accountId, rule, exclude } = input;
  const byId = new Map(input.patches.map((p) => [p.id, p]));
  const written: RetroPatch[] = [];
  for (const finalized of [false, true]) {
    const ids = input.patches.filter((p) => p.finalized === finalized).map((p) => p.id);
    if (ids.length === 0) continue;
    const fields: Record<string, unknown> = exclude
      ? {
          excluded_from_totals: true,
          exclude_reason: rule.reason ?? DEFAULT_RULE_EXCLUDE_REASON,
          excluded_by: input.userId,
          excluded_at: input.now,
          exclusion_rule_id: rule.id,
        }
      : {
          excluded_from_totals: false,
          exclude_reason: null,
          excluded_by: null,
          excluded_at: null,
          exclusion_rule_id: null,
          exclusion_rule_dismissed_at: null,
        };
    // Утверждённый снимок подведённой строки меняется вместе с живым полем.
    if (finalized) fields.finalized_excluded_from_totals = exclude;
    for (const part of chunks(ids)) {
      let query = admin
        .from<Array<{ id: string }>>("document_items")
        .update(fields)
        .eq("account_id", accountId)
        .in("id", part);
      // Повторная проверка в самом UPDATE: человек мог отказаться от правила
      // или исключить строку вручную, пока мы читали.
      query = exclude
        ? query
            .is("exclusion_rule_dismissed_at", null)
            .or("excluded_from_totals.eq.false,exclusion_rule_id.not.is.null")
        : query.eq("exclusion_rule_id", rule.id);
      // Считаем только реально изменённые строки: проверка выше могла часть отсеять.
      const { data, error } = await query.select("id");
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const patch = byId.get(row.id);
        if (patch) written.push(patch);
      }
    }
  }
  return written;
}

/**
 * Пересчёт удержания за месяцы, где изменились подведённые акты. При
 * выключенном автопересчёте — просьба пересчитать месяц вручную.
 */
export async function recalculateRetroMonths(months: RetroMonth[]): Promise<string | null> {
  if (months.length === 0) return null;
  if (!isDeductionAutopostEnabled(process.env)) {
    const labels = [...new Set(months.map((m) => m.month))].sort().map(monthLabel);
    return `Изменились подведённые акты за ${labels.join(", ")}: пересчитайте удержание по недостаче за ${labels.length > 1 ? "эти месяцы" : "этот месяц"}.`;
  }
  return autoRecalculateInventoryDeduction({ kind: "months", items: months });
}

/**
 * Применить правило ко всем актам незафиксированных месяцев (`apply`) или
 * снять его оттуда (`remove`). Ручные решения по строке не перезаписываются,
 * акты зафиксированных месяцев не меняются.
 *
 * `skipEventDocumentIds` — акты, журнал которых ведёт вызывающий (действие в
 * открытом акте пишет своё событие; второе было бы дублем).
 * `recalculate: false` — пересчёт удержания делает вызывающий (одним проходом
 * по нескольким правилам), месяцы возвращаются в результате.
 */
export async function applyExclusionRuleRetro(input: {
  admin: LooseDb;
  accountId: string;
  userId: string;
  ruleId: string;
  mode: "apply" | "remove";
  skipEventDocumentIds?: string[];
  recalculate?: boolean;
}): Promise<RetroResult> {
  const { admin, accountId } = input;
  const empty: RetroResult = { touchedDocuments: 0, documentIds: [], months: [], notice: null };

  const { data: rule, error: ruleError } = await admin
    .from<RuleRow>("inventory_result_exclusion_rules")
    .select("id, target_kind, ingredient_id, external_product_id, ingredient_group_id, product_name, reason, created_by, created_at, status, metadata")
    .eq("id", input.ruleId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (ruleError) throw new Error(ruleError.message);
  if (!rule) throw new Error("Правило исключения не найдено");
  if (input.mode === "apply" && rule.status !== "active") return empty;

  let items: ItemRow[];
  let isWinner: (item: ItemRow) => boolean = () => true;
  if (input.mode === "apply") {
    const [{ data: rules, error: rulesError }, { data: groups, error: groupsError }] = await Promise.all([
      admin
        .from<ExclusionRuleRow[]>("inventory_result_exclusion_rules")
        .select("id, target_kind, ingredient_id, external_product_id, ingredient_group_id, product_name, reason, created_by, created_at")
        .eq("account_id", accountId)
        .eq("status", "active"),
      admin.from<GroupNode[]>("ingredient_groups").select("id, parent_group_id").eq("account_id", accountId),
    ]);
    if (rulesError) throw new Error(rulesError.message);
    if (groupsError) throw new Error(groupsError.message);
    const candidates = await loadCandidateLines(admin, accountId, rule, groups ?? []);
    items = candidates.items;
    // Строка достаётся правилу, только если оно и есть победитель: правило на
    // товар сильнее правила группы, ближайшая группа сильнее дальней.
    const matcher = buildExclusionMatcher(rules ?? [], groups ?? []);
    isWinner = (item) =>
      matcher({
        ingredientId: item.ingredient_id,
        externalProductId: item.external_product_id,
        groupId: item.ingredient_id ? candidates.groupIdByIngredientId.get(item.ingredient_id) ?? null : null,
      })?.id === rule.id;
  } else {
    const ruleId = rule.id;
    items = await fetchAll(() => itemsQuery(admin, accountId).eq("exclusion_rule_id", ruleId));
  }
  items = items.filter(isWinner);

  const documents = await loadDocuments(admin, accountId, [...new Set(items.map((i) => i.document_id))]);
  items = items.filter((i) => documents.has(i.document_id));
  const { monthByDocument, locked } = await resolveMonths(admin, accountId, documents);
  const inResort = await loadActiveResortItemIds(
    admin,
    accountId,
    [...documents.keys()].filter((id) => !locked.has(id)),
  );

  const lines: RetroLine[] = items.map((i) => ({
    id: i.id,
    documentId: i.document_id,
    excluded: Boolean(i.excluded_from_totals),
    ruleId: i.exclusion_rule_id,
    dismissedAt: i.exclusion_rule_dismissed_at,
    inActiveResort: inResort.has(i.id),
    finalized: i.finalized_at != null,
    finalizedExcluded: i.finalized_excluded_from_totals,
  }));
  const patches = input.mode === "apply" ? planApply(rule.id, lines, locked) : planRemove(rule.id, lines, locked);

  const now = new Date().toISOString();
  const written = await writePatches({
    admin,
    accountId,
    rule,
    userId: input.userId,
    patches,
    exclude: input.mode === "apply",
    now,
  });

  // Журнал: одно событие на акт, по реально изменённым строкам.
  const linesByDocument = new Map<string, number>();
  for (const p of written) linesByDocument.set(p.documentId, (linesByDocument.get(p.documentId) ?? 0) + 1);
  const skip = new Set(input.skipEventDocumentIds ?? []);
  const events = [...linesByDocument]
    .filter(([documentId]) => !skip.has(documentId))
    .map(([documentId, count]) => ({
      account_id: accountId,
      document_id: documentId,
      document_item_id: null,
      resort_id: null,
      event_type: input.mode === "apply" ? "persistent_exclusion_enabled" : "persistent_exclusion_disabled",
      message:
        input.mode === "apply"
          ? `Правило «${rule.product_name}» исключило позиции из итогов (строк: ${count})`
          : `Правило «${rule.product_name}» удалено: позиции вернулись в итоги (строк: ${count})`,
      payload: { ruleId: rule.id, retro: true, lines: count },
      created_by: input.userId,
    }));
  for (const part of chunks(events)) {
    const { error } = await admin.from("inventory_result_events").insert(part);
    if (error) throw new Error(error.message);
  }

  // Метка успешного завершения: без неё правило считается не применённым
  // (или не снятым) до конца, и повторный запуск дочищает хвосты.
  const marker = input.mode === "apply" ? "retro_applied_at" : "retro_removed_at";
  const { error: markerError } = await admin
    .from("inventory_result_exclusion_rules")
    .update({ metadata: { ...(rule.metadata ?? {}), [marker]: now } })
    .eq("id", rule.id)
    .eq("account_id", accountId);
  if (markerError) throw new Error(markerError.message);

  const documentIds = [...linesByDocument.keys()];
  for (const documentId of documentIds) revalidateInventoryResultPages(documentId);

  // Удержание зависит только от утверждённого снимка — пересчитываем месяцы,
  // где он изменился. Если прошлое применение оборвалось (метки нет), снимок
  // части строк мог измениться без пересчёта — их месяцы тоже пересчитываем
  // (пересчёт идемпотентен, лишний ничего не портит).
  const monthDocumentIds = written.filter((p) => p.snapshotChanged).map((p) => p.documentId);
  if (input.mode === "apply" && !rule.metadata?.retro_applied_at) {
    for (const line of settledFinalizedLines(rule.id, lines, locked)) monthDocumentIds.push(line.documentId);
  }
  const monthKeys = new Map<string, RetroMonth>();
  for (const documentId of monthDocumentIds) {
    const m = monthByDocument.get(documentId);
    if (m) monthKeys.set(`${m.venueId}|${m.month}`, m);
  }
  const months = [...monthKeys.values()];
  const notice = input.recalculate === false ? null : await recalculateRetroMonths(months);
  return { touchedDocuments: documentIds.length, documentIds, months, notice };
}

/** Несколько правил подряд с одним пересчётом удержания в конце. */
export async function applyExclusionRulesRetro(input: {
  admin: LooseDb;
  accountId: string;
  userId: string;
  ruleIds: string[];
  mode: "apply" | "remove";
  skipEventDocumentIds?: string[];
}): Promise<RetroResult> {
  const documentIds = new Set<string>();
  const months = new Map<string, RetroMonth>();
  for (const ruleId of new Set(input.ruleIds)) {
    const r = await applyExclusionRuleRetro({ ...input, ruleId, recalculate: false });
    for (const id of r.documentIds) documentIds.add(id);
    for (const m of r.months) months.set(`${m.venueId}|${m.month}`, m);
  }
  const monthList = [...months.values()];
  return {
    touchedDocuments: documentIds.size,
    documentIds: [...documentIds],
    months: monthList,
    notice: await recalculateRetroMonths(monthList),
  };
}
