# Повторяющиеся платежи, этап 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шаблон повторяющегося платежа создаётся из операции; в срок появляется ожидаемый платёж в очереди «Финансы → На разбор», где его проводят, пропускают или переносят.

**Architecture:** Две таблицы — `finance_recurring_templates` (шаблон с расписанием) и `finance_recurring_occurrences` (ожидаемый платёж на каждый наступивший срок, со снимком полей). Расчёт сроков и порождение живут **только в SQL** (одна правда для крона, очереди и «ближайшего срока»); TS лишь описывает расписание словами. «Провести» — SQL-функция с правами вызывающего: в одной транзакции вставляет операцию под RLS и закрывает ожидаемый платёж.

**Tech Stack:** Next.js 15 server actions, Supabase Postgres (RLS, plpgsql), shadcn/ui по `docs/design-system.md`, тесты `node:test` (`*.test.mts`) и SQL-тесты в `supabase/tests/`.

**Spec:** `docs/superpowers/specs/2026-11-21-recurring-payments-design.md`

## Предусловие

**Начинать только после мержа PR #691** («Транзакции»). План опирается на его код: `accounts.timezone` (миграция 370 в #691), политика `transactions_select` с `finance.view_all_legal_entities` / `finance.view_all_venues` (373 в #691), меню строки `rowMenu` и `openCopy` в `transactions-page.tsx`, панель `transaction-form-sheet.tsx`. Перед стартом: `git fetch origin && git rebase origin/main`, номер миграции `NNN` = следующий после `git ls-tree --name-only origin/main supabase/migrations/ | tail -1`.

## Global Constraints

- Миграция: `supabase/migrations/NNN_finance_recurring_payments.sql`, одна, с `begin; … commit;`. Все функции — `set search_path = public, pg_catalog` (или `''` с полными именами, как в соседних миграциях `private.*`).
- RLS: `(select auth.uid())`, `(select public.has_permission(...))`, `(select public.get_active_*())` — всё в `(select …)`. Одна permissive-политика на `(роль, действие)`.
- Тенантность: `account_id` + `UNIQUE (account_id, id)` + композитные FK `(account_id, X)` и композитные индексы под них.
- Шаблон: `archived_at` / `archived_by`; триплет archive / restore / delete; архив-страница.
- Функции только для крона — `revoke execute … from public, anon, authenticated` + проверка `has_function_privilege` → `raise exception`.
- Журнал — `writeAuditEvent` после подтверждённой записи (`.select("id")`, пустой результат → ошибка). Коды: `finance.recurring.{created,updated,paused,resumed,archived,restored,deleted}`, `finance.recurring_occurrence.{posted,skipped,postponed}`.
- Ожидаемый платёж **не** операция: не попадает в остатки, сводку, отчёты, экспорт.
- Права: просмотр — `finance.view_transactions`; создание и правка шаблонов, разбор очереди — `finance.create_transaction`. Новых кодов прав нет.
- Видимость обеих таблиц = условие `transactions_select` по `legal_entity_id` / `venue_id` (без ветки `deleted_at`).
- Сегодня = `(now() at time zone accounts.timezone)::date`.
- «Последний день месяца» = `day_of_month = 31`, число больше длины месяца сдвигается на последний день.
- UI-тексты: «На разбор», «Повторяющиеся», «Сделать повторяющейся», «Провести», «Пропустить этот раз», «Перенести», «просрочено N дн.», «Сумма меняется».
- CI: `pnpm exec tsc --noEmit` и `pnpm lint` зелёные.

## Review Focus

1. **Двойной клик «Провести» / два открытых окна** — должна появиться ровно одна операция; второй вызов получает «Платёж уже разобран». Тест — задача 2 (`post twice`).
2. **31-е число и февраль, квартал с 31-м** — срок 28/29.02, 30.04, 30.06; ни одного пропущенного месяца. Тест — задача 1.
3. **Крон не работал неделю** — после запуска появляются все наступившие сроки за неделю, каждый ровно один раз; повторный запуск ничего не добавляет. Тест — задача 1.
4. **Шаблон на паузе / в архиве / с прошедшей `ends_on`** — не порождает сроков; уже висящие карточки остаются. Тест — задача 1.
5. **Управляющий одного заведения** не видит шаблоны и карточки другого заведения и не может их провести; счётчик их не считает. Тест — задача 2 (RLS).

---

### Task 1: Таблицы, расписание и порождение сроков (SQL)

