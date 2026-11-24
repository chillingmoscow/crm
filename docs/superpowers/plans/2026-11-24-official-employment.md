# Официальное трудоустройство и автоматическая официальная часть — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сотрудника оформляют официально; в ведомости месяца M видна ожидаемая официальная часть, «К выплате» меньше на неё; в начале M+1 приложение само проводит выплату «выдано на руки / закрыто оклад» с расчётного счёта, без Adesk; месяц увольнения разбирается в «Финансы → На разбор».

**Architecture:** Три новые таблицы — периоды оформления, версии оклада и «официальный месяц» (одна строка на сотрудника и месяц: проведено / на разборе / пропущено; она же — защита от повторного проведения и источник карточек «На разбор»). Расчёт суммы месяца (полный / первый пропорционально календарным дням / последний — неизвестно) живёт **только в SQL** (`private.payroll_official_gross`) и отдаётся интерфейсу через RPC `payroll_official_expected` — одна правда для крона и ведомости. Выплата — обычная `payroll_payments` с `official_month`, проведённая через `private.payroll_post_payment_scoped`, где для неё снято ограничение «закрыто = выдано». В TS — только налог на руки и протаскивание ожидаемой суммы в `statementRows`.

**Tech Stack:** Next.js 15 server actions, Supabase Postgres (plpgsql, RLS), shadcn/ui по `docs/design-system.md`, `node:test` (`*.test.mts`), SQL-тесты `supabase/tests/`.

**Spec:** `docs/superpowers/specs/2026-11-24-official-employment-design.md`

## Предусловие

`git fetch origin && git rebase origin/main`. Номер миграции — следующий после `git ls-tree --name-only origin/main supabase/migrations/ | tail -1` (на 24.11 после rebase — 382, значит **383**). Задачи 1–3 — три миграции подряд (383, 384, 385); перед мержем перепроверить номера ещё раз (memory `migration_numbering_rebase`).

## Global Constraints

- Миграции: `begin; … commit;`, каждая `create or replace function` — `set search_path = public, pg_catalog`; RLS через `(select auth.uid())`, `(select public.has_permission(...))`, `(select public.get_active_*())`; одна permissive-политика на `(роль, действие)`; явные `grant … to anon, authenticated` на новые таблицы (SSH-применение от `supabase_admin`).
- Тенантность: `account_id`, `venue_id`, `UNIQUE (account_id, venue_id, id)`, композитные FK `(account_id, venue_id, employee_id) → payroll_employees(account_id, venue_id, id)` и индексы в том же порядке.
- Функции крона — `revoke execute … from public, anon, authenticated` + `has_function_privilege` → `raise exception`.
- Изменяемые функции (`private.payroll_post_payment_scoped` из 246:69, `private.payroll_queue_adesk_sync` из 347:42, `public.staff_begin_termination` из 315:216) — копировать **последнее** тело целиком и менять только указанные строки.
- НДФЛ: `tax = round(gross * 0.13, 0)` (до рубля), `net = gross − tax`. Оклад первого месяца: `round(salary * (days_in_month − day(starts_on) + 1) / days_in_month, 2)`. Павлов с 03.11.2026, 80 000 → 74 666,67 / НДФЛ 9 707 / на руки 64 959,67.
- Официальная выплата: `kind='salary'`, ровно одна аллокация, `settled_amount = gross ≥ amount = net`, счёт только `bank_accounts.type='checking'`, в Adesk не ставится.
- Ожидаемая часть считается только для месяцев `≥ payroll_settings.official_from`; прошлые месяцы не трогаются.
- Журнал: коды `payroll.official_employment.{created,updated,ended,cancelled}`, `payroll.official_salary.created`, `payroll.official_payment.{created,account_changed}`, `payroll.official_month.{resolved,skipped}`, `payroll.official_run.created` (одна строка на заведение и запуск). Фразы — в `src/lib/audit/format.tsx`. Сущности `payroll_official_employment`, `payroll_official_month` добавить в ограничительную политику `payroll_audit_salary_access` (последняя — 355:152).
- Права: просмотр — то же условие, что у `payroll_payments` select; оформление/оклад/увольнение — `payroll.configure`; проведение, разбор, смена счёта — `payroll.pay` + `finance.create_transaction` (как `payroll_record_payments`).
- UI-тексты: «Официальное трудоустройство», «Оформить официально», «Не оформлен официально», «Должность по договору», «Оклад по договору», «На руки X · НДФЛ Y», «Изменить оклад», «Исправить данные», «Уволить официально», «Официальная часть», «выплатит бухгалтерия до 7 <месяца>», «за N из M дней», «сумма уточняется», «Офиц.», «Официально трудоустроены», «Тип счёта».
- Handbook обновляется в задаче, которая меняет видимое.
- CI: `pnpm exec tsc --noEmit`, `pnpm lint`, все `*.test.mts`.

