# База знаний, этап 1: оболочка — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** База знаний получает оболочку приложения: компактное меню, общую верхнюю панель с путём и одним поиском, дерево «той же породы», что меню, и общие рамки и заголовки на всех своих страницах.

**Architecture:** Меню приложения становится управляемым (`SidebarProvider` в controlled-режиме) — в базе знаний своё состояние «развёрнуто/свёрнуто» в отдельной cookie, вне базы — прежнее. Базовый `DashboardTopbar` рендерится самой базой в своей правой колонке (чтобы дерево шло во всю высоту), с двумя слотами. Дерево перестраивается на те же размеры и подсветку, что `workspace-appearance.module.css`; решения, которые можно проверить без браузера, вынесены в чистые функции `src/lib/knowledge/shell.ts` с тестами `node:test`.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind 3, shadcn/ui (Radix), lucide-react, @dnd-kit, node:test.

**Spec:** `docs/superpowers/specs/2026-11-27-kb-redesign-design.md` (разделы «Раскладка», «Оболочка», «Иконки и шрифты», «Решения по вопросам проверки»; этап 1). Макеты: `…-layout-mockup.html` (вариант В), `…-screens-mockup.html` (экран 0 — дерево рядом с меню).

## Global Constraints

- Источник правил — `docs/design-system.md`: кегли 12/13/14/16/20/28/36, веса 400/500/600/700, радиусы 6/8/10/12/14/full, тени sm/DEFAULT/md/lg, отступы по шкале 4px. Никаких `text-[11px]`, `font-[550]`, `rounded-xl` у карточек, своих `box-shadow`, hex.
- Значки — только `lucide-react`, без своих `strokeWidth`; 16px в строках и меню, 17px у пунктов меню/дерева (как `.modernNavigation`), 18px в верхней панели.
- Тексты — по-русски, без длинных тире, без точки в пустых текстах; подсказки — `data-tip`, не `title`.
- Без изменений схемы БД и прав на этом этапе.
- Проверки перед push: `pnpm exec tsc --noEmit`, `pnpm lint`, тесты `node --test --experimental-strip-types "src/**/*.test.mts"`.
- Каждый PR, видимый пользователю, обновляет `docs/handbook/knowledge/index.md`.
- Сохранённую настройку меню `sidebar_state` база знаний не перезаписывает.

## Review Focus

1. Пользователь развернул меню в «Сотрудниках», зашёл в базу (меню свернулось), вышел — меню снова развёрнуто; и наоборот, в базе развернул — при следующем заходе в базу развёрнуто, а в «Сотрудниках» прежнее. → тест `resolveMenuOpen` (Task 1) + ручная проверка (Task 8).
2. Сотрудник без прав аналитики, корзины и без обязательных страниц: в дереве только «Главная» и «Страницы», без пустых подписей групп и без «К прочтению · 0». → тест `kbTreeServiceItems` (Task 1).
3. Глубокое дерево (5 уровней, длинные названия после импорта из Notion): путь в шапке не разъезжается, строки дерева обрезаются многоточием, отступ уровня не съедает название. → тест `kbCrumbs` на 6 уровнях (Task 1) + ручная проверка (Task 8).
4. Дерево спрятано кликом по значку «База знаний», меню компактное: наведение на значок открывает дерево поверх, слева от него ровно ширина компактного меню. → ручная проверка (Task 8).
5. Телефон: одна строка шапки (меню, «Страницы», путь, поиск-значок, ⋯, колокольчик), второй строки нет; ⌘K/поле поиска в базе открывает поиск по базе, а не палитру. → ручная проверка (Task 8).

---

### Task 1: Чистые правила оболочки

**Files:**
- Create: `src/lib/knowledge/shell.ts`
- Test: `src/lib/knowledge/shell.test.mts`

