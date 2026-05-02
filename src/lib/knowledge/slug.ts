import { customAlphabet } from "nanoid";

// URL-safe alphabet without ambiguous chars (no 0/O, 1/l, I).
// 32 chars × 8 positions ≈ 1.1e12 — plenty for per-account scope, and
// the column has a unique constraint per account anyway.
const generate = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

/** Generate a fresh KB-page slug. Uniqueness per (account_id, slug) is
 * enforced by migration 048 — caller should retry on 23505 if needed. */
export function generateKbSlug(): string {
  return generate();
}
