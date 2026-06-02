# HANDOFF: проведение акта инвентаризации в Quick Resto (403 forbidden)

> Временный рабочий документ для продолжения в новой сессии. Когда баг решён —
> перенести выводы в `docs/quickresto-integration.md` и удалить этот файл.

## Задача

Кнопка «Подвести итоги» на странице итогов акта должна **провести акт в
Quick Resto** (выставить `processed=true`, двинуть остатки), затем локально
поставить `status='processed'`. Сейчас — падает с **403** от QR.

## Текущий симптом (последний тест пользователя)

```
[finalize] QR process failed {
  documentId: '3f7f54aa-...', externalId: 9893,
  error: Error: Quick Resto /action — 403 (нет прав у backoffice-юзера).
         Spring: {"code":"HttpClientErrorException","message":"forbidden"}
}
```

## КЛЮЧЕВОЙ ФАКТ (не потерять!)

**Схема, точно совпадающая с Make (cookie + Basic Auth вместе), УЖЕ в main и
задеплоена на прод** (контейнер `ksg0sco...` image `fb7c5ad`, создан
2026-06-01 23:50 MSK). Запрос на `/action` сейчас отправляется так:

```
POST https://nx815.quickresto.ru/platform/data/warehouse.inventory.document.v2/action
     ?businessDayOffsetInMs=32400000&timeZone=0
Headers:
  Authorization: Basic base64(nx815:<API_pwd>)   ← из connection.login + password_*
  Cookie: <сессия sheerly@bot.ru>                ← из backoffice-логина
  Connection: keep-alive
  Content-Type: application/json; charset=utf-8
Body: {"actionName":"process","ids":[<externalId>],
       "data":{"start":0,"count":150,"mode":"previous30Days",
               "sortField":["invoiceDate"],"sortOrder":["desc"],"timeZone":0}}
```

→ **И всё равно 403 `forbidden`.** Значит проблема НЕ в формате запроса (мы его
вылизали 1-в-1 под Make). Остаётся **одно реальное отличие от Make: ИДЕНТИЧНОСТЬ
COOKIE**.

## Главная гипотеза (с которой начинать новую сессию)

| | Make (работает) | Мы (403) |
|---|---|---|
| Cookie (identity) | логин **`chillingmoscow@gmail.com`** (владелец) | логин **`sheerly@bot.ru`** (бот) |
| Basic Auth | `nx815:VBsZyM8Q` (API) | `nx815:<API_pwd>` (API) — то же |
| Host | `chilling.` / `nx815.` (алиасы, без разницы) | `nx815.` |

**Вывод:** Spring авторизует `/action` по идентичности из **cookie** (а не из
Basic Auth). У `sheerly@bot.ru` в Quick Resto **нет права провести акт** —
поэтому 403. У владельца (`chillingmoscow@gmail.com`) право есть — поэтому Make
работает.

Пользователь утверждает, что у должности `sheerly@bot.ru` все галки выставлены.
НО Spring проверяет конкретное право/системную роль, не обязательно
совпадающее с UI-галкой «провести инвентаризацию». **403 forbidden ≠ баг кода.**

## Что нужно сделать в НОВОЙ сессии (по приоритету)

1. **Подтвердить гипотезу cookie-identity напрямую.** Через прод-контейнер
   (`docker exec ksg0sco...`) или curl: залогиниться backoffice'ом как
   `sheerly@bot.ru` → дёрнуть `/action` с id=0 (неразрушающе) → если 403, а с
   owner-cookie 200 — гипотеза подтверждена. ВНИМАНИЕ: live-тест с реальными
   паролями блокируется auto-classifier'ом (печать пароля в транскрипт). Делать
   так, чтобы пароль НЕ попадал в команду/лог: читать из env контейнера, не
   echo'ить, выводить только статус (200/403), не тело с креды.
2. **Решение А (рекомендуемое пользователем):** оставить `sheerly@bot.ru`, но
   **выдать ему в QR-backoffice нужную системную роль / право на проведение
   инвентаризации**. Чтобы узнать ТОЧНОЕ имя права — нужно тело 403 подробнее
   (сейчас Spring отдаёт скупое `{"message":"forbidden"}`; возможно, есть
   эндпоинт прав/ролей в QR public API — `listRoles`/`readRole` в client.ts).
   Можно сравнить роль `sheerly@bot.ru` vs владельца через `readEmployee`/`readRole`.
