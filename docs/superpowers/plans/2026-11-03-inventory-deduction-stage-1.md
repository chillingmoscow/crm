# Удержание по недостаче (этапы 0 и 1): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sheerly считает удержание по недостаче за календарный месяц и ставит строку в свою зарплатную ведомость, а отдельный отчёт сличает результат с Google-таблицей.

**Architecture:** Расчёт — чистые функции над снимком (`src/lib/stock/`), поверх уже готового `allocateSharedShortage`. Данные собираются серверным слоем из проведённых актов инвентаризации (финализированные строки), синхронизированных актов списаний и смен месяца. Запись в ведомость — через RPC, по образцу журнала корректировок (миграция 248): `payroll_adjustments` с `kind='inventory'`, `medium='money'`, `approved=true`, отрицательной суммой и сторно вместо правки на месте.

**Tech Stack:** Next.js 15 (App Router, Server Actions), TypeScript 5 strict, Supabase/Postgres, zod, node:test (`*.test.mts`), pnpm.

**Spec:** [docs/superpowers/specs/2026-11-02-glide-n8n-cutover-design.md](../specs/2026-11-02-glide-n8n-cutover-design.md) — утверждён владельцем 3 ноября 2026. Разделы 1.1–1.9 описывают этап 1, «Этап 0» в разделе 8 — нумерацию миграций.

## Global Constraints

- Нумерация миграций линейная `NNN_*.sql`. После задачи 1 свободный номер — **307**; применённые миграции не редактируем и не переставляем.
- В каждой `create or replace function` в `public` — `set search_path = public, pg_catalog`.
- `auth.uid()` в RLS — только как `(select auth.uid())`.
- `create index` без `CONCURRENTLY`: миграции идут одной транзакцией.
- Композитный FK требует композитного индекса в том же порядке колонок.
- Тенантность новых таблиц: `account_id` + `unique (account_id, id)` + композитные FK от детей (`docs/CONVENTIONS.md`).
- Чистые модули в `src/lib/`, которые импортирует `node:test`, **не используют alias `@/...`** — раннер не резолвит tsconfig paths (образец: `src/lib/inventory/store-venue-binding.ts`).
- Лимит заведения: 10 000 ₽ за календарный месяц, **только на общий пул**. Для пулов подразделений и личных списаний покрытие ноль.
- Коэффициент всегда `1`, `split` всегда `once`: обе настройки владелец отменил.
- Суммы списаний округляются **вверх до рубля по каждой позиции** (командные и сотруднические). Для личных сохраняем прежнее округление до целого рубля.
- Ни одна задача не включает автоматические удержания на проде и не трогает n8n: `PAYROLL_BONUS_WRITES_ENABLED` и переключение исполнителя — вне этого плана.
- Обязательные проверки перед push: `pnpm exec tsc --noEmit` и `pnpm lint`.
- Каждая задача с видимым пользователю эффектом обновляет `docs/handbook/`.

## Review Focus

- **Сотрудник с нулём смен в подразделении.** Роль относится к подразделению, но смен в месяце нет: он не должен получить ни копейки от остатка, и остаток не должен раздаться остальным «за него». Тест — задача 3.
- **Граница месяца в таймзоне заведения.** Акт с бизнес-днём 31 октября, проведённый 1 ноября: попадает в октябрьское сальдо, а не в ноябрьское. Тест — задача 6.
- **Закрытый зарплатный период.** Пересчёт после фиксации месяца не может ни поставить, ни сторнировать строку в нём: это видимая ошибка, а не молчаливый пропуск. Тест — задача 7.
- **Переназначение склада посреди месяца.** Снимок фиксирует привязку на момент расчёта; пересчёт после переназначения меняет плательщика только вперёд, уже выплаченное сторнируется явно. Тест — задача 6.
- **Подмена подразделения одним человеком.** Смены в двух подразделениях дают два веса одного сотрудника; сумма по нему не задваивается и не теряется. Тест — задача 3.

---

### Задача 1: Нумерация миграций (этап 0)

**Files:**
- Rename: девять файлов `supabase/migrations/20[0-9]{12}_*.sql` → `298_…` … `306_…`
- Create: `scripts/renumber-timestamp-migrations.sql` (правка реестра для прода, **не применять**)
- Modify: `docs/superpowers/specs/2026-11-02-glide-n8n-cutover-design.md` (в разделе 4.1 и этапе 0 сказано «семь файлов» — их девять)

