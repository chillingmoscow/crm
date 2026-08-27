# Интеграция с Quick Resto

Документ описывает, как наша система взаимодействует с Quick Resto: какие
слои API мы используем, какая у них аутентификация, какие хосты и какие
требования к учётке.

> **TL;DR**
>
> | Слой | Хост | Auth | Кого аутентифицирует | Для чего используется |
> |---|---|---|---|---|
> | **Public API** | `<layer>.quickresto.ru/platform/online/api` | `Authorization: Basic` (API login + API password) | API-юзер аккаунта (у нас — `nx815`) | Чтение справочников (`list`/`read`/`update`) — синхронизация QR → наша система. |
> | **Backoffice** | `<layer>.quickresto.ru/platform/data/...` | session cookie из `/platform/j_spring_security_check` + (для state-changing actions) `Authorization: Basic` | Backoffice-пользователь, чья учётка использовалась в login (у нас — **`sheerly@bot.ru`**) | Запись и проведение документов: `items/create`, `document.v2/action` (provesti), и т.п. |
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

## Слой 2. Backoffice (через cookie конкретного пользователя)

**URL**: `https://<host>.quickresto.ru/platform/data/<path>?<query>` (где host — любой из алиасов, см. выше).

**Метод**: `POST` (Spring REST data-grid).

**Auth — пошагово**:

1. **Login**:
   `POST https://<layerName>.quickresto.ru/platform/j_spring_security_check`
   form-urlencoded body:
   `j_username=<email backoffice-юзера>&j_password=<его пароль>&j_rememberme=true`
   Spring при успехе ставит cookies (`JSESSIONID`, `SPRING_SECURITY_REMEMBER_ME_COOKIE`,
   возможно ещё app-specific). Cookie сетится на родительский домен `.quickresto.ru` —
   значит работает на обоих алиасах.
2. **Любой backoffice-вызов**:
   шлём header `Cookie: <session-cookies>`. Spring аутентифицирует сессию по
   `JSESSIONID`/`remember-me` и далее авторизует по **роли** пользователя в QR.

> **У нас backoffice-юзер всегда `sheerly@bot.ru`** (поле
> `integration_connections.backoffice_login` + `backoffice_password_*`).
> Свой собственный аккаунт владельца (`chillingmoscow@gmail.com`) мы НЕ кладём,
> чтобы интеграция работала через выделенного бот-пользователя.

**Важно про доступы**. Backoffice-слой авторизует по **должности (role)** этого
пользователя в QR. Если у `sheerly@bot.ru` не выдана нужная должность с
правами на конкретное действие — Spring отдаст `403 Forbidden` (на уровне
фильтра, **до бизнес-логики**). Это не баг кода — это конфиг QR. Должность
выдаётся в самом QR-backoffice (Настройки → Сотрудники / Должности).

### State-changing actions (provesti акт, create item, и т.п.)

Для **state-changing** эндпоинтов вида `/platform/data/<module>/action`
(`actionName: "process"` и аналоги) Spring дополнительно требует **обе** auth-сущности
одновременно:

- `Cookie: …` — backoffice session (для identity).
- `Authorization: Basic base64(API_login:API_password)` — API-creds от аккаунта
  (у нас — `nx815` + `password_*`).

Без cookie на /action — `403`. Без `Authorization` Basic — `401`. С обоими — `200`.
Это проверено эмпирически и совпадает с Make-сценарием пользователя.

**Заголовки (ровно 4, ничего лишнего):**

```
Authorization: Basic <…>
Cookie: <session-cookies>
Connection: keep-alive
Content-Type: application/json; charset=utf-8
```

> ⚠️ Не добавлять `Accept`, `Origin`, `Referer` и прочее — Make их не шлёт, и
> они могут поломать какие-то Spring-фильтры (CORS, anti-CSRF, что-то ещё). Если
> нужно сделать новый backoffice action — не используй общий
> `callQuickRestoBackOfficeData` (он добавляет `Origin`/`Referer` — нужно для
> read-эндпоинтов, но мешает на `/action`). Сделай прямой `fetch` с минимальным
> набором заголовков, как `processInventoryDocumentBackOffice`.

### Read-only backoffice endpoints

Для read-эндпоинтов (`items/select`, `items/update`* (через select), `document.v2/list`)
достаточно одной session-cookie. `Authorization: Basic` НЕ нужен. Используется общий
helper `callQuickRestoBackOfficeData`, который добавляет `Origin`/`Referer` —
для read-операций это нормально.

