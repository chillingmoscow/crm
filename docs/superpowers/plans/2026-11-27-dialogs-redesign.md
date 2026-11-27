# Окна и подтверждения: новый вид — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Все окна приложения (подтверждения и маленькие формы) получают один вид: значок с тоном действия, заголовок 18px, список последствий, серая полоса кнопок с подсказкой клавиш, `⌘↵`.

**Architecture:** Вид задаётся в общих примитивах `src/components/ui/dialog.tsx` (геометрия, полоса кнопок, значок, подсказка клавиш) и в `ConfirmDialog` (тон, последствия, клавиши). Логика без JSX (тон, клавиши, перевод «impact» в последствия) — в отдельном модуле с `node:test`. Самописные подтверждения (`AlertDialog`, голый `Dialog`, `window.confirm`) переводятся на `ConfirmDialog` / новый `useConfirm`.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Tailwind v3, shadcn/Radix Dialog, lucide-react, `node:test`.

**Spec:** [`docs/superpowers/specs/2026-11-27-dialogs-redesign-design.md`](../specs/2026-11-27-dialogs-redesign-design.md), макет — [`2026-11-27-dialogs-redesign-mockup.html`](../specs/2026-11-27-dialogs-redesign-mockup.html), блок «★ Рекомендация со значком».

## Global Constraints

- Только токены дизайн-системы, без hex. Amber — `bg-amber-500/10 text-amber-700 dark:text-amber-400`; brand — `bg-brand/10 text-brand`; destructive — `bg-destructive/10 text-destructive`.
- Окно: `max-w-[480px]`, скругление 12px (`sm:rounded-xl`), отступы тела 24px (`p-6`).
- Значок: круг 40px (`size-10 rounded-full`), значок 20px (`size-5`), без колец, над заголовком, отступ 14px (`mb-3.5`).
- Заголовок 18px semibold (`text-[18px] font-semibold tracking-tight leading-tight`), описание `text-sm text-muted-foreground`.
- Полоса кнопок: фон `bg-muted/50`, `border-t`, отступы `py-3 pl-6 pr-4`, кнопки 40px (`size="default"`), справа «Отмена» (outline) + главная.
- Главная кнопка: brand для `default` и `warning`, destructive для `destructive`. Жёлтых кнопок нет.
- Выключенная главная кнопка внутри окна — своего цвета, `opacity-40` (и в `busy` тоже). Вне окон — как раньше (`disabled:bg-muted`).
- `⌘↵`/`Ctrl+↵` подтверждает в тонах `default` и `warning`; в `destructive` сочетания нет, подсказка «Esc отмена».
- Подсказка клавиш скрыта на телефоне (`hidden sm:flex`); на телефоне кнопки во всю ширину столбиком, главная сверху.
- Последствия только те, что уже написаны в описании или точно следуют из кода действия. Если есть список — описание максимум одна строка или нет.
- «Нельзя отменить» — один раз, последней строкой списка (`kind: "irreversible"`).
- Вторая кнопка «Отмена»; единственное исключение — «Не сохранять изменения?» и «Отменить изменения настроек?»: «Продолжить редактирование».
- Тексты, видимые пользователю, — по-русски. Движение `.motion-dialog` и `focusOverlayContent` не трогать.
- Перед каждым коммитом: `pnpm exec tsc --noEmit` и `pnpm lint` чистые.

## Review Focus

1. **`⌘↵` в многострочном поле при наборе с IME / в форме, где Enter уже что-то делает** — сочетание не должно срабатывать при `event.isComposing`, не должно отправлять дважды (кнопка + форма). Тест — Task 1, `isConfirmHotkey ignores composing`; Task 3, шаг ручной проверки «двойное нажатие».
2. **`⌘↵` во время `busy` или при `restriction`** — ничего не происходит. Тест — Task 1, `canConfirm`.
3. **Окна с собственными отступами (`p-0`) и `DialogFooter` внутри** — полоса кнопок не уезжает за край и не задваивается. Проверка — Task 7, таблица по всем 28 `DialogContent`.
4. **Длинный заголовок с именем** («Удалить контрагента «ООО Очень длинное название…»?») — переносится, не налезает на крестик. Ручная проверка — Task 9.
5. **Тёмная тема** — полоса `bg-muted/50`, подложки значков `/10`, бледная кнопка `opacity-40` читаемы. Ручная проверка — Task 9.