**Files:**
- Create: `supabase/migrations/NNN_finance_recurring_payments.sql`
- Create: `supabase/tests/finance-recurring.sql`
- Modify: `src/types/database.ts` (руками добавить две таблицы и функции; полный regen не делать — см. CLAUDE.md)

**Interfaces:**
- Produces (таблицы):
  - `public.finance_recurring_templates`: `id uuid pk`, `account_id`, `legal_entity_id`, `venue_id null`, `bank_account_id`, `category_id null`, `counterparty_id null`, `type transaction_type_enum check (type in ('income','expense'))`, `amount numeric(14,2) > 0`, `amount_varies bool default false`, `currency text default 'RUB'`, `description text null`, `name text not null`, `frequency text check in ('monthly','weekly','quarterly')`, `day_of_month smallint null check 1..31`, `weekday smallint null check 1..7` (ISO, 1 = пн), `quarter_month smallint null check 1..3`, `starts_on date not null`, `ends_on date null`, `paused_at timestamptz null`, `materialize_from date not null`, `source_transaction_id uuid null`, `created_by/at`, `updated_by/at`, `archived_at/by`. Check: monthly → `day_of_month not null`; quarterly → `day_of_month, quarter_month not null`; weekly → `weekday not null`.
  - `public.finance_recurring_occurrences`: `id`, `account_id`, `template_id`, `due_date date`, `UNIQUE (template_id, due_date)`; снимок `legal_entity_id, venue_id, bank_account_id, category_id, counterparty_id, type, amount, amount_varies, currency, description, name`; `status text check in ('pending','posted','skipped') default 'pending'` (`matched` добавит этап 3); `postponed_to date null`; `transaction_id uuid null` с FK `(account_id, transaction_id) → transactions(account_id, id) on delete set null (transaction_id)`; `resolved_by uuid null`, `resolved_at timestamptz null`. Частичный индекс `(account_id, due_date) where status = 'pending'`.
- Produces (функции):
  - `private.finance_recurring_due_dates(p_template public.finance_recurring_templates, p_from date, p_to date) returns setof date` — immutable по входу; учитывает `starts_on`, `ends_on`.
  - `private.finance_recurring_materialize_account(p_account uuid) returns int` — для активных (`archived_at is null and paused_at is null`) шаблонов аккаунта вставляет сроки из `[materialize_from; today]` со снимком полей `on conflict do nothing`, затем `materialize_from = today + 1`; возвращает число вставленных.
  - `public.finance_recurring_materialize_all() returns int` — SECURITY DEFINER, по всем аккаунтам; execute только у `service_role`.
  - `public.finance_recurring_materialize_mine() returns int` — SECURITY DEFINER, для `get_active_account_id()`, требует `has_permission('finance.view_transactions')`, иначе 0; grant `authenticated`.
  - `public.finance_recurring_next_due(p_template_id uuid) returns date` — SECURITY INVOKER: первый срок из `[greatest(materialize_from, today + 1); today + 400]`, `null` на паузе / в архиве / после `ends_on`.
  - Триггер `before update of deleted_at or delete on public.transactions`: если операция удаляется (мягко или совсем), связанный `posted`-платёж → `pending`, `transaction_id = null`, `resolved_* = null`.
- RLS: select на обе таблицы — условие `transactions_select` (account / legal entity / venue / `finance.view_transactions`). Шаблоны: insert/update/delete — то же + `finance.create_transaction`. Платежи: update — то же + `finance.create_transaction`; insert/delete клиенту не дают (только функции).

- [ ] **Step 1: SQL-тесты расписания и порождения** в `supabase/tests/finance-recurring.sql` (шаблон как `01_legal_entities.sql`: `\set ON_ERROR_STOP on`, `begin … rollback`, `test_assert`). Утверждения:
  - monthly `day_of_month=31`, `[2027-01-01; 2027-06-30]` → `{2027-01-31, 2027-02-28, 2027-03-31, 2027-04-30, 2027-05-31, 2027-06-30}`; 2028-02 → `2028-02-29`.
  - quarterly `quarter_month=1, day_of_month=31`, 2027 → `{01-31, 04-30, 07-31, 10-31}`.
  - weekly `weekday=1`, `[2026-11-23; 2026-12-07]` → `{11-23, 11-30, 12-07}`.
  - `starts_on = 2026-12-10`, monthly 5 → первый срок `2027-01-05`; `ends_on = 2027-02-28` → последний `2027-02-05`.
  - materialize: шаблон с `materialize_from = today - 8`, weekly → вставлено 1–2 срока (по календарю), второй вызов → 0, `materialize_from = today + 1`.
  - шаблон на паузе и в архиве → 0 вставок; уже существующий `pending` остаётся.
  - мягкое удаление проведённой операции → платёж `pending`, `transaction_id is null`.
  - `has_function_privilege('anon', 'public.finance_recurring_materialize_all()', 'execute') = false`, то же для `authenticated`.
