# Текущая модель мультитенантности в crm

> Статус на 20 мая 2026 (актуальные миграции 001–204).
>
> Документ описывает **что есть сейчас**, без планов и предложений. Используется как референс для дальнейшей работы.

---

## 1. Иерархия — три уровня

```
auth.users (Supabase Auth, не наша)
    ↓ 1:1 (через trigger handle_new_user)
profiles                 ← запись о реальном человеке
    ↓ 1:N (как accounts.owner_id)
accounts                 ← "тенант / workspace владельца"
    ↓ 1:N (legal_entities.account_id)
legal_entities           ← юрлица аккаунта (ИП Иванов, ООО «Молоко»)
    ↓ 1:N (venues.default_legal_entity_id)
venues                   ← физические заведения

profiles ←→ venues       ← через user_venue_roles (membership)
                           role_id → roles (venue-scoped) → role_permissions → permissions
```

Три уровня появились в миграции 032 (legal_entities) и 033 (venues.default_legal_entity_id). Транзакции и банковские счета привязываются и к account, и к legal_entity — отчётность строится по конкретному юрлицу, а консолидация — по аккаунту.

---

## 2. Что значит каждая таблица

### `auth.users`
Стандартная таблица Supabase Auth. Email, password hash, метаданные. Мы её не редактируем напрямую.

### `profiles`
**Это пользователь системы.** Один пользователь = одна запись.

```sql
profiles (
  id              uuid PK = auth.users.id  -- 1:1 связь
  first_name      text
  last_name       text
  phone           text
  photo_url       text
  active_venue_id uuid → venues             -- какое venue сейчас активно
  created_at      timestamptz
  -- расширенные поля из миграции 011: gender, birth_date, telegram_id,
  --   address, employment_date, avatar_url, medical_book_*, passport_photos
  -- и из 030: terminal_pin
)
```

Создаётся **автоматически** триггером `handle_new_user` при появлении записи в `auth.users` (миграция 004).

### `accounts`
**Это НЕ юридическое лицо.** Это **«аккаунт владельца»** — тенант-контейнер для одного человека и его заведений.

```sql
accounts (
  id          uuid PK
  name        text         -- название бренда / сети
  logo_url    text         -- логотип
  owner_id    uuid → profiles  -- кто владелец
  created_at  timestamptz
)
```

**В комментарии к таблице буквально написано:** «Аккаунты владельцев (один владелец — один аккаунт)».

**Что есть и чего нет:**
- ✅ Название бренда
- ✅ Логотип
- ✅ Owner (человек)
- ❌ ИНН, ОГРН, КПП
- ❌ Юридическая форма (ИП / ООО / АО)
- ❌ Юр.адрес
- ❌ Налоговая система
- ❌ Банковские реквизиты
- ❌ Контакты для счетов и документов

Иными словами, **это «рабочее пространство»**, как workspace в Notion или organization в Linear, а не юридический субъект.

**На уровне БД:** нет `UNIQUE(owner_id)` — теоретически один человек может быть owner-ом нескольких аккаунтов. На практике приложение этого не использует, но это не enforce'ится в схеме.

### `venues`
**Это физическое заведение.**

```sql
venues (
  id            uuid PK
  account_id    uuid → accounts   -- к какому тенанту принадлежит
  name          text
  logo_url      text
  type          venue_type        -- restaurant/bar/cafe/club/other
  address       text              -- физический адрес
  phone         text
  currency      text              -- валюта учёта (RUB по умолчанию)
  timezone      text              -- часовой пояс (Europe/Moscow)
  working_hours jsonb             -- {"mon": {"open": "10:00", "close": "23:00"}, ...}
  website       text              -- из миграции 026
  created_at    timestamptz
)
```

В venues **есть** только данные о физической точке. Юридических реквизитов **тоже нет**.

### `roles`
Должности. **С миграции 170 venue-scoped**: каждое заведение имеет независимый набор должностей.