## Review Focus

1. **Выплату за месяц удалили (ошиблись счётом) — крон на следующий день не должен провести её снова.** Защита — строка `payroll_official_months` остаётся после удаления. Тест — задача 2 (`run after cancel posts nothing`).
2. **Крон не работал 5-го, запустился 9-го** — проводит за прошлый месяц один раз, датой 5-го. Тест — задача 2.
3. **Сотрудника уволили в приложении, официальную дату не поставили** — месяц уходит на разбор, а не в автоматическую выплату. Тесты — задача 3 (дата ставится сама) и задача 2 (неактивный `payroll_employees` без `ends_on` → `review`).
4. **Оформление и увольнение в одном месяце / оформление 1-го числа / 31-го** — `final` / `full` / `first` за 1 день. Тест — задача 1.
5. **Официальная часть больше заработанного** — «Переплата», без ошибки проведения. Тест — задача 4 (`remaining` отрицательный).

---

### Task 1: Оформление — таблицы, команда, ожидаемая сумма (миграция 383)

**Files:**
- Create: `supabase/migrations/383_payroll_official_employment.sql`
- Create: `supabase/tests/payroll-official-employment.sql` (шапка прогона — как в `supabase/tests/finance-recurring.sql`)

**Interfaces:**
- Produces:
  - `public.payroll_official_employments(id, account_id, venue_id, employee_id, starts_on date, ends_on date null, position text, contract_number text null, contract_date date null, contract_path text null, created_by, created_at, updated_by, updated_at, archived_at, archived_by)`; частичный unique `(employee_id) where archived_at is null and ends_on is null`.
  - `public.payroll_official_salaries(id, account_id, venue_id, employment_id, valid_from date /*1-е число*/, gross numeric(15,2) check (gross > 0), document_path text null, created_by, created_at)`, unique `(employment_id, valid_from)`.
  - `public.payroll_official_months(id, account_id, venue_id, employment_id, employee_id, month date /*1-е число*/, kind text check in ('full','first','final'), gross numeric(15,2) null, status text check in ('posted','review','resolved','skipped'), reason text null /*'final_month','no_bank_account','no_category','inactive'*/, payment_id uuid null, resolved_by, resolved_at, created_at)`, unique `(employment_id, month)`.
  - `payroll_payments.official_month date null` (check: 1-е число).
  - `payroll_settings.official_from date null`, `official_pay_day smallint not null default 5 check (between 1 and 28)`, `official_bank_account_id uuid null`.
  - `private.payroll_official_gross(p_employment uuid, p_month date) returns table(kind text, gross numeric, days_paid int, days_in_month int)` — `final`, если `ends_on` в месяце M или сотрудник неактивен без `ends_on` (gross null); `first`, если `starts_on` в M после 1-го; иначе `full`. Оклад — версия с наибольшим `valid_from ≤ M`.
  - `public.payroll_official_expected(p_from date, p_to date) returns table(employee_id uuid, employment_id uuid, month date, kind text, gross numeric, days_paid int, days_in_month int)` — по активному заведению, с правом просмотра зарплаты; только месяцы `≥ official_from`, где период активен, а строки `payroll_official_months` нет или она в статусе `review` с известной суммой (`reason in ('no_bank_account','no_category')`).
  - `public.payroll_official_command(p_action text, p_input jsonb) returns uuid`, `payroll.configure`. Действия: `employ {employee_id, starts_on, position, gross, contract_number?, contract_date?, contract_path?}` (создаёт период + оклад с `date_trunc('month', starts_on)`; отказ, если у того же `local_user_id` в аккаунте уже есть открытый период); `update {employment_id, position?, contract_number?, contract_date?, contract_path?, starts_on?}`; `salary {employment_id, valid_from, gross, document_path?}`; `end {employment_id, ends_on}`; `cancel {employment_id}` (архив; отказ, если есть официальные выплаты). Пишет `audit_logs` кодами из Global Constraints.

