# Аудит UI/UX: модуль «Кандидаты»

Область: `/people/candidates` (список), `/people/candidates/archive`, `/people/candidates/[id]` (карточка), все панели и диалоги модуля. Сверка с `docs/design-system.md` (далее DS), `docs/design/people-tables.md`, `docs/design/people-statistics-options.md`, `docs/mobile-web.md` и с модулем «Сотрудники».

Проверка только по коду, без запуска приложения. Все номера строк актуальны для ветки `claude/audit-reference-screens-ad1c35`.

Сокращения путей:

- `cand/` = `src/app/(dashboard)/people/candidates/_components/`
- `candroot/` = `src/app/(dashboard)/people/candidates/`
- `staff/` = `src/app/(dashboard)/people/staff/_components/`
- `staffcard/` = `src/app/(dashboard)/people/staff/[userId]/_components/`
- `ui/` = `src/components/ui/`, `shared/` = `src/components/shared/`, `people/` = `src/components/people/`

---

## Инвентарь

| Параметр | Значение в «Кандидатах» | Где |
|---|---|---|
| Рамка списка | `<PageFrame className="flex min-w-0 flex-col gap-4">`: max-width 1580px, отступы 38/42/20 (≤1150px: 30/26/18, ≤480px: 27/16/18, ≥1500px: верх 45). Вертикальный шаг 16px. При выделении строк добавляется `pb-28 md:pb-24` | `cand/candidates-client.tsx:290-295`, `shared/page-frame.module.css:1-4` |
| Рамка карточки | Не `PageFrame`: `mx-auto flex w-full min-w-0 max-w-[1120px] flex-col gap-6 px-6 pb-8 pt-4 md:px-8`; контент вкладок `max-w-[720px]` по центру | `cand/candidate-detail-client.tsx:177, 282, 430, 444` |
| Рамка ошибки | `<div className="p-6 space-y-4">`, не `PageFrame` | `candroot/error.tsx:5` |
| h1 списка | `truncate text-3xl font-bold tracking-tight` (30px/700) + счётчик `h-7 min-w-7 rounded-md bg-muted px-2 text-sm font-normal tabular-nums` | `shared/table/table-page-header.tsx:33-45` через `people/people-list-header.tsx:30-36` |
| Подзаголовок списка | «Анкеты с сайта и этапы приёма на работу», `mt-1 text-sm text-muted-foreground` | `cand/candidates-client.tsx:299`, `shared/table/table-page-header.tsx:48-50` |
| h1 карточки | `text-[28px] font-bold leading-tight tracking-tight`, `break-words` (`wrapName`), аватар 56px | `shared/profile-header.tsx:32-47`, `cand/candidate-detail-client.tsx:178` |
| h1 ошибки | Голый `<h1>` без размера: глобальный стиль даёт только `font-bold tracking-tight`, размер наследуется (16px) | `candroot/error.tsx:6`, `src/app/globals.css:201` |
| Хлебные крошки, список | `PageBreadcrumb` → «Люди / Кандидаты», `text-sm`, «Люди» не ссылка | `people/people-list-header.tsx:18-29` |
| Хлебные крошки, карточка | `PageBreadcrumb` → «Люди / Кандидаты (ссылка) / ФИО (truncate + `data-tip`)», разметка написана вручную | `cand/candidate-detail-client.tsx:168-176` |
| Хлебные крошки, архив | Страницы нет: `redirect("/people/candidates")` | `candroot/archive/page.tsx:1-4` |
| Кнопки топбара | Справка «?» (`size-9 rounded-lg`, иконка 18px) на списке и на карточке; `EntityInfoPopover` не используется; `PageHeaderActions` не используется | `src/app/(dashboard)/_components/page-help-registry.tsx:39`, `src/app/(dashboard)/_components/page-help-button.tsx:34-36` |
| Вкладки | `Tabs` + `TabsList className="min-w-max justify-center"` в ручной обёртке `overflow-x-auto`; три вкладки «Анкета / Коммуникация / Журнал»; триггер `px-4 py-2.5 text-[14px] font-medium`, активная `border-foreground`. `ProfileTabsList` не используется | `cand/candidate-detail-client.tsx:274-281`, `ui/tabs.tsx:54-66` |
| Компонент таблицы | Семантический `<table>` + TanStack (`manualSorting`, `manualPagination`), `ResizableTableHead`, стили `people-table.module.css` | `cand/candidates-client.tsx:242-268, 480-566` |
| Высота строки / шапки | Строка 60px, padding ячейки 12px, текст 14/20; шапка `h-11` (44px), `text-xs font-medium tracking-wide text-muted-foreground`, фон `bg-muted` | `people/people-table.module.css:18-27`, `shared/table/table-head.tsx:71-73` |
| Радиус / рамка таблицы | `border-radius: var(--radius)` (8px), `border`, `background: card` | `people/people-table.module.css:1-8` |
| Липкая шапка | `sticky top-0 z-20` на `thead`, но контейнер `.scroll` имеет только `overflow-x: auto`, без `max-height`. Фактически шапка не закреплена (см. дефект 1) | `shared/table/table-head.tsx:71`, `people/people-table.module.css:1-8` |
| Управление столбцами | `TableColumnManager` (видимость, порядок, сброс), ресайз `useTableColumnResize`, хранение `useTableState` (`candidates.list.<account>:<user>`) | `cand/candidates-client.tsx:78-82, 272-273, 325-349` |
| Сортировка | Мультисортировка: клик по заголовку, `TableSortPicker` в тулбаре, `TableSortSettings` в чипе; цикл написан вручную, не через `useMultiSort` | `cand/candidates-client.tsx:195-204, 316-324, 360-383, 506-529` |
| Фильтры | Кнопка-переключатель ряда чипов; `DateRangeFilter`, `TableFilterChip` (статус, множественный; должность) | `cand/candidates-client.tsx:312-315, 387-432` |
| Массовые действия | `TableBulkBar floating`, одно действие «Удалить» (`ghost`, красный текст), только владельцу | `cand/candidates-client.tsx:619-644` |
| Пагинация | `TablePagination`, 25/50/100, серверная | `cand/candidates-client.tsx:602-617` |
| Мобильные карточки | `PeopleMobileCards` до 639px: фото, имя, должность, статус, остальные видимые поля, чекбокс; перехода по тапу на карточку нет | `cand/candidates-client.tsx:568-601`, `people/people-table.module.css:49-110` |
| Пустое состояние | Текст в `<td className="py-14 text-center text-muted-foreground">`; на телефоне `rounded-lg border px-5 py-10 text-center text-sm`. `EmptyState` не используется | `cand/candidates-client.tsx:553-564`, `people/people-mobile-cards.tsx:118-122` |
| Загрузка | `aria-busy` на обёртке, пагинация `pointer-events-none opacity-60`; сама таблица визуально не меняется | `cand/candidates-client.tsx:464, 602-605` |
| Ошибка списка | `role="alert"`, `rounded-lg border p-3 text-sm` + кнопка `outline sm` «Повторить загрузку» | `cand/candidates-client.tsx:465-479` |
| Секции карточки | `ProfileSection`: `rounded-[14px] border bg-card p-5 flex flex-col gap-4`, заголовок `h2 text-base font-semibold`, описание `text-[13px]` | `shared/profile-section.tsx:29-55` |
| Поля в режиме чтения | Локальный `ProfileValue`: `dt text-[13px] leading-snug text-muted-foreground`, `dd text-sm leading-relaxed`, пусто = «Не указано» серым; сетка `sm:grid-cols-2 gap-x-8 gap-y-5`; широкие строки `sm:grid-cols-[160px_minmax(0,1fr)]` | `cand/candidate-detail-client.tsx:284, 591-598` |
| Режим правки | Отдельная панель `CandidateForm`; на странице только чтение | `cand/candidate-form.tsx:69-143` |
| Панели (drawer) | Все четыре на `EditDrawer` (520px): «Редактировать анкету», «Назначить собеседование / стажировку / Изменить назначение», просмотр назначения с результатом, «Принять на работу». Сырой `Sheet` не используется | `cand/candidate-form.tsx:70`, `cand/candidate-appointment-drawer.tsx:53`, `cand/candidate-appointment-details.tsx:66`, `cand/hire-drawer.tsx:134` |
| Диалоги | `AlertDialog` ×3: удаление анкеты (`max-w-sm gap-5 rounded-xl p-5`, заголовок `text-base`), удаление комментария (по умолчанию `max-w-lg p-6 sm:rounded-lg`, заголовок `text-lg`), «Не сохранять изменения?». `Dialog` ×1: код замка | `cand/candidate-delete-dialog.tsx:45-90`, `cand/candidate-comments.tsx:74-88`, `cand/candidate-appointment-details.tsx:105-108`, `cand/staff-door-code.tsx:42-66` |
| Поповеры и меню | `Popover` смены статуса (`w-60 p-1`); `DropdownMenu` «⋯» в шапке (`w-52`), у комментария, в панели назначения; `HoverCard` фото | `cand/candidate-status-cell.tsx:94`, `cand/candidate-detail-client.tsx:205-226`, `cand/candidate-comments.tsx:60-66`, `cand/candidate-appointment-details.tsx:72-75`, `people/person-avatar.tsx:50-92` |
| Подсказки | Только `data-tip` (6 мест) и `Tooltip` из общих контролов таблицы. Нативного `title` в модуле нет | `cand/candidate-detail-client.tsx:174, 192`, `cand/candidate-table.tsx:84, 119`, `cand/candidate-status-cell.tsx:82`, `cand/fields.tsx:61` |
| Выпадающие списки | Локальный `FieldSelect` поверх `Select` (`h-10`, свой маркер `__empty__`), дублирует `OptionSelect` | `cand/fields.tsx:19-46` |
| Дата / время | `DatePicker` (h-10); время через `TimeInput` (ввод с клавиатуры, h-10), а не `TimePicker` из таблицы замен DS | `cand/hire-drawer.tsx:217-221`, `cand/candidate-appointment-drawer.tsx:62-63`, `ui/time-input.tsx:18-31` |
| Нативные контролы | `<input type="file">` (`sr-only` в `label`), `<input type="number">` ×6 (возраст, 5 денежных полей), `<details>/<summary>`, сырой `<table>` ставок. Нативных `select/date/time` нет | `cand/candidate-detail-client.tsx:322-339`, `cand/candidate-form.tsx:102`, `cand/hire-drawer.tsx:231-264, 353-361` |
| Высоты кнопок | Шапка карточки `h-10` (default), «⋯» `h-10 w-10`; тулбар списка `h-9` (на телефоне `h-8`); подвалы панелей `h-10`; диалог удаления `h-9`; мелкие иконки `size-8`, `size-7` | `ui/button.tsx:25-30`, `cand/candidate-detail-client.tsx:181-207`, `cand/candidate-delete-dialog.tsx:69-75`, `cand/candidate-comments.tsx:61` |
| Произвольные размеры шрифта | `text-[13px]` ×4 в модуле (`fields.tsx:13`, `candidate-appointment-row.tsx:20`, `candidate-appointment-details.tsx:77`, `candidate-detail-client.tsx:594`), `text-[10px]` ×1 (`candidates-client.tsx:518`). Через общие компоненты: `text-[28px]`, `text-[18px]`, `text-[14px]`, `text-[13px]`, `text-[12px]` | см. слева; `shared/profile-header.tsx:43`, `ui/edit-drawer.tsx:74, 78`, `ui/tabs.tsx:58`, `shared/profile-section.tsx:44, 52` |
| Произвольные размеры блоков | `max-w-[1120px]`, `max-w-[720px]` ×3, `min-h-[76px]`, `min-h-[120px]`, `w-[calc(100%-2rem)]` | `cand/candidate-detail-client.tsx:177, 282, 430, 444`, `cand/candidate-appointment-row.tsx:16`, `cand/candidate-appointment-details.tsx:88`, `cand/candidate-delete-dialog.tsx:45` |
| Жёсткие цвета | Hex/rgb: 0. Классы палитры: `amber-500` и `emerald-500` с альфой `/10` и парами `text-*-700 dark:text-*-400` (7 мест), все с dark-вариантом текста. `bg-primary`: 0 | `src/lib/candidates/types.ts:36-43`, `src/lib/candidates/appointment-labels.ts:11-17`, `cand/candidate-detail-client.tsx:246` |
| Палитра бейджей статуса | Без рамки: `bg-muted` / `bg-amber-500/10` / `bg-brand/10` / `bg-emerald-500/10` / `bg-destructive/10`; форма `rounded-full px-2 py-0.5 text-xs font-medium` | `src/lib/candidates/types.ts:36-43`, `cand/fields.tsx:57` |

