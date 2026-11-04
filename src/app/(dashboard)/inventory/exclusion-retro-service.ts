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
  isProtectedMonth,
  partitionPendingRemovals,
  planApply,
  planRemove,
  removalComplete,
  RetroPartialFailure,
  runRulesIsolated,
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
const STAMP_CONCURRENCY = 20;

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
  /** Акты со строками правила, которые не менялись: защищённый месяц. */
  lockedDocumentIds: string[];
  /** Строки правила, которые не менялись: активный пересорт. */
  resortItemIds: string[];
  /** Снятие: акты, где позиции вернулись в итоги. */
  clearedDocumentIds: string[];
  /** Снятие: строки, исключение которых перешло к другому действующему правилу. */
  transferredItems: Array<{ id: string; documentId: string; ruleId: string; ruleName: string }>;
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
  await loadIngredientGroups(admin, accountId, [...byId.values()], groupIdByIngredientId);
  return { items: [...byId.values()], groupIdByIngredientId };
}

/** Дополняет `into` группами ингредиентов строк, которых там ещё нет. */
async function loadIngredientGroups(
  admin: LooseDb,
  accountId: string,
  items: ItemRow[],
  into: Map<string, string | null>,
): Promise<void> {
  const missing = [...new Set(items.map((r) => r.ingredient_id).filter((id): id is string => !!id))]
    .filter((id) => !into.has(id));
  for (const part of chunks(missing)) {
    const { data, error } = await admin
      .from<Array<{ id: string; group_id: string | null }>>("ingredients")
      .select("id, group_id")
      .eq("account_id", accountId)
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const ing of data ?? []) into.set(ing.id, ing.group_id);
  }
}

