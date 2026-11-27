export const RATE_LIMIT_MESSAGE = "Слишком много попыток, подождите минуту";

/**
 * GoTrue отвечает на частые попытки входа, регистрации и писем статусом 429
 * (коды `over_request_rate_limit`, `over_email_send_rate_limit` …), а на
 * повторное письмо раньше минуты — текстом «you can only request this
 * after N seconds». Всё это для человека одно: подождать.
 */
export function isRateLimited(
  error: { status?: number; code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  if (error.code && /^over_.*rate_limit$/.test(error.code)) return true;
  return /rate limit|only request this after/i.test(error.message ?? "");
}
