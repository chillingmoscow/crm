# Мобильная веб-версия: грабли и решения

Источник правды по тому, как приложение ведёт себя на телефоне (в первую
очередь **iOS Safari**), и почему сделано именно так. Большинство пунктов
здесь — это уже пойманные баги, которые легко повторить заново, если не
знать про них. Перед правкой мобильной вёрстки (особенно тулбаров, таблиц,
сайдбара, инпутов) — пробегись по этому файлу.

Накоплено в ходе доводки раздела «Акты инвентаризации» на телефоне
(PR #424–#432), но правила общие для всего приложения.

> Прод — self-hosted на Coolify, деплой по мержу в `main`. После каждого
> мержа на телефоне нужен **Hard Refresh** (иначе виден старый кэш). Это не
> баг — просто всегда напоминаем об этом при проверке.

---

## 1. iOS Safari: горизонтальное переполнение → «чёрная/белая полоса справа»

**Симптом.** При отдалении (pinch-zoom out) справа от страницы виден пустой
кусок (чёрный в тёмной теме), страница масштабируется не на всю ширину
экрана. Значит layout viewport шире экрана — что-то распирает страницу по
горизонтали.

**Что НЕ работает.**
- `overflow-x: clip` на промежуточном контейнере (`<main>`). **Single-axis
  `overflow: clip` ненадёжен на iOS Safari** — он его игнорирует, полоса
  остаётся. (Проверено: `overflow-x-clip` на `<main>` в [`layout.tsx`](../src/app/(dashboard)/layout.tsx) полосу НЕ убрал.)
- Только `min-w-0` на флекс-цепочке — помогает от флекс-трапа (см. §3), но
  не от iOS-специфики, когда inline `min-width` шире экрана сам по себе
  расширяет layout viewport даже внутри scroll-контейнера.

**Что работает (canonical iOS-фикс).** `overflow-x: hidden` на `html` + `body`
(см. [`globals.css`](../src/app/globals.css), `@layer base`):

```css
html, body { overflow-x: hidden; }
```

Клампит ширину страницы к экрану. Широкие блоки (таблицы) скроллятся
**внутри** своих `overflow-x-auto` контейнеров. `hidden` (не `clip`) надёжен
на iOS и **не ломает sticky** — вертикальный скролл остаётся страничным,
sticky-шапки липнут к вьюпорту.

> Правило: страница никогда не должна скроллиться по горизонтали. Любой
> широкий контент (таблица) — в собственном `overflow-x-auto` контейнере.

---

## 2. iOS Safari: зум экрана при фокусе на `<input>`

**Симптом.** Тапнул в поле (поиск, ввод количества) — экран приближается
(зумится). Раздражает, особенно когда поле узкое.

**Причина.** iOS Safari автоматически зумит к полю, если у `<input>`
`font-size < 16px`.

**Фикс.** На мобильном делаем шрифт инпута ≥ 16px:

```tsx
className="... text-base sm:text-sm"  // 16px на мобильном, 14px на sm+
```

Так сделано у поля поиска в [`table-controls.tsx`](../src/components/shared/table/table-controls.tsx).
Тот же приём нужен для любого инпута, в который часто тапают на телефоне.

> НЕ чинить это через `<meta viewport maximum-scale=1 user-scalable=no>` —
> это убивает pinch-zoom и плохо для доступности.

---

## 3. Flexbox `min-width: auto` трап

**Симптом.** Широкий потомок (таблица, длинная строка) распирает родителя
шире экрана, хотя у него есть `overflow`.

**Причина.** У флекс-элементов по умолчанию `min-width: auto` — они не
ужимаются ниже min-content своего содержимого.

**Фикс.** `min-w-0` на флекс-элементах в цепочке до контента. В дашборде это
`SidebarInset` и вложенный `<main>` ([`layout.tsx`](../src/app/(dashboard)/layout.tsx)):

```tsx
<SidebarInset className="min-w-0">
  ...
  <main className="flex min-w-0 flex-1 flex-col overflow-x-clip">{children}</main>
```

> `min-w-0` — обязателен, но на iOS его НЕДОСТАТОЧНО против §1. Держим оба:
> `min-w-0` (правильно по флексу) + `overflow-x: hidden` на html/body
> (страховка для iOS).

---

## 4. Сайдбар на мобильном (shadcn `Sidebar` = `Sheet`)

На мобильном `<Sidebar>` рендерится как выезжающий `Sheet`, **внутри которого
живёт тот же `SidebarBody`**, что и на десктопе. Отсюда две ловушки.

### 4.1. Меню открывалось «иконками без подписей»
`SidebarBody` берёт `collapsed` из desktop-состояния (`state === "collapsed"`,
из cookie `sidebar_state`). В мобильном Sheet это состояние не должно
применяться — там всегда нужен развёрнутый вид.

```tsx
const { state, isMobile } = useSidebar();
const collapsed = state === "collapsed" && !isMobile; // !isMobile — ключ
```

### 4.2. Кнопка меню «не открывалась»
`SidebarBody` ремаунтится при каждом открытии Sheet'а. Эффект «закрыть меню
при переходе» срабатывал и на маунте → только что открытое меню сразу
закрывалось. Закрываем только при **реальной смене** `pathname`:

```tsx
const prevPathRef = useRef(pathname);
useEffect(() => {
  if (prevPathRef.current !== pathname) {
    prevPathRef.current = pathname;
    setOpenMobile(false);
  }
}, [pathname, setOpenMobile]);
```

Оба — в [`sidebar.tsx`](../src/components/shared/sidebar.tsx).

### 4.3. Переключатель заведения (`VenueSwitcher`) уезжал за край экрана
Та же ловушка `state === "collapsed"`: поповер открывался `side="right"` и
уходил за правый край (на мобильном сайдбар — Sheet слева). Фикс — тот же
`&& !isMobile` (на телефоне `side="bottom"`), плюс ширина поповера ограничена
вьюпортом: `w-[min(18rem,calc(100vw-1.5rem))]`. См.
[`venue-switcher.tsx`](../src/components/shared/venue-switcher.tsx).

> Общее правило: любое поповер-меню из мобильного сайдбара открывай **вниз**
> (`side="bottom"`), не вбок — иначе уедет за край Sheet'а.

---

## 5. Тулбар таблиц (`TableControls`) на мобильном

Файл: [`table-controls.tsx`](../src/components/shared/table/table-controls.tsx).
Общий компонент для всех таблиц (список актов, итоги, форма).

- **По умолчанию тулбар content-width и прижат вправо** (`justify-end`),
  чтобы кнопки стояли справа и делили строку с левым контентом (напр.
  «Черновик …» в форме заполнения). `w-full` включается **только когда
  открыт поиск** (`search?.open && "w-full sm:w-auto"`).
- **Поле поиска открывается отдельной строкой ниже** на мобильном:
  `order-last w-full` (а на `sm+` — слева фикс-шириной `sm:order-first
  sm:w-72`). На узких экранах рядом с иконками для поля нет места.
- **Адаптивные размеры кнопок-иконок**: `h-8 w-8` + иконка `3.5` на
  мобильном, `sm:h-9 sm:w-9` + иконка `4` на десктопе. Нужно, чтобы ряд
  контролов (вкл. текстовую «Обновить итоги») влезал в одну строку.
- Шрифт инпута поиска — `text-base sm:text-sm` (см. §2).

Дополнительно по ширине ряда на узких экранах: страница итогов использует
`px-4` (а не `p-6`) и `gap-1.5` между контролами — чтобы ряд кнопок помещался
в одну строку. На очень узких (~≤375px) текстовая кнопка всё равно может
перенестись — там физически не хватает места.

### Менеджер столбцов: всплывающая подсказка «Сбросить»
Radix Popover автофокусит первый фокусируемый элемент; Radix Tooltip
раскрывается по фокусу → подсказка «Сбросить» всплывала при каждом открытии
поповера. Решение — **текстовая кнопка вместо иконки + Tooltip**
([`table-column-manager.tsx`](../src/components/shared/table/table-column-manager.tsx)).

### Правило: весь ряд контролов — в одну строку (адаптивно)
Цель — чтобы ряд (иконки + primary-кнопка) помещался в одну строку даже на
узких экранах:
- Иконки-контролы — `h-8` на мобильном, `sm:h-9` (см. выше).
- Primary split-кнопка (`TableSplitButton`) — тоже адаптивная: `h-8` +
  компактные `px-2.5 text-xs` на мобильном, `sm:h-9 sm:px-3 sm:text-sm`. См.
  [`table-split-button.tsx`](../src/components/shared/table/table-split-button.tsx).
- Подписи кнопок — короткие (напр. «Синхронизировать», без «QR»).
- Страница списка использует `px-4` на мобильном (как итоги), чтобы дать ряду
  больше ширины.

---

## 6. Таблицы с горизонтальным скроллом на мобильном

Пример — таблица «Итоги» ([`results-table.tsx`](../src/app/(dashboard)/documents/inventory/%5Bid%5D/results/_components/results-table.tsx)).

На узких экранах колонки `table-fixed` схлопываются и контент наезжает (напр.
название позиции на чекбокс). Поэтому:

```tsx
<div className="overflow-x-auto rounded-lg border bg-card md:overflow-x-visible">
  <table
    className="w-full table-fixed md:!min-w-0"
    style={{ minWidth: `${table.getTotalSize()}px` }}  // естественная ширина = сумма колонок
  >
```

- **Мобильный**: `overflow-x-auto` + `minWidth = сумма ширин колонок` → таблица
  держит естественную ширину и скроллится вбок. Колонки не схлопываются.
- **Десктоп (md+)**: `md:overflow-x-visible` + `md:!min-w-0` снимает inline
  `minWidth` → таблица вписывается в контейнер (как было), sticky-шапка
  работает. `!important` (`md:!min-w-0`) нужен, чтобы перебить inline-стиль.
  Без снятия minWidth на узком десктоп-окне таблица переполняла бы карточку
  без скролла (поймал Codex P1).

**Trade-off**: на мобильном sticky-шапка таблицы не липнет (контейнер скролла
её «ловит»). Это осознанный компромисс ради горизонтального скролла.

> Глобальный `overflow-x: hidden` на html/body (§1) при этом гарантирует, что
> широкая таблица не распирает саму страницу.

---

## 7. Bulk-бар выделения (`TableBulkBar`)

Файл: [`table-bulk-bar.tsx`](../src/components/shared/table/table-bulk-bar.tsx).

На мобильном много кнопок действий не влезает в строку, счётчик «Выбрано N»
зажимался. Решение:
- Плавающий бар на мобильном — **вертикальная раскладка** (`flex-col`):
  счётчик сверху, кнопки снизу. На `sm+` — одна строка (`sm:flex-row`).
- Кнопки действий **переносятся** (`flex-wrap`) на мобильном, на десктопе —
  в строку со скроллом (`sm:flex-nowrap sm:overflow-x-auto`).
- Кнопкам действий добавлены **иконки** (Пересорт/Не учитывать/… ) для
  компактности и наглядности — см. вызов в `results-table.tsx`.

---

## 7.5. Пагинация (`TablePagination`)

На мобильном раскладка пагинации — **одна строка** (`flex flex-wrap
items-center justify-between`), а не два ряда. Подпись сокращена до «Строк:»
(было «Строк на странице:»), диапазон «1-N из M» убран (страница и так
показывает «Стр. X из Y»). См.
[`table-pagination.tsx`](../src/components/shared/table/table-pagination.tsx).

---

## 8. Производительность: «ленивые» чекбоксы в таблице

**Симптом.** Чекбоксы выделения выделялись с задержкой.

**Причина.** `renderSelectCell` зависел от `selectedIds` → на каждый клик
пересобирался `columnsConfig` → `stateColumns` → `useTableState` (с эффектами
персиста колонок). Тяжёлый каскад на каждый тап.

**Фикс.** Читать выбор через `ref`, чтобы рендер ячейки не зависел от
`selectedIds`, и колонки оставались стабильными:

```tsx
const selectedIdsRef = useRef(selectedIds);
selectedIdsRef.current = selectedIds;            // обновляем каждый рендер
// в renderSelectCell: checked={selectedIdsRef.current.has(item.id)}
// deps useCallback: [activeResortItemByItemId, adjustLocked]  // без selectedIds
```

> Общий принцип: не завязывай определение колонок TanStack на часто меняющийся
> стейт (выбор строк) — иначе каждый клик ребилдит всю таблицу.

---

## 9. Уведомления (колокольчик)

[`notification-bell.tsx`](../src/components/shared/notification-bell.tsx).

Узкий dropdown `w-[420px]` некрасиво вылезал на телефоне. Решение —
**оверлей на весь экран на мобильном**, привязанный dropdown на десктопе:

```tsx
className={cn(
  "fixed inset-0 z-50 flex flex-col bg-background",                 // mobile: full-screen
  "sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:h-auto sm:w-[420px] sm:rounded-xl sm:border sm:shadow-lg",
)}
```

Плюс кнопка закрытия (×), видимая только на мобильном (`sm:hidden`) — на
десктопе закрывается кликом вне. Список — `flex-1 overflow-y-auto sm:max-h-[480px]`.

---

## 10. Форма заполнения акта

[`document-editor.tsx`](../src/app/(dashboard)/documents/inventory/%5Bid%5D/_components/document-editor.tsx).

- **Длинные названия позиций не обрезаются** — перенос по словам
  (`min-w-0 break-words`, не `truncate`). Строка растёт по высоте, фото и
  поле ввода остаются по центру.
- Под названием — **только группа** (без артикула/единицы измерения; то же
  сделано в строке таблицы итогов).
- Поле ввода количества компактное и выровнено; единица измерения в
  фикс-слоте справа от поля.
- По тапу на фото — попап с увеличенным изображением (Dialog).
- Sticky-«шапка» формы с компактными отступами при прокрутке.

---

## 11. Формат количества

[`amount.ts`](../src/lib/format/amount.ts) → `formatQuantityAmount`.

Целые количества показываем **без хвостовых нулей**: «93 шт», а не «93,0 шт».
Дробные (литры/кг) — до `scale` знаков: «13,5 л». Покрыто тестами
[`amount.test.mts`](../src/lib/format/amount.test.mts).

---

## 12. Производительность загрузки

- **Скелетон-лоадер** при открытии акта ([`[id]/loading.tsx`](../src/app/(dashboard)/documents/inventory/%5Bid%5D/loading.tsx)) — навигация не выглядит «зависшей» на тяжёлой странице.
- **Батч-подпись фото** (`createSignedUrls` одним запросом вместо N
  `createSignedUrl`) — заметно ускоряет загрузку формы/каталога.
- **AI-подсказки пересорта — по кнопке** (синяя иконка-палочка в тулбаре), а
  не синхронно в RSC-рендере — не блокируют первый paint итогов.

---

## 13. База знаний — редактор на мобильном

[`knowledge/layout.tsx`](../src/app/(dashboard)/knowledge/layout.tsx), [`knowledge/[slug]/page.tsx`](../src/app/(dashboard)/knowledge/%5Bslug%5D/page.tsx).

- **Шапка страницы БЗ**: на мобильном верхняя строка — переключатель сайдбара
  + «Страницы» (дровер-триггер) + действия + колокольчик; breadcrumb и
  «Сохранено» уезжают во **вторую строку** ниже. На desktop всё в одной
  строке (breadcrumb + «Сохранено»), «Страницы» нет — есть боковое дерево.
  Слоты breadcrumb/actions — context-консьюмеры, безопасно рендерятся в двух
  местах (видно одно по брейкпоинту).
- **Ручка-перетаскивание блока** (6 точек, BlockNote side menu) обрезалась на
  мобильном: `.bn-editor { padding: 0 }` + узкие поля страницы (`px-6`) не
  оставляли гаттера, а `body { overflow-x: hidden }` (§1) режет вылет влево.
  На desktop ручка помещается в поля центрирования (`mx-auto max-w`). Фикс —
  левый гаттер на мобильном: контейнер документа `pl-10` (на md+ — `md:px-8`).

- **Брейкпоинт** мобильный/десктоп — Tailwind `sm` (640px) для большинства
  адаптивных правил; `md` (768px) — для табличных решений (скролл/overflow).
- **Размеры иконок-кнопок**: `h-8` + svg `3.5` на мобильном → `sm:h-9` +
  svg `4`.
- **Инпуты**: `text-base` (16px) на мобильном против iOS-зума.
- **Страница никогда не скроллится по горизонтали** — широкий контент в
  своём `overflow-x-auto`; гарантия — `overflow-x: hidden` на html/body.
- **iOS reliability**: `overflow-x: hidden` ✅, single-axis `overflow: clip` ❌.
- **Кликабельная карточка + портал-меню**: на тач закрытие меню (Radix
  DropdownMenu) оставляет «призрачный» `click`, который падает на карточку
  под меню → лишняя навигация. Подавляй навигацию ~500мс после закрытия меню
  (через `onOpenChange` + `ref` с таймстампом). Пример — `MobileCard` в
  [`documents-table-rows.tsx`](../src/app/(dashboard)/documents/inventory/_components/documents-table-rows.tsx).
- **`100vh` на мобильном Safari переоценивает высоту** (учитывает адресную
  строку). Для full-height скролл-контейнеров (Sheet/дроверы) используй
  `flex flex-col` + `flex-1 min-h-0 overflow-y-auto`, а не `h-[calc(100vh-…)]`
  — иначе нижняя часть уходит за экран. Пример —
  [`kb-mobile-tree-drawer.tsx`](../src/app/(dashboard)/knowledge/_components/kb-mobile-tree-drawer.tsx).
- **Мобильный `Sheet`/дровер**: `onOpenAutoFocus={(e) => e.preventDefault()}`,
  чтобы автофокус первого элемента не раскрывал его `Tooltip` (та же причина,
  что у поповера столбцов, §5).
- **Карточка-строка в списке** (мобильный аналог таблицы): данные — по
  отдельным строкам (№/дата/статус → комментарий → склад+итог → исполнитель →
  проверяющий). Денежный итог — одно нетто-число со знаком и цветом, как в
  десктоп-таблице (не «−X / +Y»).
- **Кастомные slash/suggestion-меню (BlockNote) на touch**: десктоп-only
  hover-обвязка (per-item wrapper с `onMouseEnter/Leave` + таймер +
  портал-тултип) ломает тап по пункту (меню не срабатывает, повторные тапы →
  подвисание/перезагрузка). На touch (`matchMedia("(hover: none)")`) рендери
  пункт как **дефолтный** `Components.SuggestionMenu.Item` — дефолтное меню
  BlockNote на мобильном работает. Пример —
  [`kb-slash-menu.tsx`](../src/app/(dashboard)/knowledge/_components/kb-slash-menu.tsx).
- **iOS не синтезирует `click` по тапу на `<div>` без `cursor: pointer`**:
  React вешает `onClick` делегацией на корень (не inline `onclick`), и iOS
  Safari для таких неинтерактивных элементов синтезирует `click` только при
  наличии pointer-курсора (либо нативно-кликабельного тега). BN-shadcn рендерит
  пункт slash-меню как `<div class="cursor-default">` → тап «не реагировал»
  даже после перехода на дефолтный Item (выше). Фикс — `cursor: pointer` на
  `.bn-suggestion-menu .bn-suggestion-menu-item` (globals.css). Тот же приём
  применим к любому tap-таргету-`<div>` с делегированным `onClick`.
- **Шорткат-подсказки в меню — прятать на touch**: BN рендерит keyboard-badge
  (`div[data-position="right"]` с `<Badge>`) в пунктах slash-меню; на мобильном
  клавиатуры нет — это шум. Прячем под `@media (hover: none), (pointer: coarse)`.
  Аналогично — пункт «Горячие клавиши» в меню профиля сайдбара (`hidden md:flex`).
- **Floating formatting-toolbar (BlockNote) не влезает на узком экране**: кнопок
  больше ширины viewport'а → flex-row сжимал их внахлёст и тулбар вылезал за
  край. Решение как в Word — одна строка с горизонтальным скроллом:
  `max-width: calc(100vw - 16px)` + `flex-wrap: nowrap` + `overflow-x: auto` на
  `.bn-formatting-toolbar`, `flex-shrink: 0` на прямых детях (`> *`), под
  `@media (max-width: 768px)`. Поповеры (стиль/палитра) идут Radix-порталом в
  body — overflow тулбара их не режет. Пример — globals.css §«Formatting toolbar».

---

## Карта файлов

| Область | Файл |
|---|---|
| Глобальный overflow / шрифты | [`src/app/globals.css`](../src/app/globals.css) |
| Дашборд-shell (min-w-0, clip) | [`src/app/(dashboard)/layout.tsx`](../src/app/(dashboard)/layout.tsx) |
| Сайдбар (Sheet, collapsed, авто-закрытие) | [`src/components/shared/sidebar.tsx`](../src/components/shared/sidebar.tsx) |
| Тулбар таблиц | [`src/components/shared/table/table-controls.tsx`](../src/components/shared/table/table-controls.tsx) |
| Менеджер столбцов | [`src/components/shared/table/table-column-manager.tsx`](../src/components/shared/table/table-column-manager.tsx) |
| Bulk-бар | [`src/components/shared/table/table-bulk-bar.tsx`](../src/components/shared/table/table-bulk-bar.tsx) |
| Уведомления | [`src/components/shared/notification-bell.tsx`](../src/components/shared/notification-bell.tsx) |
| Таблица итогов | [`src/app/(dashboard)/documents/inventory/[id]/results/_components/results-table.tsx`](../src/app/(dashboard)/documents/inventory/%5Bid%5D/results/_components/results-table.tsx) |
| Форма заполнения | [`src/app/(dashboard)/documents/inventory/[id]/_components/document-editor.tsx`](../src/app/(dashboard)/documents/inventory/%5Bid%5D/_components/document-editor.tsx) |
| Формат количества | [`src/lib/format/amount.ts`](../src/lib/format/amount.ts) |

## История PR (мобильная доводка актов)

| PR | Суть |
|---|---|
| #424, #425 | Форма: строка позиции (только группа), компактное поле ввода, попап фото |
| #426 | Отступ sticky-шапки, скелетон-лоадер акта, авто-закрытие меню при переходе |
| #427 | Батч-подпись фото; AI-подсказки по кнопке |
| #428 | Кнопка меню снова открывается (prevPathRef-гард) |
| #429 | Полные названия; поиск; оверлей уведомлений; карточки в ряд; формат «шт»; гейт «Журнала» |
| #430 | «Обновить итоги» с текстом; тулбар вправо; скролл таблицы; попап столбцов |
| #431 | Меню с подписями (`!isMobile`); поиск строкой ниже; адаптивные иконки; первая попытка фикса полосы |
| #432 | overflow-x:hidden (полоса), 16px-инпут (зум), ref-чекбоксы, bulk-бар, позиция=группа |
