# ТЗ: legacy-страница транзакций (finance-tracker)

Источник: `_legacy_from_finance/components/Transactions/*` + `_legacy_from_finance/utils/helpers.ts`. Описывает поведение страницы транзакций до миграции на shadcn. Используется как справочник при воссоздании страницы под `/finance/transactions-legacy` и при принятии решений «что забрать в основную версию».

Терминология: legacy-схема использует `accountId/toAccountId/categoryId/counterpartyId`. В новом проекте им соответствуют `bank_account_id/to_bank_account_id/category_id/counterparty_id` (см. `src/types/finance.ts`). Все формулировки ниже даны в legacy-терминах; маппинг указывается отдельно там, где важен.

---

## 1. Layout страницы

Страница состоит из четырёх вертикальных секций:

1. **Хедер действий** (`mb: 3`, flex space-between):
   - Левый блок: поле поиска + квадратная кнопка-тоггл фильтров (40×40, `borderRadius: 8`, голубой фон/обводка `#1976D2` если фильтры открыты, иначе `#F3F4F6`/прозрачная).
   - Правый блок: три кнопки-CTA — «Приход» (`AddIcon`), «Расход» (`RemoveIcon`), «Перевод» (`CompareArrowsIcon`). Все contained, `borderRadius: 8`, без shadow, `px: 3, py: 1`.
   - На иконке-тоггле — красный круглый бейдж с количеством активных фильтров (правый верхний угол, `top: -2, right: -2`, белый бордер `2px`, фон `#DC2626`).

2. **Панель фильтров** (`TransactionFilters`) — рендерится ТОЛЬКО когда `filtersVisible === true`. Фон `#FAFAFA`, бордер `1px solid #E0E0E0`, `borderRadius: 12`, `p: 2`. Внутри — горизонтально wrap’нутый ряд фильтров с `gap: 1`. Подробнее в §4.

3. **Прелоадер / пустое состояние / таблица**:
   - Первые ~800 мс после mount — `Paper` с центрированным `CircularProgress(40)` и текстом «Загрузка операций…».
   - После загрузки, если `accounts.length === 0 || categories.length === 0 || transactions.length === 0` — `Paper` с одним из трёх текстов:
     - нет счетов: «Для создания операций необходимо сначала создать хотя бы один счет.»
     - нет категорий: «Для создания операций необходимо сначала создать хотя бы одну категорию.»
     - есть всё, но нет транзакций: «У вас пока нет операций. Используйте кнопки "Приход", "Расход" или "Перевод" для создания новых операций.»
   - Иначе — `Paper` с `TableContainer` (max-height `calc(100vh - 200px)`), `Table` с `stickyHeader`, в конце `TablePagination` с разделительной линией сверху.

4. **Right-sidebar** (`RightSidebar`) — правая шторка фиксированной ширины `COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH`. Используется и для формы транзакции, и для inline-создания категорий/контрагентов/счетов/групп — каждая в отдельном экземпляре `<RightSidebar>` с собственным `open`-флагом. Они могут быть открыты «параллельно» (визуально открывается вторая поверх первой).

---

## 2. Колонки таблицы

Высота строки/ячейки 48 px, `border-collapse: separate`, разделители `1px solid #F3F4F6`. Hover — фон `#F9FAFB`, выбранная строка — `#F3F4F6`. Клик по строке открывает форму редактирования (`handleEditClick`).

Колонки (в порядке слева направо):

| # | Колонка | Ширина | Содержимое |
|---|---|---|---|
| 0 | checkbox | 48 px | `Checkbox`, `stopPropagation` на клике, чтобы не открывать форму |
| 1 | Дата | 12 % | `formatDate(transaction.date)` → `ru-RU` короткий формат `dd.mm.yyyy` |
| 2 | Сумма | 18 % | См. ниже |
| 3 | Статья | 23 % | См. ниже |
| 4 | Контрагент | 22 % | См. ниже |
| 5 | Счет | 25 % | См. ниже |

### 2.1. Сумма

- `income`: префикс «+», цвет `success.main`, `fontWeight: 500`.
- `expense`: префикс «−», цвет `error.main`, `fontWeight: 500`.
- `transfer`:
  - Если у транзакции есть `toAmount` и `toCurrency` (т. е. перевод между счетами с разными валютами) — две строки в колонке: верхняя `−<formatAmount(transaction)>` (без цвета), нижняя `caption` `+<formatCurrency(toAmount, toCurrency)>` цветом `text.secondary`, `lineHeight: 1.2`.
  - Иначе одна строка без знака.
