"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { KbPageRow } from "@/types/knowledge";

export type KbFavoritePage = Pick<
  KbPageRow,
  "id" | "slug" | "title" | "icon" | "icon_color"
>;

/** Список избранных страниц текущего юзера в активном account.
 *  Сортировка — последние добавленные сверху (created_at desc).
 *  RLS отфильтровывает чужие записи (см. миграцию 066). */
export async function listMyKbFavorites(): Promise<{
  pages: KbFavoritePage[];
  error: string | null;
}> {
  const supabase = await createClient();
  // Two-step: сначала избранное user'а, потом подтягиваем page-данные.
  // Embedded select через PostgREST мог бы это в один RPC-call, но
  // тогда нужен FK-имя для embedded join — и нам ещё фильтр по
  // deleted_at для самих pages.
  const { data: favRows, error: favErr } = await supabase
    .from("kb_user_favorites")
    .select("page_id, created_at")
    .order("created_at", { ascending: false });
  if (favErr) return { pages: [], error: favErr.message };
  if (!favRows || favRows.length === 0) return { pages: [], error: null };

  const ids = favRows.map((r) => r.page_id);
  const { data: pages, error: pagesErr } = await supabase
    .from("kb_pages")
    .select("id, slug, title, icon, icon_color")
    .in("id", ids)
    .is("deleted_at", null);
  if (pagesErr) return { pages: [], error: pagesErr.message };

  // Восстанавливаем порядок по favRows (DB JOIN потерял ORDER BY).
  const byId = new Map((pages ?? []).map((p) => [p.id, p]));
  const ordered = favRows
    .map((r) => byId.get(r.page_id))
    .filter((p): p is KbFavoritePage => p != null);
  return { pages: ordered, error: null };
}

/** Добавляет страницу в избранное текущего юзера. */
export async function addKbFavorite(
  pageId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (!accountId) return { error: "Нет активного account" };

  const { error } = await supabase.from("kb_user_favorites").insert({
    user_id: user.id,
    page_id: pageId,
    account_id: accountId as unknown as string,
  });
  // 23505 = unique_violation: уже в избранном — silently OK.
  if (error && error.code !== "23505") return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}

/** Убирает страницу из избранного. */
export async function removeKbFavorite(
  pageId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("kb_user_favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("page_id", pageId);
  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}

/** Простая проверка: страница в избранном у текущего юзера? */
export async function isKbPageFavorited(
  pageId: string,
): Promise<{ favorited: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { favorited: false };
  const { data } = await supabase
    .from("kb_user_favorites")
    .select("page_id")
    .eq("user_id", user.id)
    .eq("page_id", pageId)
    .maybeSingle();
  return { favorited: data != null };
}
