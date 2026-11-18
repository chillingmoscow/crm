# Аудит: не-эталонные экраны «Люди» и общая оболочка

Режим: только чтение кода, файлы проекта не менялись. Все пути — от корня репозитория. Пометка «по коду» = вывод из чтения разметки/CSS, в браузере не проверялся.

Сокращения путей:
- `D/` = `src/app/(dashboard)/`
- `roles-client` = `D/people/roles/_components/roles-client.tsx`
- `role-detail` = `D/people/roles/[roleId]/_components/role-detail-page.tsx`
- `deps-client` = `D/people/departments/_components/departments-client.tsx`
- `dep-detail` = `D/people/departments/[id]/_components/department-detail-page.tsx`
- `shortage` = `D/people/departments/[id]/_components/department-shortage-block.tsx`
- `staff-table` = `D/people/staff/_components/staff-table.tsx`
- `staff-client` = `D/people/staff/_components/staff-client.tsx`
- `staff-detail` = `D/people/staff/[userId]/_components/staff-detail-page.tsx`
- `cand-client` = `D/people/candidates/_components/candidates-client.tsx`
- `cand-detail` = `D/people/candidates/_components/candidate-detail-client.tsx`
- `people-table.css` = `src/components/people/people-table.module.css`
- `ws.css` = `src/components/shared/workspace-appearance.module.css`
- `DS` = `docs/design-system.md`

## Три факта, которые меняют рамку аудита

1. **Экрана «Автоматизации» в «Люди» нет.** `D/people/automations/page.tsx:3-5` — `redirect("/people/staff")`. В сайдбаре пункта нет (`src/components/shared/sidebar.tsx:124-145`). В папке лежат только `actions.ts` и осиротевший `error.tsx`. Сам интерфейс автоматизаций — компонент `AutomationSettings` (`D/people/payroll/_components/automation-settings.tsx`), он показывается внутри `PayrollSettings` в карточке заведения, вкладка «Оплата труда» (`D/org/venues/[venueId]/_components/venue-detail-page.tsx:497`), и на `/org/venues/[venueId]/payroll` (`D/org/venues/[venueId]/payroll/page.tsx:14-26`).
2. **`payroll-client.tsx` — мёртвый код.** `D/people/payroll/_components/payroll-client.tsx` (571 строка) нигде не импортируется (поиск `PayrollClient` и `payroll-client` по `src/` — только сам файл). `/people/payroll` делает `redirect("/payroll-concept")` (`D/people/payroll/page.tsx:15`). Живой эталон «Зарплата» — `src/app/payroll-concept/payroll-concept.tsx` (1175 строк) + `payroll-concept.module.css` (2281 строка). Сравнивать с `payroll-client.tsx` нельзя.
3. **`src/components/shared/data-table-toolbar.tsx` — мёртвый код** (140 строк, экспорт `DataTableToolbar` на строке 38, импортов нет).

---

## Часть A

### A1. Должности (`/people/roles`, `/people/roles/[roleId]`)

#### Инвентарь

| Что | Факт | Где |
|---|---|---|
| Рамка списка | `div.p-6 md:p-8 w-full` (24/32px, без max-width) | roles-client:510 |
| Рамка карточки | `<PageFrame className="flex flex-col gap-6">` (38/42/20, max 1580) | role-detail:379 |
| h1 списка | `text-3xl font-bold tracking-tight` (30px/700), свой `<h1>` | roles-client:515 |
| h1 карточки | `text-[28px] font-[550] tracking-tight leading-tight` | role-detail:408 |
| Счётчик | `h-6 min-w-6 rounded-full bg-muted px-2 text-[12px] font-medium text-muted-foreground/80` | roles-client:516 |
| Описание | 14px muted + дописка «· показано N» при фильтре | roles-client:520-523 |
| Крошки списка | нет | — |
| Крошки карточки | «‹ Должности» (ChevronLeft, 13px/500, `px-2 py-1.5 rounded-md hover:bg-accent`) | role-detail:356-364 |
| Справка «?» | нет записи в реестре | `D/_components/page-help-registry.tsx:37-60` |
| Info-кнопка | `EntityInfoPopover` в топбаре карточки | role-detail:367-376 |
| Поиск | своя кнопка `h-8 w-8` + `Input h-8 w-48 text-sm`, плейсхолдер «Поиск» | roles-client:528-561 |
| Фильтр | самописная панель `absolute … shadow-md`, закрытие по `mousedown`, внутри `OptionSelect h-8` | roles-client:161-257 |
| Сортировка | нет | — |
| Столбцы | самописная панель с нативным `<input type="checkbox" className="accent-primary">` | roles-client:99-153 |
| Хранение настроек | `localStorage["crm-roles-visible-cols"]`, общий ключ без пользователя/заведения | roles-client:280, 291 |
| Разметка таблицы | `div` + CSS grid, строки `div role="button"` | roles-client:612-675 |
| Колонки | `36px minmax(220px,1fr) 160px 140px 220px 100px`, `gap-4` | roles-client:88-92, 607 |
| Шапка таблицы | `px-5 py-3 bg-muted/60 text-[11px] font-semibold uppercase tracking-wider` | roles-client:615 |
| Строка | `px-5 py-3.5`, иконка 36px → ≈64px + разделитель | roles-client:639, 652 |
| Скругление карточки | `rounded-xl` (12px) + `overflow-hidden` | roles-client:612 |
| Sticky-шапка | нет | — |
| Пагинация | нет | — |
| Мобильные карточки | нет | — |
| Пустое состояние | пунктирный блок `border-dashed p-16`, иконка 40px | roles-client:583-600 |
| Меню строки | нет | — |
| Создание | `EditDrawer` 520px | roles-client:687-773 |
| Редактирование | инлайн-форма на вкладке «Основное», max-w 720 | role-detail:596-717 |
| Подпись поля | `Label text-[13px] font-medium`, обёртка `space-y-1.5` | roles-client:718; role-detail:611 |
| Высоты полей | `Input` h-10, `SelectTrigger` h-9, кнопка иконки h-10 | `src/components/ui/input.tsx:15`, `select.tsx:25`, `D/people/roles/_components/icon-picker.tsx:50` |
| Сохранение | brand при изменениях, иначе `secondary` без hover | role-detail:700-714 |
| Вкладки | общий `Tabs` + `workspace-tabs.module.css`: слева, 13px/450, активная — brand | role-detail:429-434; `src/components/shared/workspace-tabs.module.css:1-4` |
| Секции прав | карточки `rounded-[14px] border bg-card`, шапка `bg-muted px-5 py-3.5` | role-detail:527-551 |
| Оплата труда | `RoleCompensation` + плавающая панель `PayrollDetailDialog` 560px, radius 20 | role-detail:591; `D/people/payroll/_components/payroll-detail-dialog.module.css:53-64` |
| Удаление | `Dialog`, кнопка «Удалить» с иконкой | role-detail:765-791 |

#### Расхождения с эталоном

1. **[P1] Таблица — другой компонент целиком.**
   Где: roles-client:604-684.
   Что сейчас: `div`-сетка с фиксированными треками, шапка 11px uppercase, строка ≈64px, отступ ячейки 20px, radius 12, фон шапки `bg-muted/60`.
   Как в эталоне: семантический `<table>` на TanStack + `ResizableTableHead` + `people-table.css` — текст 14/20, ячейка `padding: 12px`, строка 60px, шапка `h-11` 12px/500 без uppercase на непрозрачном `bg-muted`, radius `var(--radius)` = 8 (staff-table:596-684; people-table.css:1-36; `src/components/shared/table/table-head.tsx:71-83`).
   Как исправить: переписать список на тот же набор, что `staff-table` (`useTableState`, `ResizableTableHead`, `styles.scroll/table`). Иконку должности оставить отдельной колонкой 36px.

2. **[P1] На телефоне колонки обрезаются (по коду).**
   Где: roles-client:607, 612.
   Что сейчас: сумма треков ≈ 956px + 40px отступов, контейнер `overflow-hidden` без прокрутки и без мобильного вида. Всё, что правее экрана, недоступно.
   Как в эталоне: до 640px таблица скрыта, показываются `PeopleMobileCards` (people-table.css:49-57; staff-table:685-706).
   Как исправить: подключить `PeopleMobileCards` (имя, подразделение, число сотрудников, права).

