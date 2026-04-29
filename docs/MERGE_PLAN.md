# План слияния finance-tracker в crm и реструктуризации проекта

> **Версия:** 2.1 (финальные решения, готов к реализации)
> **Дата:** 29 апреля 2026
> **Статус:** Утверждён, готов к старту Этапа 0

Этот документ — техническая спецификация слияния проекта `finance-tracker` (Create React App, MUI, отдельная БД) в основной продукт `crm` (Next.js 15, shadcn/ui, Supabase) в качестве финансового модуля. Параллельно проводится реструктуризация существующего кода `crm` на чёткие архитектурные блоки.

**Связанные документы:**
- [`CURRENT_TENANCY.md`](./CURRENT_TENANCY.md) — детальное описание текущей мультитенантной модели crm.

**История изменений:**
- v1.0 — первая версия плана.
- v2.0 — после ревью текущей мультитенантности: внедрена трёхуровневая иерархия `Account → LegalEntity → Venue`.
- v2.1 — зафиксированы решения по открытым вопросам, расширена модель attachments под сканы договоров/актов/накладных, добавлен раздел для исполнителя (Claude Code, ветки/коммиты).

---

## 1. Принятые решения (фиксация)

| # | Решение | Влияние на план |
|---|---|---|
| 1 | **Иерархия account → legal_entity → venue** | Раздел 2 |
| 2 | **Мультивалютность не делаем**, всё в RUB. В БД поле `currency` оставляем (на будущее) | Финансовые таблицы, формы |
| 3 | **DaData подключаем**. Запрос делается один раз при вводе ИНН → данные сохраняются в нашу БД. Все вызовы DaData идут через server actions | Этап 2 |
| 4 | **Внутрикомпанейские переводы — одной транзакцией** (Вариант 1). Это управленческий учёт, не двойная бухгалтерия | Раздел 2.5, transactions |
| 5 | **Категории — плоский список + группы** (без древовидной иерархии) | Раздел 2.5 |
| 6 | **Импорт транзакций из банка** — не сейчас, отложен до отдельного запроса | Не в плане |
| 7 | **Бюджеты и планы** — далеко отложены, схему сейчас не закладываем | Не в плане |
| 8 | **ОФД-интеграция / фискализация** — когда-нибудь, не сейчас | Не в плане |
| 9 | **Документооборот** (договоры, акты как сущности) — не сейчас, **но хранение сканов договоров/накладных/актов нужно** для контрагентов и юрлиц | Раздел 2.6, расширены attachments |
| 10 | **Soft delete для транзакций** — да. UI «корзины» и восстановления **нет** на старте (выносим позже) | Раздел 2.5 |
| 11 | **Закрытие периодов** (`accounting_locked_until`) — **не делаем** | Не в плане |
| 12 | **История изменений транзакции** — берём из общего `audit_logs`, отдельной таблицы нет | Раздел 2.7 |
| 13 | **Контрагент может иметь тот же ИНН, что юрлицо аккаунта** (нет cross-table UNIQUE по ИНН) | Раздел 2.5 |
| 14 | **Слияние делает Claude Code через ветки и коммиты**, по этому документу как ТЗ | Раздел 10 |

---

## 2. Архитектурные блоки

Продукт делится на **четыре доменных блока** + **три за скобками** (общие).

### 2.1 Доменные блоки

| Блок | Назначение | URL-префикс | Каталог в коде |
|---|---|---|---|
| **People** | Сотрудники, должности, права доступа | `/people/*` | `src/app/(dashboard)/people/` |
| **Org** | Тенант, юрлица, заведения, аудит | `/org/*` | `src/app/(dashboard)/org/` |
| **Finance** | Финансы: счета, транзакции, контрагенты | `/finance/*` | `src/app/(dashboard)/finance/` |
| **CRM** | Гости, брони, лояльность | `/crm/*` | `src/app/(dashboard)/crm/` |

### 2.2 За скобками (общие)

| Блок | Назначение | URL |
|---|---|---|
| **Dashboard** | Главная — общий обзор | `/` |
| **Settings** | Системные настройки, интеграции | `/settings/*` |
| **Profile** | Личный профиль текущего пользователя | `/profile` |

### 2.3 Принципы разделения

1. **Каждый блок имеет свой namespace** в коде: `src/lib/{block}`, `src/components/{block}`, `src/app/(dashboard)/{block}`.
2. **Общие сущности** (auth, supabase-clients, ui-kit, файлы) живут вне блоков: `src/lib/supabase`, `src/components/ui`, `src/components/shared`, `src/lib/files`.
3. **Каждый блок имеет свой набор permissions** с префиксом блока: `people.*`, `org.*`, `finance.*`, `crm.*`.
4. **Между блоками — слабая связность**: блок Finance может ссылаться на venue/legal_entity (org) и user (people), но не должен импортировать UI или domain-логику других блоков напрямую.
5. **Settings и Profile** не привязаны к конкретному блоку — это общая инфраструктура.

---

## 3. Структура данных

### 3.1 Иерархия мультитенантности

```
Account (тенант / workspace владельца)
  ├── LegalEntity (юрлицо: ИП, ООО, АО)
  │     поля: name, legal_form, ИНН, ОГРН, КПП, налоговая система,
  │            юр.адрес, директор, бухгалтер, банковские реквизиты,
  │            dadata_synced_at, attachments
  │     ─ один account может содержать несколько legal_entities
  │
  └── Venue (физическое заведение)
        ├── default_legal_entity_id → LegalEntity (одно по умолчанию)
        ├── собственные поля: name, type, address, phone, currency,
        │     timezone, working_hours, website
        └── один venue работает по одному default юрлицу
```

**Принципиальные решения:**

- **Account** — это **только тенант** (workspace владельца): `name`, `logo_url`, `owner_id`. Юридических реквизитов в account **не добавляем** — они в `legal_entities`.
- **LegalEntity** — это юрлицо. У одного account может быть **несколько юрлиц**.
- **Venue** — физическая точка. Каждое venue имеет **default_legal_entity_id** (одно юрлицо по умолчанию).
- **Транзакции и счета** привязаны к `legal_entity_id` (где деньги) и опционально к `venue_id` (где была операция).
- **Внутрикомпанейские переводы** между двумя юрлицами — одной транзакцией с `legal_entity_id` (откуда) и `to_legal_entity_id` (куда).

### 3.2 Существующие таблицы (crm, остаются)

Из миграций 001–031 (см. [`CURRENT_TENANCY.md`](./CURRENT_TENANCY.md)):

**Identity / People:** `profiles`, `roles`, `permissions`, `role_permissions`, `account_role_permissions`, `user_venue_roles`, `invitations`.

**Organization:** `accounts`, `venues`, `venue_halls`.

**Storage buckets:** `avatars`, `venue-logos`, `account-logos`, `staff-documents`.

**Integrations:** `quickresto_integrations` (миграции 029, 031).

**Notifications:** `notifications`.

### 3.3 Новая таблица `legal_entities` (миграция 032)