/** Действующие правила аккаунта (кроме `exceptRuleId`) и дерево групп. */
async function loadActiveRulesAndGroups(admin: LooseDb, accountId: string, exceptRuleId?: string) {
  let rulesQuery = admin
    .from<ExclusionRuleRow[]>("inventory_result_exclusion_rules")
    .select("id, target_kind, ingredient_id, external_product_id, ingredient_group_id, product_name, reason, created_by, created_at")
    .eq("account_id", accountId)
    .eq("status", "active");
  if (exceptRuleId) rulesQuery = rulesQuery.neq("id", exceptRuleId);
  const [{ data: rules, error: rulesError }, { data: groups, error: groupsError }] = await Promise.all([
    rulesQuery,
    admin.from<GroupNode[]>("ingredient_groups").select("id, parent_group_id").eq("account_id", accountId),
  ]);
  if (rulesError) throw new Error(rulesError.message);
  if (groupsError) throw new Error(groupsError.message);
  return { rules: rules ?? [], groups: groups ?? [] };
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
 * Бизнес-месяц каждого акта (YYYY-MM-01) и множество защищённых актов, которые
 * ретро-проход не меняет:
 *   - месяц зафиксирован: есть зарплатный период заведения акта за этот месяц
 *     не в статусе черновика;
 *   - месяц раньше границы заведения «Исключения меняют акты начиная с»
 *     (venues.inventory_exclusions_from);
 *   - месяц не определить (нет заведения, нет даты, дата не читается,
 *     заведение не найдено) — защищаем: ни фиксацию, ни границу не проверить.
 */
async function resolveMonths(admin: LooseDb, accountId: string, documents: Map<string, DocumentRow>) {
  const venueIds = [...new Set([...documents.values()].map((d) => d.venue_id).filter((v): v is string => !!v))];
  const venueById = new Map<string, { timezone: string | null; inventory_exclusions_from: string | null }>();
  const lockedKeys = new Set<string>();
  for (const part of chunks(venueIds)) {
    const [venues, periods] = await Promise.all([
      admin
        .from<Array<{ id: string; timezone: string | null; inventory_exclusions_from: string | null }>>("venues")
        .select("id, timezone, inventory_exclusions_from")
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
    for (const v of venues.data ?? []) venueById.set(v.id, v);
    for (const p of periods.data ?? []) lockedKeys.add(`${p.venue_id}|${p.month.slice(0, 7)}-01`);
  }

  const monthByDocument = new Map<string, RetroMonth>();
  const locked = new Set<string>();
  for (const d of documents.values()) {
    const venue = d.venue_id ? venueById.get(d.venue_id) : undefined;
    if (!d.venue_id || !d.invoice_date || !venue) {
      locked.add(d.id);
      continue;
    }
    // Пояс не задан — берём пояс по умолчанию, а не пропускаем проверку фиксации.
    const tz = venue.timezone || DEFAULT_VENUE_TIMEZONE;
    let month: string;
    try {
      month = `${businessMonthOf(d.invoice_date, tz)}-01`;
    } catch {
      locked.add(d.id); // Месяц не определить — акт не трогаем.
      continue;
    }
    monthByDocument.set(d.id, { venueId: d.venue_id, month });
    if (lockedKeys.has(`${d.venue_id}|${month}`) || isProtectedMonth(month, venue.inventory_exclusions_from)) {
      locked.add(d.id);
    }
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

/**
 * Запись patch-ей. Три вида записи:
 *   - применение правила (`apply`): строка исключается этим правилом;
 *   - снятие (`remove`) без преемника: строка возвращается в итоги;
 *   - снятие с преемником (`transferTo`): строка остаётся исключённой,
 *     происхождение и причина — от правила-преемника.
 */
async function writePatches(input: {
  admin: LooseDb;
  accountId: string;
  rule: RuleRow;
  /** Правила-преемники для `transferTo`. */
  rulesById: Map<string, ExclusionRuleRow>;
  userId: string;
  patches: RetroPatch[];
  mode: "apply" | "remove";
  now: string;
  /**
   * Накопитель реально записанных строк: пополняется после каждой пачки, так
   * что при сбое следующей пачки вызывающий знает, что уже записано.
   */
  written: RetroPatch[];
}): Promise<void> {
  const { admin, accountId, rule, mode, written } = input;
  const byId = new Map(input.patches.map((p) => [p.id, p]));

  // Группы записи: (преемник или null) × подведённость.
  const groupsByKey = new Map<string, { transferTo: string | null; finalized: boolean; ids: string[] }>();
  for (const p of input.patches) {
    const transferTo = mode === "remove" ? (p.transferTo ?? null) : null;
    const key = `${transferTo ?? ""}|${p.finalized}`;
    const group = groupsByKey.get(key) ?? { transferTo, finalized: p.finalized, ids: [] };
    group.ids.push(p.id);
    groupsByKey.set(key, group);
  }

  for (const { transferTo, finalized, ids } of groupsByKey.values()) {
    const successor = transferTo ? input.rulesById.get(transferTo) : undefined;
    if (transferTo && !successor) throw new Error("Правило-преемник не найдено");
    const exclude = mode === "apply" || successor != null;
    const fields: Record<string, unknown> =
      mode === "apply"
        ? {
            excluded_from_totals: true,
            exclude_reason: rule.reason ?? DEFAULT_RULE_EXCLUDE_REASON,
            excluded_by: input.userId,
            excluded_at: input.now,
            exclusion_rule_id: rule.id,
          }
        : successor
          ? {
              excluded_from_totals: true,
              exclude_reason: successor.reason ?? DEFAULT_RULE_EXCLUDE_REASON,
              // Как при импорте (resolveExclusionState): автор и время — правила.
              excluded_by: successor.created_by,
              excluded_at: successor.created_at,
              exclusion_rule_id: successor.id,
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
      const base = () =>
        admin
          .from<Array<{ id: string }>>("document_items")
          .update(fields)
          .eq("account_id", accountId)
          .in("id", part);
      // Повторная проверка в самом UPDATE: человек мог отказаться от правила
      // или исключить строку вручную, пока мы читали. При снятии трогаем
      // только строки, которые всё ещё принадлежат снимаемому правилу.
      //
      // Для apply условие «строка не исключена ИЛИ исключена правилом» — это
      // два UPDATE, а не один с or(...): PostgREST 12 (прод) падает на UPDATE,
      // где or-фильтр ссылается на обновляемую колонку («column
      // document_items.excluded_from_totals does not exist»). Сначала строки
      // с правилом, потом неисключённые: после первого шага у тронутых строк
      // уже есть правило и excluded=true, второй шаг их не задевает.
      const queries =
        mode === "apply"
          ? [
              base().is("exclusion_rule_dismissed_at", null).not("exclusion_rule_id", "is", null),
              base().is("exclusion_rule_dismissed_at", null).eq("excluded_from_totals", false),
            ]
          : successor
            ? [base().eq("exclusion_rule_id", rule.id).is("exclusion_rule_dismissed_at", null)]
            : [base().eq("exclusion_rule_id", rule.id)];
      const seen = new Set<string>();
      for (const query of queries) {
        // Считаем только реально изменённые строки: проверка выше могла часть отсеять.
        const { data, error } = await query.select("id");
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          const patch = byId.get(row.id);
          if (patch) written.push(patch);
        }
      }
    }
  }
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
 * Применить правило ко всем актам незащищённых месяцев (`apply`) или снять его
 * оттуда (`remove`). Ручные решения по строке не перезаписываются, акты
 * защищённых месяцев (зафиксированных в зарплате или раньше границы заведения,
 * см. resolveMonths) не меняются.
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
  const empty: RetroResult = {
    touchedDocuments: 0,
    documentIds: [],
    months: [],
    notice: null,
    lockedDocumentIds: [],
    resortItemIds: [],
    clearedDocumentIds: [],
    transferredItems: [],
  };

  const { data: rule, error: ruleError } = await admin
    .from<RuleRow>("inventory_result_exclusion_rules")
    .select("id, target_kind, ingredient_id, external_product_id, ingredient_group_id, product_name, reason, created_by, created_at, status, metadata")
    .eq("id", input.ruleId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (ruleError) throw new Error(ruleError.message);
  if (!rule) throw new Error("Правило исключения не найдено");
  if (input.mode === "apply" && rule.status !== "active") return empty;

  // Победитель среди действующих правил: при применении — среди всех (строка
  // достаётся правилу, только если оно и есть победитель: правило на товар
  // сильнее правила группы, ближайшая группа сильнее дальней); при снятии —
  // среди оставшихся (без снимаемого): к нему переходит исключение строки.
  const { rules, groups } = await loadActiveRulesAndGroups(
    admin,
    accountId,
    input.mode === "remove" ? rule.id : undefined,
  );
  const rulesById = new Map(rules.map((r) => [r.id, r]));
  const matcher = buildExclusionMatcher(rules, groups);
  let items: ItemRow[];
  let groupIdByIngredientId: Map<string, string | null>;
  if (input.mode === "apply") {
    const candidates = await loadCandidateLines(admin, accountId, rule, groups);
    items = candidates.items;
    groupIdByIngredientId = candidates.groupIdByIngredientId;
  } else {
    const ruleId = rule.id;
    items = await fetchAll(() => itemsQuery(admin, accountId).eq("exclusion_rule_id", ruleId));
    groupIdByIngredientId = new Map();
    await loadIngredientGroups(admin, accountId, items, groupIdByIngredientId);
  }
  const winnerOf = (item: ItemRow) =>
    matcher({
      ingredientId: item.ingredient_id,
      externalProductId: item.external_product_id,
      groupId: item.ingredient_id ? groupIdByIngredientId.get(item.ingredient_id) ?? null : null,
    })?.id ?? null;
  if (input.mode === "apply") items = items.filter((item) => winnerOf(item) === rule.id);

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
    nextRuleId: input.mode === "remove" ? winnerOf(i) : null,
  }));
  const patches = input.mode === "apply" ? planApply(rule.id, lines, locked) : planRemove(rule.id, lines, locked);

  const now = new Date().toISOString();
  const ruleName = (id: string) => rulesById.get(id)?.product_name ?? "другое правило";

  // Удержание зависит только от утверждённого снимка — пересчитываем месяцы,
  // где он изменился. Если прошлое применение оборвалось (метки нет), снимок
  // части строк мог измениться без пересчёта — их месяцы тоже пересчитываем
  // (пересчёт идемпотентен, лишний ничего не портит).
  const monthsOf = (written: RetroPatch[]): RetroMonth[] => {
    const monthDocumentIds = written.filter((p) => p.snapshotChanged).map((p) => p.documentId);
    if (input.mode === "apply" && !rule.metadata?.retro_applied_at) {
      for (const line of settledFinalizedLines(rule.id, lines, locked)) monthDocumentIds.push(line.documentId);
    }
    const monthKeys = new Map<string, RetroMonth>();
    for (const documentId of monthDocumentIds) {
      const m = monthByDocument.get(documentId);
      if (m) monthKeys.set(`${m.venueId}|${m.month}`, m);
    }
    return [...monthKeys.values()];
  };

  // Запись → журнал → метка. Записанное уже не откатить: если что-то после
  // первой пачки упало, месяцы записанных строк всё равно пересчитываются (при
  // снятии повторный запуск эти строки не найдёт — они больше не ссылаются на
  // правило). Без пересчёта здесь (`recalculate: false`) месяцы уходят
  // вызывающему в RetroPartialFailure.
  const written: RetroPatch[] = [];
  type DocumentTally = { count: number; cleared: number; transferredTo: Map<string, number> };
  const linesByDocument = new Map<string, DocumentTally>();
  try {
    await writePatches({
      admin,
      accountId,
      rule,
      rulesById,
      userId: input.userId,
      patches,
      mode: input.mode,
      now,
      written,
    });

    // Журнал: одно событие на акт, по реально изменённым строкам. При снятии
    // отдельно считаем вернувшиеся в итоги и перешедшие к другому правилу.
    for (const p of written) {
      const t = linesByDocument.get(p.documentId) ?? { count: 0, cleared: 0, transferredTo: new Map() };
      t.count += 1;
      if (input.mode === "remove") {
        if (p.transferTo) t.transferredTo.set(p.transferTo, (t.transferredTo.get(p.transferTo) ?? 0) + 1);
        else t.cleared += 1;
      }
      linesByDocument.set(p.documentId, t);
    }
    const removeMessage = (t: DocumentTally) => {
      const parts: string[] = [];
      if (t.cleared > 0) parts.push(`позиции вернулись в итоги (строк: ${t.cleared})`);
      for (const [id, n] of t.transferredTo) parts.push(`исключение перешло к правилу «${ruleName(id)}» (строк: ${n})`);
      return `Правило «${rule.product_name}» удалено: ${parts.join("; ")}`;
    };
    const skip = new Set(input.skipEventDocumentIds ?? []);
    const events = [...linesByDocument]
      .filter(([documentId]) => !skip.has(documentId))
      .map(([documentId, t]) => ({
        account_id: accountId,
        document_id: documentId,
        document_item_id: null,
        resort_id: null,
        event_type: input.mode === "apply" ? "persistent_exclusion_enabled" : "persistent_exclusion_disabled",
        message:
          input.mode === "apply"
            ? `Правило «${rule.product_name}» исключило позиции из итогов (строк: ${t.count})`
            : removeMessage(t),
        payload:
          input.mode === "apply"
            ? { ruleId: rule.id, retro: true, lines: t.count }
            : {
                ruleId: rule.id,
                retro: true,
                lines: t.count,
                cleared: t.cleared,
                transferred: Object.fromEntries(t.transferredTo),
              },
        created_by: input.userId,
      }));
    for (const part of chunks(events)) {
      const { error } = await admin.from("inventory_result_events").insert(part);
      if (error) throw new Error(error.message);
    }

    // Метка успешного завершения: без неё правило считается не применённым
    // (или не снятым) до конца, и повторный запуск дочищает хвосты. Снятие не
    // завершено, пока строки правила остались в незащищённых актах (активный
    // пересорт, строка изменилась во время записи) — такое правило остаётся
    // в плашке до дочистки. Строки защищённых актов остаются на правиле
    // намеренно.
    const marker = input.mode === "apply" ? "retro_applied_at" : "retro_removed_at";
    const complete =
      input.mode === "apply" || removalComplete(rule.id, lines, locked, patches.length, written.length);
    if (complete) {
      const { error: markerError } = await admin
        .from("inventory_result_exclusion_rules")
        .update({ metadata: { ...(rule.metadata ?? {}), [marker]: now } })
        .eq("id", rule.id)
        .eq("account_id", accountId);
      if (markerError) throw new Error(markerError.message);
    }
  } catch (error) {
    const writtenDocumentIds = [...new Set(written.map((p) => p.documentId))];
    for (const documentId of writtenDocumentIds) revalidateInventoryResultPages(documentId);
    const months = monthsOf(written);
    const message = error instanceof Error ? error.message : String(error);
    let recalcNotice: string | null = null;
    if (input.recalculate !== false && months.length > 0) {
      try {
        recalcNotice = await recalculateRetroMonths(months);
      } catch (recalcError) {
        console.error("[exclusion-retro] пересчёт удержания после сбоя не выполнен", recalcError);
        recalcNotice = "Пересчитайте удержание по недостаче за изменённые месяцы вручную.";
      }
    }
    throw new RetroPartialFailure(
      recalcNotice ? `${message}. ${recalcNotice}` : message,
      // Пересчитанные здесь месяцы вызывающему не отдаём — второй пересчёт не нужен.
      { documentIds: writtenDocumentIds, months: input.recalculate === false ? months : [] },
      { cause: error },
    );
  }

  const documentIds = [...linesByDocument.keys()];
  for (const documentId of documentIds) revalidateInventoryResultPages(documentId);

  const months = monthsOf(written);
  const notice = input.recalculate === false ? null : await recalculateRetroMonths(months);
  return {
    touchedDocuments: documentIds.length,
    documentIds,
    months,
    notice,
    lockedDocumentIds: [...new Set(items.map((i) => i.document_id).filter((id) => locked.has(id)))],
    resortItemIds: lines.filter((l) => l.inActiveResort).map((l) => l.id),
    clearedDocumentIds: [...linesByDocument].filter(([, t]) => t.cleared > 0).map(([id]) => id),
    transferredItems: written
      .filter((p) => input.mode === "remove" && p.transferTo)
      .map((p) => ({
        id: p.id,
        documentId: p.documentId,
        ruleId: p.transferTo as string,
        ruleName: ruleName(p.transferTo as string),
      })),
  };
}

/**
 * Незавершённые удаления: удалённые правила на товар/группу без отметки
 * metadata.retro_removed_at, на которые ещё ссылаются строки незащищённых
 * актов (снятие оборвалось или строки были в активном пересорте). Остальные
 * удалённые правила (строк нет или все — в защищённых актах: зафиксированный
 * месяц, раньше границы заведения, архивный акт) получают отметку сразу:
 * снимать больше нечего, и больше они не проверяются.
 */
export async function loadPendingRemovalRuleIds(admin: LooseDb, accountId: string): Promise<string[]> {
  const rules = await fetchAll(() =>
    admin
      .from<Array<{ id: string; metadata: Record<string, unknown> | null }>>("inventory_result_exclusion_rules")
      .select("id, metadata")
      .eq("account_id", accountId)
      .eq("status", "deleted")
      .in("target_kind", ["product", "group"])
      .is("metadata->>retro_removed_at", null),
  );
  if (rules.length === 0) return [];

  const lines: Array<{ ruleId: string; documentId: string }> = [];
  for (const part of chunks(rules.map((r) => r.id))) {
    const rows = await fetchAll(() =>
      admin
        .from<Array<{ id: string; document_id: string; exclusion_rule_id: string }>>("document_items")
        .select("id, document_id, exclusion_rule_id")
        .eq("account_id", accountId)
        .in("exclusion_rule_id", part),
    );
    for (const r of rows) lines.push({ ruleId: r.exclusion_rule_id, documentId: r.document_id });
  }
  const documents = await loadDocuments(admin, accountId, [...new Set(lines.map((l) => l.documentId))]);
  const { locked } = await resolveMonths(admin, accountId, documents);
  const unprotected = new Set([...documents.keys()].filter((id) => !locked.has(id)));
  const { pending, done } = partitionPendingRemovals(
    rules.map((r) => r.id),
    lines,
    unprotected,
  );

  // Метка — в metadata, которая у каждого правила своя (источник, время
  // применения), поэтому одним UPDATE на все правила её не поставить: правила
  // с одинаковой metadata обновляются одним запросом, группы — параллельно.
  const now = new Date().toISOString();
  const doneSet = new Set(done);
  const byMetadata = new Map<string, { metadata: Record<string, unknown>; ids: string[] }>();
  for (const r of rules) {
    if (!doneSet.has(r.id)) continue;
    const metadata: Record<string, unknown> = { ...(r.metadata ?? {}), retro_removed_at: now };
    const key = JSON.stringify(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)));
    const group = byMetadata.get(key) ?? { metadata, ids: [] as string[] };
    group.ids.push(r.id);
    byMetadata.set(key, group);
  }
  const stampGroups = [...byMetadata.values()].flatMap((g) => chunks(g.ids).map((ids) => ({ metadata: g.metadata, ids })));
  for (const batch of chunks(stampGroups, STAMP_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map((g) =>
        admin
          .from("inventory_result_exclusion_rules")
          .update({ metadata: g.metadata })
          .eq("account_id", accountId)
          .eq("status", "deleted")
          .in("id", g.ids),
      ),
    );
    for (const { error } of results) if (error) throw new Error(error.message);
  }
  return pending;
}

