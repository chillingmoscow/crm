# KB Page Header Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the top of a KB document page (properties panel + its menus/popovers + page-level comments + @mention dropdown) into pixel-alignment with the `sheerly.pen` design (nodes `qoPct`, `ozpX7`, `DNk3D`, `ftE6v`, `mzhv4`, `NYvdb`, `zSR3f`, `ilYPS`) while staying inside our design tokens.

**Architecture:** Pure client-side restyle + structural rework of existing React components under `src/app/(dashboard)/knowledge/_components/` and `src/components/knowledge/page-comments/`. No DB / server-action / schema changes. No new property type (the `ilYPS` "Найти пользователя" popover is the existing comment @mention dropdown, restyled). The shared `<Calendar>`/`<DatePicker>` are NOT mutated (used by finance/staff/onboarding) — a KB-scoped date popover is added instead. Behaviour and the full set of extended property options (number units, checkbox switch, rating slider, scale) are preserved; only presentation and the option-editor information architecture change.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v3, shadcn/ui (Popover, DropdownMenu, Select, Checkbox), `react-day-picker` v9 via `@/components/ui/calendar`, `date-fns`, `@dnd-kit` (already used for property reorder), `lucide-react`. Tests: `node:test` (`*.test.mts`) for pure helpers only — visual components are verified via `tsc`, `lint`, and a dev-server screenshot diff against the `.pen` node.

**Design source of truth:** `sheerly.pen` via `mcp__pencil__get_screenshot` + `docs/design-system.md`. Colours that diverge from our palette use OUR tokens (see `src/lib/palette.ts`, `docs/design-system.md` → "Цвета — главное правило"). Never hardcode hex.

**Verification model (every task):** This repo has no jsdom/RTL harness; `node:test` covers pure logic only. So each visual task ends with this loop:
1. `pnpm exec tsc --noEmit` → expected: no errors.
2. `pnpm lint` → expected: no errors/warnings on touched files.
3. Dev check: `pnpm dev`, open a KB page with mixed properties + a comment, compare the touched UI against the named `.pen` node screenshot (`mcp__pencil__get_screenshot` with that `nodeId`). Confirm spacing/typography/tokens match within design-system tolerances.
4. Commit.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/(dashboard)/knowledge/_components/page-properties/section-label.tsx` | Reusable uppercase eyebrow label ("СВОЙСТВА"/"КОММЕНТАРИИ") | Create |
| `src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx` | Properties panel: add СВОЙСТВА label, restyle add-property menu + property ⋯ context menu, move "Описание" into the menu, route select/multi-select to the new option-editor popover | Modify |
| `src/app/(dashboard)/knowledge/_components/page-properties/helpers.ts` | Add `PROPERTY_TYPE_ORDER` used by add-menu & type submenu | Modify |
| `src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.tsx` | KB-scoped date popover (month pill + quick chips + grid + footer) matching `rS3Ej` | Create |
| `src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.quick.test.mts` | Unit test for quick-date helpers | Create |
| `src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control-helpers.ts` | Pure helpers: `quickDateISO`, `formatPropertyDate` | Create |
| `src/app/(dashboard)/knowledge/_components/page-properties/option-editor-popover.tsx` | Unified select/multi-select option editor (`ftE6v`) + color grid (`mzhv4`) | Create |
| `src/app/(dashboard)/knowledge/_components/page-properties/option-editor.order.test.mts` | Unit test for color-grid ordering helper | Create |
| `src/lib/palette.ts` | Add `PALETTE_GRID` (2×5 order incl. `default`) reused by the color grid | Modify |
| `src/app/(dashboard)/knowledge/_components/page-properties/controls/select-control.tsx` | Replace inline "опции (N)" dropdown with the new option-editor popover trigger | Modify |
| `src/app/(dashboard)/knowledge/_components/page-properties/controls/multi-select-control.tsx` | Same as select-control | Modify |
| `src/app/(dashboard)/knowledge/_components/page-properties/controls/url-control.tsx` | Match `qoPct` link affordance (external-link arrow) | Modify |
| `src/components/knowledge/page-comments/kb-page-comments.tsx` | Add "КОММЕНТАРИИ" section label wrapper | Modify |
| `src/components/knowledge/page-comments/page-comment-item.tsx` | Context menu → Редактировать / Скопировать ссылку / Удалить; restyle | Modify |
| `src/components/knowledge/page-comments/page-comment-copy-link.ts` | Pure helper: build deep link to a comment | Create |
| `src/components/knowledge/page-comments/page-comment-copy-link.test.mts` | Unit test for the link builder | Create |
| `src/components/knowledge/blocks/kb-comment-mention-dropdown.tsx` | `DropdownList` restyle: search affordance + "Участники" label + palette avatar | Modify |
| `src/lib/avatar-color.ts` | Pure helper mapping a user id/name to a palette dot class (reused by mention list) | Create |
| `src/lib/avatar-color.test.mts` | Unit test for deterministic avatar colour | Create |

---

## Task 1: СВОЙСТВА / КОММЕНТАРИИ eyebrow label component

The design (`qoPct`) shows an uppercase, letter-spaced, muted micro-label "СВОЙСТВА" above the property rows and "КОММЕНТАРИИ" above the comment thread. Today there is no label for page properties (only `PropertyGroupHeader` for collection groups) and none for comments.

**Files:**
- Create: `src/app/(dashboard)/knowledge/_components/page-properties/section-label.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { cn } from "@/lib/utils";

/**
 * Notion-style секционный eyebrow над блоками верха KB-страницы
 * («СВОЙСТВА», «КОММЕНТАРИИ»). Дизайн: sheerly.pen → qoPct.
 * Caption-шкала DS (12px/500) в uppercase + tracking, muted.
 */
export function KbSectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-2 -ml-2 text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70 leading-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/knowledge/_components/page-properties/section-label.tsx
git commit -m "feat(kb): add reusable section eyebrow label for page header"
```

---

## Task 2: Render "СВОЙСТВА" label above the property rows

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx` (import + render around line 576-610)

- [ ] **Step 1: Import the label**

In `kb-page-properties.tsx`, add to the import block that already imports from `./page-properties/helpers` (around line 89):

```tsx
import { KbSectionLabel } from "./page-properties/section-label";
```

- [ ] **Step 2: Render the label as the first child of the section**

In `KbPageProperties`'s returned JSX, the `<section aria-label="Свойства страницы" className="flex flex-col gap-2 px-2 -ml-2">` (line ~577). Insert the label as the first child, BUT only when there are page properties OR the user can add them (mirror the existing `if (!canEdit && properties.length === 0) return null;` guard at line 574 — that guard already prevents an empty section, so it is safe to always render the label inside):

```tsx
return (
  <section
    aria-label="Свойства страницы"
    className="flex flex-col gap-2 px-2 -ml-2"
  >
    <KbSectionLabel>Свойства</KbSectionLabel>
    {collectionGroups.length > 0 && (
```

Note: design label text is visually uppercase via CSS (`uppercase`), so pass natural-case "Свойства".

- [ ] **Step 3: Typecheck → Lint → Dev check**

