# KB page properties — roadmap

Living-документ с тем, что **ещё** хочется добавить в structured-properties
KB-страниц после уже зашипленной базы. Структурирован по tier'ам: от
мелких высокоимпактных до больших стратегических.

## Что уже есть (state по состоянию на 2026-05-05)

5 типов: text, number, date, checkbox, select.
- Schema: `kb_pages.properties jsonb`, `kb_templates.properties jsonb`
  (миграция 104).
- TypeScript: discriminated union `KbProperty` в [src/types/knowledge.ts](../src/types/knowledge.ts).
- UI: `<KbPageProperties>` между title и content в KbPageEditor.
- Server actions: `saveKbPageProperties` / `saveKbTemplateProperties`
  (без `revalidatePath` — не дёргает страницу при сохранении).
- Templates: `applyKbTemplate` копирует properties с регенерацией id'шников.
- Polish (Stage 1, текущий PR): per-option colors с manual override,
  drag-reorder, hover-highlight ряда.

**Запланированные следующие итерации (Stage 2-5)** живут в основном плане
([elegant-bubbling-cloud-md-http-elegant-witty-cloud.md](../.claude/plans/elegant-bubbling-cloud-md-http-elegant-witty-cloud.md)),
не дублируем. Здесь — то, что **за** ними.

## Tier 1 — мелкие, высокоимпактные

### Email / Phone типы

Расширяют семью «контактных» полей рядом с URL:
- `email` — `<input type="email">` с regex-валидацией; display = `mailto:` link.
- `phone` — `<input type="tel">`; display = `tel:` link.

Цена: ~30 строк на тип. Полностью изолированно.

### Person type

Линк на сотрудника (`profiles.id`). Reuses `<KbStaffMentionInlineContent>`
chip из [src/components/knowledge/blocks/kb-staff-mention.tsx](../src/components/knowledge/blocks/kb-staff-mention.tsx).
Edit — staff-picker (тот же, что в @-mention'ах). Display — chip с
аватаркой + именем.

Шкала: medium (нужен picker UI + типизация). Зависимость: ничего —
кроме staff'а, который уже есть.

## Tier 2 — средние, полезные

### Visibility per-property

`visibility?: "always" | "if_filled" | "never"` (default: `"always"`).
- `if_filled` — скрываем ряд если value пустой / null.
- `never` — скрываем всегда (полезно для архивных полей).
В контекст-меню ⋯ добавляется submenu «Видимость».

Решает кейс «много пустых строк» когда properties накопились.

### Description / help text

`description?: string` (max ~200 chars). Tooltip-`?` рядом с именем,
hover показывает текст. Useful для шаблонов: «что писать в это поле».

### Required flag

`required?: boolean`. Пустое value → амбер-border + hint «обязательное поле».
Не блокирует сохранение страницы (validation soft).

## Tier 3 — большие, стратегические

### Relation type

Линк на другую KB-страницу. Edit — search picker (reuses логику
[KbMentionMenu](../src/app/(dashboard)/knowledge/_components/kb-mention-menu.tsx)
или [kb-page-actions.tsx](../src/app/(dashboard)/knowledge/_components/kb-page-actions.tsx)
search). Display — chip с iconom + title целевой страницы (как
существующий `kbPageMention`).

**Открывает дверь** к фильтрации/group-by по property. Например:
«покажи все страницы, где Relation → СОТРУДНИК = Иванов». Это уже
mini-database-функционал.

Шкала: large. Нужен picker, индекс на jsonb (для фильтрации позже),
обработка cascade (что делать если целевая страница удалена).

### Date с временем + range

Расширение текущего `date`:
- `value: string | null` (ISO `yyyy-mm-dd`) → `value: { start: string; end?: string; hasTime?: boolean }`.
- Edit: `<input type="datetime-local">` если hasTime, иначе `date`.
- Range — два input'а в одну строку.

Reuses [react-day-picker](../package.json) который уже в deps.

### Per-property версионирование

Сейчас весь `properties` jsonb версионируется через kb_page_versions
(если оно вообще туда попадает — стоит проверить). Хочется fine-grained
audit: «кто и когда менял value именно этого property».

Дорого: новая таблица `kb_page_property_history` или JSON-патчи
снапшотами в kb_page_versions. Можно отложить пока.

## Tier 4 — слишком дорого / off-scope

### Formula / Rollup

Вычисляемые value на основе других properties или children'ов.
Notion имеет — мощно, но требует expression-парсера, безопасной
sandbox-execution, реактивного recompute. Не для нашего масштаба.

### Cross-page фильтрация в /knowledge listing

«Покажи все страницы где `Статус: В работе`». Нужен GIN-индекс на
`properties` jsonb + UI фильтра. Стратегически возможно, тактически —
после Relation type.

### Bulk edit

Выбрать несколько properties / pages → массовая правка value /
типа / цвета. UX-сложно, ниша.

### Audit log per-property

Log каждого изменения с timestamp + user. Нужна отдельная таблица.
Отдельный Tier 3 пункт «версионирование» — близко, но bulk-stream
log'а ещё дороже.

## Принципы проектирования

При добавлении нового типа держим:
1. **jsonb shape backwards-compatible** — старый клиент игнорирует
   новые поля и продолжает работать. Новый клиент handles fallback'ом
   для старых данных.
2. **Нет server-action кроме `saveKbPageProperties`** — все типы
   живут в одном UPDATE. Никакой per-type отдельной таблицы.
3. **Read-only mode** — новый UI должен корректно работать когда
   `canEdit=false` (read-only, без edit-control'ов).
4. **Touch-friendly** — все pickers / pop'ы должны открываться по tap'у
   на мобиле, не зависеть от hover'а.
5. **Тип ↔ display ↔ edit-control** — три cleanly-separated концерна
   на каждый тип. Убираем if-elseif-else в `PropertyValueControl`
   когда станет 8+ типов — выносим в map.

## Ссылки на текущую реализацию

- Миграция: [supabase/migrations/104_kb_page_properties.sql](../supabase/migrations/104_kb_page_properties.sql)
- Типы: [src/types/knowledge.ts](../src/types/knowledge.ts)
- Zod schemas: [src/lib/knowledge/schemas.ts](../src/lib/knowledge/schemas.ts)
- Server actions: [src/lib/knowledge/properties.ts](../src/lib/knowledge/properties.ts)
- UI: [src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx](../src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx)
- Templates copy logic: [src/lib/knowledge/templates.ts](../src/lib/knowledge/templates.ts) (см. `applyKbTemplate`).
- PRs: #116 (база), #118 (race fix), #120 (initial polish), #126 (codex review fixes).