---

## Что сделано хорошо и стоит закрепить

1. **Путь в топбаре для разделов «Люди»**: «Люди / Раздел» на списке и «Люди / Раздел / Сущность» на карточке. `people/people-list-header.tsx:18-29`, `cand/candidate-detail-client.tsx:168-176`. Правило: путь из раздела, списка и сущности; предпоследний сегмент ссылка, последний `aria-current="page"` с `truncate` и `data-tip`. Сейчас DS (строка 341) прямо запрещает крошки на списке, а `people-tables.md:13` их требует. Нужен общий компонент, разметка скопирована вручную.

2. **Счётчик рядом с h1**: нейтральная плашка `h-7 rounded-md bg-muted text-sm tabular-nums` с `aria-label="Всего: N"`. `shared/table/table-page-header.tsx:37-45`. Правило: число записей показываем плашкой у заголовка, а не текстом в подзаголовке.

3. **Одно главное действие по этапу в шапке карточки, остальное в «⋯»**. `cand/candidate-detail-client.tsx:180-227`. Правило: в шапке профиля одна кнопка `default`, её подпись зависит от состояния сущности; редкие и разрушительные действия уходят в `DropdownMenu` (`outline`, `size="icon"`), разрушительное последним через разделитель. В DS (строка 820) описано только словами для кандидата, как общий паттерн не оформлено.

4. **Чтение анкеты через `dl`**: подпись 13px серая, значение 14px, пустое значение «Не указано» серым, длинные тексты строкой «подпись 160px + значение». `cand/candidate-detail-client.tsx:284-316, 591-598`. Правило: в секции профиля в режиме чтения используем `dl`, две колонки от `sm`, длинные поля на всю ширину. Компонент стоит вынести из файла страницы в `shared/` рядом с `ProfileSection`.

5. **Смена статуса прямо из бейджа**: поповер `p-1 w-60` с вариантами в виде тех же бейджей; оптимистичное значение, откат и сообщение при ошибке, сверка по `revision`. `cand/candidate-status-cell.tsx:47-67, 77-114`, `cand/candidates-client.tsx:210-230`. Правило: если переход требует данных (дата собеседования), меню открывает форму, а статус меняется только после сохранения (`cand/candidate-status-cell.tsx:49-52`).

6. **Панель просмотра по правилам «Б»**: статус в `titleAccessory`, одна `DrawerSummary`, плоские `DrawerSection`. `cand/candidate-appointment-details.tsx:66-103`. Хороший живой пример для DS.

7. **Защита несохранённого результата**: закрытие панели и переход к правке назначения при наличии изменений идут через диалог «Не сохранять изменения?». `cand/candidate-appointment-details.tsx:47-54, 105-108`. Правило: панель с формой, где ввод трудно восстановить, спрашивает подтверждение при закрытии с изменениями. В DS есть только упоминание одного случая (строка 147).

8. **Диалог удаления с причиной запрета**: если удалять нельзя, диалог открывается, объясняет почему и блокирует кнопку; ошибка сервера показывается внутри диалога, а не тостом; кнопка в ожидании меняет подпись на «Удаляем…». `cand/candidate-delete-dialog.tsx:63-89`, `cand/candidate-detail-client.tsx:535-541`. Правило: разрушительное действие не прячем, а объясняем, почему оно недоступно.

9. **Плавающая панель выделения не перекрывает последние строки**: рамка страницы получает нижний отступ, пока есть выделение. `cand/candidates-client.tsx:291-294`. Правило для всех списков с `TableBulkBar floating`.

10. **Доступность серверного списка**: скрытая строка `aria-live="polite"` с числом анкет, `aria-busy` на области таблицы, `aria-sort` на заголовках, подписи у чекбоксов с ФИО. `cand/candidates-client.tsx:461-464, 525-529`, `cand/candidate-table.tsx:143`.

11. **Ошибка загрузки списка остаётся на странице**: блок `role="alert"` над таблицей с кнопкой повтора, прежние строки не исчезают. `cand/candidates-client.tsx:465-479`.

12. **Строка-кнопка для вложенной записи**: плитка-иконка 36px, заголовок, серый подзаголовок, бейдж статуса, шеврон; вся строка одна `button` с полным `aria-label` и `focus-visible`. `cand/candidate-appointment-row.tsx:14-24`. Правило: запись, которая открывает панель просмотра, оформляется так, без отдельных кнопок «Открыть».