Run: `pnpm exec tsc --noEmit` then `pnpm lint`. Expected: PASS.
Dev: open a KB page; compare the properties block header against `mcp__pencil__get_screenshot` nodeId `qoPct`. The "СВОЙСТВА" eyebrow must sit directly above the first property row, same left edge as the rows.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/knowledge/_components/kb-page-properties.tsx
git commit -m "feat(kb): render СВОЙСТВА section label above property rows (qoPct)"
```

---

## Task 3: Add `PROPERTY_TYPE_ORDER` and apply it to the Add-property menu (`ozpX7`)

Design `ozpX7` shows the add-property menu with a top "Добавить свойство" muted header and the type order: Текст, Число, Дата, Чекбокс, Выбор, Мультивыбор, Ссылка, Рейтинг. Currently `CREATABLE_PROPERTY_TYPES` is `Object.keys(TYPE_LABELS)` minus `rating` (line 41-43 of helpers.ts) — rating is excluded and order is object-key order. Design includes Рейтинг in the add menu.

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/page-properties/helpers.ts:41-54`
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx:736-781`

- [ ] **Step 1: Replace `CREATABLE_PROPERTY_TYPES` definition**

In `helpers.ts`, replace lines 41-54 (the `CREATABLE_PROPERTY_TYPES`, `SAVE_DEBOUNCE_MS` is line 45 — keep it where it is; only touch the array + `propertyTypeOptions`):

```ts
/** Canonical UI order (sheerly.pen → ozpX7 / DNk3D). */
export const PROPERTY_TYPE_ORDER: KbPropertyType[] = [
  "text",
  "number",
  "date",
  "checkbox",
  "select",
  "multi-select",
  "url",
  "rating",
];

export const CREATABLE_PROPERTY_TYPES: KbPropertyType[] = PROPERTY_TYPE_ORDER;

export const SAVE_DEBOUNCE_MS = 1500;

export function propertyTypeOptions(
  current?: KbPropertyType,
): KbPropertyType[] {
  if (current && !PROPERTY_TYPE_ORDER.includes(current)) {
    return [...PROPERTY_TYPE_ORDER, current];
  }
  return PROPERTY_TYPE_ORDER;
}
```

(Delete the old lines 45-54 `SAVE_DEBOUNCE_MS` + `propertyTypeOptions` to avoid a duplicate `SAVE_DEBOUNCE_MS`; the block above re-declares it once.)

- [ ] **Step 2: Add the muted header to the Add-property dropdown**

In `kb-page-properties.tsx`, the `<DropdownMenuContent align="start" className="min-w-[160px]">` at line ~753. Add a non-interactive header label as the first child and widen to match `ozpX7` (design popover 320 wide; our DS dropdowns are tighter — use `min-w-[220px]`):

```tsx
<DropdownMenuContent align="start" className="min-w-[220px]">
  <div className="px-2 py-1.5 text-[12px] font-medium text-muted-foreground/70">
    Добавить свойство
  </div>
  <DropdownMenuSeparator />
  {CREATABLE_PROPERTY_TYPES.map((t) => {
    const Icon = TYPE_ICONS[t];
    return (
      <DropdownMenuItem key={t} onSelect={() => addProperty(t)}>
        <Icon className="size-3.5 text-muted-foreground" />
        {TYPE_LABELS[t]}
      </DropdownMenuItem>
    );
  })}
</DropdownMenuContent>
```

`DropdownMenuSeparator` is already imported (line 57). Leave the trigger button text logic (`Добавить свойство страницы` vs `Добавить свойство`) untouched.

- [ ] **Step 3: Typecheck → Lint → Dev check**

`pnpm exec tsc --noEmit`; `pnpm lint`. Expected PASS.
Dev: open the add-property menu; compare against nodeId `ozpX7`. Header present, 8 items in the exact order Текст→Рейтинг, muted icons.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/knowledge/_components/page-properties/helpers.ts src/app/\(dashboard\)/knowledge/_components/kb-page-properties.tsx
git commit -m "feat(kb): canonical property-type order + header in add-property menu (ozpX7)"
```

---

## Task 4: Pure date helpers + unit test

Design datepicker (`rS3Ej`, used in `zSR3f`/`NYvdb`) has quick chips "Сегодня" / "Завтра" / "Через 7 дней", a "Выбрать сегодня" footer action, and renders the stored date as e.g. "15 апр 2026". Extract the pure logic first (testable with `node:test`).

**Files:**
- Create: `src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control-helpers.ts`
- Create: `src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.quick.test.mts`

- [ ] **Step 1: Write the failing test**

`date-control.quick.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { quickDateISO, formatPropertyDate } from "./date-control-helpers.ts";

test("quickDateISO('today') returns the given anchor date as YYYY-MM-DD", () => {
  const anchor = new Date(2026, 3, 15); // 15 Apr 2026 local
  assert.equal(quickDateISO("today", anchor), "2026-04-15");
});

test("quickDateISO('tomorrow') adds one day", () => {
  const anchor = new Date(2026, 3, 15);
  assert.equal(quickDateISO("tomorrow", anchor), "2026-04-16");
});

test("quickDateISO('in7') adds seven days, crossing month", () => {
  const anchor = new Date(2026, 3, 28);
  assert.equal(quickDateISO("in7", anchor), "2026-05-05");
});

test("formatPropertyDate renders ru short form", () => {
  assert.equal(formatPropertyDate("2026-04-15"), "15 апр. 2026 г.");
});

test("formatPropertyDate returns empty string for empty input", () => {
  assert.equal(formatPropertyDate(""), "");
  assert.equal(formatPropertyDate(null), "");
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test --experimental-strip-types "src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.quick.test.mts"`
Expected: FAIL (module `date-control-helpers.ts` not found).

- [ ] **Step 3: Implement the helpers**

`date-control-helpers.ts`:

```ts
export type QuickDate = "today" | "tomorrow" | "in7";

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD for a quick-pick relative to `anchor` (default: now). */
export function quickDateISO(kind: QuickDate, anchor: Date = new Date()): string {
  const base = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
  );
  if (kind === "tomorrow") base.setDate(base.getDate() + 1);
  if (kind === "in7") base.setDate(base.getDate() + 7);
  return toISO(base);
}

/** Display form for a stored date property value. Empty/invalid → "". */
export function formatPropertyDate(value: string | null | undefined): string {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test --experimental-strip-types "src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.quick.test.mts"`
Expected: PASS (5 tests). If `formatPropertyDate` assertion text differs from Node's ICU output, adjust the EXPECTED string in the test to the actual `toLocaleDateString("ru-RU", {day:"numeric",month:"short",year:"numeric"})` output on this Node — do not weaken the helper.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control-helpers.ts" "src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.quick.test.mts"
git commit -m "feat(kb): pure date helpers for KB date property control"
```

---

## Task 5: KB date popover control (`rS3Ej` / `zSR3f` / `NYvdb`)

Replace the native `<input type="date">` (kb-page-properties.tsx lines 1464-1476) with a Popover whose trigger shows the formatted date (or "—") and whose content is the shadcn `<Calendar>` styled per design + quick chips + footer. The shared `<Calendar>` is reused (NOT modified) with KB-scoped `classNames` and surrounding chrome.

**Files:**
- Create: `src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.tsx`
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx` (date `case` at line 1464-1476)

