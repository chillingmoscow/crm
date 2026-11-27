# База знаний, этап 2: документ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Страница документа выглядит как часть Sheerly: колонка 720 в общей рамке, заголовок по шкале, спокойная плашка обязательного чтения, обсуждение под текстом, редактор шрифтом Inter с заголовками и меню по DS, все значки редактора — Lucide одной толщины.

**Architecture:** Значки BlockNote приходят из `react-icons` (`ri`, `md`, `tb`, `ai`) — подменяем эти модули на прослойку с Lucide через `resolveAlias` (turbopack для dev) и `webpack` alias (для `next build`), а не переписываем каждую кнопку; тест сверяет, что прослойка экспортирует все имена, которые импортирует BlockNote. Плашка чтения и состав меню «⋯» — чистые функции в `src/lib/knowledge/document.ts` с тестами. Оформление редактора — в блоке `.bn-sheerly` в `globals.css`.

**Tech Stack:** Next.js 15 (turbopack dev, webpack build), BlockNote 0.49, lucide-react, Tailwind 3, node:test.

**Spec:** `docs/superpowers/specs/2026-11-27-kb-redesign-design.md` — разделы «Документ», «Иконки и шрифты», этап 2; макет `2026-11-27-kb-redesign-screens-mockup.html` экраны 1 и 4. Этап 1 (оболочка) — PR #787, эта ветка стоит поверх него.

## Global Constraints

- Правила `docs/design-system.md` (кегли 12/13/14/16/20/28/36, веса 400–700, радиусы, тени, отступы, `data-tip` вместо `title`, тексты без длинных тире). Раздел «База знаний» добавлен этапом 1.
- Верх документа остаётся воздушным: без строки автора и времени чтения под заголовком, без подписей капслоком над свойствами (решение владельца 18.05.2026).
- Перечитывание по кнопке менеджера и «Напомнить» — этап 3, здесь не делаем; плашка показывает существующее состояние «нужно перечитать».
- Картинки статьи уже идут через `mediaUrl` (`src/lib/knowledge/attachments.ts:141`) — не трогаем.
- Коллекции (таблицы внутри страниц) — этап 5; их CSS не трогаем, кроме общих переменных `.bn-sheerly`.
- Проверки: `pnpm exec tsc --noEmit` (кроме `.next/`), `pnpm lint`, `node --test --experimental-strip-types "src/**/*.test.mts"`.

## Review Focus

1. Длинный документ: прокрутить до конца, открыть «⋯», меню «/», меню блока, выбор цвета — меню на своих местах, ничего не выбирается само. → ручная проверка (Task 8).
2. Сотрудник открывает обязательную страницу впервые: «Прочитано» неактивна с видимой причиной, через порог активна; после нажатия — зелёная «Прочитано 27 ноября», счётчик «К прочтению» в дереве уменьшается. → тест `kbReadingPlate` (Task 4) + ручная проверка.
3. Менеджер с правом обязательного чтения, сам не прочитавший: видит и свою кнопку «Прочитано», и «Прочитали N из M · Кто прочитал». → тест `kbReadingPlate` (Task 4).
4. Сборка `next build` (webpack) подхватывает подмену значков так же, как dev (turbopack). → `pnpm build` в Task 1.
5. Тёмная тема и телефон: выноски, выделение, меню редактора читаются; поля документа 16px с обеих сторон, заголовок 28px. → ручная проверка (Task 8).

---

### Task 1: Значки редактора — Lucide вместо react-icons

**Files:**
- Create: `src/lib/knowledge/bn-icons/ri.tsx`, `md.tsx`, `tb.tsx`, `ai.tsx`, `make.tsx`
- Create: `src/lib/knowledge/bn-icons/bn-icons.test.mts`
- Modify: `next.config.ts` (`turbopack.resolveAlias`, `webpack` alias)