**Interfaces:**
- Produces:
  - `isKnowledgePath(pathname: string | null): boolean` — `/knowledge` и `/knowledge/…`, но не `/knowledgeX`.
  - `resolveMenuOpen(input: { onKnowledge: boolean; appOpen: boolean; kbOpen: boolean }): boolean`
  - `KB_MENU_COOKIE = "kb_menu_state"` (значение `"true"`/`"false"`, по умолчанию свёрнуто).
  - `type KbChainItem = { slug: string; title: string | null }`
  - `kbCrumbs(chain: KbChainItem[]): Crumb[]` — `chain` от корня к текущей (последний — текущая). Результат: `База знаний` (href `/knowledge`) / предки / текущая (без href, `title || "Без названия"`). Если предков больше трёх — `База знаний / первый предок / … / родитель / текущая`, где `…` — звено без href.
  - `type KbTreeServiceItem = { key: "home" | "overview" | "to-read" | "trash"; label: string; href: string; count?: number }`
  - `kbTreeServiceItems(input: { canViewOverview: boolean; canSeeTrash: boolean; requiredTotal: number; requiredUnread: number }): { top: KbTreeServiceItem[]; bottom: KbTreeServiceItem[] }` — `top`: «Главная» `/knowledge`; «Обзор» `/knowledge/dashboard` при `canViewOverview`; «К прочтению» `/knowledge#to-read` при `requiredTotal > 0`, `count` = `requiredUnread` только если > 0. `bottom`: «Корзина» `/knowledge/trash` при `canSeeTrash`.
  - `Crumb` импортировать типом из `@/components/shared/breadcrumbs` нельзя (клиентский модуль в .mts-тесте) — объявить локальный `type Crumb = { label: string; href?: string }`, совместимый структурно.

- [ ] **Step 1: Write the failing tests** — `shell.test.mts`:
  - `isKnowledgePath`: `"/knowledge"`→true, `"/knowledge/abc"`→true, `"/knowledge-x"`→false, `null`→false.
  - `resolveMenuOpen`: `{onKnowledge:false, appOpen:true, kbOpen:false}`→true; `{onKnowledge:true, appOpen:true, kbOpen:false}`→false; `{onKnowledge:true, appOpen:false, kbOpen:true}`→true.
  - `kbCrumbs([{slug:"a",title:"Бар"},{slug:"b",title:"Открытие бара"}])` deepEqual `[{label:"База знаний",href:"/knowledge"},{label:"Бар",href:"/knowledge/a"},{label:"Открытие бара"}]`.
  - `kbCrumbs` с 6 звеньями (`t1…t6`) deepEqual `[База знаний→/knowledge, t1→/knowledge/s1, {label:"…"}, t5→/knowledge/s5, {label:"t6"}]`; с `title:null` у текущей → `"Без названия"`.
  - `kbTreeServiceItems({canViewOverview:false, canSeeTrash:false, requiredTotal:0, requiredUnread:0})` → `top` только `home`, `bottom` пустой; `{true,true,5,2}` → `top` keys `["home","overview","to-read"]`, у `to-read` `count:2`, `bottom` `["trash"]`; `{…, requiredTotal:5, requiredUnread:0}` → `to-read` без `count`.
- [ ] **Step 2:** `node --test --experimental-strip-types src/lib/knowledge/shell.test.mts` → FAIL (модуля нет).
- [ ] **Step 3:** Реализовать `shell.ts` (без импорта React и Next).
- [ ] **Step 4:** Тот же запуск → PASS.
- [ ] **Step 5:** `git commit -m "База знаний: правила оболочки (меню, путь, служебные пункты)"`

### Task 2: Компактное меню в базе знаний

**Files:**
- Modify: `src/components/ui/sidebar.tsx:81-94` — cookie `sidebar_state` пишется только в неуправляемом режиме (когда нет `setOpenProp`).
- Create: `src/components/shared/workspace-sidebar-provider.tsx` (client)
- Modify: `src/app/(dashboard)/layout.tsx` — читать cookie `KB_MENU_COOKIE`, заменить `SidebarProvider defaultOpen` на `WorkspaceSidebarProvider`.

**Interfaces:**
- Consumes: `isKnowledgePath`, `resolveMenuOpen`, `KB_MENU_COOKIE` (Task 1).
- Produces: `WorkspaceSidebarProvider({ appDefaultOpen: boolean; kbDefaultOpen: boolean; className?: string; style?: CSSProperties; children })` — держит два состояния; `open = resolveMenuOpen(...)` по `usePathname()`; `onOpenChange(next)` меняет состояние текущего режима и пишет его cookie (`sidebar_state` вне базы, `kb_menu_state` в базе, `path=/; max-age=604800`).