---

## Файлы

| Файл | Что |
|---|---|
| `src/components/ui/dialog-tone.ts` (новый) | Тон, классы значка, классы выключенной кнопки, клавиши, `impact → consequences`. Без JSX и без lucide. |
| `src/components/ui/dialog-tone.test.mts` (новый) | Тесты модуля выше. |
| `src/components/ui/dialog.tsx` | Новая геометрия, `DialogFooter` полосой, новые `DialogIcon`, `DialogHotkeyHint`. |
| `src/components/ui/button.tsx` | Только комментарий о выключенном виде (Task 8). |
| `src/components/shared/confirm-dialog.tsx` | Тон, значок, последствия, `cancelLabel`, клавиши; `useConfirm`. |
| `src/components/shared/archive-confirm-dialog.tsx`, `hard-delete-confirm-dialog.tsx` | Таблицы → последствия. |
| `src/components/shared/discard-changes-dialog.tsx` | На `ConfirmDialog`. |
| `src/components/ui/alert-dialog.tsx` | Удалить, когда пользователей не останется. |
| Экраны | См. задачи 5–8. |
| `docs/design-system.md`, `docs/handbook/shell/index.md` | Правила и справка. |

---

### Task 1: Модуль тона и клавиш

**Files:**
- Create: `src/components/ui/dialog-tone.ts`
- Test: `src/components/ui/dialog-tone.test.mts`

**Interfaces:**
- Produces:
  - `export type DialogTone = "default" | "warning" | "destructive"`
  - `export function resolveDialogTone(p: { destructive?: boolean; tone?: DialogTone }): DialogTone` — `destructive: true` → `"destructive"`, иначе `tone ?? "default"`.
  - `export const DIALOG_TONE_ICON_CLASS: Record<DialogTone, string>` — классы подложки и цвета значка из Global Constraints.
  - `export const DIALOG_CTA_DISABLED_CLASS: Record<DialogTone, string>` — `default`/`warning`: `"disabled:bg-brand disabled:text-brand-foreground disabled:opacity-40"`; `destructive`: `"disabled:bg-destructive disabled:text-destructive-foreground disabled:opacity-40"`.
  - `export type HotkeyEventLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean }`
  - `export function isConfirmHotkey(e: HotkeyEventLike): boolean` — `Enter` с `metaKey` или `ctrlKey`, без `altKey`/`shiftKey`, не `isComposing`.
  - `export function hotkeyAllowed(tone: DialogTone): boolean` — `tone !== "destructive"`.
  - `export function canConfirm(s: { busy?: boolean; confirmDisabled?: boolean; restricted?: boolean }): boolean`
  - `export function hotkeyVerb(confirmLabel: string): string` — первое слово подписи в нижнем регистре («Перевести в «Не подходит»» → «перевести»).
  - `export type ConsequenceKind = "info" | "keep" | "remove" | "unlink" | "archive" | "irreversible"`
  - `export type ConsequenceData = { kind: ConsequenceKind; text: string; count?: number }`
  - `export function deleteImpactToConsequences(impact: { label: string; count: number; tone: "cascade" | "unbind" }[]): ConsequenceData[]` — строки с `count > 0`; `cascade` → `{ kind: "remove", text: \`${label}: удалится вместе с записью\`, count }`; `unbind` → `{ kind: "unlink", text: \`${label}: отвяжется, но сохранится\`, count }`; сначала все `cascade`, потом `unbind`; последней всегда `{ kind: "irreversible", text: "Удаление нельзя отменить" }`.
  - `export function archiveImpactToConsequences(impact: { label: string; count: number }[]): ConsequenceData[]` — строки с `count > 0` → `{ kind: "archive", text: \`${label}: сохранится в архиве\`, count }`.

