import "server-only";
import type { LooseDb } from "@/lib/supabase/loose";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { runChatInvites } from "./chat-invites-core";

/** Attempt number (from candidate_jobs.attempts) from which a partial set of links is sent. */
export const PARTIAL_FROM_ATTEMPT = 3;

/** See runChatInvites. Idempotent per (account, eventKey); throws when not confirmed so the job retries. */
export async function sendChatInvites(db: LooseDb, args: {
  accountId: string; userId: string; roleId: string | null; name: string; eventKey: string; allowPartial: boolean;
}) {
  return runChatInvites(db, await loadTelegramBot(db, args.accountId), args);
}
