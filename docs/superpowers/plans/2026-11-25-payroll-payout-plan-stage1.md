# План выплат, этап 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Павел формирует и утверждает план первой выплаты за месяц, а кнопкой «Выдать сегодня» проводит выплаты дня с «Кэшбокса» в пределах наличных касс и отправляет сообщение в чат менеджеров; строки «переводом» (Татьяна) закрываются кнопкой «Выплачено».

**Architecture:** Расчёт — чистые функции в `src/lib/payroll/payout-*.ts` поверх `statementRows` (ведомость уже считает остаток, выплаты, переносы). Хранение и проведение — миграция 391: таблицы плана, строк и выдач + SECURITY DEFINER RPC, которые проводят выплаты через существующий `private.payroll_post_payment_scoped` и не дают выдать больше `private.payroll_month_balance`. Наличные читаются из Quick Resto в момент нажатия (`financeSource().source.cashControlList()` + `normalizeCashControl`), сообщение — `loadTelegramBot().sendMessage`.

**Tech Stack:** Next.js 15 server actions, Supabase Postgres (plpgsql), React 19, shadcn/ui, node:test.

**Spec:** `docs/superpowers/specs/2026-11-25-payroll-payout-plan-design.md` (этап 1 из раздела «Этапы»; разделы 1, 3, 4 и «Переводом»).

## Global Constraints

- Окно первой выплаты за M (графики «Основной» и «Переводом»): 25-е M … 1-е M+1. Вторая выплата, сверка, автоперенос, крон — **не в этом этапе**.
- Графики: `main` — наличными, шаг 5 000, запас 5 000; `transfer` — переводом, первая выплата = половина месяца (50/50), шаг 500, запас 0, счёт по умолчанию «СБЕР Бизнес», выплата в Adesk **не** отправляется (платёж по счёту Татьяны уже приходит туда из банка); `cleaner` — наличными, шаг 5 000, запас 0 (в этом этапе только исключает сотрудника из чужих планов; свой план — этап 2).
- Минимум в кэшбоксе после выдачи по умолчанию — 120 000. Счёт выдачи наличными — «Кэшбокс».
- Формула первой выплаты: `цель = floor_step((C + E + F − R) / 2 − P)`, `потолок = floor_step(C + E − P − R)`, `к выдаче = max(0, min(цель, потолок))`.
- Прогноз F: оставшиеся опубликованные смены M × средний заработок за последние 10 смен; меньше 3 смен — F = 0 с пометкой «мало данных для прогноза».
- Сообщение менеджерам:
  ```
  Выдайте плиз и проведите:
  Гамлет — 65К
  Филипп — 45К
  Итого 110К — одним изъятием, в комментарии «ЗП»
  ```
- Права: смотреть план — `payroll.view`; формировать, править, утверждать — `payroll.pay`; выдавать и «Выплачено» — `payroll.pay` + `finance.create_transaction`; настройки — `payroll.configure`.
- Действия из браузера — через `actionResult(fn, "<русский fallback>")`, клиент — `unwrapAction`; `raise exception` — по-русски.
- Функции в миграции: `set search_path = public, pg_catalog`; `revoke … from public, anon` и явный `grant … to authenticated`; проверка через `has_function_privilege` в конце миграции; RLS с `(select …)`; композитные FK с композитными индексами; без `CONCURRENTLY`.
- Номер миграции — следующий после `git ls-tree --name-only origin/main supabase/migrations/ | tail -1` (сейчас 391); перепроверить перед мержем.
- Чистые модули (`payout-plan.ts`, `payout-issue.ts`) импортируют только относительные `./x.ts` и типы — их гоняет `node --test --experimental-strip-types`.
- UI — по `docs/design-system.md` и `docs/mobile-web.md`; на телефоне строки плана — карточками.
- Журнал: `writeAuditEvent` с кодами `payroll.payout_plan.created|approved|cancelled|row_changed|issued`, `payroll.payout_settings.updated`; фразы — в `src/lib/audit/payroll-payout.tsx`, подключить в `format.tsx`.
- Handbook: `docs/handbook/people/payroll.md` — раздел «План выплат».

## Review Focus