- [ ] **Step 1: Написать тесты** (`import { … } from "./dialog-tone.ts";`)
  - `resolveDialogTone`: `{destructive:true, tone:"warning"}` → `"destructive"`; `{tone:"warning"}` → `"warning"`; `{}` → `"default"`.
  - `isConfirmHotkey`: `{key:"Enter", metaKey:true}` → true; `ctrlKey:true` → true; без модификатора → false; `shiftKey:true`+meta → false; `isComposing:true`+meta → false (**ignores composing**); `key:"a"`+meta → false.
  - `hotkeyAllowed("destructive")` → false; `"warning"`, `"default"` → true.
  - `canConfirm({})` → true; `{busy:true}`, `{confirmDisabled:true}`, `{restricted:true}` → false.
  - `hotkeyVerb("Перевести в «Не подходит»")` → `"перевести"`; `hotkeyVerb("Отправить")` → `"отправить"`.
  - `deleteImpactToConsequences([{label:"Смены",count:3,tone:"unbind"},{label:"Акты",count:0,tone:"cascade"},{label:"Заметки",count:2,tone:"cascade"}])` → `[{kind:"remove",text:"Заметки: удалится вместе с записью",count:2},{kind:"unlink",text:"Смены: отвяжется, но сохранится",count:3},{kind:"irreversible",text:"Удаление нельзя отменить"}]`.
  - `deleteImpactToConsequences([])` → только строка `irreversible`.
  - `archiveImpactToConsequences([{label:"Склады",count:2},{label:"Акты",count:0}])` → `[{kind:"archive",text:"Склады: сохранится в архиве",count:2}]`.
  - Все ключи `DialogTone` есть в обоих `Record`.

- [ ] **Step 2: Запустить — падает**
  Run: `node --test --experimental-strip-types src/components/ui/dialog-tone.test.mts`
  Expected: FAIL (модуля нет).

- [ ] **Step 3: Реализовать `dialog-tone.ts`** по Interfaces.