3. **[P1] Панель инструментов самописная.**
   Где: roles-client:99-153, 161-257, 526-578.
   Что сейчас: три кнопки 32×32 рядом с «Добавить» 36px; активное состояние `border-primary text-primary` (токен `primary` #1d4ed8, не brand); фильтр — выпадающая панель с заголовком «ФИЛЬТРЫ» 11px uppercase и ссылкой «Сбросить фильтры»; столбцы — нативные чекбоксы; сортировки нет; поле поиска 32px/192px слева от иконки.
   Как в эталоне: `TableControls` — кнопки 36×36 (32 на телефоне), активная `border-brand` + ореол (`src/components/shared/table/table-controls.tsx:245-247`), фильтр открывает ряд чипов `TableFilterChip` (staff-table:488-595), красная «Очистить все» (staff-table:584-593), `TableSortPicker`/`TableSortSettings`, `TableColumnManager` с перетаскиванием (staff-table:447-481), поиск `h-9 sm:w-72 text-base sm:text-sm` (table-controls.tsx:116-124).
   Как исправить: заменить на `TableControls` + чипы «Подразделение», «Импорт из QR»; сортировка по названию, подразделению, числу сотрудников, доле прав.

4. **[P2] Поле поиска 14px на телефоне → iOS увеличит экран при фокусе.**
   Где: roles-client:536 (`h-8 w-48 text-sm`); то же в role-detail:467 (`h-9 text-[13px]`).
   Как в эталоне: `text-base sm:text-sm` (table-controls.tsx:124).
   Как исправить: уйдёт вместе с п.3; в поиске прав убрать `text-[13px]`.

5. **[P1] Рамка страницы и шапка не из общих компонентов.**
   Где: roles-client:510-524.
   Что сейчас: `p-6 md:p-8`, свой блок заголовка с `mb-6`, счётчик-таблетка 24px/12px `rounded-full`.
   Как в эталоне: `PageFrame` (38/42/20, max 1580 — `src/components/shared/page-frame.module.css:1-4`) + `PeopleListHeader` → `TablePageHeader`, счётчик `h-7 min-w-7 rounded-md text-sm` (`src/components/shared/table/table-page-header.tsx:33-45`).
   Как исправить: `<PageFrame className="space-y-4">` + `PeopleListHeader title="Должности" count description`.

6. **[P1] Нет крошек «Люди / Должности» и кнопки «?».**
   Где: roles-client — `PageBreadcrumb` не вызывается; реестр справки `page-help-registry.tsx:37-60` без записи.
   Как в эталоне: `src/components/people/people-list-header.tsx:18-29`; справка — `page-help-registry.tsx:38-39`.
   Как исправить: крошка придёт с `PeopleListHeader`; добавить `RolesHelp` в реестр.

7. **[P2] Нет пагинации и sticky-шапки.**
   Где: roles-client:630-675.
   Как в эталоне: `TablePagination` (staff-table:707-717).
   Как исправить: придёт с п.1.

8. **[P2] Пустые состояния — третий вариант.**
   Где: roles-client:583-600 (пунктир, `p-16`), 677-681 («Нет должностей, соответствующих поиску»).
   Как в эталоне: строка внутри таблицы `!h-32 text-center text-muted-foreground`, текст «По этим условиям сотрудников нет» (staff-table:668-680). В DS описан ещё `EmptyState` (`src/components/ui/empty-state.tsx:33-45`), эталонные списки его не используют.
   Как исправить: текст и разметку как в `staff-table`; формулировка «По этим условиям должностей нет».

9. **[P2] Цветные кружки-счётчики вне палитры.**
   Где: roles-client:456 (`bg-violet-400 text-white text-[11px]`).
   Как в эталоне: в списках сотрудников/кандидатов числовых кружков нет; числа — обычным текстом 14px.
   Как исправить: «3 сотрудника» текстом, `tabular-nums`.

10. **[P2] Двухстрочная ячейка названия.**
    Где: roles-client:410-429 (название 14px + описание 12px второй строкой).
    Как в эталоне: одна строка с `truncate` и `data-tip` (`D/people/candidates/_components/candidate-table.tsx:82-89`); решение записано в `docs/design/people-tables.md:15` («многострочные ячейки кандидатов» заменены).
    Как исправить: описание — отдельная скрываемая колонка.

11. **[P1] Вкладки карточки выглядят иначе, чем в карточках сотрудника и кандидата.**
    Где: role-detail:429-434 + `workspace-tabs.module.css:1-4`.
    Что сейчас: прижаты влево, 13px/450, активная — brand, шаг 24px.
    Как в эталоне: `ProfileTabsList` по центру, 14px/500, активная — `foreground` (staff-detail:795; `src/components/ui/tabs.tsx:31-44, 58-63`); у кандидата `TabsList justify-center` (cand-detail:276).
    Как исправить: выбрать один вид (см. B5) и применить ко всем карточкам «Люди».

12. **[P1] «Опасная зона» в карточке должности подсвечивается синим, а не красным (по коду).**
    Где: role-detail:442-447 задаёт `data-[state=active]:text-destructive`, но `.tabs [role=tab][data-state=active]{color:hsl(var(--brand))…}` (`workspace-tabs.module.css:3`) специфичнее (класс + 2 атрибута против класса + 1 атрибута).
    Как в эталоне: красная активная вкладка (staff-detail:805-810 с общими `Tabs` без CSS-модуля).
    Как исправить: уйдёт с п.11; иначе добавить в CSS-модуль исключение для `[data-danger]`.

13. **[P2] Шапка карточки: вес 550 и квадратная плитка.**
    Где: role-detail:394-408 (`rounded-2xl` 16px, h1 `font-[550]`).
    Как в эталоне: `ProfileHeader` — круг 56px, h1 `text-[28px] font-bold` (`src/components/shared/profile-header.tsx:32-43`).
    Как исправить: h1 → `font-bold`; плитку оставить (сущность не человек), но radius из шкалы (14px).

14. **[P2] Форма «Основное» без секций.**
    Где: role-detail:597-716 — поля лежат прямо в колонке 720px.
    Как в эталоне: `ProfileSection` — `rounded-[14px] border bg-card p-5`, заголовок 16px/600 (`src/components/shared/profile-section.tsx:29-34`; staff-detail:820, 836).
    Как исправить: обернуть в `ProfileSection` «Основное» и «График работы».

15. **[P3] Подпись переключателя другого размера.**
    Где: role-detail:683 — `<Label>` без классов (14px) рядом с подписями 13px (role-detail:611, 636, 667).
    Как исправить: единый размер подписи (см. B8).

16. **[P2] Поле 40px рядом с выпадающим списком 36px.**
    Где: role-detail:614 (`Input`) и 647 (`SelectTrigger`); roles-client:721 и 751.
    Как в эталоне: то же расхождение есть и в эталоне (staff-client:840 и 897) — это дефект примитива, см. B8.
    Как исправить: поднять `SelectTrigger` до h-10 в `select.tsx:25` или везде использовать `OptionSelect`.

17. **[P2] Правка оплаты должности — третий вид боковой панели.**
    Где: role-detail:591 → `D/people/payroll/_components/role-compensation.tsx:110` → `payroll-detail-dialog.module.css:53-64` (отступ 12px от краёв, 560px, radius 20, тень с hex `#00000014`, без анимации).
    Как в эталоне: в расписании и у кандидатов — `EditDrawer` 520px без скругления (`src/components/ui/edit-drawer.tsx:63-66`).
    Как исправить: решить на уровне DS, какая панель каноничная (см. B7), вторую убрать.

18. **[P3] Баннер системной должности без тёмной темы.**
    Где: role-detail:600 (`border-amber-200 bg-amber-50 text-amber-800`).
    Как в эталоне: пары light/dark (staff-detail:769-771).
    Как исправить: добавить `dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30`.

19. **[P3] В подтверждении удаления кнопка «Удалить» без объекта.**
    Где: role-detail:781-788.
    Как в DS: кнопка повторяет глагол с объектом (DS:175).
    Как исправить: «Удалить должность».

20. **[P2] Слова «роль» и «должность» вперемешку.**
    Где: roles-client:699 («Создайте роль с нуля»), 745 («На основе существующей роли»), 769; role-detail:676 («Для чего используется роль»), 744 («Сотрудники с этой ролью»).
    Как в эталоне: в меню и заголовках — «Должности» (`sidebar.tsx:134`).
    Как исправить: везде «должность».

### A2. Подразделения (`/people/departments`, `/people/departments/[id]`)

#### Инвентарь

| Что | Факт | Где |
|---|---|---|
| Рамка списка | `div.p-6 md:p-8 w-full` | deps-client:369 |
| Рамка карточки | `div.px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6` | dep-detail:262 |
| h1 списка / счётчик / описание | копия «Должностей» | deps-client:374-382 |
| h1 карточки | `text-[28px] font-bold` + плитка 56px `rounded-2xl` | dep-detail:265-275 |
| Крошки | список — нет; карточка — «‹ Подразделения» | dep-detail:240-248 |
| Справка «?» | нет | — |
| Панель инструментов | копия самописной из «Должностей» (поиск, фильтр, столбцы) | deps-client:52-106, 114-181, 385-439 |
| Таблица | `div`-сетка `36px minmax(220px,1fr) 180px 140px 140px`, шапка 11px uppercase, `rounded-xl` | deps-client:42-45, 472-490 |
| Кружки-счётчики | `bg-violet-400` и `bg-emerald-400` | deps-client:339, 358 |
| Пагинация / сортировка / мобильные карточки | нет | — |
| Создание | `EditDrawer` | deps-client:543-606 |
| Вкладки карточки | общий `Tabs`, `TabsList justify-center` (14px/500, активная foreground) | dep-detail:285-286 |
| Форма «Основное» | поля без секций, max-w 720 | dep-detail:303-439 |
| Сохранение | brand при изменениях, иначе `secondary` | dep-detail:410-432 |
| Блок «Недостача» | `section.space-y-4.border-t.pt-5`, h2 `text-lg font-semibold`, стоит **после** кнопки «Сохранить», со своей второй кнопкой | shortage:142-143, 243-247; dep-detail:434-437 |
| Вкладка «Должности» | список `rounded-xl border bg-card divide-y`, строки `px-4 py-3` | dep-detail:477-487 |
| Добавление должности | `Dialog` со списком-выбором | dep-detail:574-617 |
| Открепление должности | кнопка-крестик `h-7 w-7`, без подтверждения | dep-detail:509-518 |
| Удаление | `Dialog`, кнопка «Удалить» без иконки | dep-detail:620-645 |

#### Расхождения с эталоном

1. **[P1] Список — копия «Должностей», не общий набор.** Всё из A1 пп.1-10 повторяется: deps-client:369 (рамка), 374-382 (шапка), 385-439 (инструменты), 475-490 (таблица), 444-464 и 533-537 (пустые состояния), 339/358 (кружки). Минимальная ширина сетки ≈ 780px + отступы при `overflow-hidden` — на телефоне колонки обрезаются (по коду). Исправление то же: `PageFrame` + `PeopleListHeader` + общий табличный набор + `PeopleMobileCards`.

2. **[P1] Карточка подразделения и карточка должности устроены по-разному, хотя вторая объявлена образцом первой.**
   Где: dep-detail:262 (`px-6 md:px-8 pt-4`) против role-detail:379 (`PageFrame`); dep-detail:286 (вкладки по центру, foreground) против role-detail:434 (слева, brand); dep-detail:273 (`font-bold`) против role-detail:408 (`font-[550]`).
   Как в эталоне: карточка сотрудника — `px-6 md:px-8 pt-4 pb-8` + `ProfileTabsList` (staff-detail:736, 795); карточка кандидата — `max-w-[1120px] px-6 pb-8 pt-4 md:px-8` по центру (cand-detail:177).
   Как исправить: одна рамка и один вид вкладок для всех четырёх карточек (см. B4, B5).

3. **[P1] Две кнопки «Сохранить» с разным поведением на одной вкладке.**
   Где: dep-detail:415-429 (всегда видна, серая без изменений, спиннер) и shortage:243-247 (появляется только после изменения, текст «Сохраняем…», без спиннера). Блок «Недостача» идёт ниже первой кнопки (dep-detail:434).
   Как в эталоне: одна кнопка в конце формы вкладки (staff-detail:1261-1277; DS:395-397).
   Как исправить: вынести «Недостачу» в отдельную `ProfileSection` со своим явным подвалом либо в отдельную вкладку; состояние кнопки — по одному правилу.

4. **[P2] Подписи в блоке «Недостача» другого размера и шага.**
   Где: shortage:159, 223, 233 — `<Label>` 14px, обёртка `space-y-2`; 165 — `text-[13px]` без `font-medium`.
   Как в эталоне: `text-[13px] font-medium`, `space-y-1.5` (dep-detail:309; staff-detail:941).
   Как исправить: привести к подписи 13px/500.

5. **[P2] Выбор должности в модальном окне.**
   Где: dep-detail:574-617.
   Как в DS: модальное окно — для подтверждений, выбор и правка — в боковой панели или выпадающем списке (DS:199).
   Как исправить: `Combobox`/поповер со списком рядом с кнопкой «Добавить» либо `EditDrawer`.

6. **[P2] Открепление должности без подтверждения и без подсказки.**
   Где: dep-detail:509-518 (только `aria-label`).
   Как в эталоне: у иконок-кнопок есть подсказка (`IconTooltip`, staff-client:762-783).
   Как исправить: `data-tip="Открепить должность"`; действие обратимо, подтверждение не обязательно.

7. **[P3] Заголовок «СЕЙЧАС РУКОВОДЯТ» — 11px uppercase.**
   Где: dep-detail:382. В эталонных карточках uppercase не используется (0 вхождений в `people/staff`, `people/candidates`).
   Как исправить: `text-xs text-muted-foreground` без uppercase.

8. **[P3] Кнопка удаления без объекта и без иконки; в «Должностях» — с иконкой.**
   Где: dep-detail:636-642 против role-detail:781-788.
   Как исправить: «Удалить подразделение», одинаково в обеих карточках.

9. **[P2] Нет крошки «Люди» и справки** — как A1 п.6 (deps-client без `PageBreadcrumb`; dep-detail:240-248 — ссылка «назад»).

### A3. Автоматизации

#### Инвентарь

| Что | Факт | Где |
|---|---|---|
| Маршрут `/people/automations` | `redirect("/people/staff")` | `D/people/automations/page.tsx:3-5` |
| Пункт меню | нет | `sidebar.tsx:124-145` |
| `error.tsx` | осиротевший; текст про «настройки зарплаты», блок `rounded-xl border p-8` в `PageFrame` | `D/people/automations/error.tsx:6-16` |
| Где живёт интерфейс | `AutomationSettings` внутри `PayrollSettings` | `D/people/payroll/_components/payroll-settings.tsx:70` |
| Точки входа | карточка заведения → «Оплата труда»; `/org/venues/[venueId]/payroll` | `venue-detail-page.tsx:497`; `D/org/venues/[venueId]/payroll/page.tsx:14-26` |
| Рамка страницы `/org/venues/…/payroll` | `div.min-w-0 space-y-6 p-4 md:p-6` + `TablePageHeader "Условия оплаты"` + ссылка «К ведомости →» | payroll/page.tsx:14-25 |
| Контейнер формы | `<form className="overflow-hidden rounded-xl border">` | automation-settings.tsx:211-212 |
| Заголовок | `h2.font-semibold` + метка `rounded-full bg-muted px-3 py-1 text-xs` | automation-settings.tsx:240-243 |
| Разделы | нативные `<details>/<summary>` с шевроном, `p-5` | automation-settings.tsx:90-98 |
| Подписи | `<Label>` 14px, `space-y-2` | automation-settings.tsx:40-41 |
| Число с единицей | `Input type="number"` + суффикс | automation-settings.tsx:43-57 |
| Переключатель | `label` + `Switch` | automation-settings.tsx:72-75 |
| Должности | текстовое поле «Должности · через запятую» | automation-settings.tsx:114-115 |
| Выпадающие | `OptionSelect` | automation-settings.tsx:462, 498, 597 |
| Сохранение | `disabled={busy || !dirty}` (обычная полупрозрачная кнопка), текст «Сохраняем…» | automation-settings.tsx:739-741 |
| История | `<details>` «История настроек» | automation-settings.tsx:745-748 |

#### Расхождения с эталоном

1. **[P1] Экран недостижим из раздела «Люди».** Маршрут — заглушка с редиректом, пункта меню нет; настройки спрятаны в карточке заведения. Как исправить: либо удалить `D/people/automations/page.tsx` и `error.tsx` (оставив `actions.ts`), либо сделать настоящий экран «Люди / Автоматизации» на `PageFrame` + крошка + справка. Решение за владельцем.
2. **[P2] Секции — третий вид карточки.** `rounded-xl border` без `bg-card`, аккордеон на `<details>` (automation-settings.tsx:90, 212) против `ProfileSection` `rounded-[14px] border bg-card p-5` (profile-section.tsx:29). Как исправить: `ProfileSection` на раздел либо общий компонент-аккордеон.
3. **[P2] Подписи 14px / шаг 8px** (automation-settings.tsx:40-41) против 13px/500 и 6px в эталоне (staff-detail:941). Как исправить: единая подпись (B8).
4. **[P2] Кнопка сохранения по третьему правилу** (automation-settings.tsx:739): полупрозрачная `disabled`, текст вместо спиннера. В карточках должности/подразделения — `secondary` без прозрачности (role-detail:700-708), в карточке сотрудника — всегда brand (staff-detail:1262-1270). Как исправить: одно правило (см. раздел противоречий, п.12).
5. **[P2] Должности вводятся текстом через запятую** (automation-settings.tsx:114-115), хотя должности — справочник. Как исправить: множественный выбор из списка должностей (`multi-option-picker.tsx` уже есть в `src/components/shared/`).
6. **[P2] Служебные слова в тексте для пользователя.** «Настройки сохранены. Работа n8n не изменена» (automation-settings.tsx:228); «Заполнено по прежним настройкам CHILLING» (automation-settings.tsx:251). Как исправить: «Настройки сохранены»; название заведения подставлять из данных.
7. **[P2] Нативное `<textarea>` рядом** — payroll-settings.tsx:102-104 (`rounded-md border bg-background p-3`), без фокус-состояния DS. Как исправить: `<Textarea>`.
8. **[P2] Рамка `/org/venues/[venueId]/payroll`** — `p-4 md:p-6` (payroll/page.tsx:14), не `PageFrame`; возврат — текстовая ссылка «К ведомости →» в зоне действий, а не крошка.

---

## Часть B

### B1. Крошки

| Маршрут | Что рисуется | Где |
|---|---|---|
| `/people/staff` | `nav.flex.min-w-0.items-center.gap-2.text-sm`: `span.muted` «Люди» · `/` · `span.truncate` «Сотрудники». «Люди» — не ссылка | `src/components/people/people-list-header.tsx:18-29` (из staff-table:423) |
| `/people/candidates` | то же, «Люди / Кандидаты» | там же (из cand-client:296) |
| `/people/candidates/[id]` | «Люди / Кандидаты(ссылка) / ФИО», та же разметка, `aria-current` | cand-detail:168-176 |
| `/people/staff/[userId]` | ссылка «‹ Сотрудники»: ChevronLeft 16px, `text-[13px] font-medium`, `px-2 py-1.5 rounded-md hover:bg-accent`. При `?from=inventory` — «‹ Акты инвентаризации» | staff-detail:688-696; `D/people/staff/[userId]/page.tsx:47-49, 60` |
| `/payroll-concept` (Зарплата) | свой класс: 13px, `gap: 17px`, «Люди» — **ссылка** на `/people/staff`, «Зарплата» — `strong` 500 | `src/app/payroll-concept/payroll-concept.tsx:446-452`; `payroll-concept.module.css:247-260` |
| `/people/payroll/[employeeId]` | ссылка «← Зарплата»: ArrowLeft, `text-sm`, `gap-2`, без подложки | `D/people/payroll/_components/employee-payroll-page.tsx:59-67` |
| `/payroll-preview` | «← Зарплата», 13px, `gap: 8px`, ArrowLeft 15 | `D/payroll-preview/payroll-preview.tsx:115`; `.module.css:2` |
| `/people/roles` | нет | — |
| `/people/roles/[roleId]` | «‹ Должности» (как у сотрудника) | role-detail:356-364 |
| `/people/departments` | нет | — |
| `/people/departments/[id]` | «‹ Подразделения» | dep-detail:240-248 |
| `/schedule` | «График работы / Расписание» (только пока виден календарь) | `D/schedule/_components/schedule-client.tsx:1050-1058` |
| `/schedule/templates` | «График работы / Шаблоны смен» | `D/schedule/_components/template-list.tsx:217-228` |
| `/schedule/tasks` (список) | нет | `D/schedule/tasks/task-list.tsx:320-324` |
| `/schedule/tasks` (редактор) | «← К задачам» / «← К графику»: ArrowLeft, 13px/500, с подложкой | `D/schedule/tasks/tasks-client.tsx:339-356, 262, 1135` |
| `/schedule/attendance` | одна ссылка «Расписание» без размера шрифта (наследует 16px), без стрелки | `D/schedule/attendance/attendance-client.tsx:21-25` |
| `/notifications` | `span.text-sm.muted` «Уведомления» (дублирует h1) | `D/notifications/page.tsx:12-14` |
| `/settings/integrations[/*]` | «Настройки / Интеграции»; внутри — «Интеграции(ссылка) / Название» | `D/settings/integrations/_components/integration-layout.tsx:16-18` |
| `/documents/inventory/[id]` | «‹ К списку» | `D/documents/inventory/[id]/_components/document-act-header.tsx:86-94` |
| `/catalog/ingredients/[id]` | «‹ {раздел}» | `D/catalog/ingredients/[id]/_components/ingredient-detail.tsx:274-282` |
| `/knowledge/*` | «‹ База знаний» / «‹ Родитель» | `D/knowledge/_components/kb-section-header.tsx:38-46`, `kb-back-link.tsx:14-22` |
| Остальные списки (продажи, организация, финансы, гости, каталог, списания, `/settings/general`, `/profile`, `/dashboard`) | нет — `PageBreadcrumb` не вызывается | поиск по `D/**` |

**Стилей в ходу семь:** (1) путь `text-sm gap-2` с некликабельным корнем; (2) путь зарплаты 13px/gap 17 с кликабельным корнем; (3) ссылка «‹ Раздел» 13px с подложкой; (4) «← К задачам» — то же со стрелкой другой формы; (5) «← Зарплата» 14px без подложки; (6) одиночная ссылка/подпись без разделителя; (7) пусто.

**Причина бага «на карточке сотрудника пропадает „Люди“».** `PageBreadcrumb` — пустой слот: страница кладёт в контекст произвольную разметку (`src/components/shared/page-header-actions.tsx:81-90`), топбар её просто выводит (`dashboard-topbar.tsx:27`). Общего компонента «путь» и карты маршрутов нет. Список сотрудников переведён на путь «Люди / Сотрудники» через `PeopleListHeader`, карточка кандидата написана уже по новому образцу, а карточка сотрудника осталась на старой ссылке «‹ Сотрудники» (staff-detail:688-696). То есть это не сбой состояния, а две разные разметки по двум разным правилам. Правила тоже два: DS:339-341 («список — без крошки, карточка — ссылка назад») и DS:818 + `docs/design/people-tables.md:13` («Люди / название раздела»).

**Что закрепить как правило (одно).**
- Всегда путь: `Раздел меню / Страница [/ Сущность]`. Названия — ровно как в сайдбаре.
- Раздел — текст без ссылки (у раздела нет своей страницы); промежуточные звенья — ссылки; последнее — текущая страница, `aria-current="page"`, `truncate`.
- Вид — как в `people-list-header.tsx:19-28`: `text-sm`, `gap-2`, разделитель `/`.
- Один компонент `<Breadcrumbs items={[{label, href?}]} />`; ручная разметка в `PageBreadcrumb` запрещена.
- Возврат «откуда пришёл» (`?from=inventory`) — необязательная ссылка «‹» перед путём, сам путь не меняется.

**Что исправить:** staff-detail:688, role-detail:356, dep-detail:240, employee-payroll-page:59, attendance-client:21, tasks-client:339; добавить путь в `/people/roles`, `/people/departments`, `/schedule/tasks`; у зарплаты убрать свой класс и ссылку на «Люди» (payroll-concept.tsx:447-451). DS:339-341 и DS:361-365 переписать.

### B2. Сайдбар

Определения — `sidebar.tsx:120-357`.

| Пункт меню | h1 страницы | Крошка | Расхождение |
|---|---|---|---|
| Люди › Зарплата (`href /people/payroll`, переход на `/payroll-concept`) | «Зарплата» 40px | «Люди / Зарплата» | адрес страницы не в `/people/*`; активность держится на подмене пути (`sidebar.tsx:132, 507-508`) |
| Люди › Должности | «Должности» | нет | в текстах экрана — «роль» (A1 п.20) |
| График работы › Расписание | «Расписание» | «График работы / Расписание» | на `/schedule/attendance` крошка — просто «Расписание» |
| График работы › Задачи | «Задачи» | нет | — |
| Организация › Аккаунт | «Настройки» | нет | `D/org/account/page.tsx:4` |
| Организация › Юрлица | «Юридические лица» | нет | `D/org/legal-entities/page.tsx:60` |
| Организация › Журнал | «Журнал событий» | нет | `D/org/audit/_components/audit-page-client.tsx:247` |
| Настройки › Общее | «Общие настройки» | нет | `D/settings/general/page.tsx:47` |
| Финансы › * | в layout отдельный h1 «Финансы» `text-lg` + h1 страницы | нет | два h1 (`D/finance/layout.tsx:37`) |

Название вкладки браузера: корневой `title: "CRM Platform"` (`src/app/layout.tsx:16-17`); свой `metadata` есть только у `/payroll-concept`, `/payroll-preview`, `/notifications` (`D/payroll-concept/page.tsx:7`, `D/payroll-preview/page.tsx:4`, `D/notifications/page.tsx:6`), причём разделитель разный («—» и «·»). Остальные страницы показывают «CRM Platform».

**Активное состояние.**
- Пункт: `pathname.startsWith(item.href)` либо точное совпадение при `exact` (`sidebar.tsx:895-897`). У плоских ссылок проверка строже — `href` или `href + "/"` (`sidebar.tsx:788-790`).
- `/schedule/attendance`: ни один пункт не активен («Расписание» — `exact`, `sidebar.tsx:155`), раздел при загрузке закрыт (`sidebar.tsx:606-615`).
- `/payroll-preview`: ничего не подсвечено (подмена только для `/payroll-concept`).
- Вид активного пункта задаёт не Tailwind, а CSS-модуль: `brand/10` + текст brand + 600 (`ws.css:19-23, 106-111`); класс `bg-sidebar-accent` в разметке (`sidebar.tsx:906-907`) перекрыт.
- Закрытый раздел с активным пунктом — серый `bg-sidebar-accent` (`sidebar.tsx:876`), не brand.
- Свёрнутое меню: активный раздел — сплошная синяя плитка с белой иконкой (`ws.css:187`).

**Размеры: в разметке одно, в CSS другое.**

| Элемент | В TSX | Фактически |
|---|---|---|
| Раздел, шрифт | 14px/500 (`sidebar.tsx:875`) | 13px/500, `min-height 41px` (`ws.css:74-79`) |
| Раздел, иконка | 18px (`sidebar.tsx:879`) | 17px (`ws.css:84-87`) |
| Пункт | 13px/500, `px-2.5 py-1.5` (`sidebar.tsx:905`) | 12px/450, `9px 12px` (`ws.css:96-99`) |
| Подпись во всплывающем меню | 11px uppercase (`sidebar.tsx:980`) | 11px без uppercase (`ws.css:190`) |
| Всплывающее меню | 200px, radius 10 (`sidebar.tsx:977`) | 230px, radius 16 (`ws.css:188`) |
| Низ сайдбара | `h-16` (`sidebar.tsx:710`) | 80px (`ws.css:24-27`) |

Иконки пунктов показываются только во всплывающем меню свёрнутого режима (`sidebar.tsx:1001`), в развёрнутом — нет (`sidebar.tsx:910`). Повторы: `CalendarDays` ×4 (строки 149, 154, 166, 184), `ClipboardList` ×4 (160, 306, 311, 321), `Wallet` ×3 (132, 230, 251), `Settings` ×3 (197, 341, 352), `User` ×2 (128, 131).

Счётчики — `bg-primary` (`sidebar.tsx:882, 912, 968, 1004`), а не brand, хотя DS:25 относит «notification dots» к brand.

Подсказки в свёрнутом режиме — `data-tip` (`sidebar.tsx:825, 957`), единый вид. Ширины 16rem / 4rem / 18rem (`src/components/ui/sidebar.tsx:30-32`), анимация 300ms — совпадает с DS:149.

**Что закрепить:** h1 = пункт меню = последнее звено пути = название вкладки браузера («Страница — Sheerly»). Размеры сайдбара держать в одном месте — убрать перекрытые классы из `sidebar.tsx`.
**Что исправить:** четыре несовпадения названий; `metadata` на всех страницах; подсветку на `/schedule/attendance`; уникальные иконки пунктов; счётчики на brand.

### B3. Топбар и справка

Разметка: `header.flex.h-14.items-center.gap-2.px-6` (`dashboard-topbar.tsx:25`). Фактически — 68px, поля 36px, шаг 12px, нижняя граница (`ws.css:28-36`); на телефоне 58px/16px (`ws.css:43-50`). DS:322 говорит «56px».

Порядок справа: действия страницы → «?» → колокольчик (`dashboard-topbar.tsx:29-31`).

| Кнопка | Классы | Где |
|---|---|---|
| «?» | `size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent`, иконка 18px, `data-tip` | `D/_components/page-help-button.tsx:34-36` |
| Колокольчик | те же | `notification-bell.tsx:364-366` |
| Info | те же | `entity-info-popover.tsx:171-173` |
| «?» зарплаты | свой класс 28×28 без фона, без hover, без `data-tip` | `payroll-concept.tsx:454-460`; `payroll-concept.module.css:267-275` |
| Индикатор колокольчика | число в красной таблетке `min-w-[18px] h-[18px] bg-destructive` | `notification-bell.tsx:368` (DS:334-335 — точка brand 8×8) |

Правило `.workspace [data-dashboard-topbar] > button { width:36px; height:36px; border-radius:9px }` (`ws.css:37-42`) действует на **любую** кнопку — прямого потомка шапки. Следствия:
- radius кнопок 9px, а не 8 (`rounded-lg`) — значение вне шкалы.
- **[P1, по коду, проверить вживую]** текстовая кнопка «Восстановить» в карточке уволенного (staff-detail:700-724) попадает в слот действий и становится прямым потомком шапки — ей принудительно ставится ширина 36px, текст выйдет за границы.

Отступ слева: топбар 36px, `PageFrame` 42px, страницы на `p-6 md:p-8` — 32px. Крошка и h1 не стоят на одной вертикали ни в одном варианте.

**Реестр справки** (`page-help-registry.tsx:37-60`):

| Маршрут | Справка |
|---|---|
| `/people/staff` | есть (точное совпадение) |
| `/people/staff/[userId]` | нет |
| `/people/candidates`, `/people/candidates/[id]` | есть |
| `/payroll-concept` | в реестре нет; своя кнопка и свой `Dialog` (`payroll-concept.tsx:453-461, 1114`) |
| `/people/payroll/[employeeId]` | есть, в `EditDrawer` |
| `/people/payroll` (запись в реестре, строка 45) | недостижима — маршрут редиректит |
| `/people/roles`, `/people/roles/[id]`, `/people/departments`, `/people/departments/[id]` | нет |
| `/schedule`, `/schedule/templates`, `/schedule/tasks` | есть |
| `/schedule/attendance` | нет |
| `/notifications`, `/sales/shifts`, `/documents/inventory[/*]` | есть |

Справка из реестра открывается в `EditDrawer` (`page-help-button.tsx:39`), справка зарплаты — в модальном окне. DS:343 про справку — «TBD».

**Что закрепить:** справка только через реестр, всегда в боковой панели; кнопки топбара — только `size-9`, без правила «любая кнопка = 36×36».
**Что исправить:** зарплату перевести на реестр (совпадение по `/payroll-concept`); добавить справку должностям, подразделениям, карточке сотрудника, сверке отметок; сузить селектор в `ws.css:37`.

### B4. Рамка страницы

| Маршрут | Обёртка | Где |
|---|---|---|
| `/people/staff` | `PageFrame space-y-4` | staff-client:743 |
| `/people/candidates` | `PageFrame flex flex-col gap-4` | cand-client:290-295 |
| `/people/candidates/[id]` | `mx-auto max-w-[1120px] px-6 pb-8 pt-4 md:px-8 gap-6` | cand-detail:177 |
| `/people/staff/[userId]` | `px-6 md:px-8 pt-4 pb-8 w-full gap-6` | staff-detail:736 |
| `/payroll-concept` | `PageFrame` внутри `s.main` | payroll-concept.tsx:462-463 |
| `/people/payroll/[employeeId]` | `PageFrame` + `s.page` | employee-payroll-page.tsx:58 |
| `/people/roles` | `p-6 md:p-8 w-full` | roles-client:510 |
| `/people/roles/[roleId]` | `PageFrame flex flex-col gap-6` | role-detail:379 |
| `/people/departments` | `p-6 md:p-8 w-full` | deps-client:369 |
| `/people/departments/[id]` | `px-6 md:px-8 pt-4 pb-8 w-full gap-6` | dep-detail:262 |
| `/people/candidates` (ошибка) | `p-6 space-y-4` | `D/people/candidates/error.tsx:5` |
| `/schedule`, `/schedule/templates` | `PageFrame space-y-6` (+ внутри `space-y-4`) | schedule-client.tsx:1049; template-list.tsx:216 |
| `/schedule/tasks` | `PageFrame space-y-6` (+ `space-y-4`) | `D/schedule/_components/tasks-tab.tsx:33`; task-list.tsx:320 |
| `/schedule/attendance` | `PageFrame space-y-6` | attendance-client.tsx:20 |
| `/org/venues/[id]/payroll` | `p-4 md:p-6` | payroll/page.tsx:14 |

`PageFrame`: `max-width 1580px`, `38px 42px 20px`; ≥1500px верх 45px; ≤1150px `30/26/18`; ≤480px `27/16/18` (`page-frame.module.css:1-4`).

Вывод: списки-эталоны и расписание — на `PageFrame`; карточки сотрудника, кандидата и подразделения — три разных ручных варианта; карточка должности — `PageFrame`. Вертикальный шаг внутри рамки — 16px (сотрудники, кандидаты) и 24px (расписание).

**Что закрепить:** `PageFrame` на всех страницах; для карточек — тот же `PageFrame`, содержимое вкладок ограничено 720px. Один шаг между блоками.
**Что исправить:** roles-client:510, deps-client:369, staff-detail:736, dep-detail:262, cand-detail:177, payroll/page.tsx:14.

### B5. Вкладки

| Вариант | Высота (≈) | Шрифт | Активная | Выравнивание | Где используется |
|---|---|---|---|---|---|
| Общие `Tabs` (`src/components/ui/tabs.tsx:22, 58-63, 80`) | `px-4 py-2.5` → ≈43px | 14px/500 | текст и линия 2px `foreground` | на всю ширину, по умолчанию слева | dep-detail:286 (`justify-center`); cand-detail:276 (`justify-center` внутри прокрутки); старые payroll-компоненты |
| `ProfileTabsList` (`tabs.tsx:31-44`) | то же | то же | то же | по центру, с прокруткой на телефоне | staff-detail:795; tasks-client.tsx:613 |
| `workspace-tabs.module.css:1-5` | `12px 0 14px` → ≈47px | 13px/450, активная 550 | brand | слева, шаг 24px, панель +22px | role-detail:430; `D/people/payroll/_components/employee-pay.tsx:88` |
| `payroll-detail-dialog.module.css:24-27` | `0 0 12px` | 12px/450 | brand | слева, шаг 22px | внутри панели зарплаты |
| Вкладки в панели «Добавить сотрудника» | общие | 14px/500 | foreground | сетка 2-3 равные колонки | staff-client:806-811 |
| `payroll-preview` | свой `s.tabs` и сегменты | 12px | фон | — | макет |

Комментарий в `tabs.tsx:21` говорит «active gets thick brand bar», код рисует `border-foreground` (`tabs.tsx:63`).

Итого у четырёх карточек «Люди» три вида: сотрудник и кандидат — по центру, чёрная линия; подразделение — так же, но без прокрутки на телефоне; должность — слева, синяя.

**Что закрепить:** один вид вкладок страницы. Владелец считает эталоном и сотрудников, и зарплату, а у них вкладки разные — нужно его решение. До решения технически проще принять `ProfileTabsList` (он уже в двух эталонах и в задачах).
**Что исправить:** после решения убрать второй вид; dep-detail:286 и cand-detail:275-276 перевести на `ProfileTabsList`.

### B6. Таблицы

| Экран | Состояние | Шапка | Оформление | Инструменты | Пагинация | Телефон |
|---|---|---|---|---|---|---|
| Сотрудники (staff-table) | `useTableState` | `ResizableTableHead` | `people-table.css` | `TableControls`, `TableFilterChip`, `TableSortPicker/Settings`, `TableColumnManager` | `TablePagination` | `PeopleMobileCards` |
| Кандидаты (cand-client) | то же | то же | то же | то же + `TableBulkBar` | то же | то же |
| Шаблоны смен (template-list.tsx:382-385) | то же | то же | то же | то же | то же | — |
| Задачи (task-list.tsx:478-481) | то же | то же | то же | то же | то же | — |
| Зарплата (`D/people/payroll/_components/payroll-table.tsx`) | `useTableState` | `ResizableTableHead` | **своё**: `rounded-xl border`, `text-[13px]`, ячейка `px-4 py-4`, hover `muted/40` (строки 281, 296, 334) | `TableControls` | `TablePagination` | `PeopleMobileCards` по флагу |
| Расписание (календарь) | своё | своя сетка | `max-h-[72dvh] overflow-auto rounded-lg border bg-card` (schedule-client.tsx:1338) | `TableControls`, `TableFilterChip` | — | список по дням |
| Должности | `useState` + `localStorage` | `div` | своё | своё | нет | нет |
| Подразделения | то же | `div` | своё | своё | нет | нет |

Расхождения внутри эталонов:
- Зарплата: radius 12 против 8, 13px против 14px, ячейка 16px против 12px, нет фиксированной высоты строки (payroll-table.tsx:281-296 против people-table.css:6, 14, 19-23).
- Чип поиска — ручная разметка вместо `TableControlPin`: staff-table:570-582, task-list.tsx:429 (DS:235 запрещает).
- Кнопки `TableControls`: поиск и фильтр — 32px на телефоне (`table-controls.tsx:245`), сортировка и столбцы — всегда 36px (`table-controls.tsx:287`). В одном ряду два размера.
- Sticky-шапка: `thead` имеет `sticky top-0` (`table-head.tsx:71`), но `.scroll` — `overflow-x:auto` без `max-height` (people-table.css:1-8). Контейнер вертикально не прокручивается, страница прокручивается — шапка уезжает (по коду). `72dvh`, обещанные в DS:826 и `people-tables.md:25`, есть только в расписании (schedule-client.tsx:1338; `template-week.tsx:97`); у зарплаты — `65dvh` в режиме `contained` (payroll-table.tsx:289).

`data-table-toolbar.tsx` не используется — удалить.

**Что закрепить:** одна «списочная таблица» = `useTableState` + `ResizableTableHead` + `people-table.css` + `TableControls` + `TablePagination` + `PeopleMobileCards`. Переименовать `people-table.module.css` в общий и вынести из `components/people`.
**Что исправить:** должности, подразделения — на набор; зарплату — на общее оформление; чип поиска — через `TableControlPin`; размеры кнопок в `TableControls` выровнять; решить судьбу sticky (добавить `max-height` либо убрать `overflow-x`).

### B7. Оверлеи

| Примитив | Затемнение | Ширина | Radius | Отступы | Тень | Анимация | Где |
|---|---|---|---|---|---|---|---|
| Все | `bg-black/25` | — | — | — | — | 200ms ease-out / 150ms ease-in | `src/lib/overlay-classes.ts:9-14` |
| `Dialog` | общее | `max-w-lg` 512px | `sm:rounded-lg` 8px | `p-6`, `gap-4` | `shadow-lg` | fade + zoom 95 + slide | `src/components/ui/dialog.tsx:66` |
| `AlertDialog` | общее | 512px | 8px | `p-6` | `shadow-lg` | то же | `src/components/ui/alert-dialog.tsx:65-71` |
| `Sheet` | общее | `w-3/4 sm:max-w-sm` 384px | 0 | `p-6` | `shadow-lg` | slide | `src/components/ui/sheet.tsx:46-57` |
| `EditDrawer` | общее | `w-full sm:max-w-[520px]` | 0 | шапка `px-6 py-5`, тело `px-6 py-6 gap-5`, подвал `px-6 py-4` | `shadow-lg` | slide | `src/components/ui/edit-drawer.tsx:63-98` |
| `Popover` | — | `w-72` | `rounded-md` 6px | `p-4` | `shadow-md` | fade + zoom | `src/components/ui/popover.tsx:41` |
| `DropdownMenu` | — | `min-w-[8rem]` | 6px, пункт 6px | `p-1`, пункт `px-2 py-1.5 text-sm` | `shadow-md` (подменю `shadow-lg`) | fade + zoom | `src/components/ui/dropdown-menu.tsx:52, 70, 88` |
| `ContextMenu` | — | `min-w-[12rem]` | 6px | `p-1` | `shadow-md` | fade + zoom | `src/components/ui/context-menu.tsx:19` |
| Список `Select` | — | по триггеру | 6px, пункт `rounded-sm` 4px | — | `shadow-md` | fade + zoom | `src/components/ui/select.tsx:75, 118` |
| `Tooltip` | — | — | 6px | `px-3 py-1.5`, 12px/600, `bg-neutral-900` | `shadow-lg` | fade + zoom | `src/components/ui/tooltip.tsx:25` |
| `GlobalTooltip` | — | — | 6px | то же | `shadow-lg` | задержка 500ms | `src/components/ui/global-tooltip.tsx:26, 160-166` |

Три вида боковой панели в эталонных экранах:

| Вид | Ширина | Radius | Где |
|---|---|---|---|
| `EditDrawer` — вплотную к краю, шапка/тело/подвал | 520px | 0 | расписание, создание должности/подразделения, справка |
| Голый `Sheet` — `p-6`, крестик в углу, кнопки `flex-1` внутри формы | `sm:max-w-md` 448px | 0 | «Добавить сотрудника» (staff-client:795-796, 920-933) |
| `PayrollDetailDialog` — `Dialog`, сдвинутый вправо с отступом 12px | 560px | 20px, тень `-12px 0 60px #00000014`, `animation: none` | зарплата, оплата должности (`payroll-detail-dialog.module.css:53-64`) |

Прочие отступления: диалог удаления кандидатов `max-w-sm gap-5 rounded-xl p-5` (`D/people/candidates/_components/candidate-delete-dialog.tsx:45`); диалоги в карточке сотрудника `sm:max-w-md` (staff-detail:1559, 1645); поповер `TableControls` — `w-80 rounded-xl p-3 shadow-lg` (`table-controls.tsx:301`); info-поповер `w-[300px] p-5 rounded-xl` (`entity-info-popover.tsx:181`); выбор иконки `w-[380px] p-0 rounded-[10px]` (`icon-picker.tsx:68`); меню профиля radius 20, меню заведений 18, уведомления 16 (`ws.css:136, 175, 233`). Radius поповеров в ходу: 6, 10, 12, 16, 18, 20.

Задержка подсказок: 500ms в общем провайдере (`D/layout.tsx:156`) и `GlobalTooltip`; 450ms в `TableControls` (`table-controls.tsx:234, 279` — всего 9 мест с 450). Комментарий в `icon-tooltip.tsx:15-16` говорит «~150 мс» — устарел.

Сопоставление с DS — в разделе противоречий (пп.1, 6, 16, 18).

**Что закрепить (по факту кода):** затемнение `bg-black/25`; модальное окно 512px / radius 8 / отступ 24; панель — `EditDrawer` 520px; поповер — один radius.
**Что исправить:** «Добавить сотрудника» → `EditDrawer`; по `PayrollDetailDialog` — решение владельца (он в эталонном экране, но противоречит DS:154 и DS:771); свести radius поповеров к одному значению; задержку подсказок к 500ms.

### B8. Контролы

| Контрол | Высота | Radius | Шрифт | Фокус | Где |
|---|---|---|---|---|---|
| `Button` default | 40px (`h-10 px-4`) | 6px | 14px/500 | `ring-2 ring-ring ring-offset-2` | `src/components/ui/button.tsx:8, 26` |
| `Button` sm | 36px | 6px | 14px | то же | `button.tsx:27` |
| `Button` lg | 44px | 6px | 14px | то же | `button.tsx:28` |
| `Button` icon | 40×40 | 6px | — | то же | `button.tsx:29` |
| `Input` | 40px | 6px | 16px, с `md` — 14px | `border-brand` + `ring-2 ring-brand/30` | `src/components/ui/input.tsx:15` |
| `Textarea` | min 80px | 6px | 14px всегда | как `Input` | `src/components/ui/textarea.tsx:15` |
| `SelectTrigger` | **36px** | 6px | 14px, `shadow-sm`, `bg-transparent` | `ring-1 ring-ring`, без смены рамки | `src/components/ui/select.tsx:25` |
| `OptionSelect` | 40px | 6px | 14px, `shadow-none`, `bg-background` | как `SelectTrigger` | `src/components/ui/option-select.tsx:108` |
| `Combobox` | 40px (кнопка outline) | 6px | 14px/400 | как `Button` | `src/components/finance/combobox.tsx:90-99` |
| `DatePicker` | 40px | 6px | 14px | `ring-2 ring-ring ring-offset-2` | `src/components/ui/date-picker.tsx:113-116` |
| `TimePicker` | 40px | 6px | 14px | `ring-2 ring-ring` | `src/components/ui/time-picker.tsx:28` |
| `MonthPicker` (field) | 40px | **8px** | **13px** | не задан | `src/components/shared/month-picker.tsx:57` |
| `MonthPicker` (toolbar) | 32px | 6px | 14px | не задан | `month-picker.tsx:55` |
| `Switch` | 20×36 | круг | — | `ring-2 ring-ring ring-offset-2`; включён — `bg-primary` | `src/components/ui/switch.tsx:13` |
| `Checkbox` | 16×16 | 4px | — | `ring-1 ring-ring`; рамка и заливка `primary` | `src/components/ui/checkbox.tsx:15` |
| `Badge` | ≈22px | 6px | 12px/600 | `ring-2 ring-offset-2` | `src/components/ui/badge.tsx:6` |
| `Label` | — | — | 14px/500 | — | `src/components/ui/label.tsx:9` |
| Кнопки `TableControls` | 36px (поиск/фильтр 32px на телефоне) | 6px | — | как `Button` | `table-controls.tsx:245, 287` |
| Чип / пин | 32px | круг | 14px | — | `src/components/shared/table/table-control-pin.tsx:43` |

Несовпадения у соседей:
- `Input` 40px и `SelectTrigger` 36px в одной форме: roles-client:721/751, role-detail:614/647, dep-detail:312/362, staff-client:840/897. У `Select` ещё тень и прозрачный фон, у `Input` — нет.
- Четыре разных фокуса у полей формы: brand-ореол (`Input`, `Textarea`), серое кольцо 1px (`Select`), кольцо со смещением (`DatePicker`), кольцо без смещения (`TimePicker`). DS:772 смещение запрещает.
- `Textarea` 14px на телефоне, `Input` — 16px: при фокусе на `Textarea` iOS увеличит экран (по `docs/mobile-web.md`).
- `Switch` и `Checkbox` окрашены токеном `primary` (#1d4ed8), кнопки и активные состояния — `brand` (#1570EF). DS:25 относит активные состояния к brand.
- `MonthPicker` (field) — radius 8 и 13px рядом с `DatePicker` radius 6 и 14px.
- `Badge` — radius 6; DS:699 — «бейджи — pill». Статусы в карточке сотрудника сделаны вручную `span rounded-full` (staff-detail:757-779), а не `Badge`.
- Подпись поля: `Label` по умолчанию 14px; в формах «Люди» вручную `text-[13px] font-medium` (staff-detail:941, role-detail:611), в блоках автоматизаций и недостачи — 14px (automation-settings.tsx:41, shortage:223).

**Что закрепить:** все поля формы — 40px, radius 6, один фокус (brand-рамка + `ring-2 ring-brand/30`), 16px на телефоне; подпись — один размер, зашитый в `Label`; активные состояния — brand.
**Что исправить:** `select.tsx:25`, `date-picker.tsx:116`, `time-picker.tsx:28`, `textarea.tsx:15`, `switch.tsx:13`, `checkbox.tsx:15`, `month-picker.tsx:57`, `label.tsx:9`.

### B9. Счётчики

| Модуль | Нативный `title=` | `<select>` | `type=date/time/month` | Hex | `text-[Npx]` (всего) | `rounded-[…]` | `rounded-xl / 2xl` | Свои тени | `uppercase` |
|---|---|---|---|---|---|---|---|---|---|
| `people/staff` | 0 | 0 | 0 | 1 (в комментарии) | 56 | 3 | 7 / 0 | 0 | 0 |
| `people/candidates` | 0 | 0 | 0 | 0 | 5 | 0 | 1 / 0 | 0 | 0 |
| `people/payroll` | 0 | 0 | 0 | 0 (+1 в CSS-тени) | 7 | 0 | 19 / 0 | 2 | 0 |
| `src/app/payroll-concept` | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 0 | 15 | 0 |
| `people/roles` | 0 | 0 | 0 | 1 (в комментарии) | 25 | 6 | 1 / 1 | 0 | 4 |
| `people/departments` | 0 | 0 | 0 | 0 | 16 | 2 | 2 / 1 | 0 | 4 |
| `people/automations` | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 0 | 0 | 0 |
| `schedule` | 0 | 0 | 0 | 0 | 28 | 0 | 2 / 0 | 1 | 1 |
| `src/components/shared` | 0 | 0 | 0 | 6 | 54 | 9 | 5 / 1 | 9 | 7 |

Нативных `title` на HTML-элементах, `<select>` и системных полей даты/времени нет нигде. Нативные элементы всё же есть: `<input type="checkbox">` в настройках столбцов (roles-client:140, deps-client:93) и `<textarea>` (payroll-settings.tsx:102; `src/app/payroll-concept/concept-payment-form.tsx:266`).

Размеры `text-[Npx]`:

| Модуль | 10 | 11 | 12 | 13 | 15 | 28 |
|---|---|---|---|---|---|---|
| `people/staff` | 8 | 7 | 6 | 34 | 1 | — |
| `people/candidates` | 1 | — | — | 4 | — | — |
| `people/payroll` (TSX) | — | 2 | — | 5 | — | — |
| `people/roles` | 2 | 7 | 3 | 12 | — | 1 |
| `people/departments` | — | 7 | 1 | 7 | — | 1 |
| `schedule` | 5 | 7 | — | 16 | — | — |

Размеры шрифта в CSS-модулях зарплаты (мимо Tailwind):
- `src/app/payroll-concept/*.css` — 27 разных значений от 9 до 42px; чаще всего 12px (49), 11px (40), 13px (34), 10px (30); 9px — 7 раз.
- `D/people/payroll/**/*.css` — 16 значений от 10 до 33px.

Radius в CSS зарплаты: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16px (`payroll-concept.module.css`); 7px — 9 раз, 5px — 6 раз.

Примеры:
- Hex: staff-client:529 и role-detail:698 — только в комментариях; в работающем коде — `src/components/shared/venue-switcher.tsx:47-52` (шесть цветов аватара); `payroll-detail-dialog.module.css:63` (`#00000014`); `D/payroll-preview/payroll-preview.module.css:6` (`#0000000d`).
- `rounded-[14px]`: role-detail:529, 737; dep-detail:546; profile-section.tsx:29. `rounded-[10px]`: role-detail:600; icon-picker.tsx:68; `department-icon-picker.tsx:64`.
- `rounded-2xl`: role-detail:395; dep-detail:266.
- `rounded-xl` на таблицах и секциях: roles-client:612; deps-client:475; dep-detail:477; payroll-table.tsx:281; automation-settings.tsx:212.
- Свои тени: `ws.css:139, 167, 175, 187, 188, 241-243`; `table-controls.tsx:247` (ореол активной кнопки); `payroll-concept.module.css:304, 332, 972, 1589`.
- `uppercase`: roles-client:132, 202, 615; deps-client:85, 152, 478; dep-detail:382; schedule-client.tsx:1632; `src/components/shared/table/table-sort-settings.tsx:28, 67`; `ws.css:66`.

**Что закрепить:** шкала шрифта UI — 12 / 13 / 14 / 16 + заголовки; 10-11px только для счётчиков и меток; 9px запретить. Radius — только из шкалы. `uppercase` в «Люди» не используется (в эталонах 0).
**Что исправить:** 13px как рабочий размер уже повсеместен (34 раза у сотрудников), а в типографской шкале DS:93-101 его нет — добавить в шкалу или заменить на 14.

---

## Противоречия внутри docs/design-system.md

1. **Затемнение.** DS:139 «`bg-black/25`» ↔ DS:771 «цвет backdrop (всегда `bg-black/40`)». Код: `bg-black/25` (`overlay-classes.ts:10`). Формулировка: «Затемнение — `bg-black/25`, только через `overlayClass`».
2. **Фокус поля.** DS:641, 646 «`ring-2 ring-brand/30`» ↔ DS:772-773 «`ring-[3px] ring-brand/40`». Код: `ring-2 ring-brand/30` (`input.tsx:15`, `textarea.tsx:15`); комментарий `input.tsx:12` говорит «3px». `Select`, `DatePicker`, `TimePicker` правилу не следуют (B8). Формулировка: «`border-brand` + `ring-2 ring-brand/30`, без смещения — для всех полей формы».
3. **Заголовок страницы.** DS:96 «40px/700» ↔ DS:296 «30-32px» ↔ DS:304 «32px» (карточка) ↔ DS:451 «`text-3xl`» ↔ DS:581 и DS:818 «28px»; `people-tables.md:14` — «30px/700». Код: 30px/700 в `TablePageHeader` (`table-page-header.tsx:33`); 28px/700 в `ProfileHeader` (`profile-header.tsx:43`); 28px/550 в карточке должности (role-detail:408); 40px/700 у зарплаты (`payroll-concept.module.css:1816-1821`); 36px/600 у уведомлений (`ws.css:225-230`); `text-2xl font-semibold` в «Организации». Формулировка: «Список — 30px/700; карточка — 28px/700». Зарплату привести к 30px либо владелец утверждает 40px для всех списков.
4. **Поля страницы.** DS:449, 459 «`p-6 md:p-8` … никакого другого» ↔ DS:426-432 «`PageFrame` 38/42/20 … новые и обновляемые страницы используют ту же рамку»; для карточек DS:580 «`px-6 md:px-8 pt-4 pb-8`» ↔ DS:431 «карточка должности использует `PageFrame`». Код: эталоны на `PageFrame` (B4). Формулировка: «Все страницы — `PageFrame`»; DS:449-466 и DS:580 удалить.
5. **Sticky-шапка.** DS:718-745 «оконный sticky, никаких `overflow`-обёрток, ширины в процентах» ↔ DS:826 «шапка закреплена внутри scroll-контейнера 72dvh… явное исключение». Код: у списков людей `overflow-x:auto` без `max-height` (people-table.css:1-8) — не работает ни то, ни другое (по коду); 72dvh только в расписании. Формулировка — после решения: либо «контейнер `max-height: 72dvh; overflow: auto`» (и добавить в CSS), либо убрать `overflow-x` и вернуться к оконному.
6. **Модальное окно.** DS:193-194 «600px, cornerRadius 16, padding 28» ↔ DS:697 «12 · `rounded-xl` — модалки, диалоги». Код: 512px / 8px / 24px (`dialog.tsx:66`). Формулировка: «`max-w-lg`, `rounded-lg`, `p-6`».
7. **Radius панели.** DS:154 «без скругления» ↔ DS:695 «8 — Sheet/Drawer-крыша». Код: 0 (`edit-drawer.tsx:63-66`); у панели зарплаты — 20px. Формулировка: «Боковая панель без скругления».
8. **Крошки.** DS:339-341 «список — НЕТ, карточка — ссылка назад» ↔ DS:818 «навигация живёт в `PageBreadcrumb`» и `people-tables.md:13` «Люди / название раздела». Код: оба варианта (B1). Формулировка — из B1.
9. **Вкладки.** DS:231 «active border-bottom 2px foreground», DS:598 «Tabs всегда `justify-center`» ↔ DS:816 «настройки оплаты должности и расчёт сотрудника используют `workspace-tabs.module.css`» (слева, brand). Код: оба (B5). Нужен выбор владельца.
10. **Топбар.** DS:322 «56px» ↔ код 68px (`ws.css:28-30`). DS:332 «`rounded-lg` (8px)» ↔ 9px (`ws.css:41`). DS:334-335 «точка `bg-brand` 8×8» ↔ красная таблетка с числом (`notification-bell.tsx:368`). DS:343 «Help — TBD» ↔ реестр уже работает. Формулировка: «68px (58px на телефоне); кнопки `size-9 rounded-lg`; справка — из реестра, на любой странице с записью».
11. **Ширина содержимого карточки.** DS:391 «centered content (max-w 720)» ↔ вкладки «Права доступа» и «Оплата труда» на всю ширину `PageFrame` (role-detail:452, 590). Формулировка: «Формы — до 720px; списки и таблицы внутри вкладки — на всю ширину».
12. **Кнопка сохранения.** DS:399-418 «видна всегда; без изменений — `secondary`» ↔ код: карточка сотрудника — всегда brand при праве на правку (staff-detail:1262-1270); должность и подразделение — по DS; недостача — появляется только при изменениях (shortage:179, 243); автоматизации — полупрозрачная `disabled` (automation-settings.tsx:739). Формулировка: оставить DS:399-418 и привести четыре места к ней — либо принять поведение эталона (сотрудник) и переписать DS.
13. **Radius кнопок и полей.** DS:687 «8 base: кнопки, input, select» и DS:695 «input, select» ↔ DS:694 «6 — кнопки shadcn по умолчанию». Код: 6px у `Button`, `Input`, `Select` (`button.tsx:8`, `input.tsx:15`, `select.tsx:25`). Формулировка: «Кнопки и поля — 6 (`rounded-md`); карточки и таблицы — 8».
14. **Кнопки панели инструментов.** DS:311-312 «36×36, cornerRadius 8, активный `bg-brand text-brand-foreground`» ↔ код: radius 6, активная — рамка brand + ореол, на телефоне 32px (`table-controls.tsx:245-247`). Формулировка — по коду.
15. **Бейдж.** DS:699 «pill — бейджи» ↔ `Badge` `rounded-md` (`badge.tsx:6`); статусные метки сделаны вручную `rounded-full`. Формулировка: «Статус — pill через общий компонент»; `Badge` перевести на `rounded-full` либо завести `StatusBadge`.
16. **Тени.** DS:663-664 «поповеры и диалоги — `shadow-md`; панель — LG `x:-10 blur:30`» ↔ код: `Dialog` и `EditDrawer` — `shadow-lg`. DS:776 «произвольные тени запрещены» ↔ 15 своих теней в зарплате, 9 в `components/shared`. Формулировка: зафиксировать `shadow-md` (поповер, меню) и `shadow-lg` (диалог, панель, подсказка); свои тени оболочки оформить токенами.
17. **Ширина панели.** DS:771 «всегда 520» ↔ 448px (staff-client:796) и 560px (`payroll-detail-dialog.module.css:57`).
18. **Единственный пин.** DS:235 «`TableControlPin` — единственный валидный пин» ↔ ручной чип поиска в эталоне (staff-table:570-582; task-list.tsx:429).
19. **Два «общих» выпадающих списка.** DS:261 «вместо `<select>` — `OptionSelect`» ↔ DS:820 «выпадающие поля кандидатов используют общий `Select`». У них разная высота (40 и 36px). Формулировка: «В формах — `OptionSelect`; `Select` напрямую не использовать, пока не выровнена высота».
20. **Типографская шкала без 13px.** DS:93-101 (12 / 14 / 16) ↔ DS:154, 161, 304, 318 сами предписывают 13px; в коде 13px — самый частый произвольный размер. Формулировка: добавить «Body Small 13px» в шкалу либо убрать 13px из правил.
21. **Комментарии в коде, спорящие с кодом.** `tabs.tsx:21` («brand bar») — код `foreground`; `icon-tooltip.tsx:15-16` («~150 мс») — провайдер 500ms; `input.tsx:12` («3px halo») — код `ring-2`.

---

## Не проверено

- Ничего не запускалось в браузере. Выводы «по коду»: обрезание колонок должностей/подразделений на телефоне (A1 п.2, A2 п.1); синяя «Опасная зона» в карточке должности (A1 п.12); кнопка «Восстановить» шириной 36px в топбаре (B3); неработающая sticky-шапка списков людей (B6).
- `sheerly.pen` не открывался — сверка шла только с текстовыми документами.
- Экран зарплаты (`payroll-concept.tsx`, 1175 строк, и CSS 2281 строка) прочитан выборочно: шапка, крошка, кнопка справки, h1. Внутренние переключатели видов, таблицы и формы — не разбирались.
- `staff-detail` (1736 строк) и `cand-detail` (598) — только шапка, вкладки, первая секция, кнопка сохранения.
- `schedule-client.tsx` (1931), `editors.tsx`, `run-panel.tsx`, `tasks-client.tsx` — только оболочка (рамка, крошка, шапка).
- `docs/mobile-web.md` не читался целиком; ссылки на правило «16px в поле ввода» взяты из комментария в `table-controls.tsx:122-124`.
- Толщина штриха иконок (DS:111 — 1.5px) не проверялась.
- Внутренности `TableColumnManager`, `TableSortSettings`, `PeopleMobileCards`, `people-overview` не разбирались.
- `discipline-settings.tsx`, `payroll-setup.tsx`, `experience-scale-editor.tsx` (соседи автоматизаций) не читались.
- Счётчики B9 получены регулярными выражениями; hex в комментариях отмечены вручную только для первых примеров.
- Модули вне «Люди» и «График работы» (финансы, организация, продажи, каталог) смотрелись только на предмет h1 и наличия крошки.
