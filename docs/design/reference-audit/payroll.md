# Аудит UI/UX: модуль «Зарплата»

Только чтение кода, без запуска. Все ссылки — от корня worktree. Сокращения путей:

- `concept/` = `src/app/payroll-concept/` (папка компонентов **без** `page.tsx`)
- `pp/` = `src/app/(dashboard)/people/payroll/_components/`
- `kit/` = `src/components/shared/table/`
- `DS` = `docs/design-system.md`

**Как устроены маршруты (важно для чтения остального).** Рабочий экран зарплаты — это `/payroll-concept`, а не прототип:

1. `/people/payroll` → `src/app/(dashboard)/people/payroll/page.tsx:15` делает `redirect("/payroll-concept?…")` с сохранением query.
2. `/payroll-concept` → `src/app/(dashboard)/payroll-concept/page.tsx:24-31` грузит `loadPayrollOverview()` и рендерит `PayrollConcept` из `concept/payroll-concept.tsx`.
3. Пункт меню «Зарплата» имеет `href: "/people/payroll"`, но `navigationHref: "/payroll-concept"` (`src/components/shared/sidebar.tsx:132`), а подсветка активного пункта держится на подмене pathname (`sidebar.tsx:507-508`).
4. Страница сотрудника живёт по «старому» адресу `/people/payroll/[employeeId]` (`src/app/(dashboard)/people/payroll/[employeeId]/page.tsx`) и ссылается назад на `/payroll-concept` (`pp/employee-payroll-page.tsx:61`).
5. Настройки оплаты (`PayrollSettings`) показываются не в разделе «Зарплата», а в карточке заведения (`src/app/(dashboard)/org/venues/[venueId]/payroll/page.tsx:26`, `venue-detail-page.tsx:497`); оплата должности (`RoleCompensation`) — в карточке должности (`people/roles/[roleId]/_components/role-detail-page.tsx:591`); сверка отметок (`AttendanceReview`) — в `/schedule/attendance` (`schedule/attendance/attendance-client.tsx:30`).

---

## Инвентарь