- [ ] **Step 4: Запустить — проходит**
  Run: та же команда. Expected: все тесты PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/ui/dialog-tone.ts src/components/ui/dialog-tone.test.mts
  git commit -m "Окна: тон, клавиши и последствия — общая логика"
  ```

---

### Task 2: Примитивы окна

**Files:**
- Modify: `src/components/ui/dialog.tsx`

**Interfaces:**
- Consumes: `DialogTone`, `DIALOG_TONE_ICON_CLASS` (Task 1).
- Produces:
  - `DialogContent` — классы по умолчанию: `max-w-[480px] gap-4 p-6 sm:rounded-xl border bg-background shadow-[0_24px_56px_-16px_rgb(9_9_11/0.28)]` (тень — единственный произвольный цвет, через `rgb(9_9_11/…)` как в `foreground`; если в `tailwind.config.ts` есть подходящий `shadow-*` — взять его). Крестик: `right-5 top-5`, `text-muted-foreground`.
  - `DialogHeader` — `flex flex-col gap-1.5 text-left` (без `text-center` на телефоне).
  - `DialogTitle` — 18px из Global Constraints. Чтобы длинный заголовок не налезал на крестик, у `DialogContent` без `hideClose` первому блоку нужен правый отступ ≥ 32px — способ на выбор исполнителя.
  - `DialogDescription` — `text-sm leading-normal text-muted-foreground`.
  - `DialogFooter({ hint?: ReactNode, className, ...props })` — полоса: `-mx-6 -mb-6 mt-2 flex flex-col-reverse gap-2 border-t bg-muted/50 py-3 pl-6 pr-4 sm:flex-row sm:items-center sm:justify-end sm:rounded-b-xl`; `hint` рисуется первым элементом с `hidden sm:flex mr-auto items-center gap-1.5 text-xs text-muted-foreground`. На телефоне кнопки `w-full` (через `[&>button]:w-full sm:[&>button]:w-auto`).
  - `DialogIcon({ tone, icon: Icon }: { tone: DialogTone; icon: LucideIcon })` — круг из Global Constraints + `DIALOG_TONE_ICON_CLASS[tone]`, `aria-hidden`.
  - `DialogHotkeyHint({ keys, label }: { keys: string[]; label: string })` — `kbd`-чипы в стиле `hotkeys-dialog.tsx:21` + подпись. Для `⌘↵`: `keys={["⌘", "↵"]}`; на Windows/Linux показывать `Ctrl` вместо `⌘` (определять по `navigator.platform` после монтирования, по умолчанию `⌘`).
  - Выключенный вид главной кнопки переопределяется классом `DIALOG_CTA_DISABLED_CLASS[tone]` через `className` кнопки: `cn()` (tailwind-merge) заменяет `disabled:bg-muted`/`disabled:opacity-100` из варианта. `button.tsx` в этой задаче не меняется.

- [ ] **Step 1: Внести изменения в `dialog.tsx`** по Interfaces. Экспортировать `DialogIcon`, `DialogHotkeyHint`.
- [ ] **Step 2: Проверка типов и линт**
  Run: `pnpm exec tsc --noEmit && pnpm lint`
  Expected: без ошибок.
- [ ] **Step 3: Найти окна, где `DialogFooter` стоит внутри `DialogContent` с `p-0`/своими отступами**
  Run: `grep -rln "DialogFooter" src | xargs grep -l "p-0"`
  Expected: список; каждое такое окно разбирается в Task 7 (записать список в описание коммита).
- [ ] **Step 4: Commit**
  ```bash
  git add src/components/ui/dialog.tsx
  git commit -m "Окна: новая геометрия, полоса кнопок, значок и подсказка клавиш"
  ```

---

### Task 3: `ConfirmDialog` и `useConfirm`

**Files:**
- Modify: `src/components/shared/confirm-dialog.tsx`

**Interfaces:**
- Consumes: Task 1 целиком; `DialogIcon`, `DialogHotkeyHint`, `DialogFooter({hint})` (Task 2).
- Produces:
  - Новые свойства `ConfirmDialog` (старые без изменений):
    - `tone?: DialogTone` — вместе с `destructive` через `resolveDialogTone`.
    - `icon?: LucideIcon` — по умолчанию: `destructive` → `Trash2`, `warning` → `AlertTriangle`, `default` → `Info`.
    - `consequences?: DialogConsequence[]`, где `export type DialogConsequence = { text: ReactNode; count?: number; kind?: ConsequenceKind; icon?: LucideIcon }`. Значок строки: `icon` ?? по `kind`: `info` → `Info`, `keep` → `Check`, `remove` → `Trash2`, `unlink` → `Unlink`, `archive` → `Archive`, `irreversible` → `AlertTriangle`; без `kind` → `Info`. Строка `irreversible` — значок `text-destructive`, остальные `text-muted-foreground`.
    - `cancelLabel?: string` — по умолчанию «Отмена».
  - Блок последствий: `<ul class="divide-y rounded-[10px] border text-sm">`, строка `flex gap-2.5 px-3 py-2.5`, значок `size-4 mt-0.5`, `count` справа `ml-auto font-medium tabular-nums`. Стоит после описания, до `children`.
  - Порядок в теле: `DialogIcon` → заголовок → описание → последствия → `children` → `restriction`/`error`.
  - Главная кнопка: `variant` по тону (`destructive` → `"destructive"`, иначе `"default"`), `className={DIALOG_CTA_DISABLED_CLASS[tone]}`.
  - Подсказка: если `hotkeyAllowed(tone)` → `<DialogHotkeyHint keys={["⌘","↵"]} label={hotkeyVerb(confirmLabel)} />`, иначе `<DialogHotkeyHint keys={["Esc"]} label="отмена" />`.
  - Клавиши: `onKeyDown` на `DialogContent`: если `isConfirmHotkey(e) && hotkeyAllowed(tone) && canConfirm({busy, confirmDisabled, restricted: !!restriction})` → `e.preventDefault(); onConfirm()`.
  - `export type ConfirmOptions = Pick<ConfirmDialogProps, "title" | "description" | "confirmLabel" | "destructive" | "tone" | "icon" | "consequences" | "cancelLabel">`
  - `export function useConfirm(): { confirm: (o: ConfirmOptions) => Promise<boolean>; dialog: ReactNode }` — промис решается `true` по главной кнопке, `false` по отмене/закрытию; одновременно одно окно (новый вызов при открытом — решает предыдущий `false`).
  - `ConfirmDialogProps` экспортировать.

- [ ] **Step 1: Реализовать** по Interfaces.
- [ ] **Step 2: Проверка типов и линт** — `pnpm exec tsc --noEmit && pnpm lint`, без ошибок.
- [ ] **Step 3: Тесты модуля по-прежнему проходят** — `node --test --experimental-strip-types src/components/ui/dialog-tone.test.mts`, PASS.
- [ ] **Step 4: Commit**
  ```bash
  git add src/components/shared/confirm-dialog.tsx
  git commit -m "ConfirmDialog: значок с тоном, список последствий, ⌘↵, useConfirm"
  ```

---

### Task 4: Архив и «Удалить навсегда»

**Files:**
- Modify: `src/components/shared/archive-confirm-dialog.tsx`, `src/components/shared/hard-delete-confirm-dialog.tsx`

**Interfaces:**
- Consumes: `archiveImpactToConsequences`, `deleteImpactToConsequences` (Task 1); `ConfirmDialog` `tone`/`icon`/`consequences` (Task 3).
- Produces: внешние свойства обоих компонентов не меняются.

- [ ] **Step 1: `ArchiveConfirmDialog`** — `tone="warning"`, `icon={Archive}`, `consequences={archiveImpactToConsequences(impact)}`; убрать самописный список «Сохранится в архиве». Описание по умолчанию — одна строка: «Это не удаление: запись скроется из списков, вернуть её можно из архива раздела.»
- [ ] **Step 2: `HardDeleteConfirmDialog`** — `destructive`, `icon={Trash2}`; без блокировки: `consequences={deleteImpactToConsequences(impact)}`, описание «Если сомневаетесь, отправьте запись в архив.»; убрать `ImpactList`. С блокировкой: блок «Мешает удалению» остаётся как есть (это `restriction`, не последствие), последствий нет.
- [ ] **Step 3: Проверка** — `pnpm exec tsc --noEmit && pnpm lint`, без ошибок.
- [ ] **Step 4: Commit**
  ```bash
  git add src/components/shared/archive-confirm-dialog.tsx src/components/shared/hard-delete-confirm-dialog.tsx
  git commit -m "Архив и удаление навсегда: таблицы стали списком последствий"
  ```

---

### Task 5: Самописные подтверждения → `ConfirmDialog`

**Files:**
- Modify: `src/components/shared/discard-changes-dialog.tsx`
- Modify: `src/app/(dashboard)/sales/settings/_components/settings-drawer.tsx` (~стр. 285–305)
- Modify: `src/app/(dashboard)/knowledge/trash/_components/trash-item-row.tsx` (~150), `kb-trash-client.tsx` (~215), `kb-empty-trash-button.tsx` (~55), `src/app/(dashboard)/knowledge/_components/kb-deleted-page-banner.tsx` (~145)
- Modify: `src/app/(dashboard)/schedule/tasks/delete-task-dialog.tsx`, `src/app/(dashboard)/schedule/_components/schedule-client.tsx` (~2716–2755), `src/app/(dashboard)/schedule/_components/apply-template-dialog.tsx`
- Modify: `src/app/(dashboard)/org/venues/[venueId]/_components/floor-plan-tab.tsx` (527, 586, 663), `src/app/(dashboard)/knowledge/_components/kb-template-picker.tsx` (100)
- Delete: `src/components/ui/alert-dialog.tsx` (если после задачи `grep -rl "ui/alert-dialog" src` пуст)

**Interfaces:**
- Consumes: `ConfirmDialog`, `useConfirm`, `cancelLabel` (Task 3).

- [ ] **Step 1: `useDiscardGuard`** — `dialog` на `ConfirmDialog`: `title="Не сохранять изменения?"`, `description` как сейчас, `confirmLabel="Не сохранять"`, `cancelLabel="Продолжить редактирование"`, `tone="warning"`, `icon={Undo2}`. Сигнатура хука не меняется.
- [ ] **Step 2: `settings-drawer`** — то же для «Отменить изменения настроек?», `cancelLabel="Продолжить редактирование"`, `tone="warning"`.
- [ ] **Step 3: Корзина базы знаний (4 файла)** — «Удалить навсегда?» и «Очистить корзину?» → `ConfirmDialog destructive`, тексты сохранить; если описание перечисляет, что удалится, — в `consequences` с последней строкой `{kind:"irreversible", text:"Удаление нельзя отменить"}`.
- [ ] **Step 4: Расписание (3 файла)** — `delete-task-dialog`: `destructive`, `consequences`: `{kind:"remove", text:"Будущие незаполненные задания отменятся"}`, `{kind:"keep", text:"Задания на сегодня, переносы, начатые отчёты и фото, история и начисления сохранятся"}`; описание «„{name}" исчезнет из списка.». Общее подтверждение в `schedule-client` — на `ConfirmDialog` c его `destructive`. `apply-template-dialog` — содержит выбор периода (кнопки), перенести их в `children`; `tone="default"`, `icon={CalendarSync}` (или `RefreshCw`, если такого значка нет в установленной версии lucide).
- [ ] **Step 5: `window.confirm` (4 места)** — через `useConfirm`: зал «Переключить зал без сохранения?» (`tone="warning"`, `confirmLabel="Переключить"`), «Удалить зал «{name}»?» (`destructive`, `confirmLabel="Удалить зал"`), «Сбросить локальный черновик?» (`tone="warning"`, `confirmLabel="Сбросить"`, описание «Загрузим данные из базы.»), шаблон «Удалить шаблон «{name}»?» (`destructive`, `confirmLabel="Удалить шаблон"`). Синхронные проверки превращаются в `if (!(await confirm({...}))) return;`; `dialog` отрисовать в компоненте.
- [ ] **Step 6: Удалить `alert-dialog.tsx`**
  Run: `grep -rl "ui/alert-dialog" src`
  Expected: пусто → удалить файл.
- [ ] **Step 7: Проверка** — `pnpm exec tsc --noEmit && pnpm lint`, без ошибок; `grep -rn "window.confirm(" src | grep -v table-lab` — пусто.
- [ ] **Step 8: Commit**
  ```bash
  git add -A src
  git commit -m "Подтверждения: AlertDialog, голые Dialog и window.confirm — на общем ConfirmDialog"
  ```

---

### Task 6: Тон, значок и последствия на экранах

**Files:** все файлы с `<ConfirmDialog` (`grep -rl "<ConfirmDialog" src`), кроме разобранных в Tasks 4–5.

**Interfaces:**
- Consumes: `tone`, `icon`, `consequences` (Task 3).

Таблица тонов для подтверждений без `destructive` (остальные — `destructive` по умолчанию, значок `Trash2`, если действие не удаление — подобрать по смыслу: увольнение `UserMinus`, отмена операции `Ban`):

| Экран / заголовок | `tone` | `icon` |
|---|---|---|
| «Отправить … в архив?», «Убрать чат … в архив?» (stores, counterparties, categories, recurring, telegram-chats) | `warning` | `Archive` |
| «Восстановить …?», «Вернуть … из архива?» (venues, legal-entities, staff-detail, counterparty-card, accounts) | `default` | `ArchiveRestore` |
| «… не подходит?» (candidate-status-change) | `warning` | `UserX` |
| «Выпустить новый ключ Tilda?» | `warning` | `KeyRound` |
| «Отозвать заявку на замену?» (shift-swap) | `warning` | `Undo2` |
| «Пересчитать историю за …?» (sales-settings-tab) | `default` | `RefreshCw` |
| «Применить исключения к прошлым актам?» (exclusions-sheet) | `default` | `ListChecks` |
| «Сменить счёт выплат» (payroll-payments-table) | `default` | `Landmark` |
| «Изменить N операций» (bulk-edit-dialog) | `default` | `Pencil` |
| «Сохранить изменения?» (recurring-form-sheet) | `default` | `Save` |
| «Кто платит за …?» (bulk-pool-dialog) | `default` | `Wallet` |
| «Отправить на пересчёт …?» (recount-split-dialog) | `default` | `RotateCcw` |
| «Подвести итоги акта № …?» (results-table) | `default` | `ClipboardCheck` |
| «Пригласить в чаты Telegram?» (staff-chat-invites) | `default` | `Send` |
| attendance-review, transactions-page (2), results-table (2 с вычисляемым заголовком), payment-panel | прочитать действие: обратимо с последствиями → `warning`, иначе `default`; значок по смыслу | |

- [ ] **Step 1: Проставить `tone`/`icon`** по таблице во всех файлах.
- [ ] **Step 2: Последствия** — пройти все `<ConfirmDialog` с `description`, где перечислено больше одного следствия («…, а …», «… сохранятся», «… станет …»): разложить в `consequences`, описание сократить до одной строки или убрать. Не добавлять следствий, которых нет в тексте или в коде действия.
- [ ] **Step 3: Проверка** — `pnpm exec tsc --noEmit && pnpm lint`, без ошибок. `grep -rn -A25 "<ConfirmDialog" src | grep -c "tone=\|destructive"` ≈ числу вхождений `<ConfirmDialog` (каждое помечено).
- [ ] **Step 4: Commit**
  ```bash
  git add -A src
  git commit -m "Подтверждения: тон, значки и последствия на экранах"
  ```

---

### Task 7: Остальные окна — формы, база знаний, исключения

**Files:**
- Modify: `src/components/shared/support-report-dialog.tsx`
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-actions.tsx` (~170–230), `kb-save-as-template-dialog.tsx` (~99), `kb-template-picker.tsx` (~129), `kb-import-dialog-body.tsx` (~1243)
- Check: все 28 `<DialogContent` (`grep -rn "<DialogContent" src`)