**Interfaces:**
- Produces: `makeBnIcon(icon: LucideIcon): IconType`-совместимый компонент (`(props: { size?: number | string; className?: string; ... }) => JSX`), 16px по умолчанию, без своего `strokeWidth`; модули экспортируют ровно имена, которые BlockNote импортирует: `ri` — 44 имени из `blocknote-react.js` + 6 из `FloatingThreadController-*.js` (RiAddFill, RiAlignCenter … RiVolumeUpFill; RiArrowGoBackFill, RiCheckFill, RiDeleteBinFill, RiEditFill, RiEmotionLine, RiMoreFill); `md` — MdArrowDropDown, MdDragIndicator; `tb` — TbPageBreak; `ai` — AiOutlinePlus.
- Соответствия (Lucide): H1–H6 → `Heading1`–`Heading6`; Text → `Type`; Bold/Italic/Underline/Strikethrough → одноимённые; Code* → `Code` / `SquareCode`; Quote → `Quote`; списки → `List`, `ListOrdered`, `ListChecks`; Table2 → `Table`; Image* → `Image` / `ImagePlus` / `ImageUp`; Video/Film → `Video` / `Film`; Volume → `Volume2`; File → `File`; Link / LinkUnlink → `Link` / `Unlink`; ExternalLink → `ExternalLink`; Align* → `AlignLeft/Center/Right/Justify`; Indent → `IndentIncrease/Decrease`; Merge cells → `TableCellsMerge`; Subtract → `Minus`; Add/Plus → `Plus`; Delete/Bin → `Trash2`; Download → `Download`; Emotion → `Smile`; Chat → `MessageSquare`; FontFamily → `CaseSensitive`; InputField → `TextCursorInput`; PlayList → `ListVideo`; ArrowGoBack → `Undo2`; Check → `Check`; Edit → `Pencil`; More → `MoreHorizontal`; DragIndicator → `GripVertical`; ArrowDropDown → `ChevronDown`; PageBreak → `SeparatorHorizontal`.

- [ ] **Step 1: Failing test** `bn-icons.test.mts`: читает `node_modules/@blocknote/react/dist/*.js` (через `createRequire(import.meta.url).resolve("@blocknote/react")` → папка `dist`), собирает регуляркой `import { … } from "react-icons/(ri|md|tb|ai)"` все имена (`RiBold as x` → `RiBold`), импортирует наши модули и проверяет `assert.equal(typeof mod[name], "function")` для каждого; плюс отдельный тест, что имён в `ri` ≥ 50 (BlockNote не съехал на другой набор незаметно).
- [ ] **Step 2:** `node --test --experimental-strip-types src/lib/knowledge/bn-icons/bn-icons.test.mts` → FAIL (модулей нет).
- [ ] **Step 3:** `make.tsx` + четыре модуля по таблице соответствий.
- [ ] **Step 4:** Тест → PASS.
- [ ] **Step 5:** `next.config.ts`: `turbopack.resolveAlias` и `webpack(config)` с `config.resolve.alias` для `react-icons/ri|md|tb|ai` → наши файлы (абсолютные пути через `path.join(process.cwd(), …)`). В комментарии — зачем и что тест сторожит.
- [ ] **Step 6:** Dev: меню «/», панель форматирования, ручка блока, меню таблицы и комментарии — значки линейные Lucide. `pnpm build` проходит (webpack подхватил alias).
- [ ] **Step 7:** `git commit -m "База знаний: значки редактора — Lucide вместо react-icons"`

### Task 2: Шрифт, заголовки и меню редактора

**Files:**
- Modify: `src/app/globals.css` — блок `.bn-sheerly` (≈ строки 255–2000, без коллекций)
- Modify: `src/components/knowledge/blocks/kb-callout-block.tsx`

Значения:
- `--bn-font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif` (как `font-sans` в `tailwind.config.ts:93`); текст статьи 16px / 1,6.
- Заголовки: H1 28px (`--level: 1.75em`), H2 20px (`1.25em`), H3 16px (`1em`), вес 600; `--prev-level` те же; отступы ручки блока у заголовков пересчитать под новые высоты.
- Выбранный пункт меню: `--bn-colors-selected-background: hsl(var(--brand) / 0.1)`, `--bn-colors-selected-text: hsl(var(--brand-text))` (вместо `--primary`).
- Меню «/», меню блока, выбор цвета, панель ссылки: радиус 10px, тень `theme('boxShadow.md')`, пункт 14px / 400, отступ пункта 8px 12px, радиус пункта 6px, значок 16px `muted-foreground`; подписи групп 12px / 500 обычным регистром без разрядки. Панель форматирования: радиус 10, `shadow-md`, кнопки 32px.
- Все `font-size`, `font-weight`, `border-radius`, `box-shadow` в блоке `.bn-sheerly` (кроме коллекций) — по шкале DS; свои `box-shadow` → `theme('boxShadow.*')`.
- Выноска: подложка `bg-{c}-500/10` без рамки, текст обычный, значок тона (info — `text-brand`, warning — `text-amber-700 dark:text-amber-400`, success — `text-emerald-700 dark:text-emerald-400`, error — `text-destructive`), радиус 8, отступ 12/14.

