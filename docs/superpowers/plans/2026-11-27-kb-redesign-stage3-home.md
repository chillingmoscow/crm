# База знаний, этап 3: Главная и Обзор — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новая главная сотрудника, «Обзор» вместо «Дашборда», страница «Кто прочитал» на общих компонентах, кнопка «Напомнить» и перечитывание обязательной страницы только по кнопке менеджера.

**Architecture:** Состояние обязательного чтения переезжает в отдельную таблицу `kb_page_reading_state` (порог «перечитать начиная с версии», «не нужно» до версии, время последнего напоминания), чтобы не трогать `kb_pages.updated_at` и его триггеры аудита. Чтение считается действующим, если `read_version >= coalesce(reread_from_version, 1)` — правка страницы прочтения больше не сбрасывает, уже прочитанное до миграции не сбрасывается. Состав «кто должен прочитать» — одна SQL-функция `kb_required_reading_roster`, на ней стоят статистика, «Напомнить» и «Попросить перечитать». Действия менеджера — SECURITY DEFINER RPC, которые сами пишут уведомления и журнал; из приложения их зовут server actions в `actionResult`. В TypeScript правило «прочтение действует» — одна чистая функция с тестами, её используют все места, где сейчас повторяется сравнение версий.

**Tech Stack:** Next.js 15 (RSC + server actions), Supabase (Postgres, SECURITY DEFINER RPC), node:test, SQL-тест в `supabase/tests`.

**Spec:** `docs/superpowers/specs/2026-11-27-kb-redesign-design.md` — разделы «Документ» (перечитывание), «Главная», «Обзор», «Служебные страницы» («Кто прочитал»), «Новое: Напомнить», «Решения по вопросам проверки», этап 3. Макет `2026-11-27-kb-redesign-screens-mockup.html` — экраны 2 и 3.

## Global Constraints

- Правила `docs/design-system.md`: кегли 12/13/14/16/20/28/36, `data-tip` вместо `title`, тексты без длинных тире, подтверждения только через `ConfirmDialog` / `useConfirm`, статусы только `StatusBadge`, люди — `EmployeeIdentity` / `PersonAvatar`, пустые места — `EmptyState`.
- Server action, вызываемый из браузера, — в `actionResult(fn, "<русский fallback>")`, клиент разворачивает `unwrapAction`; тексты `raise exception` — по-русски.
- Миграция `416_kb_reading_state.sql`: `set search_path = public, pg_catalog` в каждой функции, `(select auth.uid())` в политиках, `revoke … from public, anon` и явный `grant … to authenticated`, серверная функция — revoke и у `authenticated`, проверочный `do $$ … has_function_privilege … raise exception` в конце, `notify pgrst, 'reload schema'`. Перед мержем — сверить номер с `origin/main`.
- Журнал: коды `kb_page.reread_requested`, `kb_page.reminder_sent`, `kb_page.reread_dismissed`, фраза каждому в `src/lib/audit/format.tsx` и в `K/audit/_components/kb-audit-event-row.tsx`.
- Права: «Обзор» открывается при `canOpenKbOverview` (аналитика, обязательное чтение или журнал), каждый блок — при своём праве; «Напомнить», «Попросить перечитать», «Не нужно», «Кто прочитал» — `kb.manage_required_reading`.
- Публичного API не добавляем; новые RPC — только для `authenticated` с проверкой права внутри.
- Проверки: `pnpm exec tsc --noEmit` (кроме `.next/`), `pnpm lint`, `node --test --experimental-strip-types --experimental-vm-modules "src/**/*.test.mts"`, SQL-тест через `docker exec -i supabase_db_crm psql -U postgres -d postgres -f - < supabase/tests/kb-reading-state.sql`.

## Review Focus

1. Автор правит обязательную страницу, которую уже прочитали: сотрудники остаются «прочитал», менеджер видит «Изменена после прочтения · Попросить перечитать»; после нажатия — у прочитавших «Нужно перечитать» и уведомление, у самого менеджера уведомления нет. → SQL-тест (Task 1) + ручная проверка.
2. «Напомнить» дважды за сутки по одной странице: второй раз — понятный отказ по-русски, уведомления не дублируются; уволенные и сам менеджер уведомлений не получают. → SQL-тест (Task 1).
3. Сотрудник без `kb.manage_required_reading` зовёт новые RPC напрямую через `/rest/v1/rpc`: отказ, ничего не меняется. → SQL-тест (Task 1).
4. Старые ссылки `/knowledge/dashboard`, `/knowledge/dashboard/<slug>`, `/knowledge/analytics/<slug>` ведут на «Обзор» и статистику страницы. → ручная проверка (Task 9).
5. «Обзор» у человека только с одним из трёх прав: видны только его блоки, пустых мест нет. → тест `kbOverviewBlocks` (Task 6) + ручная проверка.

