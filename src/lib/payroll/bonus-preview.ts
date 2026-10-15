import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  getConnection,
  withBackOfficeSession,
} from "@/app/(dashboard)/inventory/actions-shared";
import { callQuickRestoBackOfficeData } from "@/lib/integrations/quickresto/client";
import { salesRead } from "@/lib/sales/rate-limit";

/** Parallel stage: GET only. Never credit/debit the shared Quick Resto account. */
export async function previewPayrollBonuses(
  accountId: string,
  venueId: string,
) {
  const admin = asLooseDb(createAdminClient());
  const pending = await admin
    .from<{ id: string; employee_id: string; amount: number }[]>(
      "payroll_adjustments",
    )
    .select("id,employee_id,amount")
    .eq("account_id", accountId)
    .eq("venue_id", venueId)
    .eq("origin", "lateness")
    .eq("medium", "bonus")
    .eq("external_state", "review")
    .is("deleted_at", null)
    .order("business_date")
    .order("created_at")
    .limit(100);
  if (pending.error) throw new Error(pending.error.message);
  if (!pending.data?.length) return;
  const connection = await getConnection(accountId);
  if (!connection) return;
  const balances = new Map<string, number>();
  for (const entry of pending.data) {
    const e = await admin
      .from<{
        quickresto_guest_id: number | null;
        quickresto_bonus_account_id: number | null;
      }>("payroll_employees")
      .select("quickresto_guest_id,quickresto_bonus_account_id")
      .eq("id", entry.employee_id)
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .single();
    if (e.error) throw new Error(e.error.message);
    const guest = e.data?.quickresto_guest_id,
      account = e.data?.quickresto_bonus_account_id;
    if (!guest || !account) continue;
    const key = String(account);
    let available = balances.get(key);
    if (available === undefined) {
      const r = await salesRead(accountId, () =>
        withBackOfficeSession({
          connection,
          admin,
          run: (authorization) =>
            callQuickRestoBackOfficeData<{
              id?: number;
              available?: number;
              deleted?: boolean;
              accountState?: string;
            }>({
              layerName: connection.login,
              baseUrl: connection.backoffice_base_url,
              authorization,
              path: "crm.accounting.account/read",
              query: { id: account, mode: "bonuses", timeZone: -180 },
            }),
        }),
      );
      if (
        r.id !== account ||
        r.deleted ||
        r.accountState !== "open" ||
        typeof r.available !== "number" ||
        !Number.isFinite(r.available)
      )
        continue;
      available = r.available;
    }
    const result = await admin.rpc("payroll_resolve_bonus", {
      p_id: entry.id,
      p_balance: available,
      p_guest: guest,
      p_account: account,
    });
    if (result.error) throw new Error(result.error.message);
    // Simulate only this batch's reservations. No movement of actual guest points.
    balances.set(
      key,
      available >= Math.abs(Number(entry.amount))
        ? available - Math.abs(Number(entry.amount))
        : available,
    );
  }
}