- [ ] **Step 1:** Правки CSS и выноски.
- [ ] **Step 2:** `grep -nE "font-size: (1[015]|11\\.5|12\\.5|13\\.5|14\\.5|2[46]|3[02])px|font-weight: (5[2-8]0|650|7[56]0|800)" src/app/globals.css` в диапазоне `.bn-sheerly` вне коллекций — пусто.
- [ ] **Step 3:** Dev, светлая и тёмная тема: H1/H2/H3, список, цитата, выноски четырёх тонов, меню «/» и цвета — сверка с правилами выше.
- [ ] **Step 4:** `git commit -m "База знаний: шрифт, заголовки и меню редактора по дизайн-системе"`

### Task 3: Раскладка документа

**Files:**
- Modify: `src/app/(dashboard)/knowledge/[slug]/page.tsx` (основной вид, «в корзине», «недоступна»)
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-editor.tsx` (значок, заголовок, слот под плашку, обсуждение вниз)
- Modify: `src/components/knowledge/page-comments/kb-page-comments.tsx`, `page-comment-composer.tsx`
- Modify: `src/app/(dashboard)/knowledge/_components/kb-children-list.tsx`, `kb-backlinks.tsx`, `kb-deleted-page-banner.tsx`

**Interfaces:**
- Produces: `KbPageEditor` получает `afterTitle?: ReactNode` (рендерится сразу под заголовком, до свойств) и `footer?: ReactNode` (после редактора и обсуждения не нужен — обсуждение рендерит сам редактор внизу).

Раскладка:
- Тело — `PageFrame`, внутри `mx-auto w-full max-w-[720px] flex flex-col gap-6`; без `pl-10 pr-4`. Ручка блоков остаётся слева от колонки (поле `PageFrame` на компьютере 42px — хватает).
- Значок страницы 44px (`KbIconPicker triggerSize={44}`), заголовок `text-[28px] md:text-4xl font-bold tracking-[-0.5px] leading-[1.2]` (вместо 40/800).
- Порядок под заголовком: плашка (`afterTitle`, Task 4) → свойства → текст → «Подстраницы» → «Обсуждение · N» → «Ссылаются сюда».
- Разделы под текстом — одинаково: `border-t pt-5 mt-2`, заголовок `h2` 16 / 600 с серым числом; без подписей капслоком. Обсуждение: «Обсуждение» вместо «Комментарии», аватары 28px через `PersonAvatar`, инициалы 12px.
- «В корзине»: плашка внутри колонки `rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm` с действиями «Восстановить» / «Удалить навсегда» (поведение то же). «Недостаточно прав»: `EmptyState` (иконка `ShieldAlert`, «Страница в корзине», «Попросите доступ у руководителя») вместо жёлтого блока.

- [ ] **Step 1:** Правки раскладки и разделов.
- [ ] **Step 2:** `grep -n "max-w-\[760px\]\|max-w-\[1100px\]\|text-\[40px\]\|font-extrabold" -r "src/app/(dashboard)/knowledge" src/components/knowledge` — пусто.
- [ ] **Step 3:** Dev: документ, удалённая страница (удалить тестовую и открыть), телефон 375px.
- [ ] **Step 4:** `git commit -m "База знаний: раскладка документа — колонка, заголовок, обсуждение под текстом"`

### Task 4: Плашка обязательного чтения

**Files:**
- Create: `src/lib/knowledge/document.ts`, `src/lib/knowledge/document.test.mts`
- Modify: `src/app/(dashboard)/knowledge/_components/kb-required-reading-banner.tsx` (переименовать экспорт не нужно — меняется вид)
- Modify: `src/app/(dashboard)/knowledge/[slug]/page.tsx` — статистика для менеджера

**Interfaces:**
- Produces:
  - `type KbReadingPlate = { kind: "none" } | { kind: "unread"; reread: boolean; canConfirm: boolean } | { kind: "read"; readAt: string }`
  - `kbReadingPlate(input: { required: boolean; readAt: string | null; needsReread: boolean; gateReady: boolean }): KbReadingPlate`
  - `type KbReadingStats = { read: number; total: number } | null` — показывается рядом при `canManageRequiredReading`.
- Consumes: `getKbRequiredReadingStats(pageId)` (`src/lib/knowledge/required-reading.ts:157`) — считать `read` по `read_at !== null`.

Вид (`rounded-lg border p-3 text-sm`, в колонке под заголовком):
- `unread`: `border-amber-500/30 bg-amber-500/10`, значок `BookCheck` (перечитать — `RotateCcw`) `text-amber-700 dark:text-amber-400`, текст «Обязательно к прочтению · ≈ N мин» / «Страница изменилась — прочитайте снова · ≈ N мин»; справа outline `Button size="sm"` «Прочитано» с `Check`; пока порог не пройден — кнопка неактивна, а слева от неё серым 13px «Сначала прочитайте страницу».
- `read`: `border-emerald-500/30 bg-emerald-500/10`, `Check` `text-emerald-700 dark:text-emerald-400`, «Прочитано 27 ноября» (`formatDayMonth`).
- Менеджер: в той же плашке справа «Прочитали 4 из 12», полоска 90px (`bg-brand/15`, заливка `bg-brand`), outline-ссылка «Кто прочитал» → `/knowledge/[slug]/required-reading`. Если плашка сотрудника `none` (страница не обязательная) — ничего.
- На телефоне кнопки уходят под текст во всю ширину.

- [ ] **Step 1: Failing test** `document.test.mts`: `required:false` → `none`; не прочитано и порог не пройден → `{unread, reread:false, canConfirm:false}`; `needsReread:true, gateReady:true` → `{unread, reread:true, canConfirm:true}`; `readAt` задан → `{read, readAt}`; `readAt` задан и `needsReread:true` → `unread` (новая версия важнее старого прочтения).
- [ ] **Step 2:** Запуск → FAIL.
- [ ] **Step 3:** `document.ts`, затем плашка и статистика в `page.tsx` (только при `required && canManageRequiredReading`), рендер через `afterTitle`.
- [ ] **Step 4:** Тест → PASS; dev: сотрудник и менеджер, нажать «Прочитано» — зелёная плашка, счётчик «К прочтению» в дереве −1.
- [ ] **Step 5:** `git commit -m "База знаний: плашка обязательного чтения в колонке документа"`

### Task 5: Действия документа в верхней панели

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-menu.tsx`, `kb-lock-header-chip.tsx`, `kb-favorite-toggle.tsx`
- Modify: `src/app/(dashboard)/knowledge/[slug]/page.tsx` (слот `PageHeaderActions`)
- Modify: `src/lib/knowledge/document.ts` (+ тест)

