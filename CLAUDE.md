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

Тесты — `node:test` (нативный test runner Node 20), файлы рядом с кодом как `*.test.mts`. Vitest/Jest нет.

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
| Запуск одного теста | `node --test --experimental-strip-types src/path/to/file.test.mts` |
| Все тесты | `node --test --experimental-strip-types "src/**/*.test.mts"` |

`.env.local` копируется из [`.env.local.example`](.env.local.example): `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` берутся из `pnpm db:status`, серверные ключи (DaData, DeepSeek, SiliconFlow, SMTP) — по необходимости.

**CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) гоняет `tsc --noEmit` + `pnpm lint`. Это и есть набор обязательных проверок перед push'ем — `next build` намеренно **не** проверяет типы и lint ([`next.config.ts`](next.config.ts) объясняет почему: Coolify OOM-ит на tsc).

## Архитектура

### Route groups (`src/app/`)
- `(auth)/` — публичные страницы login/register/forgot-password/verify-email/set-password (свой layout).
- `(onboarding)/onboarding/` — флоу первого входа (создание аккаунта, инвайты), `actions.ts` рядом.
- `(dashboard)/` — основное приложение под аутентификацией. Внутри модули: `crm/`, `finance/`, `knowledge/`, `notifications/`, `people/` (staff, roles), `org/` (account, venues), `settings/`, `profile/`, `dashboard/`. У каждого модуля свои server actions в `actions.ts`.
- `api/` — только то, что не укладывается в server actions: `cron/auto-archive-notifications`, `dadata/{address,party}` (прокси к DaData), `finance/transactions`.
- [`src/middleware.ts`](src/middleware.ts) — обновление сессии Supabase на каждом запросе через `updateSession` из [`src/lib/supabase/middleware.ts`](src/lib/supabase/middleware.ts). Исключены `/api`, статика, `*.html` (GoTrue читает HTML-шаблоны писем из `/public/email-templates/`).

### Парадигма данных
- **Server Actions — основной способ мутаций.** Лимит тела действия поднят до 50 MB ради KB-аплоадов ([`next.config.ts`](next.config.ts:32)) и должен совпадать с `storage.file_size_limit` в [`supabase/config.toml`](supabase/config.toml).
- **Публичного API нет и пока не делаем** — см. ниже раздел политики.

### Supabase-клиенты
- [`src/lib/supabase/server.ts`](src/lib/supabase/server.ts) — SSR-клиент + **per-request кэш** через `React.cache`: `getCachedUser`, `getCachedActiveAccountId`, `getCachedPermissions`. Используй их в RSC, чтобы не дёргать auth/RPC из каждого слоя дерева.
- [`src/lib/supabase/client.ts`](src/lib/supabase/client.ts) — браузерный клиент.
- [`src/lib/supabase/admin.ts`](src/lib/supabase/admin.ts) — service-role (только сервер).
- [`src/lib/supabase/middleware.ts`](src/lib/supabase/middleware.ts) — refresh-сессии для middleware.
- Типы БД: [`src/types/database.ts`](src/types/database.ts) (плюс доменные `finance.ts`, `knowledge.ts`).

### Permissions
- Активный account — RPC `get_active_account_id`. Права — RPC `list_my_permissions` (см. миграции `065`, `103`).
- Перекрытие в `account_role_permissions` умеет **и добавлять, и отзывать** права; `has_permission` должен LEFT JOIN-ить обе таблицы. Подробности — в memory `permissions_override_semantics.md`. Greenfield-wipe `platform.*` зафиксирован в `permissions_wipe_policy.md` (миграция 034).

### Tenancy
Трёхуровневая модель **Account → LegalEntity → Venue**. Действующая модель описана в [`docs/CURRENT_TENANCY.md`](docs/CURRENT_TENANCY.md); план слияния finance-tracker — [`docs/MERGE_PLAN.md`](docs/MERGE_PLAN.md). Старые URL (`/staff`, `/settings/roles`, `/settings/venues`, `/settings/account`, `/settings/profile`) — **301-redirect**ы в [`next.config.ts`](next.config.ts) на новые `/people/*`, `/org/*`, `/profile`.

### Supabase: миграции и тесты
- `supabase/migrations/` — линейная нумерация `NNN_*.sql` (на момент написания 001–131 + один с timestamp-префиксом, оставленный для истории). Не переставлять и не редактировать применённые миграции.
- **Создание новой**: `pnpm db:migrate <name>` запускает `supabase migration new`, который кладёт файл в формате `<timestamp>_<name>.sql`. Сразу **переименовать** в следующий по порядку `NNN_<name>.sql` (например `132_<name>.sql`), чтобы сохранить convention. Линейная нумерация — не косметика: она нужна, чтобы reviewer мог проверить «не разъехалась ли последовательность» и для self-hosted apply-флоу.
- `supabase/seed.sql` — тестовые данные для локальной разработки (применяется автоматически при `pnpm db:reset`).
- `supabase/tests/` — SQL-тесты (legal_entities, finance_module).
- Прод — **self-hosted**, миграции катятся через SSH (см. memory `self_hosted_supabase.md`).

### Дизайн-система — источник истины
Первая остановка для любой UI-работы — **`sheerly.pen` (node `Q4FzoZ`)** + текстовое зеркало [`docs/design-system.md`](docs/design-system.md). Токены/размеры/отступы/скругления не выдумывать. См. memory `feedback_design_system_first.md`.

### Тесты
`node:test`, `.test.mts`, без отдельного раннера. Примеры — `src/lib/knowledge/collection-*.test.mts`, `src/lib/run-with-concurrency.test.mts`. Запуск одиночного — `node --test --experimental-strip-types <file>`.

### Игнорируемые папки
[`_legacy_from_crm2/`](_legacy_from_crm2) и [`_legacy_from_finance/`](_legacy_from_finance) — архив до слияния, исключены из `tsconfig.json` и ESLint. Не править, не импортировать.

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
