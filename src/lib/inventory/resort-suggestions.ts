/**
 * Чистая логика подсказок пересорта (history-эвристика + парсинг AI-ответа).
 * Вынесена из results/page.tsx, чтобы:
 *   - не держать ~бизнес-логику в файле страницы (CLAUDE.md),
 *   - покрыть unit-тестами (resort-suggestions.test.mts).
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать напрямую
 * (тест-раннер не резолвит alias из tsconfig — см. act-status.ts).
 * Сетевой вызов DeepSeek живёт в server-обёртке (resort-ai-suggestions.ts).
 */

export type ResortSuggestionSource = "history" | "ai";

export type ResortSuggestion = {
  key: string;
  itemIds: string[];
  title: string;
  reason: string;
  confidence: number;
  source: ResortSuggestionSource;
};

/** Минимум полей строки итогов, нужный для history-эвристики. */
export type SuggestionSourceItem = {
  id: string;
  ingredient_id: string | null;
  product_name: string;
  difference_amount: number | null;
  excluded_from_totals?: boolean | null;
};

export type HistoryResortRow = {
  id: string;
  document_id: string;
  reason: string;
  created_at: string;
};

export type HistoryResortItemRow = {
  resort_id: string;
  ingredient_id: string | null;
  document_item_id: string;
  role: "shortage" | "surplus";
  product_name: string;
};

export function resortSuggestionKey(itemIds: string[]) {
  return Array.from(new Set(itemIds)).sort().join(":");
}

export function clampConfidence(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0.1, Math.min(0.95, value));
}

export function eventPayload(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * History-эвристика: предлагаем пересорт по парам, которые уже встречались
 * вместе в активных пересортах прошлых актов и сейчас имеют недостачу+излишек.
 */
export function buildHistorySuggestions(input: {
  currentItems: SuggestionSourceItem[];
  activeResortItemIds: Set<string>;
  historyResorts: HistoryResortRow[];
  historyItems: HistoryResortItemRow[];
}): ResortSuggestion[] {
  const currentByLocalProductId = new Map<string, SuggestionSourceItem>();
  for (const item of input.currentItems) {
    const productId = item.ingredient_id;
    const amount = Number(item.difference_amount ?? 0);
    if (!productId || amount === 0 || item.excluded_from_totals || input.activeResortItemIds.has(item.id)) continue;
    currentByLocalProductId.set(productId, item);
  }

  const resortById = new Map(input.historyResorts.map((resort) => [resort.id, resort]));
  const itemsByResortId = new Map<string, HistoryResortItemRow[]>();
  for (const item of input.historyItems) {
    const rows = itemsByResortId.get(item.resort_id) ?? [];
    rows.push(item);
    itemsByResortId.set(item.resort_id, rows);
  }

  const suggestions = new Map<string, ResortSuggestion & { hits: number }>();
  for (const [resortId, historyItems] of itemsByResortId) {
    const matched = historyItems
      .map((historyItem) => (historyItem.ingredient_id ? currentByLocalProductId.get(historyItem.ingredient_id) ?? null : null))
      .filter((item): item is SuggestionSourceItem => Boolean(item));
    const uniqueMatched = Array.from(new Map(matched.map((item) => [item.id, item])).values());
    if (uniqueMatched.length < 2) continue;
    const hasShortage = uniqueMatched.some((item) => Number(item.difference_amount ?? 0) < 0);
    const hasSurplus = uniqueMatched.some((item) => Number(item.difference_amount ?? 0) > 0);
    if (!hasShortage || !hasSurplus) continue;

    const key = resortSuggestionKey(uniqueMatched.map((item) => item.id));
    const existing = suggestions.get(key);
    if (existing) {
      existing.hits += 1;
      existing.confidence = Math.min(0.95, existing.confidence + 0.08);
      continue;
    }
    const historyResort = resortById.get(resortId);
    suggestions.set(key, {
      key,
      itemIds: uniqueMatched.map((item) => item.id),
      title: uniqueMatched.map((item) => item.product_name).join(" + "),
      reason: historyResort?.reason
        ? `Похожий пересорт уже делали: ${historyResort.reason}`
        : "Похожий пересорт уже делали в прошлых актах",
      confidence: 0.7,
      source: "history",
      hits: 1,
    });
  }

  return Array.from(suggestions.values())
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5)
    .map(({ key, itemIds, title, reason, confidence, source }) => ({ key, itemIds, title, reason, confidence, source }));
}
