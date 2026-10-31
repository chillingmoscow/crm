import type { LooseDb } from "@/lib/supabase/loose";

export type BonusOperation = {
  id: string;
  account_id: string;
  venue_id: string;
  employee_id: string;
  adjustment_id: string;
  guest_id: number;
  bonus_account_id: number;
  direction: "credit" | "debit";
  amount: number;
  lease_token: string;
};
export type BonusProvider = {
  read: () => Promise<number>;
  send: () => Promise<string | null>;
};

/** The provider has no idempotency key. A send is attempted at most once;
 * a crash/timeout after the durable sending marker always requires review. */
export async function executeBonusOperation(
  db: LooseDb,
  job: BonusOperation,
  provider: BonusProvider,
) {
  let after: number | null = null;
  let reference: string | null = null;
  try {
    const balance = await provider.read();
    if (!Number.isFinite(balance) || balance < 0)
      throw new Error("Не подтверждён бонусный баланс");
    const begin = await db.rpc("payroll_begin_bonus_send", {
      p_id: job.id,
      p_lease: job.lease_token,
      p_balance: balance,
    });
    if (begin.error) throw new Error(begin.error.message);
    if (begin.data !== true) return { sent: false, review: false };
    // No auth refresh, HTTP retry or retryTransient may wrap this call.
    reference = await provider.send();
    after = await provider.read();
    const confirmed =
      Number.isFinite(after) &&
      Math.round(after * 100) ===
        Math.round(
          (balance +
            (job.direction === "credit" ? 1 : -1) * Number(job.amount)) *
            100,
        );
    const finish = await db.rpc("payroll_finish_bonus_operation", {
      p_id: job.id,
      p_lease: job.lease_token,
      p_after: after,
      p_reference: reference,
      p_confirmed: confirmed,
    });
    if (finish.error) throw new Error(finish.error.message);
    return { sent: true, review: !confirmed };
  } catch {
    // Lost commit responses are safe: done is terminal. This never retries POST.
    const finish = await db.rpc("payroll_finish_bonus_operation", {
      p_id: job.id,
      p_lease: job.lease_token,
      p_after: after,
      p_reference: reference,
      p_confirmed: false,
    });
    if (finish.error)
      throw new Error("Не удалось сохранить результат бонусной операции");
    return { sent: false, review: true };
  }
}
