# База знаний, этап 4: окна и служебное — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Окна и служебные страницы базы знаний собраны на общих компонентах приложения: история версий в `EditDrawer`, корзина на `DataTable` с `TableBulkBar`, поиск, импорт и шаблоны по шкале DS, аватары — `PersonAvatar`, мобильная панель — общая палитра.

**Architecture:** Общий `PersonAvatar` получает размеры и тихий режим без карточки при наведении — так его можно ставить в редактор, ссылки и плотные меню; все самодельные аватары базы знаний переходят на него. Историю версий переносим в `EditDrawer` с блоками `drawer-blocks` и `StatusBadge`, просмотр версии — общий `Dialog`. Корзину собираем по эталону списков (`documents/writeoffs`): `TablePageHeader` + `TableControls` с поиском, `DataTable` с группами по дате, строчное меню и плавающий `TableBulkBar`. Чистые правила (размеры аватара, группы корзины, подписи версий) — в `src/lib` с тестами.

**Tech Stack:** Next.js 15, React 19, Tailwind 3, @tanstack/react-table, BlockNote 0.49, node:test.

**Spec:** `docs/superpowers/specs/2026-11-27-kb-redesign-design.md` — «Окна и панели», «Служебные страницы» → «Корзина», этап 4.

## Global Constraints

- `docs/design-system.md` — первоисточник: кегли 12/13/14/16/18/20/28/36 (без `text-[10px]`, `text-[11px]`, `text-[15px]`), радиусы по шкале (окно 12, карточка 8), тени `shadow-md` / `shadow-lg`, бренд — `brand`, не `primary` и не сырые `blue-*`, статусы — только `StatusBadge`, пусто — `EmptyState`, ожидание — скелетоны, подтверждения — `ConfirmDialog` / `useConfirm`, тексты без длинных тире, числа со словами — `countRu`.
- Поведение не меняем, кроме названного в задачах; серверные действия и данные (`versions.ts`, `pages.ts`, `templates.ts`, импорт) не трогаем.
- Проверки: `pnpm exec tsc --noEmit` (кроме `.next/`), `pnpm lint`, `node --test --experimental-strip-types --experimental-vm-modules "src/**/*.test.mts"`.

## Review Focus

1. Аватар внутри ссылки, кнопки или редактора (упоминание в тексте, автор версии в кнопке сессии, ответы в треде): нет вложенной кнопки и карточки при наведении, клик ведёт туда же, куда раньше. → ручная проверка (Task 7) + тест режима в `person-avatar`.
2. Корзина: поиск, выбор нескольких страниц, «Восстановить» и «Удалить навсегда» из панели выделенного, «Очистить корзину» — работают как раньше; после действия выбор снимается. → ручная проверка (Task 7).
3. История версий на телефоне 375px: панель во всю ширину, просмотр версии читается, «Восстановить эту версию» доступна. → ручная проверка (Task 7).
4. Мобильная панель цветов в тёмной теме: цвета совпадают с выбором цвета на компьютере. → ручная проверка (Task 7).
5. Поиск по базе: ⌘K, «Спросить ИИ», выбор результата стрелками — как раньше. → ручная проверка (Task 7).

---

### Task 1: `PersonAvatar` — размеры и тихий режим; аватары базы знаний

**Files:**
- Modify: `src/components/people/person-avatar.tsx`
- Create: `src/components/people/person-avatar-size.ts` + `person-avatar-size.test.mts`
- Modify (переход на `PersonAvatar`): `KB/kb-version-history.tsx` (Avatar), `KB/kb-link-preview.tsx`, `KB/kb-mention-menu.tsx`, `src/components/knowledge/blocks/{kb-staff-mention, kb-floating-composer, kb-comment-mention-dropdown, kb-floating-thread}.tsx`, `src/components/knowledge/page-comments/{comment-body-renderer, page-comment-composer, page-comment-item}.tsx`, `src/components/shared/entity-info-popover.tsx` (MiniAvatar), `src/components/shared/employee-identity.tsx`

**Interfaces:**
- Produces: `PersonAvatar` с `size?: "xs" | "sm" | "md" | "lg"` (14 / 20 / 28 / 36, по умолчанию `lg` — как сейчас) и `interactive?: boolean` (по умолчанию `true`; `false` — `<span>` без карточки при наведении). `personAvatarSize(size)` → `{ box: string; text: string }` — классы рамки и кегля инициалов. Инициалы в аватарах 20 и 14px — 10 и 8px: единственное исключение из шкалы кеглей, оговорить в DS (иначе буквы не помещаются в круг).