**Interfaces:**
- Consumes: ничего.
- Produces: свободный номер миграции **307** для задач 2 и 5.

Проверено 3 ноября: файлов девять, не семь (`20261101165423_staff_document_access.sql` и `20261101174630_staff_document_formats.sql` добавились позже редакции документа). Максимальный номер на `origin/main` — 297.

Зависимости проверены и их нет: `amount_rounding_scale` не упоминается ни в одной другой миграции; функции `candidate_delete_many`, `candidate_people_overview`, `staff_people_overview`, `get_staff_profile_identity`, `staff_change_document` в более поздних миграциях не используются; `profiles_gender_check` ограничивает только `public.profiles`, а поздние упоминания `gender` — чтение (213, 280) и другая таблица (292). Сид выставляет `male`/`female` и применяется после всех миграций.

- [ ] **Step 1: Переименовать девять файлов в хронологическом порядке их timestamp'ов**

```
20260301162546_027_gender_constraint.sql            → 298_gender_constraint.sql
20260509120000_account_amount_rounding.sql          → 299_account_amount_rounding.sql
20261030231538_candidate_bulk_delete.sql            → 300_candidate_bulk_delete.sql
20261031002045_integrations_recruiting_settings.sql → 301_integrations_recruiting_settings.sql
20261031144659_people_overviews.sql                 → 302_people_overviews.sql
20261031153759_recruiting_overview_funnel.sql       → 303_recruiting_overview_funnel.sql
20261031171241_staff_profile_identity.sql           → 304_staff_profile_identity.sql
20261101165423_staff_document_access.sql            → 305_staff_document_access.sql
20261101174630_staff_document_formats.sql           → 306_staff_document_formats.sql
```

Содержимое файлов не меняется. Переименование через `git mv`, чтобы история сохранилась.

- [ ] **Step 2: Прогнать чистую базу**

Run: `pnpm db:reset`
Expected: проходит до конца, включая `supabase/seed.sql`. До переименования падала на `301`-м файле (`alter table public.organization_telegram_settings`, таблица создаётся в `274_organization_telegram.sql`).

- [ ] **Step 3: Подготовить правку реестра для прода**

Создать `scripts/renumber-timestamp-migrations.sql`: по одной `update supabase_migrations.schema_migrations set version=… where version=…` на каждый файл, плюс `select` до и после для сверки количества строк. Реестр у нас пассивный (memory `prod_migration_drift_122`), повторного применения не будет.

В начале файла комментарием: применяется вручную по SSH после мержа, только с явного согласия владельца; если строки с прежней версией нет — вставить её, а не молча пропустить.

- [ ] **Step 4: Поправить документ**

