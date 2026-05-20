# Sheerly Design System

Источник истины: `sheerly.pen` → frame `Sheerly · Design System` (node `Q4FzoZ`).

> **⚠️ Правило: дизайн-система — первоисточник.**
> Перед тем как создавать новый компонент, страницу или править существующее
> оформление — открой `.pen` (через `mcp__pencil__get_screenshot` или
> `mcp__pencil__batch_get`) и сверься. Если правил для твоего кейса в DS нет —
> добавь их туда сначала, потом реализуй. Никогда не выдумывай токены, размеры,
> отступы или скругления. Этот файл — зеркало `.pen`, его задача избавить от
> повторных походов в `.pen` для уже задокументированного, но не заменить его.

Этот документ — короткое текстовое зеркало, чтобы при редактуре кода не нужно
было каждый раз открывать `.pen`. Если правила в `.pen` обновились — обнови
этот файл. Если у тебя есть только этот файл — открой `.pen` и сверь.

---

## Цвета — главное правило

В дизайн-системе ДВА синих токена. Они не взаимозаменяемы:

| Токен | Hex | Где использовать |
|---|---|---|
| **`brand`** (`bg-brand`, `text-brand`) | `#1570EF` | **ВСЕ CTA**: «Сохранить», «Добавить», «Создать», «Пригласить». Активные состояния, ссылки, notification dots, brand-tinted backgrounds (`bg-brand/10` ≈ `#1570ef14`). Дефолтный variant `<Button>` уже использует brand. |
| `primary` (`bg-primary`) | `#1d4ed8` | Внутренний токен дизайн-системы shadcn. **НЕ для CTA.** Допустимо для нейтральных «акцентных» поверхностей (например, иконка раздела в подложке). Если сомневаешься — бери `brand`. |

Остальные:

| Токен | Hex | Назначение |
|---|---|---|
| `destructive` | `#e7000b` | Только удаление и деструктивные действия. **НЕ #dc2626** |
| `secondary` | `#f5f5f5` | Бэкграунд secondary-кнопок, фоны input'ов, нейтральные блоки |
| `foreground` | `#09090b` | Основной текст, иконки, заголовки. **Не хардкодить #18181b** |
| `muted-foreground` | `#71717a` | Подписи, плейсхолдеры, hint-текст |
| `border` | `#e4e4e7` | Все бордеры. **Не хардкодить #e4e4e7** |
| `background` | `#fafafa` | Фон страницы / карточек. **Не хардкодить #fafafa** |

### Статусные цвета (для пиллов, аватаров, dot-индикаторов)

| Цвет | Hex | Использование |
|---|---|---|
| Зелёный | `#22c55e` | Онлайн, активный, success-toast |
| Amber | `#f59e0b` | Внимание, лимит, soft warning |
| Фиолетовый | `#a78bfa` | Аватар (профиль пользователя по умолчанию), декор |
| Rose | `#f43f5e` | Аватар по хешу, нейтральный варм-акцент |
| Emerald | `#10b981` | Аватар по хешу |

Тinted backgrounds: основной цвет + `/10` (≈14 alpha). Например,
`bg-brand/10` для подложки иконки CRM-раздела на странице «Должности».

### Никогда не хардкодь hex
Все цвета — через токены. Если нужного оттенка нет — открой `.pen`,
посмотри что там, добавь токен. Hex в коде = технический долг.

### Тёмная тема (правила из `.pen` → `t6BIlw`)

Все компоненты используют ТЕ ЖЕ переменные — переключение темы меняет
только значения. Что важно при работе с тёмной темой:

1. **Только переменные.** Никаких хардкод-hex в Dark mode.
2. **Три уровня поверхностей** (по убыванию контраста с фоном страницы):
   - `--background` — страница (`#09090b`)
   - `--card` — карточки/попоперы (`#18181b`)
   - `--muted` — выделение, header строк, sticky-row (`#27272a`)
3. **Brand и destructive светлее в dark** для контраста на тёмных
   поверхностях:
   - `--brand` light `#1570EF` → dark `#3b82f6`
   - `--destructive` light `#e7000b` → dark `#ef4444`
4. **Пастельные tint'ы (`#dbeafe`, `#FEE2E2`) в dark не работают.** Замена:
   полупрозрачный brand (`bg-brand/20` ≈ `#3b82f633`) или dark-saturated
   (`#1e3a8a`).
