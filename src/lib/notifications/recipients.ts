import "server-only";
import type { LooseDb } from "@/lib/supabase/loose";

/** Кому уведомление: активные сотрудники заведения, у чьей должности есть одно из прав. */
export async function permissionRecipients(admin: LooseDb, venueId: string, codes: string[]): Promise<string[]> {
  const perm = await admin.from<Array<{ id: string }>>("permissions").select("id").in("code", codes);
  if (perm.error) throw new Error(perm.error.message);
  const ids = (perm.data ?? []).map((p) => p.id);
  if (!ids.length) return [];
  const granted = await admin
    .from<Array<{ role_id: string }>>("role_permissions")
    .select("role_id")
    .in("permission_id", ids)
    .eq("granted", true);
  if (granted.error) throw new Error(granted.error.message);
  const roles = [...new Set((granted.data ?? []).map((r) => r.role_id))];
  if (!roles.length) return [];
  const members = await admin
    .from<Array<{ user_id: string }>>("user_venue_roles")
    .select("user_id")
    .eq("venue_id", venueId)
    .eq("status", "active")
    .is("fired_at", null)
    .in("role_id", roles);
  if (members.error) throw new Error(members.error.message);
  return [...new Set((members.data ?? []).map((m) => m.user_id))];
}
