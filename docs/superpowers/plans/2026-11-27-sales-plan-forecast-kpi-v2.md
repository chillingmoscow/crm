# План месяца с прогнозом и KPI старших v2 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один план месяца (оборот + доля алкоголя) в «Статистике» с комплексным прогнозом, KPI старших в течение месяца по доле алкоголя, напоминания 1-го/25-го и аккуратная вкладка KPI.

**Architecture:** Прогноз — чистые функции (`src/lib/sales/forecast.ts`) над помесячными рядами, журналом цен, таблицей сезонности и весами дней недели. Миграция 418 добавляет право `sales.plan`, долю алкоголя в плане, журнал цен, таблицу сезонности и единую функцию записи плана; переводит KPI на долю. UI: панели «План», «Цены», «Сезонность» в «Статистике», переделанная вкладка KPI. История продаж 2025 догружается по одному дню, когда очередь Quick Resto свободна.

**Tech Stack:** Next.js 15, Supabase/Postgres, `node:test`, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-27-sales-plan-forecast-kpi-v2-design.md` (продолжает `2026-11-27-payroll-kpi-design.md`, миграция 415)

## Global Constraints

- Тексты интерфейса и `raise exception` — по-русски; server actions через `actionResult`.
- Миграция — `418_sales_plan_forecast.sql`; номер перепроверить по `origin/main` и открытым PR прямо перед мержем.
- `set search_path` в каждой функции; `(select auth.uid())`/`(select has_permission(...))` в политиках; grant/revoke с проверкой `has_function_privilege`.
- Право плана — новое `sales.plan` «Планы продаж»; выдаётся ролям, у которых есть `sales.configure_shifts`.
- Доля алкоголя = продажи алкоголя (отчёт Quick Resto) / очищенный оборот тех же дней — правилом `statisticsRevenueShare`.
- Пункт KPI плана засчитывается при доле ≥ плановой, только за закончившийся месяц с полным отчётом.
- Веса прогноза оборота: Г 0,5 · М 0,3 · У 0,2 (без Г: М 0,6 · У 0,4); доли: Г 0,6 · М 0,4. Округление: оборот — до 10 000 ₽, доля — до 0,1 п.п. Порог «оценки расходятся» — 15%.
- Сезонные индексы — **на день** (средний оборот дня месяца к среднему дню года), 12 значений, среднее 1.
- Рублёвые колонки плана алкоголя из 415 не пишутся и не читаются (удаление — отдельной миграцией позже); функцию `sales_alcohol_plan_save` из 415 не удалять в этой миграции (старое приложение до деплоя).
- UI — `docs/design-system.md`, мобильная — `docs/mobile-web.md`; бейджи — `StatusBadge`; аватарки — `avatarThumbUrl`.
- CI: `pnpm exec tsc --noEmit`, `pnpm lint`; тесты: `node --test --experimental-strip-types "src/**/*.test.mts"`.

## Review Focus

1. Текущий незакончившийся месяц или месяц с дырами в днях не должен попасть в базы прогноза как полный — оценка без него, а не с половиной оборота (тест `forecast: неполный месяц не база`, Task 1).
2. Изменение цен в середине месяца — по доле дней, а не целиком (тест `priceLevel: подъём 16-го — половина месяца`, Task 1).
3. Ручная таблица сезонности с нулём/отрицательным/средним ≠ 1 — отказ или нормировка, не деление на ноль (тест `parseSeasonIndex`, Task 2).
4. Итог KPI, сохранённый в середине месяца, затем смена плана доли — итог «нужно досчитать», а не тихо засчитанный/незасчитанный план (тест `kpiResult: месяц не закончился`, Task 4; SQL-тест, Task 3).
5. Догрузка истории не должна оттеснять загрузку сегодняшних смен и не должна заводить побочные задачи (кассы, сверки) по дням 2025 (тест `historyDayToEnqueue`, Task 9; проверка триггеров).

---

### Task 1: Прогноз — чистые функции

**Files:**
- Create: `src/lib/sales/forecast.ts`, `src/lib/sales/forecast.test.mts`

**Interfaces:**
- Produces:
  ```ts
  export type MonthKey = string; // "YYYY-MM-01"
  export type PriceChange = { date: string; percent: number };
  export type SeasonIndex = number[]; // 12 значений, январь…декабрь, на день
  export type ForecastEstimate = { key: "yoy" | "mom" | "level"; value: number; weight: number; basis: string };
  export type Forecast = { value: number | null; estimates: ForecastEstimate[]; diverge: boolean };
  export function priceLevel(changes: PriceChange[], month: MonthKey): number;      // уровень цен месяца (среднее по дням)
  export function monthWeight(weekdayWeights: number[], month: MonthKey): number;   // Σ весов дней недели в месяце; weekdayWeights[0]=понедельник
  export function forecastTurnover(input: {
    target: MonthKey; turnover: Map<MonthKey, number>; complete: Set<MonthKey>;
    prices: PriceChange[]; season: SeasonIndex; weekdayWeights: number[];
  }): Forecast;
  export function forecastShare(input: { target: MonthKey; share: Map<MonthKey, number>; complete: Set<MonthKey> }): Forecast;
  export const FORECAST_WEIGHTS: { turnover: { yoy: number; mom: number; level: number }; share: { yoy: number; mom: number } };
  ```

Алгоритм (не выводится из сигнатуры):
- `priceLevel`: произведение по изменениям `(1 + p/100)^f`, где `f` = 1, если изменение до начала месяца; доля дней месяца с даты изменения включительно, если внутри; 0 — если позже.
- Нормированное значение базы `Z(B) = R(B) × priceLevel(N)/priceLevel(B) / monthWeight(B)`; база допустима, только если `B ∈ complete`.
- Оборот: `yoy = Z(N−12) × ΣZ(N−k)/ΣZ(N−12−k) × W(N)`, k=1..3 (нужны все шесть месяцев тренда и N−12); `mom = Z(N−1) × S(N)/S(N−1) × W(N)`; `level = среднее(Z(N−k)/S(N−k)) × S(N) × W(N)` по доступным k=1..3 (не меньше двух).
- Доля: `yoy = A(N−12) + (среднее A(N−k) − среднее A(N−12−k))`, k=1..3; `mom = A(N−1) × (A(N−12)/A(N−13), если оба есть, иначе 1)`.
- Итог — взвешенное среднее доступных оценок с перенормировкой весов; `diverge`, если (max−min)/итог > 0,15; `basis` — короткий русский текст («Ноябрь 2025: 3,9 млн × темп года ×1,08»).

- [ ] **Step 1: Write the failing tests** (числа считаются в тесте от фикстуры, а не руками):
  - `priceLevel: подъём 16-го — половина месяца` — `{date:"2026-11-16",percent:10}` → ноябрь `1.1^(15/30)`, декабрь `1.1`, октябрь `1`.
  - `monthWeight` — веса `[1,1,1,1,2,2,1]`: ноябрь 2026 больше февраля 2026 (посчитать по календарю в тесте).
  - `forecast: без истории года — только М и У с весами 0,6/0,4`.
  - `forecast: неполный месяц не база` — N−1 не в `complete` → нет оценки «mom», `level` по N−2..N−3.
  - `forecast: все три оценки и веса 0,5/0,3/0,2`; итог округлён до 10 000.
  - `forecast: расхождение > 15% помечено`.
  - `forecast: истории нет совсем` → `value: null`, `estimates: []`.
  - `share: год к году и месяц к месяцу`, округление до 0,1.
- [ ] **Step 2: Run** `node --test --experimental-strip-types src/lib/sales/forecast.test.mts`. Expected: FAIL (нет модуля).
- [ ] **Step 3: Implement** `src/lib/sales/forecast.ts`.
- [ ] **Step 4: Run** тот же тест. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Прогноз плана: оценки год к году, месяц к месяцу и по уровню"`.