\* `items/update` в QR — это apparently «обновление одной позиции» через grid,
который изнутри POST'ит данные. Это не state-changing «провести».

**Helpers в коде**:

- `loginQuickRestoBackOffice({ layerName, login, password })` — j_spring_security_check;
  возвращает cookieHeader.
- `getBackOfficeCookie({ connection, admin })` — берёт сохранённую cookie из БД,
  если её нет — логинится заново.
- `refreshBackOfficeCookie({ connection, admin })` — принудительный re-login.
- `callQuickRestoBackOfficeData<T>({ … cookieHeader, path, query, body })` —
  общий helper для read backoffice-вызовов (добавляет Origin/Referer).
- `processInventoryDocumentBackOffice({ … cookieHeader, basicAuthLogin, basicAuthPassword })` —
  прямой fetch с минимальными headers для state-changing `/action`.

### Семантика полей акта инвентаризации

Проверено на проде 2026-08-25/26 (акты СВ324, СВ338–СВ350).

Строка акта (`warehouse.inventory.items/select`):

| Поле QR | Смысл | Куда мапим |
| --- | --- | --- |
| `amountAtStore` (= `storeQuantity` = `storeQuantityKg`) | расчётный остаток | `calculated_amount` |
| `actualAmount` | факт, введённый при подсчёте | `actual_amount` |
| `amountTotal` | «общий фактический остаток» | — |
| `delta` | факт − расчётный | `difference_amount` |
| `differenceCost` | `delta × costPrice` | `difference_sum` |
| `costPrice` | себестоимость | `prime_cost` |

Отдельного `calculatedAmount` в payload **нет** — не искать.

**Расчётный остаток привязан к дате акта (`invoiceDate`), а не к моменту чтения.**
Продажи и поставки после даты акта его не двигают: акт СВ324 с пятидневным
разрывом между подсчётом и пересчётом показал 297 из 305 позиций без
расхождения. Меняется он только когда правят учёт за период **до** даты акта
(документы задним числом, пересчёт остатков) — так у СВ340 уехали 6 позиций на
16 212,50 ₽ уже после того, как мы прочитали акт. Практическое следствие: перед
проведением строки нужно перечитывать и сверять (`finalizeInventoryResults`).

Документ (`public API read`):

- позиции с расчётным остатком и разницей отдаёт **только** backoffice
  `items/select`. Массивы позиций public-payload (`effectedItems`,
  `prefabricatedItems`, `disassembledItems`) на живых актах приходили пустыми,
  но пустыми они бывают не всегда: `syncQuickRestoInventory` намеренно
  сваливается на них, когда backoffice недоступен, и сохраняет оттуда хотя бы
  id строк и `actualAmount`. Этот fallback рабочий — удалять его нельзя;
- `shortfallSum` / `surplusSum` заполняются **только после проведения**, до него нули;
- `className` в ответе — `…document.v2.InventoryDocument`, тогда как константа
  `INVENTORY_DOCUMENT_UPDATE_CLASS` в клиенте — `…document.InventoryDocument2`.
  При create/update это стоит проверять отдельно.
### Операции над актом инвентаризации (backoffice)

Проверено на проде 2026-08-26 (создан и удалён тестовый акт).

| Операция | Путь | Метод | Особенности |
| --- | --- | --- | --- |
| Создать акт | `warehouse.inventory.document.v2/create` | POST | акт создаётся **пустым**; `className` = `…document.v2.InventoryDocument`; public API `update` без `objectId` отвечает 400 `entityNotFound` |
| Добавить позицию | `warehouse.inventory.items/create` | POST | телом — объект-образец (raw_payload другой строки) без полей конкретной строки: `id`, `hash`, `version`, `seqNumber`, `delta`, `amountAtStore`, `actualAmount`, `costPriceSum` и т.п. Расчётный остаток QR посчитает сам, уже на дату этого акта |
| Изменить факт | `warehouse.inventory.items/update` | POST | см. `updateInventoryItemBackOffice` |
| Удалить позицию | `warehouse.inventory.items/remove` | **DELETE с телом** | обязательны `ownerContextId`, `regTime`, `hash` строки. Без тела — `Object doesn't exist`, POST — 405, `/delete` — 404 |
| Удалить акт | `warehouse.inventory.document.v2/remove` | **DELETE с телом** | обязательны `regTime`, `contextModule=warehouse.inventory.items`. После удаления акт пропадает из `list`, но прямое чтение по id всё ещё отдаёт объект — ориентироваться надо на список |
| Провести акт | `warehouse.inventory.document.v2/action` | POST | `{actionName:"process", ids:[id], data:{…}}`, нужен Basic поверх cookie |