- [ ] **Step 1:** Правка `sidebar.tsx`: перенести запись cookie внутрь ветки `else` (неуправляемый режим). Проверить `grep -rn "<SidebarProvider" src` — других управляемых вызовов нет, поведение остальных мест не меняется.
- [ ] **Step 2:** Реализовать `WorkspaceSidebarProvider` поверх `SidebarProvider open/onOpenChange`; `kbDefaultOpen` по умолчанию `false` (cookie нет → свёрнуто).
- [ ] **Step 3:** Подключить в `layout.tsx`: `appDefaultOpen = sidebar_state !== "false"`, `kbDefaultOpen = kb_menu_state === "true"`; проп `className`/`style` баннера режима просмотра — без изменений.
- [ ] **Step 4:** `pnpm exec tsc --noEmit` → без ошибок. В браузере: `/people/staff` (меню развёрнуто) → `/knowledge` (иконки) → `/people/staff` (развёрнуто); в базе развернуть кнопкой → перезагрузить `/knowledge` → развёрнуто; `/people/staff` → по-прежнему как было.
- [ ] **Step 5:** `git commit -m "База знаний: меню приложения сворачивается в иконки"`

### Task 3: Общая верхняя панель и один поиск

**Files:**
- Modify: `src/components/shared/dashboard-topbar.tsx`
- Modify: `src/app/(dashboard)/knowledge/layout.tsx:97-121` — убрать свою `<header>` и `<KbMobileSubHeader />`, рендерить `DashboardTopbar`.
- Delete: `src/app/(dashboard)/knowledge/_components/kb-mobile-sub-header.tsx`, `kb-breadcrumbs.tsx` (мёртвый), `kb-back-link.tsx` и `kb-section-header.tsx` после замены их вызовов.
- Modify: `src/components/shared/command-palette-trigger.tsx`
- Modify: `src/app/(dashboard)/knowledge/_components/kb-search-dialog.tsx` — `useKbSearchOptional()`, строка «Искать во всём приложении», убрать `KbSearchTrigger` (больше не нужен).
- Modify: `src/app/(dashboard)/knowledge/[slug]/page.tsx`, `trash/page.tsx`, `dashboard/page.tsx`, `dashboard/[slug]/page.tsx`, `[slug]/required-reading/page.tsx`, `page.tsx` — путь через `Breadcrumbs`.
- Create: `src/app/(dashboard)/knowledge/_components/knowledge-help.tsx`; Modify: `src/app/(dashboard)/_components/page-help-registry.tsx`.

**Interfaces:**
- Consumes: `kbCrumbs`, `isKnowledgePath` (Task 1).
- Produces:
  - `DashboardTopbar({ inKnowledge?: boolean; leading?: ReactNode; afterBreadcrumb?: ReactNode })` — в общем layout на путях базы возвращает `null`, в базе рендерится с `inKnowledge`. `leading` — после `SidebarTrigger` (в базе — кнопка «Страницы», `md:hidden`), `afterBreadcrumb` — сразу после слота пути (в базе — `KbSaveStatusBadge`, `hidden md:flex`).
  - `useKbSearchOptional(): SearchCtx | null`.
  - `CommandPaletteTrigger` в базе: подпись «Поиск по базе», `aria-label="Поиск по базе знаний"`, клик — `kbSearch.open()`; вне базы как сейчас.

