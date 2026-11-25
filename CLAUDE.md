# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Стек

- **Next.js 15** (App Router, Server Components + Server Actions) + **React 19** + **TypeScript 5** (strict).
- **Supabase** (self-hosted на проде, локально через Supabase CLI/Docker) — auth, Postgres, storage, realtime. SSR-клиент через `@supabase/ssr`.
- **UI**: shadcn/ui + Radix + Tailwind v3, иконки `lucide-react`. Конфиг shadcn — `components.json` (alias `@/components`, `@/lib`, `@/hooks`).
- **Редактор знаний**: BlockNote 0.49 поверх TipTap 3 / ProseMirror.
- **Формы**: `react-hook-form` + `zod` (через `@hookform/resolvers`).
- **AI**: DeepSeek (KB slash-команды) и SiliconFlow (embeddings BAAI/bge-m3) — оба через `openai` SDK с custom baseURL, **только серверно**.
- **DaData**: юрлица и адреса по ИНН — **только серверно**, ключи `DADATA_API_KEY`/`DADATA_SECRET_KEY` (см. memory `dadata_policy.md`).
- **Менеджер пакетов**: pnpm 9 (lockfile `pnpm-lock.yaml`, CI использует `pnpm/action-setup@v4`).

Тесты — `node:test` (нативный test runner Node 22), файлы рядом с кодом как `*.test.mts`. Vitest/Jest нет.

## Команды

| Назначение | Команда |
| --- | --- |
| Dev-сервер (Turbopack) | `pnpm dev` |
| Прод-build | `pnpm build` (выставлен `--max-old-space-size=4096`) |
| Старт прод-build | `pnpm start` |
| Lint | `pnpm lint` |
| Type-check | `pnpm exec tsc --noEmit` |
| Локальный Supabase (Docker) | `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` |
| Сброс локальной БД (применит миграции + `supabase/seed.sql`) | `pnpm db:reset` |
| Новая миграция | `pnpm db:migrate <name>` |
| Регенерация TS-типов из локальной БД | `pnpm regen:types` ([scripts/regen-types.sh](scripts/regen-types.sh)) |
| Запуск одного теста | `node --test --experimental-strip-types src/path/to/file.test.mts` |
| Все тесты | `node --test --experimental-strip-types "src/**/*.test.mts"` |

`.env.local` копируется из [`.env.local.example`](.env.local.example): `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` берутся из `pnpm db:status`, серверные ключи (DaData, DeepSeek, SiliconFlow, SMTP) — по необходимости.

**CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) гоняет `tsc --noEmit` + `pnpm lint`. Это и есть набор обязательных проверок перед push'ем — `next build` намеренно **не** проверяет типы и lint ([`next.config.ts`](next.config.ts) объясняет почему: Coolify OOM-ит на tsc).

## Архитектура

### Route groups (`src/app/`)
- `(auth)/` — публичные страницы login/register/forgot-password/verify-email/set-password (свой layout).
- `(onboarding)/onboarding/` — флоу первого входа (создание аккаунта, инвайты), `actions.ts` рядом.
- `(dashboard)/` — основное приложение под аутентификацией. Внутри модули: `crm/`, `finance/`, `knowledge/`, `notifications/`, `people/` (staff, roles), `org/` (account, venues), `settings/`, `profile/`, `dashboard/`. У каждого модуля свои server actions в `actions.ts`. Исключение — `inventory/`: экшены разложены по доменам в `inventory/_actions/<домен>.ts` (`sync`, `assignment`, `documents`, `results`, `exclusions`, `resort`, `recount`, `draft`, `catalog`), общие хелперы — в `inventory/actions-shared.ts`. Импортировать нужный домен напрямую; barrel-реэкспорта намеренно нет, чтобы не тянуть весь модуль в клиентский граф.
- `api/` — только то, что не укладывается в server actions: `cron/auto-archive-notifications`, `dadata/{address,party}` (прокси к DaData), `finance/transactions`.
- [`src/middleware.ts`](src/middleware.ts) — обновление сессии Supabase на каждом запросе через `updateSession` из [`src/lib/supabase/middleware.ts`](src/lib/supabase/middleware.ts). Исключены `/api`, статика, `*.html` (GoTrue читает HTML-шаблоны писем из `/public/email-templates/`).

