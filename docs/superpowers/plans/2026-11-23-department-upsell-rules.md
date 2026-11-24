# Допродажи по подразделениям: план реализации (этапы 1–2 из 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** правила допродаж задаются на подразделение (блюдо/категория/модификатор → ₽ за штуку), прибавка дня считается один раз по чекам и идёт и в «Допродажи», и в зарплату; бар и кальяны переходят одновременно.

**Architecture:** три новых таблицы (участие подразделения, версии правил, посчитанные дни) и очередь по образцу `sales_additional_reports`. Подсчёт — чистая функция над уже сохранёнными чеками дня (`sales_sync_receipts` последнего успешного `sales_sync_jobs`) и каталогом; Quick Resto для подсчёта не вызывается. Старые дни и старая очередь отчётов не меняются: выручка и себестоимость по-прежнему из отчётов, баллы и шкала — только для дней до перехода.

**Tech Stack:** Next.js 15 Server Actions, Supabase Postgres (plpgsql RPC, RLS), TypeScript strict, `node:test` (`*.test.mts`), shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-22-bar-upsell-rules-design.md`; ставки мастеров — `docs/superpowers/analysis/2026-11-22-hookah-masters-upsell-rates.md`.

**Вне этого плана:** этап 3 — синхронизация тега Quick Resto (запись в бэк-офис, первая живая запись с согласия Павла). Отдельный план после мержа этапа 2.

## Global Constraints

- Ветка/PR: два PR от `main` (`--base main`): PR 1 = задачи 1–3, PR 2 = задачи 4–11. Не мержить без команды Павла.
- Номера миграций: сейчас последняя в `origin/main` — `378`. Перед каждым PR `git fetch origin main` и перепроверить номер и дубли.
- Каждая `create or replace function` в `public`/`private`: `set search_path = public, pg_catalog`. `auth.uid()` в политиках — `(select auth.uid())`. Серверные SECURITY DEFINER — `revoke ... from public, anon, authenticated` + проверка `has_function_privilege` с `raise exception`.
- Журнал: запись из SECURITY DEFINER-функции прямым `insert into audit_logs`, код `sales.additional_rules.updated`; одна строка на сохранение.
- «Нет данных» ≠ 0: нет чеков дня / загрузка не завершена / ошибка → `null`, никогда 0.
- Цели правил: только `dish`, `dish_group`, `modifier`, `modifier_group`. Ингредиенты и полуфабрикаты не выбираются.
- Количество строки чека — `quantity`; строка с `amount <= 0` (после скидок) не оплачивается; чеки Staff, удалённые и возвраты — не учитываются; итог дня — `Math.round`.
- Ставки первой версии кальянов: «Премиальный табак» 100, «Дегустация» 250, «Эксклюзивные кальяны» 450 ₽. «Супер-эксклюзив» не предзаполняется.
- Доля в фонде: делят присутствующие сотрудники подразделения, у кого допродажи включены; у «Бармен»/«Мастер» включено, если не выключено явно (`extras_enabled !== false`), у остальных должностей — только если включено явно (`=== true`).
- UI — по `docs/design-system.md` и паттернам `additional-rules.tsx` (`EditDrawer`, `DrawerSection`, `AmountInput`, `useDiscardGuard`). Тексты интерфейса — по-русски, без терминов БД.
- Каталог: `fetchAllRows` для списков, `chunk` для длинных `.in(...)`.

## Review Focus

1. В строке чека нет вида (чеки загружены до выкатки или Quick Resto не отдаёт класс) → вид берётся по каталогу; id совпал и с блюдом, и с модификатором → позиция в `unknown` с предупреждением, не оплачивается наугад. Тест — задача 5.
2. Граница перехода: день `valid_from − 1` считается и платится старым кодом, день `valid_from` — новым, в «Допродажах» и в зарплате одинаково. Тесты — задачи 7 и 9.
3. Блюдо с собственной ставкой внутри категории со ставкой в том же подразделении оплачивается один раз (по блюду); в другом подразделении — независимо. Тест — задача 5.
4. Чеки дня перезагрузили после расчёта (новый успешный job) → день пересчитывается, зарплата видит новое значение. Проверка в SQL-тесте — задача 4.
5. На смене нет ни одного сотрудника подразделения с включёнными допродажами (например, только старший бармен) → фонд никому не начисляется, деления на ноль нет. Тест — задача 7.

---

## Этап 1 (PR 1): модификаторы в номенклатуре и вид строки чека

### Task 1: Пробное чтение Quick Resto (без записи)

**Files:**
- Create: `scripts/probe-qr-modifiers.mts` (одноразовый, в PR не коммитить)
- Modify: `docs/superpowers/specs/2026-11-22-bar-upsell-rules-design.md` (раздел «Счёт количества», дописать подтверждённые факты)

**Interfaces:**
- Produces: подтверждённые строки для задач 2–3: модуль и классы модификатора и группы модификаторов; путь к классу продукта в `orderItemList[]` (ожидается `product.className`); пишется ли модификатор отдельным элементом `orderItemList`.

- [ ] **Step 1:** скрипт берёт подключение аккаунта CHILLING через `getConnection` и, используя функции `src/lib/integrations/quickresto/client.ts`, только читает: (а) `listNomenclatureTreeItems` по модулю `warehouse.nomenclature.mods` — печатает уникальные `className`; (б) детали одного недавнего чека, где есть код 2022 или 2023 (найти `order_id` в `sales_sync_receipts` на проде через `ssh woord-vps`, только `select`), — печатает для каждого элемента `orderItemList` `product.id`, `product.className`, `amount`, есть ли вложенный список модификаторов.
- [ ] **Step 2:** запустить, записать результат в дизайн. **Стоп-условие:** если модификатор приходит не отдельным элементом `orderItemList`, а вложенным списком у блюда, или у продукта нет класса — остановиться и вернуться к Павлу; задачи 2–3 в этом случае меняются.
- [ ] **Step 3:** удалить скрипт, закоммитить только правку дизайна.

### Task 2: Модификаторы и их группы в каталоге

**Files:**
- Create: `supabase/migrations/379_nomenclature_modifier_kind.sql`
- Modify: `src/lib/integrations/quickresto/normalize.ts` (`QuickRestoClassSuffix`, `NomenclatureKind`), `src/lib/integrations/quickresto/client.ts` (константы модуля/класса, `listModifierTreeItems`), `src/app/(dashboard)/inventory/_actions/sync.ts` (`NOMENCLATURE_IMPORTS`, вызов загрузки), места чтения `ingredients`/`ingredient_groups` без фильтра по `kind`
- Test: `src/lib/integrations/quickresto/normalize.test.mts`

**Interfaces:**
- Consumes: классы `ru.edgex.quickresto.modules.warehouse.nomenclature.mods.Modifier` / `...mods.ModifierGroup`, модуль `warehouse.nomenclature.mods` (задача 1, подтверждено).
- Produces: строки `ingredients.kind = 'modifier'` и `ingredient_groups.kind = 'modifier'` с `external_id` = id Quick Resto, `group_id`/`parent_group_id` как у блюд, `tags` из `storeItemTags`.

- [ ] **Step 1:** тест: `isQuickRestoClass({className: "<класс модификатора>"}, "Modifier") === true`, для группы — `"ModifierGroup"`; `isQuickRestoClass({className: "...dish.Dish"}, "Modifier") === false`.
- [ ] **Step 2:** `node --test --experimental-strip-types src/lib/integrations/quickresto/normalize.test.mts` → FAIL (тип суффикса не существует).
- [ ] **Step 3:** миграция: `alter type public.nomenclature_kind_enum add value if not exists 'modifier';` (без использования значения в той же миграции). В `normalize.ts` добавить суффиксы `"Modifier" | "ModifierGroup"` и `"modifier"` в `NomenclatureKind`. В `client.ts` — `listModifierTreeItems(input)` по образцу `listDishTreeItems`. В `NOMENCLATURE_IMPORTS` — `{ kind: "modifier", categorySuffix: "ModifierGroup", productSuffix: "Modifier", entityType: "modifier", groupEntityType: "modifier_group", productNoun: "Модификатор", groupNoun: "групп модификаторов" }`, источник в `Promise.all` и в словаре `items`.
- [ ] **Step 4:** `grep -rn 'from("ingredients")\|from("ingredient_groups")\|from<.*>("ingredients")' src` — каждое место, которое показывает список пользователю или ищет позицию без `kind`, должно не захватывать `modifier` (добавить `.neq("kind","modifier")` или явный список видов). Каталог (`CATALOG_KINDS`) модификаторы не показывает — не трогать.
- [ ] **Step 5:** тест PASS, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm db:reset` без ошибок.
- [ ] **Step 6:** commit «Номенклатура: загрузка модификаторов Quick Resto».

