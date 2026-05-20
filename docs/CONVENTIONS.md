# Конвенции crm

Источник правды для двух тем, по которым мы постоянно ошибались
пост-фактум и потом разносили: **тенантность** (`account_id` + venue) и
**жизненный цикл удаления** (архив + удалить навсегда).

Когда добавляешь новую таблицу или новую top-level сущность — пройди
по обоим чек-листам. Это занимает минуты на этапе создания и спасает
часы рефакторинга позже.

История боли — в [`docs/CURRENT_TENANCY.md`](CURRENT_TENANCY.md) и
комментариях миграций 122 / 150 / 185–198.

---

## 1. Тенантность

### Чек-лист новой top-level сущности (`accounts` → `<entity>`)

- [ ] `account_id uuid NOT NULL references accounts(id) ON DELETE CASCADE`
- [ ] Композитный `UNIQUE (account_id, id)` — **обязательно**, иначе
      композитный FK от дочерних таблиц невозможен.
- [ ] Если сущность venue-scoped:
  - [ ] `venue_id uuid NULL references venues(id) ON DELETE CASCADE` —
        nullable, если допустим режим «account-global / без venue»;
        иначе `NOT NULL`.
  - [ ] Композитный FK `(account_id, venue_id) → venues(account_id, id)`
        — гарантирует, что venue принадлежит тому же аккаунту.
  - [ ] Индекс `(account_id, venue_id)` для cascade-delete и venue-фильтра.
- [ ] RLS select-policy по `account_id = get_active_account_id()`.
- [ ] RLS write-policy: тот же tenant-предикат + `has_permission(...)`.
- [ ] Если venue-scoped — RLS пускает либо по `venue_id =
      get_active_venue_id()`, либо по специальному «view_all_venues»
      праву (finance-паттерн, миграция 042).

### Чек-лист новой child-сущности (`<parent>` → `<child>`)

- [ ] FK на родителя — **композитный** `(account_id, parent_id) →
      parent(account_id, id)`. Single-column FK (`parent_id` без
      `account_id`) допускает cross-tenant ссылки и обходит изоляцию.
- [ ] Индекс с тем же порядком колонок `(account_id, parent_id)` —
      покрывает FK lookup для cascade delete.
- [ ] `ON DELETE`: **CASCADE** для owned-data (attachments, items),
      **SET NULL** для history-bearing (transactions, audit-entries),
      **RESTRICT** только если действительно нужно блокировать
      удаление родителя.

### Прецеденты боли

| Когда | Что | Цена исправления |
|---|---|---|
| Finance Stage 4 | Single-column FK позволяли транзакции аккаунта A ссылаться на счёт аккаунта B | Миграции 150-ish: разнос на композитные FK по всему модулю |
| Inventory Stage 1-4 (185-196) | Ингредиенты/контрагенты были account-global; потребовался venue-scoping → перекройка RLS + venue_id + триггеры denormalization | 12 миграций + 6 PR'ов |
| Venue delete (196-197) | Каскад FK с RESTRICT блокировал hard-delete venue по одному звену за раз | По миграции на каждый RESTRICT в цепи |

---

## 2. Жизненный цикл удаления

### Терминология (в UI и в коде)

- **«Архивировать»** (`archive`, soft-delete) — обратимое скрытие.
  Сущность исчезает из всех живых списков, выборов, переключателей.
  Связанные данные не трогаются, FK живы. Восстановление — мгновенное.
- **«Восстановить»** (`restore`) — снять флаг архивации, всё на месте.
- **«Удалить навсегда»** (`delete`, hard-delete) — физический `DELETE`,
  FK-каскады срабатывают. Необратимо. Доступно по отдельному праву.

### Канонические колонки

```sql
archived_at timestamptz NULL,
archived_by uuid NULL references public.profiles(id) on delete set null
```

**Имена строго `archived_at` / `archived_by`** — для новых сущностей.

