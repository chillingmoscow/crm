# KPI старших и план продаж алкоголя — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пункты KPI в условиях должности, чек-лист итогов месяца, который сам пишет премию в зарплату, и план продаж алкоголя с предложением приложения.

**Architecture:** Чистые функции (`src/lib/payroll/kpi.ts`, `src/lib/sales/alcohol-plan.ts`) считают пункты, итог и предложение плана. Миграция 410 добавляет две таблицы и колонки плана алкоголя. Запись идёт только через SECURITY DEFINER-функции: они проверяют права, период и перенос, пишут премию `allowance` с `origin='kpi'` и журнал. Интерфейс: блок «KPI» в условиях должности, вкладка «KPI» на странице зарплаты, карточки в «На разбор» из утренней проверки этапа 3.

**Tech Stack:** Next.js 15 server actions, Supabase/Postgres (plpgsql), `node:test`, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-27-payroll-kpi-design.md`

## Global Constraints

- Ответы и тексты интерфейса — по-русски; тексты `raise exception` — по-русски.
- Server actions — через `actionResult(fn, "<русский fallback>")`, клиент — `unwrapAction`; `redirect()` внутри не вызывать.
- Миграция — `410_payroll_kpi.sql`. Номер перепроверить по `origin/main` прямо перед мержем.
- В каждой `create or replace function` в `public`/`private` — `set search_path`. В политиках — `(select auth.uid())` и `(select public.has_permission(...))`.
- Для SECURITY DEFINER-функций: `revoke all … from public, anon`, `grant execute … to authenticated` (только серверные функции — ещё и `revoke … from authenticated`). Проверка через `has_function_privilege` → `raise exception`.
- Таблицы: `account_id` + `unique (account_id, id)` + композитные FK; FK-индексы без `CONCURRENTLY`.
- Права на итоги KPI и план алкоголя: `payroll.review` **или** `payroll.pay`. План ещё может задать `sales.configure_shifts`. Условия KPI — `payroll.configure`. Чтение — `payroll.view`.
- План засчитывается **только при факте ≥ плана**.
- KPI предлагаются за месяцы **с 2026-11-01** и не раньше `payroll_settings.starts_on`.
- Премия KPI: `kind='allowance'`, `medium='money'`, `business_date` = 1-е M, `origin='kpi'`, `managed=true`, `approved=true`.
- Премия KPI **не входит** в «половину» первой выплаты.
- UI — по `docs/design-system.md`; бейджи — `bg-{c}-500/10 text-{c}-700 dark:text-{c}-400`.
- CI = `pnpm exec tsc --noEmit` + `pnpm lint`; тесты — `node --test --experimental-strip-types "src/**/*.test.mts"`.

## Review Focus

1. Повторное сохранение итога меняет одну и ту же премию, а итог 0 ₽ удаляет её: второй премии нет (SQL-тест, Task 3).
2. Двойной клик или два окна дают одну премию и одну строку итогов (SQL-тест, Task 3).
3. Ручная правка или удаление премии KPI через журнал отклоняется с понятным текстом (SQL-тест, Task 3).
4. Если стереть план оборота, план алкоголя в той же строке остаётся (тест `planWrite`, Task 2).
5. Отчёт за месяц не готов или неполный (`through_date` раньше последнего дня). Тогда пункт плана получает пометку «Ждём отчёт», а не «не выполнен» (тест `alcoholActual`, Task 2; тест `kpiResult`, Task 1).

---

### Task 1: Расчёт KPI — чистые функции

**Files:**
- Create: `src/lib/payroll/kpi.ts`
- Test: `src/lib/payroll/kpi.test.mts`

**Interfaces:**
- Produces:
  ```ts
  export type KpiItem =
    | { id: string; type: "done"; label: string; amount: number }
    | { id: string; type: "each"; label: string; price: number }
    | { id: string; type: "plan"; label: string; amount: number; metric: "alcohol" }
    | { id: string; type: "all"; label: string; amount: number; requires: string[] };
  export type KpiAnswers = Record<string, boolean | number>;
  export type KpiPlanFact = { target: number | null; actual: number | null };
  export type KpiLine = { id: string; label: string; type: KpiItem["type"]; amount: number; counted: boolean; note: string | null };
  export function parseKpiItems(raw: unknown): KpiItem[];               // бросает Error с русским текстом
  export function kpiResult(items: KpiItem[], answers: KpiAnswers, plan: KpiPlanFact): { lines: KpiLine[]; total: number };
  export function kpiReason(month: string, lines: KpiLine[]): string;
  export function kpiSummary(items: KpiItem[]): { count: number; max: number; each: { label: string; price: number }[] };
  export type KpiPerson = { employeeId: string; termsId: string; roleId: string; since: string | null };
  export function kpiPeople(
    employees: PayEmployee[], assignments: PayAssignment[], models: PayModel[],
    terms: { id: string; role_id: string; valid_from: string }[], month: string,
    accruedIds: Set<string>,
  ): KpiPerson[];
  export const KPI_START = "2026-11-01";
  ```

Правила `parseKpiItems`:
- 1–20 пунктов, уникальные `id` вида `^[a-z0-9_]{1,40}$`, `label` — 1–80 символов после trim.
- `amount` и `price` — от 0 (не включая) до 1 000 000, не больше двух знаков после запятой.
- `all.requires` — не меньше двух `id` существующих пунктов типа `done`.
- Не больше одного пункта `plan`.
- Ошибки, например: «Пункт «…»: укажите сумму больше нуля», «Бонус «…» должен зависеть от двух и более пунктов».

`kpiResult`:
- `done` засчитывается при `answers[id] === true`.
- `each`: целое 0–50, сумма = число × цена, засчитывается при числе > 0.
- `plan`:
  - `target` равен `null` → `note: "План не был задан"`;
  - `actual` равен `null` → `note: "Ждём отчёт Quick Resto"`;
  - иначе засчитывается при `actual >= target`, `note` = процент, например `"99,9% плана"`.
- `all` засчитывается, если засчитаны все `requires`.
- `total` округляется до копеек.

`kpiReason`:
- `"KPI за ноябрь 2026: " + метки засчитанных строк через ", "`; у `each` — `"<label> ×<n>"`;
- месяц — через `transferMonthLabel` из `./transfer-reason.ts`;
- если засчитанных нет — `"KPI за ноябрь 2026: без выполненных пунктов"`.

`kpiPeople`:
- Должность берётся на последний день M через `employeeAtDate` из `./calculate.ts`.
- Действующие условия — последние по `valid_from ≤ M`.
- Временные сотрудники (`casual`) не попадают. Неактивный сотрудник попадает, только если у него есть начисления за M (параметр `accruedIds: Set<string>`, добавить шестым аргументом).
- `since` — дата начала должности, если она внутри M, иначе `null`.
- Месяцы раньше `KPI_START` → `[]`.

- [ ] **Step 1: Write the failing tests.** Пункты Павла задать фикстурой `SENIOR_BAR` (её же использует сид в Task 3):
  - `inventory` done 7000 «Инвентаризация до 20-го»;
  - `purchasing` done 10000 «Закупки алкоголя (кроме пива)»;
  - `team_event` done 3000 «Командное мероприятие»;
  - `all_three` all 5000 «Все три KPI», requires `[inventory, purchasing, team_event]`;
  - `alcohol_plan` plan 10000 «План продаж алкоголя»;
  - `seasonal` each 1000 «Сезонные позиции».

  ```ts
  test("KPI: всё выполнено, план выполнен, две сезонные — 37 000", () => {
    const r = kpiResult(SENIOR_BAR, { inventory: true, purchasing: true, team_event: true, seasonal: 2 }, { target: 400000, actual: 400000 });
    assert.equal(r.total, 37000);
  });
  test("KPI: план 99,99% — не засчитан, остальное 27 000", () => {
    const r = kpiResult(SENIOR_BAR, { inventory: true, purchasing: true, team_event: true, seasonal: 2 }, { target: 400000, actual: 399960 });
    assert.equal(r.total, 27000);
    assert.equal(r.lines.find((l) => l.id === "alcohol_plan")!.counted, false);
  });
  test("KPI: без одного из трёх нет бонуса за все", () => {
    assert.equal(kpiResult(SENIOR_BAR, { inventory: false, purchasing: true, team_event: true }, { target: null, actual: null }).total, 13000);
  });
  test("KPI: план не задан и отчёт не готов — разные пометки", () => {
    const line = (p: KpiPlanFact) => kpiResult(SENIOR_BAR, {}, p).lines.find((l) => l.id === "alcohol_plan")!;
    assert.equal(line({ target: null, actual: 5 }).note, "План не был задан");
    assert.equal(line({ target: 5, actual: null }).note, "Ждём отчёт Quick Resto");
  });
  test("KPI: основание премии", () => {
    const r = kpiResult(SENIOR_BAR, { inventory: true, seasonal: 2 }, { target: null, actual: null });
    assert.equal(kpiReason("2026-11-01", r.lines), "KPI за ноябрь 2026: Инвентаризация до 20-го, Сезонные позиции ×2");
  });
  test("KPI: сводка условий", () => {
    assert.deepEqual(kpiSummary(SENIOR_BAR), { count: 6, max: 35000, each: [{ label: "Сезонные позиции", price: 1000 }] });
  });
  ```
  Ещё тесты:
  - `parseKpiItems` отклоняет:
    - повтор `id`;
    - `all` с одним `requires`;
    - два пункта `plan`;
    - сумму 0;
    - сезонных 51 (это проверка `kpiResult`: `answers.seasonal = 51` бросает «От 0 до 50»).
  - `kpiPeople`:
    - (a) старший бармен в ноябре → один человек, `since: null`;
    - (b) должность с 12.11 → `since: "2026-11-12"`;
    - (c) обычный бармен не попадает;
    - (d) условия с 2026-12-01 не действуют в ноябре;
    - (e) октябрь → `[]`;
    - (f) уволенный без начислений за M не попадает, с начислениями — попадает.
- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/payroll/kpi.test.mts`. Expected: FAIL — модуля нет.
- [ ] **Step 3: Implement** `src/lib/payroll/kpi.ts` по интерфейсу выше.
- [ ] **Step 4: Run** тот же тест. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "KPI: расчёт пунктов, итога и основания премии"`.

---

### Task 2: План алкоголя — чистые функции и запись плана оборота

**Files:**
- Create: `src/lib/sales/alcohol-plan.ts`, `src/lib/sales/alcohol-plan.test.mts`
- Modify: `src/lib/sales/plan.ts` (добавить `planWrite`), тест `src/lib/sales/plan-write.test.mts`

**Interfaces:**
- Produces:
  ```ts
  export type AlcoholReport = { month: string; revenue: number | null; through_date: string | null; state: string };
  export function alcoholActual(report: AlcoholReport | null, month: string): number | null;
  export function alcoholHistory(reports: AlcoholReport[], archive: { month: string; alcoholRevenue: number | null }[]): Map<string, number>;
  export type AlcoholSuggestion = {
    amount: number | null;
    basis: "seasonal" | "last_month" | "none";
    lastMonth: number | null; lastYearSame: number | null; lastYearPrev: number | null;
    priceIncreasePercent: number | null;
  };
  export function suggestAlcoholPlan(history: Map<string, number>, target: string, priceIncreasePercent: number | null): AlcoholSuggestion;
  // в src/lib/sales/plan.ts
  export function planWrite(before: { turnover: number | null; alcohol: number | null } | null, next: { turnover: number | null; alcohol: number | null }): "noop" | "insert" | "update" | "delete";
  ```

Правила:
- `alcoholActual` — `revenue`, только если `state === "ready"` и `through_date` ≥ последнего дня месяца; иначе `null`.
- `alcoholHistory` — ключ `YYYY-MM-01`. Готовый полный отчёт важнее архива. Ноль и `null` — нет данных.
- `suggestAlcoholPlan(history, N, p)`:
  - есть A(N−12) и A(N−13): `A(N−1) × A(N−12) / A(N−13)`, `basis: "seasonal"`;
  - иначе `A(N−1)`, `basis: "last_month"`;
  - нет A(N−1): `amount: null`, `basis: "none"`;
  - затем × (1 + p/100), если `p` > 0;
  - округление вверх до 1000.
- `planWrite`:
  - до и после одинаково → `noop`;
  - строки не было и оба значения `null` → `noop`;
  - строки не было → `insert`;
  - оба новых значения `null` → `delete`;
  - иначе → `update`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  const h = new Map([["2026-11-01", 332199.1], ["2025-12-01", 400000], ["2025-11-01", 320000]]);
  test("план: сезонность прошлого года", () => assert.equal(suggestAlcoholPlan(h, "2026-12-01", null).amount, 416000));
  test("план: с повышением цен 5%", () => assert.equal(suggestAlcoholPlan(h, "2026-12-01", 5).amount, 437000));
  test("план: без прошлого года — прошлый месяц", () => {
    const r = suggestAlcoholPlan(new Map([["2026-11-01", 332199.1]]), "2026-12-01", 5);
    assert.deepEqual([r.amount, r.basis], [349000, "last_month"]);
  });
  test("план: ноль год назад — не делим на ноль", () =>
    assert.equal(suggestAlcoholPlan(new Map([["2026-11-01", 332199.1], ["2025-12-01", 400000], ["2025-11-01", 0]]), "2026-12-01", null).basis, "last_month"));
  test("план: нет прошлого месяца — нет предложения", () => assert.equal(suggestAlcoholPlan(new Map(), "2026-12-01", null).amount, null));
  test("факт: неполный отчёт — нет данных", () =>
    assert.equal(alcoholActual({ month: "2026-11-01", revenue: 300000, through_date: "2026-11-29", state: "ready" }, "2026-11-01"), null));
  test("факт: полный отчёт", () =>
    assert.equal(alcoholActual({ month: "2026-11-01", revenue: 332199.1, through_date: "2026-11-30", state: "ready" }, "2026-11-01"), 332199.1));
  test("история: отчёт важнее архива", () =>
    assert.equal(alcoholHistory([{ month: "2026-10-01", revenue: 434100.7, through_date: "2026-10-31", state: "ready" }], [{ month: "2026-10-01", alcoholRevenue: 434101 }]).get("2026-10-01"), 434100.7));
  test("план оборота стёрт, план алкоголя есть — строка остаётся", () =>
    assert.equal(planWrite({ turnover: 5_000_000, alcohol: 400000 }, { turnover: null, alcohol: 400000 }), "update"));
  test("оба плана стёрты — строка удаляется", () =>
    assert.equal(planWrite({ turnover: 5_000_000, alcohol: null }, { turnover: null, alcohol: null }), "delete"));
  ```
- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/sales/alcohol-plan.test.mts src/lib/sales/plan-write.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** оба модуля.
- [ ] **Step 4: Run** те же тесты. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "План алкоголя: предложение, факт и запись плана месяца"`.

---

### Task 3: Миграция 410 и SQL-тест

**Files:**
- Create: `supabase/migrations/410_payroll_kpi.sql`, `supabase/tests/payroll-kpi.sql`

**Interfaces:**
- Produces (SQL):
  - Таблица `public.payroll_kpi_terms`:
    - `id, account_id, venue_id, role_id, valid_from date, items jsonb, change_reason text, created_by, created_at`;
    - `check (extract(day from valid_from)=1)`, `check (jsonb_typeof(items)='array')`, `unique(account_id,id)`, `unique(venue_id, role_id, valid_from)`;
    - FK `(account_id, venue_id)` → `payroll_settings`; `role_id` → `roles`.
  - Таблица `public.payroll_kpi_reviews`:
    - `id, account_id, venue_id, employee_id, month date, terms_id, items jsonb, answers jsonb, lines jsonb, total numeric(15,2) check (total between 0 and 1000000), adjustment_id uuid, request_key uuid, saved_by, saved_at`;
    - `unique(account_id,id)`, `unique(venue_id, employee_id, month)`;
    - FK `(account_id, venue_id, employee_id)` → `payroll_employees`; `(account_id, terms_id)` → `payroll_kpi_terms`.
  - `sales_month_plans`:
    - `turnover` без `not null`;
    - новые колонки `alcohol numeric(14,2) check (alcohol is null or (alcohol > 0 and alcohol < 1e12))`, `alcohol_suggested numeric(14,2)`, `price_increase_percent numeric(5,2) check (price_increase_percent is null or price_increase_percent between 0.1 and 100)`;
    - `check (turnover is not null or alcohol is not null)`.
  - `payroll_payout_alerts.kind` — добавить `'kpi', 'kpi_plan'`.
  - `public.payroll_kpi_terms_save(p_role_id uuid, p_input jsonb, p_expected_id uuid) returns uuid`. Вход `{valid_from, items, reason}`. Ошибки:
    - «Нет доступа к условиям оплаты»;
    - «Укажите месяц и причину изменения условий»;
    - «Условия KPI только что изменили. Обновите страницу» — последняя версия ≠ `p_expected_id`;
    - «За этот месяц KPI уже подведены» — есть итог с `month ≥ valid_from` у условий этой должности.

    Тот же `valid_from` обновляет версию. Пишет `audit_logs` `payroll.kpi_terms.changed` (role_id, role_name, valid_from, before, after, reason).
  - `public.payroll_kpi_save(p_input jsonb) returns jsonb`. Вход `{request_key, employee_id, month, terms_id, answers, lines, total, reason}`, выход `{review_id, adjustment_id, total}`. Проверки:
    - право review или pay — «Нет доступа к итогам KPI»;
    - сотрудник в заведении;
    - `month ≥ greatest('2026-11-01', starts_on)`;
    - `terms_id` — действующие условия должности сотрудника на последний день M — иначе «Условия KPI изменились. Обновите страницу»;
    - период M не `draft` — «Период зафиксирован»;
    - у плана второй выплаты за M есть `carried_at` — «Остаток за <месяц> уже перенесён — поправку внесите премией за <следующий месяц>» (названия месяцев — массивом в функции: «ноябрь 2026», «декабрь 2026»).

    Повтор с тем же `request_key` и теми же данными возвращает прошлый результат.

    Запись премии — внутри `set_config('app.kpi_write','1',true)`:
    - total > 0 и премии нет → insert в `payroll_adjustments`: kind `allowance`, medium `money`, дата M, origin `kpi`, managed, approved, `rule_snapshot '{"kpi":true}'`, `request_key md5('kpi:'||review_id)::uuid`, created_by/approved_by = uid;
    - total > 0 и премия есть → update amount и reason;
    - total = 0 и премия есть → `deleted_at=now(), deleted_by=uid, delete_reason='Итог KPI — 0 ₽'`;
    - удалённая премия при новом total > 0 → снять `deleted_at`.

    Пишет `audit_logs` `payroll.kpi.saved` (employee_name, month, total, before_total, lines).
  - `private.payroll_kpi_guard()` + триггер `before update or delete on payroll_adjustments`. Если `old.origin='kpi'`, меняются `amount, reason, kind, business_date, employee_id, medium, deleted_at` и `current_setting('app.kpi_write', true)` ≠ `'1'` → «Эта премия — итог KPI. Измените её в итогах KPI».
  - `public.payroll_kpi_request_alcohol(p_month date) returns integer` — право review или pay; вызывает `private.sales_request_month_reports(v, p_month, false)`.
  - `public.sales_alcohol_plan_save(p_month date, p_input jsonb) returns uuid`. Вход `{alcohol, suggested, price_increase_percent}`. Права review / pay / `sales.configure_shifts`. Ветки insert, update и delete те же, что у `planWrite`. Пишет `audit_logs` `sales.plan.alcohol_set` (month, before, after, suggested, price_increase_percent).
  - RLS:
    - `payroll_kpi_terms` select — `payroll.view` или `payroll.configure` в своём аккаунте и заведении;
    - `payroll_kpi_reviews` select — `private.payroll_read(account_id, venue_id, employee_id)`;
    - insert, update и delete у `authenticated` отозваны;
    - чтение `sales_month_plans` — как было, плюс OR `payroll.view` (одна политика select, без второй permissive).
  - Разовый запрос истории: для каждого заведения с включённым `sales_statistics_sources` — `private.sales_request_month_reports(venue, m, false)` за m = 2025-01-01 … 2026-08-01.
  - Сид: для должностей с `code='payroll_senior_bar'` (не в архиве) — версия KPI с 2026-11-01. Пункты — фикстура `SENIOR_BAR` из Task 1, причина «Условия старшего бармена, подтверждены владельцем 27.11.2026». Если версия уже есть — пропустить.
  - Проверки `has_function_privilege` по всем новым функциям.

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/payroll-kpi.sql`. Шапка и хелперы (`expect_error`, `check`, `act_as`) — как в `supabase/tests/payroll_payout_plan.sql`. Сценарии:
  - (a) сохранение итога 27 000 → одна премия `allowance` 27 000 с `origin='kpi'`;
  - (b) повтор того же `request_key` → тот же `adjustment_id`, премий по-прежнему одна;
  - (c) новое сохранение 37 000 → та же премия, сумма 37 000;
  - (d) сохранение с итогом 0 → у премии стоит `deleted_at`;
  - (e) `payroll_update_entry` и `payroll_journal_command('delete', …)` по премии KPI → ошибка «итог KPI»;
  - (f) период M в статусе `checked` → «Период зафиксирован»;
  - (g) план второй выплаты за M с `carried_at` → «уже перенесён»;
  - (h) пользователь без review и pay → «Нет доступа»;
  - (i) `sales_alcohol_plan_save` с `alcohol=null` при заданном обороте → строка осталась, `alcohol is null`;
  - (j) `payroll_kpi_terms_save` на месяц с сохранённым итогом → «уже подведены»;
  - (k) октябрь 2026 → отказ.