```sql
roles (
  id            uuid PK
  venue_id      uuid → venues NULL  -- NULL = системная роль (owner)
  name          text                -- "Бармен", "Управляющий", ...
  code          text                -- 'owner', 'custom_manager', 'custom_bartender', ...
  department_id uuid → departments NULL
  icon, icon_color, comment, created_at/by, updated_at/by
  UNIQUE (code, venue_id)
  CHECK (venue_id IS NOT NULL OR code = 'owner')
)
```

**Системная роль** (одна — `owner`, `venue_id IS NULL`) — заведена в миграции 002, доступна всем authenticated. После миграции 138 другие системные роли (manager/admin/…) убраны — они теперь venue-scoped кастомки.

**Кастомные роли** (`venue_id = X`) — создаются в конкретном заведении. Преcет из 5 ролей (Управляющий/Администратор/Бухгалтер/Хостес/Официант) автоматически сидится при создании venue через `seed_default_venue_roles(p_venue_id)`. Дальше каждое заведение конфигурирует независимо.

**История**: до миграции 170 роли были account-scoped (общие на весь аккаунт). Stages A-D (миграции 166-170) клонировали их на каждый venue и переподключили UVR/invitations. Один аккаунт с N venues = N независимых наборов ролей.

### `permissions`
Реестр прав. Каталог разбит на модули, источник истины — `INSERT INTO public.permissions` в миграциях: 002 (исходный seed), 034 (greenfield wipe + people.*), 042 (finance.*), 055/068–076/080 (kb.*), 154/172 (org.*). UI-группировка по модулям для редактора прав — [permission-modules.ts](src/app/(dashboard)/people/roles/[roleId]/_components/permission-modules.ts).

| Модуль | Назначение |
|---|---|
| `people.*` | Сотрудники, должности, подразделения, приглашения |
| `finance.*` | Транзакции, счета, контрагенты, категории, юрлица |
| `kb.*` | База знаний: чтение, редактирование, обязательное прочтение |
| `org.*` | Аккаунт, заведения, журнал событий |

`platform.*` из исходной миграции 002 был полностью вычищен в миграции 034 (см. memory `permissions_wipe_policy.md`) — права теперь живут в доменных модулях.

### `role_permissions`
Матрица «роль → право». После Stage D (миграции 166–172) роли venue-scoped, поэтому права тоже фактически venue-specific — каждое заведение конфигурирует свои должности независимо.

```sql
role_permissions (
  role_id        uuid → roles
  permission_id  uuid → permissions
  granted        boolean
  PK (role_id, permission_id)
)
```

`owner` (системная, `venue_id IS NULL`) — единственная роль с правами по умолчанию из seed-миграций, и она не редактируется ни в UI, ни через RPC (защита в `set_effective_role_permission`). Остальные роли создаются при `seed_default_venue_roles(p_venue_id)` (миграция 167) — пресет из 5 ролей с дефолтными правами, далее владелец меняет каждую вручную.

**История override-таблиц.** Раньше существовала `account_role_permissions` (миграция 022) — она позволяла переопределить дефолты системных ролей на уровне аккаунта. В миграции 138 системные роли (кроме owner) были клонированы в каждый аккаунт как кастомные, и таблица была удалена — override-семантика умерла, права редактируются напрямую в `role_permissions` за каждой ролью.

### `user_venue_roles`
Связь «пользователь — заведение — роль». Это и есть membership.

```sql
user_venue_roles (
  id          uuid PK
  user_id     uuid → profiles
  venue_id    uuid → venues
  role_id     uuid → roles
  status      text     -- 'active', 'fired', ... (из миграции 012)
  fired_at    timestamptz
  invited_by  uuid → profiles
  -- + расширенные поля из миграции 011 (для employees)
  employment_date, address и т.д.
  created_at  timestamptz
  UNIQUE (user_id, venue_id)
)
```

Один пользователь может иметь membership **в нескольких venues одновременно**, и **в каждом — со своей ролью**. Например: владелец сети — `owner` во всех своих venues; нанятый менеджер — `manager` в одной точке и `admin` в другой.

### `invitations`
Приглашения сотрудников.

