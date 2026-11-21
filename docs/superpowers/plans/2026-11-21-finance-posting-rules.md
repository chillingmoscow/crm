# Правила разнесения операций — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Финансы → Правила»: пользователь заводит правила «если все условия — заполнить статью / контрагента / заведение», и они подставляют пустые поля при ручном вводе операции.

**Architecture:** Одна таблица правил аккаунта (условия — jsonb-список «поле / оператор / значение», действия — три колонки с композитными FK). Вычислитель правил — чистая TS-функция, её зовут форма операции (этап 1), массовое применение (этап 2) и банковский воркер (этап 3). CRUD — server actions + `writeAuditEvent`, порядок — RPC одной транзакцией.

**Tech Stack:** Next.js 15 server actions, Supabase/Postgres RLS, shadcn/ui, `@dnd-kit/sortable`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-finance-posting-rules-design.md`

## Дорожная карта (memory `feedback_staged_master_plan`)

| Этап | Что | Статус |
| --- | --- | --- |
| 1 | Таблица, право, страница «Правила», вычислитель, подстановка при ручном вводе, handbook | этот план |
| 2 | «Применить к существующим» (предпросмотр, снятие галочек, одна строка журнала `finance.posting_rule.applied`, по образцу `finance_bulk_update_transactions`); «Создать правило по этой операции» в панели операции; перенос правил Павла из Adesk со сведением дублей | детализировать после этапа 1 |
| 3 | Применение к `source = 'bank_sync'`; банковские условия (назначение платежа, ИНН и счёт плательщика); действия «не загружать / удалить», «сделать переводом»; происхождение поля у операций без формы | сначала спросить Павла о состоянии интеграции с Codex |

## Предусловия этапа 1

- PR #691 (`claude/transactions-page-audit-e3440b`) смержен в `main`: он переписывает `transaction-form-sheet.tsx`, `transactions/page.tsx`, добавляет `finance_transaction_lock`. До мержа код не начинать.
- Ветка от свежего `origin/main`; номер миграции — следующий после `git ls-tree --name-only origin/main supabase/migrations/ | tail -1`. Ниже он обозначен `NNN`.

## Global Constraints

- Правило заполняет **только пустые поля**; заведение, подставленное фильтром страницы, считается пустым; выбранное человеком (включая «Без заведения») не трогается.
- Условия соединяются только «И». Переводы (`type = 'transfer'`) правилами не разносятся.
- Каждое поле заполняет **первое сверху** подходящее правило, где есть это действие. Выключенные правила не участвуют.
- Два прохода: сначала действие «контрагент», затем статья и заведение по уже известному контрагенту.
- Правило, ссылающееся на архивную/удалённую статью, контрагента, заведение, счёт или группу, не срабатывает и в списке помечено «Требует внимания».
- Действие «заведение» пропускается, если заведение недоступно пользователю в форме; статья и контрагент при этом подставляются.
- Видеть правила — `finance.view_transactions`; настраивать — новое право `finance.manage_posting_rules` («Настраивать правила разнесения»).
- Архива у правил нет: переключатель «выключено» + удаление с подтверждением.
- Журнал: `finance.posting_rule.created / updated / deleted / reordered`; одна строка на команду.
- Миграции: `set search_path = public, pg_catalog` в каждой функции, `(select auth.uid())` и `(select has_permission(...))` в RLS, одна permissive-политика на `(role, action)`, GRANT/REVOKE проверяются в той же миграции (CLAUDE.md, раздел миграций).
- UI — по `docs/design-system.md` и чек-листу таблиц (h1 36px без описания, инструменты в нижней строке шапки, `PageFrame`, `TableControlPin`).
- Тексты — пользовательские, по-русски, без технических имён.

## Review Focus

1. Ссылка правила стала архивной (статью убрали в архив) → правило не срабатывает, в списке «Требует внимания». Тест: Task 1 `skips rule referencing inactive id`.
2. Человек выбрал контрагента, правило подставило статью; потом контрагент сменился на того, под кого правил нет → статья, подставленная правилом, очищается; выбранная руками — остаётся. Тест: Task 3 `clears rule-filled field when rule stops matching`, `keeps user field`.
3. Заведение из фильтра страницы заменяется правилом; «Без заведения», выбранное руками, — нет. Тест: Task 3 `replaces filter venue`, `keeps user-chosen empty venue`.
4. Сотрудник одного заведения: правило ставит чужое заведение → только заведение пропущено. Тест: Task 1 `skips venue action outside allowed venues`.
5. Тип операции сменили с расхода на приход: статья расхода, подставленная правилом, уходит; описание с другим регистром/двойными пробелами совпадает. Тесты: Task 3 `type switch clears mismatched rule category`, Task 1 `description match ignores case and spaces`.

---

### Task 1: Типы и вычислитель правил

**Files:**
- Create: `src/lib/finance/posting-rules/types.ts`
- Create: `src/lib/finance/posting-rules/evaluate.ts`
- Test: `src/lib/finance/posting-rules/evaluate.test.mts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export type PostingRuleCondition =
  | { field: "counterparty"; op: "in" | "not_in"; ids: string[] }
  | { field: "counterparty_group"; op: "in"; ids: string[] }
  | { field: "counterparty_inn"; op: "eq"; value: string }
  | { field: "bank_account"; op: "in"; ids: string[] }
  | { field: "type"; op: "eq"; value: "income" | "expense" }
  | { field: "amount"; op: "between"; min: number | null; max: number | null }
  | { field: "description"; op: "contains" | "not_contains" | "eq" | "starts_with"; value: string };