```sql
CREATE TYPE legal_form_enum AS ENUM ('IP', 'OOO', 'AO', 'PAO', 'NKO', 'OTHER');
CREATE TYPE tax_system_enum AS ENUM ('OSN', 'USN_INCOME', 'USN_INCOME_EXPENSE', 'PSN', 'NPD', 'AUSN');

CREATE TABLE public.legal_entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- Идентификация
  name            text NOT NULL,                    -- "ИП Петров А.А." / "ООО Молоко"
  legal_form      legal_form_enum NOT NULL,
  short_name      text,

  -- Реквизиты (РФ)
  inn             text,
  kpp             text,
  ogrn            text,
  okpo            text,
  okved           text,

  -- Налоговая система
  tax_system      tax_system_enum,
  vat_payer       boolean NOT NULL DEFAULT false,

  -- Адреса
  legal_address   text,
  actual_address  text,
  postal_address  text,

  -- Подписанты
  director_name           text,
  director_position       text DEFAULT 'Директор',
  accountant_name         text,
  signature_basis         text,        -- "Устав" / "Доверенность №..."

  -- Контакты
  phone           text,
  email           text,
  website         text,

  -- Банковские реквизиты по умолчанию (для документов)
  default_bank_name      text,
  default_bik            text,
  default_account_number text,
  default_corr_account   text,

  -- DaData кэш
  dadata_synced_at timestamptz,        -- когда последний раз синхронизировались с DaData

  -- Аудит
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  updated_by      uuid REFERENCES public.profiles(id)
);

CREATE INDEX legal_entities_account_id_idx ON public.legal_entities(account_id);
CREATE INDEX legal_entities_inn_idx ON public.legal_entities(account_id, inn) WHERE inn IS NOT NULL;
```

### 3.4 Доработка существующих таблиц

#### `venues` (миграция 033)

```sql
ALTER TABLE public.venues
  ADD COLUMN default_legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE RESTRICT;

CREATE INDEX venues_default_legal_entity_idx
  ON public.venues(default_legal_entity_id)
  WHERE default_legal_entity_id IS NOT NULL;
```

Колонка nullable, потому что текущие venues её не имеют. Заполняется при миграции данных и в обновлённом онбординге.

#### `complete_owner_onboarding()` (миграция 043)

Расширяем функцию: теперь принимает данные юрлица + venue, создаёт обе сущности. Подробное описание — в Этапе 2.

#### `accounts` — без изменений

Никаких ИНН/ОГРН в accounts не добавляем. Все юридические реквизиты — в `legal_entities`.

### 3.5 Новые таблицы — блок Finance

Все таблицы содержат:
- `account_id` — для тенантной изоляции (быстрый фильтр без JOIN'ов).
- `legal_entity_id` — где это применимо (для финансовых операций обязательно).
- `venue_id` — где это применимо (для операционной аналитики).

#### `bank_accounts` (миграция 036)

Банковские счета, кассы, фонды, карты. **Привязаны к юрлицу.**

```sql
CREATE TYPE bank_account_type_enum AS ENUM ('checking', 'debit_card', 'cash', 'fund', 'safe');

CREATE TABLE public.bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  venue_id        uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  -- venue_id NULL = счёт общий для юрлица; NOT NULL = касса конкретной точки

  name            text NOT NULL,
  type            bank_account_type_enum NOT NULL,
  currency        text NOT NULL DEFAULT 'RUB',     -- зарезервировано, всегда RUB на старте
  balance         numeric(15, 2) NOT NULL DEFAULT 0,
  description     text,
  group_id        uuid REFERENCES public.bank_account_groups(id) ON DELETE SET NULL,

  -- Банковские поля
  bank_name             text,
  bik                   text,
  account_number        text,
  correspondent_account text,
  acquiring_percentage  numeric(5, 2),

  -- Поля карты
  card_holder           text,
  card_number_last4     text,

  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  updated_by      uuid REFERENCES public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.profiles(id)
);

CREATE TABLE public.bank_account_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_accounts_account_idx ON public.bank_accounts(account_id);
CREATE INDEX bank_accounts_legal_entity_idx ON public.bank_accounts(legal_entity_id);
CREATE INDEX bank_accounts_venue_idx ON public.bank_accounts(venue_id) WHERE venue_id IS NOT NULL;
```

#### `finance_categories` (миграция 037)

Плоский список + группы. На уровне account.

```sql
CREATE TYPE finance_category_type_enum AS ENUM ('income', 'expense');

CREATE TABLE public.finance_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  name            text NOT NULL,
  type            finance_category_type_enum NOT NULL,
  description     text,
  color           text,                     -- hex без #
  icon            text,                     -- имя иконки lucide-react
  group_id        uuid REFERENCES public.finance_category_groups(id) ON DELETE SET NULL,

  is_system       boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  updated_by      uuid REFERENCES public.profiles(id)
);

CREATE TABLE public.finance_category_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text CHECK (type IN ('income', 'expense', 'mixed')),
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

#### `counterparties` (миграция 038)

```sql
CREATE TABLE public.counterparties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  name            text NOT NULL,
  legal_form      legal_form_enum NOT NULL DEFAULT 'OOO',
  inn             text,
  kpp             text,
  ogrn            text,
  contact_person  text,
  phone           text,
  email           text,
  address         text,
  description     text,
  group_id        uuid REFERENCES public.counterparty_groups(id) ON DELETE SET NULL,

  -- DaData кэш
  dadata_synced_at timestamptz,

  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  updated_by      uuid REFERENCES public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.profiles(id)
);

CREATE TABLE public.counterparty_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX counterparties_account_idx ON public.counterparties(account_id);
CREATE INDEX counterparties_inn_idx ON public.counterparties(account_id, inn) WHERE inn IS NOT NULL;
-- Внимание: ИНН счёта может совпадать с ИНН legal_entity (cross-table UNIQUE НЕТ)
```

#### `transactions` (миграция 039)

Главная сущность.

```sql
CREATE TYPE transaction_type_enum AS ENUM ('income', 'expense', 'transfer');
CREATE TYPE transaction_source_enum AS ENUM ('manual', 'quickresto', 'import', 'bank_sync');

CREATE TABLE public.transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id       bigserial UNIQUE,                  -- человекочитаемый номер

  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  venue_id        uuid REFERENCES public.venues(id) ON DELETE SET NULL,

  type            transaction_type_enum NOT NULL,
  amount          numeric(15, 2) NOT NULL,
  currency        text NOT NULL DEFAULT 'RUB',       -- зарезервировано, всегда RUB на старте

  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,

  -- Для transfer
  to_bank_account_id   uuid REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  to_legal_entity_id   uuid REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  -- Если to_legal_entity_id = legal_entity_id → внутренний перевод одного юрлица
  -- Если to_legal_entity_id != legal_entity_id → перевод между юрлицами account

  -- Для income/expense
  category_id     uuid REFERENCES public.finance_categories(id) ON DELETE SET NULL,
  counterparty_id uuid REFERENCES public.counterparties(id) ON DELETE SET NULL,

  description     text,
  date            timestamptz NOT NULL,

  -- Источник
  source          transaction_source_enum NOT NULL DEFAULT 'manual',
  source_external_id text,

  -- Аудит / soft delete (без UI «корзины» — выносим позже)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  updated_by      uuid REFERENCES public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.profiles(id),

  -- Constraints
  CONSTRAINT transfer_requires_to_account
    CHECK (type != 'transfer' OR to_bank_account_id IS NOT NULL),
  CONSTRAINT transfer_requires_to_legal_entity
    CHECK (type != 'transfer' OR to_legal_entity_id IS NOT NULL),
  CONSTRAINT income_expense_no_to_account
    CHECK (type = 'transfer' OR to_bank_account_id IS NULL),
  CONSTRAINT income_expense_no_to_legal_entity
    CHECK (type = 'transfer' OR to_legal_entity_id IS NULL),

  -- Дедупликация по внешнему источнику
  CONSTRAINT transactions_external_unique
    UNIQUE (account_id, source, source_external_id)
);

