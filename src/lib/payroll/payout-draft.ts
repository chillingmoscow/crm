import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { buildContext, cashPlan, money, payoutAudit, type VenueHandle } from "./payout-engine";
import { payoutDraftNotice } from "./payout-draft-notice";
import { payoutPeriod } from "./payout-plan";
import { loadVenuePayoutData } from "./payout-source";

// Черновик плана выплат в начале периода (Павел, 27.11: «чтобы приходило
// уведомление, что сформирован новый план»). Раз в день вместе с автовыдачей:
// если на текущий период плана ещё не было — ни черновика, ни утверждённого,
// ни отменённого, — сервер формирует черновик и уведомляет тех, у кого есть
// право на выплаты в заведении. Утверждает по-прежнему человек.

export type DraftResult = {
  venueId: string;
  outcome: "created" | "exists" | "error";
  planId?: string;
  notified?: number;
  reason?: string;
};

/** Кому уведомление: активные сотрудники заведения с правом на выплаты. */
async function payRecipients(admin: LooseDb, venueId: string): Promise<string[]> {
  const perm = await admin.from<Array<{ id: string }>>("permissions").select("id").eq("code", "payroll.pay");
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

async function draftVenue(admin: LooseDb, accountId: string, venueId: string): Promise<DraftResult> {
  const s: VenueHandle = { db: admin, admin, accountId, venueId };
  const data = await loadVenuePayoutData(admin, accountId, venueId);
  const ctx = await buildContext(s, data, null);
  const period = payoutPeriod(ctx.today);
  const rows = cashPlan(ctx, "main", period.month, period.payoutNo);
  const r = await admin.rpc("payroll_payout_plan_draft_system", {
    p_account: accountId,
    p_venue: venueId,
    p_input: {
      schedule: "main",
      month: period.month,
      payout_no: period.payoutNo,
      window_from: period.from,
      window_to: period.to,
      rows: rows.map((row) => ({
        employee_id: row.employee_id,
        pay_date: row.pay_date,
        amount: row.amount,
        breakdown: row.breakdown,
      })),
    },
  });
  if (r.error) throw new Error(r.error.message);
  const planId = (r.data as string | null) ?? null;
  if (!planId) return { venueId, outcome: "exists" };

  const total = money(rows.reduce((sum, row) => sum + row.amount, 0));
  const people = rows.filter((row) => row.amount > 0).length;
  await payoutAudit(s, null, "payroll.payout_plan.created", planId, {
    month: period.month,
    payout_no: period.payoutNo,
    schedule: "main",
    rows: rows.length,
    total,
    automatic: true,
  });
  const recipients = await payRecipients(admin, venueId);
  const notice = payoutDraftNotice({ month: period.month, payoutNo: period.payoutNo, total, people });
  if (recipients.length) {
    const ins = await admin.from("notifications").insert(
      recipients.map((user_id) => ({
        user_id,
        venue_id: venueId,
        type: "staff.payout_plan_ready",
        category: "staff",
        title: notice.title,
        body: notice.body,
        link: "/people/payroll?tab=plan",
        actor_user_id: null,
        entity_type: "payroll_payout_plan",
        entity_id: planId,
      })),
    );
    if (ins.error) throw new Error(ins.error.message);
  }
  return { venueId, outcome: "created", planId, notified: recipients.length };
}

/** Черновики по всем заведениям, где настроен график выплат. Сбой одного не мешает остальным. */
export async function runPayoutDrafts(): Promise<DraftResult[]> {
  if (process.env.PAYROLL_PAYOUT_AUTO === "off") return [];
  const admin = asLooseDb(createAdminClient());
  const venues = await admin
    .from<{ account_id: string; venue_id: string }[]>("payroll_payout_settings")
    .select("account_id,venue_id");
  if (venues.error) throw new Error(venues.error.message);
  const ids = (venues.data ?? []).map((v) => v.venue_id);
  const live = ids.length
    ? await admin.from<{ id: string }[]>("venues").select("id").in("id", ids).is("archived_at", null)
    : { data: [], error: null };
  if (live.error) throw new Error(live.error.message);
  const alive = new Set((live.data ?? []).map((v) => v.id));
  const results: DraftResult[] = [];
  for (const v of (venues.data ?? []).filter((x) => alive.has(x.venue_id))) {
    try {
      results.push(await draftVenue(admin, v.account_id, v.venue_id));
    } catch (e) {
      const reason = e instanceof Error ? e.message : "неизвестная ошибка";
      console.error(`[payroll-payout-draft] ${v.venue_id}: ${reason}`);
      results.push({ venueId: v.venue_id, outcome: "error", reason });
    }
  }
  return results;
}
