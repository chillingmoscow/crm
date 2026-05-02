"use server";

import { createClient } from "@/lib/supabase/server";

export type KbMentionPage = {
  kind: "page";
  id: string;
  slug: string;
  title: string;
  icon: string | null;
};

export type KbMentionPerson = {
  kind: "person";
  id: string;
  full_name: string;
};

export type KbMention = KbMentionPage | KbMentionPerson;

/**
 * @-mention search: страницы (через kb_search) + сотрудники активного
 * account (через kb_list_account_members RPC). Объединённый список с
 * жёсткими лимитами (по 8 на тип) — внутри SuggestionMenuController
 * мы группируем результаты по виду.
 *
 * Авторизация: оба источника гейтятся `kb.view_pages` (RLS / RPC),
 * так что лишних разрешений на people.* не требуется.
 */
export async function searchKbMentions(
  query: string,
): Promise<{ items: KbMention[]; error: string | null }> {
  const supabase = await createClient();
  const trimmed = (query ?? "").trim();

  // Параллельно: страницы (FTS) + члены аккаунта (substring LIKE).
  // Если query пустой — kb_search возвращает 0 (FTS не любит пустоту),
  // а kb_list_account_members отдаст «всех», лимит 8.
  const [pagesRes, peopleRes] = await Promise.all([
    trimmed.length > 0
      ? supabase.rpc("kb_search", { p_query: trimmed, p_limit: 8 })
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("kb_list_account_members", {
      p_query: trimmed,
      p_limit: 8,
    }),
  ]);

  if (pagesRes.error) {
    return { items: [], error: pagesRes.error.message };
  }
  if (peopleRes.error) {
    return { items: [], error: peopleRes.error.message };
  }

  const pages: KbMention[] = ((pagesRes.data ?? []) as Array<{
    id: string;
    slug: string;
    title: string;
    icon: string | null;
  }>).map((p) => ({
    kind: "page" as const,
    id: p.id,
    slug: p.slug,
    title: p.title || "Без названия",
    icon: p.icon,
  }));

  const people: KbMention[] = ((peopleRes.data ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
  }>).map((u) => {
    const parts = [u.first_name, u.last_name].filter(Boolean) as string[];
    return {
      kind: "person" as const,
      id: u.id,
      full_name: parts.length > 0 ? parts.join(" ") : "Без имени",
    };
  });

  return { items: [...pages, ...people], error: null };
}