- [ ] **Step 2: Run** `pnpm db:reset`, затем прогон теста командой из шапки (`docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/payroll-kpi.sql`) до миграции — Expected: FAIL (функций нет).
- [ ] **Step 3: Write** `supabase/migrations/410_payroll_kpi.sql` по интерфейсу выше, одной транзакцией `begin; … notify pgrst,'reload schema'; commit;`.
- [ ] **Step 4: Run** `pnpm db:reset` и SQL-тест. Expected: все `ok:`, нет `TEST FAILED`. Ещё прогнать `supabase/tests/payroll_payout_plan.sql` и `supabase/tests/payroll-entry-edit.sql`: старое не сломано.
- [ ] **Step 5: Commit** `git commit -m "Миграция 410: KPI старших, итоги месяца, план алкоголя"`.

---

### Task 4: Первая выплата без премии KPI

**Files:**
- Modify: `src/lib/payroll/payout-plan.ts` (режим `half`)
- Test: `src/lib/payroll/payout-plan.test.mts`

**Interfaces:**
- Consumes: `Adjustment.origin` (уже есть в `types.ts`); компоненты начисления с `source = "payroll-entry:<adjustment id>"`.

Реализация. В режиме `half`:
- `kpiAccrued` — сумма компонентов начислений сотрудника за M, у которых `source === "payroll-entry:" + id` для премий с `origin === "kpi"`, не удалённых.
- `half = (carried + earned − kpiAccrued + forecast − reserve) / 2`. Потолок (`ceiling`) не меняется.