---

### Task 2: Отраслевая сезонность и таблица заведения

**Files:**
- Create: `src/lib/sales/seasonality.ts`, `src/lib/sales/seasonality.test.mts`

**Interfaces:**
- Produces:
  ```ts
  export const INDUSTRY_SEASONALITY: { index: SeasonIndex; source: string; years: string; note: string };
  export const OWNER_SEASON_NOTE: string; // описание сезонов словами Павла (для подсказки)
  export function parseSeasonIndex(raw: unknown): SeasonIndex;   // 12 чисел > 0, нормирует к среднему 1; иначе Error по-русски
  export function ownSeasonIndex(daily: { date: string; turnover: number }[]): (number | null)[]; // по своим дням: месяц без полного года — null
  ```

- [ ] **Step 1: Собрать ряд.** Оборот общественного питания г. Москвы по месяцам за 2022–2025 из ежемесячных релизов 77.rosstat.gov.ru («О розничной торговле и общественном питании») или ЕМИСС; индекс потребительских цен на услуги общепита за те же месяцы. Индекс месяца = среднее по годам (оборот месяца / ИПЦ-уровень / дней месяца) ÷ среднее по году. Источник, годы и ссылки — в `source`/`note`. Если ряд за какой-то год собрать нельзя — взять доступные годы и написать это в `note`. Если не собирается ни один полный год — `index` по описанию Павла (сентябрь 0,95 · октябрь 1,05 · ноябрь 1,12 · декабрь 1,18 · январь 0,85 · февраль 1,0 · март 1,02 · апрель 0,98 · май 0,92 · июнь 0,88 · июль 0,87 · август 0,9, нормированные) с `source: "оценка владельца"` — и сказать об этом в итоге работы.
- [ ] **Step 2: Write the failing tests:** `INDUSTRY_SEASONALITY` — 12 чисел, среднее 1 (±0,001), все > 0; `parseSeasonIndex` отклоняет 11 чисел, ноль, отрицательное, строку; нормирует `[2,…,2]` → все 1; `ownSeasonIndex` — 13 месяцев дней с удвоенным декабрём → декабрь ≈ 2× среднего, месяцы без полного года — `null`.
- [ ] **Step 3: Run** `node --test --experimental-strip-types src/lib/sales/seasonality.test.mts`. Expected: FAIL.
- [ ] **Step 4: Implement**.
- [ ] **Step 5: Run** — PASS. **Commit** `git commit -m "Сезонность: отраслевой индекс Москвы и таблица заведения"`.