export type PostingRuleActionField = "category_id" | "counterparty_id" | "venue_id";
export type PostingRuleActions = Partial<Record<PostingRuleActionField, string | null>>;

export type PostingRule = {
  id: string; name: string | null; position: number; enabled: boolean;
  conditions: PostingRuleCondition[]; actions: PostingRuleActions;
};

export type RuleSubject = {
  type: "income" | "expense" | "transfer";
  amount: number | null; bank_account_id: string | null;
  counterparty_id: string | null; description: string | null;
};

export type RuleContext = {
  counterparties: Map<string, { inn: string | null; group_id: string | null }>;
  categoryTypes: Map<string, "income" | "expense" | "mixed">;
  /** Архивные/удалённые/неизвестные id любых справочников. */
  inactiveIds: Set<string>;
  /** null — доступны все заведения. */
  allowedVenueIds: Set<string> | null;
};

export type RuleMatch = { value: string; ruleId: string };
export type RuleResult = Partial<Record<PostingRuleActionField, RuleMatch>>;
```

- Produces (`evaluate.ts`):
  - `ruleNeedsAttention(rule: PostingRule, ctx: RuleContext): boolean` — любой id из условий/действий в `ctx.inactiveIds`.
  - `ruleMatches(rule: PostingRule, subject: RuleSubject, ctx: RuleContext): boolean`
  - `evaluatePostingRules(rules: PostingRule[], subject: RuleSubject, ctx: RuleContext, fillable: Record<PostingRuleActionField, boolean>): RuleResult`

- [ ] **Step 1: Написать падающие тесты** в `evaluate.test.mts` (фикстуры — маленькие фабрики `rule({...})`, `subject({...})`, `ctx({...})`):
  - `counterparty in matches listed id` / `not_in matches null counterparty` / `in does not match null counterparty`
  - `counterparty_group matches via ctx.counterparties group_id`
  - `counterparty_inn compares trimmed digits` (`" 7719089011 "` = `"7719089011"`)
  - `amount between is inclusive; null bound is open` (min 100 → 100 ✓, 99.99 ✗)
  - `description match ignores case and spaces`: `"  Плата за  ПОПОЛНЕНИЕ по СБП "` + `contains "плата за пополнение"` → true; `starts_with`, `eq`, `not_contains` по одному кейсу
  - `transfer matches nothing`
  - `all conditions are AND`
  - `first rule by position wins per field`: правило pos 1 {category A}, pos 2 {category B, venue V} → `{category_id: A от 1, venue_id: V от 2}`
  - `disabled rule ignored`
  - `skips rule referencing inactive id` (и `ruleNeedsAttention` → true)
  - `fillable false leaves field out of result`
  - `counterparty action feeds second pass`: правило 1 `description contains "сбп"` → counterparty T; правило 2 `counterparty in [T]` → category K; результат содержит оба
  - `skips venue action outside allowed venues` (category из того же правила остаётся)
  - `skips category whose type differs from subject type` (`mixed` подходит к обоим)

- [ ] **Step 2: Запустить — падают**
  Run: `node --test --experimental-strip-types src/lib/finance/posting-rules/evaluate.test.mts`
  Expected: FAIL, модуль не найден.

- [ ] **Step 3: Реализовать `types.ts` и `evaluate.ts`.** Нормализация текста: `toLowerCase()`, `trim()`, `replace(/\s+/g, " ")`, `ё→е`. Сортировка по `position`. Проход 1 — только `counterparty_id`; если найден, подставить его в копию subject; проход 2 — `category_id`, `venue_id`.

- [ ] **Step 4: Запустить — проходят.** Та же команда, Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Финансы: вычислитель правил разнесения"`