**Interfaces:**
- Consumes: `DialogIcon`, `DialogHotkeyHint`, `DialogFooter({hint})`, `isConfirmHotkey`, `DIALOG_CTA_DISABLED_CLASS` (Tasks 1–2), `ConfirmDialog` (Task 3).

- [ ] **Step 1: «Помощь и поддержка»** — `DialogIcon tone="default" icon={LifeBuoy}` над заголовком; `DialogFooter hint={<DialogHotkeyHint keys={["⌘","↵"]} label="отправить" />}`; `onKeyDown` на `DialogContent`: `isConfirmHotkey(e)` и форма валидна и не отправляется → отправить (одна отправка: та же функция, что у кнопки, с защитой от повторного вызова во время отправки). Кнопка «Отправить» — `className={DIALOG_CTA_DISABLED_CLASS.default}`.
- [ ] **Step 2: `kb-page-actions`** — удаление страницы на `ConfirmDialog destructive`, `title` как сейчас, `consequences`: при `childCount > 0` `{kind:"remove", text:"Подстраницы переедут в корзину вместе с ней", count: childCount}`; всегда `{kind:"keep", text:"Восстановить можно из корзины"}`. Самописную шапку и `p-0` убрать.
- [ ] **Step 3: `kb-save-as-template-dialog`, `kb-template-picker`, `kb-import-dialog-body`** — убрать `p-0 gap-0` и самописные шапку/крестик/подвал, собрать на `DialogHeader` + `DialogIcon tone="default"` (значок, который стоит там сейчас) + `DialogFooter`. Содержимое и поведение не менять.
- [ ] **Step 4: Исключения** — для каждого `<DialogContent` из списка в spec («Не окна-решения»: `kb-version-history`, `command-palette.tsx`, `kb-search-dialog.tsx`, `nomenclature-photo-dialog`, фото в `payroll-journal`, `document-editor` ~1119, `document-preview-dialog`, `kb-gallery-block`, `hotkeys-dialog`, `payroll-workspace`, `counterparty-group-select`) убедиться, что новые значения по умолчанию (`max-w-[480px]`, `rounded-xl`, тень) не меняют их вид; где меняют — вернуть явным `className` (прежние `max-w-lg`/`sm:rounded-lg`, если не было своих). Остальные окна с `DialogFooter` — открыть и проверить, что полоса кнопок встала ровно.
- [ ] **Step 5: Проверка** — `pnpm exec tsc --noEmit && pnpm lint`, без ошибок.
- [ ] **Step 6: Commit**
  ```bash
  git add -A src
  git commit -m "Окна: форма поддержки и окна базы знаний в общем виде, исключения для просмотрщиков"
  ```