- [ ] **Step 1: Write the failing test** `"первая выплата: премия KPI не входит в половину"`: начисление 01.11 с компонентом `{ kind: "allowance", source: "payroll-entry:k1", amount: 27000 }`, премия `{ id: "k1", origin: "kpi", kind: "allowance", amount: 27000 }`. Сумма строки первой выплаты = сумма без премии (сравнить с тем же набором без этого компонента и премии). Второй тест: в режиме `rest` премия входит.
- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/payroll/payout-plan.test.mts`. Expected: FAIL первого теста.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** тот же файл. Expected: PASS, остальные тесты файла зелёные.
- [ ] **Step 5: Commit** `git commit -m "Первая выплата: премия KPI не входит в половину"`.

---

### Task 5: Данные месяца KPI и server actions

**Files:**
- Create: `src/lib/payroll/kpi-month.ts` (server-only загрузка), `src/app/(dashboard)/people/payroll/kpi-actions.ts`
- Modify: `src/app/(dashboard)/sales/plan-actions.ts`, `src/app/(dashboard)/sales/shifts/actions.ts:151`

**Interfaces:**
- Consumes: Task 1 (`parseKpiItems`, `kpiResult`, `kpiReason`, `kpiPeople`, `KPI_START`), Task 2 (`alcoholActual`, `alcoholHistory`, `suggestAlcoholPlan`, `planWrite`), RPC из Task 3.
- Produces:
  ```ts
  export type KpiMonthView = {
    month: string;                     // YYYY-MM-01
    canSave: boolean; canConfigure: boolean;
    blocked: string | null;            // «Период зафиксирован» / «Остаток … уже перенесён …»
    people: {
      employeeId: string; name: string; roleName: string; since: string | null;
      termsId: string; items: KpiItem[];
      review: { answers: KpiAnswers; total: number; savedAt: string; savedBy: string } | null;
      manual: { amount: number; reason: string }[];   // ручные allowance/bonus за M с основанием, содержащим название должности
    }[];
    plan: KpiPlanFact;
    inventory: { date: string; beforeDeadline: boolean }[]; // проведённые акты инвентаризации M, по датам
    next: { month: string; current: number | null; priceIncreasePercent: number | null; suggestion: AlcoholSuggestion };
  };
  export async function loadKpiMonth(month: string): Promise<ActionResult<KpiMonthView>>;
  export async function saveKpiReview(input: { employeeId: string; month: string; termsId: string; answers: KpiAnswers; requestKey: string }): Promise<ActionResult<KpiMonthView>>;
  export async function saveAlcoholPlan(input: { month: string; amount: number | null; priceIncreasePercent: number | null; suggested: number | null }): Promise<ActionResult<KpiMonthView>>;
  export async function loadKpiTerms(roleId: string): Promise<ActionResult<{ versions: { id: string; valid_from: string; items: KpiItem[]; change_reason: string; created_at: string; created_by: string | null }[] }>>;
  export async function saveKpiTerms(roleId: string, input: { valid_from: string; items: KpiItem[]; reason: string }, expectedId: string | null): Promise<ActionResult<null>>;
  ```

Детали:
- Права проверяются через `payrollScope()` из `payroll-scope.ts`.
- Акты инвентаризации: `documents` с `document_kind='inventory'`, `processed`, `archived_at is null`, `venue_id`, `invoice_date` в M. `beforeDeadline` = дата ≤ 20-е.
- Если для M нет полного готового отчёта, а месяц уже закончился, `loadKpiMonth` вызывает `rpc("payroll_kpi_request_alcohol", { p_month })`. Ошибку RPC не показывать, только `console.error`.
- `saveKpiReview` считает итог на сервере через `kpiResult`: условия из базы, план и факт тоже из базы, клиенту не доверяем. Затем `rpc("payroll_kpi_save")` и возврат свежего `KpiMonthView`.
- `plan-actions.ts`:
  - `loadSalesPlans` отбрасывает строки с `turnover` равным `null`;
  - `saveSalesPlanImpl` выбирает ветку через `planWrite`, читая `alcohol` из строки: при `update` пишет `turnover: null`, а не удаляет строку.
- `shifts/actions.ts:151` — фильтр `.not("turnover", "is", null)`.

- [ ] **Step 1: Run** `pnpm exec tsc --noEmit`. Expected: зелёный до начала (база).
- [ ] **Step 2: Implement** `kpi-month.ts`, `kpi-actions.ts`, правки `plan-actions.ts` и `shifts/actions.ts`.
- [ ] **Step 3: Run** `pnpm exec tsc --noEmit && pnpm lint`. Expected: без ошибок.
- [ ] **Step 4: Run** все тесты (`node --test --experimental-strip-types "src/**/*.test.mts"`). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "KPI: данные месяца и server actions"`.