В разделе 4.1 и в «Этапе 0» заменить «семь файлов» на девять, добавить два новых имени в список и указать итоговые номера 298–306.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations scripts/renumber-timestamp-migrations.sql docs/superpowers/specs/2026-11-02-glide-n8n-cutover-design.md
git commit -m "fix(db): линейная нумерация девяти timestamp-миграций"
```

---

### Задача 2: Привязка склада к подразделению (схема)

**Files:**
- Create: `supabase/migrations/307_store_department_binding.sql`
- Test: `supabase/tests/store_department_binding.sql`

**Interfaces:**
- Consumes: номер 307 из задачи 1.
- Produces: `public.stores.department_id uuid null`, `public.stores.department_scope text not null default 'unset'` со значениями `'unset' | 'shared' | 'department'`; таблица истории `public.store_department_history`; RPC `public.set_store_department(p_store_id uuid, p_scope text, p_department_id uuid) returns uuid`.

Три состояния из раздела 1.6 отдельной колонкой `department_scope`, потому что `department_id is null` не различает «ещё не настроено» и «явно общий», а от различия зависит, платит команда или расчёт неполный.

У `public.departments` сегодня **нет** `unique (account_id, id)` — только PK по `id` и `unique (account_id, name)`. Без него композитный FK невозможен, поэтому миграция добавляет его первым шагом.

- [ ] **Step 1: Написать SQL-тест**

```sql
-- supabase/tests/store_department_binding.sql
begin;
-- 1. scope='department' без department_id отклоняется
-- 2. scope='shared' с department_id отклоняется
-- 3. department чужого аккаунта отклоняется композитным FK
-- 4. set_store_department пишет строку в store_department_history с актором
-- 5. повторный вызов с теми же значениями истории не добавляет
-- 6. удаление подразделения переводит склад в 'unset', а не оставляет висячий id
rollback;
```

- [ ] **Step 2: Прогнать тест и убедиться, что падает**

Run: `pnpm db:reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/tests/store_department_binding.sql`
Expected: FAIL — колонок ещё нет.

- [ ] **Step 3: Написать миграцию**

Содержит: `alter table public.departments add constraint departments_account_id_unique unique (account_id, id)`; две колонки на `stores`; `check (department_scope in ('unset','shared','department') and (department_scope='department') = (department_id is not null))`; композитный FK `(account_id, department_id) → departments(account_id, id) on delete set null (department_id)` по образцу `stores_local_venue_tenant_fkey` из миграции 230; композитный индекс `(account_id, department_id) where department_id is not null`; триггер, переводящий scope в `'unset'` при обнулении `department_id`; таблицу истории с `account_id`, `store_id`, прежними и новыми значениями, `changed_by`, `changed_at`; RPC `set_store_department` с правом `inventory.manage_results` и `set search_path = public, pg_catalog`; RLS на историю по образцу `stock_deduction_rules` (миграция 286).

- [ ] **Step 4: Прогнать тест и убедиться, что проходит**

Run: та же команда, что в шаге 2
Expected: PASS, все шесть случаев.

- [ ] **Step 5: Прогнать advisors**

Expected: ни ошибок, ни предупреждений по новым объектам. INFO о неиспользованном индексе для новой таблицы ожидаем.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/307_store_department_binding.sql supabase/tests/store_department_binding.sql
git commit -m "feat(db): привязка склада к подразделению с историей"
```

---

### Задача 3: Месячное сальдо по пулам (чистый расчёт)

**Files:**
- Create: `src/lib/stock/monthly-shortage.ts`
- Test: `src/lib/stock/monthly-shortage.test.mts`

**Interfaces:**
- Consumes: `allocateSharedShortage`, `ShiftWeight`, `DeductionRules` из `./shared-shortage` и `./deduction-rules` (относительными путями, без alias).
- Produces:

```ts
export type PoolKind = "shared" | "department" | "personal";
export type PoolSource = {
  pool: PoolKind;
  /** Для "department" — id подразделения; для "personal" — id сотрудника; для "shared" — null. */
  key: string | null;
  /** Управленческая сумма источника: отрицательная — недостача, положительная — излишек. */
  amount: number;
  /** Устойчивый ID источника: акт инвентаризации или акт списания. */
  sourceRef: string;
};
export type MonthlyShortageInput = {
  sources: PoolSource[];
  config: DeductionRules;
  weights: ShiftWeight[];
  /** Источники, у которых пул не определён: непривязанный склад или неразнесённый акт. */
  unresolved: string[];
};
export function allocateMonthlyShortage(input: MonthlyShortageInput): {
  pools: Array<{
    pool: PoolKind;
    key: string | null;
    net: number;
    chargeable: number;
    company: number;
    employees: number;
    allocations: Array<{ employeeId: string; amount: number }>;
  }>;
  total: number;
  company: number;
  employees: number;
  unresolved: string[];
  state: "disabled" | "incomplete" | "ready";
};
```

Правила, которые закрывает эта функция (разделы 1.7 и 1.8 спеки): сальдо считается внутри пула; положительное сальдо пула обнуляется и **не** уменьшает другие пулы; лимит `config.companyAllowance` применяется только к пулу `shared`; пулы `department` и `personal` считаются с нулевым покрытием; непустой `unresolved` даёт `state: "incomplete"` без распределения.

- [ ] **Step 1: Написать падающие тесты**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateMonthlyShortage } from "./monthly-shortage.ts";