### Task 3: Вид строки чека

**Files:**
- Modify: `src/lib/sales/calculate.ts` (`OrderDetail`, `normalizeDetail`)
- Test: `src/lib/sales/calculate.test.mts`

**Interfaces:**
- Produces: `OrderDetail.lines[i].kind?: "dish" | "modifier" | "other"` — опционально: старые чеки и строки без класса его не содержат.

- [ ] **Step 1:** тесты `normalizeDetail`: строка с `product: {id: 5, className: "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish"}` → `kind: "dish"`; с `ru.edgex.quickresto.modules.warehouse.nomenclature.mods.Modifier` → `"modifier"`; с `...singleproduct.SingleProduct` → `"other"`; без `className` → поля `kind` нет. Существующие тесты `calculateOrdersDetailed` не меняются и проходят.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** в `normalizeDetail` определить `kind` по суффиксу `product.className`: `.Dish` → `dish`, `.Modifier` → `modifier`, другой непустой класс → `other`; класса нет — поле не ставить (вид определит каталог, задача 5). `calculateOrdersDetailed` поле не использует.
- [ ] **Step 4:** PASS, tsc, lint.
- [ ] **Step 5:** commit «Смены: вид позиции в строках чека». Открыть PR 1, дождаться зелёного CI, ждать команды на мерж. После мержа миграцию 379 докатить на прод (memory `prod_migration_drift_122.md`) и запустить загрузку номенклатуры, проверить на проде `select kind, count(*) from ingredients group by 1`.