- Сотруднику вручную выплатили между утверждением и выдачей: выдача уменьшается до остатка, переплаты нет (проверка в TS при предпросмотре **и** в RPC по `payroll_month_balance`). Тест — Task 1 (`ceiling after manual payment`) и Task 3 (SQL-проверка `overpay rejected`).
- «Выплачено» у Татьяны не создаёт вторую операцию в Adesk (её счёт уже там из банка). Тест — Task 3 (`transfer not queued to Adesk`).
- Двойное нажатие «Провести и отправить» или повтор после обрыва: одна выплата на строку и одно сообщение. Тест — Task 3 (`same request_key returns same issue`) и Task 4 (сообщение не уходит повторно, если `message_sent_at` заполнен).
- Quick Resto не ответил или в кассах меньше минимума: ничего не проводится, текст «Нет данных о наличных в кассах» или «В кассах меньше минимума». Тест — Task 2 (`registerCash` без отчётов → `null`; `distributeCash` при `available ≤ 0` → пусто).
- Частично выданная строка: в следующий раз выдаётся только остаток, день переносится на следующую смену в окне. Тест — Task 2 (`partial keeps remainder`) и Task 3 (`issued + amount ≤ row amount`).
- Два сотрудника с одним именем в сообщении: к имени добавляется первая буква фамилии. Тест — Task 2 (`shortNames disambiguates`).

---

### Task 1: Расчёт первой выплаты (чистые функции)

**Files:**
- Create: `src/lib/payroll/payout-plan.ts`
- Test: `src/lib/payroll/payout-plan.test.mts`

**Interfaces:**
- Consumes: `statementRows` из `./calculate.ts`; типы из `./types.ts`; `Shift` из `../schedule/types.ts`.
- Produces:
  ```ts
  export type PayoutScheduleCode = "main" | "cleaner" | "transfer";
  export type PayoutSchedule = { method: "cash" | "transfer"; first: [number, number]; second: [number, number];
    step: number; reserve: number; bank_account_id?: string | null };
  export const DEFAULT_PAYOUT_SCHEDULES: Record<PayoutScheduleCode, PayoutSchedule>;
  export function floorStep(value: number, step: number): number;
  export function firstPayoutWindow(today: string): { month: string; from: string; to: string } | null; // month = "YYYY-MM-01"
  export type PayoutBreakdown = { carried: number; earned: number; pendingFines: number; forecast: number;
    forecastShifts: number; averageShift: number | null; reserve: number; paid: number; half: number;
    target: number; ceiling: number; flags: ("few_shifts" | "no_shift" | "unmoved_balance")[] };
  export type PlannedRow = { employee_id: string; pay_date: string | null; amount: number; breakdown: PayoutBreakdown };
  export function planFirstPayout(input: {
    data: Pick<PayrollData, "employees"|"accruals"|"adjustments"|"payments"|"allocations"|"transfers"|"officialExpected"|"settings">;
    schedules: Record<PayoutScheduleCode, PayoutSchedule>;
    schedule: PayoutScheduleCode; month: string; today: string;
    window: { from: string; to: string };
    shifts: { employee_id: string; business_date: string }[]; // опубликованные смены M, уже привязанные к сотруднику
  }): PlannedRow[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("floorStep rounds down, never up", () => {
  assert.equal(floorStep(46292, 5000), 45000);
  assert.equal(floorStep(23850, 500), 23500);
  assert.equal(floorStep(-1, 5000), -5000);
});
test("firstPayoutWindow: 25.11–01.12 belongs to November", () => {
  assert.deepEqual(firstPayoutWindow("2026-11-25"), { month: "2026-11-01", from: "2026-11-25", to: "2026-12-01" });
  assert.deepEqual(firstPayoutWindow("2026-12-01"), { month: "2026-11-01", from: "2026-11-25", to: "2026-12-01" });
  assert.equal(firstPayoutWindow("2026-11-24"), null);
});
test("Филипп: 83 258 earned, 2 shifts ahead at avg 7 163 → 45 000", () => {
  // 10 прошлых смен по 7 163, заработано в M 83 258, впереди 2 смены, запас 5 000 → (83 258 + 14 326 − 5 000)/2 = 46 292
  const [row] = planFirstPayout(fixture({ earnedInMonth: 83258, avgShift: 7163, shiftsAhead: 2 }));
  assert.equal(row.amount, 45000);
  assert.equal(row.breakdown.forecast, 14326);
});
test("Татьяна (transfer, оклад 47 700, без смен) → 23 500, без даты", () => {
  const [row] = planFirstPayout(salaryFixture({ monthly: 47700, schedule: "transfer" }));
  assert.equal(row.amount, 23500);
  assert.equal(row.pay_date, null);
  assert.deepEqual(row.breakdown.flags, []);
});
test("fewer than 3 shifts → no forecast, flag few_shifts", () => { /* 2 shift accruals → forecast 0, flags includes "few_shifts" */ });
test("ceiling after manual payment: paid 40 000 of 50 000 earned → 5 000", () => {
  // C=0, E=50 000, F=50 000, R=5 000, P=40 000: цель = floor((95 000)/2 − 40 000)=5 000; потолок = floor(5 000) = 5 000
});
test("pending fine is subtracted from earned", () => { /* unapproved adjustment −3 000 in M → breakdown.pendingFines 3000, earned reduced */ });
test("only employees of the schedule, active, not casual", () => {
  // cleaner-сотрудник и разовый не попадают в план main
});
test("no shift in window → pay_date null and flag no_shift (cash schedule)", () => {});
test("pay_date = first shift in window not before today", () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types src/lib/payroll/payout-plan.test.mts`
Expected: FAIL — module `./payout-plan.ts` not found.