**Interfaces:**
- Produces: `kbPageMenuGroups(input: { canEdit; canDelete; canDuplicate; canExport; canImport; canManageTemplates; canManageRequiredReading; canLock; canViewVersionHistory; hasChildren }): string[][]` — ключи пунктов по группам; пустые группы выкидываются. Состав: `[["template"],["show-children"],["required","lock"],["duplicate"],["export","import"],["history"],["delete"]]` по правам; **нет** `favorite`, `undo`, `redo`, `analytics`, `who-read`.
- В панели справа налево: колокольчик, «?», `⋯`, `ⓘ`, `☆`, затем чип «Заблокировано».
  - `☆` — `KbFavoriteToggle` в виде кнопки панели (36px, `rounded-lg`, без рамки), закрашенная `text-amber-500 fill-amber-400`, `aria-pressed`, подсказка «Добавить в избранное» / «Убрать из избранного».
  - `ⓘ` — `EntityInfoPopover` («О странице»: создана / создал / изменена / изменил с аватарами; `extraRows`: «Время чтения ≈ N мин»); при `kb.view_analytics` под таблицей ссылка «Статистика страницы» → `/knowledge/dashboard/[slug]`.
  - Чип «Заблокировано» — `StatusBadge` тон `info` (12px / 500, `bg-brand/10 text-brand`) с прежним поведением (меню с «Редактировать» / «Разблокировать»); пункты его меню 14px.
