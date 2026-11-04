# Этап 2: единый список исключений и доли подразделений — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исключения из недостачи — один управляемый список (группы, подгруппы, товары), реально влияющий на итоги актов и удержание; доли распределения — на странице подразделения.

**Architecture:** Расширяем `inventory_result_exclusion_rules` видом цели (`product` / `group` / `legacy_name`). Сопоставление строки акта с правилом выносим в чистую функцию, которую используют импорт, страница итогов и удаление правила. Создание/удаление правила ретроактивно правит строки актов незафиксированных месяцев (живые и `finalized_*` поля) и запускает пересчёт удержания. Доли остаются в версиях `stock_deduction_rules` (формат не меняется), меняется только место редактирования.

**Tech Stack:** Next.js 15 server actions, Supabase/Postgres, React 19, shadcn/ui, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-04-deduction-exclusions-and-shares-design.md`

## Global Constraints

- Ветка от `origin/main`, PR `--base main`. Перед выбором номера миграции — `git fetch origin main`; на момент плана последняя — `309_inventory_deduction_lines.sql`, значит `310_…`, `311_…`.
- В каждой `create or replace function` — `set search_path = public, pg_catalog`; `auth.uid()` в RLS — как `(select auth.uid())`; индексы без `CONCURRENTLY`; композитный FK `(account_id, X)` + композитный индекс `(account_id, X)`.
- Права: смотреть — `inventory.view_results`; менять — `inventory.adjust_results`; доли — те же права, что у `saveStockRules`.
- «Месяц зафиксирован» = есть `payroll_periods` с `venue_id` акта, `month` = бизнес-месяц акта, `status <> 'draft'`.
- Бизнес-месяц акта = `businessMonthOf(documents.invoice_date, venue.timezone)` из `src/lib/stock/monthly-snapshot.ts`.
- Тексты UI — по-русски, sentence case; токены/отступы — `docs/design-system.md`; мобильная вёрстка — `docs/mobile-web.md`.
- Обязательные проверки: `pnpm exec tsc --noEmit`, `pnpm lint`, `node --test --experimental-strip-types "src/**/*.test.mts"`.
- Handbook: `docs/handbook/inventory/deduction.md`, `docs/handbook/inventory/exclusions.md`, `docs/handbook/people/` (страница подразделения).

## Review Focus

1. Товар в группе, вложенной в исключённую группу (подгруппа подгруппы) — должен исключаться. Тест в Task 2.
2. Строка, на которой проверяющий нажал «Учитывать в этом акте» (`exclusion_rule_dismissed_at`), или исключённая вручную, или в активном пересорте — ретроактивное применение её не трогает. Тест в Task 4.
3. Акт зафиксированного месяца — ни создание, ни удаление правила его не меняют. Тест в Task 4.
4. Удаление группового правила из акта: пункт «Удалить автоисключение» в акте не должен молча удалять правило целой группы. Тест в Task 3.
5. Одна и та же цель дважды (повторное добавление группы/товара) — понятная ошибка, а не 500 на уникальном индексе. Тест в Task 5.

---

### Task 1: Миграция — виды цели правила и перенос названий из Glide

**Files:**
- Create: `supabase/migrations/310_exclusion_rule_targets.sql`
- Create: `supabase/migrations/311_exclusion_rules_from_glide.sql`
- Modify: `src/types/database.ts` (блок `inventory_result_exclusion_rules`, точечно, без полного regen)
- Test: `supabase/tests/exclusion_rule_targets.sql`

**Interfaces:**
- Produces: колонки `target_kind text not null default 'product' check in ('product','group','legacy_name')`, `ingredient_group_id uuid null`, `external_group_id text null`; `metadata.source` ∈ `'act' | 'manual' | 'glide'`.

- [ ] **Step 1:** 310: добавить колонки; FK `(account_id, ingredient_group_id)` → `ingredient_groups(account_id, id) on delete cascade` (если у `ingredient_groups` нет `unique (account_id, id)` — добавить); индекс `(account_id, ingredient_group_id)`; заменить check `inventory_result_exclusion_rules_product_required` на check по виду: `product` → `ingredient_id or external_product_id`; `group` → `ingredient_group_id not null`, товарные поля null; `legacy_name` → все id null. Частичный уникальный индекс активной группы `(account_id, ingredient_group_id) where status='active' and target_kind='group'`; для `legacy_name` — `(account_id, lower(product_name)) where status='active' and target_kind='legacy_name'`. Существующие уникальные индексы ограничить `target_kind='product'`. Колонка `product_name` остаётся «название на момент создания» для всех видов.
- [ ] **Step 2:** 311 (идемпотентно, `on conflict do nothing` через проверку `not exists`): для каждого аккаунта взять `config->'inventoryExclusions'` последней версии `stock_deduction_rules` каждого заведения; имя нормализовать `lower(btrim(...))`. Ровно одна группа с таким именем → правило `group`. Иначе ровно один товар (`ingredients`, включая архивные) → `product`, если такого активного правила ещё нет. Иначе → `legacy_name`. `metadata = {"source":"glide","retro_applied_at":null}`, `reason = 'Перенесено из Glide'`, `created_by = null`. Строки актов здесь НЕ трогать — это сделает Task 4 при первом применении (см. Task 8).
- [ ] **Step 3:** SQL-тест: вставка группового правила без `ingredient_group_id` падает; второе активное правило на ту же группу падает; `legacy_name` с id падает.
- [ ] **Step 4:** `pnpm db:reset` локально проходит; тест зелёный.
- [ ] **Step 5:** Commit.

### Task 2: Чистое сопоставление строки с правилом

**Files:**
- Create: `src/lib/inventory/exclusion-rules.ts`
- Test: `src/lib/inventory/exclusion-rules.test.mts`

**Interfaces:**
- Produces:
  ```ts
  export type ExclusionRuleRow = { id: string; target_kind: "product" | "group" | "legacy_name"; ingredient_id: string | null; external_product_id: string | null; ingredient_group_id: string | null; product_name: string; reason: string | null; created_by: string | null; created_at: string };
  export type GroupNode = { id: string; parent_group_id: string | null };
  export type ExclusionMatcher = (line: { ingredientId: string | null; externalProductId: string | null; groupId: string | null }) => ExclusionRuleRow | null;
  export function buildExclusionMatcher(rules: ExclusionRuleRow[], groups: GroupNode[]): ExclusionMatcher;
  export function groupDescendants(groupId: string, groups: GroupNode[]): Set<string>;
  ```
  Без импортов `@/…` (node:test).

- [ ] **Step 1: тесты** — `matches product rule by ingredient id`; `falls back to external product id`; `matches group rule for product in subgroup of subgroup`; `product rule wins over group rule`; `nearest group wins over ancestor group`; `legacy_name never matches`; `cycle in parent chain does not hang` (A→B→A → результат null без зависания); `null groupId matches only product rules`.
- [ ] **Step 2:** запустить — FAIL (нет модуля).
- [ ] **Step 3:** реализовать: подъём по `parent_group_id` с множеством посещённых.
- [ ] **Step 4:** `node --test --experimental-strip-types src/lib/inventory/exclusion-rules.test.mts` — PASS.
- [ ] **Step 5:** Commit.

### Task 3: Подключить сопоставление в импорт, итоги акта и удаление из акта

**Files:**
- Modify: `src/app/(dashboard)/inventory/actions-shared.ts` (`syncDocumentItems`, ~стр. 899–1010; тип `InventoryExclusionRuleLookup`)
- Modify: `src/app/(dashboard)/documents/inventory/[id]/results/page.tsx` (~стр. 167–310)
- Modify: `src/app/(dashboard)/inventory/_actions/exclusions.ts` (`deleteInventoryResultExclusionRule`, поиск правила ~стр. 1305 в actions-shared)
- Modify: компонент меню строки итогов (найти по «Удалить автоисключение»)
- Test: `src/lib/inventory/exclusion-rules.test.mts` (дополнить)

**Interfaces:**
- Consumes: `buildExclusionMatcher` (Task 2).
- Produces: `loadExclusionMatcher(admin: LooseDb, accountId: string): Promise<ExclusionMatcher>` в `actions-shared.ts` — грузит активные правила и `ingredient_groups(id,parent_group_id)`; `groupId` строки — `ingredients.group_id` по `ingredient_id`.

- [ ] **Step 1:** тест `rule kind is exposed so act menu can tell group rules apart` (матчер возвращает `target_kind: "group"`).
- [ ] **Step 2:** заменить три локальных map-сопоставления на `loadExclusionMatcher`. В `syncDocumentItems` и на странице итогов `groupId` берётся из `ingredients.group_id` (одним запросом по ingredient_id строк акта).
- [ ] **Step 3:** на странице итогов отдавать в строку `exclusionRuleKind` и `exclusionRuleName`. В меню строки: для `product` — как сейчас; для `group` — вместо «Удалить автоисключение» неактивный пункт «Исключено группой «{name}» — изменить в настройках заведения». `deleteInventoryResultExclusionRule` отказывает с ошибкой «Правило группы удаляется в списке исключений заведения», если правило строки — групповое. «Учитывать в этом акте» (dismiss) работает для обоих видов.
- [ ] **Step 4:** tsc + lint + тесты inventory — PASS.
- [ ] **Step 5:** Commit.

### Task 4: Ретроактивное применение и снятие правила

**Files:**
- Create: `src/lib/inventory/exclusion-retro.ts`
- Test: `src/lib/inventory/exclusion-retro.test.mts`
- Create: `src/app/(dashboard)/inventory/exclusion-retro-service.ts` (server-only)
- Modify: `src/app/(dashboard)/inventory/deduction-service.ts` — новый вариант триггера

**Interfaces:**
- Produces (чистое):
  ```ts
  export type RetroLine = { id: string; documentId: string; excluded: boolean; ruleId: string | null; dismissedAt: string | null; inActiveResort: boolean; finalized: boolean };
  export type RetroPatch = { id: string; documentId: string; exclude: boolean; finalized: boolean };
  export function planApply(ruleId: string, lines: RetroLine[], lockedDocumentIds: Set<string>): RetroPatch[];
  export function planRemove(ruleId: string, lines: RetroLine[], lockedDocumentIds: Set<string>): RetroPatch[];
  ```
- Produces (сервер): `applyExclusionRuleRetro(input: { admin: LooseDb; accountId: string; userId: string; ruleId: string; mode: "apply" | "remove" }): Promise<{ touchedDocuments: number; months: Array<{ venueId: string; month: string }> }>`.
- Produces (триггер): `AutoDeductionTrigger` += `{ kind: "months"; items: Array<{ venueId: string; month: string }> }` — пересчёт каждого месяца через существующий `runRecalculation`.

- [ ] **Step 1: тесты** — `apply skips line dismissed from rule`; `apply skips manually excluded line` (`excluded && ruleId === null`); `apply skips line in active resort`; `apply skips locked documents`; `apply marks finalized line with finalized=true`; `apply is idempotent for line already excluded by this rule`; `remove clears only lines of this rule and not in locked documents`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать чистые функции.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** сервис: найти строки — `document_items` аккаунта, сопоставленные этим правилом через матчер из Task 3 (для `apply`) или по `exclusion_rule_id` (для `remove`); `lockedDocumentIds` — акты, чей бизнес-месяц зафиксирован (Global Constraints). Патч: `exclude` → `excluded_from_totals`, `exclude_reason = rule.reason ?? 'Исключать всегда'`, `excluded_at = now`, `excluded_by = userId`, `exclusion_rule_id`; снятие — обнулить те же поля. Если `finalized` — то же значение в `finalized_excluded_from_totals`. По акту — событие `persistent_exclusion_enabled|disabled` в `inventory_result_events` (payload `{ ruleId, retro: true, lines: n }`). Проставить `metadata.retro_applied_at = now`. Вернуть месяцы затронутых **подведённых** актов; вызвать `autoRecalculateInventoryDeduction({ kind: "months", items })`.
- [ ] **Step 6:** существующие `createInventoryResultExclusionRule` / `bulkCreate…` / `delete…` тоже вызывают `applyExclusionRuleRetro` (сейчас они правят только строку открытого акта / снимают по всем актам без учёта фиксации). `delete…` перестаёт снимать строки в зафиксированных месяцах.
- [ ] **Step 7:** tsc + lint + тесты — PASS. Commit.

### Task 5: Серверные действия списка исключений

**Files:**
- Create: `src/app/(dashboard)/inventory/_actions/exclusion-list.ts`
- Test: `src/lib/inventory/exclusion-rules.test.mts` (дополнить) — для чистого хелпера дубля

**Interfaces:**
- Produces:
  ```ts
  export type ExclusionListItem = { id: string; kind: "product" | "group" | "legacy_name"; name: string; path: string | null; productCount: number | null; source: "act" | "manual" | "glide"; createdByName: string | null; createdAt: string };
  export type ExclusionCandidate = { kind: "product" | "group"; id: string; name: string; path: string | null; productCount: number | null };
  export async function listExclusionRules(): Promise<{ items: ExclusionListItem[]; canEdit: boolean } | { error: string }>;
  export async function searchExclusionCandidates(query: string): Promise<ExclusionCandidate[]>; // ≤ 30, группы первыми
  export async function addExclusionRule(input: { kind: "product" | "group"; id: string; replacesLegacyId?: string }): Promise<{ error: string | null; notice?: string | null }>;
  export async function removeExclusionRule(input: { ruleId: string; reason: string }): Promise<{ error: string | null; notice?: string | null }>;
  export async function applyPendingExclusionRules(): Promise<{ error: string | null; notice?: string | null }>; // ретро для product/group, у которых metadata.retro_applied_at = null; после — проставить дату
  export function duplicateTarget(rules: ExclusionRuleRow[], target: { kind: "product" | "group"; id: string }): ExclusionRuleRow | null; // в exclusion-rules.ts
  ```
- Consumes: `applyExclusionRuleRetro` (Task 4).

- [ ] **Step 1:** тест `duplicateTarget finds active rule for same group` и `… for same product`.
- [ ] **Step 2:** реализовать действия. `addExclusionRule` при дубле → `{ error: "«{name}» уже в списке исключений" }`. `replacesLegacyId` — после создания пометить `legacy_name` как `deleted` с `delete_reason = 'Сопоставлено'`. `removeExclusionRule` для `legacy_name` — просто `deleted`, без ретро. `metadata.source = 'manual'`; правила из акта получают `'act'` (дописать в Task 4/Step 6 местах создания). `path` группы — имена предков через « → ».
- [ ] **Step 3:** tsc + lint + тесты — PASS. Commit.

### Task 6: Окно «Исключения» во вкладке заведения

**Files:**
- Create: `src/app/(dashboard)/org/venues/[venueId]/_components/exclusions-sheet.tsx`
- Modify: `src/app/(dashboard)/org/venues/[venueId]/_components/stock-settings-tab.tsx` — убрать textarea и `inventoryExclusions` из `lists` (значение `config.inventoryExclusions` переносится в версию как есть, не редактируется)

**Interfaces:**
- Consumes: всё из Task 5.

- [ ] **Step 1:** строка «Исключения · N» + кнопка «Открыть» (N = активные `product`+`group`). Sheet справа, на мобиле — снизу.
- [ ] **Step 2:** в окне: комбобокс поиска (debounce 250 мс, `searchExclusionCandidates`), у группы — путь и «N товаров»; список правил с иконкой вида, названием, путём, источником («из акта» / «вручную» / «из Glide»), автором и датой, кнопка удаления → диалог с обязательным основанием. Блок «Не найдено в Quick Resto» с `legacy_name`: «Сопоставить» (тот же поиск, `replacesLegacyId`) и «Удалить». Если есть правила с `retro_applied_at = null` — плашка «N перенесённых исключений ещё не применены к прошлым актам» с кнопкой «Применить» (`applyPendingExclusionRules`, подтверждение: «Акты незакрытых месяцев будут пересчитаны»). Пустые состояния. Тосты: ошибка → `toast.error`, `notice` → `toast.message`. Без прав на изменение — только просмотр.
- [ ] **Step 3:** проверить в браузере на локальной БД: добавить группу, увидеть строки акта исключёнными, удалить, сопоставить legacy-имя; мобильная ширина 375.
- [ ] **Step 4:** tsc + lint. Commit.

### Task 7: Доли на странице подразделения, сводка в заведении

**Files:**
- Create: `src/app/(dashboard)/people/departments/[id]/_components/department-shortage-block.tsx`
- Modify: `src/app/(dashboard)/people/departments/[id]/_components/department-detail-page.tsx` (вкладка «Основное»), `…/[id]/page.tsx` (загрузить `loadStockRules(department.venue_id)`)
- Modify: `src/app/(dashboard)/org/venues/[venueId]/_components/stock-settings-tab.tsx` — редактирование групп и «Не участвуют» убрать, оставить сводку
- Create: `src/lib/stock/department-shares.ts`
- Test: `src/lib/stock/department-shares.test.mts`

**Interfaces:**
- Produces:
  ```ts
  export type DepartmentShare = { departmentId: string; participates: boolean; share: number };
  export function sharesFromRules(rules: DeductionRules, departmentIds: string[]): DepartmentShare[];
  export function rulesWithShares(rules: DeductionRules, shares: DepartmentShare[], names: Map<string, string>): DeductionRules; // одна группа на подразделение (id группы сохраняется, если подразделение уже было в группе), не участвующие — в excludedDepartmentIds, share 0 не пишется в группы
  export function sharesTotal(shares: DepartmentShare[]): number;
  ```
- Consumes: `loadStockRules`, `saveStockRules` (`src/app/(dashboard)/documents/writeoffs/rule-actions.ts`), `deductionRulesSchema`.

- [ ] **Step 1: тесты** — `round-trips current prod config` (Бар 55 / Менеджеры 35 / Кальяны 10 / Вспомогательный не участвует → те же группы и excludedDepartmentIds); `keeps group id for existing department`; `non-participating department goes to excludedDepartmentIds`; `throws when a group holds several departments` с сообщением «Группа объединяет несколько подразделений» (на проде таких нет; защищаемся от молчаливой порчи); `sharesTotal sums participating only`.
- [ ] **Step 2:** FAIL → реализовать → PASS.
- [ ] **Step 3:** блок «Недостача» на странице подразделения: «Участвует в общей недостаче» (Switch), «Доля, %»; при изменении раскрывается таблица долей всех подразделений заведения (редактируемая), «Всего N из 100%», «Применять с», «Основание», «Сохранить». Сохранение — `saveStockRules` с `rulesWithShares(...)`. Ошибка схемы («Сумма долей… 100%») — тостом. Нет прав — только просмотр.
- [ ] **Step 4:** вкладка заведения: таблица «Подразделение — доля — участвует» со ссылками на `/people/departments/{id}`, «Всего N из 100%», предупреждение при ≠ 100% или при архивном подразделении в группах.
- [ ] **Step 5:** tsc + lint + тесты. Проверить в браузере. Commit.

### Task 8: Справка, прод, сверка октября

**Files:**
- Modify: `docs/handbook/inventory/deduction.md`, `docs/handbook/inventory/exclusions.md`, страница подразделения в `docs/handbook/people/`
- Modify: `BACKLOG.md` (закрыть два пункта этапа)

- [ ] **Step 1:** справка: список исключений (группы/подгруппы/товары, действие на незакрытые месяцы, блок «Не найдено»), групповое правило в меню акта, доли на странице подразделения.
- [ ] **Step 2:** полный прогон проверок; PR `--base main`; ревью-замечания; мерж — только по команде владельца.
- [ ] **Step 3 (после мержа, с согласия владельца):** применить 310, 311 на проде (stdin, без `-1`), вписать в `supabase_migrations.schema_migrations`; деплой через Coolify; владелец нажимает «Применить» в окне исключений (перенесённые правила применяются к актам незакрытых месяцев); сопоставляет оставшиеся «Не найдено»; пересчитать октябрь и сверить с таблицей на странице «Удержание по недостаче».