- [ ] **Step 1: SQL-тест** `supabase/tests/payroll-official-employment.sql`: `employ` Павлова с 2026-11-03 и 80 000 → `payroll_official_gross(.., '2026-11-01')` = (`first`, 74666.67, 28, 30); `'2026-12-01'` → (`full`, 80000, 31, 31); оформление 2026-11-01 → `full`; 2026-11-30 → `first`, 2666.67, 1, 30; `end` 2026-12-15 → декабрь `final`, gross null, январь — нет строки в `payroll_official_expected`; второй `employ` того же пользователя → исключение; `salary` с 2027-01-01 90 000 → январь 90 000; вызов от пользователя без `payroll.configure` → исключение; `official_from = '2026-11-01'` → октябрь в `expected` не попадает.
- [ ] **Step 2: Прогнать** командой из шапки — FAIL (нет таблиц).
- [ ] **Step 3: Написать миграцию 383** с объектами из Interfaces, RLS (select — как у `payroll_payments`; запись только через функции), grants, правкой `payroll_audit_salary_access`.
- [ ] **Step 4: Прогнать тест** — PASS; `pnpm db:reset` проходит.
- [ ] **Step 5: `pnpm regen:types`** (при поломке чужих файлов — вписать новые блоки руками, см. CLAUDE.md).
- [ ] **Step 6: Commit** `feat(payroll): официальное трудоустройство — таблицы и расчёт месяца`.

### Task 2: Официальная выплата, крон, разбор, смена счёта (миграция 384)

**Files:**
- Create: `supabase/migrations/384_payroll_official_payments.sql`
- Create: `supabase/tests/payroll-official-payments.sql`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `private.payroll_post_payment_scoped` — новый ключ входа `official_month`: если задан — требует одну аллокацию, `settled_amount ≥ amount`, `bank.type='checking'`; пишет `payroll_payments.official_month`. Проверка «Округление доступно только для чаевых» (246:99) остаётся для всех прочих.
  - `private.payroll_queue_adesk_sync` — не ставит в очередь при `new.official_month is not null`.
  - `private.payroll_official_post(a uuid, v uuid, u uuid, p_employment uuid, p_month date, p_gross numeric, p_net numeric, p_bank uuid, p_date timestamptz) returns uuid` — категория по должности (как 247:23-25), `note = 'Официальная часть за <месяц>'`, `request_key = md5('official:'||employment||month)` для первого проведения.
  - `public.payroll_record_official_payment(p_input jsonb) returns uuid` — `{employment_id, month, gross, net, bank_account_id, date}`; права как у `payroll_record_payments`; создаёт/обновляет `payroll_official_months` (`resolved`, `payment_id`). Отказ, если для `(employment, month)` уже есть проведённая официальная выплата.
  - `public.payroll_official_skip(p_id uuid) returns void` — `review` → `skipped`.
  - Ветка `'settings'` в `public.payroll_command` (последнее тело — 245:80 с патчем 253:48) принимает `official_from` (1-е число), `official_pay_day` (1–28), `official_bank_account_id` (активный RUB-счёт `type='checking'` заведения/юрлица); эти поля требуют `payroll.pay` + `finance.create_transaction`, как прочие финансовые. Используется в задаче 8.
  - `public.payroll_official_change_account(p_input jsonb) returns uuid[]` — `{payment_ids uuid[], bank_account_id}`: для каждой проведённой официальной — мягко удалить её операцию (guard отменит выплату) и провести такую же на новом счёте; переставить `payroll_official_months.payment_id`.
  - `public.payroll_official_run(p_now timestamptz default now()) returns jsonb` — только `service_role`. Для каждого заведения с `official_from`: `today = private.finance_account_today(account)`; если `day(today) < official_pay_day` — пропуск; `M = месяц перед today`; если `M < official_from` — пропуск. Для каждого периода, активного в M, без строки `payroll_official_months`: `final` → `review/final_month`; нет `official_bank_account_id` → `review/no_bank_account`; нет категории → `review/no_category`; иначе провести датой `official_pay_day` месяца M+1, 12:00 по поясу аккаунта, `u = null` → `posted`. Возвращает `[{account_id, venue_id, month, posted, review, amount}]`.