### Парадигма данных
- **Server Actions — основной способ мутаций.** Лимит тела действия поднят до 50 MB ради KB-аплоадов ([`next.config.ts`](next.config.ts:32)) и должен совпадать с `storage.file_size_limit` в [`supabase/config.toml`](supabase/config.toml).
- **Server action не бросает исключение с текстом для пользователя.** В прод-сборке Next.js заменяет текст брошенного из действия исключения английской заглушкой «An error occurred in the Server Components render…», и пользователь не видит причину. Действие, вызываемое из браузера, оборачивается в `actionResult(fn, "<русский fallback>")` из [`src/lib/actions/result.ts`](src/lib/actions/result.ts), клиент разворачивает результат через `unwrapAction`; действия с ответом вида `{ error }` пропускают текст через `errorText` ([`src/lib/actions/error-text.ts`](src/lib/actions/error-text.ts)). Оба фильтра показывают русский текст (наш или `raise exception` из базы) как есть, а английский технический заменяют на fallback — поэтому тексты `raise exception` в миграциях пишем по-русски. `redirect()`/`notFound()` внутри `actionResult` не вызывать: обёртка поймает их как ошибку. Прецедент — удаление штрафа в зарплате, PR #710.
- **Публичного API нет и пока не делаем** — см. ниже раздел политики.

### Supabase-клиенты
- [`src/lib/supabase/server.ts`](src/lib/supabase/server.ts) — SSR-клиент + **per-request кэш** через `React.cache`: `getCachedUser`, `getCachedActiveAccountId`, `getCachedPermissions`. Используй их в RSC, чтобы не дёргать auth/RPC из каждого слоя дерева.
- [`src/lib/supabase/client.ts`](src/lib/supabase/client.ts) — браузерный клиент.
- [`src/lib/supabase/admin.ts`](src/lib/supabase/admin.ts) — service-role (только сервер).
- [`src/lib/supabase/middleware.ts`](src/lib/supabase/middleware.ts) — refresh-сессии для middleware.
- **PostgREST отдаёт не больше 1000 строк** (`max_rows`) и молча обрезает остальное. Справочники, которые могут перерасти тысячу (номенклатура, строки актов), читать через `fetchAllRows` из [`src/lib/supabase/fetch-all.ts`](src/lib/supabase/fetch-all.ts); длинные списки id в `.in(...)` резать `chunk` — они уходят в URL запроса. Прецедент: каталог ингредиентов терял всё после тысячной позиции по алфавиту.
- **Синк Quick Resto (номенклатура, склады, открытые акты) идёт сам** раз в три часа через `/api/cron/sales-shifts` (`runQuickRestoInventorySync` в `src/lib/inventory/quickresto-sync.ts`, кнопка «Синхронизировать» идёт через него же; номенклатура — `nomenclature-sync.ts`). У запуска по расписанию нет пользователя: события и журнал пишутся с `userId: null`. Сверка пишет только новое и изменённое, поэтому `ingredients.synced_at` не годится как «время последней синхронизации» — брать `getNomenclatureSyncState` (`integration_connections.nomenclature_synced_at`, миграция 381). Архивацию вида при пустом ответе или пропаже больше половины позиций сверка пропускает с предупреждением (`planArchive`).
- **Картинки в интерфейсе — с кэшем браузера на месяц.** Приватные (каталог, акты, кандидаты, гости, задачи, база знаний) — постоянным адресом `mediaUrl()` из [`src/lib/storage/media.ts`](src/lib/storage/media.ts) (маршрут `/api/media`), а не подписанной ссылкой: подпись меняется на каждый заход, и браузер качает фото заново. Фото людей из публичного бакета — через `avatarThumbUrl` / `avatarImageUrl` ([`src/lib/people/avatar-thumb.ts`](src/lib/people/avatar-thumb.ts)), оптимизатор держит копию 30 дней. Документы, аудио и видео — по-прежнему подписанной ссылкой.
- Типы БД: [`src/types/database.ts`](src/types/database.ts) (плюс доменные `finance.ts`, `knowledge.ts`). Регенерируется через `pnpm regen:types` — скрипт прогоняет `supabase gen types --local` и дописывает hand-added блок (`WorkingHours`, enum-алиасы). Полный regen иногда заваливает существующий код более строгими null-типами на чужих файлах (`src/lib/knowledge/pages.ts`, `src/lib/supabase/server.ts`); в этом случае либо точечно правьте те места, либо чёрри-пикайте новые блоки руками вместо полной перезаписи.

