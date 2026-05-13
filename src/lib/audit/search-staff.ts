"use server";

import { createClient } from "@/lib/supabase/server";

export interface AuditStaffOption {
  id: string;
  name: string;
  avatar_url: string | null;
}

/** Глобальный поиск по сущностям, которые могут попасть в общий журнал.
 *  Резолвит подстроку `q` в массивы entity_id для staff и kb_page.
 *  Если q пуст — оба массива пустые.
 *
 *  RLS на profiles/kb_pages enforce'ит видимость только в активном
 *  аккаунте. Лимит 200 на тип — fence от рантайм-стоимости. */
export async function searchAuditEntities(q: string): Promise<{
  staffIds: string[];
  kbPageIds: string[];
}> {
  const term = q.trim();
  if (term.length === 0) return { staffIds: [], kbPageIds: [] };

  const supabase = await createClient();
  const pattern = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const [staffResult, kbResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
      .limit(200),
    supabase
      .from("kb_pages")
      .select("id")
      .ilike("title", pattern)
      .limit(200),
  ]);

  const staffIds = (staffResult.data ?? []).map((r) => r.id as string);
  const kbPageIds = (kbResult.data ?? []).map((r) => r.id as string);
  return { staffIds, kbPageIds };
}

/** Список сотрудников активного аккаунта для выпадашки фильтра.
 *  Источник — `user_venue_roles` в venues текущего аккаунта (через
 *  RLS). Включает активных и уволенных — журнал может показывать
 *  события и тех, кто уже не работает.
 *
 *  Возвращает упорядоченный по имени список без дубликатов (один
 *  юзер может иметь несколько UVR-строк в разных venue). */
export async function listAccountStaff(): Promise<AuditStaffOption[]> {
  const supabase = await createClient();
  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (!accountId) return [];

  // venues этого аккаунта — для фильтра по venue_id в UVR.
  const { data: venueRows } = await supabase
    .from("venues")
    .select("id")
    .eq("account_id", accountId as string);
  const venueIds = (venueRows ?? []).map((v) => v.id as string);
  if (venueIds.length === 0) return [];

  // Шаг 1: все user_id с UVR в любом venue этого аккаунта.
  const { data: uvrRows, error: uvrError } = await supabase
    .from("user_venue_roles")
    .select("user_id")
    .in("venue_id", venueIds);
  if (uvrError || !uvrRows || uvrRows.length === 0) return [];

  const userIds = Array.from(
    new Set(uvrRows.map((r) => r.user_id as string)),
  );

  // Шаг 2: подтянуть профили этих user_id одним батчем.
  const { data: profileRows, error: profilesError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .in("id", userIds);
  if (profilesError || !profileRows) return [];

  return profileRows
    .map((p) => {
      const name =
        [p.first_name as string | null, p.last_name as string | null]
          .filter(Boolean)
          .join(" ")
          .trim() || "Без имени";
      return {
        id: p.id as string,
        name,
        avatar_url: (p.avatar_url as string | null) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
