/**
 * Ошибки Quick Resto человеческим языком.
 *
 * Клиент (`client.ts`) бросает ошибки с техническим текстом: английский
 * «request timed out after 20s», коды сети (ECONNRESET), статус и HTML-ответ
 * сервера. Этот текст нужен журналу сервера и проверкам вида
 * `isBackOfficeAuthError`, поэтому сам клиент его не меняет, — а на границе с
 * интерфейсом (ответ действия, сохранённый итог фоновой сверки) сообщение
 * проходит через `quickRestoErrorText`.
 *
 * Модуль без зависимостей: его подключают и действия, и фоновые обработчики,
 * и тесты на подменённых модулях.
 */

const QUICK_RESTO = /quick\s*resto|keycloak/i;

type Rule = { test: RegExp; text: string };

// Порядок важен: тайм-аут соединения (UND_ERR_CONNECT_TIMEOUT) — это «не
// ответил вовремя», а не «не удалось связаться».
const RULES: Rule[] = [
  { test: /timed out|timeout|ETIMEDOUT/i, text: "Quick Resto не ответил вовремя" },
  {
    test: /не удалось соединиться|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET/i,
    text: "Не удалось связаться с Quick Resto",
  },
  { test: /ограничил частоту/i, text: "Quick Resto временно ограничил частоту запросов, подождите пару минут" },
  {
    test: /access denied \(403\)|ошибку 403\b/i,
    text: "У пользователя Sheerly Bot в Quick Resto нет прав на этот раздел",
  },
  {
    test: /неверный логин или пароль/i,
    text: "Quick Resto не принял логин или пароль. Проверьте подключение в настройках интеграций",
  },
  {
    test: /auth failed|keycloak|token exchange|loginAction|ошибку 401\b/i,
    text: "Не удалось войти в Quick Resto. Проверьте подключение в настройках интеграций",
  },
  { test: /ошибку 5\d\d\b/i, text: "Quick Resto временно недоступен" },
  { test: /ошибку 4\d\d\b/i, text: "Quick Resto отклонил запрос" },
];

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

/**
 * Русский текст для ошибки Quick Resto или `null`, если это не она.
 *
 * Принимает исключение или уже сохранённую строку — в итогах прошлых сверок
 * лежит сырой текст, и его тоже нужно показать по-человечески. Текст без
 * точки в конце: его дописывают последствием («…, каталог остался прежним»).
 */
export function quickRestoErrorText(error: unknown): string | null {
  const message = messageOf(error).trim();
  if (!message || !QUICK_RESTO.test(message)) return null;
  for (const rule of RULES) if (rule.test.test(message)) return rule.text;
  // Своя русская фраза без технических вставок («Quick Resto не вернул
  // склад») показывается как есть; латиница кроме названия системы — нет.
  const latin = message.replace(QUICK_RESTO, "").match(/[A-Za-z]/g)?.length ?? 0;
  if (latin === 0 && /[а-яё]/i.test(message)) return message.replace(/\.\s*$/, "");
  return "Quick Resto вернул ошибку";
}

/** Как `quickRestoErrorText`, но для любой ошибки: русский текст как есть, остальное — `fallback`. */
export function quickRestoUserMessage(error: unknown, fallback: string): string {
  const known = quickRestoErrorText(error);
  if (known) return known;
  const message = messageOf(error).trim();
  return message && /[а-яё]/i.test(message) ? message.replace(/\.\s*$/, "") : fallback;
}