- [ ] **Step 1: Create `date-control.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ru } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  quickDateISO,
  formatPropertyDate,
  type QuickDate,
} from "./date-control-helpers";

function parseISO(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const QUICK: { kind: QuickDate; label: string; brand?: boolean }[] = [
  { kind: "today", label: "Сегодня" },
  { kind: "tomorrow", label: "Завтра" },
  { kind: "in7", label: "Через 7 дней", brand: true },
];

/**
 * KB date-property control. sheerly.pen → rS3Ej.
 * Trigger: значение «15 апр. 2026 г.» либо «—» (как остальные value-
 * контролы строки свойства). Popover: быстрые чипы + Calendar (наш
 * shadcn, ru-локаль) + футер «Без даты» / «Выбрать сегодня».
 *
 * Shared <Calendar> НЕ трогаем (используется в finance/staff/onboarding);
 * KB-специфика — только обёртка и className-оверрайды этого попапа.
 */
export function DateValueControl({
  value,
  canEdit,
  onChange,
}: {
  value: string | null;
  canEdit: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value ?? "");
  const display = formatPropertyDate(value);

  if (!canEdit) {
    return (
      <span className="text-[13px] tabular-nums">
        {display || "—"}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="min-h-7 inline-flex items-center text-left text-[13px] tabular-nums
                     rounded px-1 border border-transparent transition-colors
                     hover:border-input data-[state=open]:border-input
                     text-muted-foreground/50 data-[has-value=true]:text-foreground"
          data-has-value={display ? "true" : "false"}
          aria-label="Дата"
        >
          {display || "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto p-3 rounded-xl"
      >
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          {QUICK.map((q) => (
            <button
              key={q.kind}
              type="button"
              onClick={() => {
                onChange(quickDateISO(q.kind));
                setOpen(false);
              }}
              className={cn(
                "h-7 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                q.brand
                  ? "text-brand hover:bg-brand/10"
                  : "bg-secondary text-foreground hover:bg-accent",
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange(d ? toISO(d) : null);
            setOpen(false);
          }}
          locale={ru}
          showOutsideDays
          className="p-0"
          classNames={{
            caption_label:
              "select-none text-sm font-semibold text-brand bg-brand/10 rounded-full px-2.5 py-1",
            button_previous:
              "h-7 w-7 rounded-md bg-secondary hover:bg-accent inline-flex items-center justify-center",
            button_next:
              "h-7 w-7 rounded-md bg-secondary hover:bg-accent inline-flex items-center justify-center",
          }}
          components={{
            Chevron: ({ orientation, className }) =>
              orientation === "left" ? (
                <ChevronLeft className={cn("size-4", className)} />
              ) : (
                <ChevronRight className={cn("size-4", className)} />
              ),
          }}
        />
        <div className="flex items-center justify-between pt-2 text-[13px]">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Без даты
          </button>
          <button
            type="button"
            onClick={() => {
              onChange(quickDateISO("today"));
              setOpen(false);
            }}
            className="font-medium text-brand hover:underline"
          >
            Выбрать сегодня
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Wire it into the property value switch**

In `kb-page-properties.tsx`: add to the controls import group (near line 81-88):

```tsx
import { DateValueControl } from "./page-properties/controls/date-control";
```

Replace the entire `case "date":` block (lines 1464-1476) with:

```tsx
    case "date":
      return (
        <DateValueControl
          value={property.value}
          canEdit={canEdit}
          onChangeValue={onChangeValue}
          onChange={(v) => onChangeValue(v)}
        />
      );
```

Wait — keep prop names consistent with the component. The component above takes `onChange`. Use exactly:

```tsx
    case "date":
      return (
        <DateValueControl
          value={property.value}
          canEdit={canEdit}
          onChange={(v) => onChangeValue(v)}
        />
      );
```

- [ ] **Step 3: Typecheck → Lint**

`pnpm exec tsc --noEmit`; `pnpm lint`. Expected PASS. If `Calendar`'s `components.Chevron` prop type complains, drop the `components` override (the shared Calendar already supplies left/right chevrons) and keep only `classNames`.

- [ ] **Step 4: Dev check**

Open a KB page with a date property. Compare the closed trigger against `qoPct` (shows "15 апр 2026"-style) and the open popover against `rS3Ej`/`zSR3f`/`NYvdb`: brand month pill, ‹ › nav, quick chips row, today highlighted, footer "Без даты" / "Выбрать сегодня". Selected day uses brand (shared Calendar `data-[selected-single=true]:bg-primary` — acceptable per design-system "primary for neutral accent surfaces"; do NOT special-case).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/page-properties/controls/date-control.tsx" "src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx"
git commit -m "feat(kb): custom date popover for date property (rS3Ej/zSR3f/NYvdb)"
```

---

## Task 6: `PALETTE_GRID` + color-grid ordering unit test

Design `mzhv4` shows a 2-row × 5-col swatch grid in order: По умолч., Серый, Корич., Оранж., Жёлтый / Зелёный, Синий, Фиолет., Розовый, Красный — i.e. exactly `PALETTE_COLORS` order (which already starts with `default`). Add an explicit grid export so the popover and a test share one source of truth.

**Files:**
- Modify: `src/lib/palette.ts` (append near the end, after `paletteChip`)
- Create: `src/app/(dashboard)/knowledge/_components/page-properties/option-editor.order.test.mts`

- [ ] **Step 1: Write the failing test**

`option-editor.order.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE_GRID } from "../../../../../lib/palette.ts";

test("PALETTE_GRID is 10 entries, default first, matching mzhv4 order", () => {
  assert.equal(PALETTE_GRID.length, 10);
  assert.equal(PALETTE_GRID[0].name, "default");
  assert.deepEqual(
    PALETTE_GRID.map((c) => c.name),
    [
      "default",
      "gray",
      "brown",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
      "pink",
      "red",
    ],
  );
});
```

