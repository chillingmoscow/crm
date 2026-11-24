# Контрагенты, этап 1: «+ Новая группа» и документы — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В выборе группы контрагента можно создать новую группу на месте; документы контрагента можно переименовать, удалить одной кнопкой, посмотреть и скачать.

**Architecture:** Старый общий `AttachmentUploader` используется только карточкой контрагента — заменяем его компонентом `CounterpartyDocuments` в стиле уже существующего `TransactionFiles` (миниатюры, перетаскивание, несколько файлов). Переименование — новая RLS-политика update на `account_files`, ограниченная колонкой `name` и файлами контрагентов. Предпросмотр — окно: PDF во встроенном просмотрщике по подписанной ссылке, картинки — постоянным адресом `mediaUrl`. Группа — обёртка над `OptionSelect` с пунктом-маркером, который открывает диалог создания.

**Tech Stack:** Next.js 15 server actions, Supabase (RLS, storage), shadcn/Radix, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-24-counterparties-suppliers-design.md` (разделы 1 и 2).

## Global Constraints

- Тексты интерфейса — по-русски, по `docs/design-system.md`; токены, отступы и размеры не выдумывать, брать из `TransactionFiles` и соседних компонентов.
- Server action не бросает исключение с текстом для пользователя: ответ `{ error }` проходит через `errorText(error, "<русский fallback>")` (`src/lib/actions/error-text.ts`).
- Картинки в `<img src>` — только `mediaUrl()`; подписанная ссылка допустима для PDF и скачивания.
- `update` под RLS без ошибки может изменить 0 строк — добавлять `.select("id")` и отказывать при пустом результате.
- Миграция — `supabase/migrations/386_counterparty_file_rename.sql` (проверить `git ls-tree origin/main supabase/migrations | tail -1` перед коммитом; если 386 занят — следующий свободный). GRANT/REVOKE в миграции проверяются `has_column_privilege` → `raise exception`. Тексты `raise exception` — по-русски.
- Тип, номер и дату документа в интерфейсе не показывать и не спрашивать. Кнопки «Открепить» больше нет.
- Лимит файла — 49 МБ (`MAX_FILE_BYTES` из `transaction-files.tsx`).
- Обязательные проверки: `pnpm exec tsc --noEmit`, `pnpm lint`, тесты `node --test --experimental-strip-types`.
- PR обновляет `docs/handbook/finance/counterparties.md`.

## Review Focus

1. Переименование без расширения («Договор» для `scan.pdf`) — расширение `.pdf` дописывается, файл продолжает открываться как PDF.
2. Пользователь без `finance.upload_attachments` пытается переименовать (или RLS вернула 0 строк) — понятная ошибка «Нет прав на переименование файлов», имя в списке не меняется.
3. Файл неизвестного типа (`.docx`, `.heic`) в предпросмотре — окно не ломается: «Предпросмотр недоступен» и кнопка «Скачать».
4. Скачивание переименованного файла — сохраняется под новым названием, а не под именем из пути в хранилище.
5. Название новой группы совпадает с существующей — ошибка «Группа «…» уже есть» в диалоге, выбор группы не меняется.

---

### Task 1: Чистые помощники для файлов

**Files:**
- Create: `src/lib/files/file-name.ts`
- Test: `src/lib/files/file-name.test.mts`

**Interfaces:**
- Produces:
  - `renameFileName(current: string, input: string): { name: string; error: null } | { name: null; error: string }`
  - `filePreviewKind(mime: string, name: string): "pdf" | "image" | "none"`
  - `fileKindLabel(mime: string, name: string): string` и `formatFileSize(bytes: number): string` — перенести из `src/app/(dashboard)/finance/transactions/_components/transaction-files.tsx` (`fileKind`, `formatSize`) и импортировать оттуда в `transaction-files.tsx`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renameFileName, filePreviewKind, fileKindLabel, formatFileSize } from "./file-name.ts";

test("renameFileName дописывает исходное расширение", () => {
  assert.deepEqual(renameFileName("scan.pdf", "Договор поставки"), { name: "Договор поставки.pdf", error: null });
});
test("renameFileName не дублирует расширение (регистр не важен)", () => {
  assert.deepEqual(renameFileName("scan.PDF", "Договор.pdf"), { name: "Договор.pdf", error: null });
});
test("renameFileName обрезает и схлопывает пробелы", () => {
  assert.deepEqual(renameFileName("a.jpg", "  Фото   склада "), { name: "Фото склада.jpg", error: null });
});
test("renameFileName без расширения у исходного", () => {
  assert.deepEqual(renameFileName("README", "Описание"), { name: "Описание", error: null });
});
test("renameFileName отказывает на пустом", () => {
  assert.deepEqual(renameFileName("a.pdf", "   "), { name: null, error: "Укажите название файла" });
});
test("renameFileName отказывает на слэшах", () => {
  assert.deepEqual(renameFileName("a.pdf", "ООО/ИП"), { name: null, error: "Название не может содержать / и \\" });
});
test("renameFileName отказывает длиннее 200 символов (с расширением)", () => {
  assert.deepEqual(renameFileName("a.pdf", "я".repeat(197)), { name: null, error: "Название длиннее 200 символов" });
});
test("filePreviewKind", () => {
  assert.equal(filePreviewKind("application/pdf", "x"), "pdf");
  assert.equal(filePreviewKind("application/octet-stream", "Акт.PDF"), "pdf");
  assert.equal(filePreviewKind("image/jpeg", "x.jpg"), "image");
  assert.equal(filePreviewKind("image/png", "x.png"), "image");
  assert.equal(filePreviewKind("image/webp", "x.webp"), "image");
  assert.equal(filePreviewKind("image/heic", "x.heic"), "none");
  assert.equal(filePreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x.docx"), "none");
});
test("fileKindLabel и formatFileSize как раньше в transaction-files", () => {
  assert.equal(fileKindLabel("image/png", "x.png"), "Фото");
  assert.equal(fileKindLabel("application/pdf", "x.pdf"), "PDF");
  assert.equal(fileKindLabel("", "x.docx"), "DOCX");
  assert.equal(formatFileSize(512), "512 Б");
  assert.equal(formatFileSize(157_286), "154 КБ");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5,0 МБ");
});
```