- Меню «⋯»: пункты 14px, `px-3 py-2`, значок 16px, тень меню по умолчанию (`shadow-md`, без `shadow-lg`), без строки «Изменено …» внизу.

- [ ] **Step 1: Failing test** в `document.test.mts`: полный набор прав → группы ровно как выше; без прав редактирования → нет `template`, `show-children`, `required`, `lock`, `import`; ключи `undo`/`redo`/`favorite`/`analytics` не встречаются ни при каких правах.
- [ ] **Step 2:** FAIL → реализация `kbPageMenuGroups` → PASS.
- [ ] **Step 3:** Меню строится по `kbPageMenuGroups`; кнопки ☆ и ⓘ; чип.
- [ ] **Step 4:** Dev: все пункты меню работают как раньше (шаблон, подстраницы, обязательное, блокировка, дублирование, экспорт, импорт, история, удаление); ⌘Z / ⌘⇧Z в редакторе работают.
- [ ] **Step 5:** `git commit -m "База знаний: избранное и «О странице» в панели, меню ⋯ без лишнего"`

### Task 6: Свойства страницы по шкале

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx`, `page-properties/**/*.tsx`

- [ ] **Step 1:** `text-[10px]`/`text-[11px]` → `text-xs`, `text-[12px]` → `text-xs`, `text-[14px]` → `text-sm`, прозрачности текста `/55`–`/75` → `text-muted-foreground`; ширина подписи 168px и высота строки ~36px не меняются (решение владельца 18.05.2026). Значки — только из `KB_PROPERTY_UI_ICONS` (правило в памяти проекта), тест `property-ui-icons.test.mts` зелёный.
- [ ] **Step 2:** `grep -rn "text-\[1[01]px\]\|text-\[1[24]px\]" "src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx" "src/app/(dashboard)/knowledge/_components/page-properties"` — пусто; `node --test --experimental-strip-types "src/app/(dashboard)/knowledge/**/*.test.mts" src/components/knowledge/*.test.mts` — зелёный.
- [ ] **Step 3:** `git commit -m "База знаний: свойства страницы по шкале кеглей"`

### Task 7: Дизайн-система и справка

- [ ] **Step 1:** `docs/design-system.md`, раздел «База знаний» → подраздел «Документ»: колонка 720 в `PageFrame`, значок 44, заголовок 36 / 28, порядок блоков, плашка чтения (три состояния и менеджерская часть), разделы под текстом, редактор (шрифт, H1–H3, выбор, меню, выноски), панель документа (☆ ⓘ ⋯, чип), подмена `react-icons` и её тест.
- [ ] **Step 2:** `docs/handbook/knowledge/index.md`: как подтверждать прочтение, где «О странице», избранное звёздочкой, обсуждение внизу страницы, что убрано из меню «⋯» (отмена — ⌘Z).
- [ ] **Step 3:** `git commit -m "База знаний: правила документа в дизайн-системе и справке"`

### Task 8: Проверка целиком

- [ ] **Step 1:** `pnpm exec tsc --noEmit` (кроме `.next/`), `pnpm lint`, полный прогон тестов с `--experimental-vm-modules` — новых падений нет (8 старых в `provision.integration` — как на `main`).
- [ ] **Step 2:** Перезапуск dev с чистым `.next`, без ошибок в консоли: документ, удалённая страница, «Кто прочитал».
- [ ] **Step 3:** Review Focus 1–3, 5 в браузере: светлая и тёмная тема, 1440×900 и 375×812, владелец и сотрудник только с `kb.view_pages` (локальная выдача права и откат).
- [ ] **Step 4:** Скриншот документа рядом с экраном 1 макета; расхождения — в соответствующую задачу.