- [ ] **Step 3: Implement `payout-plan.ts`**

Values from `statementRows(employees, accruals, adjustments, payments, allocations, month, transfers, settings.starts_on, officialExpected)`:
- `C = row.opening − row.transferredOut`, `P = row.paid`.
- `pendingFines` = Σ |amount| of adjustments of the employee in M with `approved === false`, `!deleted_at`, `amount < 0`, `medium` not `"bonus"`. Check while implementing that approved adjustments are already inside accruals (statementRows `earned`) and unapproved are not; if both are inside, drop the subtraction and the test.
- `E = row.earned − pendingFines`.
- Shift accrual: `calculation_snapshot.kind` not in `monthly`, `adjustment` (same filter as `statementRows.shifts`); its earning = `salary − Σ components kind "monthly"`. Average over the last 10 such accruals before `today` (any month); fewer than 3 → `averageShift: null`, `F = 0`, flag `few_shifts`.
- Shifts ahead = `shifts` of the employee with `business_date ≥ today` in M and no accrual on that date.
- Target for `main`: `C + (E + F × shiftsAhead) / 2 − P`. Target for `transfer` (50/50, Павел 25.11): `C + E / 2 − P`, no forecast. Ceiling for both: `C + E − P − reserve`. Amount = `floorStep(max(0, min(target, ceiling)), step)`.
- `pay_date` (method `cash`): first `shifts` date in `[max(today, window.from), window.to]`; none → `null` + `no_shift`. Method `transfer`: always `null`, no flag.
- `unmoved_balance` flag: `statementRows` for the previous month gives `remaining ≠ 0` and nothing transferred out of it.
- Employees: `active && !casual && (payout_schedule ?? "main") === schedule`. Add `payout_schedule?: PayoutScheduleCode` to `PayEmployee` in `types.ts`.
- Round all money to kopecks with `round` from `./calculate.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types src/lib/payroll/payout-plan.test.mts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll/payout-plan.ts src/lib/payroll/payout-plan.test.mts src/lib/payroll/types.ts
git commit -m "Зарплата: расчёт первой выплаты для плана выплат"
```

### Task 2: Наличные, распределение, сообщение (чистые функции)

**Files:**
- Create: `src/lib/payroll/payout-issue.ts`
- Test: `src/lib/payroll/payout-issue.test.mts`