---

### Task 8: Документация

**Files:**
- Modify: `docs/design-system.md` — «Modal» (~стр. 305–325), правила подтверждений, «Подтверждение — общий `ConfirmDialog`» (~250), строка таблицы компонентов (~477), таблица скруглений (~1202: «диалог 8» → «диалог 12»), правило выключенной кнопки (найти по «disabled:bg-muted» / «серая»), список примитивов (~532: убрать `AlertDialog`), строка 216 про движение (убрать `AlertDialog`).
- Modify: комментарий в `src/components/ui/button.tsx` о выключенном виде — дописать исключение для окон.
- Modify: `docs/handbook/shell/index.md` — пункт «Окна подтверждения»: цвет значка (красный — необратимо, жёлтый — внимание, синий — обычное), `⌘↵`/`Ctrl+↵` подтверждает, кроме удаления; `Esc` закрывает.

- [ ] **Step 1: Обновить** перечисленное. Тоны, геометрию и исключения взять из Global Constraints; без имён компонентов в handbook.
- [ ] **Step 2: Commit**
  ```bash
  git add docs/design-system.md docs/handbook/shell/index.md src/components/ui/button.tsx
  git commit -m "Дизайн-система и справка: новый вид окон"
  ```

---

### Task 9: Проверка целиком

