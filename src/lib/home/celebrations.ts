import "server-only";

import { asLooseDb } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

import { getHomeContext } from "./context";
import { weekCelebrations, weekOf, type Celebration } from "./today";

/**
 * Дата рождения и дата трудоустройства коллег — персональные данные. С
 * миграции 360 `birth_date` в `profiles` пользовательскому клиенту не
 * отдаётся, а `get_venue_staff` (359) отдаёт обе даты только тем, у кого в
 * активном заведении есть `people.view_staff` и `people.view_staff_details`.
 * Поэтому блок — только при этих правах, и даты читаются этой функцией, а не
 * admin-клиентом: проверку прав делает база, а не только страница.
 */
export function canSeeCelebrations(permissions: Set<string>): boolean {
  return permissions.has("people.view_staff") && permissions.has("people.view_staff_details");
}

type StaffRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  role_name: string | null;
  birth_date: string | null;
  employment_date: string | null;
};

/** Дни рождения и годовщины работы команды на текущей неделе. */
export async function loadWeekCelebrations(): Promise<{ week: { from: string; to: string }; today: string; items: Celebration[] } | null> {
  const ctx = await getHomeContext();
  if (!ctx || !canSeeCelebrations(ctx.permissions)) return null;
  const db = asLooseDb(await createClient());
  const { data, error } = await db.rpc("get_venue_staff", { p_venue_id: ctx.venueId });
  if (error) throw new Error(error.message);
  const week = weekOf(ctx.calendarDay);
  // Строка на каждую должность: человек с двумя должностями пришёл бы дважды.
  const unique = new Map(((data as StaffRow[] | null) ?? []).map((s) => [s.user_id, s]));
  const people = [...unique.values()].map((s) => ({
    userId: s.user_id,
    name: [s.first_name, s.last_name].filter(Boolean).join(" ") || "Сотрудник",
    avatarUrl: s.avatar_url,
    role: s.role_name,
    birthDate: s.birth_date,
    employmentDate: s.employment_date,
  }));
  return { week, today: ctx.calendarDay, items: weekCelebrations(people, week) };
}