**Interfaces:**
- Consumes: `CashControlReport` (type-only) из `../sales/cash-control.ts`; `floorStep` из `./payout-plan.ts`.
- Produces:
  ```ts
  export type RegisterCash = { terminalId: string; terminal: string; amount: number; source: "open" | "close"; at: string };
  export function registerCash(today: CashControlReport[], yesterday: CashControlReport[]): RegisterCash[] | null;
  export function cashAvailable(registers: RegisterCash[], minimum: number, issuedToday: number): number;
  export type DueRow = { row_id: string; employee_id: string; name: string; due: number; next_pay_date: string | null };
  export type IssueLine = { row_id: string; employee_id: string; name: string; amount: number; next_pay_date: string | null };
  export function distributeCash(rows: DueRow[], available: number, step: number): { lines: IssueLine[]; short: DueRow[] };
  export function shortNames(names: { id: string; name: string }[]): Map<string, string>;
  export function payoutMessage(lines: { name: string; amount: number }[]): string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("registerCash: open shift today wins, else last closed; kopecks → rubles", () => {
  // касса A: OPENED сегодня openExpected 15000000 → 150 000 (open); касса B: сегодня нет, вчера CLOSED closeExpected 4000000 → 40 000 (close)
});
test("registerCash: no reports today or yesterday → null", () => assert.equal(registerCash([], []), null));
test("cashAvailable: 310 000 − 120 000 − 0 = 190 000; never below 0", () => {});
test("distributeCash: smallest first, full while fits, next partial by step, rest nothing", () => {
  // due 65 000, 45 000, 30 000; available 100 000 → 30 000, 45 000 full; 65 000 → 25 000 partial; short = [65 000 row]
});
test("partial keeps remainder: line amount < due and next_pay_date carried", () => {});
test("distributeCash with available ≤ 0 → no lines", () => {});
test("shortNames disambiguates: two «Никита» → «Никита В.», «Никита С.»", () => {});
test("payoutMessage", () => {
  assert.equal(payoutMessage([{ name: "Гамлет", amount: 65000 }, { name: "Хасият", amount: 7500 }]),
    "Выдайте плиз и проведите:\nГамлет — 65К\nХасият — 7 500\nИтого 72 500 — одним изъятием, в комментарии «ЗП»");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types src/lib/payroll/payout-issue.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `payout-issue.ts`**

Amount format: multiple of 1 000 → `${n / 1000}К`, otherwise `n` with an ordinary space as thousands separator (`"7 500"`, same for «Итого»). `registerCash` groups by `terminalId` (empty id → by `terminal` title); per register prefers an `OPENED` report of today (`openExpected`), then the latest `CLOSED` of today, then the latest `CLOSED` of yesterday; a register whose chosen value is `null` is skipped; no register at all → `null`. `distributeCash` sorts by `due` ascending, ties by name.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types src/lib/payroll/payout-issue.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll/payout-issue.ts src/lib/payroll/payout-issue.test.mts
git commit -m "Зарплата: наличные касс, распределение и сообщение для выдачи"
```

### Task 3: Миграция 391 — таблицы и RPC плана выплат

**Files:**
- Create: `supabase/migrations/391_payroll_payout_plan.sql`
- Modify: `src/types/database.ts` (новые таблицы и колонка — точечно, без полной регенерации)

**Interfaces:**
- Consumes: `private.payroll_scope(text)`, `private.payroll_post_payment_scoped(jsonb, uuid, uuid, uuid)`, `private.payroll_month_balance(uuid, date)`, `public.has_permission(text)`; поиск статьи ФОТ по должности — как в `payroll_record_payments` (миграция 247).
- Produces (all `security definer`, `set search_path = public, pg_catalog`, `grant execute … to authenticated`):
  - `payroll_payout_save_settings(p_input jsonb) returns void` — scope `payroll.configure`; `{min_cash, chat_id, bank_account_id, schedules, assignments: [{employee_id, schedule}]}`.
  - `payroll_payout_plan_save(p_input jsonb) returns uuid` — scope `payroll.pay`; `{schedule, month, payout_no, window_from, window_to, rows: [{employee_id, pay_date, amount, breakdown}]}`; draft exists → rows replaced, `version + 1`; approved exists → `raise exception 'План уже утверждён'`.
  - `payroll_payout_row_update(p_row uuid, p_amount numeric, p_pay_date date) returns void` — scope `payroll.pay`.
  - `payroll_payout_plan_state(p_plan uuid, p_state text) returns void` — `approved` only from `draft`; `cancelled` from `draft|approved`.
  - `payroll_payout_issue(p_input jsonb) returns uuid` — scope `payroll.pay` + `finance.create_transaction`; `{request_key, plan_id, method, bank_account_id, date, business_date, cash, lines: [{row_id, amount, next_pay_date}]}`.