---

## Этап 2 (PR 2): правила по подразделениям, расчёт по чекам, зарплата

### Task 4: Схема, очередь и сохранение правил

**Files:**
- Create: `supabase/migrations/380_sales_upsell_rules.sql`
- Create: `supabase/tests/sales_upsell_rules.sql`

**Interfaces:**
- Produces (таблицы):
  - `sales_upsell_departments(department_id uuid pk → departments, account_id, venue_id, legacy_kind text null check in ('bar','masters'), version int not null default 1, unique(venue_id, legacy_kind))`, FK `(account_id, venue_id) → venues(account_id, id)`.
  - `sales_upsell_rules(id, account_id, venue_id, department_id, valid_from date, lines jsonb, reason text, created_at, created_by → profiles)`; индекс `(department_id, valid_from desc, created_at desc, id)`.
  - `sales_upsell_days(id, account_id, venue_id, department_id, business_date, rule_id → sales_upsell_rules, job_id uuid null, state text check in ('pending','running','ready','error'), result jsonb null, computed_at, catalog_at timestamptz null, last_error, lease_token, claimed_at, attempts, next_retry_at, unique(department_id, business_date))`; индекс очереди как у `sales_additional_reports_queue`.
  - Элемент `lines`: `{ "target": "dish"|"dish_group"|"modifier"|"modifier_group", "external_id": "<цифры>", "name": "<1..200>", "rate": <0..1000000, ≤2 знака> }`, до 500 элементов, пара `target+external_id` уникальна.
