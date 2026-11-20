"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checked, integrationInput, integrationScope } from "@/lib/integrations/settings";

/** Background jobs whose failure means a Telegram message did not reach a chat. */
const DELIVERY_KINDS = ["notify", "hired", "chat_invites"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];
export type UndeliveredItem = { id: string; kind: DeliveryKind; name: string | null; error: string | null; created_at: string };

type JobRow = { id: string; kind: DeliveryKind; candidate_id: string | null; payload: Record<string, unknown>; error: string | null; created_at: string };

export async function readUndelivered(): Promise<UndeliveredItem[]> {
  const s = await integrationScope();
  const jobs = checked(await s.db.from<JobRow[]>("candidate_jobs").select("id,kind,candidate_id,payload,error,created_at")
    .eq("account_id", s.accountId).eq("state", "error").in("kind", [...DELIVERY_KINDS])
    .order("created_at", { ascending: false }).limit(100)) ?? [];
  const ids = [...new Set(jobs.map(j => j.candidate_id).filter((id): id is string => !!id))];
  const candidates = ids.length ? checked(await s.db.from<{ id: string; full_name: string }[]>("candidates").select("id,full_name")
    .eq("account_id", s.accountId).in("id", ids)) ?? [] : [];
  const names = new Map(candidates.map(c => [c.id, c.full_name]));
  return jobs.map(j => ({ id: j.id, kind: j.kind, created_at: j.created_at, error: j.error,
    name: (typeof j.payload.name === "string" && j.payload.name.trim()) || (j.candidate_id ? names.get(j.candidate_id) ?? null : null) }));
}

const ids = z.array(z.string().uuid()).min(1).max(100);

/**
 * Puts failed deliveries back in the queue with a fresh attempt budget.
 * A send marked "started" was never confirmed by Telegram; the worker refuses to repeat it on its own
 * (it could duplicate the message), so the person's explicit retry clears that mark.
 */
export async function retryDeliveries(input: unknown) {
  const s = await integrationScope();
  const list = integrationInput(ids, input);
  const jobs = checked(await s.db.from<{ id: string; payload: Record<string, unknown> }[]>("candidate_jobs").select("id,payload")
    .eq("account_id", s.accountId).eq("state", "error").in("kind", [...DELIVERY_KINDS]).in("id", list)) ?? [];
  for (const job of jobs) {
    const payload = { ...job.payload };
    if (payload.telegram === "started") delete payload.telegram;
    checked(await s.db.from("candidate_jobs").update({ state: "pending", attempts: 0, error: null, lease_until: null, available_at: new Date().toISOString(), payload })
      .eq("account_id", s.accountId).eq("id", job.id).eq("state", "error"));
  }
  revalidatePath("/settings/integrations", "layout");
  return jobs.length;
}

/** Stops retrying: the person decided the message is no longer needed. */
export async function dismissDeliveries(input: unknown) {
  const s = await integrationScope();
  const list = integrationInput(ids, input);
  checked(await s.db.from("candidate_jobs").update({ state: "done", lease_until: null })
    .eq("account_id", s.accountId).eq("state", "error").in("kind", [...DELIVERY_KINDS]).in("id", list));
  revalidatePath("/settings/integrations", "layout");
}
