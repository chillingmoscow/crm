/**
 * Recovery only covers hires made after the invitations feature shipped: people hired earlier
 * already got their chat invites by other means (Glide / by hand) and must not be re-invited.
 * candidate_hires has no completion timestamp, so created_at is the boundary.
 */
export const CHAT_INVITES_SINCE = "2026-11-06T00:00:00Z";
const WINDOW_MS = 14 * 86400000;

/** Lower bound for created_at of hires the recovery may look at. */
export function recoveryCutoff(now: number): string {
  return new Date(Math.max(Date.parse(CHAT_INVITES_SINCE), now - WINDOW_MS)).toISOString();
}

/** Hires inside the recovery window that have no chat_invites job yet. */
export function hiresMissingInvites<H extends { candidate_id: string; created_at: string }>(
  hires: H[], haveJobFor: Set<string>, now: number,
): H[] {
  const cutoff = Date.parse(recoveryCutoff(now));
  return hires.filter(h => Date.parse(h.created_at) >= cutoff && !haveJobFor.has(h.candidate_id));
}