---

### Task 6: Интерфейс — условия KPI и вкладка «KPI»

**Files:**
- Create: `src/app/(dashboard)/people/payroll/_components/kpi-terms-editor.tsx`, `kpi-tab.tsx`, `kpi-checklist-dialog.tsx`, `alcohol-plan-dialog.tsx`
- Modify: `role-compensation.tsx` (строка «KPI» после «Надбавки и чаевые»), `payroll-workspace.tsx` (вкладка `kpi`, `?tab=kpi&month=YYYY-MM`)

**Interfaces:**
- Consumes: actions из Task 5, `kpiSummary` и `kpiResult` (живой итог в диалоге) из Task 1.

Поведение:
- **Строка «KPI» в условиях должности.** Свёрнутый вид: `kpiSummary`, например «6 пунктов · до 35 000 ₽ + 1 000 ₽ за каждую: Сезонные позиции»; без условий — «Не заданы». Редактор в той же боковой панели (`PayrollDetailDialog`):
  - список пунктов: тип (Select «Сделано / За каждую / План продаж алкоголя / Бонус за все»), название, сумма или цена, для «Бонус за все» — галочки пунктов;
  - «С месяца» (`PayrollMonthPicker`) и «Причина»;
  - история версий — как у оклада.

  Редактирование — только с `payroll.configure`.