test("излишек пула сгорает и не уменьшает другие пулы", () => { /* кальяны +2000, общий −5000, лимит 0 → кальяны 0, общий 5000 */ });
test("лимит применяется только к общему пулу", () => { /* общий −12000, кальяны −3000, лимит 10000 → employees 2000 + 3000 */ });
test("сальдо пула считается по сумме источников", () => { /* −5000 и +2000 в общем пуле → 3000 */ });
test("сотрудник без смен в подразделении не получает ничего", () => { /* вес 0 → нет allocation, остаток не раздаётся */ });
test("подмена подразделения даёт два веса одного сотрудника", () => { /* 4 смены в баре + 6 в кальянах → суммы складываются, не задваиваются */ });
test("непривязанный источник делает месяц неполным", () => { /* unresolved непустой → state incomplete, allocations пустые */ });
test("выключенные правила отдают всё заведению", () => { /* enabled:false → employees 0, state disabled */ });
test("копейки раздаются по стабильному ключу", () => { /* 100.01 на трёх сотрудников — результат не зависит от порядка weights */ });
```

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `node --test --experimental-strip-types src/lib/stock/monthly-shortage.test.mts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `allocateMonthlyShortage`**

Для каждого пула: сумма `amount` источников, `Math.max(0, -net)` как `chargeable`, затем `allocateSharedShortage(chargeable, cfg, poolWeights)`. Для `shared` — `cfg = config`; для `department` — `{...config, companyAllowance: 0, distribution: "shifts"}` с весами только этого подразделения; для `personal` — сумма целиком на сотрудника из `key`, без калькулятора. `state` — `incomplete`, если непустой `unresolved` или любой пул вернул `incomplete`.
`allocateSharedShortage` умеет ещё `period_required` (это `split: "pending"` из легаси-версий правил); в новых правилах `split` всегда `once`, поэтому в наружный тип это состояние не выходит — если оно пришло, считаем его `incomplete`, а не тихо «готово».

- [ ] **Step 4: Прогнать тесты**

Run: `node --test --experimental-strip-types src/lib/stock/monthly-shortage.test.mts`
Expected: PASS, восемь тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stock/monthly-shortage.ts src/lib/stock/monthly-shortage.test.mts
git commit -m "feat(stock): месячное сальдо по пулам плательщиков"
```

---

### Задача 4: Интерфейс привязки складов

**Files:**
- Modify: `src/app/(dashboard)/org/stores/_components/stores-client.tsx`
- Modify: `src/app/(dashboard)/inventory/_actions/documents.ts` (рядом с `updateInventoryStoreVenue`, строка 182)
- Create: `src/lib/inventory/store-department-binding.ts`
- Test: `src/lib/inventory/store-department-binding.test.mts`
- Modify: `docs/handbook/org/index.md`

**Interfaces:**
- Consumes: RPC `set_store_department` из задачи 2.
- Produces: server action `updateInventoryStoreDepartment({ storeId, scope, departmentId })`; чистый хелпер `storeDepartmentBindingPatch` — по образцу `storeVenueBindingPatch`, чтобы синхронизация каталога Quick Resto не трогала колонку у существующего склада.

Владелец настраивает склады **по ходу** (раздел 1.6), поэтому «не задана» — рабочее состояние, видимое в списке, а не ошибка валидации.

- [ ] **Step 1: Написать падающий тест хелпера**

```ts
test("синхронизация не трогает привязку существующего склада", () => { /* storeExists:true → {} */ });
test("новый склад приезжает без подразделения", () => { /* storeExists:false → scope 'unset' */ });
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test --experimental-strip-types src/lib/inventory/store-department-binding.test.mts`
Expected: FAIL.

- [ ] **Step 3: Реализовать хелпер и server action**

Action валидирует, что подразделение принадлежит аккаунту (прецедент в `updateInventoryStoreVenue`: склад уезжал в заведение чужого аккаунта), вызывает RPC, делает `revalidatePath("/org/stores")`.

- [ ] **Step 4: Добавить выбор подразделения в список складов**

Три значения в одном селекте: «Не задано», «Общий склад», имя подразделения. Токены, размеры и отступы — из `docs/design-system.md` и `sheerly.pen` (node `Q4FzoZ`), своих не изобретать. Непривязанный склад помечается тем же приёмом, что уже используется для складов без заведения.

- [ ] **Step 5: Прогнать проверки**

Run: `node --test --experimental-strip-types src/lib/inventory/store-department-binding.test.mts && pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS без ошибок.

- [ ] **Step 6: Описать в справочнике и закоммитить**

В `docs/handbook/org/` — что означают три состояния привязки и почему склад без подразделения не даёт нулевого удержания. Языком пользователя, без имён колонок.