- [ ] **Step 1:** `DashboardTopbar` с пропсами; KB-layout рендерит `<DashboardTopbar inKnowledge leading={<Suspense fallback={null}><KbMobileTreeLoader …/></Suspense>} afterBreadcrumb={<KbSaveStatusBadge />} />` в колонке `<main>`.
- [ ] **Step 2:** `CommandPaletteTrigger` + `useKbSearchOptional`. В окне поиска по базе внизу слева — кнопка-строка «Искать во всём приложении» (значок `Search` 16px, 13px, `text-muted-foreground hover:text-foreground`): закрывает окно и вызывает `openCommandPalette()`.
- [ ] **Step 3:** Заменить ссылки назад на `<Breadcrumbs items={…} />`: документ — `kbCrumbs(chain)` (нет цепочки — `kbCrumbs([{slug,title}])`); «Корзина» — `База знаний / Корзина`; «Обзор» (`dashboard/page.tsx`) — `База знаний / Обзор`; аналитика страницы (`dashboard/[slug]`) — `База знаний / Обзор / <страница>`; «Кто прочитал» — `…kbCrumbs(chain)` с последним звеном-ссылкой на страницу и `Кто прочитал`; главная — `База знаний` (одно звено). Ссылки «← К странице» в теле этих страниц удалить.
- [ ] **Step 4:** `KnowledgeHelp` — короткая справка раздела (что такое главная, дерево и «+», обязательное чтение, корзина хранит 30 дней — перенос текста-описания из шапки корзины); запись в реестре `match: p => isKnowledgePath(p)`, `title: "База знаний"`.
- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm lint` → чисто; `grep -rn "KbBackLink\|KbSectionHeader\|KbMobileSubHeader\|KbSearchTrigger" src` → пусто.
- [ ] **Step 6:** `git commit -m "База знаний: общая верхняя панель, путь и один поиск"`

### Task 4: Дерево в стиле меню

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-tree-nav.tsx` (шапка, служебные пункты, подписи групп, строки, вложенность, шеврон, подсветка)
- Create: `src/app/(dashboard)/knowledge/_components/kb-tree-create-menu.tsx`
- Modify: `src/app/(dashboard)/knowledge/_components/kb-template-picker.tsx` — управляемый режим `open?/onOpenChange?` (как у `KbImportDialog`), без своей кнопки в этом режиме.
- Modify: `src/app/(dashboard)/knowledge/_components/kb-tree-loader.tsx`, `src/lib/knowledge/landing.ts`, `src/lib/knowledge/required-reading.ts:135` (`revalidatePath("/knowledge", "layout")`).
- Modify: `src/components/shared/nav-glide.ts` — необязательный 4-й параметр `selector = 'a[aria-current="page"]'`.
- Modify: `src/app/(dashboard)/knowledge/_components/kb-mobile-tree-drawer.tsx` — те же служебные пункты.

**Interfaces:**
- Consumes: `kbTreeServiceItems`, `KbTreeServiceItem` (Task 1).
- Produces:
  - `getKbRequiredReadingSummary = cache(async () => ({ total: number; unread: number }))` в `landing.ts` (через `getKbRequiredUnreadForUser` и count-запрос, как в `knowledge/page.tsx:62-67`).
  - `KbTreeNav` пропсы: убрать `canViewAudit`; добавить `readingSummary: { total: number; unread: number }`, `canViewOverview: boolean` (= `kb.view_analytics || kb.manage_required_reading || org.view_audit`).
  - `KbTreeCreateMenu({ canCreate; canImport; canManageTemplates })` — кнопка «+» 36px ghost (`aria-label="Создать"`, `data-tip`), меню: «Новая страница» (`FilePlus`, ⇧⌘P подписью), «Из шаблона» (`LayoutTemplate`), «Импорт» (`Upload`) — по правам; если доступен только один пункт — кнопка сразу выполняет его (правило DS «меню ⋯ только при двух и больше»).
  - `useActiveNavGlide(containerRef, pathname, enabled, selector?)`.

Размеры (из `workspace-appearance.module.css`, сверено со спекой):
- колонка: `bg-sidebar`, поля `px-3.5` (14px) снизу `pb-3`; шапка `h-[68px]` (совпадает с верхней панелью), «База знаний» `text-base font-semibold`, справа `KbTreeCreateMenu`;
- служебный пункт: `min-h-[41px] px-3 gap-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground`, значок 17px (`size-[17px]`); счётчик — та же пилюля, что у бейджей меню; активный — `bg-brand/10 text-brand font-semibold`;
- подпись группы («Избранное», «Страницы»): `px-3 pt-[18px] pb-2 text-xs font-medium uppercase tracking-[0.6px] text-muted-foreground` (как `.navCaption`; «Избранное» — только когда не пусто);
- строка страницы: `min-h-9 pl-3 pr-2 gap-2.5 rounded-lg text-[13px] font-medium`, значок страницы 16px; активная — `bg-brand/10 text-brand font-semibold` + `data-kb-active="true"`;
- вложенные: контейнер `ml-5 border-l border-border/75 pl-[9px] flex flex-col gap-0.5`, строки `font-normal` (активная — `font-semibold`); отступ `depth * 14` убрать; зоны перетаскивания (линия вставки) — по ширине строки контейнера;
- шеврон — справа, кнопка 24px с `aria-expanded`, `ChevronRight` 16px `text-muted-foreground/60` + `.motion-chevron` (`data-open`); значок страницы больше не прячется под шевроном; «+» и ⋯ узла — перед шевроном, видимы при наведении/фокусе;
- раскрытие — `ExpandPanel` из `@/components/shared/overview-toggle`, но детей монтировать только после первого раскрытия узла (большие импортированные деревья не должны рендериться целиком);
- подсветка переезжает: `useActiveNavGlide(navRef, pathname, true, '[data-kb-active="true"]')`;
- внизу колонки `bottom`-пункты («Корзина») в стиле служебного пункта; группа «Инструменты менеджера» и `KbToolLink` удаляются.

