# Этап 5: штрафы в чат и шаблоны по дням недели — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** записи журнала зарплаты (предупреждения, штрафы, премии) уходят в чат управляющих из Sheerly вместо n8n; шаблоны смен получают время по группам дней недели.

**Architecture:** Уведомления — очередь отправки на каждую запись журнала. Её наполняет триггер, разбирает существующий фоновый обработчик зарплаты. Текст и правила отбора — чистые функции с тестами. Шаблоны получают `variants jsonb`. Время смены по дню недели считает чистая функция, её используют редактор графика и серверная проверка.

**Tech Stack:** Next.js 15 server actions, Supabase/Postgres, Telegram Bot API (`src/lib/integrations/telegram-bot.ts`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-05-schedule-templates-fines-taxi-design.md`

## Global Constraints

- Два PR, оба `--base main`, как в спецификации: Tasks 1–3 — ветка `claude/schedule-templates-fines` (PR 1, штрафы в чат); Tasks 4–5 — ветка `claude/schedule-template-variants` от `origin/main` после мержа PR 1 или параллельно (PR 2, шаблоны). Миграции: `316_payroll_adjustment_notifications.sql`, `317_schedule_template_variants.sql` (проверить `ls supabase/migrations | tail -2` — последняя 315).
- Конвенции миграций из CLAUDE.md:
  - `set search_path = public, pg_catalog` в каждой функции;
  - `(select auth.uid())` в RLS;
  - композитные `(account_id, …)` FK;
  - без `CONCURRENTLY`;
  - одна permissive-политика на (role, action).
- Токен бота — только через `loadTelegramBot` (`src/lib/integrations/telegram-bot.ts`), никогда в логах, ответах и журнале.
- Отправляются только записи: `approved = true`, `deleted_at is null`, `created_at >= fines_notify_from`, `origin` не в (`warning_threshold`, `glide`, `inventory_deduction`). Бонусные (`medium = 'bonus'`) — только при `external_state = 'done'`.
- Формат сообщения (HTML), строки через `\n`:
  - `<b>{КАТЕГОРИЯ}</b>`, где ПРЕДУПРЕЖДЕНИЕ = `kind='warning'`, ШТРАФ = отрицательная сумма, ПРЕМИЯ = положительная;
  - `📅  {дд.мм.гггг business_date}`;
  - `👫  {имя}`;
  - `💰  {|сумма| без копеек при целой}₽` или ` бонусов` при `medium='bonus'` — для предупреждения строки нет;
  - `📜  {reason}`;
  - для предупреждения `📮 Кол-во предупреждений: {N}`, где N — неудалённые предупреждения сотрудника за месяц `business_date` с `created_at` ≤ этой записи.
- Тексты UI по-русски; `docs/design-system.md`; справка `docs/handbook/` обязательна.
- Проверки: `pnpm exec tsc --noEmit`, `pnpm lint`, `node --test --experimental-strip-types` по затронутым `*.test.mts`, `pnpm db:reset` для миграций.

## Review Focus

1. Повтор обработчика после сбоя Telegram или процесса не шлёт второе сообщение по записи, у которой уже есть `message_id`. Тест в Task 2.
2. Запись, созданная до `fines_notify_from`, и запись, удалённая до отправки, не уходят никогда. Тест в Task 1 (SQL) и Task 2.
3. Бонусная запись в `pending`/`review` не отправляется. После перехода в `done` уходит один раз. Тест в Task 1.
4. Шаблон с пересекающимися днями вариантов отклоняется и в форме, и сервером (`schedule_command`). Тест в Task 4 и Task 5.
5. Смена через полночь (17:30–03:00) по шаблону получает конец на следующий день. День недели берётся по дате начала. Тест в Task 4.

---

### Task 1: Очередь уведомлений и настройки чата (миграция 316)

**Files:** Create `supabase/migrations/316_payroll_adjustment_notifications.sql`, `supabase/tests/payroll_adjustment_notifications.sql`; types точечно в `src/types/database.ts`.

**Interfaces — Produces:**
- `organization_telegram_settings` + `fines_chat_id text`, `fines_notify_from timestamptz` (null = выключено).
- `payroll_adjustment_notifications(adjustment_id uuid, account_id, venue_id, state text check in ('pending','sending','sent','error','skipped'), attempts int default 0, available_at timestamptz default now(), message_id bigint, last_error text, created_at, updated_at, primary key(account_id, adjustment_id))`, FK `(account_id, venue_id, adjustment_id)` → `payroll_adjustments(account_id, venue_id, id)`. RLS: чтение — `private.payroll_read(account_id, venue_id)`. Запись — только service_role.
- Триггер `after insert or update of approved, deleted_at, external_state on payroll_adjustments`: если запись подходит под правила отбора из Global Constraints (настройки берутся по `account_id`), то `insert … on conflict do nothing` со `state='pending'`. Если запись удалена, а уведомление ещё `pending`/`error`, ставится `state='skipped'`.
- RPC (service_role, `security definer`):
  - `payroll_claim_adjustment_notification() returns jsonb` — берёт одну `pending`/`error` с `available_at <= now()` и `attempts < 8`, переводит в `sending` с `for update skip locked`, возвращает поля записи, имя сотрудника, число предупреждений за месяц, путь первого фото и `fines_chat_id`. Если запись к этому моменту удалена — переводит в `skipped` и возвращает следующую;
  - `payroll_finish_adjustment_notification(p_adjustment uuid, p_account uuid, p_message_id bigint, p_error text)` — `sent` с `message_id`, либо `error` с `attempts+1` и `available_at = now() + least(attempts², 60) минут`.
  - Зависшая `sending` старше 10 минут без `message_id` возвращается в `error`.
- RPC для UI `payroll_save_fines_chat(p_chat_id text, p_enabled boolean)` — право как у настроек Telegram (см. `274_organization_telegram.sql`). Включение ставит `fines_notify_from = now()`, если он был null. Выключение — null.

- [ ] SQL-тест:
  - запись до `fines_notify_from` — нет строки очереди;
  - после — есть;
  - `warning_threshold` — нет;
  - бонусная `pending` — нет, после `update external_state='done'` — есть одна;
  - удаление `pending` → `skipped`;
  - чужой аккаунт под authenticated видит 0 строк.
- [ ] `pnpm db:reset` → тест зелёный → commit.

### Task 2: Текст сообщения и обработчик отправки

**Files:**
- Create `src/lib/payroll/adjustment-notify.ts` (чистые функции) и `src/lib/payroll/adjustment-notify.test.mts`.
- Create `src/lib/payroll/adjustment-notify-worker.ts` (server-only).
- Modify:
  - `src/lib/integrations/telegram-bot.ts` — `sendPhoto(chatId, photoUrl, caption)` и `parse_mode: 'HTML'` опцией у `sendMessage`;
  - `src/app/api/cron/payroll/route.ts` — вызвать обработчик после бонусов, свой try/catch и бюджет 5 с, как у соседних блоков.

**Interfaces — Consumes:** RPC из Task 1. **Produces:**
```ts
export type NotifyRow = { kind: string; medium: "money" | "bonus" | "none"; amount: number; reason: string; business_date: string; employee_name: string; warnings_in_month: number };
export function formatAdjustmentMessage(row: NotifyRow): string;
export async function processAdjustmentNotification(): Promise<{ idle: boolean; sent?: boolean; error?: string }>;
```
- [ ] Тесты `formatAdjustmentMessage`:
  - предупреждение с N=3 — без строки 💰, с «📮 Кол-во предупреждений: 3»;
  - штраф `-800` money → «💰  800₽»;
  - бонусный штраф `-3600` → «💰  3600 бонусов»;
  - премия `500` → «ПРЕМИЯ»;
  - `&`, `<`, `>` в причине и имени экранируются;
  - дата `2026-10-28` → `28.10.2026`.
- [ ] Обработчик:
  - claim;
  - бот через `loadTelegramBot(account_id)`. Бота нет → finish с ошибкой «Telegram не настроен»;
  - если есть фото — подписанная ссылка `payroll-photos` на 600 с через admin-клиент и `sendPhoto`, иначе `sendMessage`;
  - finish с `message_id` или текстом ошибки без токена.
  - Тест на повтор: имитация падения после успешного send (`finish` выбросил) — следующий claim этой записи не берёт. Это обеспечивает `sending`+10 минут из Task 1; повтор после этого допустим только при `message_id is null`. Сам тест — SQL в Task 1.
- [ ] tsc/lint/tests → commit.

### Task 3: Настройка «Чат штрафов и премий» и справка

**Files:** Modify `src/app/(dashboard)/settings/integrations/telegram/telegram-settings.tsx`, `…/telegram/actions.ts`; справка `docs/handbook/people/` (страница о журнале зарплаты — добавить раздел «Уведомления в чат») и `docs/handbook/settings/` (Telegram).

- Поле «Чат штрафов и премий» (ID чата, проверка `^-?\d+$`, название подтягивается как у остальных чатов).
- Переключатель «Отправлять в чат» с подписью «Записи, созданные до включения, не отправляются», плюс дата включения, если оно включено.
- Сохранение через `payroll_save_fines_chat`.
- [ ] tsc/lint → commit.

### Task 4: Варианты шаблона по дням недели — модель и расчёт

**Files:**
- Create:
  - `supabase/migrations/317_schedule_template_variants.sql`;
  - `src/lib/schedule/template-times.ts`, `src/lib/schedule/template-times.test.mts`.
- Modify `src/lib/schedule/types.ts`.

**Interfaces — Produces:**
- `schedule_templates.variants jsonb not null default '[]'` — массив `{days: int[] (1=ПН…7=ВС), start_time: 'HH:MM', end_time: 'HH:MM'}`. Пустой массив = `start_time/end_time` на все дни (обратная совместимость). При непустом `start_time/end_time` = первый вариант.
- `schedule_command` (`create or replace`, полная копия текущей версии из последней миграции, где она менялась, — найти `grep -ln "function public.schedule_command" supabase/migrations`): для `template.create/edit/copy` принимает `variants`. Проверки:
  - ≤ 7 вариантов;
  - дни 1..7 без повторов внутри и между вариантами;
  - у каждого варианта есть день;
  - время валидно;
  - перерыв меньше длительности каждого варианта.
  - Ошибка — «Дни недели в вариантах шаблона не должны повторяться».
```ts
export type TemplateVariant = { days: number[]; start_time: string; end_time: string };
export function templateTimesFor(t: { start_time: string; end_time: string; variants: TemplateVariant[] }, isoWeekday: number): { start_time: string; end_time: string } | null; // null — шаблон в этот день не работает
export function validateVariants(v: TemplateVariant[]): string | null; // текст ошибки или null
```
- [ ] Тесты:
  - пустые варианты → время шаблона на любой день;
  - «Мастер · день»: ВТ → 11:50–00:30, СБ → 13:20–00:30;
  - день вне вариантов → null;
  - повтор дня → ошибка;
  - вариант без дней → ошибка.
- [ ] SQL-проверка в `supabase/tests/` (новый файл `schedule_template_variants.sql`): повтор дня отклоняется `schedule_command`.
- [ ] `pnpm db:reset` → tests → commit.

### Task 5: Редактор шаблона и выбор шаблона в смене

**Files:** Modify `src/app/(dashboard)/schedule/_components/editors.tsx` (`TemplateEditor` и форма смены около строк 255–400), `src/app/(dashboard)/schedule/actions.ts` (zod `template` + `variants`), справка `docs/handbook/` по графику (если раздела нет — `docs/handbook/schedule/index.md` из `_template.md` + ссылка в `README.md`).

- Редактор шаблона — таблица вариантов: семь переключателей ПН…ВС, начало, конец, удалить; «Добавить вариант». Проверка `validateVariants` до отправки. Раскладка — `docs/design-system.md`.
- Форма смены: в списке шаблонов только те, у которых `templateTimesFor(t, weekday(date)) !== null`. Выбор шаблона или смена даты при выбранном шаблоне подставляет начало и конец. Ручная правка времени после этого не перетирается, пока снова не выбран шаблон.
- Время через полночь работает как сейчас: конец раньше начала = следующие сутки.
- [ ] tsc/lint → commit.

### Task 6: Перенос и приёмка (после мержа, с владельцем)

1. Миграции 316, 317 на прод (stdin psql + строка в `supabase_migrations.schema_migrations`).
2. Должность «Барбек» — создать в Sheerly (людям: Должности), «Клиннер» оставить.
3. 7 шаблонов из таблицы спецификации — SQL по данным спецификации, должности по названию роли. Затем связать смены с 01.11 без шаблона: должность, день недели начала, начало и конец совпадают точно с одним вариантом. Отчёт о несвязанных — владельцу.
4. Чат штрафов `-1001225310174`: проверить, что бот Sheerly в нём состоит и может писать (`getOwnMembership`). Если нет — владелец добавляет бота.
5. Переключение, одним шагом по команде владельца:
   - выключить n8n UPXonbL4CRNOKigT и 71wQqcWrKr9IPvEp (не удалять);
   - включить «Отправлять в чат»;
   - следить за первыми сообщениями.
6. Бонусы:
   - Ковалёв +300 (20.07) — мягко удалить с причиной «Не проводится по решению владельца»;
   - записать `payroll_execution_policy` (legacy_stopped, bonus_from = сегодня) и `PAYROLL_BONUS_WRITES_ENABLED=true` в Coolify, затем передеплой;
   - Павлов −3600 и Попов +500 создавались до активации, поэтому `payroll_prepare_bonus_operations` их не возьмёт. Поставить их в `payroll_bonus_operations` разовой вставкой с текущей `policy_version`;
   - первую операцию сверить с историей бонусного счёта в Quick Resto.
