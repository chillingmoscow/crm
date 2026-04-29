"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Cookie that holds the user's chosen legal entity for finance views.
 * This is a UI-level scoping convenience — RLS itself doesn't depend on
 * it. Reads filter the displayed list, but writes still go to the active
 * venue's `default_legal_entity_id` (resolved by the DB helper
 * `get_active_legal_entity_id()`).
 *
 * Special value `null` (cookie absent) = "Все юрлица" — show data from
 * every legal entity in the active account.
 */
const COOKIE_NAME = "finance_le";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Read the active finance legal entity id from cookies. Returns null
 * when no LE is selected ("Все юрлица" mode).
 */
export async function getActiveFinanceLegalEntityId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  return value && value.trim() ? value : null;
}

/**
 * Set the active finance legal entity. Pass null to clear (show all).
 *
 * The cookie is httpOnly so client JS can't tamper with it; the
 * <LegalEntitySwitcher> calls this via a server action.
 */
export async function setActiveFinanceLegalEntityId(
  legalEntityId: string | null
): Promise<{ error: string | null }> {
  const store = await cookies();
  if (legalEntityId === null) {
    store.delete(COOKIE_NAME);
  } else {
    store.set(COOKIE_NAME, legalEntityId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
  }
  revalidatePath("/finance", "layout");
  return { error: null };
}