- `formatAmount(transaction) = formatCurrency(amount, account.currency)`; если счёта нет — fallback `String(amount)`.

### 2.2. Статья

- `transfer`: серый кружок 8×8 (`#9E9E9E`) + текст «Перевод между счетами».
- остальные: цветной кружок 8×8 (`category.color || '#ccc'`) + название категории; если категории нет — текст «Без статьи» без кружка.
- Под основной строкой — `caption` с `transaction.description`, прогнанным через `linkify` (см. §10.4); цвет `text.secondary`, `lineHeight: 1.2`.

### 2.3. Контрагент

- Если есть — серый кружок 24×24 (`backgroundColor: #F3F4F6`) с иконкой `BusinessIcon` (16 px, `color: text.secondary`) + имя контрагента.
- Если нет — `—`.

### 2.4. Счет

Display зависит от типа:

- `income`/`expense`:
  - имя счёта,
  - `caption` с компактным балансом (`formatShortAmount(calculateAccountBalance(account.id), account.currency)`),
  - иконка `TrendingUpIcon` (зелёная) для income или `TrendingDownIcon` (красная) для expense, 16 px.

- `transfer` (если есть `toAccount`):
  - две строки, в каждой: имя счёта, `caption` с балансом, `SwapHorizIcon` (`#9E9E9E`, 16 px).

`formatShortAmount`: 1 000 000+ → «1.5М», 1 000+ → «12.3К», иначе число; ".0" обрезается; символ валюты — `₽` для RUB, `$` для USD, `€` для EUR, иначе код.

`calculateAccountBalance(accountId)` приходит из `FinanceContext` — это динамический баланс счёта на текущий момент, рассчитанный из всех операций.

---

## 3. Multi-select и bulk actions

- Состояние — `selected: string[]` (id транзакций).
- Чекбокс в заголовке таблицы:
  - `checked` если все строки на ТЕКУЩЕЙ странице выбраны;
  - `indeterminate` если выбрано > 0 и < `paginatedTransactions.length`;
  - клик: либо выбирает все строки страницы, либо снимает выделение полностью.
- Чекбокс в строке: toggle для одной транзакции, `event.stopPropagation()` чтобы не открывать форму.
- Когда `selected.length > 0`, заголовок таблицы заменяется на **bulk-toolbar** (та же `TableHead`, только содержимое):
  - слева чекбокс (с indeterminate),
  - счётчик выбранных (caption `text.secondary`),
  - если выбрана 1 транзакция — кнопка **«Копировать»** (outlined). Создаёт копию: те же поля, `id: undefined`, `date: new Date()`, `description: 'Копия: <старое>'`, `isEditing: false`, открывает sidebar формы.
  - если все выбранные одного типа (`areAllSameType()`) — кнопка **«Редактировать»** (outlined):
    - 1 выбранная → `handleEditClick(transaction)` (редактирование в sidebar);
    - >1 → пока что `alert('Групповое редактирование в разработке')`.
  - всегда — красная кнопка **«Удалить»** (contained, `error.main`). Открывает `ConfirmDialog`. На подтверждении — последовательно `deleteTransaction(id)` для каждого id, очищает `selected`.

`ConfirmDialog` для bulk-удаления:
- title: `"Удалить выбранные операции"` (если >1) или `"Удалить операцию"` (если 1).
- message: «Вы уверены, что хотите удалить N выбранных операций? Это действие нельзя отменить.» / «Вы уверены, что хотите удалить эту операцию? Это действие нельзя отменить.»
- кнопки: «Удалить» (`primary` цвет — да, именно primary, не error) / «Отмена».

---

## 4. Фильтры

Контейнер `TransactionFilters` рендерится в виде горизонтального flex-wrap. Все фильтры — pill-кнопки `borderRadius: 20px`, неактивные `bg: #F3F4F6, color: text.secondary`, активные `bg: #E3F2FD, border: #1976D2, color: #1976D2`. У активных в правой части — круглая кнопка-крестик 18×18 на синем фоне.