- [ ] **Step 1: SQL-тест**: полный месяц → одна выплата, `payroll_allocations.amount = 69600`, `settled_amount = 80000`, операция 69 600 на расчётном счёте, нет строки в `payroll_adesk_sync`; повторный `run` — ничего; `run` с `p_now` 9-го числа после пропуска 5-го — одна выплата датой 5-го; удалить выплату (`payroll_cancel_payment`) → `run` ничего не создаёт (`run after cancel posts nothing`); `first` за ноябрь → 74 666,67 / 64 959,67; `final` → `review`, выплаты нет; неактивный `payroll_employees` без `ends_on` → `review/inactive`; без счёта в настройках → `review/no_bank_account`; `payroll_record_official_payment` по карточке `review` → `resolved`; на некассовый тип счёта → исключение; обычная выплата с `settled_amount ≠ amount` → по-прежнему «Округление доступно только для чаевых»; `change_account` → старая операция `deleted_at`, новая на новом счёте, `payment_id` переставлен; `run` от `authenticated` → нет прав (`has_function_privilege`).
- [ ] **Step 2: Прогнать** — FAIL.
- [ ] **Step 3: Написать миграцию 384.**
- [ ] **Step 4: Прогнать** этот тест и `supabase/tests/payroll-individual-payments.sql`, `payroll-batch-bonuses.sql` — PASS.
- [ ] **Step 5: `pnpm regen:types`, Commit** `feat(payroll): автоматическая официальная выплата`.

### Task 3: Увольнение ставит дату официального увольнения (миграция 385)

**Files:**
- Create: `supabase/migrations/385_staff_termination_official_end.sql`
- Modify: `supabase/tests/payroll-official-employment.sql` (добавить кейс)
- Modify: `docs/handbook/people/index.md` (или страница увольнения в `docs/handbook/people/`)

**Interfaces:** `public.staff_begin_termination(p_uvr, p_reason)` — после `update payroll_employees set active=false` ставит `ends_on = <дата увольнения по поясу аккаунта>` открытым периодам этих `payroll_employees`, если `ends_on is null`; строка журнала `payroll.official_employment.ended` с `details.source = 'termination'`.

- [ ] **Step 1: Тест**: уволить сотрудника с открытым периодом → `ends_on` = сегодня; с уже заданным `ends_on` — не меняется; повторный вызов (retry) — ничего.
- [ ] **Step 2–4:** FAIL → миграция → PASS.
- [ ] **Step 5:** handbook: при увольнении официальная дата ставится сама, поправить — «Исправить данные». **Commit.**

### Task 4: Налог и ожидаемая часть в расчёте (TS)

**Files:**
- Create: `src/lib/payroll/official.ts`, `src/lib/payroll/official.test.mts`
- Modify: `src/lib/payroll/calculate.ts:194-290` (`statementRows`), `src/lib/payroll/types.ts` (`PayrollData`), `src/lib/payroll/pay-sheet.ts`, `src/lib/payroll/payslip.ts`, `src/lib/payroll/payslip-pdf.tsx`, `src/lib/payroll/statement-export.ts`, тесты `pay-sheet.test.mts`, `payslip.test.mts`, `statement-export.test.mts`
- Modify (вызовы `statementRows`): `payroll-workspace.tsx`, `payroll-ledger.tsx`, `employee-pay.tsx`, `staff-pay-sheet.tsx`, `payroll-transfer-drawer.tsx`

**Interfaces:**
- Produces:
  - `officialTax(gross: number): number`, `officialNet(gross: number): number`, `officialGrossFromNet(net: number): number` (`round(net / 0.87, 2)`, затем подобрать так, чтобы `officialNet(g) === net`, если возможно).
  - `type OfficialExpected = { employee_id: string; employment_id: string; month: string; kind: "full" | "first" | "final"; gross: number | null; days_paid: number | null; days_in_month: number }`; `PayrollData.officialExpected?: OfficialExpected[]`.
  - `statementRows(..., transfers = [], startsOn = "2026-09-01", officialExpected: OfficialExpected[] = [])` — в строке новое поле `officialExpected: { amount: number | null; kind; days_paid; days_in_month } | null`; `remaining` уменьшается на `amount ?? 0`.
  - `PaySheetPayment` получает `official: boolean` (по `Payment.official_month`), `Payment.official_month?: string | null`.