---

### Task 2: Нормализация, проверка и фраза правила

**Files:**
- Create: `src/lib/finance/posting-rules/input.ts`
- Create: `src/lib/finance/posting-rules/phrase.ts`
- Test: `src/lib/finance/posting-rules/input.test.mts`, `src/lib/finance/posting-rules/phrase.test.mts`

**Interfaces:**
- Consumes: типы Task 1.
- Produces:
  - `export type PostingRuleInput = { name: string | null; enabled: boolean; conditions: PostingRuleCondition[]; actions: PostingRuleActions }`
  - `normalizePostingRuleInput(input: unknown, categoryTypes: Map<string, "income" | "expense" | "mixed">): { ok: true; value: PostingRuleInput } | { ok: false; error: string }` — zod-схема + правила ниже.
  - `describePostingRule(rule: Pick<PostingRule, "conditions" | "actions">, names: RuleNames): { conditions: string; actions: string }` где `RuleNames = { lookup(kind: "counterparty" | "counterparty_group" | "bank_account" | "category" | "venue", id: string): string | null }`; `null` → «другое заведение» / «другой счёт» / «другой контрагент» / «другая статья» / «другая группа».

- [ ] **Step 1: Падающие тесты**
  - `input`: `rejects rule without conditions` (error «Добавьте хотя бы одно условие»), `rejects rule without actions` («Добавьте хотя бы одно действие»), `rejects empty description value`, `rejects amount min > max`, `rejects empty id list`, `rejects duplicate field except description` (два условия «счёт» → ошибка), `adds type condition for expense category` (статья типа expense, условия без type → в результат добавлено `{field:"type",op:"eq",value:"expense"}`), `rejects category type conflicting with type condition`, `trims name, empty name → null`, `dedupes ids`.
  - `phrase`: `describes counterparties and account`: → `conditions` = `контрагент — один из: ООО «А», ООО «Б»; счёт — СБЕР Бизнес; расход`, `actions` = `статья «Поставки», заведение CHILLING`; `unknown venue renders as другое заведение`; `amount between renders от 100 до 5 000 ₽` (формат суммы — существующий форматтер денег проекта); `description contains renders описание содержит «…»`.

- [ ] **Step 2: Запустить — падают** (`node --test --experimental-strip-types src/lib/finance/posting-rules/*.test.mts`).
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить — проходят.**
- [ ] **Step 5: Commit** `git commit -m "Финансы: проверка и текст правил разнесения"`

---

### Task 3: Подстановка в форму (чистая логика)

**Files:**
- Create: `src/lib/finance/posting-rules/form-apply.ts`
- Test: `src/lib/finance/posting-rules/form-apply.test.mts`

**Interfaces:**
- Consumes: `evaluatePostingRules`, `RuleResult`, `PostingRuleActionField`.
- Produces:
  - `export type FieldSource = "empty" | "filter" | "rule" | "user"`
  - `export type FormRuleState = { values: Record<PostingRuleActionField, string | null>; sources: Record<PostingRuleActionField, FieldSource>; ruleIds: Partial<Record<PostingRuleActionField, string>>; filterVenueId: string | null }`
  - `applyRulesToForm(state: FormRuleState, result: RuleResult): FormRuleState` — поля с source `empty`/`filter`/`rule` получают значение из result (source `rule`, ruleId); если result для поля пуст, а source был `rule` → значение откатывается (venue — к `filterVenueId` с source `filter`, остальные — `null`/`empty`). Поля `user` не трогаются.
  - `fillableFrom(state: FormRuleState): Record<PostingRuleActionField, boolean>` — `true` для `empty | filter | rule`.
  - `markUserChoice(state, field, value): FormRuleState` — source `user`, ruleId удаляется (вызывается из onChange пикеров, включая выбор «Без заведения»).

- [ ] **Step 1: Падающие тесты:** `replaces filter venue`, `keeps user-chosen empty venue` (markUserChoice(venue, null) → правило не ставит), `keeps user field`, `clears rule-filled field when rule stops matching`, `rule venue falls back to filter venue`, `type switch clears mismatched rule category` (сценарий: результат вычислителя после смены типа пуст → статья от правила очищена).
- [ ] **Step 2: Запустить — падают.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить — проходят.**
- [ ] **Step 5: Commit** `git commit -m "Финансы: подстановка правил в форму операции"`