Видимость панели фильтров — boolean `filtersVisible`, persist в localStorage, ключ `transactions-filters-visible` (`FILTERS_VISIBILITY_STORAGE_KEY`). Default — `true`.

### 4.1. Фильтр по дате (`DateRangeFilter`)

- Триггер: pill-кнопка с иконкой `CalendarTodayIcon` или текстом текущего пресета/диапазона.
- Текст кнопки:
  - выбран пресет → его лейбл,
  - оба `start`/`end` → `dd.mm – dd.mm`,
  - только start → `С dd.mm`,
  - только end → `До dd.mm`,
  - иначе → «Дата».
- Popover (минимум 320 px, `borderRadius: 12`, `boxShadow: 0 4px 20px rgba(0,0,0,0.1)`):
  - два `TextField type="date"` («С даты», «До даты») — при ручном редактировании сбрасывается выбранный пресет; если start > end — другой край сбрасывается.
  - подзаголовок «Быстрый выбор:».
  - 11 пресетов в виде `Chip` (outlined): «Сегодня», «Вчера», «Текущая неделя», «Текущий месяц», «Текущий квартал», «Текущий год», «Прошлая неделя», «Прошлый месяц», «Прошлый квартал», «Прошлый год», «Все время».
    - «Текущая неделя» — с понедельника по воскресенье.
    - «Текущий квартал» — с 1-го месяца квартала по последний день 3-го месяца.
    - «Все время» = `{ start: null, end: null }`.
    - При клике пресета → сразу `onChange + handleClose`.
  - кнопка «Применить» (contained) — для случая ручного ввода.
- Крестик-сброс — мгновенно очищает `value` и пресет.

Применение фильтра в `applyFilters`: транзакция включается, если её дата (`setHours(0,0,0,0)`) ≥ `start` и ≤ `end` (`end` принимается с `setHours(23,59,59,999)`).

### 4.2. Фильтр по типу операций

- `Select` (size small) с теми же pill-стилями.
- Опции: `Все`, `Приход` (income), `Расход` (expense), `Переводы` (transfer).
- Активность = `type !== 'all'`. Когда активен — собственная кнопка-крестик справа поверх (та же логика, что у MultiSelectFilter, иконка `ExpandMoreIcon` скрывается).

### 4.3. MultiSelectFilter (счета, статьи, контрагенты)

Один компонент, три инстанса. Особенности:

- Триггер: pill-кнопка, текст:
  - 0 выбрано → плейсхолдер («Счета» / «Статьи» / «Контрагенты»),
  - 1 выбрано → имя выбранного,
  - >1 → «Выбрано: N».
- Popover (`min-width: 300, max-width: 400, max-height: 500`, `borderRadius: 12`):
  - опциональный заголовок,
  - `TextField` с поиском, дебаунс 300 ms (`debounce` из `filters/utils.ts`); кнопка-иконка `SearchIcon` слева,
  - два `Chip` управления: «Выбрать все», «Снять все»,
  - сам список — `maxHeight: 300, overflowY: auto`.
- Группировка:
  - **Специальные элементы** («Без статьи»/«Без контрагента») — всегда первые, без чекбокса группы. Под группами разделитель `Divider`.
  - Если групп нет — все элементы в одной группе `ALL`.
  - Если есть — каждая группа: чекбокс группы (с `indeterminate`, если выбрана часть), заголовок группы (`subtitle2`, `fontWeight: 600`), её элементы со сдвигом `ml: 2`.
  - Элементы без группы — в группе `UNGROUPED` (без заголовка), идут в конце.
  - Группы и элементы внутри сортируются по алфавиту с `localeCompare(..., 'ru')`.
- Виртуализация:
  - Включается, если в группе > 50 элементов И всего элементов > 100 (`shouldUseVirtualization`).
  - Реализация — компонент `VirtualizedList`: фиксированная `itemHeight` (по умолчанию 36), overscan 5, ручной windowing через `scrollTop`.
- Кэш группировки: `groupFilterItemsWithCache` хранит до 50 результатов в `Map<string, …>`, ключ — конкатенация id элементов и групп.
- «Применить» (опциональная нижняя кнопка, по умолчанию `showApplyButton=false` для всех трёх инстансов на странице транзакций — изменения применяются сразу).
- Пустой результат поиска — текст «Ничего не найдено» по центру.