```bash
git add src/lib/inventory/store-department-binding.* "src/app/(dashboard)/org/stores/_components/stores-client.tsx" "src/app/(dashboard)/inventory/_actions/documents.ts" docs/handbook/org
git commit -m "feat(stores): выбор подразделения склада"
```

---

### Задача 5: Разнесение актов списаний по пулам

**Files:**
- Create: `supabase/migrations/308_writeoff_pool_assignment.sql`
- Create: `src/lib/stock/writeoff-pools.ts`
- Test: `src/lib/stock/writeoff-pools.test.mts`
- Modify: `src/app/(dashboard)/documents/writeoffs/writeoffs-client.tsx`, `src/app/(dashboard)/documents/writeoffs/actions.ts`
- Modify: `docs/handbook/documents/` (страница про списания)

**Interfaces:**
- Consumes: номера после задачи 2.
- Produces: таблица `public.writeoff_pool_assignments` с ключом `unique (account_id, venue_id, external_id)`; RPC `public.set_writeoff_pool(p_external_id text, p_pool text, p_key uuid)`; функция `writeoffPoolSources(docs, assignments, rules): PoolSource[]` для задачи 6.

Пометка живёт в **своей** таблице, а не в `stock_writeoff_documents`: зеркало переписывается синхронизацией (`payload`, `source_hash`, `version`, `missing_at`), и пометка внутри payload пропадёт при следующем чтении месяца (раздел 1.8). Ключ — внешний ID акта, чтобы пометка переживала и ресинк, и исчезновение акта из источника.

Уровень — акт, не позиция (решение из 1.8). `writeoffReasons` из правил — подсказка в интерфейсе, а не фильтр расчёта.

- [ ] **Step 1: Написать падающие тесты сборки источников**

```ts
test("сумма акта округляется вверх по каждой позиции", () => { /* 10,01 + 10,01 → 22, не 20,02 и не 21 */ });
test("личное списание округляется до целого рубля, а не вверх", () => { /* 10,40 → 10 */ });
test("неразнесённый акт попадает в unresolved, а не в общий пул", () => {});
test("черновик и исчезнувший акт в расчёт не идут", () => { /* только проведённые */ });
```

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `node --test --experimental-strip-types src/lib/stock/writeoff-pools.test.mts`
Expected: FAIL.

- [ ] **Step 3: Реализовать `writeoffPoolSources`**