---

### Task 3: Миграция 418 и SQL-тест

**Files:**
- Create: `supabase/migrations/418_sales_plan_forecast.sql`, `supabase/tests/sales-plan-forecast.sql`

**Interfaces:**
- Produces (SQL):
  - Право `sales.plan` в `permissions` (модуль `sales`, описание «Планы продаж»), `role_permissions(granted)` для ролей с `sales.configure_shifts`.
  - `sales_month_plans`: `alcohol_share numeric(5,2) check (alcohol_share is null or alcohol_share between 0.1 and 100)`, `forecast jsonb`; ограничение `sales_month_plans_any` → `turnover is not null or alcohol_share is not null or alcohol is not null`.
  - Запись плана только функцией: отозвать insert/update/delete у `authenticated`, удалить политики insert/update/delete из 402; триггер `sales_alcohol_plan_guard` из 415 заменить на `private.sales_month_plan_guard` (любая запись без `app.sales_plan_write='1'` или `app.alcohol_plan_write='1'` → «План продаж задаётся в «Статистике»»).
  - `public.sales_month_plan_save(p_month date, p_input jsonb) returns uuid` — право `sales.plan`; вход `{turnover|null, alcohol_share|null, forecast}`; оба пусты → удалить строку; доля плана месяца, который закончился (по часовому поясу заведения) и по которому есть итоги KPI, не меняется («Итоги KPI за <месяц> подведены — долю алкоголя менять нельзя»); журнал `sales.plan.saved` (before/after обоих значений, прогнозы).
  - `sales_price_changes` (id, account_id, venue_id, effective_on date, percent numeric(5,2) check between −50 and 100 and ≠ 0, note text ≤ 300, created_by, created_at); select — `sales.view_shifts`; функции `sales_price_change_save(p_input jsonb) returns uuid`, `sales_price_change_delete(p_id uuid) returns boolean` — право `sales.plan`, журнал `sales.price_change.created|deleted`.
  - `sales_seasonality` (venue_id pk, account_id, index jsonb массив 12 чисел > 0, updated_by, updated_at); select — `sales.view_shifts`; `sales_seasonality_save(p_index jsonb|null)` — право `sales.plan` (null — вернуть отраслевую), журнал `sales.seasonality.changed`.
  - KPI: в `payroll_kpi_terms.items` показатель плана `alcohol` → `alcohol_share` (jsonb-апдейт всех версий); `payroll_kpi_save` сверяет `plan_target` с `sales_month_plans.alcohol_share`; заморозка в `payroll_kpi_terms_save` — только если месяц итога закончился (по часовому поясу заведения).
  - `payroll_payout_alerts.kind` + `'sales_plan'`.
