# База знаний, этап 5: коллекции по дизайн-системе — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Блок «Коллекция» выглядит как часть приложения: кегли, начертания, радиусы, тени, вкладки, кнопки и меню — по `docs/design-system.md`, логика блока не переписывается.

**Architecture:** Вид коллекции задают ~150 правил `.kb-collection-*` в `src/app/globals.css` (участок «Collection block», ≈ строки 2517–4475) и разметка в `src/components/knowledge/blocks/collection/*` и `kb-collection-block.tsx`. Чистый помощник `css-scale.ts` разбирает CSS и находит значения вне шкалы; тест по участкам держит каждую задачу. Кнопки панели переходят на общий `Button`, всплывающие окна — на значения по умолчанию `PopoverContent`, остальное — правкой CSS. Два бага чинятся отдельной задачей (одна миграция данных).

**Tech Stack:** Next.js 15, React 19, Tailwind 3, BlockNote 0.49, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-27-kb-redesign-design.md` (этап 5 «Коллекции»; объём — вариант А, выбран владельцем 27.11.2026: «привести к дизайн-системе без переписывания логики»).

## Global Constraints

- Кегли только 12 / 13 / 14 / 16 / 20 / 28 px; начертания только 400 / 500 / 600 / 700 (DS «Типографика»).
- Радиусы: поле и кнопка 6, карточка и таблица 8, всплывающее окно 10 (не переопределять у `PopoverContent`), пункт меню 6, чип и точка — pill (DS «Скругления»).
- Тени только из шкалы (`shadow-sm` / `shadow` / `shadow-md` / `shadow-lg` или `theme('boxShadow.*')`); кольцо выделения `0 0 0 2px hsl(var(--brand) …)` и `inset 0 0 0 Npx` — обводка, не тень.
- Пункт меню: 14px / 400, `rounded-md px-3 py-2`, значок 16px серый; подписи групп 12px / 500 обычным регистром; разрушительное действие красным внизу через разделитель (DS «Выпадающий список вариантов», «Меню редактора»).
- Значки — Lucide без своих `strokeWidth`; системные серые, синий только у активного.
- Тексты без точки в конце пустых состояний, без длинных тире, без английских слов.
- Логику блока (`KbCollectionBlock`, перетаскивание, ширина колонок, фильтры, сортировки, группировка) не переписываем; меняется разметка обёрток и CSS.
- Миграция — `419_*.sql`, перед мержем сверить номер с `origin/main`.

## Review Focus

1. Перетаскивание колонок и вкладок видов, изменение ширины колонки, закрепление «Страницы» — работают как до этапа (тянуть за шапку, линия вставки синяя).
2. Редактирование ячеек (текст, число, выбор, чекбокс, дата) в таблице и чипов в списке — значения сохраняются, раскладка строки не прыгает.
3. Тёмная тема: таблица, вкладки, все всплывающие окна коллекции читаются, нет белых подложек.
4. Телефон 375px: кнопки панели в одну строку без кривого переноса, таблица прокручивается вбок внутри блока, страница не уезжает вбок.
5. Вид, который пользователь сам назвал «Галерея», миграция не трогает, если это таблица; список с этим именем по умолчанию становится «Список».

---

### Task 1: Проверка шкалы для CSS

**Files:**
- Create: `src/lib/knowledge/css-scale.ts`
- Test: `src/lib/knowledge/css-scale.test.mts`

**Interfaces:**
- Produces:
  - `parseCssRules(css: string): { selector: string; declarations: { prop: string; value: string }[] }[]` — без комментариев и `@media`-обёрток (правила внутри `@media` тоже возвращаются).
  - `offScaleDeclarations(rules, opts?: { selectorIncludes?: string }): { selector: string; prop: string; value: string }[]` — `font-size` вне {12,13,14,16,20,28}px, `font-weight` вне {400,500,600,700}, `border-radius` вне {0, 4px, 6px, 8px, 10px, 12px, 999px, 9999px, 50%, inherit}, `box-shadow` кроме `none`, `theme(...)`, колец `0 0 0 Npx …` и `inset 0 0 0 Npx …`.
  - `collectionCss(globalsCss: string): string` — текст от маркера `/* ── Collection block` до `/* ──── Плавный переход тем`.

- [ ] **Step 1: Тест** — `css-scale.test.mts`:
  - `offScaleDeclarations(parseCssRules(".a{font-size:13.5px;font-weight:650}"))` → две находки с `13.5px` и `650`;
  - `.a{font-size:13px;font-weight:600;border-radius:10px;box-shadow:0 0 0 2px hsl(var(--brand) / .12)}` → пусто;
  - `.a{box-shadow:0 18px 42px hsl(var(--foreground) / 0.15)}` → одна находка;
  - `@media (max-width:639px){.a{font-size:26px}}` → одна находка с селектором `.a`;
  - комментарий `/* font-size: 99px */` не даёт находок;
  - `selectorIncludes: "kb-collection"` отбрасывает `.kb-gallery-x{font-size:11px}`.
- [ ] **Step 2:** `node --test --experimental-strip-types src/lib/knowledge/css-scale.test.mts` → FAIL (нет модуля).
- [ ] **Step 3:** Реализовать три функции (регулярные выражения по `{}`; вложенные `@media` раскрыть на один уровень).
- [ ] **Step 4:** тот же запуск → PASS.
- [ ] **Step 5:** Commit `База знаний: проверка шкалы для CSS коллекций`.

### Task 2: Шапка, вкладки видов, панель кнопок

**Files:**
- Modify: `src/app/globals.css` (правила `kb-collection-block/header/title*/count/view-tab*/view-tabs*/view-add-inline/actions/search*/icon-btn/add-btn`)
- Modify: `src/components/knowledge/blocks/kb-collection-block.tsx` (разметка панели: поиск, кнопки фильтра/сортировки/настроек, «Добавить»)
- Test: `src/lib/knowledge/collection-styles.test.mts` (новый; читает `globals.css` через `collectionCss`)

**Interfaces:**
- Consumes: `parseCssRules`, `offScaleDeclarations`, `collectionCss` из Task 1.
- Produces: тест-файл с хелпером `collectionRules(prefixes: string[])`, который следующие задачи дополняют своими участками.

Решения:
- Заголовок коллекции — 20px / 600 (как H2 статьи; на телефоне то же), поле переименования — те же 20 / 600, высота 36, `rounded-md`.
- Счётчик — как у `TablePageHeader`: 12px / 500, `rounded-md`, `bg-muted`.
- Вкладки видов — вид «вкладок представления» (`workspace-tabs.module.css`): 13px / 500, без подложки, активная — `text-brand` 600 и подчёркивание 2px `brand`, ряд с нижней линией `border`; на телефоне ряд прокручивается вбок. Остаются кнопками с `aria-pressed` (Ruling: перевод на Radix `Tabs` сломал бы перетаскивание и правый клик).
- Кнопки панели — общий `Button variant="outline"` 32px (`h-8 w-8 p-0`, значок 16), без своей тени; активная (есть фильтр/сортировка) — `bg-brand/10 text-brand border-brand/30`. «Добавить» — `Button size="sm"` (`h-8`). Поиск раскрывается полем 32px `rounded-md` 13px.
- Телефон (< 640px): заголовок и счётчик строкой, вкладки — строкой с прокруткой, кнопки — строкой: значки слева, «Добавить» справа (`justify-between`), без центрирования.

- [ ] **Step 1: Тест** `header and toolbar are on the DS scale`: `offScaleDeclarations` по правилам, селектор которых содержит один из `kb-collection-block`, `-header`, `-title`, `-count`, `-view-tab`, `-view-add-inline`, `-actions`, `-search`, `-icon-btn`, `-add-btn` → `[]`. И `no own box-shadow on toolbar buttons`: у `.kb-collection-icon-btn` нет `box-shadow` (правило удалено или без тени).
- [ ] **Step 2:** запуск → FAIL (32px, 760, 650, 999px у вкладок, тень у кнопок).
- [ ] **Step 3:** Правка CSS и разметки по решениям выше; удалить ставшие ненужными правила.
- [ ] **Step 4:** запуск → PASS; `pnpm exec tsc --noEmit`.
- [ ] **Step 5:** Commit `База знаний: шапка и панель коллекции по шкале`.

### Task 3: Всплывающие окна и меню коллекции

**Files:**
- Modify: `src/app/globals.css` (правила `create-view*`, `view-menu`, `view-overflow*`, `view-icon*`, `view-description*`, `view-row`, `views-editor`, `layout-*`, `settings*`, `field-select*`, `field-toggle`, `filter*`, `sort*`, `grouping*`, `property-visibility*`, `field-editor`, `column-menu*`, `column-insert*`, `column-type*`, `column-create-btn`, `add-field-row`, `inline-icon-picker`)
- Modify: `collection/add-field-menu.tsx`, `column-menu.tsx`, `view-menu.tsx`, `views-editor.tsx`, `layout-options.tsx`, `icon-pickers.tsx`, `settings/*.tsx` — только классы и порядок разрушительных пунктов
- Test: `collection-styles.test.mts`

Решения:
- Окна не задают свои `border-radius`, `box-shadow`, `padding` — берут `PopoverContent` / `DropdownMenuContent` по умолчанию (10px, `shadow-md`); ширины классами `w-64` (меню колонки, вида, выбор поля), `w-80` (настройки, создание вида, перечень видов), `max-w-[calc(100vw-24px)]`.
- Пункты — 14px / 400, `rounded-md px-3 py-2` (высота 36), значок 16px серый, выбранный — `bg-accent` и `Check` справа; подписи групп («Добавить свойство», «Добавить вид», разделы настроек) — 12px / 500 серым, обычным регистром.
- Поля ввода внутри окон — общий `Input` (36px, 14px, `rounded-md`) без своих высот 30/34/38.
- «Удалить свойство», «Удалить вид» — последними, через разделитель, `text-destructive`.
- Плитки «Таблица / Список» в создании вида и в «Раскладке» — `rounded-lg border`, 13px / 500, выбранная — `border-brand bg-brand/10 text-brand`, без `inset`-тени.
- Кнопка «Создать» в панели вставки колонки — `Button size="sm"` во всю ширину.

- [ ] **Step 1: Тест** `popovers and menus are on the DS scale` — `offScaleDeclarations` по правилам с перечисленными префиксами → `[]`; `popovers keep PopoverContent radius and shadow` — у `.kb-collection-create-view-menu`, `-view-menu`, `-view-overflow-menu`, `-settings`, `-field-select-menu`, `-column-menu` нет деклараций `border-radius` и `box-shadow`.
- [ ] **Step 2:** запуск → FAIL.
- [ ] **Step 3:** Правка CSS и классов по решениям; разрушительные пункты в `column-menu.tsx` и `view-menu.tsx` — `text-destructive` и разделитель перед ними.
- [ ] **Step 4:** запуск → PASS; tsc.
- [ ] **Step 5:** Commit `База знаний: окна и меню коллекции по шкале`.

### Task 4: Таблица, список и пустое состояние

**Files:**
- Modify: `src/app/globals.css` (правила `table*`, `column-resizer`, `column-resize-indicator`, `column-drop-indicator`, `column-drag-preview`, `list`, `grouped-stack`, `group*`, `row*`, `preview`, `properties`, `property*`, `state`, `empty`, мобильный `@media` коллекции, `bn-drag-preview:has([data-kb-collection-block])`)
- Modify: `collection/table-view.tsx`, `collection/list-view.tsx`, `kb-collection-block.tsx` (пустое состояние)
- Test: `collection-styles.test.mts`

Решения:
- Карточка таблицы — `rounded-lg border`, шапка как у `DataTable`: `bg-muted`, 12px / 500 серым, высота 40; строки 13px, высота ячейки ≥ 40, наведение `bg-muted/40`; название записи — 13px / 500, синеет при наведении; «+ Добавить» внизу — 13px / 400 серым.
- Выделенная ячейка — кольцо `inset 0 0 0 2px hsl(var(--brand))` (остаётся).
- Список: строка — `rounded-lg border`, название 14px / 500, превью 13px серым, чипы свойств 12px pill `bg-muted`; заголовок группы 13px / 600, счётчик 12px / 500 `rounded-md bg-muted`.
- Пустая коллекция — рамка `rounded-lg border border-dashed bg-muted/40 p-6`, текст 13px «Записей пока нет» и кнопка `Button variant="outline" size="sm"` «Добавить запись» (если есть право создавать страницы); без своих 28px отступов.
- Телефон: таблица прокручивается вбок внутри своей карточки (`overflow-x: auto` у обёртки, блок не шире колонки), заголовок без мобильного 26px.

- [ ] **Step 1: Тест** `table, list and empty state are on the DS scale` — `offScaleDeclarations` по оставшимся префиксам → `[]`; и общий `whole collection section is on the DS scale` — `offScaleDeclarations(parseCssRules(collectionCss(css)), { selectorIncludes: "kb-collection" })` → `[]`.
- [ ] **Step 2:** запуск → FAIL.
- [ ] **Step 3:** Правка CSS и разметки по решениям.
- [ ] **Step 4:** запуск → PASS; tsc.
- [ ] **Step 5:** Commit `База знаний: таблица и список коллекции по шкале`.

### Task 5: Баги — имя первого вида и пропавшее свойство

**Files:**
- Modify: `src/lib/knowledge/collection.ts` — `kbCollectionSlashProps(pageId: string | null): { view: "list"; title: string; viewTitle: string; collectionId: string; schemaJson: string; visibleFieldIdsJson: string; fieldOrderIdsJson: string; viewId: "" }`
- Modify: `src/components/knowledge/blocknote-editor.tsx:346-362` — пункт «Коллекция» берёт props из `kbCollectionSlashProps`
- Create: `supabase/migrations/419_kb_collection_view_default_name.sql`
- Test: `src/lib/knowledge/collection.test.mts` (дописать)

- [ ] **Step 1: Тест** `slash collection starts with a list view named «Список»`: `kbCollectionSlashProps("p1").viewTitle === KB_COLLECTION_VIEW_LABELS.list` и `=== "Список"`, `view === "list"`, `collectionId === getPageCollectionId("p1")`; `kbCollectionSlashProps(null).collectionId` непустой.
- [ ] **Step 2:** запуск → FAIL (нет функции).
- [ ] **Step 3:** Функция в `collection.ts`, редактор её использует.
- [ ] **Step 4:** запуск → PASS.
- [ ] **Step 5: Миграция 419:** `update public.kb_collection_views set name = 'Список' where name = 'Галерея' and view_type = 'list';` и `alter table public.kb_collection_views alter column name set default 'Список';` Проверка в конце: `raise exception` по-русски, если осталась строка `name = 'Галерея' and view_type = 'list'`. Применить локально `pnpm db:reset` не нужно — `psql -f` на локальную базу; проверить, что строка с `view_type = 'table'` и именем «Галерея» не изменилась (Review Focus 5).
- [ ] **Step 6: Пропавшее свойство** — superpowers:systematic-debugging. Воспроизвести на новой коллекции: вставить «Коллекция» через «/», сразу (< 5 с) добавить свойство «Выбор» в виде «Таблица», открыть меню колонки, Escape, перезагрузить; смотреть `kb_collections.schema_json` и POST в логе. При найденной причине — тест на чистую часть (если причина в `collection-*.ts`) или защита в оркестраторе (кнопки свойств и настроек неактивны, пока коллекция не загружена из базы), проверка в браузере. Не воспроизвелось за 3 попытки — `Ruling:` в журнал с шагами, без правки.
- [ ] **Step 7:** Commit `База знаний: первый вид коллекции называется «Список»` (и, если найдено, отдельный коммит про свойство).

### Task 6: Документация и проверка

**Files:**
- Modify: `docs/design-system.md` → раздел «База знаний», новая таблица «Коллекции»
- Modify: `docs/handbook/knowledge/index.md` → раздел «Коллекции»
- Modify: `src/components/knowledge/blocks/collection/README.md` → строка «Вид — по DS, проверка `collection-styles.test.mts`»

- [ ] **Step 1:** DS: таблица «Коллекции» — заголовок, счётчик, вкладки видов, кнопки панели, окна и пункты, таблица, список, пустое состояние, телефон; ссылка на `collection-styles.test.mts` как сторож шкалы.
- [ ] **Step 2:** Справка: что такое коллекция (записи — подстраницы со свойствами), виды «Таблица» и «Список», добавить запись и свойство, фильтр, сортировка, группировка, скрыть свойство, переименовать и удалить вид; текущий пункт про очистку ячейки сохранить.
- [ ] **Step 3:** `pnpm exec tsc --noEmit`, `pnpm lint`, все юнит-тесты (`find src -name "*.test.mts" ! -name "*.integration.test.mts"`).
- [ ] **Step 4:** Браузер, светлая и тёмная тема, 1440 и 375: Review Focus 1–5; консоль чистой загрузки без ошибок.
- [ ] **Step 5:** Commit `База знаний: коллекции в дизайн-системе и справке`.