- Produces (RPC):
  - `public.sales_save_upsell_rules(p_expected_venue uuid, p_department uuid, p_version integer, p_from date, p_lines jsonb, p_reason text) returns uuid` — для `authenticated`; права `sales.configure_shifts` + `sales.view_shifts`; подразделение активное и того же заведения; создаёт строку участия при первом сохранении (версия 1), иначе сверяет `p_version` и увеличивает; дата — как в `sales_save_additional_rules` (со следующего рабочего дня, ≤ +366); валидация `private.sales_validate_upsell_lines(jsonb)`; `audit_logs` с `details = {department_id, department_name, valid_from, reason, lines}`.
  - `public.sales_schedule_upsell_days() returns integer` (service_role): по каждому участвующему подразделению, для дней `cutoff-3 … cutoff-1`, где есть версия с `valid_from <= день`, вызывает `private.sales_request_upsell_day(dept, date, false)`.
  - `private.sales_request_upsell_day(p_department uuid, p_date date, p_force boolean) returns integer` — возвращает 0 для незакрытого дня (`p_date >= cutoff`, как в 283) и для дня без версии с `valid_from <= p_date`; иначе ставит/перезапускает строку в `pending`, если её нет, или `p_force`, или `rule_id` ≠ актуальной версии, или `job_id` ≠ id последнего `sales_sync_jobs` со `status='success'` за этот день, или `result->'unknown'` не пуст и каталог аккаунта (`max(ingredients.synced_at)`) новее `catalog_at`.
  - `public.sales_request_additional_month` — пересоздать: после цикла по старой очереди тем же циклом дней вызывает `private.sales_request_upsell_day(..., true)` для участвующих подразделений; число в журнале — сумма.
  - `public.sales_claim_upsell_day()`, `public.sales_commit_upsell_day(p_id uuid, p_lease uuid, p_job uuid, p_catalog_at timestamptz, p_result jsonb) returns boolean`, `public.sales_fail_upsell_day(p_id uuid, p_lease uuid, p_error text)` — по образцу 283. `commit` отказывается, если с момента захвата сменились актуальная версия правил или последний успешный job дня; проверяет форму `p_result` (см. задачу 5) и что `result.lines` содержит ровно ключи строк версии.
  - Данные: для каждого заведения с `sales_additional_sources` вставить участие подразделения с именем «Бар» (`legacy_kind='bar'`) и «Кальяны» (`'masters'`), если такие активные подразделения есть.
  - RLS: чтение трёх таблиц — как `sales_additional_read` в 283; запись только через RPC.

- [ ] **Step 1:** SQL-тест (по стилю `supabase/tests/`): валидатор отклоняет повтор цели, `target='ingredient'`, ставку −1 и 1.005, пустое имя; принимает корректный набор. `sales_request_upsell_day` ставит строку в `pending` после появления нового успешного job того же дня (Review Focus 4) и не трогает `ready`-строку без изменений.
- [ ] **Step 2:** `pnpm db:reset` + прогон теста → FAIL (функций нет).
- [ ] **Step 3:** миграция по интерфейсам выше; в конце — проверки привилегий (`has_function_privilege('anon', ..., 'execute')` = false для серверных функций → иначе `raise exception`).
- [ ] **Step 4:** `pnpm db:reset`, тест PASS.
- [ ] **Step 5:** `pnpm regen:types` (или точечно дописать типы трёх таблиц в `src/types/database.ts`), tsc.
- [ ] **Step 6:** commit «Допродажи: правила по подразделениям, схема и очередь».

### Task 5: Подсчёт дня по чекам (чистая функция)

**Files:**
- Create: `src/lib/sales/upsell.ts`
- Test: `src/lib/sales/upsell.test.mts`

