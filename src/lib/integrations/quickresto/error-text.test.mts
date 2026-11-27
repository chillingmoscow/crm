import { test } from "node:test";
import assert from "node:assert/strict";
import { quickRestoErrorText, quickRestoUserMessage } from "./error-text.ts";
import { actionErrorMessage } from "../../actions/result.ts";

test("тексты клиента Quick Resto — по-русски и без технических слов", () => {
  const cases: Array<[string, string]> = [
    ["Quick Resto request timed out after 20s", "Quick Resto не ответил вовремя"],
    ["Quick Resto back-office request timed out after 20s", "Quick Resto не ответил вовремя"],
    [
      "Quick Resto: не удалось соединиться с chilling.quickresto.ru (ECONNRESET): socket hang up",
      "Не удалось связаться с Quick Resto",
    ],
    [
      "Quick Resto: не удалось соединиться с chilling.quickresto.ru (UND_ERR_CONNECT_TIMEOUT): Connect Timeout Error",
      "Quick Resto не ответил вовремя",
    ],
    [
      "Quick Resto back-office access denied (403): проверьте права пользователя Sheerly Bot",
      "У пользователя интеграции в Quick Resto нет прав на этот раздел",
    ],
    ["Quick Resto вернул ошибку 403: Forbidden", "У пользователя интеграции в Quick Resto нет прав на этот раздел"],
    ["Quick Resto back-office auth failed (401)", "Не удалось войти в Quick Resto. Проверьте подключение в настройках интеграций"],
    ["Quick Resto (Keycloak): token exchange failed (400)", "Не удалось войти в Quick Resto. Проверьте подключение в настройках интеграций"],
    [
      "Quick Resto (Keycloak): не получен loginAction после ввода логина (статус 200)",
      "Не удалось войти в Quick Resto. Проверьте подключение в настройках интеграций",
    ],
    // Сбой сервера входа — это недоступность Quick Resto, а не неверное подключение.
    ["Quick Resto (Keycloak): страница входа недоступна (503)", "Quick Resto временно недоступен"],
    ["Quick Resto (Keycloak): token exchange failed (500)", "Quick Resto временно недоступен"],
    [
      "Неверный логин или пароль back-office пользователя Quick Resto",
      "Quick Resto не принял логин или пароль. Проверьте подключение в настройках интеграций",
    ],
    ["Quick Resto вернул ошибку 502: <html>Bad Gateway</html>", "Quick Resto временно недоступен"],
    ["Quick Resto вернул ошибку 400: Bad Request", "Quick Resto отклонил запрос"],
    ["Quick Resto вернул ошибку 504: Gateway Timeout", "Quick Resto временно недоступен"],
    [
      "Quick Resto временно ограничил частоту запросов. Подождите и повторите попытку.",
      "Quick Resto временно ограничил частоту запросов, подождите пару минут",
    ],
    ["Quick Resto read requires objectId", "Quick Resto вернул ошибку"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(quickRestoErrorText(raw), expected, raw);
    assert.equal(quickRestoErrorText(new Error(raw)), expected, raw);
    // Тот же текст получает ответ любого действия.
    assert.equal(actionErrorMessage(new Error(raw), "Не удалось"), expected, raw);
  }
});

test("своя русская фраза про Quick Resto остаётся как есть, без точки в конце", () => {
  assert.equal(quickRestoErrorText("Quick Resto не вернул склад акта."), "Quick Resto не вернул склад акта");
});

test("причина отказа из ответа Quick Resto остаётся видна", () => {
  assert.equal(
    quickRestoErrorText("Quick Resto вернул ошибку 400: Документ уже проведён."),
    "Quick Resto отклонил запрос: Документ уже проведён",
  );
  assert.equal(
    quickRestoErrorText('Quick Resto вернул ошибку 422: {"error":"validation","message":"Склад закрыт для изменений"}'),
    "Quick Resto отклонил запрос: Склад закрыт для изменений",
  );
  assert.equal(
    quickRestoErrorText("Quick Resto вернул ошибку 500: Ошибка проведения документа"),
    "Quick Resto вернул ошибку: Ошибка проведения документа",
  );
});

test("своя русская фраза с названием или кодом в скобках и кавычках не перехватывается", () => {
  const own = [
    "Не удалось проверить гостя Quick Resto (HTTP 404)",
    "Quick Resto не вернул показатель «Revenue»",
    "Quick Resto вернул некорректный показатель «Avg check»",
  ];
  for (const message of own) {
    assert.equal(quickRestoErrorText(message), message, message);
    assert.equal(actionErrorMessage(new Error(message), "Не удалось"), message, message);
  }
  // Сбой записи в каталог — наша ошибка, Quick Resto в тексте не упоминается.
  assert.equal(
    quickRestoUserMessage(new Error("Не удалось сохранить в каталог часть позиций (ингредиенты)"), "Не удалось"),
    "Не удалось сохранить в каталог часть позиций (ингредиенты)",
  );
});

test("ошибка не от Quick Resto не перехватывается", () => {
  assert.equal(quickRestoErrorText("canceling statement due to statement timeout"), null);
  assert.equal(quickRestoErrorText(null), null);
  assert.equal(actionErrorMessage(new Error("permission denied for table x"), "Не удалось"), "Не удалось");
});

test("quickRestoUserMessage: русское — как есть, прочее — запасная фраза", () => {
  assert.equal(quickRestoUserMessage("Подключение не найдено", "Не удалось"), "Подключение не найдено");
  assert.equal(quickRestoUserMessage(new Error("duplicate key value"), "Не удалось"), "Не удалось");
  assert.equal(quickRestoUserMessage(null, "Не удалось"), "Не удалось");
  assert.equal(quickRestoUserMessage("Quick Resto request timed out after 20s", "Не удалось"), "Quick Resto не ответил вовремя");
});