---

### Task 1: Миграция — состояние чтения, состав, «Напомнить», «Попросить перечитать»

**Files:**
- Create: `supabase/migrations/416_kb_reading_state.sql`
- Create: `supabase/tests/kb-reading-state.sql`
- Modify: `src/types/database.ts` (точечно новые таблица и функции, не полный regen — см. CLAUDE.md)

**Interfaces:**
- Produces (SQL):
  - Таблица `kb_page_reading_state(page_id uuid pk, account_id uuid not null, reread_from_version int, reread_dismissed_version int, reminded_at timestamptz, updated_at timestamptz default now())`, FK `(account_id, page_id) → kb_pages(account_id, id) on delete cascade`, индекс `(account_id, page_id)`. RLS: select — в своём аккаунте при `kb.view_pages`; записи только через функции ниже.
  - `kb_required_reading_roster(p_account_id uuid) returns setof uuid` — активные (`uvr.status='active' and uvr.fired_at is null`) пользователи аккаунта, чья роль даёт `kb.view_pages`. Только для других функций: execute отозван у `public, anon, authenticated`.
  - `kb_get_page_view_data(p_page_id)` — переопределена: `needs_reread := my_read_version < coalesce(reread_from_version, 1)`, `my_read_at` — время действующего прочтения; новых полей нет.
  - `kb_list_required_reading_stats(p_page_id)` — `drop` + `create` с колонками `user_id, first_name, last_name, avatar_url, read_at timestamptz, read_version int, status text` (`'read' | 'reread' | 'unread'`), состав — из `kb_required_reading_roster`.
  - `kb_required_reading_overview(p_page_id uuid default null) returns table(page_id, slug, title, icon, icon_color, current_version int, total int, read_count int, reread_count int, unread_count int, changed_after_read boolean, reminded_at timestamptz, last_edited_at timestamptz)` — по всем живым обязательным страницам аккаунта (или одной). `changed_after_read`: есть действующее прочтение с `read_version < current_version` и `current_version > coalesce(reread_dismissed_version, 0)`. `last_edited_at` — `max(kb_page_versions.updated_at)`. Право `kb.manage_required_reading`, иначе пусто.
  - `kb_request_reread(p_page_id uuid) returns integer` — `reread_from_version := current_version`, `reread_dismissed_version := null`; уведомление `kb.reread_requested` тем из состава, у кого действующее прочтение было, кроме автора действия; `log_audit('kb_page.reread_requested', 'kb_page', id, {title, notified})`; возвращает число уведомлённых.
  - `kb_dismiss_reread(p_page_id uuid) returns void` — `reread_dismissed_version := current_version`, журнал `kb_page.reread_dismissed`.
  - `kb_remind_unread(p_page_id uuid) returns integer` — если `reminded_at > now() - interval '1 day'` → `raise exception 'Напоминание по этой странице уже отправляли за последние сутки'`; уведомление `kb.required_reading_reminder` тем из состава без действующего прочтения, кроме автора; `reminded_at := now()`; журнал `kb_page.reminder_sent` с `{title, notified}`.
  - Все три действия: `has_permission('kb.manage_required_reading')`, страница живая, в активном аккаунте и обязательная — иначе `raise exception` по-русски («Нет права управлять обязательным чтением», «Страница не обязательна к прочтению»).
  - Уведомления — `insert into notifications(user_id, venue_id, type, category 'kb', title, body, link '/knowledge/<slug>', actor_user_id, entity_type 'kb_page', entity_id, payload {page_title, page_icon, page_icon_color})` по образцу `kb_notify_required_reading()` (`173:482-539`).