- [ ] **Step 1: Write the failing SQL test** (шапка и хелперы — как `supabase/tests/payroll-kpi.sql`): (a) без `sales.plan` — «Нет доступа»; (b) сохранение оборота и доли, журнал; (c) прямой `insert/update` в `sales_month_plans` под `authenticated` — отказ; (d) доля закончившегося месяца с итогами KPI — отказ, оборот того же месяца — можно; (e) в текущем месяце с итогами KPI доля меняется; (f) цены: сохранение, процент 0 — отказ, удаление; (g) сезонность: 11 чисел — отказ, null — сброс; (h) `payroll_kpi_save` с `plan_target` ≠ доле — «План продаж за месяц изменился»; (i) условия KPI после миграции — `metric = alcohol_share`; (j) `sales.plan` выдано ролям с `sales.configure_shifts`.
- [ ] **Step 2: Run** (миграция 415 уже на локальной базе): `cat <(echo 'begin;') <(sed -E '/^[[:space:]]*begin;[[:space:]]*$/d' supabase/tests/sales-plan-forecast.sql) | docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -`. Expected: FAIL.
- [ ] **Step 3: Write** миграцию 417.
- [ ] **Step 4: Run** миграцию + тест одной откатываемой транзакцией (`cat <(echo begin;) <(sed … 417) <(sed … test)`), затем `supabase/tests/payroll-kpi.sql` (с обновлённым `plan_target` в хелпере на долю). Expected: оба `all passed`.
- [ ] **Step 5: Commit** `git commit -m "Миграция 418: право «Планы продаж», доля алкоголя, цены, сезонность"`.

---

### Task 4: KPI по доле алкоголя и в течение месяца

**Files:**
- Modify: `src/lib/payroll/kpi.ts`, `src/lib/payroll/kpi.test.mts`, `src/lib/sales/alcohol-plan.ts`, `src/lib/sales/alcohol-plan.test.mts`

**Interfaces:**
- Produces:
  ```ts
  // kpi.ts
  type plan item: { id; type: "plan"; label; amount; metric: "alcohol_share" }  // parseKpiItems принимает и "alcohol" как синоним
  export type KpiPlanFact = { target: number | null; actual: number | null; pending: "month" | "report" | null };
  export const KPI_WAITING_MONTH = "Посчитаем после конца месяца";
  // kpiNeedsRecount — true и для KPI_WAITING_MONTH
  // alcohol-plan.ts
  export function alcoholShareActual(input: { report: StatisticsReport | undefined; days: SalesDay[]; timezone: string; hour: number; month: MonthKey; today: string }): { actual: number | null; pending: "month" | "report" | null };
  ```
  Пункт плана: `pending: "month"` → note `KPI_WAITING_MONTH`, `"report"` → «Ждём отчёт Quick Resto»; засчитан при `actual ≥ target`; заметка — «10,4% при плане 10%».