---

### Task 4: Миграция — право, таблица, RLS, порядок

**Files:**
- Create: `supabase/migrations/NNN_finance_posting_rules.sql`
- Modify: `src/types/database.ts` (cherry-pick блока таблицы и функции после `pnpm regen:types`, см. CLAUDE.md про частичный regen)

**Interfaces:**
- Produces: таблица `public.finance_posting_rules`, RPC `public.finance_posting_rules_reorder(p_ids uuid[]) returns void`, право `finance.manage_posting_rules`.

- [ ] **Step 1: Написать миграцию** (`begin; … commit;`):
  1. `insert into public.permissions (code, module, description) values ('finance.manage_posting_rules', 'finance', 'Настраивать правила разнесения операций') on conflict (code) do update …`; выдать ролям, у которых `granted` право `finance.manage_categories` (паттерн — `308_writeoff_pool_assignment.sql`); добавить код в списки посева ролей по умолчанию — пересоздать актуальное определение `seed_default_venue_roles` (найти последнее: `grep -ln "function public.seed_default_venue_roles" supabase/migrations | tail -1`) с `set search_path = public, pg_catalog`.
  2. Таблица: `id uuid pk default gen_random_uuid()`, `account_id uuid not null references accounts on delete cascade`, `name text null check (name is null or length(trim(name)) between 1 and 200)`, `position integer not null`, `enabled boolean not null default true`, `conditions jsonb not null check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) between 1 and 20)`, `action_category_id uuid`, `action_counterparty_id uuid`, `action_venue_id uuid`, `created_by`/`updated_by uuid references profiles on delete set null`, `created_at`/`updated_at timestamptz not null default now()`; `unique (account_id, id)`; композитные FK `(account_id, action_category_id) → finance_categories(account_id, id) on delete set null (action_category_id)`, так же для `counterparties` и `venues`; индексы `(account_id, position)`, `(account_id, action_category_id)`, `(account_id, action_counterparty_id)`, `(account_id, action_venue_id)`; триггер `updated_at` (существующий хелпер проекта). Check «≥1 действие» в БД **не** ставить: удаление статьи обнуляет колонку через `set null`, и check сломал бы удаление. «≥1 действие» проверяет `normalizePostingRuleInput`; правило без действий вычислителю нечего применять, а список показывает его как «Требует внимания» (`ruleNeedsAttention` → true и для правила без действий — добавить этот кейс в тесты Task 1).
  3. RLS: `select` — `account_id = (select get_active_account_id()) and (select has_permission('finance.view_transactions'))`; `insert/update/delete` — то же с `finance.manage_posting_rules`; `revoke all … from anon`; `grant select, insert, update, delete … to authenticated`.
  4. `finance_posting_rules_reorder(p_ids uuid[])`: `security invoker`, `set search_path = public, pg_catalog`; проверяет право `finance.manage_posting_rules`, что `p_ids` — ровно все правила активного аккаунта (иначе `raise exception 'Список правил изменился, обновите страницу'`), обновляет `position = ordinality` одним `update … from unnest(p_ids) with ordinality`. `revoke execute … from public, anon; grant … to authenticated`; проверка `has_function_privilege('anon', …)` → `raise exception`.
- [ ] **Step 2: Применить локально** `pnpm db:reset`. Expected: без ошибок.
- [ ] **Step 3: Проверить RLS руками** (psql под ролью без права): `insert` падает с RLS-ошибкой; `select` под ролью с `view_transactions` видит строки только своего аккаунта.
- [ ] **Step 4: Типы** `pnpm regen:types`, оставить в диффе только новые блоки. `pnpm exec tsc --noEmit` — PASS.
- [ ] **Step 5: Commit** `git commit -m "Финансы: таблица и право правил разнесения"`

---

### Task 5: Server actions и журнал

**Files:**
- Create: `src/lib/finance/posting-rules/server.ts` (`"use server"`)
- Modify: `src/lib/audit/format.tsx` (фразы для 4 кодов, рядом с `finance.counterparty.*`)

