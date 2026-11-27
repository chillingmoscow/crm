/**
 * Сеть до api.telegram.org с сервера ненадёжна: часть соединений рвётся
 * ещё до отправки запроса (замеры с прода: 22.11.2026 — примерно каждое
 * десятое, 25.11.2026 — каждое второе, сериями; `UND_ERR_CONNECT_TIMEOUT`;
 * IPv6 не проходит вовсе). Поэтому соединение ждём 2,5 с, а не 10
 * (агент в telegram-bot), и пробуем до шести раз. Такой
 * запрос до Telegram не дошёл, поэтому его безопасно повторить — дубля
 * сообщения не будет. Ошибку после установленного соединения (обрыв,
 * тайм-аут ответа) не повторяем: Telegram мог уже принять сообщение.
 *
 * Чистый модуль без `server-only`, чтобы проверяться в node:test.
 */

export const TELEGRAM_UNREACHABLE = "Не удалось связаться с Telegram";
export const TELEGRAM_NO_ANSWER = "Telegram не ответил";

export class TelegramNetworkError extends Error {
  /** `not_sent` — запрос точно не ушёл; `unknown` — мог дойти. */
  readonly delivery: "not_sent" | "unknown";
  constructor(delivery: "not_sent" | "unknown") {
    super(delivery === "not_sent" ? TELEGRAM_UNREACHABLE : TELEGRAM_NO_ANSWER);
    this.name = "TelegramNetworkError";
    this.delivery = delivery;
  }
}

/** Коды, при которых соединение не установилось и запрос не отправлен. */
const CONNECT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

type ErrorLike = { code?: unknown; syscall?: unknown; message?: unknown; cause?: unknown; errors?: unknown };

/** Ошибка fetch случилась до того, как запрос ушёл: соединение или TLS не установились. */
export function isConnectFailure(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const e = error as ErrorLike;
  if (typeof e.code === "string") {
    if (CONNECT_CODES.has(e.code)) return true;
    if ((e.code === "ETIMEDOUT" || e.code === "ECONNRESET") && e.syscall === "connect") return true;
  }
  // Сброс во время TLS-рукопожатия: undici пишет запрос только после него.
  if (typeof e.message === "string" && e.message.includes("before secure TLS connection was established")) return true;
  // Перебор адресов (IPv4/IPv6) — AggregateError: не соединились ни с одним.
  if (Array.isArray(e.errors) && e.errors.length > 0 && e.errors.every((x) => isConnectFailure(x, depth + 1)))
    return true;
  return isConnectFailure(e.cause, depth + 1);
}

/** Паузы между попытками: шесть попыток, сбои идут сериями по несколько секунд. */
export const TELEGRAM_RETRY_DELAYS_MS = [300, 300, 600, 600, 1000];

/**
 * Запрос к Bot API с повтором, только если соединение не установилось.
 * `send` каждый раз создаёт новый запрос (и новый сигнал тайм-аута).
 */
export async function fetchTelegram(
  send: () => Promise<Response>,
  options: { delays?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const delays = options.delays ?? TELEGRAM_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (!isConnectFailure(error)) throw new TelegramNetworkError("unknown");
      if (attempt >= delays.length) throw new TelegramNetworkError("not_sent");
      await sleep(delays[attempt]);
    }
  }
}