### Permissions
- Активный account — RPC `get_active_account_id`. Права — RPC `list_my_permissions` (см. миграции `065`, `103`).
- **Пер-аккаунтных перекрытий прав нет**: таблица `account_role_permissions` удалена миграцией `138_owner_only_system_role.sql`. Права роли задаются только через `role_permissions.granted`, и `has_permission` идёт по `user_venue_roles → role_permissions → permissions` для активного venue — никакой второй таблицы с перекрытиями (прежняя формулировка здесь была устаревшей). С миграции `237` у функции есть быстрый путь: если транзакционный GUC `app.ctx_ready = '1'`, права читаются из `app.perms`, иначе выполняется тот же запрос. Подробности — в memory `permissions_override_semantics.md`. Greenfield-wipe `platform.*` зафиксирован в `permissions_wipe_policy.md` (миграция 034).
- В `src/types/database.ts` тип `account_role_permissions` ещё лежит — артефакт давнего regen, живого кода за ним нет; уедет при следующей полной регенерации типов.

### График работы: видеть ≠ планировать
- Опубликованный график всей команды видит любой активный сотрудник заведения — через SECURITY DEFINER RPC `schedule_team_shifts(from, to)` (миграция 358), который отдаёт только поля для сетки. Политика `schedule_shifts_read` по-прежнему отдаёт сотруднику только свои смены.
- `schedule.view_all` — это **планирование** (черновики, ставки, стажировки кандидатов, вся история), а не «просто видеть». Новые данные для сотрудников без него — только через такие узкие RPC, не расширением RLS.
- Замены смен — таблица `schedule_shift_swaps` и `schedule_swap_command` (358): решает управляющий с `schedule.shift_assign`, ответ коллеги необязателен.

### Tenancy
Трёхуровневая модель **Account → LegalEntity → Venue**. Действующая модель описана в [`docs/CURRENT_TENANCY.md`](docs/CURRENT_TENANCY.md); план слияния finance-tracker — [`docs/MERGE_PLAN.md`](docs/MERGE_PLAN.md). Старые URL (`/staff`, `/settings/roles`, `/settings/venues`, `/settings/account`, `/settings/profile`) — **301-redirect**ы в [`next.config.ts`](next.config.ts) на новые `/people/*`, `/org/*`, `/profile`.

### Supabase: миграции и тесты
- `supabase/migrations/` — линейная нумерация `NNN_*.sql` (на 20.11.2026 — 001–361 + один с timestamp-префиксом, оставленный для истории). Номер последней смотреть в `ls supabase/migrations | tail -1`, а не в этом файле: он отстаёт. Не переставлять и не редактировать применённые миграции.
- **Создание новой**: `pnpm db:migrate <name>` запускает `supabase migration new`, который кладёт файл в формате `<timestamp>_<name>.sql`. Сразу **переименовать** в следующий по порядку `NNN_<name>.sql` (например `132_<name>.sql`), чтобы сохранить convention. Линейная нумерация — не косметика: она нужна, чтобы reviewer мог проверить «не разъехалась ли последовательность» и для self-hosted apply-флоу.
- `supabase/seed.sql` — тестовые данные для локальной разработки (применяется автоматически при `pnpm db:reset`).
- `supabase/tests/` — SQL-тесты (legal_entities, finance_module).
- Прод — **self-hosted**, миграции катятся через SSH (см. memory `self_hosted_supabase.md`).

#### Конвенции при написании миграций (закрывают повторяющиеся advisor-баги)