- [ ] **Step 1: Тесты** `official.test.mts`: `officialTax(80000)=10400`, `officialNet(27500)=23925`, `officialNet(74666.67)=64959.67`, `officialGrossFromNet(69600)=80000`, `officialGrossFromNet(23925)=27500`. В `pay-sheet.test.mts` / отдельном тесте `statementRows`: заработано 100 000, ожидается 80 000 → `remaining = 20000`; заработано 20 000, ожидается 27 500 → `remaining = -7500`; `final` (gross null) → `remaining` не меняется, `officialExpected.amount === null`. `payslip.test.mts`: в выписке есть строка ожидаемой части и `remaining` с её учётом. `statement-export.test.mts`: столбец «Официальная часть (ожидается)».
- [ ] **Step 2: Прогнать** `node --test --experimental-strip-types src/lib/payroll/*.test.mts` — FAIL.
- [ ] **Step 3: Реализовать**; во всех пяти вызовах передать `data.officialExpected ?? []`. Ledger: столбец «Официальная часть» в `labels` (`payroll-ledger.tsx:16-27`), значение «−80 000» или «уточняется». Итоги месяца (`payroll-workspace.tsx:202-230`) — сами через `remaining`. StaffPaySheet/EmployeePay: строка «Официальная часть — −80 000, выплатит бухгалтерия до 7 <M+1>», для `first` — «за 28 из 30 дней», для `final` — «сумма уточняется». В списке выплат — метка «Официальная» и «налог N» (через `paymentSettlement`).
- [ ] **Step 4: Прогнать тесты** — PASS; `pnpm exec tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(payroll): ожидаемая официальная часть в ведомости и выписке`.

### Task 5: Загрузка данных зарплаты

**Files:** Modify `src/app/(dashboard)/people/payroll/actions.ts` (`loadPayrollData` 181, `tables` 205-224, `overviewTables` 227, `EMPLOYEE_TABLES` 159, `loadPayrollManagerData` 362-374).

**Interfaces:** `PayrollData.officialExpected` — из `rpc("payroll_official_expected", { p_from: <начало загружаемого диапазона>, p_to: <текущий месяц> })`, для одного сотрудника — фильтр по `employee_id`; `PayrollData.banks[]` получает `type`; `payroll_payments` уже читается — `official_month` придёт в `Payment`.

- [ ] **Step 1:** добавить чтение; без права просмотра зарплаты RPC возвращает пусто, а не ошибку.
- [ ] **Step 2:** проверить локально: сотрудник с периодом → в ведомости строка и уменьшенное «К выплате»; `tsc`. **Commit.**

### Task 6: Блок «Официальное трудоустройство» в карточке сотрудника

**Files:**
- Create: `src/app/(dashboard)/people/staff/official-actions.ts`, `src/app/(dashboard)/people/staff/[userId]/_components/official-employment-section.tsx`, `.../official-employment-drawer.tsx`, `.../official-salary-drawer.tsx`, `.../official-end-drawer.tsx`
- Create: `src/lib/people/staff-document-upload.ts` (вынести загрузку из `submitDocModal`, `staff-detail-page.tsx:641-673`, и использовать в обоих местах)
- Modify: `staff-detail-page.tsx` (вставить секцию после «Трудоустройство», 1234-1340 — вне формы `saveMain`), `src/lib/audit/format.tsx`, `docs/handbook/people/index.md`