**Interfaces:**
- Consumes: `Order`, `OrderDetail`, `validOrder` из `calculate.ts`; `kind` строки из задачи 3.
- Produces:
  ```ts
  export type UpsellTarget = "dish" | "dish_group" | "modifier" | "modifier_group";
  export type UpsellLine = { target: UpsellTarget; external_id: string; name: string; rate: number };
  export type UpsellCatalog = {
    items: Map<string, { name: string; group: string | null }>;   // "dish:123" | "modifier:7" → группа "dish_group:45"
    groups: Map<string, { name: string; parent: string | null }>; // "dish_group:45" → родитель
  };
  export type UpsellDayResult = {
    bonus: number;                                                   // Math.round
    lines: { key: string; quantity: number; amount: number }[];      // key = `${target}:${external_id}`, все строки версии, нули тоже
    paid: Record<string, string>;                                    // "dish:123" → key строки правил
    unknown: { key: string; quantity: number }[];                    // позиции чека не из каталога
  };
  export const lineKey: (l: Pick<UpsellLine, "target" | "external_id">) => string;
  export function validateUpsellLines(lines: UpsellLine[]): void;   // те же правила, что SQL-валидатор; сообщения по-русски
  export function resolveUpsellLine(itemKey: string, lines: UpsellLine[], catalog: UpsellCatalog): string | null;
  export function countUpsellDay(input: { orders: Order[]; details: OrderDetail[]; staffIds: number[]; lines: UpsellLine[]; catalog: UpsellCatalog }): UpsellDayResult;
  ```
  Вид строки чека: `line.kind` из задачи 3, если это `dish`/`modifier`; `other` — не оплачивается и не в `unknown`; нет поля — ключ ищется в `catalog.items` как `dish:<id>` и `modifier:<id>`, ровно одно совпадение — оно, иначе ключ `?:<id>` в `unknown`.
  `resolveUpsellLine`: своё правило позиции главнее; иначе идти вверх по группам, первая группа со строкой — её ключ; цикл в дереве — `Error`. Позиции вида `other` не оплачиваются и не попадают в `unknown`.

- [ ] **Step 1:** тесты (имена — как поведение):
  - «блюдо со своей ставкой внутри категории со ставкой оплачивается один раз по блюду»;
  - «ближайшая категория главнее дальней»;
  - «Staff, удалённые и возвращённые чеки не считаются» (payer в `staffIds`, `deleted`, `returned`, `status: "cancelled"`);
  - «бесплатная строка (amount 0) не оплачивается, а количество строки суммируется дробным» (`quantity: 0.5` + `1` → 1.5 × 180 = 270);
  - «модификатор считается своей строкой по своей группе»;
  - «блюдо и модификатор с одним id не путаются» (`dish:2022` и `modifier:2022`);
  - «позиция не из каталога — в unknown, сумма считается по известным»;
  - «строки без продаж есть в результате с нулём»;
  - «строка без вида находится по каталогу, если id есть только у блюда или только у модификатора» и «id есть и у блюда, и у модификатора — строка в unknown» (Review Focus 1);
  - «итог округляется до рубля» (3 × 33.33 → 100).
  - `validateUpsellLines`: повтор цели, ставка 1.005, `target: "ingredient"` → throw.
- [ ] **Step 2:** `node --test --experimental-strip-types src/lib/sales/upsell.test.mts` → FAIL.
- [ ] **Step 3:** реализовать сигнатуры выше.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit «Допродажи: подсчёт дня по чекам».

### Task 6: Обработчик очереди дней

**Files:**
- Create: `src/lib/sales/upsell-sync.ts`
- Modify: `src/app/api/cron/sales-shifts/route.ts` (вызов планировщика рядом с `scheduleAdditionalReports`, обработка в `lane === 2` после `processAdditionalReport`)

**Interfaces:**
- Consumes: RPC задачи 4; `countUpsellDay` задачи 5; `fetchAllRows`, `chunk`.
- Produces: `scheduleUpsellDays(): Promise<number>`, `processUpsellDay(): Promise<{ idle: boolean; error?: boolean }>`; `loadUpsellCatalog(db, accountId): Promise<{ catalog: UpsellCatalog; syncedAt: string | null }>` (экспорт — нужен задаче 8).

