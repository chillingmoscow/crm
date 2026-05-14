# Текущая модель мультитенантности в crm

> Статус на 29 апреля 2026 (актуальные миграции 001–031 + 027 hotfix).
>
> Документ описывает **что есть сейчас**, без планов и предложений. Используется как референс для дальнейшей работы.

---

## 1. Семь ключевых таблиц

```
auth.users (Supabase Auth, не наша)
    ↓ 1:1 (через trigger handle_new_user)
profiles                 ← запись о реальном человеке
    ↓ 1:N (как accounts.owner_id)
accounts                 ← "тенант / workspace владельца"
    ↓ 1:N (как venues.account_id)
venues                   ← физические заведения

profiles ←→ venues       ← через user_venue_roles (membership)
                           role_id → roles → role_permissions → permissions
```

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
Реестр прав. Текущие коды (миграция 002):

| Code | Описание | Module |
|---|---|---|
| `platform.manage_account` | Управление аккаунтом | platform |
| `platform.manage_venues` | Создание/редактирование заведений | platform |
| `platform.manage_staff` | Управление сотрудниками | platform |
| `platform.manage_roles` | Управление ролями и правами | platform |
| `platform.view_analytics` | Просмотр аналитики | platform |
| `platform.manage_settings` | Настройки заведения | platform |

Всего **6 прав** в одном модуле `platform`. Финансовый модуль будет добавлять свой пул в модуль `finance`.

### `role_permissions`
Дефолтная матрица «системная роль → разрешённое право».

```sql
role_permissions (
  role_id        uuid → roles
  permission_id  uuid → permissions
  granted        boolean
  PK (role_id, permission_id)
)
```

Текущие дефолты для системных ролей:

| Право | owner | manager | admin | hostess | waiter |
|---|---|---|---|---|---|
| platform.manage_account | ✅ | ❌ | ❌ | ❌ | ❌ |
| platform.manage_venues | ✅ | ❌ | ❌ | ❌ | ❌ |
| platform.manage_staff | ✅ | ✅ | ❌ | ❌ | ❌ |
| platform.manage_roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| platform.view_analytics | ✅ | ✅ | ✅ | ❌ | ❌ |
| platform.manage_settings | ✅ | ✅ | ❌ | ❌ | ❌ |

### `account_role_permissions` (миграция 022)
**Переопределения системных ролей на уровне аккаунта.**

```sql
account_role_permissions (
  account_id    uuid → accounts
  role_id       uuid → roles
  permission_id uuid → permissions
  granted       boolean
  PK (account_id, role_id, permission_id)
)
```

Это крутая фича: владелец конкретного тенанта может **локально переопределить** дефолтные права системных ролей. Например, по дефолту `manager` не может управлять заведениями, но в моём аккаунте я даю `manager` это право — добавляется запись в `account_role_permissions`.

Системную роль `owner` переопределить **нельзя** (защищено в RLS-политике).

Эффективные права считаются функцией `get_effective_role_permissions()`: если есть запись в `account_role_permissions` — берётся она; иначе fallback на `role_permissions`.

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

## 5. Что НЕ покрывает текущая модель

Эти кейсы существуют в реальности, но в схеме сейчас не отражены:

### 5.1 Юридические реквизиты
**Нигде в системе нет полей** ИНН/ОГРН/КПП/legal_form/tax_system. Ни на `accounts`, ни на `venues`. Для финансового модуля и налогового учёта это придётся куда-то положить.

### 5.2 Несколько юрлиц в одной сети
В реальной сетевой компании часто:
- ТЦ Авиапарк работает через ИП Петров
- Тверская работает через ООО «Молоко»
- Счета и документы у этих венью разные

В текущей схеме невозможно это отразить — у нас только один уровень `venues`, без юрлица посередине.

### 5.3 Несколько аккаунтов на одного человека
Технически на уровне БД допустимо (нет UNIQUE на `accounts.owner_id`), но приложение нигде это не использует. Если человек хочет управлять двумя независимыми бизнесами — нет UI и логики переключения между аккаунтами.

### 5.4 Биллинг и подписка
Нет понятий «тарифный план», «оплата подписки», «лимиты по тарифу» — ни на уровне аккаунта, ни на уровне venue.

### 5.5 Мультивалютность на уровне компании
У `venues.currency` есть, но это только валюта учёта одной точки. Нет «отчётной валюты компании» для агрегации между venues с разными валютами.

---

## 6. Что важно знать перед расширением

### 6.1 Account и venue — разные уровни абстракции

- **Account** — административно-владельческий уровень. Кто хозяин, как называется бренд.
- **Venue** — операционный уровень. Где находится точка, как работает.

Это правильное разделение. Но **юрлицо** — это **третий уровень**, который сейчас отсутствует. Юрлицо может быть:
- Привязано к account целиком (одно ИП = вся сеть): можно хранить на `accounts`.
- Привязано к каждому venue (разные юрлица на разных точках): нужно хранить на `venues`.
- Отдельной сущностью с связями M:N (одна точка может пробивать через разные юрлица): нужна таблица `legal_entities`.

### 6.2 RLS работает через `get_active_*` функции

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

### 6.3 Системные роли универсальны, кастомные локальны

При добавлении новых прав (например, `finance.*`) нужно решить:
- **Дефолты для системных ролей** — обновить `role_permissions` в новой миграции.
- **Account-овские переопределения** — пользователь может в своём аккаунте поменять дефолты через `account_role_permissions`.
- **Кастомные роли** — владелец может создать роль «Бухгалтер» с произвольным набором прав через `roles` + `role_permissions`.

### 6.4 Активный venue не выбран — пользователь «слепой»

Сразу после регистрации владельца, до завершения онбординга, у `profiles` нет `active_venue_id`. В этот момент **все RLS-политики выдают пустые результаты**. Это нормально, но фронт должен это обрабатывать (редирект на онбординг).

---

## 7. Резюме

**Что в crm есть сейчас:**

- ✅ Двухуровневая иерархия: `account` (тенант) → `venues` (физические точки).
- ✅ `profiles` (1:1 c auth.users) с расширенными ПДн.
- ✅ Membership через `user_venue_roles` со статусами active/fired.
- ✅ Права: системные роли с дефолтами + account-уровневые переопределения + кастомные роли.
- ✅ RLS через helper-функции `get_active_*` и `has_permission`.
- ✅ Триггеры автосоздания profile, RPC для онбординга и приглашений.
- ✅ 6 прав в модуле `platform`.
- ✅ Audit поля `created_by/updated_by/deleted_by` в нескольких таблицах (но НЕ глобальный audit log).

**Чего нет:**

- ❌ Юридических реквизитов (ИНН/ОГРН и т.д.) нигде.
- ❌ Поддержки нескольких юрлиц в одном аккаунте.
- ❌ Биллинга и тарифов.
- ❌ Глобального audit log на все действия.
- ❌ Финансовых сущностей (транзакции, счета и т.д.).
- ❌ CRM-сущностей (гости, брони, лояльность).

Эти пробелы и закрывает план слияния `MERGE_PLAN.md`.