**Interfaces:**
- Consumes: `normalizePostingRuleInput`, таблица и RPC Task 4.
- Produces:
  - `listPostingRules(): Promise<PostingRule[]>` (по `position`; маппинг колонок `action_*` → `actions`)
  - `loadPostingRuleContext(): Promise<RuleContext>` — контрагенты (`inn`, `group_id`) через `fetchAllRows`, типы статей, `inactiveIds` (архивные статьи/контрагенты/заведения/счета/группы, а также id из условий, которых нет в справочниках), `allowedVenueIds` (null при `finance.view_all_venues`, иначе активное заведение).
  - `createPostingRule(input: unknown): Promise<{ id: string | null; error: string | null }>` — позиция = max+1 (новое правило в конец).
  - `updatePostingRule(id: string, input: unknown): Promise<{ error: string | null }>`
  - `setPostingRuleEnabled(id: string, enabled: boolean): Promise<{ error: string | null }>`
  - `deletePostingRule(id: string): Promise<{ error: string | null }>`
  - `reorderPostingRules(ids: string[]): Promise<{ error: string | null }>`

- [ ] **Step 1: Реализовать.** Каждый мутирующий экшен: `can("finance.manage_posting_rules")` → иначе «Недостаточно прав»; проверка, что id из условий/действий принадлежат активному аккаунту и не в архиве (ошибка «Статья „…“ в архиве» и т. п.); запись пользовательским клиентом с `.select("id")` и отказ при пустом результате (CLAUDE.md, журнал); затем `writeAuditEvent` (`entityType: "finance_posting_rule"`, details: фраза из `describePostingRule`, для toggle — `{ enabled }`); `revalidatePath("/finance/rules")`, `revalidatePath("/finance/transactions")`.
- [ ] **Step 2: Фразы журнала** в `format.tsx`: «создал правило разнесения», «изменил…», «удалил…», «изменил порядок правил разнесения».
- [ ] **Step 3: Проверка** `pnpm exec tsc --noEmit && pnpm lint` — PASS.
- [ ] **Step 4: Commit** `git commit -m "Финансы: сохранение правил разнесения и журнал"`

---

### Task 6: Страница «Правила»

**Files:**
- Create: `src/app/(dashboard)/finance/rules/page.tsx`, `loading.tsx`, `error.tsx`
- Create: `src/app/(dashboard)/finance/rules/_components/rules-page.tsx` (список, поиск, перетаскивание, переключатель)
- Create: `src/app/(dashboard)/finance/rules/_components/rule-sheet.tsx` (боковая панель создания/правки)
- Create: `src/app/(dashboard)/finance/rules/_components/condition-row.tsx`
- Create: `src/app/(dashboard)/finance/rules/_components/rules-help.tsx`
- Modify: `src/components/shared/sidebar.tsx` (пункт «Правила» после «Контрагентов», `permission: "finance.view_transactions"`), `src/app/(dashboard)/_components/page-help-registry.tsx`

**Interfaces:**
- Consumes: Task 2 (`describePostingRule`), Task 5 (все экшены, `listPostingRules`, `loadPostingRuleContext`), `ruleNeedsAttention` (Task 1); пикеры `CategoryPicker`, `CounterpartyPicker` из `@/components/finance/*`.

- [ ] **Step 1: page.tsx** — `can("finance.view_transactions")` иначе redirect `/dashboard`; `canManage = can("finance.manage_posting_rules")`; грузит правила, контекст и справочники (названия для `RuleNames`, только доступные пользователю — остальное рендерится «другим …»). `?rule=<id>` открывает панель правки этого правила.
- [ ] **Step 2: rules-page.tsx** — шапка по чек-листу таблиц: h1 «Правила», в нижней строке шапки поиск («Поиск по правилам» — ищет по тексту фразы) и кнопка «Добавить правило» (только `canManage`). Строка: ручка перетаскивания (только `canManage`, `@dnd-kit/sortable` по образцу `bank-account-groups-drawer.tsx`; при отпускании — `reorderPostingRules`), название (если есть) и фраза «Если {conditions} → {actions}», бейдж «Требует внимания» (рецепт статус-бейджей из memory `feedback_dark_mode_badge_palette`), `Switch` вкл/выкл. При активном поиске перетаскивание выключено. Пустое состояние: «Правил пока нет. Правило само заполнит статью, контрагента или заведение, когда вы вводите операцию.»
- [ ] **Step 3: rule-sheet.tsx + condition-row.tsx** — блок «Если»: строки «поле / оператор / значение», «Добавить условие» (поле, уже использованное в правиле, кроме «Описание», в списке недоступно), удалить строку; блок «Тогда»: «Добавить действие» → статья / контрагент / заведение (список статей — по типу из условия, без условия — все); название (необязательно); кнопки «Сохранить» и в режиме правки «Удалить правило» (подтверждение «Удалить правило? Операции, которые оно уже заполнило, не изменятся.»). Ошибки `normalizePostingRuleInput` показываются у формы. Только чтение без `canManage`.
- [ ] **Step 4: Проверить в браузере** (dev-сервер — через Bash в фоне, memory `feedback_dev_server_no_preview_launcher`): создать правило «контрагент — один из [2 шт.] + счёт + расход → статья, заведение», переставить, выключить, удалить; под ролью без права — нет кнопок; мобильная ширина 375px без горизонтального скролла (`docs/mobile-web.md`).
- [ ] **Step 5: `pnpm exec tsc --noEmit && pnpm lint`** — PASS. Commit `git commit -m "Финансы: страница «Правила»"`