- [ ] **Step 1:** `processUpsellDay`: claim → последний успешный job дня (нет — `fail` «Чеки дня ещё не загружены», строка остаётся без результата) → его чеки (`order_data, detail_data`, страницами по 1000, как в `sync.ts`), `payload.staff_ids` → версия правил → каталог (`ingredients` `kind in ('dish','modifier')` включая архивные, `ingredient_groups` тех же видов) → `countUpsellDay` → `commit(p_job = job.id, p_catalog_at = syncedAt)` → если `commit` вернул `true`, `queuePayroll(accountId, venueId, [date])` из `src/lib/payroll/sync.ts` (ошибку «Включите обработку зарплаты…» проглотить: у заведения может не быть зарплаты), чтобы зарплата дня пересчиталась с готовой прибавкой. Ошибка подсчёта → `fail` с её текстом, если он из `upsell.ts`, иначе «Не удалось посчитать допродажи. Повторим автоматически».
- [ ] **Step 2:** подключить в cron; `pnpm exec tsc --noEmit`, `pnpm lint`.
- [ ] **Step 3:** локальная проверка: `pnpm db:reset`, вставить в локальную БД версию правил «Бар» с одной категорией из seed, job и пару чеков; вызвать `processUpsellDay` (одноразовый скрипт через `node --experimental-strip-types`, не коммитить); `sales_upsell_days.state = 'ready'`, `result.bonus` равен ручному расчёту.
- [ ] **Step 4:** commit «Допродажи: обработчик дней по чекам».

### Task 7: Зарплата берёт прибавку подразделения

**Files:**
- Create: `src/lib/payroll/upsell-share.ts`
- Modify: `src/lib/payroll/calculate.ts` (`computeAccrual`), `src/lib/payroll/sync.ts` (около строк 380–430), `src/lib/payroll/source.ts` (не запрашивать отчёты 140/175/227 для перешедших видов), `src/app/(dashboard)/people/payroll/_components/role-compensation.tsx` (`canExtras`, подсказка)
- Test: `src/lib/payroll/upsell-share.test.mts`

**Interfaces:**
- Consumes: `sales_upsell_rules`, `sales_upsell_days`, `sales_upsell_departments`; `roles.department_id`.
- Produces:
  ```ts
  export function extrasEligible(config: { extras_enabled?: boolean } | null, roleName: string): boolean;
  export function departmentShares(input: {
    date: string;
    present: { id: string; departmentId: string | null; eligible: boolean }[];
    switchDates: Map<string, string>;          // department_id → первая valid_from
    days: Map<string, number | null>;          // department_id → result.bonus готового дня, null если дня нет / не ready
  }): Map<string, { amount: number | null; divisor: number } | "legacy" | null>;
  ```
  Значение по сотруднику: `"legacy"` — подразделение не перешло на эту дату (старый код по названию должности); `null` — допродажи сотруднику не положены; объект — доля.
  `computeAccrual` получает необязательное `extraShare?: { amount: number | null; divisor: number; department: string }`; если передано, вместо ветки «Мастер/Бармен» добавляет компонент `extra` «Дополнительные продажи» = `Math.round(amount / divisor)`, основание «`<сумма>` ₽ / `<n>` сотрудников · `<подразделение>`», источник «Sheerly · чеки дня»; `amount === null` → проблема «Не посчитаны допродажи подразделения».

- [ ] **Step 1:** тесты `upsell-share.test.mts`:
  - `extrasEligible(undefined, "Бармен") === true`, `extrasEligible({extras_enabled:false}, "Мастер") === false`, `extrasEligible(undefined, "Старший бармен") === false`, `extrasEligible({extras_enabled:true}, "Менеджер") === true`;
  - «день до перехода — legacy, день перехода — доля» (Review Focus 2);
  - «двое барменов и старший без допродаж: делитель 2, у старшего null»;
  - «на смене только сотрудник без допродаж — фонд никому, делителя нет» (Review Focus 5);
  - «дня нет — amount null у всех eligible».
  - тест `computeAccrual` с `extraShare` (в том же файле): 1 801 / 2 → компонент 901; `amount: null` → в `issues` «Не посчитаны допродажи подразделения».
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать; в `sync.ts` загрузить для заведения участие, версии (min `valid_from` на подразделение), готовые дни на `date`, `department_id` должностей; для каждого сотрудника передать `extraShare` или старую ветку. В `source.ts` отчёты бара/кальянов запрашивать, только если соответствующий `legacy_kind` на эту дату ещё не перешёл. В `role-compensation.tsx` переключатель показывать у должностей участвующих подразделений, значение по умолчанию — `extrasEligible`; текст подсказки: «Сумма допродаж подразделения делится поровну между сотрудниками смены, у которых они включены».
- [ ] **Step 4:** PASS; существующие тесты `src/lib/payroll/*.test.mts` PASS; tsc, lint.
- [ ] **Step 5:** commit «Зарплата: допродажи подразделения из расчёта по чекам».

