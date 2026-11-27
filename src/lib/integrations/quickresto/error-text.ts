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
 * Перехватываются только технические тексты клиента. Своя русская фраза, где
 * Quick Resto просто упомянут («Quick Resto не вернул показатель «Revenue»»,
 * «Не удалось проверить гостя Quick Resto (HTTP 404)»), проходит как есть:
 * латиница в скобках и кавычках — название или код, а не английский текст.
 *
 * Модуль без зависимостей: его подключают и действия, и фоновые обработчики,
 * и тесты на подменённых модулях.
 */

const QUICK_RESTO = /quick\s*resto|keycloak/i;
const CYRILLIC = /[а-яё]/i;

const LOGIN_FAILED = "Не удалось войти в Quick Resto. Проверьте подключение в настройках интеграций";
const NO_RIGHTS = "У пользователя интеграции в Quick Resto нет прав на этот раздел";
const UNAVAILABLE = "Quick Resto временно недоступен";

type Rule = { test: RegExp; text: string };

// Порядок важен: тайм-аут соединения (UND_ERR_CONNECT_TIMEOUT) — это «не
// ответил вовремя», а не «не удалось связаться»; недоступная страница входа
// (503) — сбой Quick Resto, а не неверное подключение.
const RULES: Rule[] = [
  { test: /timed out|timeout|ETIMEDOUT/i, text: "Quick Resto не ответил вовремя" },
  {
    test: /не удалось соединиться|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET/i,
    text: "Не удалось связаться с Quick Resto",
  },
  { test: /ограничил частоту/i, text: "Quick Resto временно ограничил частоту запросов, подождите пару минут" },
  { test: /access denied \(403\)/i, text: NO_RIGHTS },
  {
    test: /неверный логин или пароль/i,
    text: "Quick Resto не принял логин или пароль. Проверьте подключение в настройках интеграций",
  },
  { test: /недоступн|\((?:статус )?5\d\d\)/i, text: UNAVAILABLE },
  { test: /auth failed|keycloak|token exchange|loginAction/i, text: LOGIN_FAILED },
];

/** «Quick Resto вернул ошибку 400: <ответ сервера>» — формат `quickRestoErrorMessage` клиента. */
const STATUS_ERROR = /вернул ошибку (\d{3})\b(?::\s*([\s\S]*))?$/i;

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

const withoutPeriod = (text: string) => text.replace(/\.\s*$/, "");

/**
 * Русская часть ответа сервера («Документ уже проведён» из тела 400 или из
 * JSON `{"message": "…"}`) — её стоит показать, в ней причина отказа.
 * Берётся одна короткая фраза без адресов, путей и идентификаторов: тело
 * ответа целиком остаётся в журнале сервера.
 */
function serverReason(body: string | undefined): string | null {
  if (!body) return null;
  const reason = body
    // Делим и по разметке JSON, и по предложениям: фраза с адресом
    // отбрасывается, соседняя без него остаётся.
    .split(/["{}[\]<>]|\\n|(?<=[.!?])\s+/)
    .map((part) => part.replace(/^[\s:,]+|[\s:,]+$/g, "").replace(/\s+/g, " "))
    .find(
      (part) =>
        CYRILLIC.test(part) &&
        // Ссылки, пути, почта, ключи и длинные латинские или цифровые
        // вставки — признак технического текста, его не показываем.
        !/https?:|www\.|[/\\@=?]|[A-Za-z]{16,}|\d{7,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(part),
    );
  if (!reason) return null;
  const sentence = withoutPeriod(reason.trim());
  return sentence.length > 160 ? `${sentence.slice(0, 159).trimEnd()}…` : sentence;
}

function statusErrorText(status: number, body: string | undefined): string {
  if (status === 401) return LOGIN_FAILED;
  if (status === 403) return NO_RIGHTS;
  if (status === 429) return "Quick Resto временно ограничил частоту запросов, подождите пару минут";
  const reason = serverReason(body);
  if (status >= 500) return reason ? `Quick Resto вернул ошибку: ${reason}` : UNAVAILABLE;
  return reason ? `Quick Resto отклонил запрос: ${reason}` : "Quick Resto отклонил запрос";
}

/**
 * Латиница вне скобок и кавычек — признак английского технического текста.
 * В скобках и кавычках прощается только короткое название или код («HTTP
 * 404», «Revenue»); вставка с адресом, путём, двоеточием или длинная строка
 * считается технической.
 */
const SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9 _.%-]{0,24}$/;

function hasLooseLatin(message: string): boolean {
  const bare = message
    .replace(/«([^»]*)»|"([^"]*)"|“([^”]*)”|\(([^)]*)\)/g, (whole, ...groups: unknown[]) => {
      const inner = String(groups.slice(0, 4).find((group) => typeof group === "string") ?? "").trim();
      return /[A-Za-z]/.test(inner) && !SAFE_TOKEN.test(inner) ? whole : " ";
    })
    .replace(new RegExp(QUICK_RESTO.source, "gi"), " ");
  return /[A-Za-z]/.test(bare);
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
  const status = STATUS_ERROR.exec(message);
  if (status) return statusErrorText(Number(status[1]), status[2]);
  for (const rule of RULES) if (rule.test.test(message)) return rule.text;
  if (CYRILLIC.test(message) && !hasLooseLatin(message)) return withoutPeriod(message);
  return "Quick Resto вернул ошибку";
}

/** Как `quickRestoErrorText`, но для любой ошибки: русский текст как есть, остальное — `fallback`. */
export function quickRestoUserMessage(error: unknown, fallback: string): string {
  const known = quickRestoErrorText(error);
  if (known) return known;
  const message = messageOf(error).trim();
  return message && CYRILLIC.test(message) ? withoutPeriod(message) : fallback;
}