- [ ] **Step 2: Прогнать — падает** (функций нет):
  `pnpm db:reset && docker exec -i supabase_db_crm psql -U postgres -d postgres -f - < supabase/tests/finance-recurring.sql` → ошибка `function … does not exist`.
- [ ] **Step 3: Написать миграцию** по Interfaces. Алгоритм сроков: перебор месяцев `generate_series(date_trunc('month', p_from), p_to, '1 month')`, день = `least(day_of_month, extract(day from (month + interval '1 month - 1 day')))`; для quarterly — фильтр `(extract(month) - 1) % 3 = quarter_month - 1`; weekly — `generate_series(p_from, p_to, '1 day')` с `extract(isodow) = weekday`. Затем фильтр `between greatest(p_from, starts_on) and least(p_to, coalesce(ends_on, p_to))`. В конце миграции — проверки `has_function_privilege` с `raise exception` (образец — 361).
- [ ] **Step 4: Прогнать тест** (команда шага 2) → последняя строка `finance-recurring … passed`.
- [ ] **Step 5: Типы** — добавить в `src/types/database.ts` блоки таблиц и функций (как сгенерировал бы `supabase gen types`), `pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 6: Commit** — `git add supabase/ src/types/database.ts && git commit -m "Повторяющиеся платежи: таблицы, сроки, порождение"`.

### Task 2: «Провести», «Пропустить», «Перенести» (SQL) и серверные действия

**Files:**
- Modify: `supabase/migrations/NNN_finance_recurring_payments.sql` (до мержа это та же неприменённая миграция)
- Modify: `supabase/tests/finance-recurring.sql`
- Create: `src/lib/finance/recurring.ts` (`"use server"`)
- Modify: `src/types/finance.ts`, `src/lib/audit/action-categories.ts`, `src/lib/audit/format.tsx`

**Interfaces:**
- Consumes: таблицы и `finance_recurring_materialize_mine()` из задачи 1.
- Produces (SQL, SECURITY INVOKER, `set search_path`):
  - `public.finance_recurring_post(p_occurrence uuid, p_amount numeric, p_date date, p_bank_account uuid, p_category uuid, p_counterparty uuid, p_venue uuid, p_description text) returns uuid` — `select … for update` платежа со `status = 'pending'` (нет → `raise exception 'Платёж уже разобран'`), `insert into transactions` (source `manual`, `date` — полночь UTC дня `p_date`, как у ручных операций, `created_by = auth.uid()`), `update` платежа: `posted`, `transaction_id`, `resolved_by/at`. Возвращает id операции.
- Produces (TS, `src/types/finance.ts`):
  - `RecurringTemplateRow = Tables<"finance_recurring_templates">`, `RecurringOccurrenceRow = Tables<"finance_recurring_occurrences">`.
  - `RecurringSchedule = { frequency: "monthly"; dayOfMonth: number } | { frequency: "quarterly"; dayOfMonth: number; quarterMonth: 1 | 2 | 3 } | { frequency: "weekly"; weekday: number }`.
  - `RecurringTemplateInput = { name: string; type: "income" | "expense"; legal_entity_id: string; venue_id: string | null; bank_account_id: string; category_id: string | null; counterparty_id: string | null; amount: number; amount_varies: boolean; description: string | null; schedule: RecurringSchedule; starts_on: string; ends_on: string | null; source_transaction_id?: string | null }`.
  - `RecurringTemplateListItem = RecurringTemplateRow & { next_due: string | null }`.
- Produces (server actions, `src/lib/finance/recurring.ts`, все возвращают `{ …; error: string | null }`):
  - `createRecurringTemplate(input: RecurringTemplateInput): Promise<{ id: string | null; error: string | null }>` — `materialize_from = max(завтра, дата исходной операции + 1)`.
  - `updateRecurringTemplate(id: string, input: RecurringTemplateInput)` — если расписание или `starts_on` изменились, `materialize_from = завтра`.
  - `pauseRecurringTemplate(id)`, `resumeRecurringTemplate(id)` (resume → `materialize_from = завтра`), `archiveRecurringTemplate(id)`, `restoreRecurringTemplate(id)`, `deleteRecurringTemplate(id)` (только архивный).
  - `listRecurringTemplates({ archived: boolean }): Promise<{ items: RecurringTemplateListItem[]; error: string | null }>`.
  - `listInbox(): Promise<{ items: RecurringOccurrenceRow[]; error: string | null }>` — сначала `rpc("finance_recurring_materialize_mine")`, затем `pending` с `postponed_to is null or postponed_to <= today`, по `due_date`.
  - `countInbox(): Promise<number>` — то же условие, `count: "exact", head: true`.
  - `postOccurrence(id: string, patch: { amount: number; date: string; bank_account_id: string; category_id: string | null; counterparty_id: string | null; venue_id: string | null; description: string | null }): Promise<{ transactionId: string | null; error: string | null }>`.
  - `skipOccurrence(id: string)`, `postponeOccurrence(id: string, to: string)` — `update … eq("status","pending").select("id")`; пусто → `"Платёж уже разобран"`.
- Журнал: каждое действие — `writeAuditEvent` с `entityType: "finance_recurring_template"` / `"finance_recurring_occurrence"`; в `action-categories.ts` суффиксы `.paused`, `.resumed`, `.posted`, `.skipped`, `.postponed` → «Изменение»; фразы в `format.tsx` («провёл(а) платёж «Аренда» на 150 000 ₽» и т.д.).

- [ ] **Step 1: SQL-тесты** в `finance-recurring.sql`: `post` создаёт одну операцию с суммой `p_amount` и закрывает платёж; второй `post` того же платежа → исключение `Платёж уже разобран`, операций по-прежнему одна; под ролью `authenticated` с правами только своего заведения (`set local role authenticated` + `request.jwt.claims`, как в `02_finance_module.sql`) платёж чужого заведения не виден (`count = 0`), `post` → исключение.
- [ ] **Step 2: Прогнать** → падает (`function finance_recurring_post does not exist`).
- [ ] **Step 3: Дописать `finance_recurring_post` в миграцию**, `pnpm db:reset`, прогнать тест → `passed`.
- [ ] **Step 4: Типы и серверные действия** по Interfaces; права проверять `getCachedPermissionChecker` (как `createTransaction`).
- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm lint` → без ошибок.
- [ ] **Step 6: Commit** — `git commit -m "Повторяющиеся платежи: проведение, пропуск, перенос, журнал"`.

