import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { getKbRequiredUnreadForUser } from "@/lib/knowledge/landing";

/**
 * Обязательное чтение текущего пользователя для пункта «К прочтению» в
 * дереве: сколько обязательных страниц в аккаунте и сколько из них он
 * ещё не прочитал. `cache` — дерево на компьютере и в панели телефона
 * рендерятся в одном проходе и делят запрос.
 *
 * Отдельным модулем, а не в `landing.ts`: тот — "use server" и может
 * экспортировать только асинхронные функции, не `cache(...)`.
 */
export const getKbRequiredReadingSummary = cache(
  async (): Promise<{ total: number; unread: number }> => {
    const supabase = await createClient();
    const [countRes, { rows }] = await Promise.all([
      supabase
        .from("kb_pages")
        .select("id", { count: "exact", head: true })
        .eq("required_reading", true)
        .is("deleted_at", null),
      getKbRequiredUnreadForUser(),
    ]);
    return { total: countRes.count ?? 0, unread: rows.length };
  },
);
