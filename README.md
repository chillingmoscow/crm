# Sheerly 🍸

Multi-tenant CRM для HoReCa: учёт сотрудников / должностей / прав, финансы (счета, транзакции, контрагенты, категории), управление заведениями и юрлицами, внутренняя база знаний (Notion-style редактор поверх BlockNote/TipTap), уведомления.

## Стек

- **Next.js 15** App Router (RSC + Server Actions) + **React 19** + **TypeScript 5 strict**
- **Supabase**: self-hosted на проде (185.178.44.60), локально через Supabase CLI / Docker. Auth, Postgres, Storage, Realtime через `@supabase/ssr`
- **UI**: shadcn/ui + Radix + Tailwind v3, иконки `lucide-react`
- **Редактор знаний**: BlockNote 0.49 поверх TipTap 3 / ProseMirror
- **Формы**: `react-hook-form` + `zod`
- **AI**: DeepSeek (KB slash-команды) + SiliconFlow embeddings (BAAI/bge-m3) — только серверно, через `openai` SDK с custom baseURL
- **DaData**: юрлица и адреса по ИНН — только серверно
- **Менеджер пакетов**: pnpm 9
- **Тесты**: нативный `node:test` (Node 20), файлы рядом с кодом `*.test.mts`

## Тенантность

Трёхуровневая модель **Account → LegalEntity → Venue**:

- Active account — RPC `get_active_account_id`
- Права — RPC `list_my_permissions` с override-таблицей `account_role_permissions` (умеет и добавлять, и отзывать роли)
- Подробности: [`docs/CURRENT_TENANCY.md`](docs/CURRENT_TENANCY.md), [`docs/MERGE_PLAN.md`](docs/MERGE_PLAN.md)

## Разработка

| Назначение | Команда |
|---|---|
| Dev-сервер (Turbopack) | `pnpm dev` |
| Прод-build | `pnpm build` (с `--max-old-space-size=4096`) |
| Lint | `pnpm lint` |
| Type-check | `pnpm exec tsc --noEmit` |
| Локальный Supabase (Docker) | `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` |
| Сброс локальной БД (миграции + `supabase/seed.sql`) | `pnpm db:reset` |
| Новая миграция | `pnpm db:migrate <name>` (потом ручное переименование в `NNN_<name>.sql`) |
| Запуск одного теста | `node --test --experimental-strip-types <file>.test.mts` |

`.env.local` копируется из [`.env.local.example`](.env.local.example). CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) гоняет `tsc --noEmit` + `pnpm lint` — это и есть обязательный набор перед push'ем.

## Деплой

- **Coolify** автоматически деплоит Next.js приложение по push'у в `main` через GitHub webhook
- **Миграции БД не катятся автоматически** — пушатся вручную по SSH в self-hosted Supabase-контейнер (`supabase-db-jk8o8os4wowowg088ksckcc4` на `185.178.44.60`)
- Сейчас завязаны на «допрод» — без stage/canary

## Источник правды по дизайну

`sheerly.pen` (node `Q4FzoZ`) в редакторе Pencil + текстовое зеркало [`docs/design-system.md`](docs/design-system.md). Токены / размеры / отступы / скругления не выдумываются — берутся из этих двух источников.

## Документация

- [`CLAUDE.md`](CLAUDE.md) — стек, команды, архитектура для AI-агентов (Claude Code, Codex)
- [`docs/handbook/`](docs/handbook/) — пользовательская справка по модулям (обязательно обновлять при user-visible PR)
- [`docs/CURRENT_TENANCY.md`](docs/CURRENT_TENANCY.md) — действующая модель аккаунтов / юрлиц / заведений
- [`docs/design-system.md`](docs/design-system.md) — текстовое зеркало `sheerly.pen`
- [`BACKLOG.md`](BACKLOG.md) — отложенные фичи и решения

## Структура

```
src/
├── app/
│   ├── (auth)/           # login / register / forgot-password / set-password
│   ├── (onboarding)/     # первый вход: создание аккаунта, инвайты
│   ├── (dashboard)/      # основное приложение под аутентификацией
│   │   ├── crm/
│   │   ├── finance/
│   │   ├── knowledge/
│   │   ├── notifications/
│   │   ├── people/       # staff, roles
│   │   ├── org/          # account, venues, legal-entities
│   │   ├── settings/
│   │   ├── profile/
│   │   └── dashboard/
│   ├── api/              # cron, dadata proxy, finance transactions
│   ├── invite/           # приём приглашения сотрудника
│   └── middleware.ts     # обновление Supabase-сессии на каждом запросе
├── components/           # shared UI (shadcn/ui + кастом)
├── lib/                  # supabase, knowledge, notifications, finance helpers
└── types/                # database.ts (с supabase gen types), knowledge.ts, finance.ts

supabase/
├── migrations/           # линейная нумерация 001_*.sql … 137_*.sql
├── seed.sql              # тестовые данные для pnpm db:reset
└── tests/                # SQL-тесты (legal_entities, finance_module)
```

Парадигма данных — server actions для всех мутаций (публичного API нет, см. [`BACKLOG.md`](BACKLOG.md) про триггеры возврата к этому вопросу).