Подготовка данных:
- `prepareCategoriesForFilter(categories)` → `[{ id: 'no-category', name: 'Без статьи' }, …categories]`.
- `prepareCounterpartiesForFilter(counterparties)` → `[{ id: 'no-counterparty', name: 'Без контрагента' }, …counterparties]`.
- `prepareAccountsForFilter(accounts)` → без специальных, только сами счета.

Применение:
- Счёт: транзакция матчится, если `accountId` или `toAccountId` (для transfer) есть в выбранных.
- Категория: если выбран `no-category`, транзакции без категории включаются; обычные id матчатся напрямую.
- Контрагент: аналогично с `no-counterparty`.

### 4.4. AmountRangeFilter

- Pill-кнопка с иконкой `AttachMoneyIcon` или текстом:
  - оба → `<min> ₽ - <max> ₽` (форматировано `Intl.NumberFormat ru-RU currency RUB maximumFractionDigits 0`),
  - только min → `От <min> ₽`,
  - только max → `До <max> ₽`,
  - иначе → «Сумма».
- Popover (min-width 280, `p: 3`):
  - два `TextField type="number"` («От», «До»), `min: 0, step: 0.01`, без визуальной валидации (отрицательные технически блокируются `min:0`, перепутанные min>max не блокируются).
  - кнопки: текстовая «Очистить» (одновременно сбрасывает и применяет), contained «Применить».
- Состояние popover-а — локальный `tempRange`, применяется только по «Применить» (в отличие от MultiSelect).

### 4.5. Кнопка «Очистить все»

- Появляется при `hasActiveFilters(filters) === true`.
- Outlined, красная (`borderColor: #DC2626, color: #DC2626`), `borderRadius: 20`, hover чуть светлее (`#FEF2F2`).
- Сбрасывает все фильтры: `dateRange:{null,null}, type:'all', accountIds:[], categoryIds:[], counterpartyIds:[], amountRange:{null,null}`.

### 4.6. Подсчёт активных фильтров

`getActiveFiltersCount(filters)` считает по 1 за каждый из 6 разделов: dateRange, type≠'all', accountIds, categoryIds, counterpartyIds, amountRange.

---

## 5. Поиск

- `TextField` (custom стили из `SEARCH_FIELD_STYLES`) с `InputAdornment` иконкой слева. Плейсхолдер «Поиск по операциям…».
- На любое изменение → `setPage(0)` (сброс пагинации) + рефильтр. Дебаунса в legacy-варианте нет — фильтрация на каждый keystroke (но через `useMemo`).
- Поля поиска (substring, lowercased):
  - `transaction.description`,
  - `account.name` (по `accountId`),
  - `toAccount.name` (по `toAccountId`),
  - `category.name`,
  - `counterparty.name`,
  - `transaction.amount.toString()` (буквенно — «100» матчит «1100» и т. п.).
- Поиск применяется ПОСЛЕ всех остальных фильтров (`filterTransactions(applyFilters(...))`) и до пагинации.

(Отдельный компонент `SearchBar.tsx` лежит в папке, но на главной странице не используется — она имеет свой инлайн `TextField`. Это backup-компонент для других страниц.)

---

## 6. Пагинация

- Внизу таблицы, отдельная панель `TablePagination` (бордер сверху `1px solid #F3F4F6`).
- Размеры страниц: `[25, 50, 100]`.
- Default `rowsPerPage`: 25.
- `count`: `filteredTransactions.length` (после фильтров и поиска, до slice).
- Лейблы: «Строк на странице:» / `${from}–${to} из ${count}` (или `более чем ${to}` если count = -1).
- При смене pageSize → `setPage(0)`.

Сортировка строк (вне UI пагинации, в `useMemo`): по `date` DESC (новые сверху).

---

## 7. Right-sidebar форма транзакции

Ширина — `COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH` (фикс).

### 7.1. Header sidebar’а

- При `isEditing === true`: заголовок «Редактировать операцию».
- При создании: «Добавить операцию <тип>», где `<тип>` — кликабельный inline-toggle с цветом по типу:
  - `прихода` (`success.main`) + иконка `AddIcon`,
  - `расхода` (`error.main`) + иконка `RemoveIcon`,
  - `перевода` (`primary.main`) + иконка `CompareArrowsIcon`.
  - Стиль: `borderBottom: 1px dashed`, цвет совпадает с цветом текста, `cursor: pointer`. На клике циклично переключает тип: income → expense → transfer → income. При переключении на/с transfer вызывается логика автоподбора второго счёта (см. ниже).