#### Зоопарк существующего кода (НЕ используем как образец)

| Таблица | Колонка | Когда | Почему остаётся |
|---|---|---|---|
| `bank_accounts` / `counterparties` / `transactions` / `kb_pages` / `kb_threads` / `kb_comments` | `deleted_at` | finance/KB-стадии | Не мигрируем (cosmetic-only churn по ~30 файлам). Адаптер-слой нормализует чтение. |
| `legal_entities` | `is_active` | до миграции конвенции | Будет мигрировано в `archived_at` (Pass B). `is_active` теряет timestamp/by — антипаттерн. |
| `inventory_products` (ingredients) | `archived_at` | миграция 186 — первый явный outlier | Совпадает с конвенцией; добавить `archived_by` в Pass C. |
| `notifications` | `archived_at` | органически выбрано | Совпадает с конвенцией. |

### Фильтр archived_at в коде — обязателен

**Не полагайся только на RLS для фильтра live/archived.** Codex P1 #373:
`<table>_select` и `<table>_select_archived_owner` — обе PERMISSIVE,
для owner'а OR-ятся, и владелец получает архивные строки в каждый
обычный list-запрос. Архивные просочатся в выпадающие списки выборов.

Каждый list-helper / list-запрос обязан явно фильтровать:

```ts
// ✅ ПРАВИЛЬНО — фильтр в коде, не только RLS
const { data } = await supabase
  .from("legal_entities")
  .select("*")
  .is("archived_at", null);
```

```ts
// ❌ ПЛОХО — для owner'а вернёт И archived
const { data } = await supabase.from("legal_entities").select("*");
```