- [ ] **Step 1: Написать SQL-тест** `supabase/tests/kb-reading-state.sql` (образец — `01_legal_entities.sql`: `\set ON_ERROR_STOP on`, `begin … rollback`, `test_assert`). Сценарии на seed-аккаунте, роли через `set local request.jwt.claims`:
  - сотрудник прочитал версию 1, автор сохранил версию 2 → `kb_get_page_view_data` даёт `needs_reread = false`, `my_read_at` не null; `overview.changed_after_read = true`;
  - менеджер зовёт `kb_request_reread` → возвращает 1, у сотрудника `needs_reread = true`, в `notifications` одна строка `kb.reread_requested` для сотрудника и ни одной для менеджера, в `audit_logs` строка `kb_page.reread_requested`;
  - `kb_dismiss_reread` → `changed_after_read = false` до следующей версии;
  - `kb_remind_unread` → число = непрочитавшие без менеджера; второй вызов → исключение с текстом про сутки; уволенный (`fired_at` задан) уведомления не получает;
  - сотрудник без права зовёт `kb_request_reread` / `kb_remind_unread` → исключение, `kb_page_reading_state` не изменилась;
  - `has_function_privilege('anon', 'kb_remind_unread(uuid)', 'execute') = false`, `has_function_privilege('authenticated', 'kb_required_reading_roster(uuid)', 'execute') = false`.
- [ ] **Step 2: Применить тест к текущей базе** — Expected: падает (таблицы и функций нет).
- [ ] **Step 3: Написать миграцию 416** по интерфейсам выше; старые прочтения не трогать (`reread_from_version` у всех страниц — null).
- [ ] **Step 4: `pnpm db:reset`, прогнать SQL-тест** — Expected: `passed`.
- [ ] **Step 5: Добавить типы** новых таблицы и функций в `src/types/database.ts`, `pnpm exec tsc --noEmit` — Expected: 0 ошибок вне `.next`.
- [ ] **Step 6: Commit** `База знаний: состояние чтения, «Напомнить» и перечитывание по кнопке (миграция 416)`.

### Task 2: Правило «прочтение действует» в TypeScript и плашка документа

**Files:**
- Create: `src/lib/knowledge/reading-state.ts`, `src/lib/knowledge/reading-state.test.mts`
- Modify: `src/lib/knowledge/landing.ts`, `src/lib/knowledge/required-reading.ts`, `src/lib/knowledge/document.ts` (+ test), `K/_components/kb-required-reading-banner.tsx`, `K/[slug]/page.tsx`
- Create: `src/lib/knowledge/reading-actions.ts` (server actions)

**Interfaces:**
- Consumes: RPC из Task 1.
- Produces:
  - `kbReadIsCurrent(readVersion: number | null, rereadFromVersion: number | null): boolean` — `readVersion !== null && readVersion >= (rereadFromVersion ?? 1)`.
  - `KbRequiredUnreadRow` получает `reread: boolean` (читал раньше, просят перечитать).
  - `getKbRequiredReadingOverview(pageId?: string): Promise<KbRequiredReadingOverviewRow[]>` — обёртка RPC, ошибка → `console.error` и `[]`.
  - Server actions в `actionResult`: `requestKbReread(pageId): Promise<ActionResult<{ notified: number }>>`, `remindKbUnread(pageId): Promise<ActionResult<{ notified: number }>>`, `dismissKbReread(pageId): Promise<ActionResult<void>>`; каждое — `revalidatePath("/knowledge", "layout")`.
  - `kbReadingPlate` получает поле менеджера `changedAfterRead: boolean`; плашка показывает справа «Изменена после прочтения» + outline «Попросить перечитать» (через `useConfirm`: заголовок «Попросить перечитать „<название>“?», текст «N человек снова увидят её в „К прочтению“», тон `warning`).