- [ ] **Step 1: Тест** `person-avatar-size.test.mts`: `lg` → `size-9` + `text-xs`, `md` → `size-7` + `text-xs`, `sm` → `size-5` + `text-[10px]`, `xs` → `size-[14px]` + `text-[8px]`; без размера — как `lg`.
- [ ] **Step 2: FAIL**, **Step 3: реализовать**, **Step 4: PASS**.
- [ ] **Step 5:** `PersonAvatar`: размеры через `personAvatarSize`; при `interactive={false}` — статичный `<span>`; инициалы — `personInitials`, фон без фото — `bg-muted` (цветные точки из `avatar-color` в меню упоминаний уходят).
- [ ] **Step 6:** Заменить самодельные аватары по списку файлов; внутри ссылок, кнопок, редактора и всплывающих карточек — `interactive={false}`. `EmployeeIdentity` — `PersonAvatar size="lg" interactive={false}`, кегли имени и должности по шкале (13 / 12).
- [ ] **Step 7: tsc, lint, Commit** `Аватары: размеры и тихий режим у PersonAvatar, база знаний на нём`.

### Task 2: История версий в `EditDrawer`

**Files:**
- Modify: `KB/kb-version-history.tsx`, `KB/kb-version-snapshot-preview.tsx`
- Create: `src/lib/knowledge/version-labels.ts` + `version-labels.test.mts`

**Interfaces:**
- Produces: `kbVersionDeltaLabel(delta: number | null): { text: string; tone: StatusTone }` («Первая версия» neutral, «Без изменения длины» neutral, «+120 символов» success, «−40 символов» danger), `kbChangeKindLabel(kind)` (Заголовок, Свойства, Значок, Восстановление, Текст).

- [ ] **Step 1: Тесты** обеих функций, **Step 2: FAIL**, **Step 3: реализовать**, **Step 4: PASS**.
- [ ] **Step 5: Панель**: `EditDrawer title="История версий"` (520px), описание одной строкой «N версий · M сессий правки» через `countRu`; дни — `DrawerSection` с заголовком «Сегодня / Вчера / 27 ноября» (без капслока и липкого размытия); сессия — строка с `PersonAvatar size="md" interactive={false}`, автором, временем и `StatusBadge` видов правки; раскрытая сессия — версии с `StatusBadge info` «Текущая», временем, `StatusBadge` изменения длины и ghost «Просмотреть».
- [ ] **Step 6: Состояния**: ожидание — скелетон строк (как `TimelineSkeleton`), ошибка — `EmptyState illustration="error"` с «Повторить», пусто — `EmptyState` «Истории пока нет»; diff — «Удалено» / «Добавлено» через `StatusBadge danger/success`, ожидание diff — скелетон.
- [ ] **Step 7: Просмотр версии** — `Dialog` с `DialogContent className="flex h-[min(90dvh,900px)] max-w-4xl flex-col"` (как просмотр документа), заголовок 18px «Версия N», автор и время — строкой `text-[13px] text-muted-foreground`, подвал — `DialogFooter` с «Закрыть» и «Восстановить эту версию» (при праве); снимок — без `rounded-xl` и `text-4xl` вне шкалы (заголовок 28px), ожидание — скелетон. Удалить неиспользуемый `KbVersionSnapshotLoading` и локальный `plural`.
- [ ] **Step 8: tsc, lint, Commit** `База знаний: история версий в EditDrawer`.

### Task 3: Поиск по базе — токены шкалы

**Files:** Modify: `KB/kb-search-dialog.tsx`

- [ ] **Step 1:** Окно: `rounded-xl`, `shadow-lg`, `hideClose` вместо селектора, отступы по сетке 4px; поле ввода 16px; бейджи клавиш — как в общей палитре (`rounded-sm text-xs`).
- [ ] **Step 2:** «Спросить ИИ» — `bg-brand/10`, текст и значок `text-brand`; подсветка совпадений — `bg-brand/15` без сырого жёлтого; подписи групп («Источники») — 12/500 обычным регистром; ложный заголовок «Недавние» (недавних нет) убрать, подсказка без курсива.
- [ ] **Step 3:** Ожидание — скелетон строк как в общей палитре (`SearchSkeleton`), «Ничего не найдено» — `EmptyIllustration kind="search"` с текстом; ошибка поиска — видимый текст «Не удалось выполнить поиск», а не пустой список.
- [ ] **Step 4: tsc, lint, Commit** `База знаний: поиск по базе на токенах шкалы`.

### Task 4: Импорт и выбор шаблона