Архив-страница — отдельный запрос с **снятым** фильтром (RLS
`_select_archived_owner` пустит только owner'у).

### RLS-паттерн

```sql
-- 1. Дефолтный select — только live
drop policy if exists "<table>_select" on public.<table>;
create policy "<table>_select" on public.<table>
  for select
  using (
    archived_at is null
    and <existing tenant predicate>
  );

-- 2. Архив виден только владельцу аккаунта (или явной роли)
create policy "<table>_select_archived_owner" on public.<table>
  for select
  using (
    archived_at is not null
    and is_account_owner(account_id)
  );
```

Две policy disjoint по `archived_at IS NULL / NOT NULL` → advisor
выдаст `multiple_permissive_policies`, **это нормально**. Слияние в одну
OR-policy расширит видимость архива всем member'ам (нежелательно) —
комментарием в миграции явно запрещаем «починку».

### Helper-функции

Если сущность может быть «активной» (как venue в `profiles.active_venue_id`),
helper-функции (`get_active_venue_id`, `get_active_account_id`) должны
**отказывать** на архивных строках — иначе RLS других модулей продолжит
пускать пользователя с архивированным active-context'ом.

### Owner-check для архив-страниц

Архив-страницы (`/<area>/<entity>/archive`) — owner-only. **Не использовать**
паттерн «найти аккаунт по owner_id»:

```ts
// ❌ ПЛОХО — упадёт если юзер владеет несколькими аккаунтами
const { data: account } = await supabase
  .from("accounts")
  .select("id")
  .eq("owner_id", user.id)
  .maybeSingle();
if (!account) redirect(...);
```

`maybeSingle()` возвращает `null` когда строк больше одной → юзер с двумя
аккаунтами теряет доступ к собственному архиву. Codex P2 #372.

```ts
// ✅ ПРАВИЛЬНО — через активный аккаунт + is_account_owner
const { data: activeAccountId } = await supabase.rpc("get_active_account_id");
if (!activeAccountId) redirect(...);
const { data: isOwner } = await supabase.rpc("is_account_owner", {
  p_account_id: activeAccountId,
});
if (!isOwner) redirect(...);
```

Тот же паттерн — для любых owner-only действий на серверной стороне
(`assertEntityOwner` хелперы в server actions: через `entity.account_id`
+ `is_account_owner`, не через `accounts.owner_id` lookup).

### Server actions — триплет

Каждая soft-deletable сущность экспортирует:

```ts
async function archive<Entity>(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }>;

async function restore<Entity>(
  id: string
): Promise<{ error: string | null }>;

async function delete<Entity>(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }>;
```

Контракт каждой — см. готовый прецедент:
[`src/app/(dashboard)/org/venues/actions.ts`](../src/app/(dashboard)/org/venues/actions.ts).
Ключевое:

- `archive`: permission `.manage`, идемпотентно, `confirmName === venue.name`,
  emit audit-событие через триггер, `revalidatePath`.
- `restore`: permission `.manage`, идемпотентно (восстановление live →
  success no-op).
- `delete`: permission `.delete` (отдельное от `.manage`,
  **owner-only** по дефолту), `confirmName`, RESTRICT-precheck для FK
  с `ON DELETE RESTRICT` (если такие есть — вернуть дружелюбную ошибку
  с количеством блокеров).
- `confirmName` всегда проверяется на сервере (источник истины);
  client-side check — только UX.

### Permission-модель

- `<entity>.view` / `<entity>.manage` — как раньше (просмотр, обычная
  правка полей).
- **`archive` / `restore` / `delete` — owner-only по дизайну.** Все
  три действия гейтятся через `is_account_owner` (server-side в
  `assertEntityOwner` хелперах). Причина — не `has_permission`:
  - `has_permission` резолвится через `get_active_venue_id()` →
    после архивации single-venue active context сбрасывается → permission
    возвращает false → restore/delete падают «недостаточно прав».
    Codex P1 #371 для venues.
  - Owner-check через `accounts.owner_id` не зависит от active context.
- `<entity>.delete` permission остаётся как **defense-in-depth** для
  RLS-policy `<table>_delete` (миграции seed-ят owner-only), но action
  всё равно делает прямой owner-check.

#### UI-гейт DangerZone и Restore-кнопки

DangerZone и кнопка «Восстановить» **обязательно** гейтятся отдельным
prop'ом `canArchive` (= результат `is_account_owner(activeAccountId)`
на серверной стороне в RSC). НЕ гейтить по `canManage` — manage-юзер
без ownership увидит кнопки, нажмёт и получит `toast.error` с
«доступно только владельцу». Codex P2 #373.

```ts
// В RSC-странице:
const { data: activeAccountId } = await supabase.rpc("get_active_account_id");
const { data: isOwner } = activeAccountId
  ? await supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
  : { data: false };
// ...передать canArchive={!!isOwner} в client-компонент
```

```tsx
// В client-компоненте detail:
{canArchive && !isArchived ? <EntityDangerZone ... /> : null}
{canArchive && isArchived ? <RestoreButton ... /> : null}
```

### UI — два правила

1. **«Опасная зона» в карточке сущности** — две кнопки сразу,
   каждая со своим dialog'ом. Решение пользователя по venues (PR #371,
   2026-05-19): обе кнопки видны сразу, чёткие описания что делает
   каждая. НЕ делать gating «сначала архивируй, потом удаляй».
2. **Архив-страница** `/<area>/<entity>/archive` — только владелец.
   В ней: восстановить / удалить навсегда. Из live-списка ссылка
   «Архив (N)» появляется только если есть архивные строки.

### Reusable-компоненты

- [`src/components/shared/archive-confirm-dialog.tsx`](../src/components/shared/archive-confirm-dialog.tsx)
- [`src/components/shared/hard-delete-confirm-dialog.tsx`](../src/components/shared/hard-delete-confirm-dialog.tsx)

Оба принимают `entityName` для name-confirm input, `impact` для preview
связанных сущностей, и переиспользуются всеми модулями. Hard-delete
дополнительно принимает `restrictedBy[]` — если непусто, кнопка
disabled с подсказкой как разблокировать.