3. **Решение Б (быстрый разблок):** временно класть в `backoffice_login/password`
   учётку владельца (как в Make). Пользователь СКАЗАЛ, что хочет именно
   `sheerly@bot.ru` — поэтому Б только как обходной путь, согласовать.
4. Когда заработает — убрать диагностический verbose-лог 403 (оставить
   короткий), перенести знания в `docs/quickresto-integration.md`, удалить
   этот handoff.

## Хронология попыток (что уже пробовали — НЕ повторять по кругу)

| PR | Что сделали | Результат |
|---|---|---|
| #471 | Добавили `processInventoryDocumentBackOffice` (cookie-only) + finalize пушит в QR, при успехе локально `status=processed`. | Coolify не задеплоил сразу (webhook не сработал — см. ниже). После ручного redeploy: **403**. |
| #472 | Распознавать Spring `CookieTheftException` (500 + remember-me mismatch) как auth-recoverable → refresh cookie + retry. | Реальный отдельный баг, починен. Не про этот 403. |
| #473 | Добавили `Authorization: Basic` от **backoffice**-creds (sheerly@bot.ru). | **403** (та учётка не для API). |
| #474 | Переключили Basic на **API**-creds (nx815). | **401** (слали Basic БЕЗ cookie — изолированный Basic не аутентифицирует). |
| #475 | Откат к **cookie-only** + диагностический лог тела 401/403. Потом (доп. коммит, вошёл в main через squash) — **cookie + Basic вместе** (точно как Make). | **403 forbidden** ← мы здесь сейчас. |

### Эмпирически проверенные факты про `/action`
- Только Basic (без cookie) → **401**.
- Только cookie (без Basic) → **403**.
- Cookie + Basic (схема Make) → **403 forbidden** ← с cookie от `sheerly@bot.ru`.
- Прямой curl с Make-Basic `nx815:VBsZyM8Q` без cookie → **401** (Basic там не
  аутентифицирует сам по себе — bystander; реальная identity из cookie).

## Доступ к проду / окружению

- **SSH:** `ssh root@185.178.44.60`. Прод-app контейнер — имя начинается с
  `ksg0sco00sw804c4c088wo48-...`, образ `ksg0sco00sw804c4c088wo48:<commitsha>`.
  Env `INTEGRATIONS_ENCRYPTION_KEY` внутри контейнера (для шифровки creds).
- **Supabase (self-hosted):** контейнер `supabase-db-jk8o8os4wowowg088ksckcc4`,
  `psql -U supabase_admin -d postgres`. Аккаунт пользователя:
  `account_id = 8c548df4-0ba8-4267-bc8a-66b1ce1a6d72`.
- **Connection:** `integration_connections` (account выше) —
  `login='nx815'`, `backoffice_login='sheerly@bot.ru'`,
  `password_*` = API-creds, `backoffice_password_*` = bot-creds.
- **Coolify webhook не срабатывает на merge** — пользователь редеплоит вручную
  (Coolify dashboard → приложение → Redeploy). Это отдельная проблема, можно
  глянуть позже.

## Креды из Make (от пользователя, для справки — НЕ печатать в логи/коммиты)
- Owner login: `chillingmoscow@gmail.com` / пароль владельца (портальный).
- API Basic: `base64('nx815:VBsZyM8Q')` = `bng4MTU6VkJzWnlNOFE=`.
- Host'ы `chilling.quickresto.ru` == `nx815.quickresto.ru` (алиасы).

## Затронутые файлы
- `src/lib/integrations/quickresto/client.ts` — `processInventoryDocumentBackOffice`
  (прямой fetch, cookie+Basic, минимум headers).
- `src/app/(dashboard)/inventory/actions-shared.ts` —
  `processBackOfficeInventoryDocumentWithSession` (auth-retry, decrypt API-creds).
- `src/app/(dashboard)/inventory/actions.ts` — `finalizeInventoryResults`
  (QR push → локальный `status='processed'`; ранний return по
  `results_finalized_at`; сброс `results_reopened_at` при повторной финализации).
- `docs/quickresto-integration.md` — постоянная дока по интеграции (2 слоя).
- Память: `quickresto_backoffice_auth.md`.

## Не забыть (хвосты)
- На проде есть акты с «висящим» локальным `results_finalized_at`, но НЕ
  проведённые в QR (СВ300/СВ301/СВ309 и др.) — после починки решить: чистить
  `results_finalized_at` (один UPDATE) или прогнать через reopen.
- В `docs/quickresto-integration.md` плейсхолдер **TBD** для ссылки на офиц.
  API-доку QR — пользователь обещал прислать.