| Параметр | Список `/payroll-concept` | Сотрудник `/people/payroll/[id]` | Настройки (заведение / должность) |
|---|---|---|---|
| Внешняя рамка | `PageFrame` внутри `.app.embedded > .main` (`concept/payroll-concept.tsx:445,462-463`); 1580 px, `38px 42px 20px`; ≤1150 `30/26/18`; ≤480 `27/16/18`; ≥1500 верх 45 (`src/components/shared/page-frame.module.css:1-4`) | `PageFrame className={s.page}` (`pp/employee-payroll-page.tsx:58`) | своей рамки нет, встроены в чужие страницы; секции `rounded-xl border p-5` (`pp/payroll-settings.tsx:71,73`), карточка должности `border-radius:16px` (`pp/role-compensation.module.css:1`, `.card`) |
| Вертикальные отступы между блоками | вручную: `.contextBar` 24/24 (`concept/payroll-concept.module.css:1825-1828`), `.tabs` mt 29 (`:398`), `.analytics` 23/28 (`:443`), `.ledger` mt 24 (`:639`) | `.heading` mb 24, `.workspace` mt 24 (`pp/employee-pay.module.css:2,7`) | `space-y-6` (`pp/payroll-settings.tsx:66`) |
| h1 | 40px / 700 / −0.5px; ≤480px — 32px (`concept/payroll-concept.module.css:1816-1821, 1978-1980`) | 28px / **550** / −0.8px; ≤639px — 23px (`pp/employee-pay.module.css:3,30`) | h2 22px/550 (`pp/role-compensation.module.css:1`, `.top h2`); секции `h2 font-semibold` 16px либо `font-medium` (`pp/payroll-setup.tsx:57`, `pp/legacy-payments.tsx:30`) |
| Подзаголовок | нет | должность 13px muted (`pp/employee-pay.module.css:4`) | 12px muted (`.top p`) |
| Хлебные крошки | `PageBreadcrumb` → `<div class=breadcrumb>`: «Люди» (ссылка на `/people/staff`) / «Зарплата», 13px, gap 17px, без `<nav>` (`concept/payroll-concept.tsx:446-452`, css `:247-260`) | `PageBreadcrumb` → ссылка «← Зарплата» `text-sm`, `ArrowLeft size-4`, на `/payroll-concept?month=` (`pp/employee-payroll-page.tsx:59-67`) | — |
| Справка в топбаре | своя кнопка `.iconButton` через `PageHeaderActions` → центр. Dialog «От смены до зарплаты» (`concept/payroll-concept.tsx:453-461, 1114-1171`). Общий `PageHelpButton` не срабатывает: реестр матчит только `/people/payroll*` (`src/app/(dashboard)/_components/page-help-registry.tsx:45`) | общий `PageHelpButton` → `EditDrawer` с `PayrollHelp` (`page-help-button.tsx:39`, `pp/payroll-help.tsx`) | — |
| Период | `PeriodStepper` (h-9, `rounded-lg`, brand-tint) + самодельный поповер месяцев `.monthPicker` 280px r12 (`concept/payroll-concept.tsx:470-533`, css `:1582-1631`) | общий `MonthPicker variant="field"` h-10 (`pp/employee-payroll-page.tsx:104-115`) | `DateRangeFilter monthOnly` (`pp/payroll-initial-data.tsx:54`), `MonthPicker field` (`pp/payroll-setup.tsx:63`) |
| KPI-плитки | `.metrics`: одна поверхность, 4 колонки `1.25fr 1fr 1.1fr 1fr`, r12, ячейка `22px 24px`, min-h 132, число 30px/600, «₽» отдельным muted-span 20px, подпись 12px (`concept/payroll-concept.module.css:325-345, 1829-1863`); 2×2 по container query ≤950px (`:2232-2243`) | `.stats`: r14, ячейка 24px, число 28px/**500**, «₽» внутри строки (`pp/employee-pay.module.css:8-14`); 2×2 ≤1100px (`:42-43`) | — |
| Табы | самодельные `<button role="tab">` (`concept/payroll-concept.tsx:605-624`): 14px, gap 27px, активный — `foreground` + brand-полоска псевдоэлементом (`css :393-434, 1864-1875`); ≤540px — сетка 2 колонки (`:2268-2281`) | общий `Tabs` + `workspace-tabs.module.css`: 13px/450, gap 24, активный — текст и полоска brand, 550 (`pp/employee-pay.tsx:88-89`, `src/components/shared/workspace-tabs.module.css:1-5`) | в панелях — общий `Tabs`, перекрашенный `pp/payroll-detail-dialog.module.css:24-27` (12px/450) |
| Компонент таблицы | `PayrollTable` (`pp/payroll-table.tsx`) = TanStack + `ResizableTableHead` + `TableControls` + `TableColumnManager` + `TablePagination` + `useTableState`; обёртки `PayrollLedger`, `PayrollPaymentsTable`, `PayrollJournal` | тот же `PayrollTable` (`pp/employee-pay.tsx:90-92`) | списки на `grid`/`divide-y`, не таблицы |
| Высота шапки / строки | шапка 44px (`h-11`, `kit/table-head.tsx:73`), `th px-3 py-3`, 12px medium; строка не задана: `td` 16px со всех сторон (`pp/payroll-table.tsx:296`, `concept/payroll-concept.module.css:2086-2088`; ≤700px — 13px `:2167-2169`) → с ячейкой сотрудника ≈72px (расчёт: 20+4+16 текста + 32) | то же, без `.functionalTable` | — |
| Шрифт таблицы | 13px тело, 12px шапка (`pp/payroll-table.tsx:296`) | то же | — |
| Радиус / фон карточки таблицы | `overflow-hidden rounded-xl border` = 12px, без `bg-card` на обёртке (`pp/payroll-table.tsx:281`); фон только у `<table>` внутри `.functionalTable` (`css :2078-2081`) | 12px, без `bg-card` вовсе | — |
| Sticky-шапка | выключена: `.functionalTable thead { position: static }` (`concept/payroll-concept.module.css:2179-2181`) | `sticky top-0` из kit, но внутри `overflow-x-auto` (`pp/payroll-table.tsx:285-291`) — к окну не липнет | — |
| Drawer (`EditDrawer`) | не используется | только справка из топбара | `pp/payroll-setup.tsx:93`; `pp/attendance-review.tsx:379`; мёртвый `pp/payroll-client.tsx:554` |
| «Панель» `PayrollDetailDialog` (Dialog, оформленный как правая панель 560px, r20, отступ 12px, без анимации — `pp/payroll-detail-dialog.module.css:53-64`) | выплата (`concept/payroll-concept.tsx:1093`), премия/штраф/надбавка (`concept/payroll-journal.tsx:721`), карточка записи (`:352`), карточка выплаты (`pp/payroll-payments-table.tsx:189`), перенос (`concept/payroll-transfer-drawer.tsx:47`) | начисления за месяц, расчёт смены, условия, выплата (`pp/employee-pay.tsx:95,101,108,110`), вложенная панель условий (`pp/employee-pay-conditions.tsx:67`) | стаж (`pp/payroll-experience-policy.tsx:48`), оплата должности (`pp/role-compensation.tsx:110`) |
| Центральные Dialog | 3 шт. с классом `.dialog` (520px, r16, p30, заголовок 23px/550 — `concept/payroll-concept.module.css:963-986`): быстрый просмотр сотрудника / «Состав начислений» (`concept/payroll-concept.tsx:886`), «Удалить выплату?» (`:1047`), справка (`:1114`); просмотр фото `max-w-3xl` (`concept/payroll-journal.tsx:586`) | — | — |
| Подсказки | `data-tip` — 6 мест (`concept/payroll-concept.tsx:567,586`; `concept/payroll-ledger.tsx:81`; `concept/payroll-journal.tsx:251,252,365`); `IconTooltip` не используется; нативного `title` нет; у кнопок тулбара — Radix `Tooltip` из kit (`kit/table-controls.tsx:280-298`) | — | — |
| Select | `Select`: `concept/payroll-journal.tsx:301,315,811,836`; `concept/concept-payment-form.tsx:148`; `pp/employee-pay-conditions.tsx:70,72`; `pp/role-compensation.tsx:116` | | `OptionSelect` + экспортируемый `selectClass` (`pp/employee-pay.tsx:22`): `pp/payroll-settings.tsx:117,146,160`; `pp/payroll-setup.tsx:151,186,207`; `pp/legacy-payments.tsx:45,59`; `pp/payroll-context.tsx:114,126`; `pp/automation-settings.tsx:462,498,597`; `pp/discipline-settings.tsx:175`; сортировка в `pp/payroll-table.tsx:220` |
| Дата / месяц | `DatePicker` везде; месяц — три реализации (см. дефект 18) | | |
| Нативные контролы | `<select>`, `type=date/time/month` — **нет**. Есть: `<input type="checkbox">` (`concept/payroll-journal.tsx:329-333`), сырой `<textarea>` (`concept/concept-payment-form.tsx:266`, `pp/payroll-settings.tsx:102`), `type="number"` ~14 мест (`concept/concept-payment-form.tsx:222`; `concept/payroll-journal.tsx:783,859`; `pp/role-compensation.tsx:33`; `pp/employee-pay-conditions.tsx:73`; `pp/payroll-setup.tsx:74,170`; `pp/automation-settings.tsx:45,396`; `pp/discipline-settings.tsx:112,196,280,294`) | | |
| Произвольные размеры шрифта | CSS-модули модуля: 28 разных значений. Частоты: 9px×7, 10px×38, 11px×59, 12px×82, 13px×56, 14px×17, 15px×8, 16px×7, 17px×6, далее 18–42px (20,21,22,23,24,25,26,27,28,29,30,32,33,34,37,38,40,42). В TSX: `text-[13px]`×5, `text-[11px]`×2 | | |
| Веса шрифта вне шкалы | 450×2, 550×20, 650×1 (шкала DS: 400/500/600/700) | | |
| Радиусы | 14 разных: 2,3,4,5,6,7,8,9,10,11,12,14,16,20px (шкала DS: 0/6/8/10/12/14/pill) | | |
| Жёстко заданные цвета | в рабочем CSS: 2 hex в тенях (`concept/payroll-journal.module.css:68` `#00000008`; `pp/payroll-detail-dialog.module.css:63` `#00000014`) + 1 fallback-hsl, который срабатывает всегда, т.к. `--success` в `globals.css` не определён (`concept/payroll-journal.module.css:19`). В `payroll-preview.module.css` ещё 3 (`:6,37,46`). В TSX hex — 0. Палитра Tailwind: emerald/amber в 4 файлах (см. дефект 13) | | |
| Тёмная тема | почти весь CSS на `hsl(var(--token))` — покрытие хорошее; исключения перечислены строкой выше | | |

---

## Что сделано хорошо и стоит закрепить

1. **Переключатель периода `PeriodStepper`** — `src/components/shared/period-stepper.tsx:7-26`, применение `concept/payroll-concept.tsx:470-475`. Правило: «период страницы — капсула h-9 `rounded-lg border-brand/20 bg-brand/[0.06]`: стрелки по краям шагают на один период, центр открывает выбор; у стрелок `aria-label` с названием шага».
2. **Тулбар таблицы порталом в строку периода с зарезервированной высотой** — цель `concept/payroll-concept.tsx:534-537`, резерв `concept/payroll-concept.module.css:2048-2054` (40px) и `:2153-2157` (76px на телефоне), портал `pp/payroll-table.tsx:68-73, 271-275`. Правило: «если контролы таблицы вынесены из таблицы, место под них резервируется `min-height`, чтобы страница не прыгала при гидратации и смене таба».
3. **KPI-полоса одной поверхностью** — `concept/payroll-concept.tsx:539-604`, `concept/payroll-concept.module.css:325-352, 1829-1863`. Правило: «итоги периода — одна карточка с вертикальными разделителями, не четыре отдельные; главный показатель первым, с brand-подложкой и раскрытием состава по клику; знак валюты — отдельным muted-span меньшего кегля; число `tabular-nums`».
4. **Раскладка KPI по container query, а не по viewport** — `concept/payroll-concept.module.css:2229-2243`. Правило: «сетки, зависящие от ширины контента (сайдбар может быть свёрнут), переключаются через `@container`».
5. **«Неизвестно» ≠ ноль** — `concept/payroll-concept.tsx:565-593`, `concept/payroll-ledger.tsx:73-85`. Правило: «недостоверную сумму показываем прочерком с объяснением причины, никогда нулём» (оговорка о доступности объяснения — дефект 3).
6. **Единая ячейка сотрудника `EmployeeIdentity`** — `src/components/shared/employee-identity.tsx:17-44`: аватар 36px, имя 13px/500, должность 11px muted, fallback на инициалы при ошибке загрузки. Правило: «в денежных таблицах и пикерах сотрудник всегда рисуется этим компонентом».
7. **Пикер сотрудников `PayrollEmployeePicker`** — `pp/payroll-employee-picker.tsx:24-49`: одиночный и множественный режим, поиск по имени и должности, список монтируется в панель (`portalContainer`, `:33`), чтобы работала прокрутка под scroll-lock. Правило: «список внутри модального окна монтируется в само окно».
8. **Закреплённый подвал формы с бегущим итогом** — `concept/concept-payment-form.tsx:115-141` (`aria-live="polite"`), `concept/payroll-journal.tsx:729-737`. Правило: «в форме с несколькими суммами итог живёт в подвале рядом с главной кнопкой; на время запроса кнопка меняет подпись на „Сохраняем…“».
9. **Кликабельная строка с настоящей кнопкой в первой ячейке** — `pp/payroll-table.tsx:348-362` (`aria-label="Открыть …"`). Правило: «строка, открывающая карточку, обязана иметь фокусируемую кнопку/ссылку в первой ячейке; одного `onClick` на `<tr>` недостаточно».
10. **Удалённые записи остаются в журнале** — зачёркнутая сумма и «· Удалено» (`concept/payroll-journal.tsx:241-251`), переключатель «Показывать удалённые» (`:328-335`), статус «Удалена» в выплатах (`pp/payroll-payments-table.tsx:144-152`). Правило: «мягко удалённая денежная запись видна по фильтру и визуально отличима, а не исчезает».
11. **Знак суммы типографским минусом** — `concept/payroll-ledger.tsx:99-103`, `concept/payroll-journal.tsx:96` (`−` U+2212, `+` для прибавок). Совпадает с `formatSignedMoney` (`src/lib/format/amount.ts:96`) — стоит закрепить одной функцией.
12. **Поля ввода 16px на телефоне** — `concept/concept-payment-form.module.css:363-367, 480-483`; соответствует `docs/mobile-web.md` §2.
13. **`prefers-reduced-motion`** — `concept/payroll-concept.module.css:1574-1581`, `concept/concept-payment-form.module.css:397-401`. В DS правила нет — стоит добавить.
14. **График на токенах** — `concept/payroll-concept.tsx:667-742`: заливка и линия через `hsl(var(--brand))`, сетка через `--border`, точка с обводкой `--card`; работает в обеих темах без отдельной палитры.
15. **Строка условия оплаты `CompensationRow` / `CompensationRates`** — `pp/compensation-summary.tsx:6-23`: иконка, название, подсказка, значение справа, действие «Настроить» с `aria-label`. Правило для «настройка = строка с текущим значением + открытие панели».
16. **Версионирование условий с причиной** — «Действует с» + «Причина изменения» в каждой панели (`pp/role-compensation.tsx:128`, `pp/employee-pay-conditions.tsx:70`, `pp/payroll-experience-policy.tsx:52-53`). Правило для любых настроек, влияющих на деньги.

---

## Дефекты

### P1

1. **[P1] Удаление выплаты со страницы сотрудника — без подтверждения, уведомления и обработки ошибки**
   - Где: `pp/employee-pay.tsx:92` (`onCancel={async (id) => { await cancelPayrollPayment(id); await onChange(); }}`), вызывается из меню «Удалить выплату» `pp/payroll-payments-table.tsx:134-137` через `void onCancel(...)`.
   - Что сейчас: клик в меню сразу удаляет выплату и связанную финансовую транзакцию; панель закрывается; тоста нет; исключение уходит в необработанный rejection.
   - С чем расходится: на списке то же действие открывает Dialog «Удалить выплату?» с destructive-кнопкой и тостом (`concept/payroll-concept.tsx:858-860, 1047-1092`); DS:175-177 — любое необратимое действие из панели через Dialog.
   - Как исправить: вынести диалог подтверждения и `run()` в `PayrollPaymentsTable` (или общий `ConfirmPaymentDelete`), чтобы оба экрана получали его одинаково.

2. **[P1] Две разные справки; на списке — самодельная, на странице сотрудника — устаревшая**
   - Где: `page-help-registry.tsx:44-48` матчит `/people/payroll*`, а список живёт на `/payroll-concept` → общий «?» там не появляется; вместо него `concept/payroll-concept.tsx:453-461` + Dialog `:1114-1171`. На `/people/payroll/[id]` показывается `pp/payroll-help.tsx`.
   - Что сейчас: `PayrollHelp` описывает элементы, которых в рабочем экране нет: колонку «Заработано» (`:11,16`; в ведомости «Начислено» — `concept/payroll-ledger.tsx:15`), кнопки «Обновить» и «Закрыть месяц» (`:45,51`; есть только в мёртвом `pp/payroll-client.tsx:280,297`), «откройте сотрудника и нажмите Перенести остаток» (`:34`; на странице сотрудника такого действия нет — `pp/employee-pay.tsx:78`), «откроется отдельная страница» (`:20`; на деле открывается Dialog — `concept/payroll-concept.tsx:870-874`).
   - С чем расходится: единый реестр справки (`page-help-registry.tsx:16-27`), `docs/design/people-tables.md:13`.
   - Как исправить: добавить `/payroll-concept` в `match` (или убрать редирект, см. «Мёртвый код»), удалить самодельную кнопку и Dialog, переписать `PayrollHelp` под текущий экран; текст «От смены до зарплаты» перенести туда первым блоком.

3. **[P1] Объяснение прочерка «—» недоступно с клавиатуры и с телефона**
   - Где: `concept/payroll-concept.tsx:565-575, 584-594`; `concept/payroll-ledger.tsx:78-84`.
   - Что сейчас: причина («Прежние выплаты пока не учтены…», «Остаток появится после уточнения…») живёт только в `data-tip` на нефокусируемом `<span>`. `GlobalTooltip` показывает подсказку по `pointerover`/`focusin` и прячет по `pointerdown` (`src/components/ui/global-tooltip.tsx:105-109`) — на тач-экране она не успевает показаться, с клавиатуры до неё не дойти.
   - С чем расходится: DS:179-185 (подсказка не заменяет доступный текст); это единственное объяснение того, почему главный показатель страницы пуст.
   - Как исправить: под KPI выводить строку `small` с причиной (место уже есть — `:577-579`), в ячейке таблицы — кнопку-иконку `IconTooltip` с `aria-label`, либо одну плашку над таблицей со ссылкой на «Первоначальные данные».

4. **[P1] Главные табы страницы — самодельные, с неполной семантикой**
   - Где: `concept/payroll-concept.tsx:605-624`.
   - Что сейчас: `<div role="tablist">` + `<button role="tab" aria-selected>`; нет `aria-controls`, нет `role="tabpanel"` у содержимого, все три кнопки в tab-порядке, стрелки не работают.
   - С чем расходится: общий `Tabs` (Radix) всё это даёт (`src/components/ui/tabs.tsx`); соседняя страница сотрудника использует его (`pp/employee-pay.tsx:88-89`).
   - Как исправить: заменить на `<Tabs className={tabStyle.tabs}>` с `workspace-tabs.module.css`; счётчик оставить `<span>` внутри `TabsTrigger`.

### P2

5. **[P2] Три визуальных варианта табов в одном модуле**
   - Где/что: список — 14px, активный `foreground`, полоска brand (`concept/payroll-concept.module.css:1864-1875`); сотрудник — 13px/450→550, активный текст brand (`workspace-tabs.module.css:2-3`); панели — 12px/450 (`pp/payroll-detail-dialog.module.css:25-26`); плюс четвёртый — `.employeeTabs` в быстром просмотре, кнопки без `role` (`concept/payroll-concept.tsx:928-948`, css `:1656-1687`).
   - С чем расходится: DS:231 (общий `Tabs`: активный `border-foreground`), DS:816 (`workspace-tabs.module.css`).
   - Как исправить: один стиль рабочих табов (`workspace-tabs`) для страниц, его уменьшенный вариант для панелей — модификатором того же файла, а не копией селекторов.

6. **[P2] Отступы шапки и тела таблицы не совпадают: 12px против 16px**
   - Где: `kit/table-head.tsx:83` (`th px-3`) и `pp/payroll-table.tsx:296` (`[&_tbody_td]:px-4`), дубль `concept/payroll-concept.module.css:2086-2088`. Класс `px-3 py-4` на самом `td` (`pp/payroll-table.tsx:343`) перекрыт и мёртв.
   - Что сейчас: заголовок столбца смещён на 4px относительно значений — и слева («Сотрудник»), и справа (все суммы).
   - С чем расходится: `people-table.module.css:23` — 12px, совпадает с шапкой.
   - Как исправить: 12px в теле (как у людей) либо параметр отступа в `ResizableTableHead`.

7. **[P2] Карточка таблицы: радиус 12, нет `bg-card`, липкая шапка отключена**
   - Где: `pp/payroll-table.tsx:281`; `concept/payroll-concept.module.css:2179-2181`.
   - С чем расходится: DS:468-474 (`rounded-lg border bg-card`), DS:704-716 (все table-card → 8), DS:718-742 (sticky обязателен), `people-table.module.css:5-7`.
   - Как исправить: `rounded-lg bg-card`; для sticky — тот же контейнер с `max-height` и общим скроллом, что у людей (режим `contained` в `PayrollTable` уже есть — `:289`, но рабочие экраны передают `scrollMode="page"`).

8. **[P2] Своя сортировка вместо общей**
   - Где: `pp/payroll-table.tsx:132-146` (цикл), `:162-241` (панель), `:85-89` (сортировка по умолчанию навязывается при каждом монтировании).
   - Что сейчас: клик по заголовку заменяет сортировку, уровень добавляется только Shift+клик (на телефоне недоступно); панель с кнопками-глифами «↓ ↑ ×» без размеров (≈10×20px); по умолчанию всегда активна сортировка (`earned desc`, `date desc`).
   - С чем расходится: `kit/README.md:32` (клик по заголовку сохраняет существующие сортировки), DS:507 (нет сортировки по умолчанию), DS:520 и 824 (`useMultiSort`, `TableSortSettings`); у сотрудников — `staff-table.tsx:494-510, 611-622`.
   - Как исправить: `useMultiSort` + `TableSortSettings` + sort-пин; дефолтный порядок отдавать данными, а не состоянием сортировки.

9. **[P2] Фильтры в обход чипов и пинов**
   - Где: `concept/payroll-concept.tsx:281-294` (`.roleFilter`), `:823-832` (`.appliedFilter` «{role} ×»: 11px, r5, `4px 9px` — css `:901-920, 1886-1891`); журнал — поповер с двумя `Select` и нативным чекбоксом (`concept/payroll-journal.tsx:296-338`), активные условия нигде не видны.
   - С чем расходится: DS:235 (`TableControlPin` — единственный пин), DS:248-254 (в списке вариантов нет заголовка, выбранный — `bg-accent` + `Check size-3.5`), `kit/README.md:28` (кнопка фильтра раскрывает ряд пинов, а не поповер), `people-tables.md:19`.
   - Как исправить: `TableFilterChip` для «Должность», «Сотрудник», «Тип записи», «Удалённые»; сброс — «Очистить все».

10. **[P2] На телефоне все таблицы — горизонтальная прокрутка ~1000px**
    - Где: `pp/payroll-table.tsx:42,78,297` — `minWidth = max(600, сумма ширин)`; в ведомости по умолчанию 7 столбцов: 220 + 6×130 = 1000px (`concept/payroll-ledger.tsx:25`). Проп `mobileCards` есть (`pp/payroll-table.tsx:44,388-399`), включён только в сверке отметок (`pp/attendance-review.tsx:331`).
    - С чем расходится: `people-tables.md:24,28` — до 640px карточки, без горизонтальной прокрутки.
    - Как исправить: включить `mobileCards` в ведомости, выплатах, журнале и сменах; в карточке — имя, «Начислено», «К выплате», остальное по настройке столбцов.

11. **[P2] Одна и та же сумма форматируется по-разному**
    - Где: 8 локальных форматтеров (`concept/payroll-concept.tsx:56-59`; `concept/payroll-ledger.tsx:28`; `concept/payroll-journal.tsx:76`; `concept/payroll-transfer-drawer.tsx:19`; `pp/employee-pay.tsx:23`; `pp/role-compensation.tsx:25`; `pp/compensation-summary.tsx:21`; `pp/employee-pay-conditions.tsx:65`) плюс `money` из `src/lib/sales/format.ts`.
    - Что сейчас: ведомость — целые без «₽» (`120 000`); KPI списка — целые, «₽» отдельно; страница сотрудника — до двух знаков с «₽» (`120 000,5 ₽`), пустое значение — «Нет данных»; выплаты — до двух знаков, «₽» muted.
    - С чем расходится: `src/lib/format/amount.ts:77-98` (`formatMoney`, `formatSignedMoney`).
    - Как исправить: один форматтер для модуля; решить единожды, показывать ли копейки и знак валюты в таблицах.

12. **[P2] Цвета знаковых сумм — три зелёных и три красных, ни один не из `signedAmountClass`**
    - Где: ведомость `.bonus/.deduction` → `--palette-green-fg` / `--palette-red-fg` (`concept/payroll-concept.module.css:1896-1901`, `concept/payroll-ledger.tsx:92-95`); журнал `.positive` → `hsl(var(--success, 150 65% 35%))` — переменной нет, цвет всегда один и тот же в обеих темах; `.negative` → `--destructive` (`concept/payroll-journal.module.css:18-25`); макет — `hsl(155 62% 31%)` (`payroll-preview.module.css:37`).
    - С чем расходится: DS:73-77 — единственный источник `signedAmountClass` (`src/lib/format/amount.ts:110-115`).
    - Как исправить: заменить все четыре места на `signedAmountClass(value)`.

13. **[P2] Статусные бейджи — три палитры**
    - Где: `PaymentStatus` — `bg-emerald-500/10 text-emerald-700 dark:text-emerald-400`, без рамки (`pp/payroll-payments-table.tsx:147`); сверка — то же + `bg-amber-500/10 text-amber-800` (`pp/attendance-review.tsx:258-264`); «Удалено» / «Выплачена» — `bg-muted` (`concept/payroll-journal.tsx:361-362`); и только «Не отправлено в чат» — по DS (`:364`).
    - С чем расходится: DS:609-622, `src/components/shared/inventory-status-badge.tsx:24-61`.
    - Как исправить: общий `StatusBadge` с тонами success/warning/neutral по таблице DS.

14. **[P2] `PayrollDetailDialog` — вторая реализация боковой панели**
    - Где: `pp/payroll-detail-dialog.tsx`, `pp/payroll-detail-dialog.module.css:53-70`.
    - Что сейчас против `EditDrawer` (`src/components/ui/edit-drawer.tsx:63-100`): ширина 560 против 520; радиус 20 и отступ 12px от края против «без скругления, вплотную»; заголовок 23px/550 против 18px/600; поля тела 30px против 24px; `animation: none` против slide 200/150мс; тень `-12px 0 60px #00000014` (hex, вне 4 уровней); крестик — стандартный диалоговый 16×16 (`dialog.tsx:76-78`) против 32×32; в подвале только главная кнопка, «Отмена» нет (`concept/payroll-journal.tsx:734`, `concept/payroll-transfer-drawer.tsx:49`, `pp/role-compensation.tsx:111` и др.); сумма на цветной плашке `bg brand/.06` (`:20`) — прямо запрещено DS:170.
    - С чем расходится: DS:152-154, 165, 170, 771 — и одновременно DS:816 называет `PayrollDetailDialog` общим компонентом (противоречие, см. ниже).
    - Как исправить: принять решение один раз. Либо панель зарплаты становится пресетом `EditDrawer` (520, блоки `DrawerSummaryTotal`, `DrawerSection`), либо DS официально описывает «плавающую панель» и на неё переезжают все. Сейчас в одном модуле обе: `EditDrawer` в `pp/payroll-setup.tsx:93`, `pp/attendance-review.tsx:379` и в справке, панель — в 12 местах.

15. **[P2] Удаление записи журнала и отмена переноса — внутри панели, не через Dialog**
    - Где: `concept/payroll-journal.tsx:384-409` (блок с причиной и кнопками «Удалить» / «Отмена» в теле панели, destructive первой); `concept/payroll-transfer-drawer.tsx:76` («Отменить перенос» срабатывает сразу).
    - С чем расходится: DS:175-177 — «даже если нужно указать причину: Dialog по центру».
    - Как исправить: Dialog «Удалить штраф?» с полем «Причина» и кнопкой «Удалить штраф»; для переноса — Dialog «Отменить перенос?».

16. **[P2] На странице сотрудника нет «Перенести остаток»**
    - Где: меню «Добавить» `pp/employee-pay.tsx:78` — «Выплата», «Надбавка за месяц», «Премия / штраф».
    - С чем расходится: `docs/payroll.md:91` («доступно также из краткого расчёта выбранного сотрудника»), справка `pp/payroll-help.tsx:34`; на списке пункт есть (`concept/payroll-concept.tsx:318-320`). Порядок пунктов тоже разный: на списке «Выплата → Премия / штраф → Надбавка».
    - Как исправить: один компонент меню «Добавить» для обоих экранов с предвыбранным сотрудником.

17. **[P2] Заголовок и шапка: 40px на списке против 30px у сотрудников и 28px/550 у сотрудника зарплаты**
    - Где: `concept/payroll-concept.module.css:1816-1821`; `kit/table-page-header.tsx:33` (`text-3xl font-bold`); `pp/employee-pay.module.css:3`; общий `ProfileHeader` — 28px bold, аватар 56px, инициал один, на `bg-muted` (`src/components/shared/profile-header.tsx:30-45`), а здесь портрет 52px, два инициала на brand-подложке (`pp/employee-pay.module.css:5`, `pp/employee-payroll-page.tsx:69-79`).
    - С чем расходится: `people-tables.md:14`, DS:818.
    - Как исправить: список — `TablePageHeader` (30px) либо зафиксировать 40px для всех эталонов; сотрудник — `ProfileHeader`.

18. **[P2] Три выбора месяца**
    - Где: самодельный поповер на списке (`concept/payroll-concept.tsx:476-532`, выбранный — `bg-brand/10 text-brand`); общий `MonthPicker` (`src/components/shared/month-picker.tsx`, выбранный — `bg-brand text-white`, 256px); `DateRangeFilter monthOnly` в настройках (`pp/payroll-initial-data.tsx:54`).
    - С чем расходится: DS:264; `docs/payroll.md:37` утверждает, что зарплата использует `DateRangeFilter` — уже неверно.
    - Как исправить: в `PeriodStepper` класть `MonthPicker variant="toolbar"` (вариант уже есть — `month-picker.tsx:54-55`); в настройках — тот же `MonthPicker`.

19. **[P2] Две реализации KPI-плиток с разными подписями**
    - Где: `.metrics` (r12, 30px/600) и `.stats` (r14, 28px/500) — см. инвентарь. Подписи: «К выплате» (`concept/payroll-concept.tsx:582`) против «Осталось выплатить» (`pp/employee-pay.tsx:83`); «Начислено команде» / «Начислено».
    - Как исправить: общий компонент `MetricStrip`; термин — «К выплате» везде.

20. **[P2] Ввод денег тремя способами**
    - Где: `type="number"` (`concept/concept-payment-form.tsx:222`, `concept/payroll-journal.tsx:783,859`, `pp/role-compensation.tsx:33` и др.); текст с `inputMode="decimal"` и ручным разбором (`concept/payroll-journal.tsx:430-433`, `concept/payroll-transfer-drawer.tsx:64`); `AmountInput` из финансов (`pp/experience-scale-editor.tsx:151`).
    - Что сейчас: в одном поле запятая и пробелы разрядов принимаются, в соседнем — нет; у `type=number` колесо мыши меняет значение.
    - Как исправить: `AmountInput` (`src/components/finance/amount-input.tsx`) во всех денежных полях.

21. **[P2] Подписи без связи с полем**
    - Где: `<Label>` без `htmlFor` рядом с `Select` / `DatePicker` / пикером: `concept/payroll-journal.tsx:300,314`; `concept/payroll-transfer-drawer.tsx:56,60`; `pp/employee-pay-conditions.tsx:70` (дважды), `:72`; `pp/role-compensation.tsx:116,128`; `pp/payroll-setup.tsx:62`; `pp/payroll-context.tsx:113,125`; `pp/automation-settings.tsx:390`. В `concept/concept-payment-form.tsx:265-268` у textarea одновременно `Label htmlFor` и другой `aria-label` — доступное имя не совпадает с видимым.
    - Как исправить: `htmlFor` + `id` на триггере; лишний `aria-label` убрать.

22. **[P2] Мелкий текст 9–10px в рабочем интерфейсе**
    - Где: подписи осей и дат графика 10px, на телефоне 9px (`concept/payroll-concept.module.css:513-521, 547-553, 1532-1535`); счётчик в табе 10px (`:415-421`); «Без сотрудников на окладе» 10px (`:626-631`); пояснение под кнопкой выплаты 10px / 9px (`concept/concept-payment-form.module.css:335-342, 385-388`); подписи KPI ≤900px — 10px (`concept/payroll-concept.module.css:1950-1953`).
    - С чем расходится: DS:101 — минимальный стиль Caption 12px.
    - Как исправить: минимум 12px (11px — только должность в `EmployeeIdentity`, раз это уже общий компонент).

23. **[P2] График: до 31 остановки фокуса и цели шириной ~9px**
    - Где: `concept/payroll-concept.tsx:743-753` — кнопка на каждый день; css `:532-543`.
    - Как исправить: один фокусируемый элемент с управлением стрелками (`role="slider"` или `aria-activedescendant`), невидимые цели оставить только для мыши (`tabIndex={-1}`).

24. **[P2] «Стоимость команды» показывает только четыре должности**
    - Где: `concept/payroll-concept.tsx:775` — `perRole.slice(0, 4)`; ширина полос считается от общего итога (`:793`), остальные должности молча пропадают.
    - Как исправить: пятая строка «Остальные · N» или прокрутка списка; у выбранной полосы добавить `aria-pressed` (сейчас только обводка — `:781`).

25. **[P2] Склонения числительных**
    - Где: «{n} операций за месяц» (`concept/payroll-concept.tsx:578`), «{n} смен» (`pp/employee-pay.tsx:86`), «{n} записей» (`pp/legacy-payments.tsx:34`), «У {n} сотрудников» в мёртвом клиенте. Хелпер `plural` лежит в том же файле (`concept/payroll-concept.tsx:60-64`) и используется строкой выше (`:554-559`).
    - Как исправить: вынести `plural` в `src/lib/format` и применить.

26. **[P2] Экраны настроек: секции, заголовки и «Сохранить» не по DS**
    - Где/что: секции `rounded-xl border p-5` без `bg-card` (`pp/payroll-settings.tsx:71,73`; `pp/payroll-experience-policy.tsx:39`; `pp/discipline-settings.tsx:132`; `pp/automation-settings.tsx:212`), у вложенных — `p-4` (`pp/legacy-payments.tsx:28`, `pp/payroll-initial-data.tsx:34-42`); заголовки секций то `font-semibold`, то `font-medium` (`pp/payroll-setup.tsx:57`, `pp/legacy-payments.tsx:30`), то `text-base font-semibold` (`pp/payroll-experience-policy.tsx:40`); «Сохранить» в «Выдача чаевых и финансы» стоит слева под полями, без отслеживания изменений (`pp/payroll-settings.tsx:173-182`); в «Правилах» и «Автоматизациях» — справа в подвале, но неактивное состояние через стандартный `disabled:opacity-50` (`pp/discipline-settings.tsx:420-441`, `pp/automation-settings.tsx:739-741`).
    - С чем расходится: DS:399-418 (Save виден всегда; неактивный — `variant="secondary"`, без `opacity-50`), DS:698 (секции 14px), DS:818 (`ProfileSection`: padding 20, radius 14).
    - Как исправить: `ProfileSection` для всех секций; общий `SaveButton` с двумя состояниями; у формы чаевых — подвал справа и `dirty`.

27. **[P2] Вкладка «Оплата» в карточке сотрудника всегда показывает первый месяц учёта**
    - Где: `pp/payroll-context.tsx:28-33` — `month={data.settings?.starts_on ?? "2026-09-01"}`; во встроенном режиме `EmployeePay` выбора месяца нет (он только в обёртке страницы — `pp/employee-payroll-page.tsx:104-115`). Страница сотрудника без `?month` тоже открывает первый месяц учёта (`[employeeId]/page.tsx:21-26`), тогда как список — текущий (`payroll-concept/page.tsx:15-22`).
    - Как исправить: по умолчанию текущий месяц в обоих местах; во встроенный режим добавить `MonthPicker` (или ссылку «Открыть расчёт»).

28. **[P2] Зоны нажатия меньше 44px на телефоне**
    - Где: удаление получателя 20×32 (`concept/concept-payment-form.module.css:429,432-438`); глифы сортировки (`pp/payroll-table.tsx:186-217`); чип фильтра ≈25px (`concept/payroll-concept.module.css:901-909`); стрелки года 27×27 (`:1600-1609`) и 28×28 (`month-picker.tsx:87,97`); «Все смены» — текст 11px (`:1692-1701`); крестик панели 16×16 (`dialog.tsx:76-78`); дни графика (дефект 23).
    - Как исправить: минимум 32×32 на десктопе и 44×44 через `@media (pointer: coarse)`.

29. **[P2] Адрес рабочего экрана — `/payroll-concept`**
    - См. раздел «Мёртвый код / прототипы». Следствия: справка (дефект 2), особый случай в сайдбаре (`sidebar.tsx:132,507-508`), слово «concept» в адресной строке и в закладках пользователей.

### P3

30. **[P3] Пустой месяц без пустого состояния.** График рисует нулевую линию, блок должностей пуст, остаётся «В среднем за смену 0 ₽» (`concept/payroll-concept.tsx:625-821`); в таблице — строка «Нет записей за выбранный период» (`pp/payroll-table.tsx:373-382`). Класс `.empty` в CSS есть, но не используется. Исправление: `EmptyState` (`src/components/ui/empty-state.tsx`) вместо аналитики и таблицы.

31. **[P3] «— ₽».** При неизвестной сумме знак валюты остаётся (`concept/payroll-concept.tsx:573-575, 592-594`). Скрывать «₽» вместе с числом.

32. **[P3] Хлебные крошки двух видов.** Список: `div`, «Люди» ссылкой, gap 17px, разделитель без `aria-hidden` (`concept/payroll-concept.tsx:447-451`). Сотрудники: `<nav aria-label>`, «Люди» текстом, `gap-2 text-sm`, разделитель `aria-hidden` (`src/components/people/people-list-header.tsx:19-28`). Страница сотрудника: «← Зарплата» со стрелкой `ArrowLeft`, тогда как DS:361-365 показывает `ChevronLeft`. Исправление: общий компонент крошек; «Люди / Зарплата / Имя» на странице сотрудника.

33. **[P3] Кнопка справки в топбаре.** `.iconButton` задаёт 28×28 (`concept/payroll-concept.module.css:267-275`), до 36×36 её дотягивает только общий селектор топбара (`workspace-appearance.module.css:37-41`); нет hover-фона и `data-tip`, в отличие от `PageHelpButton` (`page-help-button.tsx:29-37`). Уйдёт вместе с дефектом 2.

34. **[P3] Кнопки «Добавить» оформлены по-разному.** `.actionButton` 13px + `Plus 16` + шеврон (`concept/payroll-concept.tsx:313`); «Добавить запись» — `Plus 15`, меню без шеврона (`concept/payroll-journal.tsx:291`); на странице сотрудника — `<Plus />` без шеврона, хотя это тоже меню (`pp/employee-pay.tsx:78`). Исправление: `TableSplitButton` из kit или одно правило «кнопка-меню всегда с шевроном».

35. **[P3] `Select` и `OptionSelect` вперемешку**, плюс `selectClass` (`h-10 rounded-md …`), экспортируемый из компонента `pp/employee-pay.tsx:22` в шесть файлов. Исправление: один контрол на модуль; константу убрать (у `OptionSelect` h-10 уже по умолчанию — `option-select.tsx:108`).

36. **[P3] Сырой `<textarea>` и нативный чекбокс.** `concept/concept-payment-form.tsx:266` (со своими стилями и `resize: vertical` — css `:447-456`), `pp/payroll-settings.tsx:102`, чекбокс `concept/payroll-journal.tsx:329-333`. DS:648 — `Textarea` с `resize-none`; `Checkbox` из `ui`.

37. **[P3] Фокус внутри `.app` переопределён.** У `input` убран ореол: `outline: none; box-shadow: none; border-color: brand` (`concept/payroll-concept.module.css:2203-2207`) против DS:641; у общих `Button` получается двойная индикация — контур из `.app button:focus-visible` (`:21-25, 2208-2214`) поверх `ring-2 ring-offset-2` из `button.tsx:8`; неактивные кнопки внутри `.app` получают `opacity .35` вместо общих `.5` (`:29-32`). То же в формах: `concept/concept-payment-form.module.css:457-463`. Исправление: удалить локальные правила фокуса и `disabled`.

38. **[P3] Значения вне шкал DS.** Радиусы 5/7/9/11/20 (например `.metrics` 11→12, `.analytics` 10, `.segment` 9, панель 20); карточки на одном уровне иерархии — 10, 12, 14 и 16px; тени вне четырёх уровней (`concept/payroll-concept.module.css:972, 1589`; `pp/payroll-detail-dialog.module.css:63`); отступы 13/17/21/22/23/25/27/29px (`.timeline 23px 25px 15px` — `:448`; `.employeeTotal 21px 22px` — `:998`; `.tabs gap 27px` — `:402`); веса 450/550/650.

39. **[P3] Диалог подтверждения.** «Назад» вместо «Отмена» (`concept/payroll-concept.tsx:1074-1076`); оформление через класс `.dialog` с десятком `!important` (`concept/payroll-concept.module.css:963-974`), подвал — самодельный `.dialogActions` вместо `DialogFooter`. Фокус при открытии трижды переопределён вручную через `document.querySelector` (`concept/payroll-concept.tsx:899-907, 1056-1064, 1118-1126`), хотя общий `Dialog` уже делает это (`dialog.tsx:58,64`).

40. **[P3] В форме выплаты аватар получателя нарисован заново** (`concept/concept-payment-form.tsx:192-198`, 32px, без фото), а в соседней форме премии — `PayrollEmployeeCell` (`concept/payroll-journal.tsx:779`). В `.selectedPeople .person` задан `grid-template-columns` при `display: flex` (`concept/concept-payment-form.module.css:168-169, 428-431`) — правило не работает.

41. **[P3] Редактирование записи — внутри вкладки «Детали»** с кнопками `size="sm"` «Сохранить» / «Отмена» (ghost) (`concept/payroll-journal.tsx:429-435`), тогда как остальные формы модуля держат главную кнопку в подвале панели.

42. **[P3] Панель поверх панели.** «Условия сотрудника» открывает вторую такую же панель в том же месте без анимации (`pp/employee-pay.tsx:108` → `pp/employee-pay-conditions.tsx:67`). Лучше раскрывать поля редактирования внутри первой.

43. **[P3] Семантика таблицы.** У `th` нет `scope="col"` (`kit/table-head.tsx:79`); `aria-label` таблицы передан только в сверке отметок — у ведомости, выплат, журнала и смен доступного имени нет (`pp/payroll-table.tsx:295`, проп `label` не передаётся из `concept/payroll-ledger.tsx:112-129`). Строка «пусто» использует `colSpan={columns.length}` — число всех, а не видимых столбцов (`pp/payroll-table.tsx:376`).

44. **[P3] Термины и тексты.**
    - «К выплате» / «Осталось выплатить» / «Остаток» / «остаток к выплате» (`concept/payroll-concept.tsx:582`; `pp/employee-pay.tsx:83`; `concept/payroll-transfer-drawer.tsx:59`; `concept/payroll-concept.tsx:1070`).
    - «Начислено» / «Начислено команде» / «Начислено за месяц» / «Всего начислено» / в справке «Заработано».
    - «Штраф» (тип записи) — «Удержания» (столбец) — «Сумма удержания» (подпись суммы, `concept/payroll-journal.tsx:359`).
    - «Удалить выплату» — в справке «Отмена выплаты» (`pp/payroll-help.tsx:39`).
    - Столбец типа: «Тип» в журнале, «Статья» в выплатах.
    - Стрелки в тексте ссылок: «Журнал переносов →» (`concept/payroll-transfer-drawer.tsx:79`), «Проверить фактические выходы →» (`pp/payroll-context.tsx:88`).
    - Рекламная строка «Один расчёт, понятные основания.» в справке (`concept/payroll-concept.tsx:1132`).
    - Дата «05 ноября» с ведущим нулём над графиком (`concept/payroll-concept.tsx:640`).

45. **[P3] Ошибки автообновления скрыты, скелетона нет.** `reload().catch(() => {})` каждые 15 секунд (`concept/payroll-concept.tsx:118-126`) — при потере связи экран молча показывает старые суммы; `loading.tsx` нет ни у `/payroll-concept`, ни у `/people/payroll/[id]`. В настройках загрузка — строка текста (`pp/payroll-settings.tsx:59-64`), рядом — `animate-pulse` блок (`pp/discipline-settings.tsx:65`, `pp/automation-settings.tsx:175`).

46. **[P3] Каскадный долг в CSS.** `concept/payroll-concept.module.css` — 2281 строка, 17 media/container-блоков, размер `.metric strong` объявлен 19 раз; итог немонотонный: при ширине окна 701–900px число 24px, при ≤700px — 28px (`:1947-1949, 1963-1965`). Первые ~1760 строк задают «не те» цвета (активные состояния `muted-foreground`), которые затем перекрывает блок «Hybrid direction» (`:1763-1924`).

47. **[P3] Табы на телефоне.** На списке при ≤540px — сетка в две колонки, третий таб уходит на вторую строку (`concept/payroll-concept.module.css:2268-2281`); на странице сотрудника — горизонтальная прокрутка (`workspace-tabs.module.css:1`). Как выглядит полоска активного таба в первой строке сетки, по коду не проверить (см. «Не проверено»).

### Противоречия в design-system.md, затрагивающие модуль

| № | Что противоречит | Где |
|---|---|---|
| a | Размер h1: 40px (типографика) / 30–32px (page header) / `text-3xl` (list) / 28 и 32px (detail) / 30px (списки людей). Зарплата = 40, сотрудники = 30 | DS:96, 296, 304, 451, 581; `people-tables.md:14` |
| b | Каркас панели: «только `EditDrawer`, 520px, без скругления» против «используют общий `PayrollDetailDialog`» (560px, r20) | DS:152-154, 771 против DS:816; `docs/payroll.md:119` |
| c | Сумма в панели: «без цветных плашек `bg-brand/5`» против действующего `PayrollDetailDialog` | DS:170 против `pp/payroll-detail-dialog.module.css:20` |
| d | Поля страницы: `p-6 md:p-8` для list-страниц и «только шкала 4px» против `PageFrame` `38px 42px 20px` | DS:459, 670, 775 против DS:426-432 |
| e | Табы: «active border 2px foreground», «всегда `justify-center`» против `workspace-tabs` (brand, слева) | DS:231, 598 против DS:816 |
| f | Sticky-шапка: оконная, без overflow-обёрток — и исключение для людей (общий scroll-контейнер 72dvh). Для зарплаты правила нет, фактически шапка не липнет | DS:718-742 против DS:826 |
| g | Сортировка: `SortFieldPanel` + `SortPinEditor` «без вариаций» против `TableSortSettings` у людей; зарплата — третий вариант | DS:511-564 против DS:824 |
| h | Таблица: 14px/строка 60/отступ 12 (люди) против «текст 13px, шапка 12px» (зарплата) | `people-tables.md:15` против `docs/payroll.md:78` |
| i | Крошки на list-странице: «НЕТ» против «Люди / раздел» | DS:341 против `people-tables.md:13` |
| j | Справка «TBD» при существующем реестре | DS:343 |
| k | Высота топбара 56px против 68px в `workspace-appearance` | DS:322 против `workspace-appearance.module.css:29-30` |
| l | Modal: 600px, r16, p28 — а `Dialog` по умолчанию `max-w-lg p-6 sm:rounded-lg`; в таблице радиусов модалки — 12 | DS:193-194, 697 против `dialog.tsx:66` |
| m | Backdrop `bg-black/25` против «всегда `bg-black/40`» | DS:139 против DS:771 |
| n | Ореол фокуса `ring-2 ring-brand/30` против `ring-[3px] ring-brand/40` | DS:641-646 против DS:773 |
| o | Радиус input/select 8px по шкале, фактически `rounded-md` (6px); формы зарплаты форсируют 8px локально | DS:687, 695 против `select.tsx:25`, `date-picker.tsx:113`; `concept/concept-payment-form.module.css:477` |

---

## Таблица зарплаты ↔ общий набор таблиц

| Аспект | Зарплата | Общий набор / списки людей | Что должно победить |
|---|---|---|---|
| Каркас | `PayrollTable<T>` — универсальная обёртка с пропами (`pp/payroll-table.tsx:25-67`) | каркас собирается на месте в `staff-table.tsx` и `candidates-client.tsx` | **Идея зарплаты**: одна обёртка лучше двух копий. Вынести в `kit/` как `DataTable`, наполнить значениями людей |
| Контейнер | `overflow-hidden rounded-xl border`, без `bg-card` (`:281`) | `.scroll`: `border`, `var(--radius)` = 8px, `bg card`, `overflow-x:auto` (`people-table.module.css:1-8`) | **Люди** — DS:468, 704-716 |
| Шрифт тела | 13px (`:296`) | 14px / 20px (`people-table.module.css:14-15`) | **Люди** (14px — Body по DS:100). Если для денежных таблиц нужна плотность 13px — записать это в DS как осознанный вариант |
| Шапка | 44px, 12px medium, `bg-muted`, `th px-3` (`kit/table-head.tsx:71-83`) | та же | совпадает |
| Отступ ячейки | 16px (`:296`) → расходится с шапкой | 12px (`people-table.module.css:23`) | **Люди** |
| Высота строки | не задана, ≈72px | 60px (`people-table.module.css:19-22`) | **Люди**; аватар 36px помещается |
| Hover строки | `hover:bg-muted/40` (`:334`) | `muted / 0.3` (`people-table.module.css:31-33`) | любой, но один |
| Sticky | выключен (`concept/payroll-concept.module.css:2179-2181`) | в общем scroll-контейнере 72dvh (DS:826) | **Люди**; режим `contained` в `PayrollTable` уже есть (`:289`, 65dvh) |
| Ширины столбцов | проценты от суммы + `minWidth` (`:297`), ресайз через состояние TanStack `onChange` (`:117`) | `useTableColumnResize` — через rAF, запись после отпускания (`staff-table.tsx:396`, `people-tables.md:21`) | **Люди** |
| Сортировка по клику | замена; Shift — добавить (`:132-146`) | добавление уровня (`staff-table.tsx:611-622`) | **Люди** / `useMultiSort` |
| Панель сортировки | своя, глифы «↓ ↑ ×» (`:162-241`) | `TableSortSettings` + sort-пин (`staff-table.tsx:494-510`) | **Общая** |
| Сортировка по умолчанию | навязана (`:85-89`) | нет | **Общая** (DS:507); для денег допустим серверный порядок |
| Фильтры | поповер + самодельный чип | `TableFilterChip`, «Очистить все» (`staff-table.tsx:513-592`) | **Общая** |
| Числа | `text-right tabular-nums` по списку `numeric` (`:344-345`), шапка тоже вправо (`:302`) | числовых столбцов почти нет | **Зарплата** — закрепить в DS: «суммы вправо, `tabular-nums`, заголовок вправо, индикатор сортировки слева от подписи» |
| Экспорт | `exportAction` в `TableControls` (`:264`) | нет | **Зарплата** |
| Телефон | горизонтальная прокрутка | `PeopleMobileCards` до 640px | **Люди**; проп `mobileCards` уже есть |
| Пустое состояние | «Нет записей за выбранный период», `p-12` (`:373-382`) | текст зависит от причины (фильтр / пусто) (`staff-table.tsx:668-680`) | **Люди** |
| Пагинация | `TablePagination` (`:400-411`) | та же | совпадает |
| Итоговая строка | нет | нет | добавить для денежных таблиц (см. «Идеи») |
| Заголовок страницы | самодельный h1 40px | `PeopleListHeader` → `TablePageHeader` 30px + счётчик + описание | решить вместе с противоречием (a) |

Оправданные отличия зарплаты: числовое выравнивание, экспорт, универсальная обёртка, портал тулбара в строку периода. Всё остальное — дрейф.

---

## Мёртвый код / прототипы

| Что | Статус | Доказательство |
|---|---|---|
| Маршрут `/payroll-concept` + `concept/*` | **Рабочий экран, не прототип** | редирект `people/payroll/page.tsx:15`; `sidebar.tsx:132`; ссылки `pp/employee-payroll-page.tsx:61`, `payroll-preview.tsx:115`. Название осталось от этапа согласования (`docs/payroll.md:55,73` называют его «концепцией»). Компоненты лежат в `src/app/payroll-concept/` вне route group и без `page.tsx`; общие части импортируются крест-накрест между `concept/` и `pp/` |
| `pp/payroll-client.tsx` (571 строка, `PayrollClient`) | **мёртв** | ни одного импорта (`grep PayrollClient src` — только объявление). Прежний экран `/people/payroll` до редиректа; содержит «Обновить», «Закрыть месяц», столбец «Заработано» — то, что до сих пор описывает справка |
| `pp/payment-form.tsx` (311 строк, `PaymentForm`) | **мёртв транзитивно** | импортируется только из `pp/payroll-client.tsx:34` |
| `pp/legacy-payments.tsx` | **жив** | `pp/payroll-initial-data.tsx:66` → `pp/payroll-settings.tsx:184` → карточка заведения |
| `pp/payroll-context.tsx` | жив | `StaffPayPanel` — `staff-detail-page.tsx:1283`; `PayrollDayPanel` — `sales/shifts/_components/day-drawer.tsx:286` |
| `pp/attendance-review.tsx` | жив, относится к графику | `schedule/attendance/attendance-client.tsx:30` |
| Маршрут `/payroll-preview` (`payroll-preview.tsx`, 160 строк + 164 строки CSS) | **осиротевший макет** | ссылок на него нет (`grep payroll-preview src` — только собственные файлы); данные — константы в файле (`:31-37`, комментарий «All shifts and transactions are illustrative»). DS:432 упоминает «макеты оплаты труда» как потребителя `PageFrame` |
| Мёртвые классы CSS | `concept/payroll-concept.module.css` — 41 из 103 (сайдбар, бренд, топбар, навигация, профиль, `.table`, `.tableScroll`, `.search`, `.filterRow`, `.pageFooter`, `.primaryButton`, `.closeBody`, `.empty` …); `concept/concept-payment-form.module.css` — 10 из 31; `concept/payroll-journal.module.css` — 6 из 18; `payroll-preview.module.css` — 6 из 50 | подсчёт обращений `s.<класс>` в импортирующих файлах; из-за совпадений имён свойств оценка занижена |
| Недостижимый код | `statusLabel` и ветка `id === "status"` | `concept/payroll-journal.tsx:79-92, 211-212` — в `labels` столбца `status` нет (`:69-75`) |
| Устаревшая документация | `docs/payroll.md:37` (про `DateRangeFilter`), `pp/payroll-help.tsx` (дефект 2) | — |

Рекомендация: отдавать `PayrollConcept` прямо из `people/payroll/page.tsx`, а `/payroll-concept` превратить в редирект на `/people/payroll` (в `next.config.ts`, рядом с остальными 301); после этого убрать особый случай в сайдбаре, перенести `concept/*` в `people/payroll/_components/`, удалить `payroll-client.tsx`, `payment-form.tsx`, мёртвые классы. `/payroll-preview` — удалить либо перенести в `dev/` и обезличить данные.

---

## Идеи

Уже есть в проекте и пригодно к переиспользованию: `SalesTrend` — динамика по месяцам с переключением рядов (`src/components/shared/sales-trend.tsx:35`); `HorizontalBars`, `ColumnChart`, `Metric` — внутри `src/components/people/people-overview.tsx:49-175` (не экспортируются, нужно вынести); дневной график зарплаты — встроен в `concept/payroll-concept.tsx:657-764`.

| № | Идея | Польза | Объём |
|---|---|---|---|
| 1 | **ФОТ по месяцам** на `SalesTrend`: ряды «Начислено», «Выплачено», «К выплате» за 6–12 месяцев, раскрываемым блоком над таблицей (как «Обзор» у сотрудников) | видно тренд фонда и накопление долга; сейчас месяц можно сравнить с соседним только перелистыванием | M (нужен помесячный агрегат на сервере) |
| 2 | **Структура начислений** полосой долей: ставки / процент / допродажи / надбавки / премии / удержания. Данные уже считаются (`componentGroups`, `concept/payroll-concept.tsx:82-95`), но показаны списком в диалоге (`:951-961`) | сразу видно, из чего складывается фонд | S после выноса `HorizontalBars` |
| 3 | **Выплачено из начисленного** — тонкая полоса прогресса в плитке «Выплачено» и подпись «N % от начисленного» | главный вопрос месяца читается без вычитания в уме | S |
| 4 | **История сотрудника**: столбики начислений за последние 6 месяцев на странице сотрудника (`ColumnChart`) | контекст для разговора о зарплате; сейчас только один месяц | M |
| 5 | **Итоговая строка** в ведомости и выплатах по видимым столбцам с учётом поиска и фильтра | суммы по отфильтрованной должности сейчас не видны нигде | S |
| 6 | **Мобильные карточки** ведомости (см. дефект 10) | зарплату смотрят с телефона | S–M |
| 7 | **Признак «требует внимания»** в строке ведомости: значок при `row.issues` — был в старом экране (`pp/payroll-client.tsx:137-142`), в новом потерян | не надо открывать каждого сотрудника, чтобы найти проблемный расчёт | S |
| 8 | **Плашка над таблицей** при неподтверждённых остатках или прежних выплатах: «У 3 сотрудников не указан начальный остаток → Настроить» вместо подсказок на прочерках | закрывает дефект 3 и ведёт к месту исправления | S |
| 9 | **Отметка актуальности**: «Обновлено N с назад» и состояние ошибки автообновления | доверие к цифрам | S |
| 10 | **Общие `MetricStrip` и `DayAreaChart`** в `src/components/shared` — извлечь из страницы зарплаты; продажи используют похожие блоки | убирает ~600 строк CSS и расхождения между модулями | M |
| 11 | **Выплаты на графике**: маркеры дней выплат на дневной кривой начислений | связь «заработали — выдали» на одном рисунке | M |
| 12 | **Ссылка на настройки из раздела**: настройки оплаты спрятаны в карточке заведения и должности, из «Зарплаты» на них нет ни одной ссылки, кроме текста справки | находимость | S |

---

## Не проверено

- Фактический рендер: вывод о высоте строки (~72px), смещении шапки на 4px и размерах зон нажатия получен расчётом по классам, без запуска.
- Вид табов на телефоне в сетке 2×2 (где оказывается полоска активного таба первой строки) и переполнение чисел в плитках при 375px (`white-space: nowrap` + `overflow: hidden`).
- Контраст зелёного `hsl(150 65% 35%)` в тёмной теме (оценка ≈4:1 — на глаз, не измерено) и общий вид панелей в тёмной теме.
- Поведение `data-tip` на реальном тач-устройстве (вывод сделан по обработчикам в `global-tooltip.tsx:105-109`).
- Работает ли Shift+клик по заголовку с клавиатуры во всех браузерах.
- Вес 550 у Inter: зависит от того, подключён ли вариативный шрифт (в `src/app/layout.tsx` — `next/font/google` `Inter`, параметры не изучались).
- `pp/automation-settings.tsx` (781 строка), `pp/discipline-settings.tsx` (446) и `pp/attendance-review.tsx` (447) просмотрены по структуре (заголовки, контролы, подвалы), не построчно; `pp/payment-form.tsx` и остаток `pp/payroll-client.tsx` — только как мёртвый код.
- Серверные действия, права и расчёты не проверялись — только интерфейс.
- Сверка с `sheerly.pen` не проводилась (аудит по коду и текстовому зеркалу DS).
- Число мёртвых CSS-классов — нижняя оценка автоматическим поиском.