Ключевой нюанс: `remove` — это **DELETE с телом запроса**. Именно так делает
интерфейс QR; ни POST, ни DELETE без тела не работают. Хелперы —
`createInventoryDocumentBackOffice`, `createInventoryItemBackOffice`,
`removeInventoryItemBackOffice`, `removeInventoryDocumentBackOffice`.

### Auth-retry

Backoffice cookie живёт ограниченное время; кроме того, Spring's
`SPRING_SECURITY_REMEMBER_ME_COOKIE` ротирует токен на каждый запрос. Если
наш сохранённый cookie протух или серия инвалидирована (например, пользователь
параллельно ходил в QR браузером):

- 401 → `isBackOfficeAuthError` детектит, wrapper рефрешит cookie (re-login) и
  ретраит вызов.
- 500 + `CookieTheftException` («Invalid remember-me token (Series/token) mismatch»)
  → тоже распознаётся как auth-recoverable (см. `quickresto_backoffice_auth.md`
  в памяти, PR #472).

Wrappers `listBackOfficeInventoryItemsWithSession` и
`processBackOfficeInventoryDocumentWithSession` реализуют этот auth-retry
вокруг основного вызова.

---

## Файлы в коде

| Файл | Назначение |
|---|---|
| [`src/lib/integrations/quickresto/client.ts`](../src/lib/integrations/quickresto/client.ts) | Все низкоуровневые QR-вызовы (public API + backoffice). |
| [`src/app/(dashboard)/inventory/actions-shared.ts`](../src/app/(dashboard)/inventory/actions-shared.ts) | Хелперы для backoffice с auth-retry (`getBackOfficeCookie`, `refreshBackOfficeCookie`, `*WithSession`-обёртки). |
| [`src/app/(dashboard)/inventory/actions.ts`](../src/app/(dashboard)/inventory/actions.ts) | Server actions, использующие QR (sync, finalize и т.п.). |
| [`src/app/(dashboard)/settings/integrations/quickresto/page.tsx`](../src/app/(dashboard)/settings/integrations/quickresto/page.tsx) | UI настройки интеграции (creds). |
| [`src/app/(onboarding)/onboarding/actions.ts`](../src/app/(onboarding)/onboarding/actions.ts) | Онбординг — первичная настройка интеграции. |

---

## Граблики (распространённые)

1. **403 на `/action` при валидной cookie** — у backoffice-пользователя
   (`sheerly@bot.ru`) **не выдана должность с нужными правами** в QR. Лечится
   только в QR-админке (выдать роль), не кодом. **Подтверждено и закрыто
   2026-06-02**: blueprint Make ходит под владельцем `chillingmoscow@gmail.com`,
   у которого право есть; после выдачи боту системной роли на проведение
   инвентаризации `/action` стал отдавать 200. См. `quickresto_backoffice_auth.md`.
2. **401 на `/action` с только Basic Auth (без cookie)** — Spring у /action
   хочет ОБА: и cookie, и Basic. Один Basic не аутентифицирует.
3. **CookieTheft 500** при параллельной сессии пользователя в QR — лечится
   автоматическим re-login (PR #472).
4. **Разные user-пулы API vs backoffice**: креды API-пользователя
   (`nx815:<API_pwd>`) **НЕ совпадают** с креды backoffice-пользователя
   (`sheerly@bot.ru:<bot_pwd>`). Это два разных пользователя в QR. Mixing
   неаккуратно — частая ошибка (мы её несколько раз делали).
5. **Не добавлять лишних заголовков на `/action`** (Accept/Origin/Referer) —
   ломает Spring-фильтры; пользоваться прямым `fetch`, не `callQuickRestoBackOfficeData`.

---

## Источники

- Этот документ.
- Память: `quickresto_backoffice_auth.md` — конкретные кейсы 401/403 и
  CookieTheft, найденные эмпирически.
- Make-сценарии пользователя — точный pattern login+action, по которому мы
  выровняли свой backoffice-вызов (см. PR #471 → #475).
- Официальная документация Quick Resto API: **_TBD — добавить ссылку_**.