/**
 * Несколько правил подряд с одним пересчётом удержания в конце. Сбой одного
 * правила не обрывает остальные и не отменяет пересчёт месяцев, изменённых
 * успешными правилами; упавшие правила остаются необработанными (без метки), а
 * их ошибки попадают в пояснение.
 *
 * `ruleIds` обрабатываются в режиме `mode`; `removeRuleIds` (необязательно) —
 * всегда в режиме снятия, тем же проходом (дочистка незавершённых удалений).
 */
export async function applyExclusionRulesRetro(input: {
  admin: LooseDb;
  accountId: string;
  userId: string;
  ruleIds: string[];
  mode: "apply" | "remove";
  removeRuleIds?: string[];
  skipEventDocumentIds?: string[];
}): Promise<RetroResult & { failedRuleIds: string[] }> {
  const lockedDocumentIds = new Set<string>();
  const resortItemIds = new Set<string>();
  const clearedDocumentIds = new Set<string>();
  const transferredItems: RetroResult["transferredItems"] = [];
  const modeOf = new Map<string, "apply" | "remove">();
  for (const id of input.ruleIds) modeOf.set(id, input.mode);
  for (const id of input.removeRuleIds ?? []) modeOf.set(id, "remove");
  const { documentIds, months, failures } = await runRulesIsolated([...modeOf.keys()], async (ruleId) => {
    const r = await applyExclusionRuleRetro({
      admin: input.admin,
      accountId: input.accountId,
      userId: input.userId,
      skipEventDocumentIds: input.skipEventDocumentIds,
      ruleId,
      mode: modeOf.get(ruleId) ?? input.mode,
      recalculate: false,
    });
    for (const id of r.lockedDocumentIds) lockedDocumentIds.add(id);
    for (const id of r.resortItemIds) resortItemIds.add(id);
    for (const id of r.clearedDocumentIds) clearedDocumentIds.add(id);
    transferredItems.push(...r.transferredItems);
    return r;
  });
  for (const f of failures) {
    console.error(`[exclusion-retro] правило ${f.ruleId} не обработано`, f.message);
  }
  const recalcNotice = await recalculateRetroMonths(months);
  const failureNotice = (mode: "apply" | "remove") => {
    const list = failures.filter((f) => modeOf.get(f.ruleId) === mode);
    if (list.length === 0) return null;
    return `${mode === "apply" ? "Не применены к прошлым актам" : "Не сняты в прошлых актах"} правила (${list.length}): ${[...new Set(list.map((f) => f.message))].join("; ")}. Они остались в плашке списка исключений заведения — нажмите там «Применить» ещё раз.`;
  };
  return {
    touchedDocuments: documentIds.length,
    documentIds,
    months,
    notice: [failureNotice("apply"), failureNotice("remove"), recalcNotice].filter(Boolean).join(" ") || null,
    lockedDocumentIds: [...lockedDocumentIds],
    resortItemIds: [...resortItemIds],
    clearedDocumentIds: [...clearedDocumentIds],
    transferredItems,
    failedRuleIds: failures.map((f) => f.ruleId),
  };
}