### Task 8: Редактор правил подразделений

**Files:**
- Create: `src/lib/sales/upsell-prefill.ts`, `src/app/(dashboard)/sales/additional/upsell-rules-editor.tsx`
- Modify: `src/app/(dashboard)/sales/additional/actions.ts` (`AdditionalData`, `loadAdditional`, `saveUpsellRules`)
- Test: `src/lib/sales/upsell-prefill.test.mts`

**Interfaces:**
- Consumes: `loadUpsellCatalog` (задача 6), `validateUpsellLines`, `lineKey` (задача 5), `sales_save_upsell_rules` (задача 4).
- Produces:
  - `AdditionalData` += `departments: { id: string; name: string; legacyKind: "bar" | "masters" | null; version: number }[]`, `upsellRules: { id; department_id; valid_from; lines: UpsellLine[]; reason; created_at; created_by }[]`, `upsellDays: { id; department_id; business_date; state; result: UpsellDayResult | null; last_error: string | null; computed_at: string | null }[]`, `picker: { key: string; target: UpsellTarget; external_id: string; name: string; path: string; tagged: boolean; archived: boolean }[]` (dish/modifier и их группы; `tagged` — есть тег «Продажи / Бар» в `tags` позиции или `raw_payload.storeItemTags` группы; тег ищется по названию, только для подсказок первой версии).
  - `saveUpsellRules(input: { venueId: string; departmentId: string; version: number; from: string; lines: UpsellLine[]; reason: string }): Promise<AdditionalData>`.
  - `prefillUpsell(input: { legacyKind: "bar" | "masters"; oldRules: AdditionalRules; picker: AdditionalData["picker"] }): { lines: UpsellLine[]; notFound: string[]; taggedWithoutRate: string[]; ratedWithoutTag: string[] }`. Бар: каждая `branch` старой группы → `dish_group` с точно тем же именем, иначе `dish` с тем же именем, иначе в `notFound`; ставка — ставка группы. Кальяны: три категории с именами «Премиальный табак», «Дегустация», «Эксклюзивные кальяны» → 100 / 250 / 450. `taggedWithoutRate`/`ratedWithoutTag` — только для бара.
- [ ] **Step 1:** тесты `prefillUpsell`: «Виски» есть категорией → `dish_group` 100; «Сет настоек» есть блюдом → `dish` 200; «Сиропы к кофе» нигде → `notFound`; кальяны → три строки 100/250/450; помеченное блюдо вне правил → в `taggedWithoutRate`.
- [ ] **Step 2:** FAIL → реализовать → PASS.
- [ ] **Step 3:** `loadAdditional` и `saveUpsellRules` (zod на входе, `validateUpsellLines`, права как у `saveAdditionalRules`).
- [ ] **Step 4:** `upsell-rules-editor.tsx`: вкладки — активные подразделения заведения; в каждой список строк (название, путь серым, «категория»/«блюдо»/«модификатор»/«группа модификаторов», `AmountInput`, удалить), «Добавить» — поиск по `picker` (уже добавленные недоступны), пометка «нет в номенклатуре» для целей без позиции в `picker`; для подразделения без своих версий и с `legacyKind` — предзаполнение и три списка из `prefillUpsell` над списком; «Действует с», «Причина изменения», история версий подразделения; защита от потери правок. Старый `AdditionalRulesEditor` открывается только для подразделений без перехода (кнопка «Правила расчёта» открывает новый редактор).
- [ ] **Step 5:** tsc, lint; проверить в браузере локально (`pnpm dev` в фоне через Bash): добавить категорию, блюдо, удалить строку, сохранить версию, увидеть её в истории.
- [ ] **Step 6:** commit «Допродажи: редактор правил подразделений».