- **Вкладка «KPI».** Видна с `payroll.view`, если у заведения есть условия KPI. Месяц — месяц страницы. Сверху метрики: подведено N из M, сумма итогов. Под ними по карточке на человека:
  - имя, должность, «с 12 ноября» (если `since`);
  - статус: «Не подведены» (бейдж amber) или «Подведены · 27 000 ₽» (emerald);
  - кнопка «Подвести итоги» или «Изменить».

  Ниже — карточка «План продаж алкоголя на декабрь 2026»: план или «Не задан», кнопка «Задать план». Если `blocked` есть — показать его текст вместо кнопок сохранения.
- **Диалог чек-листа.**
  - Пункты:
    - «Сделано» — Switch;
    - «За каждую» — числовое поле;
    - «План» — плановая цифра, факт, процент и бейдж «Выполнен» или «Не выполнен»; либо пометка из `note`;
    - «Бонус за все» — только отображение.
  - Подсказки:
    - под инвентаризацией: «Проведено 16 ноября (7 актов)» или «Актов за ноябрь нет»; если все акты позже 20-го — «позже 20-го»;
    - вверху предупреждение amber, если `manual` не пуст: «Уже начислено вручную: 42 000 ₽ «Старший бармен» — проверьте, чтобы не заплатить дважды».
  - Внизу живой итог и «Сохранить». `requestKey` — `crypto.randomUUID()` один раз на открытие диалога.
  - После успешного сохранения, если `next.current === null`, открыть диалог плана.
