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

**Backdrop един для всех:** `bg-black/40` → визуально `#0a0a0a66`. Не трогать.

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

### Entity detail page (роль / сотрудник / счёт / транзакция / контр-агент / …)

Универсальный паттерн страницы конкретной сущности. Источник: дизайн `r5eX3`.

**Структура:**
```
[ ‹ Раздел  breadcrumb-link ]                 [ ⓘ info ] [ 🔔 bell ]   ← header (общий)
[ h1 Название               ]   [ Сохранить ] ← left: title (28px bold)
[ subtitle: краткое описание ]                  + опциональный CTA справа
                  [ Tab1  Tab2  Tab3  ]       ← centered tabs (TabsList justify-center)
                  ─────────────────────
              [   centered content (max-w 720) ]
```

**Info-popover** (i-кнопка справа, рядом с колокольчиком):
- Использовать `<EntityInfoPopover>` из `src/components/shared/entity-info-popover.tsx`
- Внутри **5 строк**: ID, Создана, Создал (brand-blue), Изменена, Изменил (brand-blue)
- Триггер: 36×36 icon-button с `Info` иконкой
- Инжектится через `<PageHeaderActions>` из
  `src/components/shared/page-header-actions.tsx`:

```tsx
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

**Требование к таблицам сущностей в БД:** должны иметь
`created_at / updated_at / created_by / updated_by` (см. миграцию 052
для `roles` как референс — таблица + триггеры на auto-set).

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