CREATE INDEX transactions_account_idx ON public.transactions(account_id);
CREATE INDEX transactions_legal_entity_idx ON public.transactions(legal_entity_id);
CREATE INDEX transactions_venue_idx ON public.transactions(venue_id);
CREATE INDEX transactions_bank_account_idx ON public.transactions(bank_account_id);
CREATE INDEX transactions_date_desc_idx ON public.transactions(date DESC);
CREATE INDEX transactions_type_idx ON public.transactions(type);
CREATE INDEX transactions_source_idx ON public.transactions(source) WHERE source != 'manual';
CREATE INDEX transactions_not_deleted_idx ON public.transactions(account_id) WHERE deleted_at IS NULL;
```

**Триггер пересчёта баланса** (в той же миграции 039):
- INSERT/UPDATE/DELETE/soft-delete транзакции → пересчёт `bank_accounts.balance`.
- `income`: +amount к `bank_account_id`.
- `expense`: -amount от `bank_account_id`.
- `transfer`: -amount от `bank_account_id`, +amount к `to_bank_account_id`.
- Soft delete (`deleted_at` стал NOT NULL): откат эффекта.
- Защита от прямой записи в `balance`: BEFORE UPDATE триггер сбрасывает `balance` на OLD-значение, если изменение пришло не от пересчёта.

### 3.6 Файлы и attachments — единая модель (миграция 040)

Универсальная схема для всех типов сущностей. Один storage bucket, одна таблица файлов, отдельные pivot-таблицы для каждого типа.

```sql
CREATE TYPE attachment_document_type_enum AS ENUM (
  'receipt',           -- чек
  'contract',          -- договор
  'act',               -- акт выполненных работ
  'invoice',           -- счёт
  'waybill',           -- накладная
  'tax_document',      -- налоговый документ
  'registration_doc',  -- регистрационный документ юрлица (ОГРН, выписка ЕГРЮЛ)
  'other'
);

-- Общая таблица файлов на уровне account
CREATE TABLE public.account_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,                -- путь в storage bucket
  name          text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  uploaded_by   uuid NOT NULL REFERENCES public.profiles(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_files_account_idx ON public.account_files(account_id);

-- Pivot для транзакций
CREATE TABLE public.transaction_attachments (
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  file_id        uuid NOT NULL REFERENCES public.account_files(id) ON DELETE CASCADE,
  document_type  attachment_document_type_enum NOT NULL DEFAULT 'receipt',
  PRIMARY KEY (transaction_id, file_id)
);

-- Pivot для контрагентов (договоры, акты, накладные)
CREATE TABLE public.counterparty_attachments (
  counterparty_id uuid NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  file_id         uuid NOT NULL REFERENCES public.account_files(id) ON DELETE CASCADE,
  document_type   attachment_document_type_enum NOT NULL DEFAULT 'contract',
  document_date   date,
  document_number text,
  description     text,
  PRIMARY KEY (counterparty_id, file_id)
);

-- Pivot для юрлиц (учредительные документы, выписки ЕГРЮЛ)
CREATE TABLE public.legal_entity_attachments (
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  file_id         uuid NOT NULL REFERENCES public.account_files(id) ON DELETE CASCADE,
  document_type   attachment_document_type_enum NOT NULL DEFAULT 'registration_doc',
  description     text,
  PRIMARY KEY (legal_entity_id, file_id)
);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
  VALUES ('account-attachments', 'account-attachments', false);

-- Storage RLS policies — добавляются в той же миграции
```

**Принципы:**
- Один файл может быть привязан к разным сущностям (хотя на практике это редко).
- При удалении сущности — pivot-запись удаляется, сам файл остаётся в `account_files` (можно зачистить отдельным cleanup-job).
- Storage path шаблон: `{account_id}/{yyyy}/{mm}/{uuid}-{original_name}`.

### 3.7 Новые таблицы — блок CRM (задел)

UI пока заглушки, БД полноценная.

#### `guests` (миграция 045)

```sql
CREATE TYPE guest_gender_enum AS ENUM ('male', 'female');

CREATE TABLE public.guests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Гости — на уровне account (одна база на всю сеть)

  first_name      text,
  last_name       text,
  middle_name     text,
  phone           text,
  email           text,
  birth_date      date,
  gender          guest_gender_enum,
  notes           text,
  tags            text[],

  -- Метрики (пересчитываются триггером)
  visits_count    int NOT NULL DEFAULT 0,
  last_visit_at   timestamptz,
  total_spent     numeric(15, 2) NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  deleted_at      timestamptz
);

CREATE INDEX guests_account_idx ON public.guests(account_id);
CREATE INDEX guests_phone_idx ON public.guests(account_id, phone) WHERE phone IS NOT NULL;
```

#### `reservations` (миграция 046)

```sql
CREATE TYPE reservation_status_enum AS ENUM ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show');
CREATE TYPE reservation_source_enum AS ENUM ('manual', 'phone', 'website', 'instagram', 'quickresto');

CREATE TABLE public.reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  venue_id        uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  guest_id        uuid REFERENCES public.guests(id) ON DELETE SET NULL,

  guest_name      text,
  guest_phone     text,

  date_from       timestamptz NOT NULL,
  date_to         timestamptz NOT NULL,
  guests_count    int NOT NULL DEFAULT 1,
  hall_id         uuid,
  table_ids       uuid[],

  status          reservation_status_enum NOT NULL DEFAULT 'pending',
  source          reservation_source_enum NOT NULL DEFAULT 'manual',

  notes           text,
  preferences     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id)
);

CREATE INDEX reservations_venue_date_idx ON public.reservations(venue_id, date_from);
CREATE INDEX reservations_status_idx ON public.reservations(status);
CREATE INDEX reservations_guest_idx ON public.reservations(guest_id) WHERE guest_id IS NOT NULL;
```

#### Лояльность (миграция 047)

```sql
CREATE TYPE loyalty_program_type_enum AS ENUM ('cashback', 'points', 'tier', 'discount');
CREATE TYPE loyalty_transaction_type_enum AS ENUM ('earn', 'redeem', 'adjustment', 'expire');

CREATE TABLE public.loyalty_programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        loyalty_program_type_enum NOT NULL,
  rules       jsonb NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.loyalty_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  guest_id      uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  program_id    uuid NOT NULL REFERENCES public.loyalty_programs(id) ON DELETE CASCADE,
  card_number   text,
  balance       numeric(15, 2) NOT NULL DEFAULT 0,
  tier          text,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guest_id, program_id)
);