- [ ] **Step 2: Run and see it fail**

Run: `node --test --experimental-strip-types src/lib/files/file-name.test.mts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Implement `src/lib/files/file-name.ts`**

Без `"use server"`, без серверных импортов (используется и клиентом). Расширение — последнее `.xxx` (1–5 латинских букв/цифр) у `current`; длина 200 считается по итоговому имени. Картинки для предпросмотра — только `image/jpeg|png|webp|gif`.

- [ ] **Step 4: Run and see it pass**, плюс `pnpm exec tsc --noEmit` (импорт в `transaction-files.tsx` заменён).

- [ ] **Step 5: Commit** — `git commit -m "Файлы: помощники названия, вида и размера"`

---

### Task 2: Право переименовать файл контрагента (миграция)

**Files:**
- Create: `supabase/migrations/386_counterparty_file_rename.sql`

**Interfaces:**
- Produces: пользователь с `finance.upload_attachments` может `update account_files set name = …` для файла, прикреплённого к контрагенту активного аккаунта; другие колонки `account_files` пользовательским клиентом не меняются.

- [ ] **Step 1: Написать миграцию**

Содержимое по смыслу:
- `revoke update on public.account_files from anon, authenticated;` затем `grant update (name) on public.account_files to authenticated;`
- `create policy "account_files_update_counterparty_name" on public.account_files for update to authenticated using (...) with check (...)`, где условие: `account_id = (select public.get_active_account_id())`, `(select public.has_permission('finance.upload_attachments'))` и `exists (select 1 from public.counterparty_attachments ca join public.counterparties c on c.id = ca.counterparty_id where ca.file_id = account_files.id and c.account_id = account_files.account_id)`.
- Проверка в конце блоком `do $$ … $$`: `has_column_privilege('authenticated', 'public.account_files', 'name', 'UPDATE')` должно быть `true`, а `has_column_privilege('authenticated', 'public.account_files', 'storage_path', 'UPDATE')` — `false`; иначе `raise exception 'Права на переименование файлов не выдались'`.

- [ ] **Step 2: Применить локально**

Run: `pnpm db:reset`
Expected: все миграции проходят, без ошибок на 386.

- [ ] **Step 3: Проверить права**

Run: `docker exec supabase_db_crm psql -U postgres -At -c "select has_column_privilege('authenticated','public.account_files','name','UPDATE'), has_column_privilege('authenticated','public.account_files','storage_path','UPDATE'), (select count(*) from pg_policies where tablename='account_files' and cmd='UPDATE')"`
Expected: `t|f|1`

- [ ] **Step 4: Commit** — `git commit -m "Миграция 386: переименование файлов контрагента"`

---

### Task 3: Серверная часть документов

**Files:**
- Create: `src/lib/files/rename.ts` (`"use server"`)
- Modify: `src/lib/files/signed-urls.ts` — добавить функцию
- Modify: `src/lib/files/attachments.ts` — сортировка списка контрагента; удалить `detachFromCounterparty`, `detachFromTransaction`, `detachFromLegalEntity`, если после Task 4 у них нет вызовов (проверить `grep -rn`)
- Modify: `src/app/(dashboard)/finance/counterparties/[id]/page.tsx` — собрать данные документов

**Interfaces:**
- Consumes: `renameFileName` (Task 1), политика из Task 2.
- Produces:
  - `renameCounterpartyFile(args: { counterpartyId: string; fileId: string; name: string }): Promise<{ name: string | null; error: string | null }>` — читает текущее имя, применяет `renameFileName`, если имя не изменилось — возвращает его без запроса; `update({ name }).eq("id", fileId).select("id")`; пусто → `"Нет прав на переименование файлов"`; ошибки — через `errorText(error, "Не удалось переименовать файл")`; `revalidatePath(\`/finance/counterparties/${counterpartyId}\`)`.
  - `getFileDownloadUrl(fileId: string): Promise<{ url: string | null; error: string | null }>` — как `getFileSignedUrl`, но `createSignedUrl(path, 3600, { download: <account_files.name> })`.
  - Тип строки для клиента (экспорт из `src/app/(dashboard)/finance/counterparties/[id]/_components/counterparty-documents.tsx`, создаётся в Task 4):
    ```ts
    export type CounterpartyDocument = {
      fileId: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: string;
      /** mediaUrl 80×80 cover — только для картинок. */
      thumbUrl: string | null;
      /** mediaUrl до 1600 по ширине, contain — только для картинок. */
      imageUrl: string | null;
    };
    ```
  - `page.tsx` собирает `CounterpartyDocument[]` из `listCounterpartyAttachments`, сортирует по `file.created_at` по убыванию; для `filePreviewKind(...) === "image"` строит `thumbUrl`/`imageUrl` через `mediaUrl("account-attachments", file.storage_path, { transform })` (access по умолчанию `"user"`). Словарь `DOC_TYPE_LABELS` удалить.

- [ ] **Step 1: Реализовать `renameCounterpartyFile` и `getFileDownloadUrl`**
- [ ] **Step 2: Поправить `page.tsx`** (временно передать старому компоненту то, что он ждёт, или сразу вместе с Task 4 — на выбор исполнителя, главное чтобы каждый коммит собирался)
- [ ] **Step 3: Проверить** — `pnpm exec tsc --noEmit`, ожидается без ошибок
- [ ] **Step 4: Commit** — `git commit -m "Документы контрагента: переименование и скачивание на сервере"`

---

### Task 4: Компонент «Документы» контрагента

**Files:**
- Create: `src/app/(dashboard)/finance/counterparties/[id]/_components/counterparty-documents.tsx`
- Create: `src/app/(dashboard)/finance/counterparties/[id]/_components/document-preview-dialog.tsx`
- Modify: `src/app/(dashboard)/finance/counterparties/[id]/_components/counterparty-card.tsx` (заменить `AttachmentUploader`, проп `attachments: CounterpartyDocument[]`)
- Delete: `src/components/shared/attachment-uploader.tsx`

**Interfaces:**
- Consumes: `CounterpartyDocument`, `renameCounterpartyFile`, `getFileDownloadUrl`, `getFileSignedUrl`, `deleteAccountFile`, `uploadAndAttach({ parent: { kind: "counterparty", id }, file })`, `filePreviewKind`, `fileKindLabel`, `formatFileSize`, `MAX_FILE_BYTES`.
- Produces: `CounterpartyDocuments({ counterpartyId, documents, canUpload, canDelete, readOnly })` и `DocumentPreviewDialog({ document, open, onOpenChange, onDownload })`.

Поведение (визуально — как `TransactionFiles`: строка с миниатюрой 40×40, название, «PDF · 154 КБ · 24 нояб.»):
- Нажатие на название или миниатюру — окно предпросмотра. В шапке окна — название, кнопки «Скачать» и «Открыть в новой вкладке». PDF: при открытии запросить `getFileSignedUrl`, показать `<iframe title={name}>` на высоту окна (лоадер пока ссылка грузится, ошибка — текстом). Картинка: `<img src={imageUrl}>` с `object-contain`. Иначе: «Предпросмотр для этого файла недоступен» и «Скачать».
- В строке справа: «Скачать» (иконка `Download`), меню или иконка «Переименовать» (`Pencil`) — показывается при `canUpload && !readOnly`, «Удалить» (`Trash2`, красная при наведении) — при `canDelete && !readOnly`.
- Переименование — на месте: название превращается в `Input` с выделенным текстом без расширения, Enter/потеря фокуса — сохранить, Esc — отмена; ошибка — текстом под строкой; во время сохранения строка недоступна; после успеха — `router.refresh()`.
- Удаление — `ConfirmDialog` как в `TransactionFiles`: «Удалить файл «…»?», «Файл удалится насовсем: вернуть его не получится.», кнопка «Удалить файл».
- Загрузка — зона перетаскивания как в `TransactionFiles` (`multiple`, файлы больше 49 МБ отклоняются с перечислением), подпись «Перетащите договор, акт или счёт сюда или выберите файл», на сенсорном экране — «Прикрепить файл». После загрузки — `router.refresh()`.
- Пустой список и нет права загружать — «Файлов нет».
- `uploadAndAttach` больше не получает `document_type` (в базе остаётся значение по умолчанию).

- [ ] **Step 1: Реализовать оба компонента и подключить в `counterparty-card.tsx`**, удалить `attachment-uploader.tsx` и ставшие неиспользуемыми `detach*`.
- [ ] **Step 2: Проверить** — `pnpm exec tsc --noEmit && pnpm lint`, без ошибок.
- [ ] **Step 3: Проверить в браузере** (dev-сервер — через Bash в фоне, см. memory `feedback_dev_server_no_preview_launcher.md`): загрузить PDF и картинку, переименовать PDF в «Договор» (стало «Договор.pdf»), открыть предпросмотр обоих, скачать переименованный (имя файла — «Договор.pdf»), удалить. Загрузить `.docx` — предпросмотр показывает «недоступен».
- [ ] **Step 4: Commit** — `git commit -m "Документы контрагента: предпросмотр, переименование, удаление одной кнопкой"`

---

### Task 5: «+ Новая группа» в выборе группы

**Files:**
- Create: `src/components/finance/counterparty-group-select.tsx`
- Modify: `src/app/(dashboard)/finance/counterparties/[id]/_components/counterparty-requisites.tsx:313-325`
- Modify: `src/components/finance/counterparty-create-drawer.tsx:200-212`

**Interfaces:**
- Consumes: `createCounterpartyGroup({ name }): Promise<{ id: string | null; error: string | null }>` из `src/lib/finance/counterparties.ts` (проверяет дубль и пишет журнал).
- Produces: `CounterpartyGroupSelect({ id, value, onValueChange, groups, disabled, canCreate, ...fieldControl })` — внутри `OptionSelect` с опциями «Без группы», группы по алфавиту и, если `canCreate`, последним пунктом `{ value: "__new_group__", label: <Plus/> «Новая группа» }`. Выбор маркера не меняет значение, а открывает `Dialog` «Новая группа» с полем «Название» (обязательное, autofocus), кнопками «Отмена» / «Создать группу» («Создаём…»). Успех — новая группа добавляется в локальный список, выбирается (`onValueChange(id)`), `router.refresh()`; ошибка — текстом под полем, окно не закрывается.
- `canCreate` = право «Управлять контрагентами» (в карточке — `!readOnly`; в панели создания она и так открыта только с этим правом).

- [ ] **Step 1: Реализовать компонент и подставить в оба места**
- [ ] **Step 2: Проверить** — `pnpm exec tsc --noEmit && pnpm lint`
- [ ] **Step 3: Проверить в браузере**: в карточке создать группу «Поставщики молока» — она выбрана, полоса сохранения появилась; сохранить — группа в шапке. Повторить с тем же названием — ошибка «Группа «Поставщики молока» уже есть». В панели «Новый контрагент» — то же.
- [ ] **Step 4: Commit** — `git commit -m "Контрагенты: создание группы прямо из выбора"`

---

### Task 6: Справка и финальная проверка

**Files:**
- Modify: `docs/handbook/finance/counterparties.md` (разделы «Карточка» → «Документы», «Группы»)

- [ ] **Step 1: Обновить справку** — документы: загрузка нескольких файлов и перетаскиванием, предпросмотр PDF и фото, переименование, скачивание, удаление насовсем; группа создаётся и из выбора в карточке («+ Новая группа»). Без упоминаний действий сервера и таблиц.
- [ ] **Step 2: Полная проверка**

Run: `pnpm exec tsc --noEmit && pnpm lint && node --test --experimental-strip-types "src/**/*.test.mts"`
Expected: без ошибок, все тесты проходят.

- [ ] **Step 3: Commit** — `git commit -m "Справка: документы и группы контрагента"`
