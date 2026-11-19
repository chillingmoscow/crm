import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { StaffStackMember } from "@/components/people/staff-stack-cell";

type Client = Awaited<ReturnType<typeof createClient>>;

const collator = new Intl.Collator("ru", { sensitivity: "base" });

/**
 * Активные сотрудники заведения по должностям, по алфавиту — для столбца
 * «Сотрудники» в списках должностей и подразделений. Человек без доступного
 * профиля всё равно считается: имя заменяется на «Без имени».
 */
export async function loadVenueStaffByRole(
  supabase: Client,
  venueId: string | null,
): Promise<Record<string, StaffStackMember[]>> {
  if (!venueId) return {};
  const { data: memberships } = await supabase
    .from("user_venue_roles")
    .select("role_id, user_id")
    .eq("venue_id", venueId)
    .eq("status", "active");
  const rows = memberships ?? [];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  if (userIds.length === 0) return {};

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .in("id", userIds);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const byRole: Record<string, StaffStackMember[]> = {};
  for (const row of rows) {
    const p = profileById.get(row.user_id);
    const name =
      [p?.first_name, p?.last_name].filter((x) => x?.trim()).join(" ") ||
      "Без имени";
    (byRole[row.role_id] ??= []).push({
      id: row.user_id,
      name,
      avatarUrl: p?.avatar_url ?? null,
    });
  }
  for (const list of Object.values(byRole))
    list.sort((a, b) => collator.compare(a.name, b.name));
  return byRole;
}