```sql
invitations (
  id          uuid PK
  venue_id    uuid → venues       -- в какое venue приглашаем
  email       text                -- email приглашённого
  role_id     uuid → roles        -- какую роль выдадим
  invited_by  uuid → profiles
  status      enum (pending/accepted/expired)
  created_at  timestamptz
  expires_at  timestamptz default now() + 7 days
)
```

Приглашение → email с magic link → пользователь регистрируется → вызывается `accept_invitation(p_invitation_id)` → создаётся `user_venue_roles`.

---

## 3. Концепция «активности»

Это самая важная штука для понимания, как работают права и RLS.

В каждый момент времени пользователь **находится в контексте одного venue**. Это venue хранится в `profiles.active_venue_id`.

Из активного venue автоматически выводятся:

```sql
-- Активное venue (только если есть active membership в нём, миграция 020)
get_active_venue_id() = profiles.active_venue_id  WHERE есть user_venue_roles.status='active'

-- Активный аккаунт = тенант через активное venue
get_active_account_id() = venues[active_venue_id].account_id

-- Текущая роль и её эффективные права
has_permission(code) = есть user_venue_roles.role_id, у которой
                       либо в account_role_permissions[active_account_id] granted=true,
                       либо (если override нет) в role_permissions granted=true
```

**Следствия:**
1. Все RLS-политики проверяют `account_id = get_active_account_id()` или `venue_id = get_active_venue_id()` — отсюда тенантная изоляция.
2. Если пользователь не имеет активного membership в активном venue (например, его уволили), `get_active_venue_id()` возвращает NULL, и **все RLS-проверки фейлятся** → пользователь ничего не видит.
3. В UI есть `venue-switcher` для переключения между venues, в которых у меня есть membership.

---

## 4. Жизненный цикл данных

### Регистрация нового владельца

```
1. Пользователь регистрируется (auth.users INSERT)
   → trigger handle_new_user создаёт пустой profiles
2. Пользователь проходит онбординг (вводит данные компании, заведения)
3. Frontend вызывает RPC complete_owner_onboarding(...)
4. Функция (миграция 004 + обновления):
   a. Создаёт accounts (name=название бренда, owner_id=auth.uid())
   b. Создаёт venues (account_id=новый, name, type, address, currency, timezone, ...)
   c. Назначает пользователя как owner в этом venue (user_venue_roles)
   d. Устанавливает profiles.active_venue_id = новое venue
   e. Возвращает {account_id, venue_id}
```

### Приглашение сотрудника

```
1. Manager в venue X создаёт приглашение
   → invitations (venue_id=X, email='ivan@...', role_id=waiter)
   → отправляется email с magic link
2. Пользователь переходит по ссылке, регистрируется/логинится
3. Frontend вызывает RPC accept_invitation(invitation_id)
4. Функция:
   a. Проверяет email совпадает с auth.uid().email
   b. Создаёт user_venue_roles (user_id=auth.uid(), venue_id=X, role_id=waiter)
   c. Если active_venue_id у пользователя был NULL — ставит venue X
   d. Помечает invitation как accepted
```

### Увольнение

С миграции 012 у `user_venue_roles` есть `status` и `fired_at`. Увольнение — это `UPDATE user_venue_roles SET status='fired', fired_at=now()`.

После этого:
- `get_active_venue_id()` для уволенного возвращает NULL.
- Все RLS-проверки фейлятся.
- Пользователь видит «нет доступа» и не может работать с данными.

---

## 5. Правила scope — куда привязывать новую сущность

В системе сосуществуют четыре уровня привязки данных. Большая часть нерешённых архитектурных вопросов сводится к выбору одного из них при добавлении новой таблицы. Этот раздел — правила, по которым этот выбор делается, и обоснование текущей раскладки.

### 5.1 Четыре уровня

| Scope | Колонка-якорь | Что туда кладём |
|---|---|---|
| **account** | `account_id` | Общие справочники компании, контент, HR-данные сотрудника, аналитика по всему бренду |
| **legal_entity** | `legal_entity_id` (часто + `account_id`) | Юридически закреплённые данные: банковские реквизиты, счета, документы юрлица |
| **venue** | `venue_id` | Операционка конкретной точки: должности, подразделения, графики, залы, приглашения |
| **user** | `user_id` (= profile id) | Личные данные человека: профиль, избранное в KB, прочитанное, нотификации |

