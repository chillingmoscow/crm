# Взвешивание табака (задача-пересчёт) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Еженедельное взвешивание табака в зале — повторяющаяся задача графика с
собственным экраном взвешивания; после сдачи система сама создаёт, проводит и фиксирует
акт Quick Resto на складе «Кальяны / Зал» и шлёт PDF в Telegram; плюс загрузка
проведённых табачных актов с 01.10.2026.

**Architecture:** Новый вид задачи `stock_count` в `schedule_task_definitions` (`kind` +
`count_config`), черновик взвешивания в `occurrence.answers.weighing`, сдача — отдельная
SQL-команда, которая ставит задание `completed` и кладёт строку в очередь
`stock_count_commits`. Фоновый шаг в `/api/cron/payroll` разбирает очередь: акт в QR →
локальный документ → фиксация итогов общей функцией, вынесенной из
`finalizeInventoryResults` → PDF в Telegram. Чистая арифметика взвешивания — в
`src/lib/stock-count/`, покрыта `node:test`.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase Postgres (plpgsql,
RLS, storage), TypeScript strict, zod, `node:test`, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-24-tobacco-weighing-design.md`

## Global Constraints

- Миграция — следующий номер после `ls supabase/migrations | tail -1` на момент работы
  (на 25.11 последняя `385_…` → `386_stock_count_tasks.sql`); перед мержем снова
  проверить дубли номеров против `origin/main`.
- Каждая `create or replace function` в `public` — с `set search_path = public, pg_catalog`.
- В RLS — `(select auth.uid())`, `(select public.has_permission(...))`.
- Тексты `raise exception` — по-русски; миграция с GRANT/REVOKE проверяет результат
  (`has_function_privilege` → `raise exception`).
- Новые таблицы: `account_id`, явные `grant … to service_role`, RLS включён.
- Server actions из браузера — `actionResult(fn, "<русский fallback>")` /
  `errorText`; `redirect()` внутри не вызывать.
- `writeAuditEvent` — только после подтверждённой записи (`.select("id")`).
- UI — по `docs/design-system.md`, мобильная вёрстка — по `docs/mobile-web.md`
  (input ≥ 16px, `min-w-0`).
- Вес вводится только целыми граммами; тара по умолчанию: контейнер 47 г, баночка
  125 г; премиум: Bonche (30) 80, Bonche (60) 100, Bonche (80) 118, Bonche (120) 165,
  Старая Dogma (80) 125, Новая Dogma (80) 165, WTO (20) 52.
- Приёмка задачи — `auto`; проведение без проверки управляющим (решение Павла).
- Удержание воркер не ставит (см. спеку §3 п.5).
- CI = `pnpm exec tsc --noEmit` + `pnpm lint`; тесты —
  `node --test --experimental-strip-types "src/**/*.test.mts"`.

## Review Focus

- Повторная сдача / повтор тика воркера / падение посередине → ровно один акт в QR и
  один документ в Sheerly (маркер в комментарии QR + `unique(occurrence_id)`).
- Quick Resto недоступен в момент сдачи → задание уже `completed`, без штрафа;
  очередь повторяет, после 5 неудач — `failed` с текстом и кнопкой «Повторить».
- Ввод «6.666» / «6,666» / «6» при 30 контейнерах → ошибка или предупреждение, не 6 г.
- Задание стало `stock_count`, а старый путь `run.save`/`run.submit` чек-листа пытается
  его сохранить → явный отказ «Это взвешивание…», а не проверка пустых `items`.
- Импортированный уже проведённый акт → снимок фиксируется без повторного проведения
  и без сверки (ветка `alreadyProcessedInQr`), месяц не становится «неполным».

---

### Task 1: Арифметика и схема взвешивания

**Files:**
- Create: `src/lib/stock-count/tobacco-weighing.ts`
- Test: `src/lib/stock-count/tobacco-weighing.test.mts`

**Interfaces:**
- Produces:
  - `type Tare = { key: string; title: string; grams: number }`
  - `type CountSection = { key: "standard" | "premium" | "parfum"; title: string; hint: string; productId: string /* ingredients.id */; tares: Tare[] }`
  - `type CountConfig = { mode: "tobacco_weighing"; storeId: string; telegramChatId: string | null; sections: CountSection[] }`
  - `countConfigSchema: z.ZodType<CountConfig>` (≥1 раздел, уникальные `key`, `grams` целое 1–5000, ≤20 тар на раздел)
  - `type WeighingBatch = { id: string /* uuid */; grams: number; tares: Array<{ tareKey: string; count: number }>; photo: string | null /* storage path */ }`
  - `type WeighingDraft = { startedAt: string | null /* ISO, первая партия */; sections: Record<string, { empty: boolean; batches: WeighingBatch[] }> }`
  - `weighingDraftSchema: z.ZodType<WeighingDraft>`
  - `batchNetGrams(batch: WeighingBatch, tares: Tare[]): number`
  - `sectionNetGrams(section: WeighingDraft["sections"][string], tares: Tare[]): number`
  - `parseGramsInput(raw: string): { grams: number } | { error: string }`
  - `weighingWarnings(draft: WeighingDraft, config: CountConfig): string[]`
  - `submitErrors(draft: WeighingDraft, config: CountConfig): string[]`
  - `netKgBySection(draft: WeighingDraft, config: CountConfig): Record<string, number>` (3 знака)
  - `DEFAULT_TOBACCO_SECTIONS: Omit<CountSection, "productId">[]` (тексты подсказок из формы, тара из Global Constraints)

- [ ] **Step 1: Write failing tests**

```ts
test("нетто партии стандарта: 7458 г − 30×47", () => {
  assert.equal(batchNetGrams(b(7458, [["container", 30]]), STD_TARES), 6048);
});
test("премиум со смешанной тарой", () => {
  assert.equal(batchNetGrams(b(1240, [["bonche80", 2], ["wto20", 3]]), PRM_TARES), 848);
});
test("парфюм: контейнеры и баночки в кг", () => {
  // 332 − 2×47 = 238; 146 − 1×125 = 21 → 0.259
  assert.equal(netKgBySection(parfumDraft, cfg).parfum, 0.259);
});
test("parseGramsInput отвергает точку и запятую", () => {
  assert.deepEqual(parseGramsInput("6.666"), { error: "Вводите вес в граммах, без точки и запятой" });
  assert.deepEqual(parseGramsInput("6,666"), { error: "Вводите вес в граммах, без точки и запятой" });
  assert.deepEqual(parseGramsInput(" 7458 "), { grams: 7458 });
});
test("submitErrors: отрицательное нетто, нет фото, пустой раздел без отметки", () => {
  assert.deepEqual(submitErrors(badDraft, cfg), [
    "Стандарт, партия 1: вес меньше тары",
    "Стандарт, партия 2: нет фото",
    "Парфюм: добавьте партию или отметьте «В разделе ничего нет»",
  ]);
});
test("weighingWarnings: 6 г при 30 контейнерах похоже на килограммы", () => {
  assert.deepEqual(weighingWarnings(kgLikeDraft, cfg), [
    "Стандарт, партия 1: 6 г при 30 шт. тары — похоже на килограммы. Вес вводится в граммах",
  ]);
});
test("countConfigSchema отвергает повтор ключа раздела", () => {
  assert.equal(countConfigSchema.safeParse(dupCfg).success, false);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test --experimental-strip-types src/lib/stock-count/tobacco-weighing.test.mts` → module not found.
- [ ] **Step 3: Implement** the exported functions. Предупреждение «похоже на килограммы»: `grams < 100 && Σ tare count > 0`. `netKgBySection` = `Math.round(sectionNetGrams)/1000`, `empty` раздел → 0.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(stock-count): арифметика взвешивания табака`

---

### Task 2: Миграция — вид задачи, очередь проведения, команды

**Files:**
- Create: `supabase/migrations/386_stock_count_tasks.sql`
- Modify: `src/types/database.ts` (точечно дописать новые колонки/таблицу/функции; полный regen не делать)

**Interfaces:**
- Produces (SQL):
  - `schedule_task_definitions.kind text not null default 'checklist' check (kind in ('checklist','stock_count'))`, `count_config jsonb`.
  - Пересозданное ограничение `schedule_task_enabled_config`: включённая задача требует `template_id`, `recurrence` и (`kind='checklist'` и непустые `items`) или (`kind='stock_count'` и `count_config is not null`).
  - `private.schedule_count_config_valid(jsonb) returns boolean` — структура как `countConfigSchema` (mode, storeId — `stores.id` того же аккаунта, sections 1–10, tares 1–20, grams 1–5000).
  - `public.schedule_task_command` пересоздана из **последней** версии (найти `grep -ln "function public.schedule_task_command" supabase/migrations`): `definition.save` принимает `kind` (неизменяем после создания — `raise exception 'Вид задачи нельзя изменить'`) и `count_config` (валидируется для `stock_count`, для `checklist` — null); `run.save`/`run.submit` для `snapshot->>'kind'='stock_count'` → `raise exception 'Это взвешивание: откройте его из графика'`.
  - `public.stock_count_commits`: `id uuid pk`, `account_id`, `venue_id`, `occurrence_id uuid not null unique references schedule_task_occurrences(id)`, `status text check (status in ('pending','processing','done','failed'))`, `attempts int default 0`, `last_error text`, `qr_document_id bigint`, `document_id uuid references documents(id)`, `telegram_status text check (telegram_status in ('pending','sent','failed','skipped')) default 'pending'`, `next_attempt_at timestamptz default now()`, `created_at`, `updated_at`. RLS: select для `schedule.view_all` / `schedule.review` / `inventory.view_results` активного заведения и для исполнителя задания; запись — только service_role.
  - `public.stock_count_command(p_action text, p_input jsonb) returns jsonb` (security definer): `run.save` и `run.submit` для заданий `stock_count` с теми же проверками владельца/дня/дедлайна/смены, что у `run.*` в `schedule_task_command`; `answers` = `{ "weighing": … }` ≤ 100 КБ; при `run.submit` — каждый непустой `photo` должен существовать в `storage.objects` (`bucket_id='task-evidence'`, `name like o.id||'/weighing/%'`), статус → `completed` (`completed_at`, `submitted_at` = now()), вставка `stock_count_commits(status 'pending')` `on conflict (occurrence_id) do nothing`; запись в `schedule_task_history`. Структуру партий проверяет сервер (Task 4) — SQL проверяет только фото и права.
  - `public.stock_count_retry(p_commit uuid) returns void` — `failed` → `pending`, `attempts=0`; право `schedule.review` или `inventory.finalize_results`.
  - Политика `task_evidence_insert` пересоздана: дополнительно разрешает путь `{occ}/weighing/{file}` для заданий с `snapshot->>'kind'='stock_count'` (те же условия по статусу и исполнителю).
  - GRANT: `stock_count_command`, `stock_count_retry` — `authenticated`; проверка `has_function_privilege` в конце миграции.

- [ ] **Step 1: Write the migration.**
- [ ] **Step 2: Apply locally** — `pnpm db:reset` → без ошибок.
- [ ] **Step 3: SQL smoke** (через `psql` локальной БД, в транзакции с `rollback`): создать definition `stock_count` с валидным `count_config` и `enabled=true` без `items` → проходит; с `kind='checklist'` без `items` → `Для включения задачи…`; `run.save` чек-листа на `stock_count`-задании → `Это взвешивание…`; двойной `stock_count_command('run.submit')` → одна строка в `stock_count_commits`.
- [ ] **Step 4: Type-check** — `pnpm exec tsc --noEmit` → 0 ошибок.
- [ ] **Step 5: Commit** — `feat(schedule): вид задачи «Пересчёт» и очередь проведения взвешиваний`

---

### Task 3: Настройка задачи «Взвешивание табака»

**Files:**
- Modify: `src/lib/schedule/tasks.ts` (`taskDefinitionSchema`: `kind`, `count_config`; superRefine — `stock_count` не требует `items`, требует валидный `count_config`)
- Modify: `src/app/(dashboard)/schedule/tasks/tasks-client.tsx` (создание: выбор вида «Чек-лист» / «Взвешивание табака»; для `stock_count` вкладка «Чек-лист» заменяется вкладкой «Взвешивание»)
- Create: `src/app/(dashboard)/schedule/tasks/count-config-editor.tsx` (склад — из `stores` заведения; чат — из `telegram_chats`; по разделу: позиция каталога, подсказка, список тары «название + граммы»; кнопка «Заполнить по умолчанию» из `DEFAULT_TOBACCO_SECTIONS`)
- Modify: `src/app/(dashboard)/schedule/tasks/task-status.ts` («Не настроена: укажите склад и позиции» для `stock_count`)
- Modify: `src/app/(dashboard)/schedule/tasks/actions.ts` (передача `kind`/`count_config` в `definition.save`)
- Test: `src/lib/schedule/tasks.test.mts` (создать, если нет)

**Interfaces:**
- Consumes: `countConfigSchema`, `DEFAULT_TOBACCO_SECTIONS` (Task 1); SQL `definition.save` (Task 2).
- Produces: `TaskInput.kind: "checklist" | "stock_count"`, `TaskInput.count_config: CountConfig | null`.

- [ ] **Step 1: Failing tests** — `taskDefinitionSchema` принимает включённую `stock_count` с `items: []` и валидным `count_config`; отвергает `stock_count` без `count_config` с сообщением «Для включения задачи укажите склад и позиции взвешивания»; `checklist` без `items` — прежнее сообщение.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** схему и UI.
- [ ] **Step 4: Run tests PASS; `pnpm exec tsc --noEmit`, `pnpm lint` → чисто.** Вручную в `pnpm dev`: создать задачу вида «Взвешивание табака», заполнить по умолчанию, сохранить, включить.
- [ ] **Step 5: Commit** — `feat(schedule): настройка задачи «Взвешивание табака»`

---

### Task 4: Экран взвешивания и сдача

**Files:**
- Create: `src/app/(dashboard)/schedule/tasks/weighing-report.tsx` (client)
- Create: `src/app/(dashboard)/schedule/tasks/weighing-actions.ts` (`"use server"`)
- Modify: `src/app/(dashboard)/schedule/_components/schedule-client.tsx` (~L1754: для `snapshot.kind === 'stock_count'` рендерить `WeighingReport` вместо `CalendarTaskReport`)
- Modify: `src/app/(dashboard)/schedule/tasks/actions.ts` (`loadCalendarTasks` отдаёт `kind`, `count_config` из snapshot и `stock_count_commits.status/last_error`)

**Interfaces:**
- Consumes: Task 1 (`weighingDraftSchema`, `submitErrors`, `weighingWarnings`, `netKgBySection`, `parseGramsInput`); Task 2 (`stock_count_command`).
- Produces:
  - `saveWeighingDraft(input: { occurrenceId: string; version: number; draft: WeighingDraft }): Promise<ActionResult<{ version: number }>>`
  - `submitWeighing(input: { occurrenceId: string; version: number; draft: WeighingDraft }): Promise<ActionResult<{ version: number }>>` — серверно повторяет `submitErrors` (непустой → ошибка первой строкой), затем `stock_count_command('run.submit')`, затем один синхронный вызов `processStockCountCommit(occurrenceId)` (Task 6) без ожидания результата для ответа мастеру.
  - `uploadWeighingPhoto(form: FormData /* occurrenceId, file */): Promise<ActionResult<{ path: string; url: string }>>` — путь `{occurrenceId}/weighing/{uuid}.{ext}`, проверка magic bytes как в `uploadTaskPhoto`, показ через `mediaUrl("task-evidence", path)`.

UI: разделы со счётчиком нетто, партия = поле граммов (`inputMode="numeric"`), строки тары (select + количество), фото (`accept="image/*" capture="environment"`), «+ Партия», «В разделе ничего нет»; `startedAt` ставится при первой сохранённой партии; «Сохранить» и «Завершить взвешивание» с диалогом подтверждения (текст из спеки §2, включая фразу о зарплате подразделения); после сдачи — режим чтения и статус проведения: «Акт проводится…», «Акт № … проведён», «Ошибка проведения: <текст>».

- [ ] **Step 1: Failing test** в `src/lib/stock-count/tobacco-weighing.test.mts`: `submitErrors` для черновика с `startedAt: null` и партиями → `["Сохраните взвешивание перед сдачей"]` (защита: дата акта берётся из `startedAt`).
- [ ] **Step 2: Run FAIL → implement → PASS.**
- [ ] **Step 3: Implement** actions и экран.
- [ ] **Step 4: Verify** — `tsc`, `lint`; в `pnpm dev` на мобильном вьюпорте (375×812): заполнить 2 партии с фото, «Сохранить», перезагрузить — черновик на месте; «Завершить» — задание `completed`, строка в `stock_count_commits` `pending`; ввод «6.666» показывает ошибку.
- [ ] **Step 5: Commit** — `feat(schedule): экран взвешивания табака`

---

### Task 5: Общая функция фиксации итогов акта

**Files:**
- Create: `src/app/(dashboard)/inventory/finalize-core.ts` (`import "server-only"`)
- Modify: `src/app/(dashboard)/inventory/_actions/results.ts` (`finalizeInventoryResults` = проверка прав + вызов core + уведомления/автопересчёт как сейчас)

**Interfaces:**
- Produces: `finalizeInventoryDocumentCore(input: { admin: LooseDb; accountId: string; documentId: string; actorUserId: string; source: "manual" | "weighing" | "import"; skipDriftCheck?: boolean }): Promise<{ error: string | null; alreadyFinalized?: boolean }>` — всё, что сейчас идёт в `finalizeInventoryResults` от чтения документа до `transitionDocumentStatus`/записи сумм включительно: ветка `alreadyProcessedInQr`, сверка перед проведением (пропускается при `skipDriftCheck`), `freeze_inventory_result_snapshot`, проведение, постусловие, суммы. Без `getActiveContext`, без `notifyInventoryDocumentEvent`, без `autoRecalculateInventoryDeduction` — их оставляет вызывающий. `writeInventoryResultEvent` пишет с `actorUserId` и `details.source`.

- [ ] **Step 1: Pure refactor** — перенести код, сигнатуру и тексты ошибок не менять для `source: "manual"`.
- [ ] **Step 2: Verify** — `node --test --experimental-strip-types "src/**/*.test.mts"` PASS; `tsc`, `lint`; в `pnpm dev` подвести итоги тестового акта из seed — поведение как до правки.
- [ ] **Step 3: Commit** — `refactor(inventory): фиксация итогов акта вынесена в общую функцию`

---

### Task 6: Воркер проведения взвешивания

**Files:**
- Create: `src/lib/stock-count/commit-worker.ts` (`import "server-only"`)
- Create: `src/lib/stock-count/commit-plan.ts` (чистые функции) + `commit-plan.test.mts`
- Modify: `src/app/api/cron/payroll/route.ts` (после `processScheduleTasks()` — `processStockCountCommits()` в своём `try/catch`, счётчик ошибок как у задач)

**Interfaces:**
- Consumes: Task 1 (`netKgBySection`), Task 5 (`finalizeInventoryDocumentCore`), Task 7 (`sendWeighingReport`), QR-клиент: `loginQuickRestoBackOffice`, `createInventoryDocumentBackOffice`, `createInventoryItemBackOffice`, `listInventoryItemsBackOffice`, `removeInventoryDocumentBackOffice`, `listInventoryDocuments`; из `actions-shared`: `refreshLocalInventoryDocumentFromPayload`, `getConnection`, `connectionPassword`; `inventoryDocumentNumber` из `src/lib/integrations/quickresto/normalize.ts` (номер акту присваивает QR — как в `splitDocumentForRecount`, `recount.ts:334`).
- Produces:
  - `commitMarker(occurrenceId: string): string` → `"sheerly:weighing:<occurrenceId>"`
  - `findMarkedDocument(docs: QuickRestoInventoryDocument2[], marker: string): QuickRestoInventoryDocument2 | null` (не удалённые, `comment` содержит маркер)
  - `missingLines(existing: QuickRestoInventoryItem2[], wanted: Array<{ externalProductId: number; kg: number }>): Array<{ externalProductId: number; kg: number }>`
  - `nextAttemptAt(attempts: number, now: Date): Date` (1, 5, 15, 60 мин; после 5-й неудачи → `failed`)
  - `processStockCountCommits(limit?: number): Promise<{ done: number; failed: number }>`
  - `processStockCountCommit(occurrenceId: string): Promise<void>`

Порядок шага (захват строки `pending` → `processing` условным update `.eq("status","pending").select("id")`):
1. Найти акт в QR по маркеру среди актов склада за последние 30 дней; нет — создать (`invoiceDate = Date.parse(draft.startedAt)`, `comment = "<Имя мастера> · <маркер>"`), сразу записать `qr_document_id`.
2. Добавить недостающие позиции: образец строки — последняя `document_items.raw_payload` с тем же `external_product_id` (из импортированных актов, Task 8); нет образца → `failed` «Нет образца позиции …: сначала загрузите прежние акты склада».
3. Upsert локального `documents` (`document_kind='inventory'`, склад, `assigned_to` = исполнитель, `status='ready_for_review'`), строки — `refreshLocalInventoryDocumentFromPayload`; `document_id` в commit.
4. `finalizeInventoryDocumentCore({ source: "weighing", actorUserId: исполнитель, skipDriftCheck: true })`.
5. `sendWeighingReport` (Task 7); ошибка Telegram → `telegram_status='failed'`, commit всё равно `done`.
6. Сбой до первой позиции в свежесозданном акте → `removeInventoryDocumentBackOffice` и `qr_document_id = null`.
Ошибка любого шага → `attempts+1`, `last_error` (русский текст), `next_attempt_at`, статус `pending` или `failed`; при `failed` — уведомление управляющим через `notifyInventoryDocumentEvent`-аналог категории «Инвентаризация» (если документа ещё нет — через уведомление задачи графика).

- [ ] **Step 1: Failing tests** для `commitMarker`, `findMarkedDocument` (удалённый акт с маркером игнорируется), `missingLines` (повтор после частичного создания добавляет только недостающую позицию), `nextAttemptAt` (5-я неудача → `null`, значит failed).
- [ ] **Step 2: Run FAIL → implement → PASS.**
- [ ] **Step 3: Implement** `commit-worker.ts` и подключение к cron.
- [ ] **Step 4: Verify** — `tsc`, `lint`, все тесты. Интеграционно — только на тестовом QR-слое, если он есть; иначе в Task 9 на проде первым реальным взвешиванием под присмотром.
- [ ] **Step 5: Commit** — `feat(stock-count): воркер проведения взвешиваний`

---

### Task 7: PDF итогов и Telegram

**Files:**
- Modify: `src/lib/integrations/telegram-bot.ts` (`sendDocument(chatId: string, file: Blob, filename: string, caption: string): Promise<TelegramApiResult<unknown>>` через существующий `upload`, `parse_mode: "HTML"`)
- Modify: `src/lib/integrations/quickresto/client.ts` (`downloadInventoryResultsPdfBackOffice(input: { layerName: string; baseUrl?: string | null; authorization: string; documentId: number }): Promise<Blob>` — `GET /platform/report/warehouse.inventory.document.v2/?<encodeURIComponent(JSON.stringify({actionName:"inventoryResults",data:{start:0,count:150,mode:"previous30Days",timeZone:0},ids:[documentId]}))>`; не-PDF ответ → ошибка «Quick Resto не отдал PDF акта»)
- Create: `src/lib/stock-count/report.ts` (`buildWeighingCaption(input: { documentNumber: string; employeeName: string; lines: Array<{ title: string; kg: number; deltaKg: number | null; deltaSum: number | null }>; url: string }): string`; `sendWeighingReport(…)` — до 3 попыток скачать PDF с паузой 5 с, затем `sendDocument`; без PDF — `sendMessage` с той же подписью)
- Test: `src/lib/stock-count/report.test.mts`

- [ ] **Step 1: Failing test** — `buildWeighingCaption` даёт ровно:
```
📊 <b>Взвешивание табака СВ512</b>
Сотрудник: Сергей Попов
Стандарт: 52,418 кг (−0,215 кг · −1 455 ₽)
Премиум: 8,912 кг (+0,040 кг · +572 ₽)
Парфюм: 0,259 кг (0,000 кг · 0 ₽)
<a href="https://sheerly.app/documents/inventory/…">Акт в Sheerly</a>
```
и экранирует `<`/`&` в имени.
- [ ] **Step 2: Run FAIL → implement → PASS.**
- [ ] **Step 3: Commit** — `feat(stock-count): PDF итогов взвешивания в Telegram`

---

### Task 8: Блок «Взвешивание» в акте и загрузка актов с 01.10

**Files:**
- Create: `src/app/(dashboard)/documents/inventory/[id]/_components/weighing-block.tsx` (партии, тара, нетто, фото через `mediaUrl`, исполнитель, время, ссылка на задание; статус проведения и кнопка «Повторить» → `stock_count_retry`)
- Modify: `src/app/(dashboard)/documents/inventory/[id]/overview/page.tsx` (показывать блок, если есть `stock_count_commits.document_id = id`)
- Create: `src/app/(dashboard)/dev/import-store-acts/page.tsx` + `actions.ts` (доступ — владелец аккаунта с `inventory.finalize_results`, иначе `notFound()`)
- Create: `src/lib/stock-count/import-plan.ts` + `import-plan.test.mts`

**Interfaces:**
- Consumes: Task 5 (`finalizeInventoryDocumentCore`), QR `listInventoryDocuments`, `listInventoryItemsBackOffice`, `refreshLocalInventoryDocumentFromPayload`.
- Produces:
  - `classifyImportCandidate(doc: { processed: boolean; deleted: boolean; invoiceDate: string; productIds: number[] }, opts: { from: string; allowedProductIds: number[]; knownExternalIds: Set<number>; externalId: number }): { import: true } | { import: false; reason: "не проведён" | "удалён" | "раньше даты" | "уже в Sheerly" | "другие позиции" }`
  - `previewStoreActsImport(input: { storeId: string; from: string /* YYYY-MM-DD */ }): Promise<ActionResult<{ toImport: Row[]; skipped: Array<Row & { reason: string }> }>>`
  - `runStoreActsImport(input: { storeId: string; from: string; externalIds: number[] }): Promise<ActionResult<{ imported: number; failed: Array<{ externalId: number; error: string }> }>>` — upsert документа (`status='processed'`, `processed=true`), строки, затем `finalizeInventoryDocumentCore({ source: "import" })` (ветка «уже проведён в QR» — без повторного проведения); одна запись `writeAuditEvent` на запуск.

- [ ] **Step 1: Failing tests** для `classifyImportCandidate` по каждой причине и для акта только с 417/420/1892 → `{ import: true }`.
- [ ] **Step 2: Run FAIL → implement → PASS.**
- [ ] **Step 3: Implement** страницу (таблица «Будет загружено» / «Пропущено — почему», кнопка «Загрузить N актов») и блок в акте.
- [ ] **Step 4: Verify** — `tsc`, `lint`, тесты; в `pnpm dev` предпросмотр на локальной БД не падает при отсутствии подключения QR (понятная ошибка).
- [ ] **Step 5: Commit** — `feat(inventory): блок взвешивания в акте и загрузка проведённых актов склада`

---

### Task 9: Справка, PR, запуск

**Files:**
- Modify: `docs/handbook/schedule/index.md` (вид задачи «Пересчёт», взвешивание)
- Create: `docs/handbook/inventory/tobacco-weighing.md` (как взвешивать, тара, что после «Завершить», почему влияет на зарплату подразделения, «Ошибка проведения» и «Повторить», ночное внеплановое взвешивание)
- Modify: `docs/handbook/inventory/index.md` (ссылка)

- [ ] **Step 1: Handbook** — с точки зрения пользователя, без имён таблиц/функций.
- [ ] **Step 2: Full check** — `pnpm exec tsc --noEmit`, `pnpm lint`, `node --test --experimental-strip-types "src/**/*.test.mts"` — всё зелёное; `git fetch origin main` и проверка, что номер миграции свободен.
- [ ] **Step 3: Commit, push, PR в `main`**, дождаться зелёного CI; мерж — только по слову Павла.
- [ ] **Step 4: Запуск (после мержа, по согласованию с Павлом):**
  1. Миграцию `386` применить на прод через SSH (`-U supabase_admin`), строку в `supabase_migrations.schema_migrations`; задеплоить приложение.
  2. Перепроверить привязку склада «Кальяны / Зал» → «Кальяны».
  3. `/dev/import-store-acts`: склад «Кальяны / Зал», с 01.10.2026 → показать Павлу список → загрузить.
  4. Проверить, что бот Sheerly в чате `-1001769090305`, чат есть в списке чатов; пробное сообщение.
  5. Создать задачу «Взвешивание табака» (раз в неделю, якорь — ближайший вторник, шаблон утренней кальянной смены — выбрать с Павлом, приёмка авто, штраф — сумму задаёт Павел), включить.
  6. Выключить n8n `w4McP4MixWcHcXq2` (unpublish), закрыть приём ответов формы с текстом «Взвешивание теперь в Sheerly → График → задача смены».
  7. Повторить импорт (догрузить акты между шагами 3 и 6).
  8. Попросить Павла или управляющего пересчитать октябрь и ноябрь: «Зарплата → Добавить → Пересчитать недостачу за месяц».
  9. Первое реальное взвешивание — проверить акт в QR, документ в Sheerly, PDF в чате.