### 7.2. Поля формы (income / expense)

Двухколоночный layout `display:flex, gap:2`:

1. Ряд 1: `Сумма` (50 %) + `Счёт` (50 %).
2. Ряд 2: `Категория` (50 %) + `Дата` (50 %).
3. Ряд 3 (full-width): `Контрагент`.
4. Ряд 4 (full-width): `Описание`.

Все обязательные: amount, accountId, date, type. Дополнительно для income/expense обязательна категория (по UI `required`, но в save-валидации не проверяется — DB допускает null если пользователь не выбрал; см. §7.5).

### 7.3. Поля формы (transfer)

Все поля full-width:

1. `Сумма перевода`.
2. `Сумма поступления (<currency>)` — рендерится ТОЛЬКО если у выбранных `accountId` и `toAccountId` разные валюты.
3. `Счёт списания`.
4. `Счёт поступления` — список счетов фильтруется, исключая `accountId`.
5. `Дата`.

При смене типа на `transfer`: автоматически выбирается второй счёт `accounts.find(a => a.id !== accountId)?.id || ''`. Если в системе < 2 счетов — кнопка «Перевод» в хедере страницы вообще disabled, плюс при попытке открыть выводится `alert('Для создания перевода необходимо иметь как минимум два счета')`.

При выборе одного и того же счёта в обоих полях — второй автоматически меняется на любой другой доступный.

### 7.4. Поведение полей

- **Сумма / Сумма перевода / Сумма поступления**: тип — `text` с маской `^[0-9]*\.?[0-9]*$` (разрешает пустую строку и десятичные с точкой). `inputMode: decimal`. Скрыты браузерные up/down spinner-ы. Плейсхолдер `0,00`. Передача в стейт — `parseFloat(value) || 0`.
- **Счёт** (`Autocomplete`):
  - Опции — `[ {id:'add-new-account', name:'Добавить счет', isAddOption:true}, ...accounts ]`.
  - Лейбл опции счёта — `${name} (${formatCurrency(calculateAccountBalance(id), currency)})` (динамический баланс).
  - Опция `isAddOption` имеет иконку `AddCircleOutlineIcon` (`primary.main`, 18 px) и primary-цвет текста; всегда первая в списке (`filterOptions` не фильтрует её по запросу).
  - При выборе `isAddOption` — открывается sidebar создания счёта (`accountSidebarOpen = true`), значение поля не меняется.
  - Disabled, если `accounts.length === 0`.
  - Плейсхолдер «Начните вводить для поиска».
- **Категория** (`Autocomplete`):
  - Опции — фильтрованные по типу транзакции (income → только income, expense → только expense, transfer → пустой массив, поэтому disabled).
  - Опция `add-new` («Добавить статью») с теми же стилями. На клике — открывается sidebar категории, причём `currentCategory.type` предустанавливается в `income`/`expense` по типу транзакции.
  - Render опции: цветной кружок 12×12 (`category.color`) + название.
- **Контрагент** (`Autocomplete`):
  - Все контрагенты + опция `add-new` («Добавить контрагента»).
  - Render: иконка `BusinessIcon` (`text.secondary`, 18 px) + название (или add-icon для add-option).
  - Поле НЕ обязательное.
- **Дата**: `TextField type="date"`, `borderRadius: 8`, `InputLabelProps.shrink: true`. Парсится в `new Date(value)`.
- **Описание**: однострочный `TextField`, `fullWidth`. Без валидации.

### 7.5. Кнопки формы

- При создании (`isEditing === false`): только «Сохранить» (contained, `borderRadius: 8, minWidth: 100`), justify-end.
- При редактировании: слева «Удалить» (outlined, кастомные цвета — `borderColor: #FFB3BA, color: #DC2626, bg: #FEF2F2`; на hover — заливка red `#DC2626` + белый текст/иконка), справа — «Отмена» + «Сохранить» (для transfer; для income/expense — только «Сохранить» без «Отмена», так и реализовано).

### 7.6. Save-валидация