- **Диалог плана.**
  - Предложение и разбор:
    - «Ноябрь 2026: 332 199 ₽»;
    - «Декабрь / ноябрь 2025: ×1,25» или «Данных за прошлый год нет»;
    - «Цены: +5%».
  - Switch «Поднимали цены?», при включении — поле «Средний %».
  - Поле «План, ₽» с подставленным предложением; при смене % предложение пересчитывается (`suggestAlcoholPlan` на клиенте по `history`, или повторный запрос — на выбор исполнителя).
  - «Утвердить».

- [ ] **Step 1: Implement** компоненты по `docs/design-system.md`; мобильная вёрстка — по `docs/mobile-web.md` (`min-w-0`, поля 16px).
- [ ] **Step 2: Run** `pnpm exec tsc --noEmit && pnpm lint`. Expected: без ошибок.
- [ ] **Step 3: Verify** в браузере на локальной базе (`pnpm dev` в фоне через Bash):
  - задать условия «Старшему бармену»;
  - открыть `/people/payroll?tab=kpi&month=2026-11`, сохранить итог;
  - премия появилась на вкладке «Начисления и удержания» с основанием «KPI за ноябрь 2026: …»;
  - повторное сохранение меняет ту же запись;
  - задать план на декабрь.

  Скриншоты — светлая и тёмная темы, ширина 375.
