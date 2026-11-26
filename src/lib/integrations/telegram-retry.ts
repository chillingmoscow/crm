// С прод-сервера часть соединений с api.telegram.org не устанавливается
// (блокировка на пути, примерно каждое второе). Соединение рвём быстро и
// пробуем снова. Повторяем только ошибки ДО установки соединения: запрос до
// Telegram не дошёл, значит сообщение точно не ушло и дубля не будет.

const CONNECT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

export function isConnectFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const cause = (error as { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" ? (cause as { code?: unknown }).code : (error as { code?: unknown }).code;
  return typeof code === "string" && CONNECT_CODES.has(code);
}

export async function withConnectRetry<T>(run: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (error) {
      if (!isConnectFailure(error)) throw error;
      last = error;
    }
  }
  throw last;
}