(Adjust the relative import depth so it resolves to `src/lib/palette.ts` from the test file's directory; verify with the failing run in Step 2.)

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test --experimental-strip-types "src/app/(dashboard)/knowledge/_components/page-properties/option-editor.order.test.mts"`
Expected: FAIL (`PALETTE_GRID` is not exported).

- [ ] **Step 3: Add `PALETTE_GRID` to palette.ts**

Append after `paletteChip` (end of file):

```ts
/** Свотч-грид для option-color picker (sheerly.pen → mzhv4):
 *  2×5, `default` первым. Тот же порядок, что PALETTE_COLORS. */
export const PALETTE_GRID = PALETTE_COLORS;
```

- [ ] **Step 4: Run test, verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/palette.ts "src/app/(dashboard)/knowledge/_components/page-properties/option-editor.order.test.mts"
git commit -m "feat(kb): PALETTE_GRID shared swatch order for option color picker (mzhv4)"
```

---

## Task 7: Unified option-editor popover (`ftE6v` + `mzhv4`)

Replace the inline "опции (N)" `DropdownMenu` (currently duplicated in `select-control.tsx` and `multi-select-control.tsx`) with a single popover matching `ftE6v`: header (type icon + type label), a read-only "Тип: <label>" chip row, "Опции" label, option rows (drag handle ⠿ + colour dot + name input + ✕), "+ Добавить опцию", separator, "Дублировать свойство", "Удалить свойство" (destructive). Each option's colour dot opens the `mzhv4` colour grid. Reorder uses `@dnd-kit` (already a dependency).

This popover needs callbacks the controls don't currently receive (`onDuplicate`, `onRemove`, reorder). It will be triggered from the property ⋯ position for select/multi-select; wiring happens in Task 8. Here we build the presentational+interaction component with an explicit prop API.

**Files:**
- Create: `src/app/(dashboard)/knowledge/_components/page-properties/option-editor-popover.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { Check, Copy, GripVertical, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PALETTE_GRID, paletteDot } from "@/lib/palette";
import type { KbPropertyColor } from "@/types/knowledge";

interface OptionEditorProps {
  /** Триггер (обычно ⋯-кнопка строки свойства). */
  trigger: React.ReactNode;
  typeLabel: string;
  typeIcon: React.ComponentType<{ className?: string }>;
  options: string[];
  optionColors: Partial<Record<string, KbPropertyColor>> | undefined;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    next: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function OptionEditorPopover({
  trigger,
  typeLabel,
  typeIcon: TypeIcon,
  options,
  optionColors,
  onChangeOptions,
  onChangeOptionColors,
  onDuplicate,
  onRemove,
}: OptionEditorProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const setColor = (option: string, color: KbPropertyColor | null) => {
    const next: Partial<Record<string, KbPropertyColor>> = {
      ...(optionColors ?? {}),
    };
    if (color === null) delete next[option];
    else next[option] = color;
    onChangeOptionColors(Object.keys(next).length > 0 ? next : undefined);
  };

  const removeOption = (option: string) => {
    onChangeOptions(options.filter((o) => o !== option));
  };

  const renameOption = (from: string, to: string) => {
    const v = to.trim();
    if (!v || v === from) return;
    if (options.includes(v)) {
      toast.warning("Такая опция уже есть");
      return;
    }
    onChangeOptions(options.map((o) => (o === from ? v : o)));
    const cur = optionColors?.[from];
    if (cur) {
      const next = { ...(optionColors ?? {}) };
      delete next[from];
      next[v] = cur;
      onChangeOptionColors(next);
    }
  };

  const commitAdd = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    if (options.includes(v)) {
      toast.warning("Такая опция уже есть");
      return;
    }
    onChangeOptions([...options, v]);
    setDraft("");
    setAdding(false);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = options.indexOf(String(active.id));
    const to = options.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChangeOptions(arrayMove(options, from, to));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[320px] p-0 rounded-[10px]"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <TypeIcon className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-semibold">{typeLabel}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-[12px] text-muted-foreground">Тип:</span>
          <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[12px] text-muted-foreground">
            {typeLabel}
          </span>
        </div>
        <div className="px-2 py-2">
          <div className="px-1 pb-1 text-[12px] text-muted-foreground/70">
            Опции
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={options}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col">
                {options.map((o) => (
                  <OptionRow
                    key={o}
                    option={o}
                    color={optionColors?.[o]}
                    onRename={(to) => renameOption(o, to)}
                    onRemove={() => removeOption(o)}
                    onSetColor={(c) => setColor(o, c)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {adding || options.length === 0 ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitAdd}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitAdd();
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              placeholder="Новая опция"
              className="mt-1 h-8 w-full rounded-md bg-transparent px-2 text-[13px]
                         border border-input outline-none
                         focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5
                         text-[13px] font-medium text-brand hover:bg-brand/10 transition-colors"
            >
              <Plus className="size-3.5" />
              Добавить опцию
            </button>
          )}
        </div>
        <div className="border-t border-border p-1.5">
          <button
            type="button"
            onClick={onDuplicate}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5
                       text-[13px] hover:bg-accent transition-colors"
          >
            <Copy className="size-3.5 text-muted-foreground" />
            Дублировать свойство
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5
                       text-[13px] text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="size-3.5" />
            Удалить свойство
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptionRow({
  option,
  color,
  onRename,
  onRemove,
  onSetColor,
}: {
  option: string;
  color?: KbPropertyColor;
  onRename: (to: string) => void;
  onRemove: () => void;
  onSetColor: (c: KbPropertyColor | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: option });
  const [name, setName] = useState(option);

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: DndCSS.Transform.toString(transform),
        transition,
      }}
      className="group/opt flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-accent/60"
    >
      <button
        type="button"
        aria-label="Перетащить опцию"
        className="size-5 inline-flex items-center justify-center text-muted-foreground/40
                   cursor-grab active:cursor-grabbing hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <OptionColorButton color={color} onSetColor={onSetColor} optionName={option} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onRename(name)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setName(option);
            e.currentTarget.blur();
          }
        }}
        className="flex-1 min-w-0 bg-transparent text-[13px] outline-none"
        aria-label={`Опция ${option}`}
      />
      <button
        type="button"
        aria-label={`Удалить опцию «${option}»`}
        onClick={onRemove}
        className="size-5 inline-flex items-center justify-center rounded
                   text-muted-foreground/40 hover:text-destructive transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/** Цветовая точка опции → grid-поповер (sheerly.pen → mzhv4). */
function OptionColorButton({
  color,
  onSetColor,
  optionName,
}: {
  color?: KbPropertyColor;
  onSetColor: (c: KbPropertyColor | null) => void;
  optionName: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Цвет опции"
          className={cn(
            "size-3 shrink-0 rounded-full",
            paletteDot(color ?? "default"),
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] p-3 rounded-[10px]"
      >
        <div className="flex items-center justify-between pb-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
            <span
              className={cn(
                "size-2.5 rounded-full",
                paletteDot(color ?? "default"),
              )}
            />
            {optionName}
          </span>
          <button
            type="button"
            onClick={() => onSetColor(null)}
            className="text-[12px] font-medium text-destructive hover:underline"
          >
            Удалить опцию
          </button>
        </div>
        <div className="text-[12px] text-muted-foreground/70 pb-1.5">Цвет</div>
        <div className="grid grid-cols-5 gap-1.5">
          {PALETTE_GRID.map((c) => {
            const isCurrent =
              (color ?? "default") === c.name ||
              (!color && c.name === "default");
            return (
              <button
                key={c.name}
                type="button"
                onClick={() =>
                  onSetColor(c.name === "default" ? null : c.name)
                }
                className="flex flex-col items-center gap-1"
                aria-label={c.label}
              >
                <span
                  className={cn(
                    "relative size-9 rounded-lg inline-flex items-center justify-center",
                    c.name === "default"
                      ? "border border-border bg-background"
                      : paletteDot(c.name),
                  )}
                >
                  {isCurrent && (
                    <Check
                      className={cn(
                        "size-4",
                        c.name === "default"
                          ? "text-foreground"
                          : "text-white",
                      )}
                    />
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground leading-none">
                  {c.label}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck → Lint**

`pnpm exec tsc --noEmit`; `pnpm lint`. Expected PASS. If `useSortable`/`arrayMove` import paths differ, mirror exactly the imports used in `kb-page-properties.tsx` (lines 30-46).

- [ ] **Step 3: Commit (component only — wired in Task 8)**

```bash
git add "src/app/(dashboard)/knowledge/_components/page-properties/option-editor-popover.tsx"
git commit -m "feat(kb): unified option-editor popover with color grid (ftE6v/mzhv4)"
```

---

## Task 8: Route select / multi-select to the option-editor popover

Remove the inline "опции (N)" `DropdownMenu` from both controls and instead expose the option editing through the property-row ⋯ for select/multi-select. The cleanest minimal wiring: keep the value controls focused on VALUE selection only, and render `OptionEditorPopover` from `kb-page-properties.tsx`'s `PropertyRow` ⋯ slot when `property.type` is `select`/`multi-select`, passing the existing `onChangeOptions` / `onChangeOptionColors` / `onDuplicate` / `onRemove` handlers it already has.

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/page-properties/controls/select-control.tsx` (delete lines 130-243 — the options `DropdownMenu` + add-input; keep the `<Select>` value picker, lines 96-129)
- Modify: `src/app/(dashboard)/knowledge/_components/page-properties/controls/multi-select-control.tsx` (delete lines 176-301 — options `DropdownMenu` + add-input + hidden remove buttons; keep popover value picker)
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx` (`PropertyRow` ⋯ block, lines 1070-1370)

- [ ] **Step 1: Trim `select-control.tsx`**

Delete the block from `{canEditOptions && property.options.length > 0 && (` (line 130) through the closing of the add-input `)}` (line 243), leaving the component as just the `<Select>` value picker wrapped in the `<div className="flex items-center gap-1.5 flex-wrap">`. Remove now-unused imports (`Button`, `DropdownMenu*`, `Input`, `Palette`, `Plus`, `X`, `Check`, `PALETTE_COLORS`, `paletteDot`, `toast`, `cn` if unused, `useState` if `adding/draft` removed). Keep `OptionChip`, `Select*`, `KbProperty*` types. The `canEditOptions` prop becomes unused — keep it in the signature (callers still pass it) but prefix with `_` or delete the prop and update both call sites in `kb-page-properties.tsx` (`PropertyValueControl` passes `canEditOptions`). Simpler: keep prop, stop using it.

Resulting `select-control.tsx` body (reference):

```tsx
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { KbProperty, KbPropertyColor } from "@/types/knowledge";
import { OptionChip } from "../option-chip";

export function SelectControl({
  property,
  canEdit,
  onChangeValue,
}: {
  property: Extract<KbProperty, { type: "select" }>;
  canEdit: boolean;
  canEditOptions?: boolean;
  onChangeValue: (value: string | null) => void;
  onChangeOptions?: (options: string[]) => void;
  onChangeOptionColors?: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
}) {
  if (!canEdit) {
    return property.value ? (
      <OptionChip
        value={property.value}
        explicit={property.optionColors?.[property.value]}
      />
    ) : (
      <span className="text-[13px] text-muted-foreground/50">—</span>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Select
        value={property.value ?? ""}
        onValueChange={(v) => onChangeValue(v === "__none__" ? null : v)}
      >
        <SelectTrigger
          className="h-7 w-auto min-w-[100px] max-w-[280px] text-[13px] border-transparent bg-transparent px-1
                     hover:border-input focus:border-input
                     [&>svg]:opacity-50 hover:[&>svg]:opacity-100"
        >
          {property.value ? (
            <OptionChip
              value={property.value}
              explicit={property.optionColors?.[property.value]}
            />
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </SelectTrigger>
        <SelectContent className="max-w-[320px]">
          <SelectItem value="__none__" className="text-muted-foreground">
            (не задано)
          </SelectItem>
          {property.options.map((o) => (
            <SelectItem key={o} value={o} className="py-1.5">
              <OptionChip value={o} explicit={property.optionColors?.[o]} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 2: Trim `multi-select-control.tsx`**

Keep lines 1-174 (the value picker popover with the checkbox list) and the closing `</div>`. Delete lines 176-301 (options `DropdownMenu`, add-input, sr-only + hidden remove buttons). Remove now-unused imports (`Button`, `DropdownMenu*`, `Check`, `Palette`, `Plus`, `X`, `Input`, `PALETTE_COLORS`, `paletteDot`, `cn`, `toast`) and the `adding`/`draft` state + `commitAdd`/`setOptionColor`/`removeChip` that are no longer referenced. Keep `useMemo`, `useState`(only if still used for `pickerOpen`), `selectedSet`, `toggleValue`. Result: component renders only the chips trigger + checkbox-list popover.

- [ ] **Step 3: Render `OptionEditorPopover` in the ⋯ slot for option types**

In `kb-page-properties.tsx` `PropertyRow`, the ⋯ menu lives in `<div className="size-6 shrink-0">` (line 1070). For `select`/`multi-select` we want the ⋯ button to open the `OptionEditorPopover` (which itself contains Дублировать/Удалить), instead of the generic `DropdownMenu`. Add import near line 88:

```tsx
import { OptionEditorPopover } from "./page-properties/option-editor-popover";
```

Replace the contents of `<div className="size-6 shrink-0">{canEdit && (<DropdownMenu>…</DropdownMenu>)}</div>` so that when `canEdit && (property.type === "select" || property.type === "multi-select")` it renders:

```tsx
<div className="size-6 shrink-0">
  {canEdit &&
  (property.type === "select" || property.type === "multi-select") ? (
    <OptionEditorPopover
      typeLabel={TYPE_LABELS[property.type]}
      typeIcon={TYPE_ICONS[property.type]}
      options={property.options}
      optionColors={property.optionColors}
      onChangeOptions={onChangeOptions}
      onChangeOptionColors={onChangeOptionColors}
      onDuplicate={onDuplicate}
      onRemove={onRemove}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 group-hover/row:opacity-100 focus:opacity-100"
          aria-label="Действия со свойством"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      }
    />
  ) : (
    canEdit && (
      <DropdownMenu>
        {/* …existing generic ⋯ menu unchanged… */}
      </DropdownMenu>
    )
  )}
</div>
```

Keep the existing generic `DropdownMenu` JSX (lines 1072-1368) verbatim inside the `else` branch — it still serves text/number/date/checkbox/url/rating with all extended options (units, switch, slider, scale — preserved per user decision "Сохранить всё"). `TYPE_LABELS`/`TYPE_ICONS` are already imported (line 92-93). `OptionChip`-based "Изменить тип" for select/multiselect is intentionally dropped from this popover (design `ftE6v` has no type-change for option types); type change for these remains reachable only if needed later — out of scope.

- [ ] **Step 4: Typecheck → Lint**

`pnpm exec tsc --noEmit`; `pnpm lint`. Fix unused-import lint fallout in the two trimmed controls until clean.

- [ ] **Step 5: Dev check**

KB page with a multi-select + select property:
- Closed: chips render as before (`qoPct`).
- ⋯ on a select/multi-select row → popover matches `ftE6v` (header, Тип chip, Опции list w/ drag handles + dots + ✕, "+ Добавить опцию" brand, "Дублировать свойство", "Удалить свойство" red).
- Click an option colour dot → grid matches `mzhv4` (2×5, default first, check mark on current, "Удалить опцию" red).
- ⋯ on a text/number/date/checkbox/url/rating row → unchanged generic menu still works (verify a unit submenu + checkbox switch + rating scale still function).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/page-properties/controls/select-control.tsx" "src/app/(dashboard)/knowledge/_components/page-properties/controls/multi-select-control.tsx" "src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx"
git commit -m "feat(kb): route select/multi-select editing to option-editor popover (ftE6v)"
```

---

## Task 9: Move "Описание" into the property ⋯ menu (`DNk3D`)

Design `DNk3D` context menu for non-option types: **Описание**, Изменить тип →, Дублировать, Удалить. Today "Описание" is a separate `Info` popover button rendered next to the property name (kb-page-properties.tsx lines 1015-1059). Move it into the generic ⋯ `DropdownMenu` as a "Описание" item that opens the same description popover; remove the standalone Info button.

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx`

- [ ] **Step 1: Remove the standalone Info description popover**

Delete the `{canEdit && (<Popover>…Info…</Popover>)}` block (lines 1015-1059) inside the label area.

- [ ] **Step 2: Add a "Описание" item + inline description popover to the generic ⋯ menu**

The generic `DropdownMenuContent` (line 1084). Add as the FIRST item (before the `DropdownMenuSub` "Изменить тип"), using a nested `Popover` is not valid inside `DropdownMenuItem`; instead keep a local state in `PropertyRow` (`const [descOpen, setDescOpen] = useState(false)`) and a separate controlled `Popover` anchored to an invisible trigger near the name. Minimal robust approach: keep the existing description `Popover` markup but make it controlled (`open={descOpen} onOpenChange={setDescOpen}`) with a hidden/zero-size `PopoverTrigger` placed in the label area, and add a `DropdownMenuItem` that calls `setDescOpen(true)` via `onSelect`:

In `PropertyRow`, add state near the other `useState` (line 920-923):

```tsx
const [descOpen, setDescOpen] = useState(false);
```

In the label area where the Info button was, render a controlled anchor popover:

```tsx
<Popover open={descOpen} onOpenChange={setDescOpen}>
  <PopoverTrigger asChild>
    <span className="sr-only" aria-hidden="true" />
  </PopoverTrigger>
  <PopoverContent
    align="start"
    sideOffset={6}
    className="w-[260px] p-2"
    onOpenAutoFocus={(e) => e.preventDefault()}
  >
    <Input
      value={descriptionDraft}
      placeholder="Описание свойства"
      className="h-8"
      aria-label="Описание свойства"
      onChange={(e) => setDescriptionDraft(e.currentTarget.value)}
      onBlur={() => onChangeDescription(descriptionDraft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onChangeDescription(e.currentTarget.value);
          setDescOpen(false);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setDescriptionDraft(property.description ?? "");
          setDescOpen(false);
        }
      }}
    />
  </PopoverContent>
</Popover>
```

Add the menu item as the first child of the generic `DropdownMenuContent`:

```tsx
<DropdownMenuItem
  onSelect={(e) => {
    e.preventDefault();
    setDescOpen(true);
  }}
>
  <Info className="size-3.5 text-muted-foreground" />
  Описание
</DropdownMenuItem>
<DropdownMenuSeparator />
```

`Info` is already imported (line 26). `DropdownMenuSeparator` already imported.

- [ ] **Step 3: Typecheck → Lint**

`pnpm exec tsc --noEmit`; `pnpm lint`. Expected PASS.

- [ ] **Step 4: Dev check**

⋯ on a text property → menu shows Описание, Изменить тип →, Дублировать, …, Удалить — matches `DNk3D` (left card) and the type submenu matches `DNk3D` right card (with "текущий" tag on the active type). Selecting "Описание" opens the description input popover anchored at the row. The old inline Info button is gone.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/kb-page-properties.tsx"
git commit -m "feat(kb): move property Описание into ⋯ context menu (DNk3D)"
```

---

## Task 10: URL value affordance to match `qoPct`

`qoPct` shows the Ссылка value as a link with a trailing external-link glyph. Current `url-control.tsx` display-mode shows an underlined `<a>` + a hover pencil. Add a small external-link icon inside the `<a>` (display mode, valid URL) to match; keep the edit pencil.

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/page-properties/controls/url-control.tsx`

- [ ] **Step 1: Add the glyph**

Import `ArrowUpRight` from `lucide-react` (add to existing `import { Pencil } from "lucide-react";` → `import { ArrowUpRight, Pencil } from "lucide-react";`). In BOTH valid-link `<a>` renders (read-only branch ~line 85-97 and edit-display branch ~line 184-194), wrap the display text + icon:

```tsx
<a
  href={trimmed}
  target="_blank"
  rel="noopener noreferrer"
  className="inline-flex items-center gap-0.5 text-[13px] text-foreground underline
             decoration-muted-foreground/40 underline-offset-[3px] decoration-[1.5px]
             hover:decoration-foreground transition-colors truncate max-w-full"
>
  <span className="truncate">{display}</span>
  <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
</a>
```

- [ ] **Step 2: Typecheck → Lint → Dev check**

`pnpm exec tsc --noEmit`; `pnpm lint`. Dev: a url property displays text + ↗ glyph like `qoPct`; clicking still opens in a new tab; hover pencil still enters edit mode.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/page-properties/controls/url-control.tsx"
git commit -m "feat(kb): external-link glyph on url property value (qoPct)"
```

---

## Task 11: "КОММЕНТАРИИ" section label

`qoPct` shows a "КОММЕНТАРИИ" eyebrow above the comment thread, same style as "СВОЙСТВА".

**Files:**
- Modify: `src/components/knowledge/page-comments/kb-page-comments.tsx` (return block, lines 274-305)

- [ ] **Step 1: Import + render the label**

Add import:

```tsx
import { KbSectionLabel } from "@/app/(dashboard)/knowledge/_components/page-properties/section-label";
```

In the returned `<section className="flex flex-col gap-3 py-2">`, add as first child:

```tsx
<section className="flex flex-col gap-3 py-2">
  <KbSectionLabel>Комментарии</KbSectionLabel>
  {!loading && comments.length > 0 && (
```

The existing render-gate (`if (!canComment && visibleComments.length === 0) return null;`, line 270-272) still prevents an empty labelled section for users who can't comment and have nothing to show.

- [ ] **Step 2: Typecheck → Lint → Dev check**

`pnpm exec tsc --noEmit`; `pnpm lint`. Dev: comment thread now has "КОММЕНТАРИИ" eyebrow above it, aligned with "СВОЙСТВА", matching `qoPct`.

- [ ] **Step 3: Commit**

```bash
git add src/components/knowledge/page-comments/kb-page-comments.tsx
git commit -m "feat(kb): КОММЕНТАРИИ section label above comment thread (qoPct)"
```

---

## Task 12: Comment copy-link helper + unit test

`qoPct` comment ⋯ menu = **Редактировать / Скопировать ссылку / Удалить**. "Скопировать ссылку" copies a deep link to the comment. Extract the URL builder as a pure, tested helper.

**Files:**
- Create: `src/components/knowledge/page-comments/page-comment-copy-link.ts`
- Create: `src/components/knowledge/page-comments/page-comment-copy-link.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommentLink } from "./page-comment-copy-link.ts";

test("buildCommentLink appends comment hash to the page URL", () => {
  assert.equal(
    buildCommentLink("https://app.example.com/knowledge/onboarding", "c123"),
    "https://app.example.com/knowledge/onboarding#comment-c123",
  );
});

test("buildCommentLink strips an existing hash before appending", () => {
  assert.equal(
    buildCommentLink(
      "https://app.example.com/knowledge/onboarding#comment-old",
      "c999",
    ),
    "https://app.example.com/knowledge/onboarding#comment-c999",
  );
});

test("buildCommentLink strips query string", () => {
  assert.equal(
    buildCommentLink(
      "https://app.example.com/knowledge/onboarding?x=1",
      "c1",
    ),
    "https://app.example.com/knowledge/onboarding#comment-c1",
  );
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test --experimental-strip-types "src/components/knowledge/page-comments/page-comment-copy-link.test.mts"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`page-comment-copy-link.ts`:

```ts
/** Deep-link к конкретному комментарию: <page-url без query/hash>#comment-<id>. */
export function buildCommentLink(href: string, commentId: string): string {
  const base = href.split("#")[0].split("?")[0];
  return `${base}#comment-${commentId}`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run the same command. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/page-comments/page-comment-copy-link.ts src/components/knowledge/page-comments/page-comment-copy-link.test.mts
git commit -m "feat(kb): pure comment deep-link builder + test"
```

---

## Task 13: Comment ⋯ menu → Редактировать / Скопировать ссылку / Удалить + anchor id

**Files:**
- Modify: `src/components/knowledge/page-comments/page-comment-item.tsx`

- [ ] **Step 1: Add the scroll-anchor id to the comment root**

The rendered comment root `<div className="group flex items-start gap-2">` (line 133). Add `id={`comment-${comment.id}`}` so the deep link can scroll to it:

```tsx
<div id={`comment-${comment.id}`} className="group flex items-start gap-2">
```

Also add the same id to the tombstone root (line 101) `<div className="flex items-start gap-2">` → add `id={`comment-${comment.id}`}`.

- [ ] **Step 2: Add "Скопировать ссылку" and rename "Изменить" → "Редактировать"**

Imports: add `Link2` to the lucide import (line 4): `import { Link2, MoreHorizontal, Pencil, SmilePlus, Trash2 } from "lucide-react";`. Add:

```tsx
import { buildCommentLink } from "./page-comment-copy-link";
import { toast } from "sonner";
```

(If `sonner` is already imported elsewhere in the file, reuse; otherwise add.)

In the author `DropdownMenuContent` (lines 198-223), the items become (note: "Скопировать ссылку" must be available to everyone who sees the comment, not only the author — so it needs to render even when `!isAuthor`; see Step 3). Author menu content:

```tsx
<DropdownMenuContent align="end" className="w-52">
  <DropdownMenuItem onSelect={() => setEditing(true)}>
    <Pencil className="size-4 mr-2" />
    Редактировать
  </DropdownMenuItem>
  <DropdownMenuItem
    onSelect={() => {
      const link = buildCommentLink(window.location.href, comment.id);
      void navigator.clipboard
        .writeText(link)
        .then(() => toast.success("Ссылка скопирована"))
        .catch(() => toast.error("Не удалось скопировать ссылку"));
    }}
  >
    <Link2 className="size-4 mr-2" />
    Скопировать ссылку
  </DropdownMenuItem>
  <DropdownMenuItem
    onSelect={async () => {
      onLocalDelete(comment.id);
      try {
        await deletePageComment({
          commentId: comment.id,
          threadId: comment.threadId,
        });
      } catch (err) {
        console.error("[page-comment] delete failed", err);
        onLocalRestore(comment.id);
      }
    }}
    className="text-destructive focus:text-destructive"
  >
    <Trash2 className="size-4 mr-2" />
    Удалить
  </DropdownMenuItem>
</DropdownMenuContent>
```

- [ ] **Step 3: Show a ⋯ menu for non-authors with only "Скопировать ссылку"**

Currently the ⋯ `DropdownMenu` only renders when `isAuthor` (line 187). Non-authors should still get "Скопировать ссылку" (design shows the ⋯ affordance generally). Restructure the action cluster (lines 166-226): keep `ReactPopover` gated by `canComment`; render the ⋯ `DropdownMenu` whenever the comment is not deleted, with conditional items:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button
      type="button"
      aria-label="Действия с комментарием"
      className="inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      <MoreHorizontal className="size-4" />
    </button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-52">
    {isAuthor && (
      <DropdownMenuItem onSelect={() => setEditing(true)}>
        <Pencil className="size-4 mr-2" />
        Редактировattь
      </DropdownMenuItem>
    )}
    <DropdownMenuItem
      onSelect={() => {
        const link = buildCommentLink(window.location.href, comment.id);
        void navigator.clipboard
          .writeText(link)
          .then(() => toast.success("Ссылка скопирована"))
          .catch(() => toast.error("Не удалось скопировать ссылку"));
      }}
    >
      <Link2 className="size-4 mr-2" />
      Скопировать ссылку
    </DropdownMenuItem>
    {isAuthor && (
      <DropdownMenuItem
        onSelect={async () => {
          onLocalDelete(comment.id);
          try {
            await deletePageComment({
              commentId: comment.id,
              threadId: comment.threadId,
            });
          } catch (err) {
            console.error("[page-comment] delete failed", err);
            onLocalRestore(comment.id);
          }
        }}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="size-4 mr-2" />
        Удалить
      </DropdownMenuItem>
    )}
  </DropdownMenuContent>
</DropdownMenu>
```

Fix the typo: the edit item label is exactly `Редактировать`. (The line above contains a deliberate typo marker `Редактировattь` — when implementing, type `Редактировать`.)

- [ ] **Step 4: Typecheck → Lint**

`pnpm exec tsc --noEmit`; `pnpm lint`. Expected PASS. Ensure no duplicate `toast` import.

- [ ] **Step 5: Dev check**

Hover a comment you authored → ⋯ shows Редактировать / Скопировать ссылку / Удалить (matches `qoPct`). Hover someone else's comment → ⋯ shows only Скопировать ссылку. "Скопировать ссылку" copies `…/knowledge/<slug>#comment-<id>` and toasts. Pasting that URL and loading scrolls to the comment (anchor id present).

- [ ] **Step 6: Commit**

```bash
git add src/components/knowledge/page-comments/page-comment-item.tsx
git commit -m "feat(kb): comment ⋯ menu Редактировать/Скопировать ссылку/Удалить + anchor (qoPct)"
```

---

## Task 14: Deterministic avatar colour helper + unit test

`ilYPS` shows mention-list avatars as coloured initials (blue/orange/violet), not the current flat muted circles. Add a pure helper mapping a stable key → a palette dot class (reuse `paletteDot`), so avatars are deterministic and on-palette.

**Files:**
- Create: `src/lib/avatar-color.ts`
- Create: `src/lib/avatar-color.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarDotClass } from "./avatar-color.ts";

test("avatarDotClass is deterministic for the same key", () => {
  assert.equal(avatarDotClass("user-1"), avatarDotClass("user-1"));
});

test("avatarDotClass returns a non-empty tailwind class", () => {
  const cls = avatarDotClass("Андрей Петров");
  assert.equal(typeof cls, "string");
  assert.ok(cls.length > 0);
});

test("avatarDotClass never returns the transparent default", () => {
  for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    assert.ok(!avatarDotClass(k).includes("transparent"));
  }
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test --experimental-strip-types "src/lib/avatar-color.test.mts"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`avatar-color.ts`:

```ts
import { paletteDot, PALETTE_COLORS } from "@/lib/palette";

const NAMED = PALETTE_COLORS.filter((c) => c.name !== "default").map(
  (c) => c.name,
);

/** Deterministic on-palette dot class for an avatar fallback. */
export function avatarDotClass(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return paletteDot(NAMED[Math.abs(h) % NAMED.length]);
}
```

Note: `@/lib/palette` alias must resolve under `node --test`. If the alias does not resolve in `.mts` execution, change the import to a relative path `./palette.ts` (same directory) and re-run.

- [ ] **Step 4: Run test, verify it passes**

Run the same command. Expected: PASS (3 tests). If alias import fails, switch to `./palette.ts` and re-run until green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avatar-color.ts src/lib/avatar-color.test.mts
git commit -m "feat: deterministic on-palette avatar dot helper + test"
```

---

## Task 15: Restyle the @mention dropdown (`ilYPS`)

`ilYPS` (280×178): a search affordance row "Найти пользователя…" with a magnifier, a "Участники" muted section label, then user rows = coloured round avatar (initials) + name, active row tinted. Restyle `DropdownList` only — the trigger/positioning logic is untouched.

**Files:**
- Modify: `src/components/knowledge/blocks/kb-comment-mention-dropdown.tsx` (`DropdownList`, lines 294-360; the loading/empty cards 307-320 too)

- [ ] **Step 1: Imports**

Add to the lucide import (line 14) `Search`: `import { Search, User } from "lucide-react";`. Add:

```tsx
import { avatarDotClass } from "@/lib/avatar-color";
```

- [ ] **Step 2: Rebuild `DropdownList`**

Replace the whole `DropdownList` function body (lines 294-360) with a card that has: a static search header showing the live `query` (read-only display — the actual filtering already happens via the `@query` typed in the textarea; the field here is a visual affordance + shows what's typed), a "Участники" label, then rows. `DropdownList` currently receives `items, loading, activeIndex, onSelect, onHover`. Add a `query: string` prop and pass `state.query` from the `createPortal` call (line 279-286: `<DropdownList items={state.items} loading={state.loading} activeIndex={state.activeIndex} query={state.query} onSelect={applyItem} onHover={…} />`).

```tsx
function DropdownList({
  items,
  loading,
  activeIndex,
  query,
  onSelect,
  onHover,
}: {
  items: KbMentionPerson[];
  loading: boolean;
  activeIndex: number;
  query: string;
  onSelect: (item: KbMentionPerson) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div className="w-[280px] rounded-[10px] border border-border bg-popover shadow-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "text-[13px] truncate",
            query ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {query || "Найти пользователя…"}
        </span>
      </div>
      <div className="px-3 pt-2 pb-1 text-[12px] text-muted-foreground/70">
        Участники
      </div>
      {loading && items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">Поиск…</div>
      ) : items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          Никого не нашлось
        </div>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(it);
                }}
                onMouseEnter={() => onHover(i)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors",
                  i === activeIndex ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                {it.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.avatar_url}
                    alt=""
                    className="size-6 rounded-full object-cover bg-muted shrink-0"
                  />
                ) : (
                  <span
                    className={cn(
                      "size-6 rounded-full inline-flex items-center justify-center shrink-0 text-[10px] font-semibold text-white",
                      avatarDotClass(it.id || it.full_name),
                    )}
                  >
                    {initialsOf(it.full_name)}
                  </span>
                )}
                <span className="truncate">{it.full_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
```

Update the `createPortal` `<DropdownList … />` (line ~280) to pass `query={state.query}`.

- [ ] **Step 3: Typecheck → Lint**

`pnpm exec tsc --noEmit`; `pnpm lint`. Expected PASS. `cn` is already imported (line 17). Confirm `KbMentionPerson` has `id`, `full_name`, `avatar_url` (used as-is from existing code).

- [ ] **Step 4: Dev check**

In a comment composer type `@an` → dropdown matches `ilYPS`: search row echoes "an", "Участники" label, rows with coloured initial avatars, active row tinted. Arrow keys + Enter still select (logic untouched). Selecting still inserts `@Full Name `.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/blocks/kb-comment-mention-dropdown.tsx
git commit -m "feat(kb): restyle @mention dropdown to design (ilYPS)"
```

---

## Task 16: Full-page visual regression pass + handbook

Per `CLAUDE.md` repo policy, any user-visible change must update the handbook.

**Files:**
- Modify: `docs/handbook/knowledge/index.md` (or create `docs/handbook/knowledge/properties.md` + link from `docs/handbook/README.md`)

- [ ] **Step 1: Whole-header dev check against `qoPct` / `NYvdb` / `zSR3f`**

`pnpm dev`, open a KB page authored by you containing: a multi-select (3 coloured values), a select, a url, a text, a date, a checkbox, a rating, and at least one comment (yours + someone else's). Screenshot the page top and compare to `mcp__pencil__get_screenshot` nodeId `qoPct`. Open the date popover and compare to `zSR3f`/`NYvdb`. Confirm spacing scale (4px system), radii, and that no raw hex was introduced (grep below).

Run: `grep -nE "#[0-9a-fA-F]{6}" src/app/\(dashboard\)/knowledge/_components/page-properties/option-editor-popover.tsx src/app/\(dashboard\)/knowledge/_components/page-properties/controls/date-control.tsx src/app/\(dashboard\)/knowledge/_components/page-properties/section-label.tsx`
Expected: no matches (no hardcoded hex — design-system rule).

- [ ] **Step 2: Update handbook**

In `docs/handbook/knowledge/index.md` add/extend a "Свойства и комментарии" section written from the user's POV: что такое свойства страницы, какие типы есть (текст, число, дата с календарём, чекбокс, выбор, мультивыбор со своими цветами, ссылка, рейтинг), как добавить/переупорядочить/перекрасить опцию, как оставить комментарий, упомянуть коллегу через `@`, отредактировать/скопировать ссылку/удалить свой комментарий. No dev terms (no server actions / RPC / column names). If the section grows large, instead create `docs/handbook/knowledge/properties.md` from `docs/handbook/_template.md` and link it in `docs/handbook/README.md`.

- [ ] **Step 3: Full required checks**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS.
Run: `node --test --experimental-strip-types "src/**/*.test.mts"`
Expected: PASS (all suites incl. the new helper tests).

- [ ] **Step 4: Commit**

```bash
git add docs/handbook
git commit -m "docs(handbook): KB page properties & comments user guide"
```

---

## Self-Review

**Spec coverage:**
- `qoPct` full page → Tasks 2 (СВОЙСТВА), 5 (date display), 10 (url glyph), 11 (КОММЕНТАРИИ), 13 (comment menu), 16 (regression).
- `ozpX7` add-property menu → Task 3.
- `DNk3D` property context menu + type submenu → Task 9 (Описание/Изменить тип/Дублировать/Удалить; submenu already exists with "текущий" tag, preserved).
- `ftE6v` option editor → Tasks 7 + 8.
- `mzhv4` colour grid → Tasks 6 + 7.
- `zSR3f` / `NYvdb` date popover → Tasks 4 + 5.
- `ilYPS` mention dropdown → Tasks 14 + 15.
- "Keep all extended options" (user decision) → Task 8 Step 3 keeps the generic ⋯ menu verbatim for non-option types (units/switch/slider/scale preserved).
- "Adapt colours to our tokens" → all new components use `paletteDot`/`brand`/`secondary`/`destructive` tokens; Task 16 Step 1 greps for stray hex.
- Handbook policy → Task 16.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". The one intentional typo (`Редактировattь`) is explicitly called out with a correction instruction in Task 13 Step 3.

**Type consistency:** `DateValueControl` prop is `onChange` (Task 5 corrected the first draft). `OptionEditorPopover` prop names (`typeLabel`, `typeIcon`, `options`, `optionColors`, `onChangeOptions`, `onChangeOptionColors`, `onDuplicate`, `onRemove`, `trigger`) are used identically in Task 8 Step 3. `PALETTE_GRID` defined in Task 6, consumed in Task 7. `buildCommentLink(href, id)` defined Task 12, used Task 13. `avatarDotClass(key)` defined Task 14, used Task 15. `KbSectionLabel` defined Task 1, used Tasks 2 & 11.

**Risk notes for the executor:**
- The shared `<Calendar>` is intentionally not modified. If its `classNames`/`components` override types fight TS, drop the override and accept the shared calendar's default chrome inside the KB popover (still acceptable vs design).
- `select-control.tsx` / `multi-select-control.tsx` lose props (`canEditOptions`, `onChangeOptions`, `onChangeOptionColors`) usage; keep them optional in the signature so `PropertyValueControl` call sites in `kb-page-properties.tsx` don't need edits, or update those call sites — either is fine, just keep `tsc` green.