- [ ] **Step 1: Failing tests:** `kpiResult: месяц не закончился — план «Посчитаем после конца месяца»`, `kpiNeedsRecount — и для месяца`, `kpiResult: доля 10,4 при плане 10 — засчитан, 9,99 — нет`, `parseKpiItems: metric alcohol читается как alcohol_share`, `alcoholShareActual: месяц идёт — pending month; отчёт неполный — report; полный — доля` (фикстура отчёта с `period_start/period_end` под `statisticsRevenueShare`).
- [ ] **Step 2–4:** Run → FAIL → implement → PASS (`node --test --experimental-strip-types src/lib/payroll/kpi.test.mts src/lib/sales/alcohol-plan.test.mts`).
- [ ] **Step 5: Commit** `git commit -m "KPI: план по доле алкоголя, итоги в течение месяца"`.

---

### Task 5: Данные плана и действия

**Files:**
- Create: `src/lib/sales/plan-data.ts`, `src/app/(dashboard)/sales/statistics/plan-actions.ts`
- Delete: `src/app/(dashboard)/sales/plan-actions.ts`, `src/app/(dashboard)/sales/settings/_components/sales-plan-settings.tsx` (секцию плана в `settings/page.tsx` заменить ссылкой «План месяца задаётся в «Статистике»»)
- Modify: `src/lib/payroll/kpi-month.ts`, `src/app/(dashboard)/people/payroll/kpi-actions.ts`, `src/app/(dashboard)/sales/shifts/actions.ts` (чтение плана — как было)

**Interfaces:**
- Consumes: Task 1, 2, 4.
- Produces:
  ```ts
  // plan-data.ts (server-only, admin-клиент после проверки прав)
  export type MonthPlanView = {
    month: MonthKey; canEdit: boolean;
    turnover: { plan: number | null; fact: number | null; forecast: Forecast };
    alcoholShare: { plan: number | null; fact: number | null; pending: "month" | "report" | null; forecast: Forecast; frozen: boolean };
    prices: (PriceChange & { id: string; note: string })[];
    season: { index: SeasonIndex; custom: boolean; industry: SeasonIndex; own: (number | null)[]; source: string };
  };
  export async function loadMonthPlanView(s: { admin; accountId; venueId; permissions: string[] }, month: MonthKey): Promise<MonthPlanView>;
  // statistics/plan-actions.ts
  export async function loadMonthPlan(month: string): ActionResult<MonthPlanView>;
  export async function saveMonthPlan(input: { month: string; turnover: number | null; alcoholShare: number | null }): ActionResult<MonthPlanView>;
  export async function savePriceChange(input: { date: string; percent: number; note: string }): ActionResult<MonthPlanView["prices"]>;
  export async function deletePriceChange(id: string): ActionResult<MonthPlanView["prices"]>;
  export async function saveSeasonality(index: number[] | null): ActionResult<MonthPlanView["season"]>;
  ```
  Ряды: оборот по месяцам — сумма `sales_days` (эффективные метрики), месяц полный, если есть все дни; запасной источник — `sales_statistics_archive`; доля — по `statisticsRevenueShare`; веса дней недели — средний оборот по дню недели за последние 12 месяцев своих дней, нормированный к 1. `saveMonthPlan` пишет в `forecast` снимок обоих прогнозов. KPI: `kpi-month.ts` берёт план `alcohol_share` и факт `alcoholShareActual`; блокировка «с 1-го числа» снимается (будущий месяц — «Итоги будущего месяца подводить рано»); `saveAlcoholPlan` и `alcohol-plan-dialog.tsx` удаляются; `plan_target` — доля.
- [ ] **Step 1:** `pnpm exec tsc --noEmit` — зелёный до правок.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `pnpm exec tsc --noEmit && pnpm lint` и весь набор тестов. Expected: зелёные (кроме известных 22 «vm.SourceTextModule»).
- [ ] **Step 4: Commit** `git commit -m "План месяца: данные прогноза и действия «Статистики»"`.

---

### Task 6: «Статистика»: план, цены, сезонность

**Files:**
- Create: `src/app/(dashboard)/sales/statistics/_components/month-plan-drawer.tsx`, `price-changes-drawer.tsx`, `seasonality-drawer.tsx`
- Modify: `src/app/(dashboard)/sales/statistics/statistics-client.tsx`, `src/app/(dashboard)/sales/shifts/_components/month-plan.tsx` (ссылка «Задать план» → `/sales/statistics?plan=YYYY-MM`)

