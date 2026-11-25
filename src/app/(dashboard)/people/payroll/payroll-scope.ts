import "server-only";
import {
  createClient,
  getCachedPermissions,
  getCachedActiveAccountId,
  getCachedUser,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";

/** Пользователь, аккаунт, заведение и клиенты для действий «Зарплаты». */
export async function payrollScope(permission?: string) {
  const client = await createClient();
  const [user, permissions, accountId, venue] = await Promise.all([
    getCachedUser(),
    getCachedPermissions(),
    getCachedActiveAccountId(),
    client.rpc("get_active_venue_id"),
  ]);
  if (!user) throw new Error("Войдите в аккаунт");
  if (!accountId || !venue.data) throw new Error("Выберите заведение");
  if (permission && !permissions.includes(permission))
    throw new Error("Нет доступа к этому действию");
  return {
    client,
    db: asLooseDb(client),
    admin: asLooseDb(createAdminClient()),
    accountId,
    venueId: venue.data as string,
    user,
    permissions,
  };
}
export type PayrollScope = Awaited<ReturnType<typeof payrollScope>>;