### Task 3: Расписание словами и поля расписания

**Files:**
- Create: `src/lib/finance/recurring-schedule.ts`, `src/lib/finance/recurring-schedule.test.mts`
- Create: `src/app/(dashboard)/finance/recurring/_components/schedule-fields.tsx`

**Interfaces:**
- Consumes: `RecurringSchedule` из задачи 2.
- Produces:
  - `describeSchedule(s: RecurringSchedule): string`
  - `overdueDays(dueDate: string, today: string): number` (0, если не просрочен)
  - `scheduleFromTemplate(t: Pick<RecurringTemplateRow, "frequency" | "day_of_month" | "weekday" | "quarter_month">): RecurringSchedule`
  - `defaultScheduleFromDate(date: string): RecurringSchedule` — monthly, день = день даты (31 → «последний день»).
  - `<ScheduleFields value onChange />` — частота (месяц / неделя / квартал), число месяца с пунктом «Последний день», день недели, месяц квартала; `starts_on`, `ends_on` (необязательно).

- [ ] **Step 1: Тесты** (`node:test`, `assert.equal`):
  - `describeSchedule({frequency:"monthly",dayOfMonth:5})` → `"каждый месяц 5-го"`; `dayOfMonth:31` → `"каждый месяц в последний день"`.
  - weekly `weekday:1` → `"каждую неделю по понедельникам"`; `weekday:3` → `"каждую неделю по средам"`.
  - quarterly `quarterMonth:1, dayOfMonth:10` → `"каждый квартал 10-го в первом месяце"`.
  - `overdueDays("2026-12-05","2026-12-07")` → `2`; `("2026-12-05","2026-12-05")` → `0`.
  - `defaultScheduleFromDate("2026-11-05")` → `{frequency:"monthly",dayOfMonth:5}`.
