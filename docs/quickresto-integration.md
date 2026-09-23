# Интеграция с Quick Resto

Документ описывает, как наша система взаимодействует с Quick Resto: какие
слои API мы используем, какая у них аутентификация, какие хосты и какие
требования к учётке.

> **TL;DR**
>
> | Слой | Хост | Auth | Кого аутентифицирует | Для чего используется |
> |---|---|---|---|---|
> | **Public API** | `<layer>.quickresto.ru/platform/online/api` | `Authorization: Basic` (API login + API password) | API-юзер аккаунта (у нас — `nx815`) | Чтение справочников (`list`/`read`/`update`) — синхронизация QR → наша система. |
> | **Backoffice** | `<layer>.quickresto.ru/platform/data/...` | `Authorization: Bearer <access_token>` из Keycloak (OIDC) | Backoffice-пользователь, чья учётка использовалась в login (у нас — **`sheerly@bot.ru`**) | Запись и проведение документов: `items/update`, `document.v2/action` (provesti), и т.п. |
>
> Ссылка на официальную документацию QR API: **_TBD — добавить ссылку, пользователь пришлёт_**.

---

## Хосты

**`chilling.quickresto.ru` и `nx815.quickresto.ru` — один и тот же хост (алиасы).**
Quick Resto на каждый аккаунт выдаёт два DNS-имени:

- `<tenant>.quickresto.ru` — короткое «бренд» имя ресторана (у нас — `chilling`).
- `<layerName>.quickresto.ru` — техническое имя по `layerName` владельца аккаунта (у нас — `nx815`).

Оба резолвятся в один и тот же бэкенд, ходить можно по любому. В коде в качестве
канонического используется `<layerName>.quickresto.ru` (поле
`integration_connections.login` хранит `layerName`). В Make-сценариях
пользователь использует `chilling.quickresto.ru` — оба варианта эквивалентны.

В коде хост строится в [`src/lib/integrations/quickresto/client.ts`](../src/lib/integrations/quickresto/client.ts):

- `buildBaseUrl(layerName)` → `https://<layerName>.quickresto.ru/platform/online/api` (public API).
- `buildQuickRestoBackOfficeOrigin({ layerName })` → `https://<layerName>.quickresto.ru` (backoffice).

---

## Слой 1. Public API

**URL**: `https://<layerName>.quickresto.ru/platform/online/api/<path>?moduleName=…&className=…[&objectId=…]`

**Метод**: `GET` для `list`/`read`, `POST` для `update` (и для list, если есть body).

**Auth**: HTTP `Authorization: Basic base64(API_login:API_password)` — это
**API-пользователь аккаунта** (у нас в БД: `integration_connections.login`,
`integration_connections.password_*`). У нашего аккаунта это `nx815`.

Заголовки:

```
Authorization: Basic <…>
Connection: keep-alive
Content-Type: application/json
```

**Что умеет**: только то, что отдаёт публичный API — справочники
(ингредиенты, склады, должности, сотрудники, столы), документы инвентаризации,
обновление атрибутов документов. Это «read-mostly» слой.

**Что НЕ умеет**: бизнес-операции backoffice (создание позиций инвентаризации,
проведение актов, изменение остатков и т.п.). Они доступны только через
backoffice-слой (см. ниже).

**Helpers в коде**: `callQuickResto<T>(...)` в
[`src/lib/integrations/quickresto/client.ts`](../src/lib/integrations/quickresto/client.ts).
Все exported-функции, у которых в сигнатуре `login`+`password`, используют именно
этот слой: `listInventoryDocuments`, `readInventoryDocument`,
`updateInventoryDocument`, `listStores`, `listIngredientTreeItems`, `listEmployees`,
`listRoles` и т.д.

---

## Слой 2. Backoffice (Bearer-токен из Keycloak)

**URL**: `https://<host>.quickresto.ru/platform/data/<path>?<query>` (где host — любой из алиасов, см. выше).

**Метод**: `POST` (Spring REST data-grid).

**Auth — пошагово**:

1. **Вход в Keycloak (OIDC authorization-code, headless)** — `loginQuickRestoBackOffice`:
   1. `GET https://id.quickresto.ru/realms/QR/protocol/openid-connect/auth`
      query: `client_id=qrbo-frontend`, `redirect_uri=https://<layerName>.quickresto.ru/`,
      `response_type=code`, `scope=openid`, `response_mode=query`.
      Из HTML-страницы логина извлекается `loginAction` (URL-шага формы),
      cookies копятся между шагами (merge по имени, как в n8n).
   2. `POST <loginAction>` form: `identifier=<login>&identifierType=loginOrEmail` → новый `loginAction`.
   3. `POST <loginAction>` form: `password=<password>` → в `Location` приходит
      redirect с `?code=…`. Нет redirect ⇒ неверный логин/пароль.
   4. `POST https://id.quickresto.ru/realms/QR/protocol/openid-connect/token`
      form: `grant_type=authorization_code&code=…&redirect_uri=…&client_id=qrbo-frontend`
      → `access_token` + `expires_in`.
2. **Любой backoffice-вызов**: шлём `Authorization: Bearer <access_token>`.
   Токен аутентифицирует и идентифицирует backoffice-пользователя; дальше
   авторизация идёт по **роли** этого пользователя в QR.

> **У нас backoffice-юзер всегда `sheerly@bot.ru`** (поле
> `integration_connections.backoffice_login` + `backoffice_password_*`).
> Свой собственный аккаунт владельца (`chillingmoscow@gmail.com`) мы НЕ кладём,
> чтобы интеграция работала через выделенного бот-пользователя.

**Хранение токена**: в `integration_connections.backoffice_cookie_{encrypted,iv,tag}`
(историческое имя колонок, миграция не нужна) лежит зашифрованный JSON
`{ authorization, expiresAt }`; `expiresAt` = now + `expires_in`. Перед
использованием `getBackOfficeAuth` проверяет срок жизни (skew 60с) и при
просрочке делает re-login. Legacy-строка без JSON (старая cookie) тоже
инвалидируется рефрешем.

**Важно про доступы**. Backoffice-слой авторизует по **должности (role)** этого
пользователя в QR. Если у `sheerly@bot.ru` не выдана нужная должность с
правами на конкретное действие — сервер отдаст `403 Forbidden` (на уровне
фильтра, **до бизнес-логики**). Это не баг кода — это конфиг QR. Должность
выдаётся в самом QR-backoffice (Настройки → Сотрудники / Должности).

### State-changing actions (provesti акт, create item, и т.п.)

`/platform/data/<module>/action` (`actionName: "process"` и аналоги) — тот же
Bearer:

```
Authorization: Bearer <access_token>
Connection: keep-alive
Content-Type: application/json; charset=utf-8
```

> ⚠️ Не добавлять `Accept`, `Origin`, `Referer` — используй прямой `fetch`
> (`processInventoryDocumentBackOffice`), не `callQuickRestoBackOfficeData`.

> **Исторически** (до перехода QR на Keycloak) Spring требовал здесь **одновременно**
> cookie-сессию и `Authorization: Basic` с API-creds (без cookie → 403, без Basic → 401).
> После OIDC-миграции идентичность даёт Bearer; Basic в тот же заголовок не
> помещается (HTTP-заголовок `Authorization` один), поэтому шлём только Bearer.
> Если /action на живых данных начнёт отдавать 401/403 — смотрим тело ответа и
> уточняем у Quick Resto, нужен ли ещё один фактор.

### Read-only backoffice endpoints

Для read-эндпоинтов (`items/select`, `items/update`) достаточно одного
`Authorization: Bearer`. Используется общий helper `callQuickRestoBackOfficeData`,
который добавляет `Origin`/`Referer` — для read-операций это нормально.

**Helpers в коде**:

- `loginQuickRestoBackOffice({ layerName, login, password })` — Keycloak-флоу
  (4 шага, см. выше); возвращает `{ authorization, expiresInSeconds }`.
- `getBackOfficeAuth({ connection, admin })` — берёт сохранённый токен из БД,
  если протух/отсутствует — логинится заново.
- `refreshBackOfficeAuth({ connection, admin })` — принудительный re-login.
- `callQuickRestoBackOfficeData<T>({ … authorization, path, query, body })` —
  общий helper для read backoffice-вызовов (добавляет Origin/Referer).