**Files:** Modify: `KB/kb-import-dialog.tsx`, `KB/kb-import-dialog-body.tsx`, `KB/kb-template-picker.tsx`

- [ ] **Step 1: Импорт**: ширина окна 480 (по умолчанию), пока грузится тело окна — `Dialog` со скелетоном, а не пустота; кегли 12/13/14; цвета статусов файлов — `amber-700`/`emerald-700` (dark `-400`); эмодзи и символы «•», «✓», «▾▸» — значки Lucide; «выделить все / снять все» — sentence-case кнопки без подчёркивания; локальный `recordWord` → `countRu`.
- [ ] **Step 2: Шаблоны**: ширина 480, подписи категорий 12/500 обычным регистром, описание `text-xs`, ожидание — скелетон, пусто — `EmptyState` «Шаблонов пока нет» с пояснением, кнопка удаления `rounded-md`.
- [ ] **Step 3: tsc, lint, Commit** `База знаний: импорт и шаблоны по шкале`.

### Task 5: Мобильная панель — общая палитра

**Files:** Modify: `src/components/knowledge/kb-mobile-toolbar.tsx`, `src/app/globals.css`

- [ ] **Step 1:** Список цветов — из `PALETTE_COLORS` (`src/lib/palette.ts`) в порядке выбора цвета на компьютере; подпись «По умолчанию» вместо «Авто»; образцы — `var(--palette-{c}-fg)` для текста и `var(--palette-{c}-bg)` для фона (своих hex нет), так тёмная тема совпадает с компьютером.
- [ ] **Step 2: tsc, lint, Commit** `База знаний: мобильная панель на общей палитре`.

### Task 6: Корзина по образцу списков

**Files:**
- Modify: `src/app/(dashboard)/knowledge/trash/page.tsx`, `loading.tsx`, `_components/kb-trash-client.tsx`
- Delete: `_components/trash-item-row.tsx` (строки уходят в столбцы таблицы)
- Create: `src/lib/knowledge/trash.ts` + `trash.test.mts`
- Modify: `KB/knowledge-help.tsx`

**Interfaces:**
- Produces: `kbTrashBucket(deletedAt: string, now: Date): "today" | "yesterday" | "week" | "earlier"` и подписи групп («Сегодня», «Вчера», «На прошлой неделе», «Ранее»); `kbTrashMatches(row, query)` — поиск по названию без учёта регистра и «ё».

- [ ] **Step 1: Тесты** `kbTrashBucket` (границы суток в часовом поясе аккаунта не нужны — по локальному дню браузера, как сейчас) и `kbTrashMatches` («Ёлка» находит «елка»). **Step 2: FAIL**, **Step 3: реализовать**, **Step 4: PASS**.
- [ ] **Step 5:** Шапка: `TablePageHeader title="Корзина" count={N}` и `TableControls` с поиском (`useTableState`), справа «Очистить корзину» (как сейчас). Описания под заголовком нет.
- [ ] **Step 6:** `DataTable`: столбец выбора, «Страница» (значок, название, «+ N подстраниц»), «Удалил», «Удалена» (относительное время), строчное меню (`TableRowMenu`: «Открыть для чтения», «Восстановить», «Удалить навсегда» с `ConfirmDialog`); группы по дате (`groups`); на телефоне — карточки; ожидание — `ListPageLoading`.
- [ ] **Step 7:** Выделенное — `TableBulkBar floating`: «Восстановить» и «Удалить навсегда» (с `ConfirmDialog`, последствия как сейчас); после действия выбор снимается.
- [ ] **Step 8:** Срок хранения — см. открытый вопрос в сообщении с планом; по решению: в пустом состоянии и справке «?» (`knowledge-help.tsx`) честный текст, столбец «Осталось» — только если срок реально соблюдается.
- [ ] **Step 9: tsc, lint, Commit** `База знаний: корзина на DataTable`.

### Task 7: Дизайн-система, справка, проверка

- [ ] **Step 1:** `docs/design-system.md` → «База знаний»: история версий, корзина, поиск, импорт и шаблоны; раздел про аватары — размеры `PersonAvatar` и тихий режим. `docs/handbook/knowledge/index.md` — «История версий», «Корзина», «Импорт», «Шаблоны».
- [ ] **Step 2:** tsc, lint, все тесты; в браузере светлая и тёмная тема, 1440×900 и 375×812: Review Focus 1–5, консоль без ошибок после чистого запуска.
- [ ] **Step 3: Commit** `База знаний: окна и служебное в дизайн-системе и справке`.
