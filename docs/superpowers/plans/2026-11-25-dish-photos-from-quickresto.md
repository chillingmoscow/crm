# Фото блюд из Quick Resto — план (этап 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Фото блюд из Quick Resto сами приезжают в каталог Sheerly и хранятся у нас. Ручное фото не затирается.

**Architecture:** Отдельная фоновая очередь «фото блюд» — новая полоса (10) ротации `/api/cron/sales-shifts`. За ход очередь:
- забирает у базы пачку блюд одного аккаунта, которым пора проверить фото;
- читает каждое блюдо в бэк-офисе Quick Resto под сессией sheerly-bot;
- выбирает ссылку фото и решает, что с ней делать (чистые функции);
- при необходимости скачивает файл в `account_files` и ставит фото позиции.

**Tech Stack:** Next.js server code, Supabase (service role), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-24-counterparties-suppliers-design.md`, §7 (с итогами разведки).

## Global Constraints

- Миграция `389_dish_photos_quickresto.sql` (перед коммитом проверить номер на `origin/main`).
- Функции в миграции:
  - `set search_path = public, pg_catalog`;
  - SECURITY DEFINER только для `service_role`: `revoke … from public, anon, authenticated`, проверка `has_function_privilege` → `raise exception` по-русски.
- Скачивание:
  - только `https:` с хоста `storage.yandexcloud.net`, путь начинается с `/quickrestobase/`;
  - ответ `image/*`;
  - не больше 10 МБ (`10 * 1024 * 1024`).
- Чтение блюда: `GET /platform/data/warehouse.nomenclature.dish/read?id=<id>&className=ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish` через `callQuickRestoBackOfficeData` + `withBackOfficeSession`.
- Выбор фото:
  - `images.viewPlaces[]` с `id === "FO"` → `image.fullUrl`;
  - иначе первое `viewPlaces[].image.fullUrl`;
  - иначе `wlcrmMedia[0].fullUrl`.
- Повторная проверка блюда: `version` изменилась или с прошлой проверки прошло больше суток.
- Ход очереди: не дольше 25 секунд, пачка до 20 блюд.
- Пауза очереди аккаунта:
  - сбой входа или 403 бэк-офиса → 6 часов;
  - 429 → 15 минут.
- Журнал событий: одна строка `catalog.dish_photos.synced` на ход, только если что-то поменялось. В историю позиции (`ingredient_journal`) — по записи на блюдо, `actor_id = null`, `payload.source = "quickresto"`.
- Тексты по-русски. Справка — `docs/handbook/` каталога.

## Review Focus

1. У позиции фото, загруженное руками, а в Quick Resto другое фото → наше фото не меняется.
2. Пользователь снял фото, пришедшее из Quick Resto:
   - следующая проверка его не возвращает;
   - после смены фото в Quick Resto новое фото приезжает.
3. В Quick Resto фото убрали → снимается только копия из Quick Resto, ручное фото остаётся.
4. У sheerly-bot сломан вход → очередь встаёт на паузу 6 часов, а не логинится каждые 10 минут. Остальные полосы и сверка номенклатуры работают.
5. Ссылка с чужого хоста, ответ `text/html` или файл больше 10 МБ → не скачивается. Блюдо отмечается проверенным, ход идёт дальше.

---

### Task 1: Чистые функции фото

**Files:** Create `src/lib/integrations/quickresto/dish-photo.ts`, test `src/lib/integrations/quickresto/dish-photo.test.mts`.

**Produces:**
- `DISH_PHOTO_MAX_BYTES = 10 * 1024 * 1024`
- `isAllowedDishPhotoUrl(url: string): boolean`
- `pickDishPhotoUrl(dish: unknown): string | null` — по правилу выбора выше. Неразрешённую ссылку пропускает и берёт следующую по порядку.
- `type DishPhotoState = { primaryImageFileId: string | null; photoSource: "manual" | "quickresto" | null; quickrestoPhotoUrl: string | null }`
- `decideDishPhoto(state: DishPhotoState, incoming: string | null): "download" | "clear" | "skip"`:
  - `incoming === null`: `photoSource === "quickresto"` → `clear`, иначе `skip`;
  - `incoming === state.quickrestoPhotoUrl` → `skip`;
  - `photoSource === "manual"` → `skip`;
  - иначе → `download`.
- После любого решения воркер записывает в `quickresto_photo_url` значение `incoming`.

- [ ] Тесты:
  - `pickDishPhotoUrl`:
    - FO главнее другого места и доставки;
    - без FO берётся другое место;
    - только `wlcrmMedia`;
    - пустые `images`/`wlcrmMedia` → `null`;
    - `http://`, чужой хост, `https://storage.yandexcloud.net/other/…` → `null`;
    - не объект → `null`.
  - `decideDishPhoto` — пять строк таблицы выше, включая «пользователь снял фото» (`primaryImageFileId: null, photoSource: null, quickrestoPhotoUrl: X`, incoming X → `skip`; incoming Y → `download`).
- [ ] RED → реализация → GREEN → commit.

### Task 2: Миграция 389

**Files:** Create `supabase/migrations/389_dish_photos_quickresto.sql`; Modify `src/types/database.ts` (руками: новые колонки `ingredients`, `integration_connections`; `account_files.uploaded_by` nullable).

- `ingredients`:
  - `photo_source text check (photo_source in ('manual','quickresto'))`;
  - `quickresto_photo_url text`;
  - `quickresto_photo_checked_at timestamptz`;
  - `quickresto_photo_checked_version integer`;
  - `quickresto_photo_claimed_at timestamptz`.
- Заполнение: `photo_source = 'manual'` у позиций, где `primary_image_file_id is not null`.
- Индекс `(account_id, quickresto_photo_checked_at) where kind = 'dish' and archived_at is null`.
- `integration_connections.dish_photos_paused_until timestamptz`.
- `account_files.uploaded_by drop not null`: файл, скачанный системой. Проверить места, где выводится загрузивший (`src/lib/files/upload.ts` и чтения `uploaded_by`), и что `null` там не ломает показ.
- `claim_dish_photo_checks(p_limit int) returns table(id uuid, account_id uuid, external_id text, external_version int, primary_image_file_id uuid, photo_source text, quickresto_photo_url text)`. SECURITY DEFINER, только `service_role`.
  - Берёт один аккаунт: активное подключение `quickresto`, `backoffice_login is not null`, `dish_photos_paused_until` пуст или в прошлом.
  - Выбирает живые блюда этого аккаунта с `external_id`, у которых выполнено одно из условий:
    - `quickresto_photo_checked_at is null`;
    - проверка была больше суток назад;
    - `quickresto_photo_checked_version is distinct from external_version`.
  - Пропускает блюда, захваченные меньше 10 минут назад (`quickresto_photo_claimed_at`).
  - Порядок: сначала ни разу не проверенные, потом самые давние.
  - `for update skip locked`, ставит `quickresto_photo_claimed_at = now()`, возвращает строки.
- `sales_next_worker_lane()`: ротация `% 11`. Тело взять из 293 через `pg_get_functiondef` или файл, поменять только модуль.
- Проверки прав в конце миграции.
- [ ] Применить локально (`begin … rollback`, затем по-настоящему). Проверить:
  - заполнение `photo_source`;
  - `claim_dish_photo_checks(5)` от service_role возвращает блюда и ставит claimed;
  - повторный вызов не отдаёт те же блюда;
  - у authenticated нет execute.
- [ ] Commit.

### Task 3: Чтение блюда и воркер

**Files:** Modify `src/lib/integrations/quickresto/client.ts` (`readDishBackOffice`); Create `src/lib/inventory/dish-photo-sync.ts`; Modify `src/app/api/cron/sales-shifts/route.ts` (полоса 10, проверка `> 10`, счётчики `dishPhotoRuns`/`dishPhotoErrors` в ответе).

**Produces:**
- `readDishBackOffice(input: { layerName: string; baseUrl?: string | null; authorization: string; id: number }): Promise<unknown>`
- `processDishPhotos(input?: { deadlineMs?: number }): Promise<{ idle: true } | { idle: false; downloaded: number; cleared: number; failed: number; error?: string }>`

Ход воркера:
1. `claim_dish_photo_checks(20)`. Пусто → `{ idle: true }`.
2. Загрузить подключение аккаунта (поля `QuickRestoConnection`, как в `quickresto-sync.ts`).
3. Для каждого блюда, пока не вышли 25 секунд:
   - прочитать блюдо (`withBackOfficeSession`), получить ссылку `pickDishPhotoUrl`, решение `decideDishPhoto`;
   - `download`:
     - скачать с `AbortSignal.timeout(20000)`;
     - проверить `content-type` и размер по заголовку и по факту;
     - загрузить в бакет `account-attachments` по `buildStoragePath(accountId, "quickresto-dish-<externalId>.<ext>")`;
     - создать `account_files` (`uploaded_by: null`);
     - обновить позицию: `primary_image_file_id`, `photo_source = 'quickresto'`. Условие записи: `photo_source` пуст или `'quickresto'`, иначе ручная загрузка в это время затёрлась бы;
     - запись `ingredient_journal` `photo_updated` с `{ source: "quickresto" }`;
   - `clear`:
     - `primary_image_file_id = null`, `photo_source = null` при условии `photo_source = 'quickresto'`;
     - журнал `{ source: "quickresto", removed: true }`;
   - всегда, кроме сбоя входа или 429: записать `quickresto_photo_url = incoming`, `quickresto_photo_checked_at = now`, `quickresto_photo_checked_version = external_version`, `quickresto_photo_claimed_at = null`.
   - Сбой скачивания: `failed++`, блюдо отмечается проверенным, фото не трогается.
4. Ошибки на уровне хода:
   - `isBackOfficeAuthError` или `isBackOfficePermissionError` → `dish_photos_paused_until = now + 6h`;
   - `QuickRestoRateLimitError` → пауза 15 минут;
   - в обоих случаях снять `claimed_at` у необработанных и вернуть `error`.
5. По истечении времени снять `claimed_at` у необработанных.
6. `downloaded + cleared > 0` → `writeAuditEvent` `catalog.dish_photos.synced`, `userId: null`, `entityType: "integration_connection"`, `details: { downloaded, cleared, failed }`.

- [ ] Полоса 10 в маршруте — по образцу 8/9: один вызов `processDishPhotos()` в `try/catch`. Добавить в `otherWork`.
- [ ] Проверить локально без Quick Resto, что `{ idle: true }` возвращается чисто. Затем на проде вручную один ход (с разрешения, после деплоя).
- [ ] tsc + lint. Commit.

### Task 4: Ручное фото, история и журнал

**Files:**
- `src/app/(dashboard)/inventory/_actions/catalog.ts`:
  - `uploadInventoryProductImage` пишет `photo_source: 'manual'`;
  - `removeInventoryProductImage` пишет `photo_source: null`.
- `src/app/(dashboard)/catalog/_components/nomenclature-card.tsx`: подписи `photo_updated` с `payload.source === "quickresto"` — «Фото из Quick Resto» / «Фото из Quick Resto убрано».
- `src/lib/audit/catalog.tsx`: фраза для `catalog.dish_photos.synced` («Фото блюд из Quick Resto: добавлено N, убрано M»). Если тест модулей (`src/lib/audit/modules.test.mts`) требует перечисления — дополнить.

- [ ] tsc + lint + `node --test --experimental-strip-types src/lib/audit/*.test.mts src/lib/integrations/quickresto/*.test.mts`. Commit.

### Task 5: Справка и проверка

- [ ] В справке каталога (`docs/handbook/inventory/` — найти страницу про фото позиции; нет — дописать в `index.md`):
  - фото блюд сами приезжают из Quick Resto;
  - ручное фото главнее;
  - снятое фото не возвращается, пока в Quick Resto его не заменят;
  - первая загрузка идёт несколько часов.
- [ ] `pnpm exec tsc --noEmit && pnpm lint && node --test --experimental-strip-types "src/lib/integrations/quickresto/*.test.mts" "src/lib/audit/*.test.mts"`. Commit.
