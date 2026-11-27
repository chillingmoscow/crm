"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/actions/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { loadShiftHeatmap, type ShiftHeatmapData } from "@/lib/people/staff-card-stats";

/**
 * Тепловая карта смен сотрудника за год (вкладка «Активность» карточки).
 * Та же проверка, что у карточки (`people.view_staff` + детали), плюс право
 * на график или на зарплату: без обоих данных нет.
 */
export async function getStaffShiftHeatmap(
  userId: string,
): Promise<ActionResult<ShiftHeatmapData | null>> {
  return actionResult(async () => {
    z.string().uuid().parse(userId);
    const supabase = await createClient();
    const [user, can, venue] = await Promise.all([
      getCachedUser(),
      getCachedPermissionChecker(),
      supabase.rpc("get_active_venue_id"),
    ]);
    if (!user) throw new Error("Войдите в аккаунт");
    if (!can("people.view_staff") || !can("people.view_staff_details"))
      throw new Error("Нет доступа к карточке сотрудника");
    const venueId = venue.data as string | null;
    if (!venueId) throw new Error("Выберите заведение");
    const canViewSchedule = can("schedule.view_all");
    const canViewPayroll = can("payroll.view");
    if (!canViewSchedule && !canViewPayroll) return null;
    const admin = asLooseDb(createAdminClient());
    // Сотрудник должен быть в этом заведении — иначе по id читались бы чужие смены.
    const [member, settings] = await Promise.all([
      admin
        .from<{ id: string }>("user_venue_roles")
        .select("id")
        .eq("venue_id", venueId)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle(),
      admin
        .from<{ timezone: string; day_start_hour: number }>("sales_settings")
        .select("timezone, day_start_hour")
        .eq("venue_id", venueId)
        .maybeSingle(),
    ]);
    if (!member.data) throw new Error("Сотрудник не найден");
    return loadShiftHeatmap({
      venueId,
      userId,
      clock: {
        timezone: settings.data?.timezone ?? "Europe/Moscow",
        dayStartHour: settings.data?.day_start_hour ?? 9,
      },
      canViewSchedule,
      canViewPayroll,
    });
  }, "Не удалось загрузить смены сотрудника");
}