- [ ] **Step 1: Тесты** `reading-state.test.mts`: `kbReadIsCurrent(null, null) === false`; `(1, null) === true`; `(1, 2) === false`; `(2, 2) === true`; `(3, 2) === true`. В `document.test.mts`: при `changedAfterRead` у менеджера плашка `read` и `unread` несут флаг, у сотрудника без права — нет.
- [ ] **Step 2: Прогнать** — Expected: FAIL (нет модуля / поля).
- [ ] **Step 3: Реализовать** `reading-state.ts`; перевести `getKbRequiredUnreadForUser` (читает `kb_page_reading_state` для обязательных страниц через `fetchAllRows`/`chunk`) и `getKbRequiredReadingCoverage` на `kbReadIsCurrent`; удалить `getKbPageReadStatus`, если вызовов нет (`grep`); `markKbPageAsRead` без изменений.
- [ ] **Step 4: Server actions и плашка**; на странице документа счётчик берётся из `getKbRequiredReadingOverview(row.id)` вместо подсчёта строк статистики.
- [ ] **Step 5: Прогнать тесты, tsc, lint** — Expected: PASS, 0 ошибок.
- [ ] **Step 6: Commit** `База знаний: прочтение не сбрасывается правкой, «Попросить перечитать» на плашке`.

### Task 3: Уведомления и журнал

**Files:**
- Modify: `src/lib/notifications/registry.ts`, `src/lib/audit/format.tsx`, `K/audit/_components/kb-audit-event-row.tsx`, при необходимости `src/lib/audit/action-categories.ts`
- Test: соседний тест реестра уведомлений / фраз журнала, если есть (`grep -l registry src/**/*.test.mts`), иначе новый `src/lib/notifications/registry.test.mts`

**Interfaces:**
- Produces: типы `kb.reread_requested` (глагол «просит перечитать»), `kb.required_reading_reminder` («напоминает прочитать») в `REGISTRY`, категория `kb`, значок как у `kb.required_reading_assigned`. Фразы журнала: «попросил перечитать», «напомнил прочитать (N человек)», «отметил, что перечитывать не нужно».

- [ ] **Step 1: Тест**: оба типа есть в `REGISTRY` с категорией `kb`; три кода журнала дают не общую подпись (через функцию форматирования из `format.tsx`); категории действий: `reread_requested` и `reminder_sent` → «Создание», `reread_dismissed` → «Изменение».
- [ ] **Step 2: Прогнать** — FAIL.
- [ ] **Step 3: Реализовать**, **Step 4: PASS**, **Step 5: Commit** `База знаний: уведомления и журнал для «Напомнить» и перечитывания`.

### Task 4: «Кто прочитал»

**Files:**
- Modify: `K/[slug]/required-reading/page.tsx`
- Create: `K/_components/kb-reading-actions.tsx` (кнопки «Напомнить» и «Попросить перечитать», общие для «Кто прочитал» и «Обзора»)

**Interfaces:**
- Consumes: `getKbRequiredReadingStats` (колонки `status`, `read_version`), `getKbRequiredReadingOverview(pageId)`, actions из Task 2.
- Produces: `KbReadingActions({ pageId, title, unreadCount, rereadCount, changedAfterRead, remindedAt, size? })` — «Напомнить» (outline, неактивна с `data-tip` «Уже напоминали сегодня», если `remindedAt` моложе суток; после успеха — `toast.success("Напомнили N людям")` через `countRu`), «Попросить перечитать» (только при `changedAfterRead`, `useConfirm`).

- [ ] **Step 1:** `ProfilePageFrame`, шапка «Кто прочитал» 36px, карточка страницы (`KbPageIcon` + название-ссылка + «Прочитали N из M»), справа `KbReadingActions`.
- [ ] **Step 2:** список людей — `EmployeeIdentity` (имя, должность, аватар), справа `StatusBadge`: `success` «Прочитал 27.11», `warning` «Нужно перечитать», `neutral` «Не прочитал»; порядок — не прочитавшие, нужно перечитать, прочитавшие. Пусто (никого в составе) — `EmptyState`.
- [ ] **Step 3: tsc, lint**; **Step 4: Commit** `База знаний: «Кто прочитал» на общих компонентах, «Напомнить»`.

### Task 5: Главная

**Files:**
- Modify: `K/page.tsx`, `src/lib/knowledge/landing.ts`
- Create: `K/_components/kb-home-to-read.tsx`, `K/_components/kb-home-sections.tsx`, `src/lib/knowledge/home.ts` + `home.test.mts`
- Create: `src/components/shared/progress-ring.tsx` (вынести `PlanRing` из `sales/shifts/_components/month-plan.tsx`, тот переходит на общий)

**Interfaces:**
- Produces:
  - `kbHomeSections(tree: KbTreeNode[]): { id, slug, title, icon, iconColor, pageCount }[]` — страницы верхнего уровня, `pageCount` — все потомки (без самой страницы).
  - `ProgressRing({ ratio, forecast?, size?: 88, children })` — кольцо по DS (`docs/design-system.md:1369`).