### Task 9: Экран «Допродажи» по подразделениям

**Files:**
- Modify: `src/lib/sales/additional-view.ts`, `src/app/(dashboard)/sales/additional/additional-client.tsx`
- Test: `src/lib/sales/additional-view.test.mts`

**Interfaces:**
- Consumes: `AdditionalData` из задачи 8.
- Produces: `departmentRows(data: AdditionalData, departmentId: string, source: "native" | "archive"): AdditionalRow[]` — дни до перехода подразделения из старой очереди его `legacyKind` (как `additionalRows`), дни с перехода — из `upsellDays`: `bonus` = `result.bonus` (нет результата → `null`), `revenue`/`primeCost` — из строки старой очереди того же дня (если есть `legacyKind`), количества — по ключам строк правил. `AdditionalRow` += `upsell?: { day; lines: UpsellLine[] }`.
- [ ] **Step 1:** тесты: «день до перехода берётся из старой очереди, день перехода — из расчёта по чекам» (Review Focus 2); «день без результата — bonus null, не 0»; «выручка дня перехода из отчёта бара».
- [ ] **Step 2:** FAIL → реализовать → PASS.
- [ ] **Step 3:** в `additional-client.tsx` вкладки «Бар/Кальяны» заменить вкладками участвующих подразделений; колонки для дней новой схемы — по строкам правил; колонка баллов — только если в месяце есть дни до перехода кальянов. Карточка дня новой схемы: по строкам — цель, продано, ставка, сумма; итог; предупреждение «В чеках есть позиции не из номенклатуры: …» при непустом `unknown` (и над таблицей месяца); `last_error` дня — как сейчас у отчётов.
- [ ] **Step 4:** tsc, lint, проверка в браузере на локальных данных задачи 6.
- [ ] **Step 5:** commit «Допродажи: экран по подразделениям».

### Task 10: Журнал и справка

**Files:**
- Modify: `src/lib/audit/format.tsx` (`sales.additional_rules.updated`), `docs/handbook/sales/additional.md`, справка по зарплате в `docs/handbook/people/` (страница про оплату должности), `docs/sales-shifts.md`

- [ ] **Step 1:** фраза события: при `details.department_name` — «изменил(а) правила допродаж: `<подразделение>`», в деталях «Действует с …», причина, «Строк: N». Старые события показываются как раньше.
- [ ] **Step 2:** справка: как добавить блюдо, категорию или модификатор; конкретнее — главнее; бесплатные позиции и чеки персонала не оплачиваются; правила действуют со следующего рабочего дня, прошлые дни не меняются; мастера больше не получают баллы — фиксированные рубли за позицию; кто делит фонд подразделения и где включаются допродажи у должности. Без названий таблиц и функций.
- [ ] **Step 3:** tsc, lint; commit «Допродажи: журнал и справка».

### Task 11: Проверка и PR 2

- [ ] **Step 1:** `node --test --experimental-strip-types "src/**/*.test.mts"` — все PASS; `pnpm exec tsc --noEmit`; `pnpm lint`; `pnpm db:reset` + `supabase/tests/sales_upsell_rules.sql`.
- [ ] **Step 2:** `git fetch origin main`, перепроверить номера 379/380 и отсутствие дублей; при сдвиге — переименовать.
- [ ] **Step 3:** самопроверка до PR (memory `feedback_pr_preflight.md`): RLS и привилегии новых функций, `search_path`, «нет данных» ≠ 0 на всех путях, журнал пишется только при реальной записи.
- [ ] **Step 4:** PR от `main`, описание по-русски с перечнем пользовательских изменений; ждать CI и команду на мерж.
- [ ] **Step 5 (после мержа, по команде):** миграцию 380 докатить на прод через SSH, убедиться в строках участия «Бар» и «Кальяны»; выкатку приложения — по memory `prod_deploy_manual.md`. Первую версию правил сохраняет Павел в редакторе (предзаполнение уже готово); до сохранения ничего не меняется.
