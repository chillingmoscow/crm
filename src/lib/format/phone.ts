/**
 * RU-only phone helpers.
 *
 * Storage canonical form is E.164: `+7XXXXXXXXXX` (12 chars).
 * Display form is `+7 (XXX) XXX-XX-XX`.
 *
 * Both helpers are pure and idempotent: passing display back into
 * normalize, or E.164 into format, yields a stable round-trip.
 */

const E164_RU_LENGTH = 12; // +7 + 10 digits

/**
 * Strip everything non-digit; tolerate leading 8 or 7 or +7 / +8.
 * Returns canonical `+7XXXXXXXXXX` or null if there are not exactly
 * 10 subscriber digits.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D+/g, "");
  if (!digits) return null;

  let subscriber: string;
  if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) {
    subscriber = digits.slice(1);
  } else if (digits.length === 10) {
    subscriber = digits;
  } else {
    return null;
  }

  if (subscriber.length !== 10) return null;
  return `+7${subscriber}`;
}

/**
 * Format an E.164 RU number (or raw user input) as `+7 (XXX) XXX-XX-XX`.
 * If the value can't be normalized into RU E.164, returns the raw input
 * unchanged so legacy non-RU strings still render.
 */
export function formatPhoneDisplay(input: string | null | undefined): string {
  if (!input) return "";
  const e164 = normalizePhone(input);
  if (!e164 || e164.length !== E164_RU_LENGTH) return input;
  const d = e164.slice(2); // 10 digits
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

/**
 * Live-typing formatter: returns whatever subset of the mask is
 * appropriate for the digits typed so far. Used by PhoneInput to
 * project keystrokes onto the mask without forcing a full 10-digit
 * value before the user has finished typing.
 */
export function formatPhonePartial(input: string | null | undefined): string {
  if (!input) return "";
  let digits = input.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits[0] === "8" || digits[0] === "7") digits = digits.slice(1);
  digits = digits.slice(0, 10);

  if (digits.length === 0) return "+7 ";
  if (digits.length <= 3) return `+7 (${digits}`;
  if (digits.length <= 6) return `+7 (${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 8)
    return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
}
