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
      "У пользователя Sheerly Bot в Quick Resto нет прав на этот раздел",
    ],
    ["Quick Resto back-office auth failed (401)", "Не удалось войти в Quick Resto. Проверьте подключение в настройках интеграций"],
    ["Quick Resto (Keycloak): token exchange failed (500)", "Не удалось войти в Quick Resto. Проверьте подключение в настройках интеграций"],
    [
      "Неверный логин или пароль back-office пользователя Quick Resto",
      "Quick Resto не принял логин или пароль. Проверьте подключение в настройках интеграций",
    ],
    ["Quick Resto вернул ошибку 502: <html>Bad Gateway</html>", "Quick Resto временно недоступен"],
    ["Quick Resto вернул ошибку 400: Bad Request", "Quick Resto отклонил запрос"],
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