Чистая функция без обращений к базе: на входе зеркальные акты, пометки пулов и правила, на выходе `PoolSource[]` и список неразнесённых. Округление вверх — по каждой позиции, а не по сумме акта.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test --experimental-strip-types src/lib/stock/writeoff-pools.test.mts`
Expected: PASS, четыре теста.

- [ ] **Step 5: Написать миграцию `308_writeoff_pool_assignment.sql`**

Таблица пометок, RPC `set_writeoff_pool` с `set search_path = public, pg_catalog`, RLS и отдельное право на разнесение. Пометка не удаляется вместе с актом, исчезнувшим из источника.

- [ ] **Step 6: Добавить разнесение в журнал списаний**

Колонка «Пул» и выбор в боковой карточке акта. Право — отдельное от `inventory.view_results`: разнесение меняет деньги сотрудников. Акты без пометки видны фильтром «не разнесены».

- [ ] **Step 7: Прогнать проверки**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: без ошибок.

- [ ] **Step 8: Описать в справочнике и закоммитить**

В `docs/handbook/documents/` — что такое пул, почему акт нужно разнести и что значит «месяц не посчитан». Языком пользователя.

```bash
git add supabase/migrations/308_writeoff_pool_assignment.sql src/lib/stock/writeoff-pools.* "src/app/(dashboard)/documents/writeoffs" docs/handbook/documents
git commit -m "feat(writeoffs): разнесение актов по пулам плательщиков"
```

---

### Задача 6: Сбор снимка месяца

**Files:**
- Create: `src/lib/stock/monthly-snapshot.ts`
- Test: `src/lib/stock/monthly-snapshot.test.mts`

**Interfaces:**
- Consumes: `calculateManagementTotals`, `applyResortSnapshot`, `applyResortItemSnapshot` из `src/lib/inventory/results.ts` и `results-snapshot.ts`; `writeoffPoolSources` из задачи 5; `set_store_department`-колонки из задачи 2.
- Produces: `buildMonthlySnapshot(db, { accountId, venueId, month }): Promise<MonthlyShortageInput & { ruleVersionId: string; capturedAt: string; storeBindings: Array<{storeId: string; scope: string; departmentId: string | null}> }>`.

Сумма акта берётся по **финализированным** строкам и активным пересортам, а не из `qr_shortfall_sum` (разделы 1.6, 225, 234). Смена считается, если по этому сотруднику и бизнес-дню есть `payroll_accruals` — тогда знаменатель распределения совпадает с тем, за что заплатили. Подразделение и роль смены берутся из `schedule_shifts` через `payroll_attendance.shift_id`; если роль не определилась, источник уходит в `unresolved`, а не получает роль по умолчанию.

Снимок фиксирует привязки складов, состав смен и `ruleVersionId`: переназначение склада не должно задним числом менять плательщика (1.6).

- [ ] **Step 1: Написать падающие тесты на чистых хелперах снимка**

```ts
test("бизнес-день определяет месяц, а не дата проведения", () => { /* акт 31.10, проведён 01.11, таймзона заведения → октябрь */ });
test("исключённая позиция не входит в недостачу", () => {});
test("активный пересорт уменьшает недостачу внутри акта", () => {});
test("склад без подразделения даёт unresolved", () => {});
test("смена без роли даёт unresolved, а не роль по умолчанию", () => {});
test("снимок фиксирует привязку склада на момент расчёта", () => { /* привязка в снимке, а не чтение на лету: пересчёт со старым снимком даёт прежнего плательщика */ });
```

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `node --test --experimental-strip-types src/lib/stock/monthly-snapshot.test.mts`
Expected: FAIL.

- [ ] **Step 3: Реализовать сборку**

Запросы читают только проведённые акты месяца. Чистые хелперы (месяц по бизнес-дню, сборка `ShiftWeight[]`, перевод строк акта в `PoolSource`) выносятся в тот же файл без импортов `@/...`, чтобы тест их видел; работа с базой — отдельной функцией, принимающей `LooseDb`.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test --experimental-strip-types src/lib/stock/monthly-snapshot.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

---

### Задача 7: Постановка строки в ведомость

**Files:**
- Create: `supabase/migrations/309_inventory_deduction_lines.sql`
- Create: `src/app/(dashboard)/inventory/_actions/deduction.ts`
- Test: `supabase/tests/inventory_deduction_lines.sql`
- Modify: `src/app/(dashboard)/inventory/_actions/results.ts` (вызов после `finalizeInventoryResults`, строка 238)

**Interfaces:**
- Consumes: `allocateMonthlyShortage` (задача 3), `buildMonthlySnapshot` (задача 6).
- Produces: RPC `public.post_inventory_deduction(p_venue uuid, p_month date, p_lines jsonb, p_snapshot jsonb) returns jsonb`; server action `recalculateInventoryDeduction({ venueId, month })`.

Как пишем, проверено по миграции 248: `kind='inventory'`, `medium='money'` (иначе расчёт пропустит строку — `calculate.ts:156`), `approved=true` (неподтверждённая строка даёт `issues`, а не сумму), сумма **отрицательная** (`kind='deduction'` в журнале хранится как `-round(amt,2)`), `managed=true`, `request_key` как ключ идемпотентности — на `(account_id, request_key)` уже есть уникальный индекс `payroll_adjustments_request`.

Утверждения нет, строка ставится сразу (раздел 1.9). Поэтому ставится **только** `state: "ready"`; `incomplete` строк не пишет и возвращает перечень недостающего.

Пересчёт месяца сторнирует прежние строки (`deleted_at`, `delete_reason`) и ставит новые — правки на месте нет (1.4). Закрытый период (`payroll_periods.status <> 'draft'`) не вскрываем: строка уходит в ближайший открытый месяц со ссылкой на исходный, а при невозможности — явная ошибка.

- [ ] **Step 1: Написать SQL-тест**

```sql
begin;
-- 1. повторный вызов с тем же request_key не задваивает строку
-- 2. строка пишется с medium='money', approved=true, отрицательной суммой
-- 3. пересчёт месяца сторнирует прежние строки, а не правит их
-- 4. зафиксированный период: вызов не меняет строки в нём и возвращает ошибку
-- 5. state incomplete: не пишется ни одной строки
-- 6. права: пользователь без права на удержания получает отказ
rollback;
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Expected: FAIL — RPC нет.