Поведение:
- В шапке «Статистики» (secondaryActions) — кнопка «План на <месяц>» (текущий, если плана нет, иначе следующий) и меню «Цены», «Сезонность»; `?plan=YYYY-MM` открывает панель плана.
- Таблица месяцев: столбцы «План оборота», «Выполнение», «Доля алкоголя · план».
- Панель плана (`EditDrawer`): выбор месяца; два поля («Оборот, ₽», «Доля алкоголя, %») с подставленным прогнозом; под каждым — разбор оценок (`basis`, вес, значение), пометка «Оценки расходятся» (amber `StatusBadge`), факт и выполнение для идущего/прошлого месяца; «Утвердить». Без `sales.plan` — только чтение.
- «Цены»: список изменений (дата, %, комментарий), добавить/удалить.
- «Сезонность»: 12 строк — «Росстат», «Ваши данные», «Сейчас в прогнозе» (редактируемое поле), подсказка со словами Павла; «Вернуть отраслевую».
- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `pnpm exec tsc --noEmit && pnpm lint`.
- [ ] **Step 3: Verify** локально (`pnpm dev` в фоне через Bash): план на декабрь с разбором; правка цены меняет прогноз; правка сезонности меняет прогноз; «Смены» ведут в «Статистику»; 375 px и тёмная тема.
- [ ] **Step 4: Commit** `git commit -m "Статистика: план месяца с прогнозом, журнал цен, сезонность"`.

---

### Task 7: «Зарплата»: порядок вкладок и новая вкладка KPI

**Files:**
- Modify: `src/app/(dashboard)/people/payroll/_components/payroll-workspace.tsx` (порядок: Ведомость · Выплаты · Начисления и удержания · KPI · План выплат), `kpi-tab.tsx`, `kpi-checklist-dialog.tsx`
- Delete: `src/app/(dashboard)/people/payroll/_components/alcohol-plan-dialog.tsx`

Поведение:
- Одна `MetricStrip`: «Подведено N из M», «Премии KPI», «Доля алкоголя» (план · факт; «План не задан» — ссылка «Задать в статистике», только если есть `sales.plan`).
- Сотрудники — сетка карточек: аватарка (`avatarThumbUrl` по `local_user_id` → профиль), имя, должность («с 12 ноября»), прогресс «3 из 6 пунктов», сумма, `StatusBadge` («Не подведены» / «Досчитать план» / «Подведены»), кнопка.
- Подпись под метриками вместо плашки: «Ноябрь идёт: план засчитаем после конца месяца».
- Шапка чек-листа — с аватаркой.
- [ ] **Step 1: Implement.** **Step 2:** tsc + lint. **Step 3: Verify** в браузере (отметить итоги в середине месяца — сохраняются, план «Посчитаем после конца месяца»; 375 px; тёмная тема). **Step 4: Commit** `git commit -m "Зарплата: вкладка KPI с аватарками, KPI перед планом выплат"`.

---

### Task 8: Напоминания и колокольчик

**Files:**
- Create: `src/lib/notifications/recipients.ts` (вынести `payRecipients` из `payout-draft.ts` как `permissionRecipients(admin, venueId, codes: string[])`)
- Modify: `src/lib/payroll/payout-check.ts`, `src/lib/payroll/payout-alerts.ts`, `src/lib/payroll/payout-alert-text.ts` (+ тест), `src/lib/finance/payout-inbox-data.ts`, `finance/inbox/_components/payout-alert-card.tsx`, `src/lib/notifications/registry.ts`, `src/lib/payroll/payout-draft.ts`

**Interfaces:**
- Produces: `salesPlanAlert(month, missing: ("turnover" | "alcohol_share")[]): AlertText` — «План продаж на декабрь 2026 не задан», строки «Оборот», «Доля алкоголя»; типы колокольчика `sales.plan_missing` (category `finance`, иконка `Target`), `staff.kpi_due` (category `staff`).