CREATE TABLE public.loyalty_transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  member_id              uuid NOT NULL REFERENCES public.loyalty_members(id) ON DELETE CASCADE,
  type                   loyalty_transaction_type_enum NOT NULL,
  amount                 numeric(15, 2) NOT NULL,
  description            text,
  related_transaction_id uuid REFERENCES public.transactions(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES public.profiles(id)
);
```

### 3.8 Общая таблица `audit_logs` (миграция 035)

Единый журнал для всех блоков. Также используется для просмотра «истории изменений» конкретной транзакции (через фильтр `entity_type='transaction' AND entity_id=X`).

```sql
CREATE TABLE public.audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE SET NULL,
  venue_id        uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES public.profiles(id),

  action_code     text NOT NULL,           -- 'transaction.created', 'venue.updated', ...
  entity_type     text NOT NULL,
  entity_id       uuid,

  details         jsonb DEFAULT '{}',      -- diff old/new значений
  ip_address      inet,
  user_agent      text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_account_created_idx ON public.audit_logs(account_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_action_idx ON public.audit_logs(action_code);

-- Helper-функция
CREATE OR REPLACE FUNCTION public.log_audit(
  p_action_code text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb DEFAULT '{}'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.audit_logs (
    account_id, legal_entity_id, venue_id, user_id,
    action_code, entity_type, entity_id, details
  ) VALUES (
    public.get_active_account_id(),
    public.get_active_legal_entity_id(),
    public.get_active_venue_id(),
    auth.uid(),
    p_action_code, p_entity_type, p_entity_id, p_details
  );
END;
$$;
```

### 3.9 Helper-функции для финансов и юрлиц (миграция 032)

```sql
-- Активное юрлицо = default юрлицо активного venue
CREATE OR REPLACE FUNCTION public.get_active_legal_entity_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.default_legal_entity_id
  FROM public.profiles p
  JOIN public.venues v ON v.id = p.active_venue_id
  WHERE p.id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_venue_roles uvr
      WHERE uvr.user_id = auth.uid()
        AND uvr.venue_id = p.active_venue_id
        AND uvr.status = 'active'
    );
$$;
```

В UI финансовых модулей будет «переключатель юрлица» — через право `finance.view_all_legal_entities` пользователь может видеть данные всех юрлиц своего account.

---

## 4. Права доступа и мультитенантность

### 4.1 Текущая модель crm — без изменений

Полностью сохраняем механизм:
- `permissions`, `roles`, `role_permissions`, `account_role_permissions`, `user_venue_roles`.
- Helper-функции `has_permission(code)`, `get_active_venue_id()`, `get_active_account_id()`.
- Добавляем `get_active_legal_entity_id()`.

Расширяем только справочник `permissions` и матрицу дефолтов (миграция 034).

### 4.2 Полный реестр permissions

**Итого 48 прав** = 8 (people) + 9 (org) + 18 (finance) + 9 (crm) + 4 (settings).

#### People (8)

| Code | Описание |
|---|---|
| `people.view_staff` | Видеть список сотрудников |
| `people.view_staff_details` | Видеть детальную карточку (ПДн, паспорт, медкнижка) |
| `people.invite_staff` | Приглашать новых сотрудников |
| `people.edit_staff` | Редактировать данные сотрудников |
| `people.terminate_staff` | Увольнять сотрудников |
| `people.delete_staff` | Полное удаление (только для owner) |
| `people.view_roles` | Видеть список ролей и их прав |
| `people.manage_roles` | Создавать/редактировать кастомные роли |

#### Org (9)

| Code | Описание |
|---|---|
| `org.view_account` | Видеть общую информацию об аккаунте |
| `org.manage_account` | Редактировать аккаунт |
| `org.view_legal_entities` | Видеть список юрлиц |
| `org.manage_legal_entities` | Создавать/редактировать юрлица и их реквизиты |
| `org.delete_legal_entity` | Удалять юрлицо (только owner) |
| `org.view_venues` | Видеть список заведений |
| `org.manage_venues` | Создавать/редактировать заведения |
| `org.delete_venue` | Удалять заведения |
| `org.view_audit` | Видеть журнал аудита |

#### Finance (18)

| Code | Описание |
|---|---|
| `finance.view_dashboard` | Видеть главный финансовый дашборд |
| `finance.view_transactions` | Видеть список транзакций |
| `finance.create_transaction` | Создавать транзакции |
| `finance.update_transaction` | Редактировать свои транзакции |
| `finance.update_any_transaction` | Редактировать любые транзакции |
| `finance.delete_transaction` | Удалять транзакции (мягкое) |
| `finance.view_bank_accounts` | Видеть банковские счета и балансы |
| `finance.manage_bank_accounts` | Создавать/редактировать счета |
| `finance.view_categories` | Видеть статьи доходов/расходов |
| `finance.manage_categories` | Создавать/редактировать статьи |
| `finance.view_counterparties` | Видеть контрагентов |
| `finance.manage_counterparties` | Создавать/редактировать контрагентов |
| `finance.upload_attachments` | Прикреплять файлы (чеки, договоры, накладные) |
| `finance.view_attachments` | Видеть/скачивать прикреплённые файлы |
| `finance.delete_attachments` | Удалять прикреплённые файлы |
| `finance.export` | Экспорт данных в Excel/CSV |
| `finance.view_all_venues` | Видеть финансы всех точек одновременно |
| `finance.view_all_legal_entities` | Видеть финансы всех юрлиц одновременно |

#### CRM (9)

| Code | Описание |
|---|---|
| `crm.view_guests` | Видеть базу гостей |
| `crm.view_guest_details` | Видеть детальную карточку гостя |
| `crm.manage_guests` | Создавать/редактировать гостей |
| `crm.view_reservations` | Видеть брони |
| `crm.manage_reservations` | Создавать/редактировать брони |
| `crm.cancel_reservation` | Отменять брони |
| `crm.view_loyalty` | Видеть программы лояльности |
| `crm.manage_loyalty` | Управлять программами |
| `crm.adjust_loyalty_balance` | Ручная корректировка баланса гостя |

#### Settings (4)

| Code | Описание |
|---|---|
| `settings.manage_integrations` | Подключать/отключать интеграции |
| `settings.manage_notifications` | Управлять рассылками |
| `settings.manage_billing` | Управлять подпиской и оплатой (на будущее) |
| `settings.use_dadata` | Делать запросы к DaData (cleaner API) |

### 4.3 Системные роли и дефолты

К существующим 5 системным ролям добавляем **`accountant`** (бухгалтер).

| Право | owner | admin | manager | accountant | hostess | waiter |
|---|---|---|---|---|---|---|
| **People** | | | | | | |
| people.view_staff | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| people.view_staff_details | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| people.invite_staff | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| people.edit_staff | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| people.terminate_staff | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| people.delete_staff | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| people.view_roles | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| people.manage_roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Org** | | | | | | |
| org.view_account | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| org.manage_account | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| org.view_legal_entities | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| org.manage_legal_entities | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| org.delete_legal_entity | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| org.view_venues | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| org.manage_venues | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| org.delete_venue | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| org.view_audit | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Finance** | | | | | | |
| finance.view_dashboard | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.view_transactions | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.create_transaction | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.update_transaction | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.update_any_transaction | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.delete_transaction | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.view_bank_accounts | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.manage_bank_accounts | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.view_categories | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.manage_categories | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.view_counterparties | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.manage_counterparties | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.upload_attachments | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.view_attachments | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| finance.delete_attachments | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.export | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.view_all_venues | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| finance.view_all_legal_entities | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **CRM** | | | | | | |
| crm.view_guests | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| crm.view_guest_details | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| crm.manage_guests | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| crm.view_reservations | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| crm.manage_reservations | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| crm.cancel_reservation | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| crm.view_loyalty | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| crm.manage_loyalty | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| crm.adjust_loyalty_balance | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Settings** | | | | | | |
| settings.manage_integrations | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| settings.manage_notifications | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| settings.manage_billing | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| settings.use_dadata | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

**Принципы дефолтов:**
- `owner` — всё.
- `admin` — почти всё, кроме критичного (удаление юрлиц/venues, биллинг, корректировка лояльности, manage_legal_entities).
- `manager` — операционка по своему venue (стафф, брони, повседневные транзакции), без работы с юрлицами и удаления.
- `accountant` — полный финансовый и юрлицовый доступ + чтение людей/венью; не работает с CRM-блоком.
- `hostess` — гости и брони, чтение по venues и стаффу.
- `waiter` — только базовая работа с гостями и бронями текущей смены.

### 4.4 Мультитенантная изоляция (RLS)

**Базовый паттерн — четыре уровня изоляции:**

```sql
CREATE POLICY "<table>_select" ON <table>
FOR SELECT
USING (
  -- 1. Тенант
  account_id = public.get_active_account_id()

  -- 2. Юрлицо (если поле есть)
  AND (
    legal_entity_id IS NULL
    OR legal_entity_id = public.get_active_legal_entity_id()
    OR public.has_permission('finance.view_all_legal_entities')
  )

  -- 3. Venue (если поле есть)
  AND (
    venue_id IS NULL
    OR venue_id = public.get_active_venue_id()
    OR public.has_permission('finance.view_all_venues')
  )

  -- 4. Право на чтение
  AND public.has_permission('<block>.view_<resource>')

  -- 5. Soft delete: скрываем удалённые везде, кроме view_audit
  AND (deleted_at IS NULL OR public.has_permission('<block>.view_deleted'))
);
```

**Особенности по таблицам:**
- `legal_entities` — `account_id` + `org.view_legal_entities`.
- `venues` — `account_id` + `org.view_venues` + active membership (как сейчас).
- `bank_accounts`, `transactions` — все четыре уровня + soft-delete фильтр.
- `finance_categories`, `counterparties`, `*_groups` — `account_id` + право; юрлица не различаем (справочники общие).
- `account_files` — `account_id` + право в зависимости от типа pivot'а (см. ниже).
- `transaction_attachments`, `counterparty_attachments`, `legal_entity_attachments` — RLS через JOIN с родительской сущностью.
- `guests` — `account_id` + `crm.view_guests`.
- `reservations` — `account_id` + `venue_id` + `crm.view_reservations`.

### 4.5 Smart-redirect и middleware

```
1. Не залогинен → /login
2. Залогинен, profiles.active_venue_id = NULL → /onboarding
3. Активный venue без default_legal_entity_id → /onboarding/legal-entity
4. Залогинен, всё ок:
   - has_permission('finance.view_dashboard') → /finance
   - else has_permission('crm.view_reservations') → /crm/reservations
   - else has_permission('people.view_staff') → /people/staff
   - else → /dashboard
```

---

## 5. Структура файлов

```
crm/
├── docs/
│   ├── MERGE_PLAN.md             ← этот документ
│   ├── CURRENT_TENANCY.md         ← карта текущей мультитенантности
│   └── ARCHITECTURE.md            ← создать после слияния
├── _legacy_from_crm2/             ← (уже есть)
├── _legacy_from_finance/          ← создаётся в Этап 0
│   ├── README.md
│   ├── types/                     ← TypeScript-типы для референса
│   ├── migrations/                ← оригинальные SQL для референса
│   └── components/                ← UI-референсы (TransactionForm, TransactionsPage)
├── public/
├── src/
│   ├── app/
│   │   ├── (auth)/                ← без изменений
│   │   ├── (onboarding)/
│   │   │   ├── onboarding/        ← обновить под legal_entity
│   │   │   └── ...
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   │
│   │   │   ├── people/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── staff/
│   │   │   │   ├── roles/
│   │   │   │   └── invitations/
│   │   │   │
│   │   │   ├── org/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── account/             ← карточка тенанта (имя, лого)
│   │   │   │   ├── legal-entities/
│   │   │   │   │   ├── page.tsx         ← список юрлиц
│   │   │   │   │   └── [legalEntityId]/
│   │   │   │   │       ├── page.tsx     ← реквизиты
│   │   │   │   │       └── attachments/ ← учредительные документы
│   │   │   │   ├── venues/
│   │   │   │   │   └── [venueId]/       ← + выбор default_legal_entity_id
│   │   │   │   └── audit/
│   │   │   │
│   │   │   ├── finance/
│   │   │   │   ├── layout.tsx           ← гейт + LegalEntitySwitcher в шапке
│   │   │   │   ├── page.tsx             ← главный дашборд
│   │   │   │   ├── transactions/
│   │   │   │   ├── accounts/            ← банковские счета
│   │   │   │   ├── categories/
│   │   │   │   ├── counterparties/
│   │   │   │   │   └── [counterpartyId]/
│   │   │   │   │       ├── page.tsx
│   │   │   │   │       └── attachments/ ← договоры, акты, накладные
│   │   │   │   └── settings/
│   │   │   │       ├── account-groups/
│   │   │   │       ├── category-groups/
│   │   │   │       └── counterparty-groups/
│   │   │   │
│   │   │   ├── crm/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx
│   │   │   │   ├── guests/
│   │   │   │   ├── reservations/
│   │   │   │   └── loyalty/
│   │   │   │
│   │   │   ├── settings/
│   │   │   │   ├── integrations/quickresto/
│   │   │   │   ├── notifications/
│   │   │   │   └── billing/             ← на будущее
│   │   │   │
│   │   │   ├── profile/
│   │   │   │   ├── page.tsx
│   │   │   │   └── security/
│   │   │   │
│   │   │   └── notifications/
│   │   │
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   ├── dadata/
│   │   │   │   ├── party/route.ts       ← поиск юрлица по ИНН
│   │   │   │   └── address/route.ts     ← подсказки адресов
│   │   │   ├── finance/webhooks/
│   │   │   └── crm/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   │
│   ├── components/
│   │   ├── ui/                          ← shadcn (общие)
│   │   ├── shared/
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   ├── venue-switcher.tsx
│   │   │   ├── legal-entity-switcher.tsx
│   │   │   ├── permission-gate.tsx
│   │   │   ├── data-table.tsx
│   │   │   └── attachment-uploader.tsx  ← переиспользуемый компонент
│   │   ├── auth/
│   │   ├── people/
│   │   ├── org/
│   │   │   ├── legal-entity-form.tsx
│   │   │   ├── inn-input.tsx            ← ввод ИНН с DaData-подтяжкой
│   │   │   ├── address-input.tsx        ← ввод адреса с DaData suggestions
│   │   │   └── ...
│   │   ├── finance/
│   │   │   ├── transaction-form.tsx
│   │   │   ├── amount-input.tsx
│   │   │   ├── category-picker.tsx
│   │   │   ├── counterparty-picker.tsx
│   │   │   ├── bank-account-picker.tsx
│   │   │   ├── legal-entity-picker.tsx
│   │   │   ├── filters/
│   │   │   └── charts/
│   │   └── crm/
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   ├── identity/
│   │   ├── org/
│   │   │   ├── accounts.ts
│   │   │   ├── legal-entities.ts
│   │   │   ├── venues.ts
│   │   │   └── audit.ts
│   │   ├── finance/
│   │   │   ├── transactions.ts
│   │   │   ├── bank-accounts.ts
│   │   │   ├── categories.ts
│   │   │   ├── counterparties.ts
│   │   │   ├── statistics.ts
│   │   │   ├── exports.ts
│   │   │   └── triggers/
│   │   ├── crm/
│   │   │   ├── guests.ts
│   │   │   ├── reservations.ts
│   │   │   └── loyalty.ts
│   │   ├── files/                       ← общая работа с account_files
│   │   │   ├── upload.ts
│   │   │   ├── signed-urls.ts
│   │   │   └── attachments.ts           ← unified API для всех типов attachments
│   │   ├── dadata/                      ← интеграция с DaData
│   │   │   ├── client.ts                ← server-side клиент DaData API
│   │   │   ├── party.ts                 ← поиск по ИНН
│   │   │   └── address.ts               ← suggestions адресов
│   │   ├── audit/
│   │   ├── permissions/
│   │   ├── integrations/
│   │   ├── invitations/
│   │   ├── email-templates/
│   │   ├── constants.ts
│   │   └── utils.ts
│   │
│   ├── hooks/
│   │   ├── use-permissions.ts
│   │   ├── use-active-venue.ts
│   │   ├── use-active-legal-entity.ts
│   │   ├── use-dadata-suggestions.ts    ← debounced live-подсказки адресов
│   │   └── ...
│   │
│   ├── types/
│   │   ├── database.ts                  ← сгенерировано
│   │   ├── identity.ts
│   │   ├── org.ts
│   │   ├── finance.ts
│   │   ├── crm.ts
│   │   ├── audit.ts
│   │   ├── files.ts
│   │   ├── dadata.ts
│   │   └── shared.ts
│   │
│   └── middleware.ts
│
├── supabase/
│   ├── migrations/
│   │   ├── 001-031 (как есть)
│   │   ├── 032_legal_entities.sql
│   │   ├── 033_venues_default_legal_entity.sql
│   │   ├── 034_new_permissions_and_accountant_role.sql
│   │   ├── 035_audit_logs.sql
│   │   ├── 036_finance_bank_accounts.sql
│   │   ├── 037_finance_categories.sql
│   │   ├── 038_finance_counterparties.sql
│   │   ├── 039_finance_transactions_with_balance_trigger.sql
│   │   ├── 040_account_files_and_attachments.sql
│   │   ├── 041_finance_rls_policies.sql
│   │   ├── 042_finance_default_data.sql
│   │   ├── 043_onboarding_with_legal_entity.sql
│   │   ├── 044_attachments_rls_policies.sql
│   │   ├── 045_crm_guests.sql
│   │   ├── 046_crm_reservations.sql
│   │   ├── 047_crm_loyalty.sql
│   │   └── 048_crm_rls_policies.sql
│   ├── tests/
│   │   ├── 00_platform_core.sql
│   │   ├── 01_legal_entities.sql
│   │   ├── 02_finance_module.sql
│   │   ├── 03_attachments.sql
│   │   └── 04_crm_module.sql
│   ├── seeds/
│   ├── snippets/
│   └── seed.sql
│
├── .env.local                           ← + DADATA_API_KEY, DADATA_SECRET_KEY
├── .env.local.example                   ← обновить с новыми переменными
└── BACKLOG.md
```

---

## 6. Поэтапный план реализации

Каждый этап = отдельная git-ветка, мерджится в `main` после ревью. Внутри этапа работа разбита на маленькие коммиты по подзадачам.

### Этап 0. Подготовка (1–2 дня)

**Ветка:** `feat/00-prepare-finance-merge`

- [ ] Создать `crm/_legacy_from_finance/` со следующим содержимым:
  - `types/index.ts`, `types/supabase.ts`
  - `migrations/*.sql` (все 41 миграция)
  - `components/Transactions/TransactionForm.tsx` (992 строки) — референс бизнес-логики
  - `components/Transactions/TransactionsPage.tsx` (1837 строк) — референс
  - `README.md` с пояснением что это референс, не для применения
- [ ] Удалить `~/Desktop/finance-tracker` целиком.
- [ ] Обновить `BACKLOG.md`: добавить разделы про блоки People/Org/Finance/CRM, ссылку на этот документ.
- [ ] Добавить в `.env.local.example`:
  ```
  DADATA_API_KEY=your-api-key
  DADATA_SECRET_KEY=your-secret-key
  ```
- [ ] Положить реальные ключи в `.env.local` (он в `.gitignore`).

**Коммиты:**
- `chore: import legacy finance-tracker types and migrations as reference`
- `chore: remove finance-tracker directory`
- `docs: update BACKLOG with module structure plan`
- `chore: add DaData env variables`

### Этап 1. Реструктуризация существующего кода crm (1 неделя)

**Ветка:** `feat/01-blocks-restructure`

**Цель:** Перенести существующие страницы в новую модульную структуру **без изменения функционала**.

- [ ] Переименовать `src/app/(dashboard)/staff/` → `src/app/(dashboard)/people/staff/`
- [ ] Переименовать `src/app/(dashboard)/settings/roles/` → `src/app/(dashboard)/people/roles/`
- [ ] Переименовать `src/app/(dashboard)/settings/venues/` → `src/app/(dashboard)/org/venues/`
- [ ] Переименовать `src/app/(dashboard)/settings/account/` → `src/app/(dashboard)/org/account/`
- [ ] Переименовать `src/app/(dashboard)/settings/profile/` → `src/app/(dashboard)/profile/`
- [ ] Создать пустые `(dashboard)/people/layout.tsx`, `org/layout.tsx`, `finance/layout.tsx`, `crm/layout.tsx`.
- [ ] Реорганизовать `src/lib/`: создать `identity/`, `org/`, `finance/`, `crm/`, `audit/`, `permissions/`, `files/`, `dadata/`.
- [ ] Реорганизовать `src/components/`: создать `org/`, `finance/`, `crm/`, `shared/`.
- [ ] Обновить sidebar (`src/components/shared/sidebar.tsx`): группы пунктов по блокам.
- [ ] Обновить middleware: новые правила smart-redirect.
- [ ] 301-редиректы со старых URL на 1–2 недели.
- [ ] Smoke test: всё что работало — продолжает работать.

**Коммиты (каждое перемещение — отдельным коммитом для читаемости git diff):**
- `refactor(people): move staff to /people/staff`
- `refactor(people): move roles to /people/roles`
- `refactor(org): move venues to /org/venues`
- `refactor(org): move account to /org/account`
- `refactor(profile): move profile out of settings`
- `refactor: reorganize src/lib by blocks`
- `refactor: reorganize src/components by blocks`
- `feat(sidebar): new structure with module groups`
- `feat(middleware): smart-redirect for new URLs`

### Этап 2. Юридические лица (1.5 недели)

**Ветка:** `feat/02-legal-entities`

- [ ] **Миграция 032** — таблица `legal_entities` + enum'ы + helper-функция `get_active_legal_entity_id()`.
- [ ] **Миграция 033** — `venues.default_legal_entity_id`.
- [ ] **Миграция 034** — расширить `permissions` всеми 48 кодами; обновить `role_permissions`; **добавить системную роль `accountant`**.
- [ ] **Миграция 035** — `audit_logs` + helper `log_audit()`.
- [ ] **Миграция 043** — обновить `complete_owner_onboarding`: теперь принимает поля юрлица; идемпотентна.
- [ ] Сгенерировать TS-типы; обновить `src/types/{database,org,identity}.ts`.
- [ ] **DaData**: `src/lib/dadata/{client,party,address}.ts` + API-routes `/api/dadata/{party,address}/route.ts`.
- [ ] **Бэкенд** (`src/lib/org/legal-entities.ts`): CRUD + `syncFromDadata(legalEntityId)`.
- [ ] **UI:**
  - `/org/legal-entities` — список юрлиц.
  - `/org/legal-entities/[id]` — карточка с табами «Реквизиты», «Налоги», «Подписанты», «Банк», «Документы».
  - `/org/legal-entities/[id]/attachments` — прикрепление учредительных документов (пока без UI, готовим в Этапе 3 attachments).
  - `/org/account` — обновить (только бренд/лого).
  - `/org/venues/[id]` — добавить выбор default_legal_entity_id.
  - Онбординг: новый шаг «Юрлицо» (минимум: name, legal_form, inn → автоподтяжка через DaData).
- [ ] Компоненты: `<InnInput>`, `<AddressInput>` с DaData suggestions.
- [ ] SQL-тесты `01_legal_entities.sql`.

**Коммиты:**
- `feat(db): legal_entities table + helpers`
- `feat(db): venues.default_legal_entity_id`
- `feat(db): permissions catalog + accountant role`
- `feat(db): audit_logs`
- `feat(db): complete_owner_onboarding with legal entity`
- `feat(dadata): client and API routes`
- `feat(org): legal entities CRUD + UI`
- `feat(org): venue legal entity assignment`
- `feat(onboarding): legal entity step`
- `test(sql): legal entities RLS and access`

### Этап 3. Финансовый модуль — БД, бэкенд, attachments (1.5 недели)

**Ветка:** `feat/03-finance-backend`

- [ ] **Миграция 036** — `bank_accounts` + `bank_account_groups`.
- [ ] **Миграция 037** — `finance_categories` + `finance_category_groups`.
- [ ] **Миграция 038** — `counterparties` + `counterparty_groups`.
- [ ] **Миграция 039** — `transactions` + индексы + триггер пересчёта баланса.
- [ ] **Миграция 040** — `account_files` + `transaction_attachments` + `counterparty_attachments` + `legal_entity_attachments` + storage bucket `account-attachments` + storage policies.
- [ ] **Миграция 041** — RLS-политики для всех 7 таблиц блока Finance.
- [ ] **Миграция 042** — дефолтные сущности: 5–7 категорий доходов, 10–15 расходов, группа «Прочее», касса «Основная касса» в RUB.
- [ ] **Миграция 044** — RLS для attachments (доступ через JOIN с родительской сущностью).
- [ ] SQL-тесты `02_finance_module.sql`, `03_attachments.sql`.
- [ ] **Бэкенд:**
  - `src/lib/finance/transactions.ts` — CRUD + фильтры + пагинация.
  - `src/lib/finance/bank-accounts.ts`, `categories.ts`, `counterparties.ts`.
  - `src/lib/finance/statistics.ts` — агрегации.
  - `src/lib/files/{upload,signed-urls,attachments}.ts` — общий API для прикрепления файлов к любой сущности.
  - `src/lib/dadata/party.ts` — расширить для контрагентов.
- [ ] Доменные TS-типы.

**Коммиты:**
- `feat(db): bank_accounts schema`
- `feat(db): finance_categories schema`
- `feat(db): counterparties schema`
- `feat(db): transactions schema with balance trigger`
- `feat(db): account_files and attachment pivots`
- `feat(db): finance RLS policies`
- `feat(db): default finance categories on onboarding`
- `feat(db): attachments RLS policies`
- `feat(finance): transactions backend`
- `feat(finance): bank-accounts backend`
- `feat(finance): categories and counterparties backend`
- `feat(finance): statistics aggregations`
- `feat(files): unified attachments API`
- `test(sql): finance and attachments`

### Этап 4. Финансовый модуль — UI (4–6 недель)

**Ветка-родитель:** `feat/04-finance-ui` (под-ветки на каждую страницу).

- [ ] **4.1** (1 неделя) — общие компоненты в `src/components/finance/`:
  - `<AmountInput>` (с RUB-форматированием)
  - `<CategoryPicker>`, `<CounterpartyPicker>`, `<BankAccountPicker>`, `<LegalEntityPicker>`
  - `<DateRangePicker>`
  - `<LegalEntitySwitcher>` в `/finance/layout.tsx`
  - `<AttachmentUploader>` — общий компонент в `src/components/shared/`
  - **Sub-branch:** `feat/04.1-finance-shared-components`

- [ ] **4.2** (3–5 дней) — `/finance/categories`. **Sub-branch:** `feat/04.2-finance-categories`.

- [ ] **4.3** (1 неделя) — `/finance/counterparties` (CRUD + группы + поиск по ИНН + DaData + attachments). **Sub-branch:** `feat/04.3-finance-counterparties`.

- [ ] **4.4** (1 неделя) — `/finance/accounts` (банковские счета: 5 типов + привязка к юрлицу). **Sub-branch:** `feat/04.4-finance-bank-accounts`.

- [ ] **4.5** (2 недели) — `/finance/transactions` — самая сложная:
  - Список с фильтрами (период, тип, юрлицо, venue, счёт, категория, контрагент, сумма от-до, поиск).
  - Сортировка, пагинация.
  - Форма: три типа (income/expense/transfer); валидация zod.
  - Transfer внутри юрлица + между юрлицами одного account (одной транзакцией).
  - Аттачменты: upload, preview, удаление через общий `<AttachmentUploader>`.
  - Soft delete (без UI корзины).
  - Экспорт в Excel.
  - **Sub-branch:** `feat/04.5-finance-transactions`.

- [ ] **4.6** (1 неделя) — `/finance` (главный дашборд):
  - Виджеты: баланс по счетам (с разбивкой по юрлицам), доходы/расходы за период, топ-5 статей расходов, последние транзакции.
  - Графики на recharts: динамика по дням/неделям/месяцам.
  - Фильтр периода + переключатель «по точке / все точки» + переключатель «по юрлицу / все юрлица».
  - **Sub-branch:** `feat/04.6-finance-dashboard`.

### Этап 5. CRM-блок (задел) (1 неделя)

**Ветка:** `feat/05-crm-skeleton`

- [ ] **Миграция 045** — `guests`.
- [ ] **Миграция 046** — `reservations`.
- [ ] **Миграция 047** — `loyalty_*`.
- [ ] **Миграция 048** — RLS для CRM.
- [ ] Бэкенд: `src/lib/crm/{guests,reservations,loyalty}.ts` — минимальный CRUD.
- [ ] UI-заглушки с пометкой «В разработке».
- [ ] SQL-тесты `04_crm_module.sql`.

### Этап 6. Интеграция и навигация (3–5 дней)

**Ветка:** `feat/06-integration`

- [ ] Sidebar: финальная версия с гейтами по permissions.
- [ ] Главная `/dashboard`: общий обзор по доступным блокам.
- [ ] Smart-redirect в middleware.
- [ ] Обновить `BACKLOG.md`.
- [ ] Создать `docs/ARCHITECTURE.md`.
- [ ] Прогнать все SQL-тесты.
- [ ] Smoke test всех модулей.

### Этап 7 (опционально). QuickResto → Finance (1–2 недели)

**Ветка:** `feat/07-quickresto-finance`

- [ ] Webhook handler в `/api/finance/webhooks/quickresto`.
- [ ] Создание transaction `type=income, source=quickresto, category='Выручка POS'`.
- [ ] Маппинг способов оплаты на счета.
- [ ] Дедупликация по `(account_id, source, source_external_id)`.
- [ ] UI: `/settings/integrations/quickresto/sync`.

---

## 7. Оценка времени

| Этап | Длительность |
|---|---|
| 0. Подготовка | 1–2 дня |
| 1. Реструктуризация | 1 неделя |
| 2. Юридические лица | 1.5 недели |
| 3. Finance — БД, бэкенд, attachments | 1.5 недели |
| 4. Finance — UI | 4–6 недель |
| 5. CRM — задел | 1 неделя |
| 6. Интеграция | 3–5 дней |
| 7. QuickResto → Finance | 1–2 недели (опционально) |

**Итог:** **9–13 недель** для полного завершения. **MVP** (юрлица + транзакции + банковские счета + категории + минимальный дашборд) — **5–6 недель**.

---

## 8. Риски и решения

| Риск | Митигация |
|---|---|
| Двойственность имени «account» (тенант vs банковский счёт) | В коде: `account` — тенант, `bank_account` — банковский счёт. В UI: «компания» / «счёт». |
| `legal_entities` vs `accounts` могут запутать пользователя | UI всегда показывает только одно: бренд+лого / реквизиты юрлица. Переключатель юрлица — в шапке `/finance/`. |
| Сложность RLS на transactions (4 уровня изоляции) | SQL-тесты `02_finance_module.sql`. Покрыть кейсы: чужой account, чужое юрлицо, чужой venue, отсутствие права. |
| Регрессии при реструктуризации | Этап 1 — только перемещения. Полный smoke test. 301-редиректы со старых URL. |
| Транзакции из QuickResto могут дублироваться | Constraint `(account_id, source, source_external_id)` UNIQUE. |
| Soft delete растит таблицу | Партиционирование по `date` при > 1M записей. На будущее. |
| Изменение системных ролей ломает права у активных юзеров | Миграция 034 идемпотентна: `INSERT ... ON CONFLICT DO NOTHING`. |
| `complete_owner_onboarding` дублирует данные | Идемпотентна: проверяет наличие account/legal_entity/venue, не пересоздаёт. |
| Активный venue без default_legal_entity_id | Middleware: редирект на `/onboarding/legal-entity`. |
| ИНН/ОГРН валидация | DaData (cleaner API) — обогащение и проверка на сервере. Алгоритмическая валидация checksum ИНН локально. |
| DaData ключ в коде / git | Только в `.env.local`; запросы только через server actions; в `.env.local.example` шаблон без реальных ключей. |
| Сложность TransactionForm (992 строки в ft) | Декомпозиция: `<AmountSection>`, `<TypeSelector>`, `<AccountsSection>`, `<MetadataSection>`, `<AttachmentsSection>`, `<TransferSection>`. |
| Файлы накапливаются в storage без чистки | Cleanup-job: раз в месяц удалять `account_files` без attachments-связей старше 30 дней. На будущее. |
| Между юрлицами один transfer = простой UI, но не «двойная запись» | Принято осознанно (управленческий учёт). При запросе бухгалтерии — мигрируем в `transfer_pair_id` отдельной миграцией. |

---

## 9. Соглашения

### 9.1 Именования

- Префиксы блоков обязательны: `finance_categories`, не `categories`.
- `account_id` — ВСЕГДА тенант (компания владельца). НЕ путать с банковским счётом.
- `bank_account_id` — банковский счёт (бывший `account` из finance-tracker).
- `legal_entity_id` — юрлицо.
- `venue_id` — заведение (физическая точка).

### 9.2 RLS

- Все таблицы — `ENABLE ROW LEVEL SECURITY`.
- Шаблон политик — раздел 4.4.
- Все helper-функции — `SECURITY DEFINER`, `SET search_path = public`.

### 9.3 Audit

- Любое изменение основных сущностей (transactions, legal_entities, venues, profiles, bank_accounts) → запись в `audit_logs` через `log_audit()`.
- В `details jsonb` — diff old/new значений для критичных полей.

### 9.4 DaData

- Все вызовы — через server actions / API routes, никогда с клиента.
- `DADATA_API_KEY` и `DADATA_SECRET_KEY` — только в env.
- Для каждой записи юрлица/контрагента — обязательно `dadata_synced_at` (NULL если данные введены вручную).
- В UI — кнопка «Обновить из DaData» (для повторной синхронизации).

### 9.5 Git workflow

- Каждый этап = отдельная feature-ветка от `main`.
- Внутри ветки — много мелких коммитов (по подзадачам).
- Сложные этапы (например, Этап 4 UI) — разбиты на под-ветки на каждую страницу.
- Перед мерджем в `main` — обязательно: SQL-тесты прошли, smoke test пройден, миграции идемпотентны.
- Pre-commit checks: TypeScript no errors, lint, basic unit tests.

---

## 10. Инструкция исполнителю (Claude Code)

Этот документ — техническое задание. Реализация делается отдельным агентом (Claude Code) через git-ветки и постепенные мерджи в `main`.

### 10.1 Принципы работы

1. **По одному этапу за раз.** Не начинать Этап 2 до полного мерджа Этапа 1.
2. **Каждая подзадача — отдельный коммит.** Чтобы при необходимости легко откатить.
3. **Любая миграция СТРОГО идемпотентна.** Использовать `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `CREATE OR REPLACE`. На existing prod-БД миграции должны проходить без ошибок.
4. **Не трогать существующий функционал в Этапе 1.** Только перемещения файлов, никаких изменений логики.
5. **Перед миграцией БД** — обязательно `supabase db reset --no-backup --debug` на локальной БД, проверка что вся цепочка миграций 001 → новая работает с нуля. Это гарантия для будущих clean-installations.
6. **SQL-тесты не пропускать.** Каждый этап с миграциями завершается прогоном `supabase/tests/*.sql`.
7. **Не использовать живую DaData в тестах.** На тестах мокать ответы DaData фикстурами.
8. **Никогда не коммитить ключи** в репо. Проверять `git status` перед `git push`.
9. **Каждая ветка → PR в main.** В описании PR — ссылка на этот документ и список коммитов с галочками.
10. **При неоднозначности** — НЕ принимать решение самостоятельно, спросить пользователя через комментарий в PR или в чате.

### 10.2 Стартовая последовательность

После чтения этого плана начать с Этапа 0:

```bash
cd ~/Desktop/crm
git checkout -b feat/00-prepare-finance-merge

# 1. Извлечь референсы из finance-tracker
mkdir -p _legacy_from_finance/{types,migrations,components}
cp ~/Desktop/finance-tracker/src/types/*.ts _legacy_from_finance/types/
cp ~/Desktop/finance-tracker/supabase/migrations/*.sql _legacy_from_finance/migrations/
cp ~/Desktop/finance-tracker/src/components/Transactions/TransactionForm.tsx _legacy_from_finance/components/
cp ~/Desktop/finance-tracker/src/components/Transactions/TransactionsPage.tsx _legacy_from_finance/components/
# создать _legacy_from_finance/README.md по аналогии с _legacy_from_crm2/

# 2. Удалить finance-tracker
rm -rf ~/Desktop/finance-tracker

# 3. Обновить .env.local.example
echo "DADATA_API_KEY=" >> .env.local.example
echo "DADATA_SECRET_KEY=" >> .env.local.example

# 4. Положить реальные ключи в .env.local (не в git)

# 5. Обновить BACKLOG.md

# 6. Коммиты
git add -A && git commit -m "chore: import legacy finance-tracker types and migrations as reference"
# и т.д. по плану

# 7. PR в main
gh pr create --title "feat: 00-prepare-finance-merge" --body "..."
```

### 10.3 Чеклист готовности к Этапу 1

- [ ] План v2.1 прочитан полностью.
- [ ] Этап 0 завершён, ветка смерджена в `main`.
- [ ] Папка `~/Desktop/finance-tracker` отсутствует, ценное в `crm/_legacy_from_finance/`.
- [ ] Реальные ключи DaData в `.env.local`, шаблон в `.env.local.example`.
- [ ] BACKLOG.md обновлён с описанием блочной архитектуры.
- [ ] `git status` в `main` чистый.

---

*Документ обновляется по мере реализации. После завершения каждого этапа — обновить чекбоксы в разделе 6 и зафиксировать дату.*
