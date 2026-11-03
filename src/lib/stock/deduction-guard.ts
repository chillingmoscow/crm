/**
 * Принадлежность заведения аккаунту сессии.
 *
 * Действие, пишущее деньги в ведомость, берёт `venueId` от вызывающего. Право
 * "есть роль в этом заведении" (can_post_inventory_deduction) этого не гарантирует:
 * у пользователя могут быть роли в заведениях двух аккаунтов, и заведение вне активного
 * аккаунта пройдёт проверку права. Поэтому принадлежность проверяется явно и ДО того,
 * как что-либо читается или строится, а не держится на том, что чужая пара
 * "аккаунт - заведение" случайно не найдёт строку правил.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

import type { LooseDb } from "../supabase/loose.ts";

export const VENUE_OUTSIDE_ACCOUNT = "Заведение не относится к вашему аккаунту";

export async function venueBelongsToAccount(
  db: LooseDb,
  accountId: string,
  venueId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from<{ id: string; account_id: string }>("venues")
    .select("id, account_id")
    .eq("id", venueId)
    .eq("account_id", accountId)
    .maybeSingle();
  // Ошибка чтения - не "да": при сомнении отказ.
  if (error || !data) return false;
  // Серверный клиент не ограничен RLS, поэтому сверяем и ответ, а не только фильтр запроса.
  return data.id === venueId && data.account_id === accountId;
}

/** Бросает, если заведение чужое (или не найдено). */
export async function assertVenueInAccount(
  db: LooseDb,
  accountId: string,
  venueId: string,
): Promise<void> {
  if (!(await venueBelongsToAccount(db, accountId, venueId))) throw new Error(VENUE_OUTSIDE_ACCOUNT);
}