5. **Семантические income/expense пары** (когда понадобятся):
   green `#16a34a` → `#22c55e`, red `#dc2626` → `#f87171`. Минимум AA-контраст.
6. **Тени слабее.** Низкая непрозрачность (`#000000_26%`) + чуть больший блюр.
   Граница карточек должна быть видна через `border` (`#ffffff1a`).

Переключение Light / Dark / System живёт в profile popover (sidebar footer).
По умолчанию — System. Сохраняется через `next-themes` (cookie + localStorage).

---

## Типографика

Шрифт: **Inter** (подключён в `src/app/layout.tsx` через `next/font/google`,
включая cyrillic subset). Tailwind `font-sans` указывает на него.

Шкала (значения из `Q4FzoZ` → Section/Typography):

| Стиль | Размер | Вес | Line-height | Letter-spacing | Когда |
|---|---|---|---|---|---|
| Display | 56px | 700 | 110% | -1.5 | Hero, titles системного уровня (главная Design System) |
| Heading 1 | 40px | 700 | 120% | -0.5 | Заголовок страницы (Должности, Сотрудники) |
| Heading 2 | 28px | 600 | 130% | -0.25 | Section header внутри страницы |
| Heading 3 | 20px | 600 | 140% | — | Подсекции, drawer titles |
| Body Large | 16px | 400 | 150% | — | Описания, body |
| Body | 14px | 400 | 145% | — | Дефолт UI: триггеры меню, форма |
| Caption | 12px | 500 | 140% | — | Метки, eyebrow, count pill |

Глобальные `h1` `h2` `h3` уже стилизованы через `globals.css` (`font-bold
tracking-tight` и т.д.) — для типовых страниц достаточно использовать
семантические теги.

---

## Иконки

Lucide (`lucide-react`). Штрих 1.5px. Размеры:

- **16px** (`w-4 h-4`) — inline в кнопках, badge'ах, рядом с текстом
- **18px** (`w-[18px] h-[18px]`) — sidebar items, action toolbar, header'ы карточек
- **20-24px** (`w-5 h-5` / `w-6 h-6`) — feature-иконки, заголовки модалок
- **32px+** — hero, empty state

Цвет:
- Основной: `text-foreground`
- Вторичный/декоративный: `text-muted-foreground`
- Интерактивный/активный: `text-brand`

Каноничные иконки по доменам (см. `Q4FzoZ` → Section/Iconography):

| Домен | Иконка |
|---|---|
| People (раздел сотрудников/ролей) | `users` |
| CRM (брони, гости) | `circle-user-round` или `layout-grid` |
| Org (юрлица, заведения) | `building-2` |
| Finance | `wallet` |
| Settings | `settings` |
| Owner role | `shield` |
| Hint в drawer | `sparkles` |

---

## Оверлеи (Modal vs Drawer)

**Backdrop един для всех:** `bg-black/25` → лёгкое затемнение, контент сзади остаётся читаемым. Источник — `overlayClass` в [`src/lib/overlay-classes.ts`](../src/lib/overlay-classes.ts). Не дублируй классы вручную в новых overlay-компонентах — импортируй helper.

**Тайминг:** open `200ms ease-out`, close `150ms ease-in`. Закрытие быстрее открытия — UI ощущается отзывчивым. Любой новый Sheet/Dialog должен использовать `overlayContentTiming` для контента.

**Smooth theme switch:** переключатель тем оборачивает `setTheme` в [`applyTheme`](../src/lib/theme.ts) — навешивает `.theme-transition` на 220ms и снимает. CSS-правило в `globals.css` даёт всем элементам 200ms color-transition на это время. Без обёртки переключение моргает; вне переключения класс отсутствует, hover/focus переходы не тормозят.

**Скрыть встроенный X-крестик** в Dialog для подтверждений с двумя явными кнопками — `<DialogContent hideClose>`. Используется в «Не сохранять изменения?» (transaction form sheet); X дублирует одну из кнопок и сбивает.

**Sidebar collapse:** `transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]`. Текст пунктов меню анимируется через `transition-opacity duration-200` отдельно — fades out за половину времени collapse-анимации.

### Drawer (правый sliding panel)
**Используй `<EditDrawer>` из `src/components/ui/edit-drawer.tsx`**