- `processInventoryDocumentBackOffice({ … authorization })` —
  прямой fetch с минимальными headers для state-changing `/action`.

### Auth-retry

Access_token живёт недолго (обычно минуты). Если токен протух или отозван:

- 401/403 → `isBackOfficeAuthError` детектит, wrapper рефрешит токен
  (re-login) и ретраит вызов.
- Плюс proactive-refresh: `getBackOfficeAuth` перелогинивается за 60 секунд
  до `expiresAt`, не дожидаясь 401.

Wrappers `listBackOfficeInventoryItemsWithSession` и
`processBackOfficeInventoryDocumentWithSession` реализуют этот auth-retry
вокруг основного вызова.

---

## Файлы в коде

| Файл | Назначение |
|---|---|
| [`src/lib/integrations/quickresto/client.ts`](../src/lib/integrations/quickresto/client.ts) | Все низкоуровневые QR-вызовы (public API + backoffice). |
| [`src/app/(dashboard)/inventory/actions-shared.ts`](../src/app/(dashboard)/inventory/actions-shared.ts) | Хелперы для backoffice с auth-retry (`getBackOfficeAuth`, `refreshBackOfficeAuth`, `*WithSession`-обёртки). |
| [`src/app/(dashboard)/inventory/actions.ts`](../src/app/(dashboard)/inventory/actions.ts) | Server actions, использующие QR (sync, finalize и т.п.). |
| [`src/app/(dashboard)/settings/integrations/quickresto/page.tsx`](../src/app/(dashboard)/settings/integrations/quickresto/page.tsx) | UI настройки интеграции (creds). |
| [`src/app/(onboarding)/onboarding/actions.ts`](../src/app/(onboarding)/onboarding/actions.ts) | Онбординг — первичная настройка интеграции. |

---

## Граблики (распространённые)

1. **403 на `/action` при валидном токене** — у backoffice-пользователя
   (`sheerly@bot.ru`) **не выдана должность с нужными правами** в QR. Лечится
   только в QR-админке (выдать роль), не кодом. **Подтверждено и закрыто
   2026-06-02** (в дожspring-эру): blueprint Make ходит под владельцем
   `chillingmoscow@gmail.com`, у которого право есть; после выдачи боту
   системной роли на проведение инвентаризации `/action` стал отдавать 200.
2. **401 на `/action`** — токен протух/невалиден → автоматический re-login
   и retry (см. Auth-retry). Если рефреш не помогает — смотри тело ответа.
3. **`redirect_uri` в token exchange** должен точно совпадать со значением,
   зарегистрированным в Keycloak: код шлёт `https://<layerName>.quickresto.ru/`
   (из `buildQuickRestoBackOfficeOrigin`). Ошибка `invalid_redirect_uri` /
   `redirect_uri_mismatch` на шаге 4 флоу = нужно сверить с QR.
4. **Разные user-пулы API vs backoffice**: креды API-пользователя
   (`nx815:<API_pwd>`) **НЕ совпадают** с креды backoffice-пользователя
   (`sheerly@bot.ru:<bot_pwd>`). Это два разных пользователя в QR. Mixing
   неаккуратно — частая ошибка (мы её несколько раз делали).
5. **Не добавлять лишних заголовков на `/action`** (Accept/Origin/Referer) —
   пользоваться прямым `fetch`, не `callQuickRestoBackOfficeData`.
6. **Исторические грабли больше не актуальны** (оставлены для контекста):
   CookieTheft/remember-me (Spring cookie-сессии), 401 при Basic-only на
   `/action` — всё это из до-Keycloak эпохи.

---

## Источники

- Этот документ.
- n8n-воркфлоу пользователя «QR / Login Keycloak [sub]» — эталон нового
  headless-входа в Keycloak (auth page → identifier → password → token exchange).
- Память: `quickresto_backoffice_auth.md` — кейсы 401/403 и CookieTheft
  до-Keycloak эпохи (исторический контекст).
- Make-сценарии пользователя — исторический pattern login+action (PR #471 → #475).
- Официальная документация Quick Resto API: **_TBD — добавить ссылку_**.