В `handleSave`:
- обязательные: `amount && accountId && date && type` — иначе `alert('Пожалуйста, заполните все обязательные поля')`.
- Для transfer: `toAccountId` обязателен (`alert('Пожалуйста, выберите целевой счет для перевода')`).
- Для transfer: `accountId !== toAccountId` (`alert('Исходный и целевой счета должны быть разными')`).
- `amount > 0` (`alert('Сумма должна быть больше нуля')`).
- categoryId === `'no-category'` или falsy → передаётся как `undefined`.
- Для transfer с разными валютами счетов — `toAmount`/`toCurrency` сохраняются; иначе оба `undefined`.
- В случае создания — поле `currency` берётся из выбранного `accountId` счёта.

### 7.7. История изменений (только при редактировании, в нижней части)

Заголовок «История изменений» (`subtitle2`, серый, `HistoryIcon` 18 px).

- `Создано: <userName>`, дата `formatDateTime` — аватар 32×32 `success.main` с иконкой `CreateIcon`.
- `Изменено: <userName>`, дата — аватар 32×32 `primary.main` с иконкой `UpdateIcon`.

`getUserName(userId)` ищет в `users` массиве; для `userId === 'system'` — «Система»; не нашёл — «Неизвестный пользователь».

### 7.8. Защита от потери ввода

В legacy-варианте отсутствует. Закрытие sidebar’а или клик по фону немедленно сбрасывает форму без подтверждения. (Это явный gap, который при воссоздании можно поправить в плюс пользователю.)

---

## 8. Inline-create цепочка

Все создаваемые сущности → каждая в своём `<RightSidebar>` поверх формы транзакции. После сохранения подсайдбар закрывается, через `setTimeout(100ms)` ищет в массиве сущность с тем же `name` (последний `pop`), подставляет её id в `currentTransaction`/`currentCounterparty`/`currentCategory`. Это hack под асинхронное обновление контекста — в новой реализации лучше дождаться возврата id из server action, а не искать по имени.

### 8.1. Категория (`CategoryForm`)

- `currentCategory` начальное: `{ name: '', type: 'expense', description: '', color: generateRandomColor() }`.
- При открытии из формы транзакции — `type` выставляется в `income`/`expense` по типу транзакции (для transfer — не вызывается).
- Сохранение: проверка `name`, иначе `alert('Пожалуйста, укажите название категории')`. Вызывает `addCategory(currentCategory)`. Затем сбрасывает форму, через 100 ms подставляет `categoryId` в транзакцию.
- Внутри есть кнопка «Создать группу» → открывает `CategoryGroupForm` в ещё одном sidebar.

### 8.2. Контрагент (`CounterpartyForm`)

- `currentCounterparty` начальное: `{ name, legalEntity, inn, contactPerson, phone, email, description }` все пустые.
- Сохранение: проверка `name`, иначе `alert(...)`. Вызывает `addCounterparty(...)`, далее тот же 100-ms hack.
- Внутри — «Создать группу» → `CounterpartyGroupForm`.

### 8.3. Счёт (`AccountForm`)

- `currentAccount` начальное: `{ name, balance: 0, currency: 'RUB', description, groupId, accountType: 'checking', bankName, bik, accountNumber, correspondentAccount, acquiringPercentage: 0, cardHolder, cardNumber }` — все банковские поля пустые.
- Сохранение: проверка `name`, alert. Вызывает `addAccount(...)`. 100-ms hack для подставления `accountId`.

### 8.4. Группы

- `CounterpartyGroupForm`: `{ name, description }`, проверка `name`, `addCounterpartyGroup`. После сохранения подставляет `groupId` в `currentCounterparty`.
- `CategoryGroupForm`: `{ name, type: 'both' (или income/expense по типу категории), description }`. То же.

---

## 9. Permissions

- Используется `<PermissionGuard objectType="transactions" level="write">`, оборачивающий КАЖДУЮ из трёх кнопок «Приход»/«Расход»/«Перевод».
- Когда permission отсутствует — guard ничего не рендерит (кнопки исчезают целиком).
- Read-permission на саму страницу не реализован в legacy на уровне компонента — предполагается, что роутер уже отфильтровал.
- Чекбоксы и bulk-toolbar в legacy всегда видимы; в новой реализации их следует гейтить на `delete_transaction` для bulk-«Удалить» и `update_transaction` (если появится) для bulk-«Редактировать».

