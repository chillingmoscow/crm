"use server";
import { z } from "zod";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissions,
  getCachedUser,
} from "@/lib/supabase/server";
import { actionResult } from "@/lib/actions/result";
import { writeAuditEvent } from "@/lib/audit/write";
import { planWrite, type SalesPlan } from "@/lib/sales/plan";

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

/** План задаётся для активного заведения: так же читают и проверяют права политики таблицы. */
async function scope(venueId: string, permission: string) {
  z.string().uuid().parse(venueId);
  // Всё независимо — одной волной; пользователь — из кэша запроса.
  const db = await createClient();
  const [user, permissions, accountId, venue] = await Promise.all([
    getCachedUser(),
    getCachedPermissions(),
    getCachedActiveAccountId(),
    db.rpc("get_active_venue_id"),
  ]);
  if (!user || !accountId || !permissions.includes("sales.view_shifts") || !permissions.includes(permission))
    throw new Error("Нет доступа к плану продаж");
  if (venue.error || venue.data !== venueId)
    throw new Error("План задаётся для заведения, выбранного в шапке. Переключитесь на него");
  return { db, user, accountId, venueId };
}

async function loadSalesPlansImpl(venueId: string): Promise<SalesPlan[]> {
  const s = await scope(venueId, "sales.view_shifts");
  const r = await s.db
    .from("sales_month_plans")
    .select("month,turnover,updated_at")
    .eq("account_id", s.accountId)
    .eq("venue_id", venueId)
    // Строка может хранить только план алкоголя (KPI старших) — это не план оборота.
    .not("turnover", "is", null)
    .order("month", { ascending: false })
    .limit(240);
  if (r.error) throw new Error("Не удалось загрузить план продаж");
  return (r.data ?? []).map((p) => ({
    month: p.month.slice(0, 7),
    turnover: Number(p.turnover),
    updatedAt: p.updated_at,
  }));
}

/** `turnover: null` стирает план месяца. */
async function saveSalesPlanImpl(input: {
  venueId: string;
  month: string;
  turnover: number | null;
}): Promise<SalesPlan[]> {
  const s = await scope(input.venueId, "sales.configure_shifts");
  const month = z.string().regex(MONTH, "Проверьте месяц").parse(input.month);
  const turnover = z
    .number()
    .finite()
    .positive("План должен быть больше нуля")
    .lt(1e12, "Слишком большая сумма")
    .nullable()
    .parse(input.turnover);
  const before = await s.db
    .from("sales_month_plans")
    .select("id,turnover,alcohol")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("month", `${month}-01`)
    .maybeSingle();
  if (before.error) throw new Error("Не удалось прочитать план продаж");
  const previous = before.data?.turnover != null ? Number(before.data.turnover) : null;
  const alcohol = before.data?.alcohol != null ? Number(before.data.alcohol) : null;
  const rounded = turnover === null ? null : Math.round(turnover * 100) / 100;
  // В строке месяца живёт и план алкоголя: стёртый оборот удаляет строку,
  // только если плана алкоголя в ней нет.
  const op = planWrite(before.data ? { turnover: previous, alcohol } : null, { turnover: rounded, alcohol });
  if (op === "noop") return loadSalesPlansImpl(s.venueId);
  // Политики таблицы молча не меняют строку без прав: проверяем, что запись прошла.
  const write =
    op === "delete"
      ? await s.db
          .from("sales_month_plans")
          .delete()
          .eq("id", before.data!.id)
          .select("id")
      : op === "update"
        ? await s.db
            .from("sales_month_plans")
            .update({ turnover: rounded, updated_by: s.user.id })
            .eq("id", before.data!.id)
            .select("id")
        : await s.db
            .from("sales_month_plans")
            .insert({
              account_id: s.accountId,
              venue_id: s.venueId,
              month: `${month}-01`,
              turnover: rounded,
              created_by: s.user.id,
              updated_by: s.user.id,
            })
            .select("id");
  if (write.error) {
    // План алкоголя в этой строке только что задали (вкладка «KPI»): строку уже нельзя удалить.
    if (write.error.code === "23505" || /вкладке «KPI»/.test(write.error.message))
      throw new Error("План этого месяца только что изменили. Обновите страницу");
    throw new Error("Не удалось сохранить план продаж");
  }
  const id = write.data?.[0]?.id ?? before.data?.id;
  if (!write.data?.length || !id) throw new Error("Нет доступа к плану продаж");
  await writeAuditEvent({
    accountId: s.accountId,
    venueId: s.venueId,
    userId: s.user.id,
    actionCode:
      rounded === null
        ? "sales.plan.deleted"
        : previous === null
          ? "sales.plan.created"
          : "sales.plan.updated",
    entityType: "sales_month_plan",
    entityId: id,
    details: { month, before: previous, after: rounded },
  });
  return loadSalesPlansImpl(s.venueId);
}

// Действия возвращают ошибку текстом, а не исключением (см. lib/actions/result).
export async function loadSalesPlans(venueId: string) {
  return actionResult(() => loadSalesPlansImpl(venueId), "Не удалось загрузить план продаж");
}
export async function saveSalesPlan(input: {
  venueId: string;
  month: string;
  turnover: number | null;
}) {
  return actionResult(() => saveSalesPlanImpl(input), "Не удалось сохранить план продаж");
}