Tables:
- `payroll_payout_settings(account_id, venue_id, min_cash numeric(15,2) not null default 120000 check (min_cash >= 0), chat_id text check (chat_id ~ '^-?\d+$'), bank_account_id uuid, schedules jsonb not null default <DEFAULT_PAYOUT_SCHEDULES as JSON>, updated_by uuid references profiles(id), updated_at timestamptz not null default now(), primary key (account_id, venue_id), foreign key (account_id, venue_id) references payroll_settings(account_id, venue_id))`.
- `payroll_employees.payout_schedule text not null default 'main' check (payout_schedule in ('main','cleaner','transfer'))`.
- `payroll_payout_plans(id, account_id, venue_id, schedule, month date, payout_no smallint check in (1,2), window_from, window_to, state text default 'draft' check in ('draft','approved','cancelled'), version int not null default 1, created_by, created_at, approved_by, approved_at, cancelled_by, cancelled_at, unique (account_id, id))` + unique index `(venue_id, schedule, month, payout_no) where state <> 'cancelled'`.
- `payroll_payout_rows(id, account_id, venue_id, plan_id, employee_id, pay_date date, amount numeric(15,2) not null check (amount >= 0), issued numeric(15,2) not null default 0 check (issued >= 0 and issued <= amount), state text not null default 'planned' check in ('planned','partial','issued'), breakdown jsonb not null, updated_by, updated_at, unique (plan_id, employee_id), foreign key (account_id, plan_id) references payroll_payout_plans(account_id, id) on delete cascade, foreign key (account_id, venue_id, employee_id) references payroll_employees(account_id, venue_id, id))` + indexes `(account_id, plan_id)`, `(account_id, venue_id, employee_id)`.
- `payroll_payout_issues(id, account_id, venue_id, plan_id, business_date, method text check in ('cash','transfer'), request_key uuid not null, bank_account_id uuid not null, total numeric(15,2) not null, lines jsonb not null, cash jsonb, input_snapshot jsonb not null, message text, message_sent_at timestamptz, message_error text, created_by, created_at, unique (venue_id, request_key), foreign key (account_id, plan_id) references payroll_payout_plans(account_id, id))` + index `(account_id, plan_id)`, `(venue_id, business_date)`.
- RLS on all four: `select` to authenticated `using (venue_id = (select public.get_active_venue_id()) and (select public.has_permission('payroll.view')))`; no insert/update/delete grants to `authenticated`; `grant all … to service_role` (message status is written by the server with the admin client).

Rules inside RPCs (texts as given):
- amount checks use `private.payroll_month_balance(employee, plan.month)`: in `plan_save` and `row_update` `amount − issued > balance` → `'Больше, чем сотрудник уже заработал: %'` (имя); in `issue` `line.amount > balance` → same text.
- `row_update`: plan `cancelled` → `'План отменён'`; `p_amount < issued` → `'Уже выдано больше'`; `state = 'issued'` → `'Строка уже выдана'`.
- `issue`: advisory lock on venue; same `request_key` + same `input_snapshot` → return existing id, other snapshot → `'Ключ уже использован для другой выдачи'`; plan must be `approved` → `'Сначала утвердите план'`; `line.amount > amount − issued` → `'Больше, чем осталось выдать: %'`; method `cash` requires `bank_accounts.type = 'cash'`, `transfer` — `'checking'` → `'Выберите счёт выплаты'`; method `transfer`: right after posting, `delete from payroll_adesk_sync where payment_id = <new payment>` in the same transaction (the worker never sees the uncommitted row; trigger 384 only updates existing rows later), so the bank payment already in Adesk is not doubled — SQL test `transfer not queued to Adesk`; each line posts through `private.payroll_post_payment_scoped` with `request_key = md5(request_key || row_id)::uuid`, kind `salary`, allocation month = plan month, note `'План выплат: ' || employee.name`; then `issued += amount`, `state = case when issued = amount then 'issued' else 'partial' end`, `pay_date = coalesce(next_pay_date, pay_date)`; lines stored with `payment_id`.
- End of migration: `do $$ … has_function_privilege('anon', …, 'execute') → raise exception` for all five; `notify pgrst, 'reload schema'`.

- [ ] **Step 1: Write the migration** with everything above (single `begin; … commit;`).
- [ ] **Step 2: Apply locally**

Run: `pnpm db:reset`
Expected: finishes without errors.

- [ ] **Step 3: SQL checks against local DB** (psql as an authenticated test user with `payroll.pay` from `supabase/seed.sql`, inside a transaction rolled back at the end; save the script as `supabase/tests/payroll_payout_plan.sql`):
  - `overpay rejected`: row amount above `payroll_month_balance` → error text `Больше, чем сотрудник уже заработал`.
  - `same request_key returns same issue`: two calls of `payroll_payout_issue` with one input → one id, one `payroll_payments` row per line.
  - `issued + amount ≤ row amount`: second issue for more than the remainder → `Больше, чем осталось выдать`.
  - `anon cannot execute`: `has_function_privilege('anon', 'public.payroll_payout_issue(jsonb)', 'execute') = false`.

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/payroll_payout_plan.sql`
Expected: all checks print `ok`, no `ERROR`.

- [ ] **Step 4: Add the new tables and column to `src/types/database.ts`** by hand (as CLAUDE.md allows), then `pnpm exec tsc --noEmit` → no new errors.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/391_payroll_payout_plan.sql supabase/tests/payroll_payout_plan.sql src/types/database.ts
git commit -m "Миграция 391: план выплат — таблицы, проведение и защита от переплаты"
```

