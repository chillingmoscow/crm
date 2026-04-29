# Артефакты из заброшенной попытки crm2

> Перенесено из `~/Desktop/crm2` 29 апреля 2026 перед удалением папки.
>
> `crm2` была попыткой переписать платформенное ядро с нуля (Next.js + Supabase, "backend-first"),
> начатой 23-24 февраля 2026. Проект не пошёл — один git-коммит, никакого remote.
> Сюда сложено только то, что может пригодиться текущему `crm`.

## Что внутри

### `project.md`
Подробное ТЗ на платформенное ядро (Этапы 1-2 + UI Shell). Описывает:
- Принципиальные решения по мульти-тенантной модели (account ≠ network).
- Полную схему таблиц `profiles`, `accounts`, `venues`, `roles`, `permissions`, `role_permissions`, `user_venue_roles`, `invitations`.
- Флоу аутентификации, приглашений (Magic Link), онбординга, управления сотрудниками.
- Хранение `active_venue_id` в `profiles`.

Полезно как референс при проектировании новых модулей CRM (бронирования, графики, склад и т.д.).

### `supabase-tests/00_platform_core.sql`
Интеграционные SQL-тесты под локальную Supabase. Покрывают:
- `bootstrap_owner` (создание аккаунта + venue).
- `has_permission` для owner / manager / outsider.
- RLS-изоляцию (outsider не видит чужие аккаунты).
- `create_invitation` + `accept_invitation` (включая strict-проверку email).
- Cross-account ограничение на создание приглашений.
- Запись в `audit_logs`.

**Важно:** написаны под схему `crm2` — функции и таблицы могут не совпадать 1:1 с текущей схемой `crm` (там `bootstrap_owner` называется `complete_owner_onboarding`, нет таблицы `audit_logs` и т.д.). Используй как шаблон для собственных SQL-тестов в `crm/supabase/tests/`.

### `supabase-tests/config.template.toml`
Шаблон `config.toml` с плейсхолдерами портов (`__SUPABASE_API_PORT__` и т.д.). Работает в паре со скриптом `select-ports.mjs`.

### `scripts/ports/select-ports.mjs`
Аллокатор свободных портов для локалки. Берёт первый свободный порт в указанных диапазонах:
- App: 3400-3499
- Supabase API: 55000-55099
- Supabase DB: 55100-55199
- Shadow DB: 55200-55299
- Studio: 55300-55399
- Inbucket: 55400-55499
- Analytics: 55500-55599

Рендерит `.env.local`, `supabase/.env.ports` и `supabase/config.toml` из шаблона.
Полезно, если на машине одновременно работает несколько проектов на Supabase и стандартные порты 54321+ заняты.

### `scripts/run-dev.mjs`
Обёртка над `next dev` с предварительным вызовом аллокатора портов.

### `scripts/seed-admin.mjs`
Сидер локального админа `admin@crm2.local / admin11` через service role key.

## Что выкинуто (специально)

- `node_modules`, `.next`, `package-lock.json` — мусор.
- Все `app/(portal)/*` страницы — пустые заглушки, в `crm` уже есть полноценные.
- `app/auth/*` — простые формы без валидации, в `crm` версии лучше (react-hook-form + zod + shadcn/ui).
- `src/server/actions/*` — RPC-обёртки над Supabase RPC, в `crm` другой подход.
- `src/components/{auth,portal}/*-shell.tsx` — простые layout-компоненты, у `crm` свой `AuthShell`.
- 4 SQL-миграции `crm2` — в `crm` уже 31 миграция с покрытием тех же фич плюс расширения (Quick Resto, terminal PIN, расширенный профиль и т.д.).
