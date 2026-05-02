# Sheerly Design System

Источник истины: `sheerly.pen` → frame `Sheerly · Design System` (node `Q4FzoZ`).
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

---

## «Не делать»

- ❌ `bg-primary` для CTA (используй `bg-brand` или дефолт `<Button>`)
- ❌ Hex в коде (`#1570EF`, `#dc2626`, `#fafafa` и т.п.) — все через токены
- ❌ Modal для редактирования — это drawer
- ❌ Drawer для подтверждения удаления — это modal
- ❌ Несколько brand-CTA одного веса на одном экране
- ❌ Иконки 32+ как inline — это feature-размер для hero/empty state
- ❌ Менять ширину drawer (всегда 520) или цвет backdrop (всегда `bg-black/40`)

---

## Привязка к узлам `.pen` (для быстрой навигации)

| Раздел | Node ID в `Q4FzoZ` |
|---|---|
| Brand Palette | `a38yJk` |
| Neutral Palette | `goXoh` |
| Semantic Tokens | `RzvtD` |
| Typography | `DjOE7` |
| Components | `COoVe` |
| Iconography | `H9zuOp` |
| Form States | `CxBIh` |
| Status & Avatars | `y0JfM` |
| Navigation Patterns | `d6RCNR` |
| Empty States & Tooltips | `IBB1T` |
| Sheerly · Кнопки | `omqGO` |
| Sheerly · Цвета | `p1HsiN` |
| Sheerly · Оверлеи | `LCFsp` |
| Sheerly · Быстрые правила | `P16TE` |

Доступ через MCP: `mcp__pencil__get_screenshot` или `mcp__pencil__batch_get`
с `filePath: /Users/pavel.oplochko/Desktop/Projects/crm/sheerly.pen`.