---

### Task 7: Подстановка в форме операции

**Files:**
- Modify: `src/app/(dashboard)/finance/transactions/_components/transaction-form-sheet.tsx` (версия после PR #691)
- Modify: `src/app/(dashboard)/finance/transactions/page.tsx` и `transactions-page.tsx` (прокинуть правила и контекст в форму)

**Interfaces:**
- Consumes: `listPostingRules`, `loadPostingRuleContext` (Task 5), `evaluatePostingRules` (Task 1), `applyRulesToForm`, `fillableFrom`, `markUserChoice`, `FormRuleState` (Task 3), `describePostingRule` не нужен — подпись берёт `rule.name ?? "без названия"`.

- [ ] **Step 1:** Новые пропсы формы `postingRules: PostingRule[]`, `postingRuleContext: RuleContext` (сериализуемый: `Map`/`Set` собрать на клиенте из массивов — передавать с сервера как массивы и строить в `useMemo`). Загружать в `page.tsx` параллельно с остальным, только если есть хотя бы одно включённое правило — иначе пустые значения.
- [ ] **Step 2:** В состоянии формы — `FormRuleState`; `emptyForm` ставит venue с source `filter`, если пришёл `preferredVenueId`, остальные — `empty`; при открытии существующей операции все непустые поля — `user`. `useEffect` на изменение `type`, `amount`, `bank_account_id`, `counterparty_id`, `description` (описание — с дебаунсом 300 мс) → `evaluatePostingRules(rules, subject, ctx, fillableFrom(state))` → `applyRulesToForm`. Онченджи пикеров статьи, контрагента, заведения → `markUserChoice`.
- [ ] **Step 3:** Под полем с source `rule` — подсказка мелким muted-текстом: «По правилу „{название}“», ссылка на `/finance/rules?rule={id}`. Для переводов логика не запускается.
- [ ] **Step 4: Проверить в браузере:** правило из Task 6 срабатывает при вводе (статья и заведение подставляются, заведение фильтра заменено), ручной выбор не перетирается, смена контрагента откатывает подстановку, «Без заведения» руками сохраняется, перевод не трогается, правка существующей операции не меняет заполненные поля.
- [ ] **Step 5: `pnpm exec tsc --noEmit && pnpm lint`** — PASS. Commit `git commit -m "Финансы: правила разнесения при ручном вводе"`

---

### Task 8: Справка, проверки, PR

**Files:**
- Create: `docs/handbook/finance/rules.md` (по `docs/handbook/_template.md`: что такое правило, как читать фразу, порядок и «первое сверху», только пустые поля, заведение из фильтра, «Требует внимания», кто может настраивать; этапы 2–3 — пунктом «Скоро»)
- Modify: `docs/handbook/finance/index.md` (ссылка), `docs/handbook/finance/transactions.md` (абзац о подстановке в форме)

- [ ] **Step 1:** Написать страницы справки.
- [ ] **Step 2:** `node --test --experimental-strip-types "src/**/*.test.mts"` — PASS; `pnpm exec tsc --noEmit` — PASS; `pnpm lint` — PASS.
- [ ] **Step 3:** Pre-flight review диффа (memory `feedback_pr_preflight`): RLS, `.select("id")` перед журналом, search_path, права на функцию.
- [ ] **Step 4:** Push, PR с `--base main`, описание по-русски с ссылкой на дизайн. Не мержить без команды Павла. После мержа миграцию катить на прод через SSH (memory `self_hosted_supabase`, `prod_migration_drift_122`).