**Interfaces:**
- `getOfficialEmployment(userId: string): Promise<{ employeeId: string | null; employment: { id; starts_on; ends_on; position; contract_number; contract_date; contract_path } | null; salaries: { valid_from: string; gross: number }[]; canEdit: boolean }>` — `payroll_employees` активного заведения по `local_user_id`.
- `employOfficially(input)`, `updateOfficialEmployment(input)`, `changeOfficialSalary(input)`, `endOfficialEmployment(input)`, `cancelOfficialEmployment(employmentId)` — zod-схемы по полям `payroll_official_command`, вызывают его; `revalidatePath` карточки и `/people/staff`.
- `uploadStaffDocument({ venueId, userId, accountId, name, file, expectedPaths }): Promise<string>` — путь в `staff-documents` по шаблону `${venueId}/${userId}/passport/${ts}__${encodeStaffDocumentName(name)}__${uuid}.${ext}` + `changeStaffDocument({..., addPath})`. Имя файла договора: «Трудовой договор № N от ДД.ММ.ГГГГ» (без номера — «Трудовой договор»); допсоглашения — «Допсоглашение от ДД.ММ.ГГГГ».

- [ ] **Step 1:** секция по макету из спеки §1 (пусто / оформлен / меню ⋯); панели — `PayrollDetailDialog`; «На руки X · НДФЛ Y» живьём через `officialNet`/`officialTax`. Без `payroll_employees` — «Сначала добавьте сотрудника в зарплату». Секция видна только с правом просмотра зарплаты, действия — с `payroll.configure`.
- [ ] **Step 2:** фразы журнала для `payroll.official_employment.*`, `payroll.official_salary.created`.
- [ ] **Step 3:** проверить в браузере локально: оформить с файлом → файл в «Документах», блок показывает данные; изменить оклад; уволить; `tsc`, `lint`.
- [ ] **Step 4:** handbook. **Commit.**

### Task 7: Метка «Офиц.» и фильтр в списке сотрудников

**Files:** Modify `src/app/(dashboard)/people/staff/actions.ts` (новый `getOfficialStaffUserIds(venueId): Promise<string[]>` — открытые на сегодня периоды, под RLS), `staff/page.tsx`, `staff-client.tsx` (`renderCell` «name», 340-455 — `StatusBadge` «Офиц.»), `staff-table.tsx` (фильтр `kind`: «Официально трудоустроены», 281/304-340/531-606), `docs/handbook/people/index.md`.

- [ ] **Step 1:** реализовать; без права просмотра зарплаты — пустой список, метки нет.
- [ ] **Step 2:** проверить в браузере, `tsc`, `lint`, handbook. **Commit.**

### Task 8: Настройки заведения «Официальная зарплата»

**Files:** Modify `src/app/(dashboard)/people/payroll/_components/payroll-settings.tsx` (новая секция в `PayrollSettingsSections` 67-130, по образцу `TipSettings` 132-284), `src/app/(dashboard)/people/payroll/actions.ts` (`payrollCommand("settings")` — серверная часть готова в задаче 2), `docs/handbook/people/payroll.md`.

- [ ] **Step 1:** поля: «Учитывать с месяца», «День проведения» (1–28), «Расчётный счёт по умолчанию» (только `type='checking'`, активные, RUB). Сохранение требует `payroll.pay` + `finance.create_transaction` (как прочие финансовые поля).
- [ ] **Step 2:** проверить, `tsc`, handbook. **Commit.**

### Task 9: Выплаты — ручное проведение и смена счёта

**Files:** Modify `payroll-payment-form.tsx`, `payroll-payments-table.tsx`, `people/payroll/actions.ts`, `docs/handbook/people/payroll.md`.

**Interfaces:** `recordOfficialPayment(input: { employment_id; month; gross; net; bank_account_id; date })` → `payroll_record_official_payment`; `changeOfficialPaymentsAccount({ paymentIds: string[]; bankAccountId: string })` → `payroll_official_change_account`.

- [ ] **Step 1:** форма: переключатель «Официальная часть» при одном получателе с периодом на выбранный месяц; поля «На руки» и «Оклад с налогом» (подставляется `officialGrossFromNet`, можно поправить); список счетов — только расчётные. Таблица выплат: метка «Официальная», выбор строк (`selection` у `PayrollTable`, `payroll-table.tsx:35-45`) только для официальных, действие «Сменить счёт».
- [ ] **Step 2:** проверить, `tsc`, handbook. **Commit.**

### Task 10: «На разбор» — карточки официальной части