- [ ] **Step 1: Тест** `kbHomeSections`: дерево из двух разделов (3 и 0 потомков) → `pageCount` 3 и 0, порядок как в дереве, удалённых нет.
- [ ] **Step 2: FAIL**, **Step 3: реализовать**, **Step 4: PASS**.
- [ ] **Step 5: Страница**: `PageFrame`, `TablePageHeader title="База знаний"` без описания, действие «Создать страницу» при `kb.create_pages`. Блоки (`HomeSection` с «Сегодня»):
  - `id="to-read"` «К прочтению · N»: `ProgressRing` с процентом прочитанного, строки страниц с «Читать», у `reread` — `StatusBadge tone="info"` «Обновлено»; всё прочитано — галочка и «Всё обязательное прочитано»; блока нет, если обязательных страниц нет;
  - «Разделы» — плитки: значок в подложке цвета страницы, название, `countRu(n, "страница", "страницы", "страниц")`;
  - «Недавно обновлённые» и «Избранное» — строки как на «Сегодня» (`KbLandingSection`), пустые блоки скрыты; «Мои недавние» уходят (их нет в спеке, недавние и так в «Недавно обновлённых» и дереве);
  - база пустая — `EmptyState` с «Создать страницу» при праве.
- [ ] **Step 6: tsc, lint, Commit** `База знаний: новая главная`.

### Task 6: «Обзор» — адрес, переходы, права блоков

**Files:**
- Move: `K/dashboard/**` → `K/overview/**` (`page.tsx`, `[slug]/page.tsx`, `loading.tsx`, `error.tsx`)
- Modify: `next.config.ts` (redirects), `src/lib/knowledge/shell.ts` (+ test), `K/_components/kb-tree-nav.tsx`, `src/components/shared/sidebar.tsx`, `K/[slug]/page.tsx`, `K/analytics/_components/kb-analytics-top-pages.tsx`, `src/lib/knowledge/analytics.ts`
- Create: `src/lib/knowledge/overview.ts` + `overview.test.mts`

**Interfaces:**
- Produces:
  - Адреса `/knowledge/overview` и `/knowledge/overview/[slug]`; постоянные переходы `/knowledge/dashboard` → `/knowledge/overview`, `/knowledge/dashboard/:slug*` → `/knowledge/overview/:slug*`, `/knowledge/analytics` → `/knowledge/overview`, `/knowledge/analytics/:slug*` → `/knowledge/overview/:slug*`.
  - `kbOverviewBlocks(perms: ReadonlySet<string>): { metrics, attention, popular, trend, changes, pagesView: boolean }` — метрики, популярное, тренд, «По страницам» — `kb.view_analytics`; «Требует внимания» — `kb.manage_required_reading`; «Последние изменения» — `org.view_audit`.
  - Период: `KbOverviewPeriod = { kind: "week" | "month"; start: string }` (`YYYY-MM-DD` понедельник / `YYYY-MM`), `parseKbOverviewPeriod(searchParams, today)`, `shiftKbOverviewPeriod(period, ±1)`, `kbOverviewWindow(period): { sinceISO, untilISO }`; функции `analytics.ts` принимают окно вместо `day|week|month`.
  - Ссылка «Обзор» в дереве, в меню приложения (при `kb.view_analytics`, как сейчас) и «Статистика страницы» в ⓘ — на новые адреса.

- [ ] **Step 1: Тесты** `overview.test.mts`: `kbOverviewBlocks` для каждого из трёх прав по отдельности и для всех; `parseKbOverviewPeriod` по умолчанию — текущая неделя с понедельника; `shiftKbOverviewPeriod` через границу года; `kbOverviewWindow` недели — 7 суток с понедельника. `shell.test.mts`: пункт «Обзор» ведёт на `/knowledge/overview`.
- [ ] **Step 2: FAIL**, **Step 3: реализовать, перенести маршруты, переходы**, **Step 4: PASS, tsc, lint**.
- [ ] **Step 5: Commit** `База знаний: «Обзор» по адресу /knowledge/overview, период неделя или месяц`.

### Task 7: «Обзор» — содержимое