- Ширина: 520px (зашита в EditDrawer; не override'ить)
- Без скругления (вся высота вьюпорта)
- Header: title 18px semibold + опциональный subtitle 13px muted + close X
- Footer: справа Cancel (Outline) + CTA (Brand)
- Назначение: создание/редактирование сущностей — «Новая должность»,
  «Новый зал», «Редактировать гостя»

### Modal (центрированная карточка)
Использует существующий `<Dialog>` из `src/components/ui/dialog.tsx`.

- Ширина: 600px (или меньше для compact подтверждений)
- cornerRadius 16, padding 28
- Footer: справа Cancel (Outline) + CTA (Brand или Destructive)
- Назначение: подтверждения, особенно destructive (удалить должность,
  удалить заведение, отменить операцию)

**Drawer ≠ Modal**: edit → drawer, confirm → modal.

---

## Кнопки

```tsx
import { Button } from "@/components/ui/button";

<Button>Сохранить</Button>            {/* default = brand */}
<Button variant="brand">Создать</Button>{/* explicit alias */}
<Button variant="outline">Отмена</Button>
<Button variant="ghost">Ещё</Button>
<Button variant="destructive">Удалить</Button>
<Button variant="secondary">Назад</Button>
```

Правила:
- Главное действие на странице/в drawer'е → default (brand)
- Cancel в drawer footer → Outline
- Cancel в modal footer → Outline
- Удаление → Destructive
- Третичные/мягкие действия в тулбарах → Ghost
- Если на странице **несколько CTA одного веса** → не оба brand. Один
  brand + остальные secondary/outline.

---

## Реиспользуемые компоненты (наши обёртки)

| Компонент | Файл | Назначение |
|---|---|---|
| `<Tabs>` `<TabsList>` `<TabsTrigger>` `<TabsContent>` | `src/components/ui/tabs.tsx` | Underlined tab strip с active border-bottom 2px foreground |
| `<EditDrawer>` | `src/components/ui/edit-drawer.tsx` | 520px правый drawer, header/body/footer слоты |
| `<EmptyState>` | `src/components/ui/empty-state.tsx` | Bg-muted блок с круглой иконкой + title + subtitle + CTA |
| `<TableControlPin>` | `src/components/shared/table/table-control-pin.tsx` | **Единственный** валидный «пин» под list-таблицами (фильтр/сортировка/поиск). Pill 32px, `rounded-full`. Active = `bg-brand/10 text-brand` + закрывающий ×. Inactive = `bg-muted/60 text-muted-foreground` + chevron. **Не копируй стили вручную — переиспользуй компонент**, иначе расходится визуал между разделами. |
| `<TablePageHeader>` / `<TableControls>` / `<TablePagination>` | `src/components/shared/table/*.tsx` | Слоты для list-страницы. Кнопка фильтров `active`-подсветка должна включаться **только когда выбран хотя бы один фильтр** (открытое состояние pin-row — отдельный visual-bit, не подсветка кнопки). |
| `<InventoryStatusBadge>` | `src/components/shared/inventory-status-badge.tsx` | Шаблон цветовой палитры status-бейджа с dark-вариантами (см. ниже §Dark-bdarz badges). Если для другого модуля нужен похожий бейдж — копируй структуру файла, а не выдумывай палитру с нуля. |

И базовые shadcn-примитивы: `Button`, `Input`, `Label`, `Textarea`, `Select`,
`Switch`, `Checkbox`, `Card`, `Sheet`, `Dialog`, `Popover`, `Tooltip`, `Badge`,
`Separator`.

---

## Паттерны страниц

### Page header (заголовок раздела)
```
<h1>Должности</h1>           — 30-32px bold, tracking-tight
<p muted>описание подзаголовок</p>  — 14px muted
[ Action toolbar справа: search, filters, +Добавить (brand) ]
```

### Detail page header (карточка сущности)
```
[ ‹ Breadcrumb-link, muted, 13px ]  — слева сверху
<h1>Название</h1>           — 32px bold
<subtitle>метаданные · X из Y</subtitle>  — 14px muted
[ Save button (brand) справа ]
[ Tabs ниже ]
```

### Action toolbar
- Кластер 36×36 icon-button'ов в `flex gap-1` (или 4)
- Каждый: `cornerRadius 8`, hover `bg-accent`, активный `bg-brand text-brand-foreground`
- Tooltip обязателен для каждой кнопки

### Permission/Settings list
- Module group → `<Card>` с rounded-[14px], border
- Header карточки: `bg-muted px-5 py-3.5` + icon-tile (28×28 brand-tint) + label + count pill «X из Y» + master switch
- Rows: `flex items-center px-5 py-3 border-b last:border-b-0`, чекбокс/тоггл слева + текст 13px

### Top bar (общий header дашборда)

Топбар — общая 56px-плашка, рендерится в `(dashboard)/layout.tsx`. Содержит
4 типа элементов в строгом порядке:

```
[ SidebarTrigger | Breadcrumb ]   …   [ PageHeaderActions | NotificationBell ]
       ↑              ↑                          ↑                  ↑
   md:hidden       slot                       slot               постоянно
```

**Кнопки в топбаре** (info / bell / опционально help) — единый стиль
по `iedpv`: 36×36 (`size-9`), `rounded-lg` (8px), **без border**,
`bg-background`, иконка 18px в `text-muted-foreground`. На hover —
`bg-accent` + `text-foreground`. Если есть индикатор — точка
`bg-brand` 8×8 в правом-верхнем углу с `ring-2 ring-background`.

#### Когда что показывать

| Элемент | Index/list (например, /people/roles) | Entity detail (например, /people/roles/[id]) |
|---|---|---|
| **Breadcrumb** (← Раздел) | НЕТ — заголовок раздела живёт в теле страницы | ДА — `<PageBreadcrumb>` с `<Link>` обратно на список |
| **Info-popover** (i кнопка) | НЕТ | ДА — `<EntityInfoPopover>` с метаданными сущности |
| **Help-popover** (?) | TBD (когда появится) | TBD (по контексту страницы) |
| **NotificationBell** | ДА (всегда) | ДА (всегда) |

Если у сущности **нет audit-полей** в БД (created_at/updated_at/by) —
info-popover не имеет смысла, его можно опустить. **Требование:** для
сущностей, на которые есть detail page, добавь audit-поля в таблицу
+ триггеры (см. `supabase/migrations/052_roles_audit_fields.sql`
как референс).

#### Page-side API

```tsx
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";

<PageBreadcrumb>
  <Link href="/people/roles" className="...muted/13/medium...">
    <ChevronLeft /> Должности
  </Link>
</PageBreadcrumb>

<PageHeaderActions>
  <EntityInfoPopover
    title="О должности"
    id={role.id}
    createdAt={role.created_at}
    createdByName={createdByName}
    updatedAt={role.updated_at}
    updatedByName={updatedByName}
  />
</PageHeaderActions>
```

Slots авто-очищаются на unmount (через `useEffect` cleanup) — переход
со страницы на страницу не требует ручной чистки.

### Entity detail page — разметка тела (роль / сотрудник / счёт / …)

Под топбаром:

```
[ h1 Название           ]
[ subtitle: описание    ]
              [  Tab1  Tab2  Tab3  ]   ← centered tabs (`<TabsList className="justify-center">`)
              ─────────────────────
          [  centered content (max-w 720) ]
                                  [ Сохранить ] ← Save в футере формы конкретного таба
```

**CTA не висит в шапке.** Form-actions живут в **футере формы конкретного
таба**, правым выравниванием. Header остаётся стабильным при переключении
табов (без layout-shift) — только заголовок и подзаголовок.

**Состояние Save** (виден всегда, меняется только статус — никаких
исчезновений и появлений):

- **Активна** (`canEdit && dirty && validInput`): `variant="default"` — brand-blue
- **Неактивна** (нет прав / нет изменений / невалидно): `variant="secondary"`
  с фоном `#f5f5f5`, приглушённый текст `text-muted-foreground`,
  `cursor-default`, без hover. Не использовать `opacity-50` —
  визуально это «выключенный, но всё ещё кнопка», не «полу-сломанный».

```tsx
const isActive = canEdit && dirty && nameValue.trim().length > 0;
<Button
  variant={isActive ? "default" : "secondary"}
  disabled={!isActive || isPending}
  className={isActive ? "" : "disabled:opacity-100 text-muted-foreground hover:bg-secondary cursor-default"}
  onClick={handleSave}
>
  Сохранить
</Button>
```

Если у сущности появится **глобальное** действие, релевантное для всех табов
(«Опубликовать» / «Архивировать») — его можно поставить в шапку, but only
when always-relevant.

---

## List-страница (таблица) — каноничный набор

Один эталон под все list-страницы (Сотрудники, Должности, Акты инвентаризации,
Транзакции, Knowledge index и т.п.). Расходиться нельзя — иначе пользователь
ощущает «разный продукт».

```
[ outer wrapper:  p-6 md:p-8  ]
  ├─ <TablePageHeader title=... actions={<TableControls .../>} />
  │     └─ h1 text-3xl/bold + subtitle muted + actions cluster справа
  ├─ Pin-row (Active filters) — гитчатся **только** через <TableControlPin>
  └─ Table body (desktop) или mobile cards
[ <TablePagination /> внизу ]
```

**Дефолты (правило для list-страниц):**

- **Outer padding** — `p-6 md:p-8`. Никакого `px-4 py-4 md:px-8 md:py-6` —
  страницы должны выровняться от топ-бара одинаково. Прецедент: акты
  инвентаризации поначалу имели `py-4` сверху и расходились по высоте с
  /people/staff. Исправлено в PR2 round-2.
- **Вертикальный gap внутри страницы** — `space-y-6` (24px) на outer
  wrapper. Накрывает расстояние между шапкой → pin-row → таблицей →
  пагинацией. `space-y-4` (16px) визуально слипает controls с
  таблицей — был на /documents/inventory до round-3, пользователь
  поправил.
- **Карточка таблицы** — обязательно: `rounded-xl border bg-card
  overflow-hidden`. Внутри `<thead>` (или div-аналог) — `bg-muted/60`,
  не `/40`. Эталон: `/people/staff`.
  - `bg-card` важен в dark: в нашей теме card light-er чем background,
    таблица читается как elevated блок, а не сливается со страницей.
    `bg-background` в dark = почти то же что фон страницы → таблица
    «исчезает».
  - `rounded-xl` (12px) — staff/roles используют его, не `rounded-lg`.
- **Mobile cards** (если есть отдельный layout для <md) — те же
  `rounded-xl border bg-card`, чтобы в dark не было контраста между
  desktop и mobile.
- **Filter-кнопка**: `active` подсвечивается **только когда выбран хотя бы
  один фильтр** (есть значение в pin-чипе). Открытое состояние pin-row —
  отдельный bit (toggle), визуально кнопку не меняет.
- **Pin-row скрыта по умолчанию**. Раскрывается явным кликом по «Показать
  фильтры». Видна сразу, если фильтр уже выбран через URL / persist /
  сохранённый view.
- **Sort по умолчанию** — _нет_ default-сортировки в коде (пустой массив).
  Цикл клика по колонке: пусто → asc → desc → пусто. Серверный fallback
  отдаёт стабильный порядок (например, `invoice_date desc`), но это не
  визуальный sort-active state.
- **Чекбоксы / Bulk** — выключены, пока в списке не появился пользовательский
  сценарий «массовая операция». Не вставлять «впрок».

См. эталон `dev/table-lab` → FinanceDemo + production-пример
`/documents/inventory`.

---

## Detail-страница со табами — каноничный набор (акт / сотрудник / роль)

Один паттерн «крупный заголовок + центрированные табы» — используется для
любой entity detail page с ≥2 вкладками.

```
[ topbar slot: <PageBreadcrumb> «‹ К списку» ]   ← через PageHeaderActions
[ outer wrapper:  px-6 md:px-8 pt-4 pb-8 flex-col gap-6 ]
  ├─ <h1 text-[28px] font-bold tracking-tight leading-tight>...</h1>
  ├─ Под заголовком — `flex items-center gap-3 flex-wrap`:
  │     ├─ <span text-sm text-muted-foreground>контекст-метаданные</span>
  │     └─ <StatusBadge /> (если у сущности есть статус)
  └─ <Tabs><TabsList className="justify-center">...</TabsList></Tabs>
[ children — каждая вкладка рендерит свой контент со своим `py-4 md:py-6` ]
```

**Что важно:**

- **Бейджи рядом с muted-text**, не в одной строке с h1. Эталон —
  `/people/staff/[userId]` (рендер бейджа «Активен» / «Уволен» рядом с
  ролью+подразделением). Прецедент: на /documents/inventory/[id] раньше
  badge стоял справа от h1 — выглядело инородно, переделали в PR2 round-2.
- **Никаких счётчиков в контекстной строке**, если они не критичны для
  принятия решения (типа «2 позиции»). Если важно — выводить отдельной
  строкой / секцией внутри таба, а не в шапке.
- **Tabs всегда `justify-center`**. Опасные/destructive табы (например,
  «Опасная зона») получают `data-[state=active]:text-destructive` +
  `data-[state=active]:border-destructive`.

---

## Dark-варианты статусных бейджей и пинов

Правило: light/dark — **в одном файле компонента**, не разводить через
условные хуки `useTheme`. Tailwind делает это через `dark:` префикс.

**Палитра status-бейджа** (см. `<InventoryStatusBadge>` как эталон):

| Тон   | Light                          | Dark                                |
|-------|--------------------------------|-------------------------------------|
| serene/neutral | `bg-slate-100 text-slate-700 border-slate-200` | `dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30` |
| info          | `bg-blue-50 text-blue-700 border-blue-200`      | `dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30` |
| warning       | `bg-amber-50 text-amber-700 border-amber-200`   | `dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30` |
| accent/violet | `bg-violet-50 text-violet-700 border-violet-200`| `dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30` |
| success       | `bg-emerald-50 text-emerald-700 border-emerald-200` | `dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30` |
| destructive   | `bg-rose-50 text-rose-700 border-rose-200`      | `dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30` |

**Соответствие фон/текст в dark**: `bg-{color}-500/15` + `text-{color}-300/400`
+ `border-{color}-500/30`. Это считанный из `.pen` `t6BIlw` шаблон, не
угадывать.

**Подсветка строки формы** (например, заполненная позиция инвентаризации):
`border-brand/30 bg-brand/5 dark:border-brand/40 dark:bg-brand/10`.

**Tinted active-state у пинов** (внутри `<TableControlPin>`):
`bg-brand/10 text-brand` (light=dark одинаково — brand-цвет уже работает в
обоих режимах).

---

## Form States (`Q4FzoZ` → `CxLzo` / Section/Form States)

Состояния полей ввода — Input, Textarea, Select:

| Состояние | Что меняется |
|---|---|
| **Default** | `border-input` (`#e4e4e7`), фон `bg-background` |
| **Filled** | то же что Default, текст `text-foreground` |
| **Focused** | `border-brand` (1px) + мягкий halo через `ring-2 ring-brand/30`. **Не offset-ring**, не двойная обводка. (`.pen` показывает `spread:3 / 40%` — в браузере это получается резче, поэтому подбираем визуальный эквивалент.) |
| **Error** | `border-destructive` + сообщение под полем 12px destructive |
| **ReadOnly** | то же что Default. Поле фокусируемо для скринридеров, но **focus halo не показывается** — у юзера не должно складываться впечатление, что значение можно поменять. (Реализовано через `read-only:focus-visible:ring-0`.) Если поле read-only и при этом фон выделен `bg-muted/50` — это сигнал «не редактируется». |
| **Disabled** | opacity 50%, cursor not-allowed |

В Tailwind: `focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30`.

**Textarea** — `resize-none` по умолчанию (запрет ручного растягивания —
ломает компоновку). Если в редком случае нужно растягивать, передавай
`className="resize-y"`.

---

## Тени (`Q4FzoZ` → `E4KLo0`)

4 уровня. Все используют `#0a0a0a` с низкой непрозрачностью — работают
одинаково в light и dark.

| Уровень | Параметры | Когда |
|---|---|---|
| **XS · subtle** | `y:1 blur:2 #0a0a0a 8%` (`shadow-sm`) | Кнопки в hover, мелкие плашки, ползунки |
| **SM · cards** | `y:2 blur:6 #0a0a0a 8%` (`shadow`) | Карточки в списках, dropdown-айтемы |
| **MD · popover** | `y:8 blur:24 spread:-4 #0a0a0a 15%` (`shadow-md`) | Поповеры, диалоги, drawer-шапки |
| **LG · drawer** | `x:-10 blur:30 spread:-5 #0a0a0a 15%` | Drawer справа, Sheet, Side-panel |

---

## Отступы (`Q4FzoZ` → `VnHBQ`)

Шкала на основе **4px**. Padding, gap, margin — только из этой шкалы.

| Значение | Tailwind | Когда |
|---|---|---|
| **4 · xs** | `p-1 gap-1` | Внутри icon-кнопок, gap между tag+иконой, padding chip-бейджей |
| **8 · sm** | `p-2 gap-2` | Gap внутри кнопок, padding мелких pill, расстояние inline-элементов |
| **12 · base** | `p-3 gap-3` | Gap form-fields, padding small-button, расстояние между rows |
| **16 · md** | `p-4 gap-4` | Padding топбара, gap между фильтрами, отступ между card-секциями |
| **20 · lg** | `p-5 gap-5` | Padding страницы по вертикали, gap между карточек в Page Body |
| **24 · xl** | `p-6 gap-6` | Padding больших card-секций, gap между form-rows, padding страниц |
| **32 · 2xl** | `p-8 gap-8` | Padding страницы по горизонтали, gap между большими секциями DS |
| **48 · 3xl** | `p-12 gap-12` | Padding empty-state, gap между крупными hero-блоками, full-screen |

---

## Скругления (`Q4FzoZ` → `xA95j`)

7 значений. Самое частое — `8 base` (кнопки/input/select).

| Значение | Tailwind | Когда |
|---|---|---|
| **0 · sharp** | `rounded-none` | Очень редко: разделители-баннеры на всю ширину |
| **6 · sm** | `rounded-md` (`--radius - 2`) | Dropdown-айтемы, tag-чипы, segmented-buttons |
| **8 · base** | `rounded-lg` (`--radius`) | Кнопки, input, select, dropdown — самое частое |
| **10 · md** | `rounded-[10px]` | Поповеры, dropdown-меню, секции внутри карточек |
| **12 · lg** | `rounded-xl` | Модалки, диалоги, banner-карточки |
| **14 · xl** | `rounded-[14px]` | Главные карточки страниц, table-card, section-card |
| **9999 · pill** | `rounded-full` | Бейджи, фильтр-чипы, аватары, switch-дорожки, dot-индикаторы |

`--radius` в `globals.css` = `0.5rem` (8px) — соответствует `8 base`. Из него
производятся `rounded-md` и `rounded-sm`.

---

## «Не делать»

- ❌ `bg-primary` для CTA (используй `bg-brand` или дефолт `<Button>`)
- ❌ Hex в коде (`#1570EF`, `#dc2626`, `#fafafa` и т.п.) — все через токены
- ❌ Modal для редактирования — это drawer
- ❌ Drawer для подтверждения удаления — это modal
- ❌ Несколько brand-CTA одного веса на одном экране
- ❌ Иконки 32+ как inline — это feature-размер для hero/empty state
- ❌ Менять ширину drawer (всегда 520) или цвет backdrop (всегда `bg-black/40`)
- ❌ Focus-ring со смещением (`ring-offset-2`) на input/textarea/select —
  только border swap + halo через `ring-[3px] ring-brand/40`
- ❌ `resize-y` или `resize-both` на Textarea без явной причины — дефолт `resize-none`
- ❌ Произвольные значения отступов/радиусов вне шкалы (`p-7`, `rounded-[11px]` и т.п.)
- ❌ Произвольные тени (`shadow-2xl`, custom `box-shadow`) — только из 4 уровней DS

---

## Привязка к узлам `.pen` (для быстрой навигации)

| Раздел | Node ID в `Q4FzoZ` |
|---|---|
| Цвета (бренд + нейтральные + semantic) | `a38yJk` |
| Typography | `DjOE7` |
| Components | `COoVe` |
| Iconography | `H9zuOp` |
| Form States (Input/Textarea/Select) | `CxBIh` (карточки `CxLzo` + `xNGUx`) |
| Status & Avatars | `y0JfM` |
| Navigation Patterns | `d6RCNR` |
| Empty States & Tooltips | `IBB1T` |
| Sheerly · Кнопки | `omqGO` |
| Sheerly · Оверлеи | `LCFsp` |
| Sheerly · Быстрые правила | `P16TE` |
| **Sheerly · Тени** | `E4KLo0` |
| **Sheerly · Отступы** | `VnHBQ` |
| **Sheerly · Скругления** | `xA95j` |
| Тёмная тема (отдельный фрейм) | `t6BIlw` |

Доступ через MCP: `mcp__pencil__get_screenshot` или `mcp__pencil__batch_get`
с `filePath: /Users/pavel.oplochko/Desktop/Projects/crm/sheerly.pen`.