**Files:** Modify `src/lib/finance/recurring.ts` (`listInbox` 512, `countInbox` 533 — добавить строки `payroll_official_months` со `status='review'`, видимые пользователю с `payroll.pay` в их заведении), `finance/inbox/_components/inbox-page.tsx`; Create `finance/inbox/_components/official-month-card.tsx`; Modify `docs/handbook/finance/` (страница «На разбор»).

**Interfaces:** `resolveOfficialMonth({ id, gross, net, bank_account_id, date })` → `payroll_record_official_payment`; `skipOfficialMonth(id)` → `payroll_official_skip`; после — `notifyInboxChanged()`.

- [ ] **Step 1:** карточка по причине: `final_month` — «Окончательный расчёт: <имя>, <месяц> — укажите сумму»; `no_bank_account` — «Выберите расчётный счёт для официальных выплат»; `no_category` — «Нет статьи расхода для официальной выплаты: <имя>»; `inactive` — «Проверьте официальное увольнение: <имя>». Поля: на руки, оклад с налогом (`officialGrossFromNet`), расчётный счёт, дата; «Провести», «Пропустить».
- [ ] **Step 2:** проверить, счётчик в меню меняется, `tsc`, handbook. **Commit.**

### Task 11: Крон

**Files:** Create `src/app/api/cron/payroll-official/route.ts` (по образцу `src/app/api/cron/finance-recurring/route.ts`: POST, `x-cron-secret` через `timingSafeEqual`, `createAdminClient().rpc("payroll_official_run")`, затем `writeAuditEvents` — `payroll.official_run.created` на каждое заведение с `posted + review > 0`, `userId: null`, `details: {month, posted, review, amount}`), `scripts/crm-payroll-official.sh` (копия `crm-finance-recurring.sh`, cron `10 0 * * *`), фраза журнала.

- [ ] **Step 1:** реализовать; локально вызвать маршрут с секретом на базе из теста задачи 2 → выплаты появились, повторный вызов — ничего. **Commit.**

### Task 12: «Тип счёта»

**Files:** `finance/accounts/_components/bank-account-form.tsx:124,135`, `accounts-list.tsx:65,651,654` («Все виды» → «Все типы»), комментарий `src/lib/finance/bank-account-labels.ts:4`, handbook финансов.

- [ ] **Step 1:** заменить «Вид счёта»/«Вид» → «Тип счёта»/«Тип»; `grep -rn "Вид счёта\|видов счёта\|Все виды" src` пусто. **Commit.**

### Task 13: Справка, BACKLOG, итоговая проверка

- [ ] **Step 1:** `docs/handbook/people/payroll.md` — убрать «официальная бухгалтерская зарплата не включены» из ограничений, раздел «Официальная часть зарплаты». `BACKLOG.md` — «сопоставлять официальную выплату с операцией банка при прямой интеграции (вместе с этапом 3 повторяющихся платежей)».
- [ ] **Step 2:** `pnpm exec tsc --noEmit`, `pnpm lint`, `node --test --experimental-strip-types "src/**/*.test.mts"`, все SQL-тесты задач 1–3 — зелёные. **Commit.**

## Выкатка (после мержа, по команде Павла)

1. Миграции 383–385 по SSH от `supabase_admin` + строки в `supabase_migrations.schema_migrations`; деплой.
2. Настройки CHILLING: `official_from = 2026-10-01`, день 5, счёт по умолчанию — «СБЕР Бизнес».
3. Оформить: Копылова, Геворкян — 06.08.2026, «Кассир-официант», 27 500; Стоцкая — 03.11.2026, «Кассир-официант», 27 500; Павлов — 03.11.2026, «Старший бармен», 80 000.
4. Октябрь: `payroll_record_official_payment` Копыловой и Геворкяну — месяц 2026-10, 27 500 / 23 925, «СБЕР Бизнес», дата 06.11.2026 (до первого запуска крона — иначе он проведёт октябрь датой 05.11).
5. Пометить историю: `update payroll_payments set official_month` — Копылова 04.10 (`2026-09-01`), Мерова 24.10 (`2026-09-01`).
6. Проверить ведомость за октябрь и ноябрь у четверых.
7. Только теперь — `scripts/crm-payroll-official.sh` → `/usr/local/bin`, `/etc/cron.d/crm-payroll-official`.
