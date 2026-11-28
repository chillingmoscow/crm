import "server-only";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";

/**
 * Кто может загружать проведённые акты склада: владелец активного аккаунта с
 * правом «Проводить итоги» (`inventory.finalize_results`). Загрузка фиксирует
 * итоги актов, а значит, удержание из зарплаты, — поэтому и то и другое.
 * null — доступа нет (страница отвечает notFound, экшены — отказом).
 */
export async function getStoreActsImportAccess(): Promise<{ userId: string; accountId: string } | null> {
  const user = await getCachedUser();
  if (!user) return null;
  const accountId = await getCachedActiveAccountId();
  if (!accountId) return null;
  const supabase = await createClient();
  const [{ data: isOwner }, can] = await Promise.all([
    supabase.rpc("is_account_owner", { p_account_id: accountId }),
    getCachedPermissionChecker(),
  ]);
  if (isOwner !== true || !can("inventory.finalize_results")) return null;
  return { userId: user.id, accountId };
}