13. **Состояния внутри панели**: загрузка, ошибка с повтором и «условие не выполнено» показываются в теле панели, главная кнопка при этом выключена. `cand/candidate-appointment-drawer.tsx:57-60`.

14. **Долгая операция с возобновлением**: пояснение `role="status"` на время оформления и спокойный баннер «Оформление сотрудника начато» с кнопкой продолжения. `cand/hire-drawer.tsx:426-431`, `cand/candidate-detail-client.tsx:262-273, 198-200`.

15. **Подсказка у выключенной кнопки через обёртку `span data-tip`** применена по правилу DS. `cand/candidate-detail-client.tsx:192`. Сам случай содержит ошибку логики (дефект 20), но приём верный.

16. **Ввод времени с клавиатуры** с нормализацией «0930 → 09:30» и сообщением об ошибке. `ui/time-input.tsx:7-30`. В DS не описан: нужно решить, когда `TimeInput`, а когда `TimePicker` (дефект 30).

17. **Тинт-баннер предупреждения**: `rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm`, одинаково читается в светлой и тёмной теме. `cand/candidate-detail-client.tsx:246`. В DS нет паттерна для встроенных баннеров.

---

## Дефекты

### Список

1. **[P1] Шапка таблицы не закреплена, документация описывает другое поведение**
   - Где: `people/people-table.module.css:1-8`, `shared/table/table-head.tsx:71`. Затрагивает списки кандидатов и сотрудников.
   - Что сейчас: у `.scroll` только `overflow-x: auto`, `max-height` нет. `thead` имеет `sticky top-0`, но ближайший scroll-контейнер по вертикали не прокручивается, поэтому шапка уезжает вместе со страницей. Ограничение `max-height: 72dvh; overflow: auto` удалено в коммите `f5a46b5d` (#602).
   - С чем расходится: DS строка 826 и `people-tables.md:25` («прокрутка внутри контейнера, max-height 72dvh, липкая шапка»), DS строки 718-742 («sticky обязателен для всех таблиц»).
   - Как исправить: принять одно решение и привести к нему код и оба документа. Либо вернуть `max-height: 72dvh; overflow: auto`, либо убрать `overflow-x` у `.scroll` и перейти на оконный sticky с долями ширины.

2. **[P1] Активные фильтры пропадают из вида при сворачивании ряда фильтров**
   - Где: `cand/candidates-client.tsx:355, 387-432, 449-458`.
   - Что сейчас: чипы даты, статуса и должности рисуются только при `filtersVisible`. Если выбрать фильтр и нажать кнопку «Фильтры» ещё раз, чипы исчезают, фильтр продолжает действовать, в ряду остаётся одна красная «Очистить все».
   - С чем расходится: «Сотрудники» показывают чип при `filtersVisible || !!filter.x` (`staff/staff-table.tsx:512, 533, 545, 557`); DS строки 495-497 («видна сразу, если фильтр уже выбран»).
   - Как исправить: условие отрисовки каждого чипа `filtersVisible || <значение выбрано>`.

3. **[P1] Кнопки пагинации без доступного имени**
   - Где: `shared/table/table-pagination.tsx:73-90` (общий компонент, используется в `cand/candidates-client.tsx:606`).
   - Что сейчас: две кнопки только с иконками `ChevronLeft` / `ChevronRight`, без `aria-label`.
   - С чем расходится: DS строка 184 («у иконки без текста `aria-label` ставим отдельно»).
   - Как исправить: `aria-label="Предыдущая страница"` и `aria-label="Следующая страница"`.

4. **[P2] Кнопка «Фильтры» подсвечена, когда ряд просто открыт**
   - Где: `cand/candidates-client.tsx:313` (`active: filtersVisible || hasFilters`). То же в `staff/staff-table.tsx:444`.
   - С чем расходится: DS строки 236 и 492-494 (подсветка только при выбранном фильтре).
   - Как исправить: `active: hasFilters`.

5. **[P2] Чип поиска нарисован вручную**
   - Где: `cand/candidates-client.tsx:433-448`: `inline-flex h-8 max-w-64 items-center gap-2 rounded-full border border-brand/20 bg-brand/10 pl-3 pr-1.5 text-sm text-brand`, внутри кнопка без `type`, зона нажатия около 20px.
   - С чем расходится: DS строка 235 («единственный валидный пин — `TableControlPin`, не копируй стили»). В «Сотрудниках» такая же копия с другими отступами (`pr-2`, без hover): `staff/staff-table.tsx:569-583`.
   - Как исправить: вариант `TableControlPin` без поповера (только подпись и ×) в общем компоненте, подключить в обоих списках.

6. **[P2] У чипа сортировки нет крестика сброса**
   - Где: `cand/candidates-client.tsx:361-382`: `TableControlPin active` без `onClear`, справа шеврон.
   - С чем расходится: DS строка 559 (`onClear = () => setSorts([])`). В «Сотрудниках» так же: `staff/staff-table.tsx:494-510`.
   - Как исправить: `onClear={() => changeSorting([])}` в обоих списках.

7. **[P2] Цикл сортировки и индикатор написаны заново в двух файлах**
   - Где: `cand/candidates-client.tsx:195-204, 508-529` и `staff/staff-table.tsx:613-642`: одинаковый код цикла, `headerIndicator`, `headerAriaSort`.
   - С чем расходится: DS строки 239 и 520 («механика в `useMultiSort`, заново не писать»).
   - Как исправить: перевести оба списка на `useMultiSort` либо вынести общий хук для `SortingState` из TanStack.

8. **[P2] Во время загрузки таблица не показывает, что данные обновляются**
   - Где: `cand/candidates-client.tsx:464, 480-567, 602-605`.
   - Что сейчас: при смене страницы, фильтра или сортировки старые строки остаются без изменений, приглушается только пагинация. На медленной сети клик выглядит несработавшим.
   - Как исправить: на время `loading` приглушать `tbody` (`opacity-60`) и мобильные карточки или показывать тонкую полосу прогресса над таблицей.

9. **[P2] Пустое состояние: простой текст, разная высота в двух списках**
   - Где: `cand/candidates-client.tsx:553-564` (`py-14`), `staff/staff-table.tsx:669-682` (`!h-32`), мобильный вариант `people/people-mobile-cards.tsx:118-122`.
   - С чем расходится: в DS есть `EmptyState` (строка 234), но правило для пустой таблицы не описано; два «близнеца» решили по-разному.
   - Как исправить: один общий блок пустой строки для списков людей (высота, иконка или без неё, текст), подключить в обоих.

10. **[P2] Строка и мобильная карточка не открывают анкету**
    - Где: `cand/candidates-client.tsx:532-552, 568-601` (нет `onClick` у `tr`, нет `onOpen` у `PeopleMobileCards`); переход только по ссылке на имени (`cand/candidate-table.tsx:82-88`).
    - С чем расходится: «Сотрудники» открывают карточку по клику на строку и тапу на карточку (`staff/staff-table.tsx:646-659, 695-698`); `people-tables.md:54` («переход остаётся по имени и строке»).
    - Как исправить: тот же обработчик с исключением `button,a,input,[role=checkbox]`, `cursor-pointer` на строке.

11. **[P2] Экран ошибки раздела выбивается из оболочки**
    - Где: `candroot/error.tsx:5-10`.
    - Что сейчас: `p-6` вместо `PageFrame`; `<h1>` без класса размера (16px жирный); текст «Проверьте доступ к разделу и подключение к базе данных» адресован разработчику; кнопка «Повторить» (в списке «Повторить загрузку»).
    - Как исправить: `PageFrame`, `h1 text-3xl font-bold`, текст для пользователя («Не удалось открыть раздел. Повторите попытку или обратитесь к владельцу аккаунта»).

12. **[P3] Лишние классы на строках дублируют CSS-модуль**
    - Где: `cand/candidates-client.tsx:536-541, 544`: `border-t transition-colors hover:bg-muted/30`, `bg-brand/5 hover:bg-brand/10`, `align-middle` на `td`. То же задано в `people/people-table.module.css:21-39`. `border-t` на `tr` при `border-collapse: separate` не действует.
    - Как исправить: оставить только `data-state`, как в `staff/staff-table.tsx:644-651`.

13. **[P3] Группе условий задан `aria-label` без роли**
    - Где: `cand/candidates-client.tsx:356-359` (и `staff/staff-table.tsx:489-492`), `cand/candidate-status-cell.tsx:95`.
    - Что сейчас: `aria-label` на `div` без `role` скринридером не объявляется.
    - Как исправить: `role="group"` у ряда условий; у списка статусов `role="menu"` с `menuitemradio` либо убрать подпись.

### Карточка кандидата

14. **[P1] Загрузка файла недоступна с клавиатуры визуально и не показывает блокировку**
    - Где: `cand/candidate-detail-client.tsx:319-340`.
    - Что сейчас: `label` с `input.sr-only`. При фокусе с клавиатуры обводки нет (нет `focus-within:`), при `disabled={busy}` подпись выглядит активной и остаётся `cursor-pointer`.
    - С чем расходится: DS строка 143 (обводка через `focus-visible`).
    - Как исправить: `Button variant="ghost" size="sm"` + скрытый `input` через `ref.click()`; тот же вид, что у остальных «Добавить» (см. дефект 17).

15. **[P2] Рамка карточки отличается и от «Сотрудников», и от `PageFrame`**
    - Где: `cand/candidate-detail-client.tsx:177` (`mx-auto max-w-[1120px] px-6 md:px-8 pt-4 pb-8`), `staffcard/staff-detail-page.tsx:736` (`px-6 md:px-8 pt-4 pb-8 w-full`, без max-width).
    - Что сейчас: на широком экране шапка профиля кандидата центрирована в 1120px, шапка сотрудника прижата к левому краю. Обе страницы не используют `PageFrame`; отступ 24/32px не совпадает ни с топбаром (36px, `shared/workspace-appearance.module.css:32`), ни с `PageFrame` (42px).
    - С чем расходится: DS строки 426-438 («новые и обновляемые страницы используют ту же рамку», «не задавать собственную ширину страницы»). При этом DS строка 580 предписывает `px-6 md:px-8 pt-4 pb-8`: противоречие в самом документе.
    - Как исправить: обе карточки на `PageFrame`, шапка и вкладки внутри общей колонки; ширину 720px оставить только у содержимого вкладок.

16. **[P2] Вкладки собраны вручную вместо `ProfileTabsList`**
    - Где: `cand/candidate-detail-client.tsx:275-281` (`div.overflow-x-auto` + `TabsList className="min-w-max justify-center"`).
    - С чем расходится: общий `ProfileTabsList` (`ui/tabs.tsx:30-44`) создан «для страниц профиля, включая прокрутку на телефоне» и используется в `staffcard/staff-detail-page.tsx:795`.
    - Как исправить: заменить на `ProfileTabsList`.

17. **[P2] Три разных «Добавить» в заголовках секций одной страницы**
    - Где:
      - файлы: `label` `text-sm text-brand`, иконка `Paperclip h-4 w-4` (`cand/candidate-detail-client.tsx:319-321`);
      - стажировки: `Button ghost sm` `-my-1.5 -mr-2 h-8 gap-1.5 px-2 text-brand hover:bg-brand/10`, `Plus size-3.5` (`cand/candidate-detail-client.tsx:437`);
      - комментарии: `Button ghost sm` `h-auto gap-1 p-0 text-brand hover:bg-transparent hover:text-brand/80`, `Plus size-3.5` (`cand/candidate-comments.tsx:42-45`).
    - Как исправить: один вариант действия секции (предлагаю вариант стажировок: есть зона нажатия 32px и hover) и слот-компонент в `ProfileSection`.

18. **[P2] Палитра бейджей статуса не совпадает ни с DS, ни с карточкой сотрудника**
    - Где: `src/lib/candidates/types.ts:36-43` (`bg-amber-500/10 text-amber-700 dark:text-amber-400`, без рамки), `cand/fields.tsx:57` (`px-2 py-0.5 text-xs`).
    - С чем расходится: DS строки 609-622 (`bg-{c}-50 text-{c}-700 border-{c}-200`, dark `bg-{c}-500/15 text-{c}-300 border-{c}-500/30`); шапка сотрудника (`bg-emerald-100 dark:bg-emerald-500/15`, `px-2.5`, `text-[12px]`: `staffcard/staff-detail-page.tsx:756-779`); при этом совпадает с `DrawerStatus` (`ui/drawer-blocks.tsx:156-162`). В проекте три палитры для одной сущности «бейдж статуса».
    - Дополнительно: «Собеседование» и «Принят на работу» одного цвета `bg-brand/10 text-brand` (`types.ts:39, 41`).
    - Как исправить: выбрать одну палитру (вариант `DrawerStatus` проще и работает в обеих темах), оформить общий `StatusBadge` с тонами и записать в DS; «Принят» перевести на success.

19. **[P2] Журнал кандидата собран вручную и расходится с журналом сотрудника**
    - Где: `cand/candidate-detail-client.tsx:444-527`: `ol` с `border-l-2 pl-4`, без аватаров, без пустого состояния.
    - С чем расходится: у сотрудника общий `EntityAuditTab` (`staffcard/staff-detail-page.tsx:1425-1434`, `src/components/audit/entity-audit-tab.tsx:46`); в DS история описана как `DrawerTimeline` (строка 171).
    - Сопутствующее:
      - заголовок секции «Журнал» повторяет название вкладки (`:445`);
      - время через `toLocaleString("ru-RU")` с секундами (`:460-462`);
      - пользователю показан идентификатор часового пояса «(Europe/Moscow)» (`:503`).
    - Как исправить: общий компонент ленты событий (или `EntityAuditTab`), формат времени как у комментариев, пояс не показывать или показывать названием города.

20. **[P2] Кнопка найма: мёртвое условие и подсказка не к месту**
    - Где: `cand/candidate-detail-client.tsx:191-203`.
    - Что сейчас: блок рисуется только при `status === "trial"` или начатом оформлении, поэтому `disabled` (`:194`) всегда ложно. Подсказка «Приём на работу доступен на этапе «Стажировка»» (`:192`) показывается только когда оформление начато, а статус не «Стажировка», то есть на активной кнопке «Продолжить оформление». На этапах «Новая», «Можно рассмотреть», «Собеседование» кнопки найма нет совсем, объяснение пользователь не видит.
    - Как исправить: убрать `disabled` и подсказку здесь; если нужно объяснять недоступность найма, показывать выключенную кнопку на ранних этапах (или пункт в «⋯» с пояснением).

21. **[P2] Код замка: два разных интерфейса для одного действия**
    - Где: в карточке кандидата блок вне секций `space-y-3 border-t pt-5` с кнопкой «Показать данные офисного замка» и раскрытием в строке `rounded-lg bg-muted/40 p-4` (`cand/candidate-detail-client.tsx:397-427`); в карточке сотрудника кнопка «Код офисного замка» открывает `Dialog` (`cand/staff-door-code.tsx:22-66`, подключён в `src/app/(dashboard)/people/staff/[userId]/page.tsx:1, 310`).
    - Дополнительно: компонент сотрудника лежит в папке кандидатов.
    - Как исправить: в карточке кандидата использовать тот же `StaffDoorCode` внутри `ProfileSection`; файл перенести в `people/`.

22. **[P2] Три формата даты и времени на одной странице**
    - Где:
      - «17 нояб. 2026 г.» через `dateLabel` (`cand/fields.tsx:75-82`);
      - «17.11.2026, 14:03:22» в журнале (`cand/candidate-detail-client.tsx:460-462`);
      - «17.11.26, 14:03» у комментариев (`cand/candidate-comments.tsx:58`);
      - «17.11.2026» разворотом ISO (`cand/candidate-detail-client.tsx:493`, `cand/hire-drawer.tsx:267`).
    - Как исправить: общие функции формата даты и даты-времени для модуля (или проекта), без секунд.

23. **[P2] В карточке нет инфо-кнопки, справка привязана к карточке иначе, чем у сотрудника**
    - Где: `cand/candidate-detail-client.tsx` не использует `PageHeaderActions` и `EntityInfoPopover`; у сотрудника есть (`staffcard/staff-detail-page.tsx:698-734`). Справка «?» у кандидатов открывается и на карточке (`page-help-registry.tsx:39`), у сотрудников только на списке (`:38`).
    - С чем расходится: DS строки 339-345 (на карточке сущности инфо-поповер обязателен при наличии audit-полей).
    - Как исправить: решить единообразно. У кандидата дата заявки уже в анкете, поэтому либо добавить поповер «Об анкете» (создана, изменена, источник), либо записать в DS исключение; справку включить и на карточке сотрудника.

24. **[P3] Кнопки шапки 40px, тулбар списка 36px**
    - Где: `cand/candidate-detail-client.tsx:181-183, 186, 193, 207` (размер по умолчанию `h-10`, `ui/button.tsx:26, 29`); в списке `h-9` (`shared/table/table-controls.tsx:245, 287`), «Добавить» у сотрудников `h-9` (`staff/staff-client.tsx:736`).
    - С чем расходится: DS строка 311 (кластер 36×36), строка 313 (подсказка обязательна: у «⋯» в шапке её нет, `:207`).
    - Как исправить: `size="sm"` для действий шапки, `IconTooltip label="Действия"` для «⋯»; записать в DS высоту кнопок шапки профиля.

25. **[P3] Запись в двух вариантах размеров иконок**
    - Где: `mr-2 size-4` (`cand/candidate-detail-client.tsx:181, 183`) и `mr-2 h-4 w-4` (`:197, 408`). `mr-2` избыточен: у `Button` уже `gap-2` и `[&_svg]:size-4` (`ui/button.tsx:8`), итоговый зазор 16px вместо 8px.
    - Как исправить: убрать `mr-2` и явные размеры иконок внутри `Button`.

26. **[P3] Строка назначения смещена относительно заголовка секции**
    - Где: `cand/candidate-appointment-row.tsx:16` (`px-3 py-3`, `min-h-[76px]`) внутри `ProfileSection p-5`.
    - Что сейчас: плитка-иконка начинается на 12px правее заголовка секции и текста пустого состояния (`cand/candidate-detail-client.tsx:434, 440`).
    - Как исправить: `-mx-3` у строки или у списка; `min-h-[76px]` заменить значением шкалы (`min-h-[72px]` → `py-4` без min-height).

27. **[P3] Два баннера с разными отступами**
    - Где: `p-3` у предупреждения о дублях (`cand/candidate-detail-client.tsx:246`), `p-4` у «Оформление сотрудника начато» (`:265`).
    - Как исправить: один отступ (`p-4`) и общий компонент встроенного баннера с тонами.

28. **[P3] Остатки архива при заявленном «архива нет»**
    - Где: `candroot/archive/page.tsx:1-4` (заглушка с редиректом), подпись «В архиве» (`cand/candidate-detail-client.tsx:243`), события «Анкета архивирована / восстановлена» (`:89-90`), действия `archive` и `restore` в `candroot/actions.ts:154-160`, фильтр архива в `src/lib/candidates/data.ts:90-92`.
    - С чем расходится: `docs/handbook/people/candidates.md:45` («отдельного архива нет»), а `docs/CONVENTIONS.md` (по `CLAUDE.md`) требует для сущностей архив, восстановление и страницу архива.
    - Как исправить: решение владельца. Либо убрать мёртвые ветки из интерфейса, либо довести до эталона venues (архив вместо «Удалить навсегда» как действие по умолчанию).

### Панели и диалоги

29. **[P2] Подписи полей в панелях 13px, значения полей разного начертания**
    - Где: `cand/fields.tsx:13`: `label` с `flex flex-col gap-1.5 text-[13px] font-medium`.
    - С чем расходится: DS строка 160 (подпись поля `text-sm font-medium`, 14px); «Расписание» использует `grid gap-2 text-sm font-medium` (`src/app/(dashboard)/schedule/_components/editors.tsx:41`). Два локальных компонента `Field` в двух эталонных модулях с разными размерами.
    - Побочный эффект: поле внутри `label` наследует `font-weight: 500` (сброс Tailwind задаёт `font-weight: inherit` для `input`, `button`, `textarea`). `Input` (`ui/input.tsx:15`), триггер `DatePicker` (`ui/date-picker.tsx:112`) и `Textarea` в `cand/candidate-form.tsx:133` своего веса не задают, а `SelectTrigger` (`cand/fields.tsx:39`) и `Textarea` результата (`cand/candidate-appointment-details.tsx:88`) явно ставят `font-normal`. В одной форме значения выходят то полужирными, то обычными. Вывод сделан по коду, на экране не проверялся.
    - Как исправить: общий `DrawerField` в `ui/drawer-blocks.tsx` (подпись `text-sm font-medium`, содержимое `font-normal`), подключить в кандидатах и расписании.

30. **[P2] Обязательные и необязательные поля помечены тремя способами**
    - Где:
      - звёздочка текстом в подписи: «Имя *», «Заведение *», «Дата *» (`cand/hire-drawer.tsx:174, 181, 190, 207, 216, 301`, `cand/candidate-form.tsx:98`, `cand/candidate-appointment-drawer.tsx:62-69`), попадает и в `aria-label` селекта (`cand/fields.tsx:39`);
      - «Время · необязательно» (`cand/candidate-appointment-drawer.tsx:63`);
      - «Необязательно» в действиях раздела (`cand/candidate-appointment-details.tsx:92`).
    - С чем расходится: «Сотрудники» ставят красную звёздочку отдельным `span` (`staff/staff-client.tsx:838, 856, 892`). В DS правила нет.
    - Как исправить: одно правило в DS (например, помечаем только необязательные словом «необязательно» серым в подписи, либо звёздочка `text-destructive` + `aria-required`) и свойство `required` у общего `DrawerField`.

31. **[P2] Панель найма нарушает правила панели-формы**
    - Где: `cand/hire-drawer.tsx`.
    - Что сейчас:
      - вторая синяя кнопка «Создать должность» в теле панели при синей «Принять на работу» в подвале (`:387-392`, `:152-169`);
      - переключатель с плюсом текстом и лишним пробелом: `{" "}` + «+ Создать должность и условия оплаты» / «Отмена создания должности» (`:280-297`);
      - блок с фоном вокруг группы `rounded-lg bg-muted/40 p-4` (`:224`);
      - нативный `<details>` и сырая таблица `text-xs` с прочерком «—» (`:231-264`);
      - предупреждения `text-sm text-destructive` (`:272, 421`) при правиле «тем же размером `text-xs`»;
      - раздел без заголовка (`:396`);
      - пять денежных полей `type="number"` со значением «0» по умолчанию (`:60-66, 344-363`).
    - С чем расходится: DS строки 160-165 и 222-223 (одна главная кнопка, без фона вокруг групп, подсказки `text-xs`), строка 199 («edit → drawer») соблюдена.
    - Как исправить: создание должности вынести во вложенный шаг или отдельную панель с собственным подвалом; условия должности показать плоским `DrawerSection` со строками «подпись: значение», ставки по ссылке на карточку должности; кнопку-переключатель сделать текстовой ссылкой `text-[13px] text-brand` справа в строке подписи «Должность» (DS строка 161).

32. **[P2] Панель назначения смешивает «Просмотр» и «Форму»**
    - Где: `cand/candidate-appointment-details.tsx:66-103`.
    - Что сейчас:
      - подзаголовок панели = ФИО кандидата (`:66`), а дата и время вынесены первой строкой сводки без подписи (`:71-78`);
      - меню «⋯» с единственным пунктом «Изменить назначение» внутри строки сводки (`:72-75`);
      - подвал «Закрыть» + «Сохранить» (`:69`), в остальных панелях «Отмена».
    - С чем расходится: DS строки 168 (подзаголовок: ключевые факты одной строкой), 172-173 (действия в подвале, редкие в меню).
    - Как исправить: подзаголовок «ФИО · 18 ноября, 14:00»; «Изменить назначение» кнопкой `outline` в подвале слева от «Сохранить» (или ссылкой `text-[13px] text-brand`); описать в DS третий тип панели «просмотр с формой результата», если он нужен и в других модулях.

33. **[P2] Отступы между разделами в «Редактировать анкету» вдвое меньше, чем в остальных панелях**
    - Где: `cand/candidate-form.tsx:94`: разделы лежат внутри `form.space-y-5`.
    - Что сейчас: селектор `space-y-5` сильнее `mt-4` у `DrawerSection` (`ui/drawer-blocks.tsx:37`), между разделами получается 20px. В панели найма разделы лежат прямо в теле (`gap-5` + `mt-4` = 36px).
    - С чем расходится: DS строка 160 (36px между разделами).
    - Как исправить: `className="flex flex-col gap-5"` у формы.

34. **[P2] Ошибки сервера в двух панелях показываются без фильтра**
    - Где: `cand/candidate-form.tsx:64-66`, `cand/hire-drawer.tsx:104-106, 129` (`e instanceof Error ? e.message : …`).
    - С чем расходится: остальные места модуля пропускают текст через `candidateError` (`src/lib/candidates/errors.ts:1-15`), который отсекает технические сообщения и нерусский текст.
    - Как исправить: использовать `candidateError` везде.

35. **[P2] Два диалога удаления в одном модуле выглядят по-разному, оба не по DS**
    - Где:
      - анкета: `max-w-sm gap-5 rounded-xl p-5`, заголовок `text-base` с иконкой `AlertTriangle`, кнопки `h-9`, подтверждение `Button variant="destructive" size="sm"` (`cand/candidate-delete-dialog.tsx:45-90`);
      - комментарий: размеры по умолчанию (`max-w-lg p-6 sm:rounded-lg`, заголовок `text-lg`, кнопки `h-10`), подтверждение `AlertDialogAction` с ручными классами `bg-destructive…` (`cand/candidate-comments.tsx:74-88`).
    - С чем расходится: DS строки 190-197 (ширина до 600, радиус 16, padding 28, кнопка подтверждения с тем же глаголом: «Удалить анкету», а не «Удалить», строка 175).
    - Как исправить: общий `ConfirmDialog` (заголовок, текст, причина запрета, подпись кнопки, тон) и одна геометрия; подпись «Удалить анкету» / «Удалить комментарий».

36. **[P2] Удаление навсегда подтверждается одним нажатием, справка обещает другое**
    - Где: `cand/candidate-delete-dialog.tsx:72-89`; `docs/handbook/people/candidates.md:45` («требует подтверждения имени»).
    - Как исправить: либо добавить ввод имени (для одиночного удаления) и числа анкет (для массового), либо поправить справку. Учитывая необратимость и массовое удаление до 100 анкет, первое безопаснее.

37. **[P3] Выбранный пункт в меню статуса без фона**
    - Где: `cand/candidate-status-cell.tsx:97-110`: галочка `size-3.5 text-muted-foreground`, фона `bg-accent` нет.
    - С чем расходится: DS строка 252 («выбранный пункт: фон `bg-accent` и галочка»).
    - Как исправить: `cn(…, value === candidate.status && "bg-accent")`.

38. **[P3] Подсказка дублирует видимый текст бейджа**
    - Где: `cand/fields.tsx:61` (`data-tip={label}` у каждого бейджа всегда) и ещё раз на кнопке `cand/candidate-status-cell.tsx:82`.
    - Что сейчас: при наведении на любой статус всплывает тот же текст, что написан на бейдже, в том числе в пунктах меню.
    - Проверено: `GlobalTooltip` показывает подсказку для любого `[data-tip]` без проверки усечения (`ui/global-tooltip.tsx:34-38`).
   - Как исправить: ставить `data-tip` только когда текст реально усечён (проверка `scrollWidth > clientWidth` в общем компоненте) или убрать с бейджей.

39. **[P3] `FieldSelect` повторяет `OptionSelect`, время вводится не тем контролом, что в DS**
    - Где: `cand/fields.tsx:19-46` (свой маркер пустого значения) при готовом `ui/option-select.tsx`; `TimeInput` (`cand/candidate-appointment-drawer.tsx:63`) используется только здесь, в DS (строка 263) заменой `type="time"` назван `TimePicker`.
    - Как исправить: `FieldSelect` = `DrawerField` + `OptionSelect`; в DS записать, когда какой контрол времени.

40. **[P3] Нет подтверждения при закрытии правки анкеты и найма с изменениями**
    - Где: `cand/candidate-form.tsx:72-74, 82` (кнопка «Сохранить» активна без изменений), `cand/hire-drawer.tsx:144-146`. В панели результата подтверждение есть (`cand/candidate-appointment-details.tsx:50-54`).
    - Дополнительно: `onSubmit` формы вызывает `save()` в обход `disabled` кнопки подвала, поэтому Enter во время сохранения запускает его повторно (`cand/candidate-form.tsx:88-93`).
    - Как исправить: общий признак `dirty` и то же подтверждение; кнопка подвала `type="submit" form="candidate-form"`, проверка `busy` в `save`.

41. **[P3] Редактор комментария: порядок кнопок и аватар отличаются от остального интерфейса**
    - Где: `cand/candidate-comments.tsx:36-39` («Сохранить» слева, «Отмена» справа; в панелях и диалогах наоборот), `:50-53` (свой аватар с двумя инициалами; `ProfileHeader`, `PersonAvatar`, `DrawerAvatar` показывают одну букву), `:61` (кнопка «⋯» 28px).
    - Как исправить: «Отмена», затем «Сохранить», выравнивание вправо; `DrawerAvatar`; кнопка `size-8`.

### Мобильная версия и доступность

42. **[P2] Зоны нажатия меньше 44px на телефоне**
    - Где:
      - бейдж-кнопка статуса около 20px высотой (`cand/fields.tsx:57`, `cand/candidate-status-cell.tsx:79-92`), это основное действие в мобильной карточке;
      - крестик чипа поиска около 20px (`cand/candidates-client.tsx:436-446`), крестик чипа фильтра 16px (`shared/table/table-filter-chip.tsx:63`);
      - чекбокс карточки 36px (`people/people-mobile-cards.tsx:86`);
      - «⋯» комментария 28px (`cand/candidate-comments.tsx:61`).
    - Как исправить: у кнопки статуса `min-h-9` и вертикальные поля на `max-sm`; у крестиков невидимая зона `before:absolute before:-inset-2`.

43. **[P3] В одном ряду тулбара кнопки 32px и 36px на телефоне**
    - Где: `shared/table/table-controls.tsx:245` (`h-8 w-8 … sm:h-9 sm:w-9` у поиска и фильтров) и `:287` (`h-9 w-9` у сортировки и столбцов без мобильного варианта); «Обзор» `size-8 … sm:h-9` (`people/people-overview.tsx:394`).
    - С чем расходится: `docs/mobile-web.md:150-152` (иконки `h-8` на мобильном).
    - Как исправить: тот же адаптивный класс в `TableControlPopoverButton`.

### Тексты

44. **[P2] Справка и руководство отстали от интерфейса**
    - Где:
      - `cand/candidates-help.tsx:66-77`: «сколько получено, сколько ещё новых и сколько завершилось наймом», «сгруппированы по календарным неделям». В интерфейсе «Воронка подбора», «Поступление анкет … по дням», «Анкеты по текущим этапам» (`people/people-overview.tsx:180, 250, 275, 284`); три метрики убраны по `people-statistics-options.md:55`;
      - `docs/handbook/people/candidates.md:7`: «на узком экране таблица прокручивается по горизонтали», фактически карточки.
    - Как исправить: обновить оба текста.

45. **[P3] Разные слова для одних действий**
    - Где:
      - правка: «Редактировать» (`cand/candidate-detail-client.tsx:215`), «Редактировать анкету» (`cand/candidate-form.tsx:75`), «Изменить» (`cand/candidate-comments.tsx:63`), «Изменить назначение» (`cand/candidate-appointment-details.tsx:74`);
      - удаление: «Удалить навсегда» в меню (`cand/candidate-detail-client.tsx:222`), «Удалить анкету?» и «Удалить» в диалоге (`cand/candidate-delete-dialog.tsx:52, 88`);
      - заголовки панелей глаголом («Принять на работу», «Назначить собеседование»), в примерах DS существительным («Новая смена», «Редактирование шаблона», строка 158);
      - главная кнопка при назначении «Сохранить» (`cand/candidate-appointment-drawer.tsx:57`), DS строка 165 требует назвать действие («Назначить»);
      - разделы формы «Основное / Соцсети / Опыт и планы» (`cand/candidate-form.tsx:96, 111, 130`), секции страницы «Личные данные и контакты / Опыт и пожелания» (`cand/candidate-detail-client.tsx:283, 310`);
      - поле «Опыт работы» на странице и в форме (`:312`, `candidate-form.tsx:24`), «Опыт» в журнале (`:70`); «Социальные сети» (`:68`) и «Соцсети».
    - Как исправить: словарь модуля: «Изменить» для правки, «Удалить анкету» для удаления, одинаковые названия разделов в чтении и правке.

46. **[P3] Тире и точки**
    - Где: длинное тире как пустое значение (`cand/hire-drawer.tsx:255-256`), длинные тире в справке (`cand/candidates-help.tsx:22, 36`); часть сообщений об ошибке с точкой («Не удалось изменить статус.», `cand/candidate-status-cell.tsx:62`; «Не удалось загрузить кандидатов.», `cand/candidates-client.tsx:180`), часть без («Не удалось сохранить изменения», `cand/candidate-detail-client.tsx:136`).
    - Как исправить: пустое значение словом или «0»; единое правило пунктуации тостов.

47. **[P3] Вкладка «Коммуникация» содержит назначения, а комментарии лежат в «Анкете»**
    - Где: `cand/candidate-detail-client.tsx:277-279, 428, 430-443`.
    - Что сейчас: под словом «Коммуникация» пользователь ждёт переписку и заметки, а находит собеседование и стажировки; комментарии находятся в конце длинной вкладки «Анкета» под файлами.
    - Как исправить: переименовать вкладку в «Собеседование и стажировки» (или «Этапы») либо перенести комментарии в неё и назвать «Работа с кандидатом».

### Противоречия в docs/design-system.md, которые задевают модуль

| № | Тема | Одна формулировка | Другая формулировка | Что в коде |
|---|---|---|---|---|
| A | Крошки на списке | Строка 341: на index/list крошек нет | `people-tables.md:13`, комментарий `shared/page-header-actions.tsx:12`: «Люди / название раздела» | Крошки есть (`people/people-list-header.tsx:18-29`) |
| B | Крошки на карточке | Строки 361-365, 579: ссылка «‹ Раздел» | Строка 818: «навигация живёт в `PageBreadcrumb`» без формата | Кандидат: путь; сотрудник: «‹ Назад» |
| C | Размер h1 | Строка 96: 40px; строка 296: 30-32px; строка 304: 32px | Строка 451: `text-3xl`; строка 581 и 818: 28px | Список 30px, карточка 28px |
| D | Рамка страницы | Строки 449, 459: `p-6 md:p-8`, `space-y-6`; строка 580: `px-6 md:px-8 pt-4 pb-8` | Строки 426-438: `PageFrame` для всех новых и обновляемых страниц | Список: `PageFrame` + шаг 16px; карточка: `px-6 md:px-8` + свой max-width |
| E | Липкая шапка | Строки 718-742: оконный sticky обязателен, без overflow-обёрток | Строка 826: исключение, контейнер 72dvh | Ни то ни другое (дефект 1) |
| F | Затемнение фона | Строка 139: `bg-black/25` | Строка 771: «всегда `bg-black/40`» | `bg-black/25` (`src/lib/overlay-classes.ts:10`) |
| G | Фокус поля | Строки 641, 646: `ring-2 ring-brand/30` | Строка 773: `ring-[3px] ring-brand/40` | `Input`: `ring-2 ring-brand/30`; `SelectTrigger`: `ring-1 ring-ring` (`ui/select.tsx:25`); `DatePicker`: `ring-2 ring-ring ring-offset-2` (`ui/date-picker.tsx:115`) |
| H | Радиус и отступ диалога | Строка 194: радиус 16, padding 28 | Строка 697: модалки `rounded-xl` (12) | `sm:rounded-lg` (8), `p-6` (`ui/dialog.tsx:66`, `ui/alert-dialog.tsx:65, 71`) |
| I | Главная кнопка карточки | Строка 395: «CTA не висит в шапке» | Строка 306: «Save button (brand) справа»; строка 820: действие по этапу в шапке кандидата | Кандидат: в шапке; сотрудник: в подвале формы |
| J | Палитра бейджей | Строки 609-618: `bg-{c}-50` + рамка | `DrawerStatus` из того же документа (строка 233): `bg-{c}-500/10` без рамки | Три палитры (дефект 18) |
| K | Вкладки | Строка 231: активная `border-foreground`; строка 598: всегда `justify-center` | Строка 816: `workspace-tabs.module.css` (активная brand, влево, 13px) | Кандидат и сотрудник: первый вариант |
| L | Где лежит `IconTooltip` | Строка 182: «из `src/components/ui/tooltip.tsx`» | | Фактически `ui/icon-tooltip.tsx:25` |
| M | Высота топбара | Строка 322: 56px | | 68px, на телефоне 58px (`shared/workspace-appearance.module.css:28-46`) |
| N | Подпись поля в панели | Строка 160: `text-sm font-medium` | | Кандидаты и сотрудники 13px, расписание 14px (дефект 29) |

---

## Расхождения Кандидаты ↔ Сотрудники

| Элемент | Кандидаты | Сотрудники | Что должно победить и почему |
|---|---|---|---|
| Видимость ряда условий | `filtersVisible \|\| hasFilters \|\| sorting` (`cand/candidates-client.tsx:355`) | `filtersVisible \|\| active \|\| q \|\| sorting` (`staff/staff-table.tsx:488`) | Кандидаты: DS строки 498-506 запрещают открывать ряд только из-за поиска |
| Видимость чипов фильтров | Только при `filtersVisible` (`:387`) | `filtersVisible \|\| значение выбрано` (`:512, 533, 545, 557`) | Сотрудники: активный фильтр всегда виден (дефект 2) |
| Иконка чипа сортировки | ↑ или ↓ при одной сортировке, ⇅ при нескольких (`:367-377`) | Всегда ⇅ (`:501`) | Кандидаты: DS строки 555-558 |
| Подпись чипа при нескольких сортировках | Склонение через `plural` (`:365`) | Жёстко «N сортировки» (`:499`) | Кандидаты: корректно для 5 и более |
| Разделитель между группой сортировки и фильтрами | Есть: `mx-1 h-5 w-px bg-border` (`:384-386`) | Нет | Кандидаты: `shared/table/README.md:29` |
| Чип поиска | `pr-1.5`, кнопка `rounded-full p-0.5 hover:bg-brand/10`, без `type` (`:434-447`) | `pr-2`, кнопка без hover, с `type="button"` (`:570-583`) | Ни один: общий `TableControlPin` (дефект 5) |
| Переход в карточку | Только ссылка на имени (`cand/candidate-table.tsx:82-88`) | Клик по строке и тап по мобильной карточке (`staff/staff-table.tsx:646-659, 695-698`) | Сотрудники: `people-tables.md:54` |
| Классы строки таблицы | Дублируют CSS-модуль (`:536-541, 544`) | Только `cursor-pointer` (`:649-651`) | Сотрудники |
| Пустая строка | `py-14` (`:557`) | `!h-32` (`:672`) | Общий компонент (дефект 9) |
| Номер приоритета сортировки | `text-[10px] tabular-nums` (`:518`) | `text-[10px]` (`:638`) | Кандидаты; лучше оба через `useMultiSort` |
| Главное действие списка | Нет (анкеты приходят с сайта) | «Добавить», `size="sm" h-9 gap-2` (`staff/staff-client.tsx:736`) | Доменное различие, оставить |
| Массовые действия | Чекбоксы + `TableBulkBar` (`:619-644`) | Нет | Доменное различие (`people-tables.md:26`) |
| Поиск | Серверный, задержка 250 мс, лимит 100 символов (`:150-156, 307`) | Локальный (`:254`) | Доменное различие |
| Крошки на карточке | «Люди / Кандидаты / ФИО», `text-sm` (`cand/candidate-detail-client.tsx:168-176`) | «‹ {backLabel}», `text-[13px] font-medium`, hover `bg-accent` (`staffcard/staff-detail-page.tsx:688-696`) | Нужно решение владельца. Путь согласован со списком («Люди / Раздел») и показывает имя; у сотрудника «Назад» умеет возвращать на исходный экран (`backHref`). Предлагаю путь + сохранение `backHref` для первого сегмента |
| Рамка карточки | `mx-auto max-w-[1120px] px-6 md:px-8 pt-4 pb-8` (`:177`) | `px-6 md:px-8 pt-4 pb-8 w-full` (`:736`) | Ни один: `PageFrame` (дефект 15) |
| Полоса вкладок | Ручная обёртка `overflow-x-auto` + `min-w-max justify-center` (`:275-281`) | `ProfileTabsList` (`:795`) | Сотрудники: общий компонент |
| Ширина содержимого вкладки | `max-w-[720px] space-y-5` на самом `TabsContent` (`:282`) | Вложенный `div/form` `max-w-[720px] flex flex-col gap-5` (`:817, 1286`) | Любой один; проще вынести в `ProfileTabPanel` |
| Бейдж статуса в шапке | `StatusBadge`: `px-2 py-0.5 text-xs`, `bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` (`cand/fields.tsx:57`, `types.ts:36-43`) | Встроенный `span`: `px-2.5 py-0.5`, `bg-emerald-100 dark:bg-emerald-500/15`, текст `text-[12px]` (`:756-779`) | Общий компонент с тонами (дефект 18) |
| Действия в шапке профиля | Кнопка этапа + «⋯» в `ProfileHeader actions` (`:178-229`) | Пусто; «Восстановить» в топбаре (`:698-724`), увольнение во вкладке «Опасная зона» (`:805-810, 1451`) | Частично доменное. Несогласованно место разрушительного действия: «⋯» против вкладки. Записать правило в DS |
| Инфо-поповер в топбаре | Нет | `EntityInfoPopover` «О сотруднике» (`:726-733`) | Сотрудники по DS строка 342 (дефект 23) |
| Справка «?» на карточке | Есть (`page-help-registry.tsx:39`) | Нет (`:38`) | Кандидаты: справка должна быть доступна и на карточке |
| Режим правки | Чтение на странице + панель «Редактировать анкету» (`cand/candidate-form.tsx`) | Правка прямо на странице, «Сохранить» в подвале вкладки (`:1262-1276`) | Доменное: анкету заполняет кандидат, правят редко. Стоит записать в DS как два допустимых режима секций профиля |
| Подписи полей | `dt text-[13px] text-muted-foreground` в чтении; `label text-[13px] font-medium` в панели (`cand/fields.tsx:13`) | `Label text-[13px] font-medium` (`:903-905` и далее) | Оба 13px против 14px в DS и расписании. Нужно одно значение в DS |
| Подсказка под полем | `text-xs` (`cand/hire-drawer.tsx:383`, `cand/candidate-appointment-details.tsx:90`) | `text-[11px]` (`:999`) | Кандидаты: DS строка 164 |
| Обязательное поле | « *» текстом (`cand/hire-drawer.tsx:174`) | `<span className="text-destructive">*</span>` (`staff/staff-client.tsx:838`) | Сотрудники, плюс `aria-required` (дефект 30) |
| Ожидание на кнопке | Смена подписи: «Сохраняем…», «Оформляем…», «Удаляем…» (`cand/candidate-form.tsx:83`, `cand/hire-drawer.tsx:164-168`, `cand/candidate-delete-dialog.tsx:88`) | Спиннер `Loader2` перед подписью (`:1271-1273`, `staff/staff-client.tsx:930`) | Нужно одно правило в DS. Подпись не меняет ширину кнопки при спиннере слева и не требует иконки; предлагаю спиннер + неизменная подпись |
| Журнал | Ручной список в `ProfileSection` (`:444-527`) | `EntityAuditTab` (`:1425-1434`) | Сотрудники: общий компонент (дефект 19) |
| Диалог подтверждения удаления | `AlertDialog` `max-w-sm p-5 rounded-xl` (`cand/candidate-delete-dialog.tsx:45`) | `Dialog` (`:1497-1550`) | Общий `ConfirmDialog` (дефект 35) |
| Панель создания | `EditDrawer` везде | Сырой `Sheet` + `SheetContent sm:max-w-md` с вкладками (`staff/staff-client.tsx:796`) | Кандидаты: DS строка 152 |
| Код замка | Блок в строке (`:397-427`) | `Dialog` (`cand/staff-door-code.tsx`) | Сотрудники (дефект 21) |
| Аватар без фото | Одна буква 56px (`shared/profile-header.tsx:35-37`); в комментариях две буквы (`cand/candidate-comments.tsx:52`) | Одна буква | Одна буква везде |
| Нативный `title` | Нет | Есть: `title={c.name}` (`staff/staff-client.tsx:699`) | Кандидаты: DS строка 185 |

---

## Идеи

Это предложения, а не дефекты.

1. **Срок на текущем этапе.** В списке и в шапке карточки серый текст «3 дня на этапе» рядом со статусом; подсветка amber, если новая анкета лежит дольше порога. Польза: сразу видно забытые анкеты, сейчас для этого нужно сортировать по дате заявки. Данные есть в `candidate_events`. Объём: M (нужна колонка или вычисление на сервере).

2. **Шкала этапов в шапке карточки.** Пять точек «Новая → Можно рассмотреть → Собеседование → Стажировка → Принят» с отметкой текущего и пройденных этапов; отказ отдельным состоянием. Польза: понятно, где кандидат и что дальше, без раскрытия меню статуса; главная кнопка шапки становится очевидным «следующим шагом». Объём: M.

3. **Ближайшее назначение в списке.** Необязательный столбец или вторая строка под статусом: «Собеседование 19 ноя, 14:00». Польза: список становится рабочим планом на день, не нужно открывать каждую анкету. Объём: M (агрегат на сервере).

4. **Счётчики по этапам над таблицей.** Узкая строка сегментов с числами («Новые 6 · Можно рассмотреть 3 · Собеседование 2 · Стажировка 1»); клик включает фильтр статуса. Это вариант «нажатие показателя применяет фильтр» из `people-statistics-options.md:11`, который в итоговом «Обзоре» не реализован. Польза: быстрый разбор без открытия ряда фильтров. Объём: S-M.

5. **Время прохождения этапов в «Обзоре».** Небольшая горизонтальная диаграмма медианы дней между этапами (анкета → собеседование → стажировка → найм) за выбранный месяц. Польза: видно, где процесс тормозит; дополняет воронку, которая показывает только доли. Объём: M.

6. **Метка повторной анкеты в списке.** Маленький бейдж «Повторная» у имени, если есть другие анкеты с тем же телефоном (сейчас это видно только внутри карточки, `cand/candidate-detail-client.tsx:245-261`). Объём: S-M.

7. **Причина отказа.** При выборе «Не подходит» короткий диалог с выбором причины и комментарием (по правилу DS строка 177). Польза: появляется статистика причин отказа, журнал становится осмысленным. Объём: M (нужно поле в БД).

8. **Просмотр фото внутри карточки.** Открытие изображений в лайтбоксе с перелистыванием вместо новой вкладки (`cand/candidate-detail-client.tsx:347-356`); там же удаление файла, которого сейчас нет. Объём: M.

9. **Сводка наблюдений в строке собеседования.** После заполнения результата показывать под датой 2-3 коротких метки («Пунктуален», «Улыбался»). Польза: итог виден без открытия панели. Объём: S.

10. **Канбан по этапам как второй вид списка.** Колонки по статусам, перетаскивание меняет этап (с той же формой назначения для собеседования и стажировки). Польза: привычный вид для подбора при 20-50 активных анкетах. Объём: L.

11. **Быстрые контакты в мобильной карточке.** Кнопки «Позвонить» и «Написать в Telegram» в карточке списка. Польза: главный сценарий с телефона. Объём: S.

12. **Общие компоненты по итогам аудита.** `DrawerField` (подпись + поле + обязательность + подсказка), `StatusBadge` с тонами, `ConfirmDialog`, `ProfileValue`, компонент пути для топбара, встроенный баннер с тонами. Польза: закрывает дефекты 5, 17, 18, 29, 30, 35 и убирает причину расхождений между модулями. Объём: M.

---

## Не проверено

- Внешний вид на экране: приложение не запускалось, скриншоты не снимались. Все выводы сделаны по коду.
- Наследование `font-weight` значениями полей внутри `label` (дефект 29): вывод из сброса Tailwind v3 и из того, что авторы местами явно ставят `font-normal`; на экране не подтверждено.
- Расчёт отступа 20px вместо 36px в форме анкеты (дефект 33): выведен из специфичности селектора `space-y-*`, в браузере не измерялся.
- Контраст бейджей и баннеров в тёмной теме: проверено только наличие `dark:`-вариантов.
- Соответствие макету `sheerly.pen` (узлы `Q4FzoZ`, `iBlPv`): файл не открывался.
- Содержимое `TableSortSettings`, `TableColumnManager`, `DateRangeFilter`, `MonthPicker`, `people-overview.module.css`: просмотрены выборочно, отдельный аудит не проводился.
- Может ли журнал событий быть пустым (у импортированных анкет) и как тогда выглядит вкладка: пустого состояния в коде нет, наличие таких данных не проверялось.
- Может ли анкета реально находиться в архиве на проде (дефект 28): интерфейса архивации нет, данные не проверялись.
- Переполнение на 375px: по коду рисков горизонтальной прокрутки страницы не найдено (везде `min-w-0`, перенос рядов, мобильные карточки), на устройстве не проверялось. Потенциальное место: таблица ставок в панели найма (`cand/hire-drawer.tsx:235-262`, своя прокрутка внутри блока).
- Серверные действия, RPC и права доступа: вне области аудита.