- [ ] **Step 2:** `node --test --experimental-strip-types src/lib/finance/recurring-schedule.test.mts` → FAIL (модуля нет).
- [ ] **Step 3:** Реализовать модуль и `ScheduleFields` (контролы — из `src/components/ui`, разметка раздела — `DrawerSection`).
- [ ] **Step 4:** Тест → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Повторяющиеся платежи: расписание словами и поля"`.

### Task 4: Панель шаблона, «Сделать повторяющейся», страница «Повторяющиеся» и архив

**Files:**
- Create: `src/app/(dashboard)/finance/recurring/page.tsx`, `loading.tsx`, `error.tsx`, `archive/page.tsx`
- Create: `src/app/(dashboard)/finance/recurring/_components/recurring-page.tsx`, `recurring-form-sheet.tsx`
- Modify: `src/app/(dashboard)/finance/transactions/_components/transactions-page.tsx` (пункт меню строки), `src/components/shared/sidebar.tsx` (пункт «Повторяющиеся» в разделе «Финансы», право `finance.view_transactions`)

**Interfaces:**
- Consumes: действия задачи 2, `ScheduleFields` / `describeSchedule` / `defaultScheduleFromDate` задачи 3.
- Produces: `RecurringFormSheet({ mode: { kind: "closed" } | { kind: "create"; from?: TransactionRow } | { kind: "edit"; template: RecurringTemplateRow }, onClose, onSaved, …справочники как у TransactionFormSheet })`.

- [ ] **Step 1: Панель шаблона.** Тип А «Боковая панель» DS: разделы «Платёж» (название; тип — доход/расход; счёт; статья; контрагент; заведение; сумма + переключатель «Сумма меняется»; описание) и «Расписание» (`ScheduleFields`). Пикеры статьи, контрагента, счёта, заведения — те же компоненты, что в `transaction-form-sheet.tsx`; если они там объявлены внутри файла, вынести в `finance/transactions/_components/fields/` без изменения поведения. Из операции: поля — из операции, название — контрагент, иначе статья, иначе «Платёж»; расписание — `defaultScheduleFromDate(tx.date в поясе аккаунта)`; `starts_on` — сегодня.
- [ ] **Step 2: Меню строки операции** — в `rowMenu` после «Копировать»: `{ label: "Сделать повторяющейся", icon: <Repeat />, onSelect: … }` при `permissions.create && tx.type !== "transfer" && !tx.deleted_at`; открывает `RecurringFormSheet` с `{ kind: "create", from: tx }`; после сохранения — toast «Повторяющийся платёж создан» с действием «Открыть» → `/finance/recurring`.
- [ ] **Step 3: Страница «Повторяющиеся»** по эталону таблиц DS (`PageFrame`, h1 36px без описания, инструменты в нижней строке шапки, без saved-views — см. memory `feedback_table_standardization_checklist`). Колонки: Название, Сумма (`~150 000 ₽` при `amount_varies`), Расписание (`describeSchedule`), Ближайший срок (`next_due`, «—» на паузе), Счёт, Состояние («Активен» / «На паузе», бейдж по `feedback_dark_mode_badge_palette`). Меню строки: Изменить, Приостановить/Возобновить, Архивировать. Кнопка «Создать». Пустое состояние: «Повторяющихся платежей пока нет. Создайте из операции в «Транзакциях» — пункт «Сделать повторяющейся» в меню строки».
- [ ] **Step 4: Архив** — `archive/page.tsx` по образцу архива счетов: Восстановить, Удалить навсегда (диалог подтверждения).
- [ ] **Step 5: Проверка в браузере** (`pnpm dev` в фоне через Bash, не через preview_start — memory): создать шаблон из операции, увидеть его в списке с ближайшим сроком; приостановить → «На паузе», «—»; архивировать → в архиве; восстановить. `pnpm exec tsc --noEmit && pnpm lint` → без ошибок.
- [ ] **Step 6: Commit** — `git commit -m "Повторяющиеся платежи: панель, меню строки, список и архив"`.

### Task 5: Очередь «На разбор», счётчик, плашка, cron, справка

**Files:**
- Create: `src/app/(dashboard)/finance/inbox/page.tsx`, `loading.tsx`, `error.tsx`, `_components/inbox-page.tsx`, `_components/occurrence-card.tsx`
- Create: `src/app/api/cron/finance-recurring/route.ts`
- Create: `src/lib/finance/use-inbox-count.ts`
- Modify: `src/components/shared/sidebar.tsx`, `src/app/(dashboard)/layout.tsx` (начальный счётчик), сводка `src/app/(dashboard)/finance/(overview)/page.tsx` и `transactions-page.tsx` (плашка), `src/app/(dashboard)/_components/page-help-registry.tsx`
- Create: `docs/handbook/finance/recurring.md`; Modify: `docs/handbook/finance/index.md`