- [ ] **Step 1:** `getKbRequiredReadingSummary` + передача в дерево из `KbTreeLoader`/`KbMobileTreeLoader`; `revalidatePath("/knowledge", "layout")` в `markKbPageAsRead`, чтобы счётчик в дереве обновлялся после «Прочитано».
- [ ] **Step 2:** `KbTemplatePicker` — управляемый режим; `KbTreeCreateMenu`; из шапки дерева убрать отдельные кнопки поиска, шаблона и импорта. Хоткей «новая страница» (`KB_COMMAND_EVENT`) переезжает в `KbTreeCreateMenu` без изменения поведения.
- [ ] **Step 3:** Служебные пункты, подписи групп, строки, вложенность, шеврон, `ExpandPanel`, подсветка — по таблице размеров. Перетаскивание (`dnd-kit`) и меню узла (`KbTreeNodeMenu`) сохраняют поведение.
- [ ] **Step 4:** `nav-glide.ts` — параметр `selector`; общий вызов в `src/components/shared/sidebar.tsx` не меняется.
- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm lint && node --test --experimental-strip-types "src/**/*.test.mts"` → чисто. В браузере: дерево рядом с меню выглядит как экран 0 макета (сравнить скриншотом), перетаскивание страницы в другой раздел работает, «+» → «Из шаблона» открывает выбор шаблона, «К прочтению · N» уменьшается после «Прочитано».
- [ ] **Step 6:** `git commit -m "База знаний: дерево в стиле меню приложения"`

### Task 5: Дерево не уезжает при открытом меню

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-sidebar-shell.tsx:92-103`

Причина: открытое меню Radix блокирует прокрутку (`overflow: hidden` на `body`), `body` становится контейнером прокрутки, и `sticky top-0` колонки дерева считается от него — колонка уезжает на величину прокрутки страницы. Решение — как у меню приложения: колонка `fixed` по высоте экрана + распорка той же ширины в потоке (ширина — из `KbSidebarResizer`, тот же источник, что сейчас). Отступ слева — ширина меню приложения (`var(--sidebar-width-icon)` в компактном виде, `var(--sidebar-width)` в развёрнутом), как уже считает режим «подсмотреть»; плюс `--impersonation-offset` сверху.

- [ ] **Step 1:** Перевести видимую колонку на `fixed` + распорку; режим «подсмотреть» не меняется (он уже `fixed`), тень у него — `shadow-lg` вместо `shadow-xl`.
- [ ] **Step 2:** В браузере (1440×900, документ из тестовых данных): прокрутить вниз, открыть ⋯ в верхней панели — дерево на месте; потянуть ручку ширины — распорка и колонка меняются вместе; режим просмотра за другого (баннер) — дерево под баннером.
- [ ] **Step 3:** `git commit -m "База знаний: дерево не уезжает при открытом меню"`

### Task 6: Рамки, заголовки и маршруты

**Files:**
- Modify: `src/app/(dashboard)/knowledge/page.tsx`, `trash/page.tsx` (+ `trash/_components/kb-trash-client.tsx` — шапка), `dashboard/page.tsx`, `dashboard/[slug]/page.tsx`, `[slug]/required-reading/page.tsx`, `[slug]/page.tsx:368-369` и места `max-w-[760px]`/`max-w-[1100px]` в этих файлах.
- Create: `loading.tsx` и `error.tsx` в `knowledge/`, `knowledge/[slug]/`, `knowledge/trash/`, `knowledge/[slug]/required-reading/`, `knowledge/dashboard/[slug]/`; Modify: `knowledge/dashboard/loading.tsx`; Create: `knowledge/dashboard/error.tsx`.
- Modify: `src/app/(dashboard)/knowledge/_components/kb-nav-link.tsx`, `src/components/shared/sidebar.tsx:372-385` (передать `href`).