### 5.2 Как выбирать

Решает не «логически где находится» — решает **«один и тот же объект используется на нескольких уровнях или нет»**:

- **Один поставщик биллит в несколько venues?** → account (контрагенты).
- **Один план счетов должен сводиться в отчёт по всему бренду?** → account (категории).
- **Должность бариста есть только в кофейне, а су-шеф — только в стейк-хаусе?** → venue (роли).
- **Расчётный счёт принадлежит конкретному ИП?** → legal_entity (банковские счета).
- **Медкнижка одна на человека независимо от того, в каком venue он работает?** → user через `(account_id, user_id)` (HR-данные).

Главный анти-паттерн — **дублирование справочника на каждое venue**. Если в кейсе «кофейня + стейк-хаус» у владельца получится два списка одинаковых поставщиков — это плохой дизайн. Контрагенты должны быть на account, а фильтр «этот поставщик используется в этом venue» — задача транзакций (через `venue_id` в `transactions`).

### 5.3 Текущая раскладка

#### Финансы (модуль `finance`)

| Сущность | Scope | Почему так |
|---|---|---|
| `legal_entities` | account | юрлица аккаунта (ИП/ООО), несколько в одной сети |
| `bank_accounts` | account + legal_entity + venue (опц.) | счёт принадлежит юрлицу; venue_id опционально маркирует «используется только в venue X» |
| `counterparties`, `counterparty_groups` | **account** | один поставщик может биллить в несколько заведений сети — дублировать справочник было бы анти-паттерном |
| `finance_categories`, `finance_category_groups` | **account** | план счетов общий для всего бренда: иначе ломается консолидированная отчётность; venue-разрез делается фильтром по `transactions.venue_id`, а не разными справочниками |
| `transactions` | account + legal_entity + venue (опц.) | транзакция всегда происходит в конкретном юрлице, а venue опционально (есть общие расходы аккаунта — лицензии, юр услуги) |

**Почему контрагенты и категории НЕ venue-scoped** (зафиксировано как решение, май 2026): в реальной сети один поставщик мяса обычно работает со всеми точками одного юрлица; один счёт «Аренда» нужен в общей P&L. Если со временем появится требование «у каждого venue свой пул поставщиков» — это решается не сменой scope, а добавлением m2m-таблицы `counterparty_venue_links` поверх существующей account-scoped таблицы.

#### Люди (модуль `people`)

| Сущность | Scope | Почему так |
|---|---|---|
| `profiles` | user | один человек = одна запись, шарится между accounts |
| `roles` | **venue** (после Stage D) | у кофейни и стейк-хауса разные должности и разный набор прав |
| `departments` | **venue** (после Stage D) | подразделения специфичны для точки (бар-зона vs кухня) |
| `user_venue_roles` | venue | membership с ролью в конкретной точке |
| `invitations` | venue | приглашение всегда в конкретную точку с конкретной ролью |
| `staff_account_details` | account + user (PK по `account_id, user_id`) | HR-данные сотрудника (медкнижка, паспорт, дата трудоустройства) — одни на всю сеть в рамках одного работодателя |

#### Инвентаризация / номенклатура (модуль `inventory`)

| Сущность | Scope | Почему так |
|---|---|---|
| `ingredients`, `ingredient_groups` | **account** | единый каталог на бренд (см. обоснование ниже) |
| `stores` | account + venue (через `local_venue_id`) | физический склад привязан к точке, остатки считаются per-store |
| `documents`, `document_items` | account + venue (опц.) | акт инвентаризации происходит в конкретном venue |
| `ingredient_suppliers` | account | m2m «ингредиент ↔ контрагент»; оба родителя account-scoped |

**Почему ingredients и ingredient_groups account-level** (зафиксировано как решение, май 2026):

Это **индустриальный стандарт** обоих ключевых POS-провайдеров российского рынка:

- **Quick Resto** (наш текущий интегратор): `/api/list?moduleName=warehouse.nomenclature.dish|ingredient` отдаёт **одну плоскую коллекцию на предприятие**, без spot-фильтра. Один и тот же ингредиент существует в нескольких складах одновременно, остатки — per-warehouse.
- **Poster** (joinposter.com): `storage.getIngredients` + `menu.getCategories` — account-level. Документация явно: «lemons may be used in the kitchen to prepare salads and in the bar for cocktails» — один ingredient, разные storage-локации списывают разные количества.

**Что было бы при venue-level** (антипаттерн):
- При синке из QR пришлось бы либо дублировать каждый ингредиент на N venues (3000-5000 позиций × N), либо изобретать дедупликацию по QR external_id с нетривиальным маппингом при обновлениях каталога.
- Феatures, основанные на консолидации каталога (отчёты «топ-10 ингредиентов сети», единые рецептуры), стали бы значительно дороже.

**Где per-venue срез реально нужен** — это **остатки и операции**, не каталог:
- Остатки: `(ingredient_id, store_id)` композит (через `stores.local_venue_id`).
- Акты инвентаризации: `documents.venue_id` (миграция 194).
- Себестоимость per-venue — через средневзвешенную по приходам в актах (когда сценарий встанет).

**Если в будущем понадобится per-venue customization** (alias, локальное название, отличающаяся группировка под управляющего конкретной точки) — это **надстройка**, а не замена scope. Делается отдельной таблицей `ingredient_venue_overrides (account_id, venue_id, ingredient_id, alias?, local_description?, custom_group_id?)`. Базовый каталог остаётся account-level — это инвариант от POS-моделей и от логики синка.

Smart-defaults в UI (`/catalog/ingredients`): для single-venue аккаунта toggle «этого заведения / весь каталог» **скрыт** (фильтр бессмыслен); для multi-venue — доступен, фильтрует ингредиенты по тем, что встречаются в актах документов venue.

#### База знаний (модуль `kb`)

Все KB-таблицы (`kb_pages`, `kb_collections`, `kb_comments`, `kb_threads`, `kb_page_versions`, `kb_page_links`, `kb_templates` и все user-mention/read-tracking таблицы) **account-scoped**. Документация компании — общая на бренд. Venue-разрез делать не планируется: «инструкция по обращению с эспрессо-машиной» нужна и в кофейне, и в кафе сети, и стоимость поддержки двух копий перевешивает гипотетическую гибкость.

#### Контейнер / журнал / интеграции

| Сущность | Scope |
|---|---|
| `audit_logs` | account (обязательно) + venue/legal_entity (опционально) |
| `account_files`, `external_entity_links`, `integration_*` | account |
| `venue_halls` | venue |
| `notifications` | user + venue (опционально, для маршрутизации) |

### 5.4 Решающее дерево для новых таблиц

Когда добавляется новая сущность, идём по чек-листу сверху вниз:

1. **Это про конкретного человека и переезжает с ним между компаниями?** → `user_id` (как `profiles`, `email_change_requests`, `kb_user_favorites`).
2. **Это юридически закреплено за субъектом (счёт, договор, документ юрлица)?** → `legal_entity_id` + `account_id`.
3. **Это специфично для одной физической точки и должно быть независимым у разных точек?** → `venue_id`.
4. **Иначе (справочник, контент, аналитика бренда)** → `account_id`.

Если правило 3 и 4 спорят — выигрывает 4 (account), и при появлении реального требования делать venue-разрез добавляется m2m-связь, а не меняется scope. Смена scope — операция уровня Stage A–D (4 PR, миграция данных, прод-даунтайм).

---

## 6. Что НЕ покрывает текущая модель

Эти кейсы существуют в реальности, но в схеме сейчас не отражены:

### 6.1 Несколько аккаунтов на одного человека
Технически на уровне БД допустимо (нет UNIQUE на `accounts.owner_id`), но приложение нигде это не использует. Если человек хочет управлять двумя независимыми бизнесами — нет UI и логики переключения между аккаунтами.

