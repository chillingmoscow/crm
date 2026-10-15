"use server";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissions,
} from "@/lib/supabase/server";
import { listAuditEvents } from "@/lib/audit/list";
import { z } from "zod";

export async function loadTransactionHistory(transactionId: string) {
  z.string().uuid().parse(transactionId);
  const db = await createClient();
  const accountId = await getCachedActiveAccountId();
  if (!accountId) throw new Error("Выберите аккаунт");
  // Keep transaction access under the same RLS as the finance screen.
  const { data: transaction, error } = await db
    .from("transactions")
    .select("id,venue_id")
    .eq("id", transactionId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!transaction) throw new Error("Транзакция недоступна");
  const canView = (await getCachedPermissions()).includes("org.view_audit");
  const history = canView
    ? await listAuditEvents({
        entityType: "transaction",
        entityId: transactionId,
      })
    : { events: [], hasMore: false, error: null };
  if (history.error) throw new Error(history.error);
  const venue = transaction.venue_id
    ? await db
        .from("venues")
        .select("timezone")
        .eq("id", transaction.venue_id)
        .maybeSingle()
    : null;
  return { ...history, canView, timeZone: venue?.data?.timezone ?? undefined };
}
