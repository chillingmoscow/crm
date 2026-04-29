# Артефакты из `finance-tracker`

> Перенесено из `crm/finance-tracker/` 29 апреля 2026 перед удалением папки.
>
> `finance-tracker` — отдельный проект (CRA + MUI 7 + supabase-js + react-router 7), который запускался как пилот финансового модуля в 2024–2025. Слияние в `crm` идёт по плану [`docs/MERGE_PLAN.md`](../docs/MERGE_PLAN.md) v2.1.
>
> Это **только референс**. Код **не предназначен для прямого импорта**: в `crm` другой стек (Next.js 15 + shadcn/ui + Supabase Server Actions), другая мульти-тенантность (`accounts → venues` против `organizations → legal_entities`), другие правила прав. Но бизнес-логика, формулы, форматы данных и UX-решения часто переиспользуемы — поэтому сохраняем как «документацию в коде».
>
> Полная git-история `finance-tracker` лежит вне репо в `~/Desktop/finance-tracker-archive.bundle` (`git clone finance-tracker-archive.bundle` если когда-нибудь понадобится).

## Что внутри

### `types/`
- `index.ts` — все доменные типы (378 строк): `User`, `Account` (банковский счёт!), `Category`, `Counterparty`, `Transaction`, `AttachedFile`, `Statistics`, `Organization`, `LegalEntity`, `Position`, `PositionPermission`, `UserAssignment`, `AccountGroup`, `CategoryGroup`, `CounterpartyGroup`, `AuditLog`, реестр `PERMISSIONS`. **Внимание:** `Account` здесь — это банковский счёт (в новой схеме это `bank_account`).
- `supabase.ts` — генерированные типы БД из старой схемы.

### `migrations/`
Все 39 SQL-миграций ft. **Большинство — fix-итерации** одних и тех же ошибок (`fix_init_user_function` × 3, `fix_users_rls`, `disable_users_rls_temp`, `fix_infinite_recursion`, `final_comprehensive_fix`, `fix_permissions_final`). Не для применения. Использовать как:
- референс для финальных DDL финансовых таблиц (`transactions`, `accounts`, `categories`, `counterparties`, `account_groups`, …);
- источник enum'ов и индексов;
- источник для функции пересчёта баланса (`update_account_balance` trigger).

Старая мульти-тенантность (`organizations`, `legal_entities`, `positions`, `position_permissions`, `user_assignments`) **не переносится** — у `crm` своя модель (`accounts`, `venues`, `roles`, `role_permissions`, `account_role_permissions`, `user_venue_roles`).

### `services/`
17 файлов — это **бэкенд бизнес-логики ft** (`Supabase*Service.ts`): чтение, запись, агрегация по каждой доменной сущности. Это **самая ценная часть** референса — формулы, фильтры, пагинация, дедупликация. Когда будем писать `crm/src/lib/finance/{transactions,bank-accounts,categories,counterparties,statistics}.ts` — сверяться с этими файлами.

Особо полезные:
- `SupabaseTransactionService.ts` — пересчёт балансов, transfer-логика, фильтры списка.
- `SupabaseStatisticsService.ts` — агрегации для дашборда.
- `SupabaseLegalEntityService.ts` — паттерн работы с юрлицами (но без DaData в этом коде).
- `PermissionsService.ts` — фронтовая обёртка над permissions.

### `components/`
- `Transactions/` — 16 файлов, включая `TransactionForm.tsx` (992 строки) и `TransactionsPage.tsx` (1837 строк), фильтры, виртуализированный список. Декомпозиция формы — в плане v2.1, раздел 8 («Сложность TransactionForm»).
- `Accounts/`, `Categories/`, `Counterparties/` — формы и страницы с группами и поиском по ИНН.
- `Organization/` — `LegalEntityForm`, `LegalEntitiesPage`, `OrganizationInfoTab`, `PositionForm`. **Внимание:** ft-модель `Organization → LegalEntity` отличается от `crm`-модели `Account → LegalEntity`; форма юрлица в плане ближе к ней по полям, но без DaData.
- `Common/` — `FileUpload` (с `react-dropzone`), `PermissionGuard`, `AuditInfo`, `ConfirmDialog`, `DataCard` — переиспользуемые концепции.

### `utils/`
- `helpers.ts`, `formatters.ts` — RUB-форматирование, даты.
- `performance.ts` — есть инсайты про дебаунс / мемоизацию для больших списков.

### `docs/`
- `MEMORY_BANK.md` — авторские заметки про бизнес-домен ft (декомпозиция, решения).
- `RLS_PERFORMANCE_OPTIMIZATION_REPORT.md` — инсайты по индексам и RLS-производительности (в плане v2.1 уже учтены, но детали полезны).
- `REFACTORING_CHANGES.md` — логи рефакторингов; иногда там ход мысли по структуре.

## Что специально не перенесено

- `node_modules/`, `build/`, `.cursor/`, `.vscode/` — мусор.
- `quick_login.html`, `debug_*.js`, `test_*.js`, `create_user.js`, `config-diff.txt` — отладочные файлы.
- `supabase/functions/signup-hook/` — Edge Function автосоздания профиля. У `crm` это делает trigger `handle_new_user` (миграция 004).
- `src/components/{Auth,Layout,Users,Positions,Events,Dashboard}/` — у `crm` свои аналоги с лучшим стеком (shadcn-формы, `react-hook-form` + `zod`).
- `DEBUG_AUTH_ISSUES.md`, `RLS_IMPLEMENTATION_GUIDE.md`, `RLS_IMPLEMENTATION_STATUS.md`, `TESTING_INSTRUCTIONS.md`, `TEST_AUTH_ERROR_HANDLING.md`, `README.md` — устаревшая операционка прошлого этапа разработки.
- `.env.local`, `.gitignore` — секреты и конфиг отдельного проекта.

## Mapping ft → crm (ключевые сущности)

| ft (старое имя) | crm (новое имя) |
|---|---|
| `users` | `profiles` |
| `organizations` | `accounts` |
| `legal_entities` | `legal_entities` (в `crm` будет создан в Этапе 2) |
| `positions` | `roles` |
| `position_permissions` | `role_permissions` + `account_role_permissions` |
| `user_assignments` | `user_venue_roles` |
| `accounts` (банковские счета) | `bank_accounts` |
| `account_groups` | `bank_account_groups` |
| `categories` | `finance_categories` |
| `category_groups` | `finance_category_groups` |
| `counterparties` | `counterparties` |
| `counterparty_groups` | `counterparty_groups` |
| `transactions` | `transactions` (с расширением `legal_entity_id`, `to_legal_entity_id`) |
| `audit_log` | `audit_logs` |

Подробности маппинга — в [`docs/MERGE_PLAN.md`](../docs/MERGE_PLAN.md) разделы 3 и 9.1.