- [ ] **Step 4: Commit** `git commit -m "KPI: условия в должности, вкладка и чек-лист итогов"`.

---

### Task 7: Напоминания в «На разбор», журнал, справка

**Files:**
- Modify:
  - `src/lib/payroll/payout-alerts.ts` (`PayoutAlertKind` + `"kpi" | "kpi_plan"`);
  - `src/lib/payroll/payout-check.ts` (шаг `["KPI", checkKpi]`, поле `CheckResult.kpiMissing: number`);
  - `src/lib/finance/payout-inbox-data.ts` (`KINDS`);
  - `src/app/(dashboard)/finance/inbox/_components/payout-alert-card.tsx` (метки «KPI» и «План продаж», ссылка `/people/payroll?tab=kpi&month=<YYYY-MM из business_date>`);
  - `src/lib/payroll/payout-alert-text.ts` (`kpiAlert`, `kpiPlanAlert`);
  - `src/lib/audit/payroll-payout.tsx` (фразы трёх событий);
  - `src/lib/audit/action-categories.ts` (`.saved` и `.alcohol_set` → changed);
  - `docs/handbook/people/payroll.md`, `docs/handbook/sales/statistics.md`.
- Test: `src/lib/payroll/payout-alert-text.test.mts`

**Interfaces:**
- Consumes: `kpiPeople` (Task 1), таблицы Task 3.
- Produces:
  ```ts
  export function kpiAlert(month: string, people: { name: string; role: string }[]): AlertText;
  // { title: "KPI за ноябрь 2026 не подведены", lines: ["Имя — Старший бармен"] }
  export function kpiPlanAlert(month: string): AlertText;
  // { title: "План продаж алкоголя на декабрь 2026 не задан", lines: ["Задайте план во вкладке «KPI» зарплаты"] }
  ```

`checkKpi(s, data, today, venueName, out)`:
- M = прошлый месяц от `today`, если M ≥ `KPI_START`.
- Люди без итога за M → `raiseAlert({ kind: "kpi", key: M, businessDate: M, ...kpiAlert })`, одна карточка на месяц. Все подведены → `closeAlert(s, "kpi", M)`.
- Если у кого-то в условиях на текущий месяц есть пункт `plan`, а `sales_month_plans.alcohol` на текущий месяц пуст → `raiseAlert({ kind: "kpi_plan", key: current, businessDate: M })`, иначе `closeAlert`.
- В чат не писать.

Справка:
- `people/payroll.md` — раздел «KPI старших»: где задать пункты, когда подводить итоги, куда идут деньги (вторая выплата), как приложение предлагает план, что делать, если отчёт не готов. Убрать пункт «Пока не умеет: KPI и надбавки старших».
- `sales/statistics.md` — абзац о плане продаж алкоголя и о том, что выполнение считается по «Продажам алкоголя».

- [ ] **Step 1: Write the failing tests** для `kpiAlert` и `kpiPlanAlert` (точные заголовки выше).
- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/payroll/payout-alert-text.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** всё из списка файлов.
- [ ] **Step 4: Run** тесты, `pnpm exec tsc --noEmit && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Verify** локально: `curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:<port>/api/cron/payroll-payout-check` при неподведённом ноябре. Ожидается: карточка «KPI за ноябрь 2026 не подведены» в `/finance/inbox`; после сохранения итога и повторного вызова она закрыта.
- [ ] **Step 6: Commit** `git commit -m "KPI: напоминания в «На разбор», журнал, справка"`.

---

## После реализации

- Ревью всей ветки свежим рецензентом; все замечания исправить.
- PR в `main` без имён сотрудников и id чатов в описании.
- После «мержи»:
  - миграция на прод: `-U supabase_admin`, файл копируется в контейнер `supabase-db-jk8o8os4wowowg088ksckcc4`, строка в `supabase_migrations.schema_migrations`;
  - деплой — с разрешения Павла;
  - проверка: условия старшего бармена видны, вкладка «KPI» за ноябрь открывается, отчёты истории встали в очередь.