### Task 4: Серверные действия плана и выдачи

**Files:**
- Create: `src/app/(dashboard)/people/payroll/payout-actions.ts` (`"use server"`)
- Create: `src/lib/payroll/payout-cash.ts` (`import "server-only"`)
- Modify: `src/app/(dashboard)/people/payroll/actions.ts` — экспортировать `scope` и `loadPayrollData` во внутренний модуль `src/app/(dashboard)/people/payroll/payroll-data.ts` (перенос без изменения поведения), чтобы ими пользовались оба файла действий.

**Interfaces:**
- Consumes: Task 1, Task 2, RPC из Task 3; `financeSource` (`src/lib/sales/finance-source.ts`), `normalizeCashControl`, `businessDate`/`addDays` (`src/lib/sales/time.ts`), `loadTelegramBot` (`src/lib/integrations/telegram-bot.ts`), `writeAuditEvent`.
- Produces (each exported as `actionResult(() => …Impl(...), "<fallback>")`):
  ```ts
  export type PayoutPlanView = { schedule: PayoutScheduleCode; window: { month: string; from: string; to: string } | null;
    plan: { id: string; state: "draft"|"approved"|"cancelled"; version: number } | null;
    rows: (PlannedRow & { id: string | null; name: string; issued: number; state: "planned"|"partial"|"issued" })[];
    settings: { min_cash: number; chat_id: string | null; bank_account_id: string | null; schedules: Record<PayoutScheduleCode, PayoutSchedule> };
    canPay: boolean; canIssue: boolean };
  loadPayoutPlan(schedule: PayoutScheduleCode): Promise<ActionResult<PayoutPlanView>>   // нет плана → rows из planFirstPayout, id: null
  savePayoutPlan(schedule: PayoutScheduleCode): Promise<ActionResult<string>>           // «Сформировать» / «Пересчитать» черновик
  updatePayoutRow(rowId: string, amount: number, payDate: string | null): Promise<ActionResult<void>>
  setPayoutPlanState(planId: string, state: "approved" | "cancelled"): Promise<ActionResult<void>>
  export type IssuePreview = { requestKey: string; registers: RegisterCash[]; minimum: number; issuedToday: number;
    available: number; lines: IssueLine[]; short: DueRow[]; message: string; problem: string | null };
  previewPayoutToday(planId: string): Promise<ActionResult<IssuePreview>>
  issuePayoutToday(planId: string, requestKey: string, expected: IssueLine[]): Promise<ActionResult<{ issueId: string; messageSent: boolean; message: string }>>
  markTransferPaid(rowId: string, input: { amount: number; date: string; bankAccountId: string; requestKey: string }): Promise<ActionResult<void>>
  savePayoutSettings(input: unknown): Promise<ActionResult<void>>
  ```
  `src/lib/payroll/payout-cash.ts`: `readRegisterCash(accountId: string, venueId: string, today: string, timezone: string, dayStartHour: number): Promise<RegisterCash[] | null>` — читает `cashControlList()` за `today` и за `addDays(today, -1)`, отдаёт `registerCash(...)`; ошибка Quick Resto → `null`.

Behaviour to pin:
- `today` = `businessDate(new Date(), timezone, dayStartHour)`; смены M читаются из `schedule_shifts` (`published = true`, `fetchAllRows`), сотрудник смены — `payroll_employee_id ?? employee by local_user_id = user_id`, рабочий день смены — `businessDate(new Date(starts_at), timezone, dayStartHour)`.
- `previewPayoutToday`: план `approved`, метод графика `cash`; строки с `pay_date = today`, `due = min(amount − issued, свежий потолок из planFirstPayout)` (сумма только уменьшается, Review Focus 1); `next_pay_date` — следующая смена сотрудника в окне после `today` или `null`; `problem`: `readRegisterCash` вернул `null` → «Нет данных о наличных в кассах», `available ≤ 0` → «В кассах меньше минимума», нет чата → «Не указан чат менеджеров»; `requestKey` — новый `crypto.randomUUID()`.
- `issuePayoutToday`: заново строит предпросмотр; если строки (`row_id`, `amount`) не совпадают с `expected` → ошибка «Наличные или суммы изменились — проверьте ещё раз»; вызывает `payroll_payout_issue` (`method: "cash"`, `bank_account_id` = настройка «Кэшбокс», `cash` = регистры + минимум + доступно); затем, если у выдачи `message_sent_at` пуст, — `sendMessage(chat_id, message)` и запись `message_sent_at`/`message_error` админ-клиентом; ошибка Telegram не отменяет выплаты, возвращается `messageSent: false` и текст для копирования.
- `markTransferPaid`: одна строка `transfer`-графика, `payroll_payout_issue` с `method: "transfer"`, `cash: null`.
- После каждой записи — `writeAuditEvent` (коды из Global Constraints, `entityType: "payroll_payout_plan"`, `entityId: planId`, `details`: месяц, график, суммы).

