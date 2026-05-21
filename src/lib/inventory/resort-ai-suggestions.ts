import "server-only";

import { getDeepseekClient, DEEPSEEK_MODELS } from "@/lib/ai/deepseek-client";

import {
  clampConfidence,
  resortSuggestionKey,
  type ResortSuggestion,
} from "./resort-suggestions";

/** Минимум полей строки итогов, нужный AI-подсказке (группа + ед.изм. + разница). */
export type AiSuggestionSourceItem = {
  id: string;
  product_name: string;
  group_id: string | null;
  group_name: string | null;
  measure_unit_id: number | null;
  measure_unit_name: string | null;
  difference_amount: number | null;
  difference_sum: number | null;
  excluded_from_totals?: boolean | null;
};

/**
 * AI-подсказки пересорта через DeepSeek. Сетевой best-effort: при выключенном
 * флаге / отсутствии ключа / ошибке — пустой массив (без throw). Чистый
 * парсинг/валидация и ключи — из resort-suggestions.
 */
export async function buildAiSuggestions(input: {
  enabled: boolean;
  currentItems: AiSuggestionSourceItem[];
  activeResortItemIds: Set<string>;
}): Promise<ResortSuggestion[]> {
  if (!input.enabled || !process.env.DEEPSEEK_API_KEY) return [];

  const candidates = input.currentItems
    .filter((item) => {
      const amount = Number(item.difference_amount ?? 0);
      return amount !== 0 && !item.excluded_from_totals && !input.activeResortItemIds.has(item.id);
    })
    .map((item) => ({
      id: item.id,
      name: item.product_name,
      groupId: item.group_id,
      groupName: item.group_name,
      measureUnitId: item.measure_unit_id,
      measureUnitName: item.measure_unit_name,
      differenceAmount: Number(item.difference_amount ?? 0),
      differenceSum: Number(item.difference_sum ?? 0),
    }));

  if (candidates.length < 2) return [];
  if (!candidates.some((item) => item.differenceAmount > 0) || !candidates.some((item) => item.differenceAmount < 0)) {
    return [];
  }

  try {
    const client = getDeepseekClient();
    const response = await client.chat.completions.create({
      model: DEEPSEEK_MODELS.chat,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты помогаешь найти кандидатов пересорта в инвентаризации ресторана. Возвращай только JSON вида {\"suggestions\":[{\"itemIds\":[\"id\"],\"reason\":\"...\",\"confidence\":0.8}]}. Не предлагай позиции из разных групп или с разными единицами измерения. В каждой подсказке должны быть строки с плюсом и минусом.",
        },
        {
          role: "user",
          content: JSON.stringify({
            rules: {
              sameGroup: true,
              sameMeasureUnit: true,
              requiresSurplusAndShortage: true,
              maxSuggestions: 5,
            },
            items: candidates,
          }),
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { suggestions?: Array<{ itemIds?: unknown; reason?: unknown; confidence?: unknown }> };
    const byId = new Map(candidates.map((item) => [item.id, item]));
    const suggestions: ResortSuggestion[] = [];
    const seen = new Set<string>();

    for (const suggestion of parsed.suggestions ?? []) {
      if (!Array.isArray(suggestion.itemIds)) continue;
      const itemIds = suggestion.itemIds
        .filter((itemId): itemId is string => typeof itemId === "string" && byId.has(itemId));
      const uniqueIds = Array.from(new Set(itemIds));
      if (uniqueIds.length < 2) continue;

      const rows = uniqueIds.map((itemId) => byId.get(itemId)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (!rows.some((item) => item.differenceAmount > 0) || !rows.some((item) => item.differenceAmount < 0)) continue;
      if (new Set(rows.map((item) => item.groupId ?? item.groupName ?? "ungrouped")).size !== 1) continue;
      if (new Set(rows.map((item) => item.measureUnitId ?? item.measureUnitName ?? "unit")).size !== 1) continue;

      const key = resortSuggestionKey(uniqueIds);
      if (seen.has(key)) continue;
      seen.add(key);

      const reason = typeof suggestion.reason === "string" && suggestion.reason.trim()
        ? suggestion.reason.trim()
        : "AI нашел похожие названия и противоположные расхождения";
      suggestions.push({
        key,
        itemIds: uniqueIds,
        title: rows.map((item) => item.name).join(" + "),
        reason,
        confidence: clampConfidence(suggestion.confidence, 0.65),
        source: "ai",
      });
    }

    return suggestions.sort((left, right) => right.confidence - left.confidence).slice(0, 5);
  } catch (error) {
    console.error("Failed to build inventory AI resort suggestions", error);
    return [];
  }
}