Маппинг в текущий проект:
- legacy `objectType="transactions" level="write"` ≈ `finance.create_transaction` + `finance.update_transaction`.
- Удаление → `finance.delete_transaction`.
- Просмотр страницы — `finance.view_transactions`.
- Экспорт CSV — `finance.export` (этого на legacy-странице не было).

---

## 10. Утилиты для воспроизведения визуала

### 10.1. `formatCurrency(amount, currency): string`

```ts
new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency,
  signDisplay: 'never',
}).format(Math.abs(amount));
```

Знак ВСЕГДА снимается (signDisplay: 'never') — знак «+/−» отрисовывается отдельно в UI. Берётся `Math.abs` — отрицательные значения сначала превращаются в положительные.

### 10.2. `formatDate(date): string`

```ts
new Date(date).toLocaleDateString('ru-RU')
// → "01.05.2026"
```

### 10.3. `formatDateTime(date): string`

```ts
new Date(date).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
})
// → "01.05.2026, 14:23"
```

### 10.4. `linkify(text): (string | ReactElement)[]`

- Регексп `/(https?:\/\/[^\s]+)/g`, splittлит текст; URL-куски оборачивает в `<a target="_blank" rel="noopener noreferrer">` с inline-стилем `color: #6364FF, textDecoration: underline`.
- На клике по ссылке — `e.stopPropagation()` (чтобы клик не открыл форму редактирования из строки таблицы).

### 10.5. `generateRandomColor(): string`

```ts
CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)].value
```

`CATEGORY_COLORS` — массив preset-цветов (находится в `_legacy_from_finance/utils/constants.ts`, в curated-копии не сохранился; нужно подтянуть из `~/Desktop/finance-tracker-archive.bundle` или составить аналогичный набор пастельных цветов из 12-16 значений).

### 10.6. `formatShortAmount(amount, currency): string`

Локальная функция в `TransactionsPage.tsx` (см. §2.4).

---

## 11. Performance

### 11.1. Виртуализация

- Реализована только для опций внутри `MultiSelectFilter` через `VirtualizedList` (см. §4.3). Таблица транзакций НЕ виртуализирована — пагинация на 25/50/100 строк это компенсирует.

### 11.2. Мемоизация

- `useMemo` для:
  - `getAccountById/getCategoryById/getCounterpartyById` (создание getter-ов через `createGetterFunctions`),
  - `sortedTransactions` (sort by date desc),
  - `filteredTransactions`,
  - `paginatedTransactions`,
  - `isAllSelected`, `isIndeterminate`,
  - в `MultiSelectFilter`: `filteredItems`, `groupedItems`, `useVirtualization`, `getButtonText`,
  - `groupingCache` — Map с ограничением 50 ключей, ключ = id-конкатенация.
- `useCallback` для всех bulk-/select-/handleChange-обработчиков.
- `OptimizedTransactionRow` — `React.memo`-обёрнутая альтернатива `TransactionRow` с уже рассчитанными account/category/counterparty (передаются props’ами, чтобы не делать лишние lookup’ы внутри). На главной странице НЕ ИСПОЛЬЗУЕТСЯ — вместо неё inline-render внутри `TransactionsPage`. Файл оставлен как заготовка для будущей оптимизации; разница — структура колонок (в `OptimizedTransactionRow` отдельная колонка «Тип», `Chip` для категории, выровненная вправо сумма, отдельная колонка «Описание»). Для воспроизведения look’а основной таблицы — НЕ его эталон.

### 11.3. `React.memo`

- `TransactionsTable` (отдельный компонент-обёртка, тоже не используется на главной странице — главная содержит таблицу инлайн).
- `TransactionRow` — обёрнут.

---

## 12. Прочие UX-нюансы

- Hover-эффекты в фильтрах: каждая активная pill чуть темнеет (`#BBDEFB` → база `#E3F2FD`); неактивные → `#E5E7EB`.
- Кнопки «Сохранить»: на hover добавляется лёгкая тень `0px 4px 6px -1px rgba(0,0,0,0.1)`.
- Кнопка «Удалить»: hover полностью меняет цвета (red fill + white).
- Чекбокс пагинации перерисовывается при смене pageSize → состояние `selected` НЕ очищается (остаётся с предыдущей страницы — потенциальный gap).
- Sidebar открывается с анимацией shutter справа (стандартный MUI Drawer); фон страницы получает overlay.
- Линки в `linkify` — голубой `#6364FF`, тот же оттенок и для других интерактивных подчёркиваний в проекте.
- Тоггл фильтров через клавиатуру (focus + Enter) работает за счёт стандартного MUI IconButton.
- Прелоадер на 800 ms — `setTimeout` без зависимости от реальной загрузки данных, всегда минимум 800 ms видно `CircularProgress`.
- Никаких keyboard-shortcuts (`Cmd+K`, `Esc` для закрытия sidebar и т. п.) на legacy-странице нет. Esc для Drawer работает по умолчанию из MUI.