### 6.2 Биллинг и подписка
Нет понятий «тарифный план», «оплата подписки», «лимиты по тарифу» — ни на уровне аккаунта, ни на уровне venue.

### 6.3 Мультивалютность на уровне компании
У `venues.currency` есть, но это только валюта учёта одной точки. Нет «отчётной валюты компании» для агрегации между venues с разными валютами.

### 6.4 M2M-связи поверх account-scoped справочников
Если со временем потребуется «у каждого venue свой пул поставщиков / категорий» — это решается m2m-таблицей поверх существующих account-scoped справочников (`counterparty_venue_links`, `finance_category_venue_links`), без смены scope. Сейчас такой потребности нет.

---

## 7. Что важно знать перед расширением

### 7.1 RLS работает через `get_active_*` функции

Все будущие RLS-политики должны опираться на эти функции:

```sql
-- Глобально по тенанту
account_id = public.get_active_account_id()

-- По активному venue
venue_id = public.get_active_venue_id()

-- По правам
public.has_permission('finance.create_transaction')
```

Это **проверенный паттерн**, и его не стоит менять.

### 7.2 Системные роли универсальны, кастомные локальны

При добавлении новых прав:
- **Дефолты для системной роли owner** — обновить `role_permissions` в новой миграции (одна запись на permission).
- **Дефолты для venue-роли** — обновить пресет в `seed_default_venue_roles` (миграция 167); существующие venues не получат новое право автоматически, только новые.
- **Кастомные роли** — владелец редактирует напрямую через UI `/people/roles`.

`account_role_permissions` больше нет (удалена в 138); override-семантика умерла вместе с ней.

### 7.3 Активный venue не выбран — пользователь «слепой»

Сразу после регистрации владельца, до завершения онбординга, у `profiles` нет `active_venue_id`. В этот момент **все RLS-политики выдают пустые результаты**. Это нормально, но фронт должен это обрабатывать (редирект на онбординг).

### 7.4 Смена scope — операция «4 PR + миграция данных»

Stage A–D (миграции 166–172) по переводу roles/departments с account-scope на venue-scope заняли четыре PR с обратной совместимостью на каждом этапе и риском прод-даунтайма на data migration. Если возникает соблазн поменять scope существующей таблицы — сначала рассматривается m2m-таблица (см. 6.4), и только если она не покрывает кейс, открывается план «Stage A–D».

### 7.5 SECURITY DEFINER функции обязаны проверять tenant

Любой SECURITY DEFINER, принимающий идентификатор (например, `p_venue_id`), обязан явно проверить, что объект принадлежит активному аккаунту caller'а. RLS внутри такого тела не работает — он считается «привилегированным» вызовом. Образец guard'а — `get_departments_with_counts` после фикса в миграции 173.

---

## 8. Резюме

**Что в crm есть сейчас:**

- ✅ Трёхуровневая иерархия: `account` → `legal_entities` → `venues`.
- ✅ `profiles` (1:1 c auth.users) с расширенными ПДн.
- ✅ Membership через `user_venue_roles` со статусами active/fired.
- ✅ Роли и подразделения — **venue-scoped** (Stage D, миграции 166–172).
- ✅ Финансовые справочники (контрагенты, категории) — account-scoped; счета и транзакции — account + legal_entity + опционально venue.
- ✅ RLS через helper-функции `get_active_*` и `has_permission`; SECURITY DEFINER функции защищены явным tenant-guard.
- ✅ Права в модулях `people.*`, `finance.*`, `kb.*`, `org.*`; легаси `platform.*` вычищен в 034.
- ✅ Глобальный audit log (`audit_logs`, миграция 035 + расширения 154/158/172).
- ✅ Триггеры автосоздания profile, RPC для онбординга и приглашений.

**Чего нет:**

- ❌ Биллинга и тарифов.
- ❌ Поддержки нескольких аккаунтов у одного человека на уровне UI.
- ❌ Сводной валюты компании (только per-venue `currency`).
- ❌ M2M-таблиц venue-частных подмножеств account-справочников (пока не требуется).

Эти пробелы и закрывает план слияния `MERGE_PLAN.md`.