- **`SET search_path = public, pg_catalog` обязателен в теле каждой `create or replace function` в `public`** (триггеры, RPC, helpers). PostgreSQL при OR REPLACE сбрасывает все attributes, не перечисленные в новом определении, — поэтому ALTER FUNCTION ... SET search_path из более ранней миграции (например `160_security_advisor_cleanup.sql`) обнуляется, когда функцию редактируют. Если функция работает с расширением `vector`, добавлять `extensions`: `set search_path = public, extensions, pg_catalog`. Прецедент: 166 и 172 пересоздали 4 trigger-функции без SET — пришлось делать fixup-миграцию 174.
- **`auth.uid()` в RLS оборачивай в `(select auth.uid())` сразу при создании политики**, чтобы Postgres хоистил вызов в InitPlan (закрывает advisor `auth_rls_initplan`). То же для `current_setting(...)`, `auth.jwt()`, `auth.role()`.
- **Если миграция массово переписывает текст RLS-политик через `replace()` на `pg_policies.qual`/`with_check`, она должна обрабатывать обе формы**: `auth.uid()` (как хранится локально в supabase CLI) **и** голый `uid()` (как хранится на проде, потому что `auth` был в search_path сессии при создании политики). Идемпотентный паттерн — placeholder-pipeline: unwrap всех known wrapped-форм → `<<MARKER>>` → re-wrap финальной формой. Пример — миграция 163. Прецедент: 161 локально работала, на проде была no-op.
- **Permissive RLS policies на одну `(role, action)` пару — single, не двойная.** Дублирование (например `*_select` + `*_write FOR ALL`) триггерит advisor `multiple_permissive_policies` и double-overhead на каждую строку. Если две независимые policy на одно действие — OR-объединить в одну. Если `FOR ALL` пересекается с отдельной `*_select` — разделить `FOR ALL` на `FOR INSERT/UPDATE/DELETE` (без SELECT) и расширить `*_select USING` до `(view OR manage)`, чтобы manage-юзеры без view не потеряли SELECT (роль вполне может иметь manage без view — права задаются по каждому коду отдельно).
- **`create index` для FK — без `CONCURRENTLY`** в миграциях. Supabase CLI прогоняет миграции в одной транзакции, а CONCURRENTLY требует вне-транзакционного контекста. На наших размерах таблиц AccessExclusiveLock — миллисекунды; для будущих big-таблиц рассмотреть отдельный workflow.
- **SECURITY DEFINER-функция только для сервера (cron, воркеры) — отзывать execute явно у `anon, authenticated`**, не только `from public`. Supabase выдаёт этим ролям явные права по умолчанию, и `revoke all … from public` их не снимает: функция остаётся вызываемой через `/rest/v1/rpc` с публичным ключом. Прецедент: `claim_birthday_*` из 140 отдавали даты рождения всех аккаунтов анониму — закрыто в 361.
- **Миграция с GRANT/REVOKE проверяет результат** (`has_function_privilege` / `has_column_privilege` → `raise exception`). От роли, которая не владеет объектом, REVOKE/GRANT выдают только WARNING и молча ничего не меняют. Образцы — 360, 361.
- **Подзапрос к `venues` в политике `user_venue_roles` (и наоборот) даёт бесконечную рекурсию RLS** — аккаунт заведения брать через SECURITY DEFINER `public.venue_account_id(venue_id)` (как в 361).
- **`profiles`: чтение — по списку колонок.** С миграции `360` у `anon`/`authenticated` нет SELECT на таблицу целиком — только на колонки, кроме `phone`, `telegram_id`, `birth_date`, `address` (контакты коллег иначе открывались вместе со строкой через `profiles_select`). Новая колонка `profiles` читаема пользователем только после `grant select (<колонка>) on public.profiles to anon, authenticated` в той же миграции; `select("*")` по `profiles` из пользовательского клиента падает с permission denied. Свои контакты сервер читает admin-клиентом по `user.id`, чужие — через `get_venue_staff` или карточку сотрудника за `people.view_staff_details`.
- **Журнал событий (`audit_logs`) пишется только сервером.** Из SQL — `public.log_audit()` внутри триггера или функции (прямой вызов от `anon`/`authenticated` через rpc/graphql с миграции `362` отклоняется) или прямой `insert` в SECURITY DEFINER-функции. Из server actions — `writeAuditEvent` (`src/lib/audit/write.ts`); `supabase.rpc("log_audit")` из приложения не вызывать. Код события — `<раздел>.<объект>.<глагол>`: префикс задаёт раздел журнала (`src/lib/audit/modules.ts`), суффикс — категорию действия (`action-categories.ts`); новому коду нужна фраза в `src/lib/audit/format.tsx` или соседнем файле, иначе в ленте будет общая подпись. Массовые операции и фоновые воркеры пишут одну строку на команду, не на каждую строку данных. `writeAuditEvent` пишет service-role клиентом, поэтому перед ним убедись, что запись данных правда прошла: `update`/`delete` пользовательским клиентом под RLS не дают ошибку, а молча меняют 0 строк — добавляй `.select("id")` и отказывай при пустом результате (прецедент — группы статей и контрагентов, PR #694: без этого журнал фиксировал правки, которых не было). Читать журнал можно с `org.view_audit`; журнал одной сущности без этого права (кандидат — 354, акт инвентаризации — 366) открывается отдельной OR-веткой в той же политике `audit_logs_select` с `entity_id is not null`, префиксом кода и проверкой, что сама сущность видна пользователю (`exists` по её таблице), — иначе право одного заведения открывает журналы всех.
- **Композитный FK требует композитного индекса.** Если FK = `(account_id, X)` на `(account_id, id)` родителя, single-column `(X)` index НЕ покрывает FK lookup для cascade delete. Создавай `(account_id, X)` именно в том порядке.

### Дизайн-система — источник истины
Первая остановка для любой UI-работы — [`docs/design-system.md`](docs/design-system.md): правила ведутся там, текстом. `sheerly.pen` (node `Q4FzoZ`) — архив исходных макетов, он не обновляется и при расхождении не действует. Токены/размеры/отступы/скругления не выдумывать. См. memory `feedback_design_system_first.md`.

### Мобильная версия — грабли и решения
Перед правкой мобильной вёрстки (тулбары, таблицы, сайдбар, инпуты, overflow) — [`docs/mobile-web.md`](docs/mobile-web.md). Там уже пойманные баги iOS Safari (горизонтальное переполнение, зум при фокусе на input), флекс-трапы (`min-w-0`), поведение shadcn-сайдбара в мобильном `Sheet` и адаптивные конвенции. Легко повторить заново, если не знать про них.

### Тесты
`node:test`, `.test.mts`, без отдельного раннера. Примеры — `src/lib/knowledge/collection-*.test.mts`, `src/lib/run-with-concurrency.test.mts`. Запуск одиночного — `node --test --experimental-strip-types <file>`.

### Игнорируемые папки
[`_legacy_from_crm2/`](_legacy_from_crm2) и [`_legacy_from_finance/`](_legacy_from_finance) — архив до слияния, исключены из `tsconfig.json` и ESLint. Не править, не импортировать.

### Конвенции для новых сущностей
При добавлении новой top-level таблицы или сущности — **обязательно** пройти по чек-листам в [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md):
- **Тенантность**: `account_id` + композитный `UNIQUE (account_id, id)` + композитные FK от детей. Прецеденты боли от пропуска — finance Stage 4, inventory Stages 1-4.
- **Жизненный цикл удаления**: `archived_at` + `archived_by` + RLS-сплит live/archive + триплет server actions (`archive`/`restore`/`delete`) + переиспользуемые dialog'и + архив-страница. Прецедент-эталон — venues (миграция 198, PR соответствующий).

## Политика репозитория

### Handbook — обязательное обновление при user-visible PR

В репо есть `docs/handbook/` — пользовательская справка по приложению (обучалка по модулям). Это не dev-документация и не внутренняя `/knowledge` фича пользователя; см. [`docs/handbook/README.md`](docs/handbook/README.md).

**Правило**: каждый PR, который меняет что-то видимое пользователю (новая фича, изменение существующего UI/UX, новые ограничения, новые ошибки), обязан **обновить или создать** соответствующую страницу в `docs/handbook/<module>/`.

- Если фича попадает в существующий модуль (`crm/`, `finance/`, `knowledge/`, `notifications/`, `people/`, `org/`, `settings/`, `dashboard/`, `profile/`, `auth-onboarding/`) — дополни `index.md` или заведи отдельную страницу: `<module>/<feature>.md`.
- Новый модуль — заведи новую папку из [`_template.md`](docs/handbook/_template.md) и добавь ссылку в [`README.md`](docs/handbook/README.md).
- Если на момент PR пользовательский сценарий ещё не финален — допустимо оставить секции с `_TBD_`, но сама страница (или хотя бы пункт в ней) должна появиться. Это сигнал, что фича существует.
- Пиши с точки зрения пользователя, а не разработчика. Никаких упоминаний server actions, RPC, имён колонок БД.

Пока handbook **не публикуется пользователям** — это markdown в репо как источник правды. План публикации (роут `/help`, MDX) — в `BACKLOG.md`.

### Публичный API — отложен

Публичного API (внешний доступ по ключу/токену) сейчас нет и сознательно не делаем. Каждый внешний контракт = жёсткое ограничение, стабилизировать его до устаканивания ядра дорого. См. соответствующий пункт в `BACKLOG.md` — там зафиксированы триггеры, при которых возвращаемся к теме.

Если по ходу работы появляется внешний потребитель (интеграция, мобильное приложение, партнёр) — это сигнал, что пора планировать публичный API; флагни этот факт явно вместо того, чтобы тихо добавлять «временный» endpoint.

### Граница: handbook vs `/knowledge` фича

`docs/handbook/` — справка про приложение (для всех пользователей, поставляется с релизом).
`src/app/(dashboard)/knowledge/` — фича, где конкретный пользователь ведёт **свою** базу знаний в **своём** аккаунте (контент в Supabase). Это разные сущности, не сливать.
