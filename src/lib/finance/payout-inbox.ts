"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionResult } from "@/lib/actions/result";
import { writeAuditEvent } from "@/lib/audit/write";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";

// «Всё верно» на карточке выплат зарплаты в «На разбор». Закрывает база
// (payroll_payout_alert_resolve): она же проверяет право на выплаты и
// заведение. Здесь — ввод, журнал и обновление страниц.

async function resolvePayoutAlertImpl(id: string): Promise<{ gone: boolean }> {
  const can = await getCachedPermissionChecker();
  if (!can("payroll.pay")) throw new Error("Нет доступа к выплатам зарплаты");
  const parsed = z.string().uuid("Карточка не найдена").parse(id);
  const supabase = await createClient();
  const db = asLooseDb(supabase);
  const { data, error } = await db.rpc("payroll_payout_alert_resolve", { p_id: parsed });
  if (error) throw new Error(error.message);
  revalidatePath("/finance/inbox");
  revalidatePath("/finance");
  // false — карточку уже закрыли (другой сотрудник или сама причина ушла): в журнал не пишем.
  if (data !== true) return { gone: true };
  const [user, accountId, { data: venueId }, { data: alert }] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    supabase.rpc("get_active_venue_id"),
    db.from<{ kind: string; title: string }>("payroll_payout_alerts").select("kind, title").eq("id", parsed).maybeSingle(),
  ]);
  if (!accountId) return { gone: false };
  await writeAuditEvent({
    accountId,
    venueId: typeof venueId === "string" ? venueId : null,
    userId: user?.id ?? null,
    actionCode: "payroll.payout_alert.resolved",
    entityType: "payroll_payout_alert",
    entityId: parsed,
    details: { kind: alert?.kind ?? null, title: alert?.title ?? null },
  }).catch(() => console.error("[payout-inbox] журнал закрытия карточки не записан"));
  return { gone: false };
}

/** «Всё верно»: карточка уходит из очереди. */
export async function resolvePayoutAlert(id: string) {
  return actionResult(() => resolvePayoutAlertImpl(id), "Не удалось закрыть карточку");
}