**Interfaces:**
- Consumes: `listInbox`, `countInbox`, `postOccurrence`, `skipOccurrence`, `postponeOccurrence`, `overdueDays`.
- Produces: `useInboxCount(enabled: boolean, initialCount: number): number` (по образцу `useNewCandidateCount`: обновление при фокусе окна и по событию `finance:inbox-changed`, которое шлёт очередь после каждого разбора).

- [ ] **Step 1: Cron-роут** `POST /api/cron/finance-recurring` — копия `medical-book-expiry-notifications/route.ts` (проверка `X-Cron-Secret`), вызывает `finance_recurring_materialize_all` admin-клиентом, отвечает `{ enqueued, timestamp }`. В комментарии — строка crontab: `5 0 * * * curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" https://crm.sheerly.app/api/cron/finance-recurring`. Проверка: `curl -X POST localhost:3000/api/cron/finance-recurring` без секрета → 401, с секретом → 200.
- [ ] **Step 2: Карточка** `OccurrenceCard`: строка-мета (название · срок `dd.MM` · «просрочено N дн.» красным при `overdueDays > 0` · счёт · контрагент), крупная сумма (поле ввода; при `amount_varies` пустое с подсказкой «~150 000 ₽» и обязательное), статья, заведение, дата проведения (по умолчанию сегодня), описание. Кнопки: «Провести» (основная), «Пропустить этот раз», «Перенести» (выбор даты, не раньше завтра). Ошибка действия — в карточке, кнопки выключены на время запроса.
- [ ] **Step 3: Очередь** `/finance/inbox`: заголовок «На разбор», «Осталось N», одна карточка, стрелка «дальше» и «назад»; после разбора — следующая; пусто — `EmptyState` «Всё разобрано. Здесь появляются повторяющиеся платежи, когда наступает их срок» со ссылкой на «Повторяющиеся». Право на разбор — `finance.create_transaction`, без него карточки только для чтения.
- [ ] **Step 4: Счётчик и плашка.** Пункт сайдбара «На разбор» первым в разделе «Финансы» с `badge = useInboxCount(...)` (0 → без бейджа); начальное значение — `countInbox()` в `layout.tsx` рядом с `candidateCountRes`. Плашка в шапке сводки «Финансов» и «Транзакций» при `count > 0`: красная, текст «N платеж(а/ей) ждут разбора» (склонение через существующий хелпер плюрализации), ссылка на `/finance/inbox`.
- [ ] **Step 5: Справка** — `docs/handbook/finance/recurring.md` по `_template.md`: что такое повторяющийся платёж, как создать из операции, расписание (включая «последний день» и короткие месяцы), очередь «На разбор» и три действия, просрочка, пауза/архив, что ожидаемый платёж не меняет остатки; без технических слов. Ссылка в `index.md`; запись в `page-help-registry.tsx` для `/finance/inbox` и `/finance/recurring`, если реестр требует.
- [ ] **Step 6: Проверка в браузере**: шаблон с `starts_on` ≤ сегодня и сроком сегодня (выставить `materialize_from` на сегодня через SQL локально) → открыть «На разбор» → карточка есть, бейдж 1 → «Провести» → операция в «Транзакциях», бейдж исчезает; повторить с «Пропустить» и «Перенести на завтра». Удалить проведённую операцию → карточка вернулась. Полный прогон: `node --test --experimental-strip-types "src/**/*.test.mts"`, `pnpm exec tsc --noEmit`, `pnpm lint`, SQL-тест задачи 1.
- [ ] **Step 7: Commit** — `git commit -m "Повторяющиеся платежи: очередь «На разбор», счётчик, cron, справка"`.

### Task 6: PR и выкат

- [ ] **Step 1:** `git push -u origin HEAD`, `gh pr create --base main` с описанием (что сделано, скриншоты очереди и списка, шаги выката). Не мержить без команды Павла.
- [ ] **Step 2: Шаги выката в описании PR** (выполнять после мержа, memory `prod_migration_drift_122`, `self_hosted_supabase`): применить миграцию через SSH (`-U supabase_admin` при необходимости), вставить строку в реестр миграций; добавить crontab-строку из задачи 5 на `woord-vps`; передеплой — вручную (memory `prod_deploy_manual`).