**Files:**
- Modify: `K/overview/page.tsx`, `K/overview/[slug]/page.tsx`
- Create: `K/overview/_components/{kb-overview-attention.tsx, kb-overview-popular.tsx, kb-overview-pages-table.tsx}`
- Delete (если больше нигде не используются): `K/analytics/_components/kb-analytics-period-tabs.tsx`, `kb-analytics-view-tabs.tsx`, `src/components/knowledge/kb-stat-card.tsx`, `K/_components/kb-monthly-trend.tsx`

**Interfaces:**
- Consumes: `kbOverviewBlocks`, период из Task 6, `getKbRequiredReadingOverview()`, `KbReadingActions`, `getKbAnalytics*`, `getKbMonthlyTrend`, `loadAuditFeedPage` / `AuditEventRow`.

- [ ] **Step 1: Шапка**: `TablePageHeader title="Обзор"`, `period` — `PeriodStepper` (переключатель «Неделя / Месяц» + стрелки), действия — outline «Обновить поиск ИИ» (бывшая «Переиндексировать», те же права), вид «Обзор / По страницам» — `?view=pages`.
- [ ] **Step 2: `MetricStrip`**: «Обязательное прочитано» (% по `overview`: `read_count / total`), «Читали» (N из M сотрудников), «Время чтения» с `hint` сравнения с прошлым периодом, «Изменений». Метрика без права не рисуется.
- [ ] **Step 3: «Требует внимания»** (разметка строки — как `attention-block.tsx:64-82`): по каждой обязательной странице с непрочитавшими — «Не прочитали „…“ · N человек» + `KbReadingActions` («Напомнить»); с `changed_after_read` — «„…“ изменена после прочтения» + «Попросить перечитать» и ghost «Не нужно» (`dismissKbReread`); страницы без правок 6 месяцев — одной строкой «N страниц не обновлялись полгода» со ссылкой на «По страницам», отсортированные по дате правки. Пусто — «Всё в порядке» как на «Сегодня».
- [ ] **Step 4: «Популярное за период»** — рейтинг как в «Допродажах» (`upsell-ranking.tsx` :127-160: место в круге 24px, значок и название страницы, время, полоса доли); «По месяцам» — `SalesTrend` (просмотры и время), не рисуется при данных меньше чем за 3 месяца; «Последние изменения» — 6 строк `AuditEventRow` по `kb_page` и ссылка «Весь журнал» на `/org/audit?sections=kb`.
- [ ] **Step 5: «По страницам»** — `DataTable`: страница, просмотры, время, «Прочитали N из M» (для обязательных), «Обновлена»; сортировка по колонкам, `?sort=updated` из строки «давно не обновлялись».
- [ ] **Step 6: Статистика страницы** (`overview/[slug]`): `ProfilePageFrame`, `MetricStrip`, читатели — `EmployeeIdentity` вместо своего `Avatar`.
- [ ] **Step 7: tsc, lint, Commit** `База знаний: «Обзор» — показатели, «Требует внимания», популярное, по страницам`.

### Task 8: Дизайн-система и справка

**Files:**
- Modify: `docs/design-system.md` (раздел «База знаний»: «Главная», «Обзор», «Кто прочитал», общий `ProgressRing`), `docs/handbook/knowledge/index.md` (главная, обзор, «Напомнить», перечитывание, новые адреса), `docs/handbook/notifications/` (два новых уведомления, если там есть список)

- [ ] **Step 1: Обновить**, **Step 2: Commit** `База знаний: главная и обзор в дизайн-системе и справке`.

### Task 9: Проверка целиком

- [ ] **Step 1:** tsc, lint, все тесты, SQL-тест.
- [ ] **Step 2:** В браузере, светлая и тёмная тема, 1440×900 и 375×812: главная у сотрудника и владельца; правка прочитанной страницы → «Изменена после прочтения» → «Попросить перечитать» → у официанта «Нужно перечитать», уведомление в колокольчике, «Обновлено» на главной; «Напомнить» и повтор; «Кто прочитал»; «Обзор» у владельца и у человека с одним правом (выдать локально, откатить); старые адреса из Review Focus 4; консоль без ошибок после чистого запуска.
- [ ] **Step 3:** Тестовые данные, созданные проверкой (прочтения, уведомления, состояния), вернуть как было.