- [ ] **Step 1: Move `scope`/`loadPayrollData` to `payroll-data.ts`**, re-import in `actions.ts`; run `pnpm exec tsc --noEmit` → PASS.
- [ ] **Step 2: Implement `payout-cash.ts` and `payout-actions.ts`.**
- [ ] **Step 3: Verify:** `pnpm exec tsc --noEmit && pnpm lint` → no errors.
- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/people/payroll" src/lib/payroll/payout-cash.ts
git commit -m "Зарплата: действия плана выплат и выдачи из кэшбокса"
```

### Task 5: Карточка «График выплат» в настройках

**Files:**
- Create: `src/app/(dashboard)/people/payroll/_components/payout-settings.tsx`
- Modify: `src/app/(dashboard)/people/payroll/_components/payroll-settings.tsx` — `<PayoutScheduleSettings data={data} onSaved={reload} />` после `<OfficialSalarySettings …/>`.

**Interfaces:**
- Consumes: `savePayoutSettings`, `loadPayoutPlan` (за `settings`) из Task 4; `useSaveSection`, `ProfileSection` как у `OfficialSalarySettings`.
- Produces: `export function PayoutScheduleSettings({ data, onSaved }: { data: PayrollData; onSaved: () => Promise<void> })`.

Поля: «Минимум в кэшбоксе после выдачи» (₽), «Счёт выдачи наличными» (счета `type = "cash"`), «Чат менеджеров» (числовой ID, как чат штрафов), по графикам «Основной» и «Переводом» — шаг и запас, у «Переводом» ещё расчётный счёт (`type = "checking"`); окна показываются текстом («25-е – 1-е», «10-е – 16-е»), не редактируются в этом этапе. Блок «Сотрудники на особых графиках»: для «Клинер» и «Переводом» — выбор сотрудников из активных (остальные — «Основной»). Описание карточки: «Как приложение планирует первую и вторую выплату и сколько наличных оставляет в кассе.» Сохраняет SaveBar, право `payroll.configure`.

Решение этапа 1 (отклонение от спеки, записать в спеку): выбор графика сотрудника — в этой карточке, а не в «Условиях оплаты» карточки сотрудника.

- [ ] **Step 1: Implement the component.**
- [ ] **Step 2: Verify in the browser** (dev-сервер в Bash в фоне, не `preview_start` — память `feedback_dev_server_no_preview_launcher`): открыть настройки оплаты труда заведения, сохранить минимум 120 000, чат `-1002495828187`, Татьяну на «Переводом»; после перезагрузки значения на месте.
- [ ] **Step 3: `pnpm exec tsc --noEmit && pnpm lint`** → PASS.
- [ ] **Step 4: Commit** — `git commit -m "Зарплата: настройка графика выплат"`.

### Task 6: Вкладка «План выплат», выдача и «Выплачено»

**Files:**
- Create: `src/app/(dashboard)/people/payroll/_components/payout-plan.tsx` (вкладка), `payout-issue-dialog.tsx` (выдача дня), `payout-transfer-dialog.tsx` («Выплачено»), `payout-plan.module.css` при необходимости.
- Modify: `src/app/(dashboard)/people/payroll/_components/payroll-workspace.tsx:546-550` — `<TabsTrigger value="plan">План выплат</TabsTrigger>` (видна при `payroll.view`), контент вкладки — `<PayoutPlan />`.

**Interfaces:**
- Consumes: все действия Task 4.
- Produces: `export function PayoutPlan({ permissions }: { permissions: string[] })`.

Экран (по макету из спеки, раздел 3): переключатель «Основной / Переводом»; шапка «Ноябрь, первая выплата · 25.11 – 01.12» + статус («Черновик», «Утверждён», «Отменён»); у наличного графика строка «Наличные — по кнопке «Выдать сегодня»». Таблица: Сотрудник, Смена, Заработано, Прогноз, Запас, ½, К выдаче, Выдано, ✎. Раскрытие строки — C, E, штрафы на подтверждении, F (смен × средний), R, P, половина, округление, пометки («мало данных для прогноза», «нет смены в окне — решите сами», «В октябре остаток N — не перенесён»). Итоги по дням. Кнопки: «Сформировать план» (нет плана), «Пересчитать» (черновик), «Утвердить» (черновик), «Отменить план» (подтверждение `ConfirmDialog`), «Выдать сегодня» (утверждён, наличный график, есть строки на сегодня). Правка ✎ — сумма и день (смены сотрудника в окне); ошибка из базы — тостом как есть.

Диалог «Выдать сегодня»: кассы с суммами и источником («открытие смены 14:02» / «закрытие вчера»), минимум, уже выдано сегодня, можно выдать; список выдачи (частичные — «30 000 из 45 000, остаток — 27.11»; не хватило — отдельным списком); предпросмотр сообщения; `problem` — вместо кнопки. Кнопка «Провести и отправить» блокируется на время запроса; ответ `messageSent: false` → блок «Сообщение не отправлено» с текстом и кнопкой «Скопировать».

Строки «Переводом»: вместо дня — «ждёт оплаты счёта»; кнопка «Выплачено» → диалог: сумма (по умолчанию к выдаче), дата (сегодня), счёт (настройка графика, только расчётные). На телефоне — карточки строк, кнопки внизу.

- [ ] **Step 1: Implement components and the tab.**
- [ ] **Step 2: Browser check on local data** (seed): сформировать план, поправить сумму выше потолка → «Больше, чем сотрудник уже заработал»; утвердить; «Выдать сегодня» без связи с Quick Resto → «Нет данных о наличных в кассах», ничего не проведено; «Выплачено» у строки «Переводом» → выплата появилась на вкладке «Выплаты»; ширина 375 px — без горизонтального скролла.
- [ ] **Step 3: `pnpm exec tsc --noEmit && pnpm lint`** → PASS.
- [ ] **Step 4: Commit** — `git commit -m "Зарплата: вкладка «План выплат», выдача дня и «Выплачено»"`.

### Task 7: Журнал и справка

**Files:**
- Create: `src/lib/audit/payroll-payout.tsx`
- Modify: `src/lib/audit/format.tsx` (подключить `payrollPayoutAuditSpecs` рядом с `payrollOfficialAuditSpecs`), `docs/handbook/people/payroll.md`, `docs/superpowers/specs/2026-11-25-payroll-payout-plan-design.md` (решение про выбор графика в карточке настроек).

Фразы: `created` — «сформировал(а) план выплат», `approved` — «утвердил(а) план выплат», `cancelled` — «отменил(а) план выплат», `row_changed` — «изменил(а) сумму в плане выплат» + сотрудник, было → стало, `issued` — «выдал(а) зарплату по плану» + итог, список, «сообщение менеджерам отправлено / не отправлено», `payout_settings.updated` — «изменил(а) график выплат». Подробности — месяц, график, суммы через `money()`.

Handbook, раздел «План выплат»: что считает приложение (своими словами, формула словами), как утвердить, что делает «Выдать сегодня» (наличные касс, минимум, по очереди от меньших сумм, сообщение менеджерам, одно изъятие с «ЗП»), строки «Переводом» и «Выплачено», чего пока нет (вторая выплата, автоматическая отправка, сверка — следующие этапы). Без имён таблиц и функций.

- [ ] **Step 1: Write audit specs and handbook.**
- [ ] **Step 2: `pnpm exec tsc --noEmit && pnpm lint && node --test --experimental-strip-types "src/**/*.test.mts"`** → PASS.
- [ ] **Step 3: Commit** — `git commit -m "Зарплата: журнал и справка плана выплат"`.

### Task 8: Проверка, PR, выкатка

- [ ] **Step 1:** перепроверить номер миграции против `origin/main` (память `migration_numbering_rebase`), при сдвиге — переименовать.
- [ ] **Step 2:** финальное ревью ветки (свежий ревьюер), исправить найденное.
- [ ] **Step 3:** push, PR с `--base main`, дождаться зелёного CI, остановиться (мерж — только по «мержи»).
- [ ] **Step 4:** после мержа — миграция на прод через SSH по `prod_migration_drift_122` (вставить строку в ledger), Павел нажимает Redeploy; проверить на проде план на текущее окно в режиме «только смотреть» и сверить суммы с таблицей из спеки, прежде чем Павел нажмёт «Выдать сегодня».