- [ ] **Step 1: Автопроверки**
  Run: `pnpm exec tsc --noEmit && pnpm lint && node --test --experimental-strip-types "src/**/*.test.mts"`
  Expected: всё зелёное.
- [ ] **Step 2: Живая проверка в браузере** (dev-сервер `pnpm dev` в фоне через Bash, локальная БД `pnpm db:start`, вход тестовым пользователем из `supabase/seed.sql`). Открыть и сделать скриншот:
  - кандидат → «Не подходит»: значок жёлтый, кнопка бледно-синяя до ввода причины, `⌘↵` из поля причины переводит, повторный `⌘↵` во время сохранения ничего не делает;
  - архив склада/контрагента: жёлтый значок, список «сохранится в архиве»;
  - «Удалить навсегда» (заведение или юрлицо в архиве): красный значок, последняя строка «Удаление нельзя отменить», `⌘↵` не срабатывает, подсказка «Esc отмена»;
  - закрытие панели с изменениями («Не сохранять изменения?»): кнопка «Продолжить редактирование»;
  - «Помощь и поддержка»: синий значок, `⌘↵` отправляет один раз;
  - палитра ⌘K и просмотр фото номенклатуры — вид прежний;
  - длинное название в заголовке подтверждения — переносится.
  Повторить три первых окна в тёмной теме и на ширине 375px.
- [ ] **Step 3: Итог** — перечислить пользователю, что проверено, а что не удалось проверить (и почему).