После архивации — toast-undo на 15 секунд («Заведение в архиве»
+ кнопка «Отменить» → `restore`). Не для hard-delete (необратимо).

### Аудит-события

Триггер сущности (`<entity>_audit_trigger`) эмитит три отдельных типа:

- `<entity>.archived` — переход `archived_at NULL → NOT NULL`.
- `<entity>.restored` — переход `archived_at NOT NULL → NULL`.
- `<entity>.deleted` — DELETE FROM (hard).

Это даёт чистый journal-readable timeline + compliance-запросы.

### Auto-purge архива

Не делаем для v1. Архив живёт вечно до явного «Удалить навсегда»
из архив-страницы. В `BACKLOG.md` — «retention sweep cron» как
будущая опция.

### Чек-лист добавления soft-delete к существующей сущности

- [ ] Миграция: `archived_at` + `archived_by` колонки, partial index
      `(account_id) where archived_at is null` для дефолтного фильтра.
- [ ] RLS: переписать `<table>_select` с `+ and archived_at is null` +
      добавить `<table>_select_archived_owner`.
- [ ] Если сущность участвует в `get_active_*` функциях — добавить
      `archived_at is null` в join.
- [ ] Permission `<entity>.delete` (insert в `public.permissions` +
      grant в `role_permissions` только `owner`).
- [ ] Audit-триггер: ветви `archived` / `restored` отдельно от UPDATE-diff.
- [ ] FK invitations.role_id / прочих RESTRICT в цепи hard-delete →
      CASCADE (выровнять до того, как удаление сломается в проде).
- [ ] Server actions: archive / restore / delete + helper `get<Entity>ArchiveImpact`.
- [ ] UI: `<EntityDangerZone>` компонент с двумя кнопками + reusable dialogs.
- [ ] Архив-страница `/<area>/<entity>/archive` + ссылка «Архив (N)»
      из live-списка.
- [ ] Handbook-страница: разделы «Архивирование» / «Удаление навсегда» /
      «Архив».
- [ ] Partial unique index на `(account_id, lower(name)) where
      archived_at is null` если требуется реиспользование имени.
- [ ] Verify: `pnpm db:reset` → `tsc --noEmit` → `lint` → ручной smoke
      (archive, undo, restore, delete, owner-only gate).

### Прецеденты

- [Миграция 198](../supabase/migrations/198_venues_archive.sql) — venues,
  полный набор по конвенции. Эталон для других модулей.
- [`src/app/(dashboard)/org/venues/actions.ts`](../src/app/(dashboard)/org/venues/actions.ts)
  — server actions триплет с asLooseDb для свежих колонок.
- [`src/app/(dashboard)/org/venues/[venueId]/_components/venue-danger-zone.tsx`](../src/app/(dashboard)/org/venues/[venueId]/_components/venue-danger-zone.tsx)
  — danger zone компонент.
- [`src/app/(dashboard)/org/venues/archive/page.tsx`](../src/app/(dashboard)/org/venues/archive/page.tsx)
  — архив-страница.

### Roadmap применения к остальным модулям

Pass A (этот PR) — только venues + конвенция + reusable. Дальше — по
одному модулю за PR, после прод-наката предыдущего:

- **Pass B (finance):** counterparties, legal_entities (мигрировать
  `is_active`), bank_accounts, finance_categories. `legal_entities` +
  `bank_accounts` — archive-only (hard-delete блокирован FK от
  транзакций, UI скрывает кнопку с tooltip).
- **Pass C (inventory):** ingredients (добавить `archived_by`),
  ingredient_groups, documents, stores.
- **Pass D (knowledge):** kb_collections, kb_pages — переписать
  bespoke `kb-soft-delete-page.ts` на конвенционный триплет.
- **Pass E (people):** departments, roles, venue_halls. Для roles —
  system-роли (`venue_id IS NULL`) НЕ архивируемы, гард в action.