**Interfaces:**
- Consumes: `Breadcrumbs` (Task 3).
- Produces: `KbNavLink({ collapsed; initialHidden; href })` — `href` = `/knowledge/dashboard` при `kb.view_analytics`, иначе `/knowledge` (вычисляется в `AppSidebar` из `userPermissions`).

- [ ] **Step 1:** Главная `/knowledge` больше не перенаправляет на «Обзор» (`page.tsx:42`); «куда ведёт» решает `KbNavLink href`. Блок обязательного чтения получает `id="to-read"` и `scroll-mt-6`.
- [ ] **Step 2:** Каждая служебная страница — в `PageFrame`, документ и «Кто прочитал» — в `PageFrame` с колонкой `mx-auto max-w-[720px]` (у документа сохранить место под ручку блоков слева: левое поле колонки — внутри 720, не снаружи). Заголовки — `<h1>` 36px (`text-[28px] md:text-4xl font-bold tracking-tight`): «База знаний» (без приветствия; приветствие остаётся на «Сегодня»), «Обзор», «Корзина», «Кто прочитал». Описания под заголовками удалить. Строка «У вас N … к прочтению» уходит в блок «К прочтению» (`countRu` вместо `articleWord`).
- [ ] **Step 3:** `metadata`/`generateMetadata` с `title`: «База знаний», «Обзор», «Корзина», `<название страницы>`, «Кто прочитал — <название>» (шаблон « — Sheerly» добавляет корневой layout — проверить, как у `people/staff/page.tsx:14`).
- [ ] **Step 4:** `loading.tsx` — скелетон по форме в той же рамке (шапка 36px + блоки), без текста «Загружаем…»; `error.tsx` — по образцу `people/staff/error.tsx` («Не удалось открыть …», «Повторить», ссылка «К базе знаний» на вложенных).
- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm lint` → чисто; `grep -rn "max-w-\[760px\]\|max-w-\[1100px\]\|text-\[28px\] font-bold" "src/app/(dashboard)/knowledge"` → нет совпадений вне документа-редактора (этап 2).
- [ ] **Step 6:** `git commit -m "База знаний: общие рамки, заголовки и названия вкладок"`

### Task 7: Дизайн-система и справка

**Files:**
- Modify: `docs/design-system.md` — новый раздел «База знаний» (после «Общая оболочка приложения»): раскладка В и её поведение, верхняя панель и один поиск, дерево (таблица размеров из Task 4), правило значков и кеглей из спеки; строку «В базе знаний сохраняется отдельное дерево, верхняя панель оформляется как общая» в «Общей оболочке» заменить ссылкой на новый раздел; в «Палитре ⌘K» — что поле в базе подписано «Поиск по базе» и из окна есть переход во всё приложение.
- Modify: `docs/handbook/knowledge/index.md` — главная без перенаправления менеджера, дерево (Главная, Обзор, К прочтению, Избранное, Страницы, Корзина, «+»), сворачивание меню в базе, поиск.

- [ ] **Step 1:** Записать оба раздела (для пользователя — без имён компонентов, cookie и прав-кодов).
- [ ] **Step 2:** `git commit -m "База знаний: правила оболочки в дизайн-системе и справке"`

### Task 8: Проверка целиком

- [ ] **Step 1:** `pnpm exec tsc --noEmit && pnpm lint && node --test --experimental-strip-types "src/**/*.test.mts"` → всё зелёное (вывод приложить).
- [ ] **Step 2:** Браузер, светлая и тёмная тема, 1440×900, владелец (тестовые страницы — `scratchpad/kbseed/seed.sql`): пункты Review Focus 1, 3, 4; путь на документе 3-го уровня; ⌘K в базе открывает поиск по базе, «Искать во всём приложении» — палитру; «?» открывает справку раздела; название вкладки браузера.
- [ ] **Step 3:** Телефон 375×812: пункт Review Focus 5; дерево в выезжающей панели со служебными пунктами.
- [ ] **Step 4:** Пользователь без прав аналитики и корзины (выдать локально роль сотрудника тестовому `manager@test.com` или создать роль без `kb.view_analytics`/`kb.delete_pages`): пункт Review Focus 2; «База знаний» в меню ведёт на главную.
- [ ] **Step 5:** Скриншоты дерева рядом с меню (светлая/тёмная) — сравнить с экраном 0 макета; расхождения исправить в Task 4 и повторить шаг.