---

## 13. Маппинг legacy → новая схема (для воссоздания)

| Legacy (`Transaction`) | Current (`TransactionRow`) |
|---|---|
| `accountId` | `bank_account_id` |
| `toAccountId` | `to_bank_account_id` |
| `categoryId` | `category_id` |
| `counterpartyId` | `counterparty_id` |
| `amount`, `currency`, `description`, `date`, `type` | те же |
| `toAmount`, `toCurrency` | в текущей схеме нет — переводы между разно-валютными счетами, скорее всего, требуют отдельного поля или просто не поддерживаются. **Уточнить при реализации**: если поле отсутствует — функционал «разные валюты» из legacy не воспроизводим. |
| `audit.{createdAt, createdBy, updatedAt, updatedBy}` | `created_at`, `created_by`, `updated_at`, `updated_by` (на уровне `transactions` row) |
| `attachments` (legacy) | `transaction_attachments` row + связь по `transaction_id` (в legacy фактически закомментирован — функционал не входит в скоуп) |

Дополнительно в новой схеме появляются обязательные `legal_entity_id`, `venue_id` — на legacy-странице их нет. Подставлять:
- `legal_entity_id` — из выбранного `bank_account.legal_entity_id` (при transfer для целевого счёта — из `to_bank_account.legal_entity_id`, попадает в `to_legal_entity_id`).
- `venue_id` — из выбранного счёта или null.

---

## 14. Что в legacy ЕСТЬ, чего нет в текущей версии

Список фичей, ради которых имеет смысл поднимать legacy и сравнивать:

1. Drawer-форма create/edit (а не отдельный роут).
2. Inline-создание категории/контрагента/счёта/групп прямо из формы транзакции.
3. Цикличный кликабельный переключатель типа в заголовке формы (приход → расход → перевод).
4. MultiSelectFilter с группировкой, виртуализацией, спец-элементами «Без статьи»/«Без контрагента» и checkbox-группами.
5. Date-range filter с 11 пресетами (Сегодня…Все время).
6. Multi-select строк + bulk actions (копировать одну, редактировать одну, удалить пачкой).
7. Тоггл видимости панели фильтров с persist в localStorage.
8. Пагинация в стиле «25/50/100, X–Y из Z» (в текущей версии — другой формат).
9. Цветовая дифференциация сумм (зелёный/красный/нейтральный) и иконки direction (↑/↓/⇄).
10. Цветной кружок-маркер категории (8×8) рядом с названием в строке таблицы.
11. История изменений (кто/когда создал/обновил) под формой редактирования.
12. Динамические балансы счетов в опциях `Autocomplete` и в строке таблицы.
13. `linkify` URL-ов внутри описаний транзакций.

## 15. Что в legacy ОТСУТСТВУЕТ (но добавлено в новую версию)

Не воспроизводим, не критично для сравнения UX:

- Серверная пагинация и фильтрация (legacy — целиком на клиенте).
- Soft-delete + переключатель «Показать удалённые».
- Экспорт в CSV.
- Multi-tenant (`legal_entity_id` / `venue_id`) фильтрация и cookie LegalEntitySwitcher.
- Защита формы от потери несохранённых изменений (см. §7.8).
- Server actions / RLS (legacy всё через один shared client context).

Решение по этим пунктам при воссоздании legacy под shadcn — наследуем поведение текущего стека:
- сервер-пагинация всё равно используется, фильтры применяются в URL, но UI выглядит как in-memory (т. е. без долгого refetch при каждом клике — оптимистичные обновления).
- Soft-delete и export — НЕ показываем на legacy-роуте (зачем, если они там никогда не были).
- Защита от потери ввода — добавляем (это плюс, не воспроизводимый «как было», а необходимая гигиена).