Логика в `checkKpi` (переименовать в `checkPlansAndKpi`):
- план текущего месяца с 1-го и следующего с 25-го: нет оборота или (есть KPI с пунктом плана и) нет доли → карточка `sales_plan` ключ = месяц, ссылка `/sales/statistics?plan=YYYY-MM`; задан или месяц прошёл → закрыть; старые `kpi_plan` закрыть;
- KPI прошлого месяца с 1-го — как сейчас;
- колокольчик — только когда карточка создана впервые (`raiseAlert` → `"created"`): план — держателям `sales.plan`, KPI — держателям `payroll.review`/`payroll.pay`.
- [ ] **Step 1: Failing test** `salesPlanAlert: чего не хватает`. **Step 2–4:** FAIL → implement → PASS + tsc/lint. **Step 5: Verify** локально `POST /api/cron/payroll-payout-check` с `x-cron-secret`: карточка «План продаж на ноябрь 2026 не задан», колокольчик у владельца; после плана — закрыта. **Step 6: Commit** `git commit -m "Напоминания: план продаж 1-го и 25-го, KPI 1-го, колокольчик"`.

---

### Task 9: Догрузка истории продаж 2025

**Files:**
- Create: `src/lib/sales/history-backfill.ts`, `src/lib/sales/history-backfill.test.mts`
- Modify: `src/app/api/cron/sales-shifts/route.ts` (вызов сразу после `scheduleDueDays`, в своём try/catch; полосы ротации не трогать)

**Interfaces:**
- Produces:
  ```ts
  export const HISTORY_FROM = "2025-01-01";
  export function historyDayToEnqueue(input: { firstDay: string | null; existing: Set<string>; failedTimes: Map<string, number>; busy: boolean }): string | null;
  export async function scheduleHistoryDay(): Promise<{ venueId: string; date: string | null }[]>;
  ```
  Правило: если по заведению есть задачи `queued`/`running` — ничего (`busy`); иначе самый поздний день из `[HISTORY_FROM, firstDay)`, которого нет в `sales_days`; дни с ≥ 3 неудачными задачами пропускаются; один день за тик.
- [ ] **Step 0: Проверка без кода.** Перед реализацией — найти, кто реагирует на новые `sales_days`/`sales_sync_jobs` (триггеры, полосы кассы/сверок): по дням 2025 не должно появиться побочных задач. Если появляются — добавить фильтр `business_date >= sales_settings`-старт в тех местах и записать в итог.
- [ ] **Step 1: Failing tests:** `historyDayToEnqueue: занята очередь — null`, `идёт назад от первого дня`, `пропускает трижды упавший день`, `дошёл до 2025-01-01 — null`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `git commit -m "Продажи: догрузка истории 2025 по дню, когда очередь свободна"`.
- После деплоя: проверить первый загруженный день 2025 (оборот похож на правду); если Quick Resto не отдаёт старые смены — выключить догрузку и сказать Павлу.

---

### Task 10: Журнал и справка

**Files:**
- Modify: `src/lib/audit/format.tsx` или соседний файл (фразы `sales.plan.saved`, `sales.price_change.created|deleted`, `sales.seasonality.changed`), `src/lib/audit/action-categories.ts`, `docs/handbook/sales/statistics.md`, `docs/handbook/sales/shifts.md`, `docs/handbook/people/payroll.md`, `docs/handbook/people/roles.md` (право «Планы продаж»)

- [ ] **Step 1:** фразы и категории; `node --test` аудита — PASS.
- [ ] **Step 2:** справка: «План месяца» (где, как читается прогноз, цены, сезонность), KPI в течение месяца и по доле, напоминания 1-го/25-го, право «Планы продаж».
- [ ] **Step 3: Commit** `git commit -m "Журнал и справка: план месяца, цены, сезонность, KPI v2"`.

---

## После реализации

- Ревью всей ветки свежим рецензентом; все замечания исправить.
- PR в `main`; после «мержи»: миграция 418 на прод (`-U supabase_admin`, строка в журнале миграций), деплой, проверка: `sales.plan` у «Владельца»/«Директора», условия KPI старшего бармена на `alcohol_share`, первый день истории 2025.