- [ ] **Step 3: Написать миграцию с RPC и журналом снимков**

Таблица снимков расчёта хранит `account_id`, `venue_id`, `month`, `rule_version_id`, `captured_at`, `snapshot jsonb`, `state`, автора — чтобы потом было видно, из чего получилась выплаченная сумма.

- [ ] **Step 4: Реализовать server action и подключить к финализации**

Вызов после успешного проведения в Quick Resto и локальной финализации, в той же транзакции состояния, что ставит `results_finalized_at`. Уважает полусбойное состояние и `reopenInventoryResults` (раздел 1.5): повтор идемпотентен, переоткрытие сторнирует.

- [ ] **Step 5: Уведомление о резком отклонении месяца**

Раздел 1.9: между ошибочным актом и ведомостью больше нет человека, поэтому отклонение месячной суммы от обычной даёт уведомление, но **не** блокирует постановку. Порог — доля от медианы последних трёх посчитанных месяцев; при меньшем числе месяцев уведомление не отправляется вовсе, а не считается от одного значения. Получатели — те, у кого есть право на удержания.

Тест: `src/lib/stock/deduction-anomaly.test.mts` — «два месяца истории не дают уведомления», «превышение порога даёт уведомление», «уведомление не отменяет постановку строки».

- [ ] **Step 6: Прогнать проверки**

Run: SQL-тест, `node --test --experimental-strip-types src/lib/stock/deduction-anomaly.test.mts`, затем `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

---

### Задача 8: Сличающий отчёт против Google-таблицы

**Files:**
- Create: `src/app/(dashboard)/inventory/deduction/page.tsx`, `_components/deduction-report.tsx`
- Create: `src/lib/stock/deduction-reconciliation.ts`
- Test: `src/lib/stock/deduction-reconciliation.test.mts`
- Modify: `docs/handbook/inventory/` (новая страница про удержание)

**Interfaces:**
- Consumes: снимок и строки из задач 6 и 7.
- Produces: `reconcileDeduction(sheerly, sheet): Array<{ employeeId: string; sheerly: number | null; sheet: number | null; delta: number | null }>`.

Отчёт поимённо сличает расчёт Sheerly с колонкой I таблицы. Колонку I **не меняем** и обратного моста не строим: в ноябре платят по таблице (раздел 1.1). Источник живой — октябрь уже сдвинулся с 5 339 ₽ на 6 039 ₽, поэтому отчёт показывает обе суммы с отметкой момента снятия.

- [ ] **Step 1: Написать падающие тесты**

```ts
test("сотрудник есть в Sheerly, но нет в таблице — расхождение, а не ноль", () => {});
test("неизвестная сумма не подменяется нулём", () => { /* null остаётся null */ });
test("совпадение до копейки даёт нулевую дельту", () => {});
test("отметка момента снятия сохраняется в результате", () => {});
```

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `node --test --experimental-strip-types src/lib/stock/deduction-reconciliation.test.mts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `reconcileDeduction`**

Объединение по сотруднику внешним соединением: сотрудник, которого нет с одной из сторон, попадает в результат с `null`, а не выпадает из отчёта.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test --experimental-strip-types src/lib/stock/deduction-reconciliation.test.mts`
Expected: PASS, четыре теста.

- [ ] **Step 5: Собрать страницу отчёта**

Таблица по чек-листу `feedback_table_standardization_checklist`: `h1 text-3xl/bold`, контролы как в FinanceDemo, без saved-views и inbox-sort, если не просили.

- [ ] **Step 6: Описать в справочнике и закоммитить**

Страница в `docs/handbook/inventory/` — что такое строка «списание по недостаче», откуда берётся сумма, почему месяц может быть «не посчитан».

---

## Что в этот план не входит

- Отказ от Adesk и финансовые цепочки: владелец выбрал вариант B (раздел 7).
- Создание и проведение актов списаний в Sheerly: для удержания не требуется (1.6).
- Агент-классификатор списаний: занесён в `BACKLOG.md`.
- Включение автоматических удержаний на проде и выключение сценария `Учет списаний и инвентаризаций`: по разделу 6.1 этап 1 остаётся режимом сравнения, пока владелец не скажет иначе.
