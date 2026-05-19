# KB Page Hotkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 keyboard shortcuts (`Mod+Shift+{L,F,D,P,H}`) for frequent Knowledge-Base page actions, reusing the existing menu handlers (no logic duplication).

**Architecture:** A pure matcher (`matchKbHotkey`) maps a keyboard event to a command. A thin client listener mounted in the KB layout calls the matcher, `preventDefault()`s, and dispatches `CustomEvent("kb:command")`. The components that already own the page state — `kb-page-menu.tsx` and `kb-tree-nav.tsx` — subscribe and invoke their existing handlers (`onToggleLock`, `onToggleFavorite`, `onDuplicate`, `setVersionsOpen`, `onCreateRoot`).

**Tech Stack:** Next.js 15 / React 19 / TypeScript, `node:test` (`.test.mts`), existing KB server actions & override-store.

---

## File Structure

- Create `src/lib/kb-hotkeys.ts` — pure matcher + shared `KbCommand` type + event name constant. No DOM, no side effects.
- Create `src/lib/kb-hotkeys.test.mts` — `node:test` table-driven tests for the matcher.
- Create `src/app/(dashboard)/knowledge/_components/kb-hotkey-listener.tsx` — client listener; keydown → matcher → `preventDefault` → dispatch `kb:command`.
- Modify `src/app/(dashboard)/knowledge/layout.tsx` — mount `<KbHotkeyListener/>`.
- Modify `src/app/(dashboard)/knowledge/_components/kb-page-menu.tsx` — subscribe to `kb:command`, route to existing handlers.
- Modify `src/app/(dashboard)/knowledge/_components/kb-tree-nav.tsx` — subscribe to `create-page`.
- Modify `src/lib/hotkeys.ts` — add 5 rows to the "База знаний" group of the help modal.
- Modify `docs/handbook/profile/hotkeys.md` — document new shortcuts.

---

### Task 1: Pure hotkey matcher + tests

**Files:**
- Create: `src/lib/kb-hotkeys.ts`
- Test: `src/lib/kb-hotkeys.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/kb-hotkeys.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { matchKbHotkey, type KbCommand } from "./kb-hotkeys.ts";

type Ev = Parameters<typeof matchKbHotkey>[0];
const ev = (over: Partial<Ev>): Ev => ({
  key: "l",
  shiftKey: true,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  ...over,
});

const cases: Array<[string, Ev, KbCommand | null]> = [
  ["meta+shift+l → toggle-lock", ev({ key: "l" }), "toggle-lock"],
  ["uppercase L (shift) → toggle-lock", ev({ key: "L" }), "toggle-lock"],
  ["ctrl+shift+f → toggle-favorite", ev({ key: "f", metaKey: false, ctrlKey: true }), "toggle-favorite"],
  ["meta+shift+d → duplicate", ev({ key: "d" }), "duplicate"],
  ["meta+shift+p → create-page", ev({ key: "p" }), "create-page"],
  ["meta+shift+h → version-history", ev({ key: "h" }), "version-history"],
  ["no shift → null", ev({ key: "l", shiftKey: false }), null],
  ["no mod → null", ev({ key: "l", metaKey: false, ctrlKey: false }), null],
  ["alt held → null", ev({ key: "l", altKey: true }), null],
  ["unmapped letter → null", ev({ key: "z" }), null],
];

for (const [name, input, expected] of cases) {
  test(name, () => {
    assert.equal(matchKbHotkey(input), expected);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/kb-hotkeys.test.mts`
Expected: FAIL — cannot find module `./kb-hotkeys.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/kb-hotkeys.ts`:

```ts
/**
 * Чистый матчер хоткеев действий KB-страницы. Без DOM и побочных
 * эффектов — listener (kb-hotkey-listener.tsx) сам делает
 * preventDefault/dispatch. Схема: Mod+Shift+буква (Mod = ⌘ на macOS,
 * Ctrl на остальных). Буквы подобраны без конфликтов с браузером:
 * P (не N — инкогнито), H (не V — вставка без формата).
 */

export type KbCommand =
  | "toggle-lock"
  | "toggle-favorite"
  | "duplicate"
  | "create-page"
  | "version-history";

/** Имя CustomEvent, через которое listener сообщает команду. */
export const KB_COMMAND_EVENT = "kb:command";

const KEY_TO_COMMAND: Record<string, KbCommand> = {
  l: "toggle-lock",
  f: "toggle-favorite",
  d: "duplicate",
  p: "create-page",
  h: "version-history",
};

export function matchKbHotkey(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): KbCommand | null {
  if (e.altKey) return null;
  if (!e.shiftKey) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  return KEY_TO_COMMAND[e.key.toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/kb-hotkeys.test.mts`
Expected: PASS — 10/10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kb-hotkeys.ts src/lib/kb-hotkeys.test.mts
git commit -m "feat(kb): pure hotkey matcher for page actions"
```

---

### Task 2: KB hotkey listener + mount in layout

**Files:**
- Create: `src/app/(dashboard)/knowledge/_components/kb-hotkey-listener.tsx`
- Modify: `src/app/(dashboard)/knowledge/layout.tsx`

- [ ] **Step 1: Create the listener component**

Create `src/app/(dashboard)/knowledge/_components/kb-hotkey-listener.tsx`:

```tsx
"use client";

import { useEffect } from "react";

import { matchKbHotkey, KB_COMMAND_EVENT } from "@/lib/kb-hotkeys";

/**
 * Монтируется один раз в knowledge/layout. Переводит Mod+Shift+буква
 * в CustomEvent("kb:command"). Сам не знает про права/состояние —
 * исполняют подписчики (kb-page-menu, kb-tree-nav). Гард «не в инпуте»
 * не нужен: Mod+Shift-комбо не порождают текст.
 */
export function KbHotkeyListener() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = matchKbHotkey(e);
      if (!command) return;
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent(KB_COMMAND_EVENT, { detail: { command } }),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
```

- [ ] **Step 2: Mount it in the KB layout**

In `src/app/(dashboard)/knowledge/layout.tsx`, add the import next to the other `_components` imports:

```tsx
import { KbHotkeyListener } from "@/app/(dashboard)/knowledge/_components/kb-hotkey-listener";
```

Then, in the returned JSX, add `<KbHotkeyListener />` right after the opening `<>` fragment, before `<div className="flex w-full min-h-svh">`:

```tsx
  return (
    <>
      <KbHotkeyListener />
      <div className="flex w-full min-h-svh">
```

- [ ] **Step 3: Type-check**

Run: `/Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output (pass). (No local `node_modules` in the worktree — use the main repo's tsc binary; TS resolves modules by walking up to the main repo.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/kb-hotkey-listener.tsx" "src/app/(dashboard)/knowledge/layout.tsx"
git commit -m "feat(kb): mount hotkey listener in KB layout"
```

---

### Task 3: Wire commands in kb-page-menu (lock / favorite / duplicate / version-history)

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-page-menu.tsx`

Context: `KbPageMenu` already defines `onToggleLock()`, `onToggleFavorite()`, `onDuplicate()` and `const [versionsOpen, setVersionsOpen] = useState(false)`, plus props `canLock`, `canDuplicate`, `canViewVersionHistory`, `pageId`. `onDuplicate` is defined around line 314. We add one `useEffect` after `onDuplicate` is defined.

- [ ] **Step 1: Add the import**

At the top of `kb-page-menu.tsx`, add to the imports:

```tsx
import { KB_COMMAND_EVENT, type KbCommand } from "@/lib/kb-hotkeys";
```

- [ ] **Step 2: Add the subscription effect**

Immediately AFTER the `onDuplicate` function definition (the block starting `const onDuplicate = async () => {` and its closing `};`, around line 314-330), insert:

```tsx
  // Хоткеи действий страницы (Mod+Shift+L/F/D/H). Исполняем те же
  // обработчики, что и пункты ⋯-меню — никакой дублирующей логики
  // (flush-before-lock, optimistic override, тосты — всё внутри них).
  useEffect(() => {
    const onCommand = (e: Event) => {
      const command = (e as CustomEvent<{ command: KbCommand }>).detail
        .command;
      if (command === "toggle-lock") {
        if (!props.canLock) return;
        void onToggleLock();
      } else if (command === "toggle-favorite") {
        onToggleFavorite();
      } else if (command === "duplicate") {
        if (!props.canDuplicate || duplicatePending) return;
        void onDuplicate();
      } else if (command === "version-history") {
        if (!props.canViewVersionHistory) return;
        setVersionsOpen(true);
      }
    };
    window.addEventListener(KB_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(KB_COMMAND_EVENT, onCommand);
  }, [
    props.canLock,
    props.canDuplicate,
    props.canViewVersionHistory,
    duplicatePending,
  ]);
```

Note: `onToggleLock` / `onToggleFavorite` / `onDuplicate` are stable closures recreated each render; the effect re-subscribes each render (cheap, single listener). Permission props + `duplicatePending` are listed so the guard logic uses fresh values.

- [ ] **Step 3: Type-check**

Run: `/Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output (pass).

- [ ] **Step 4: Lint**

Run: `/Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/next lint --dir src`
Expected: `✔ No ESLint warnings or errors` (the deprecation notice about `next lint` is fine).

If lint flags `react-hooks/exhaustive-deps` for the handlers, add this line directly above `useEffect(`:
`// eslint-disable-next-line react-hooks/exhaustive-deps`

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/kb-page-menu.tsx"
git commit -m "feat(kb): hotkeys for lock/favorite/duplicate/version-history"
```

---

### Task 4: Wire create-page in kb-tree-nav

**Files:**
- Modify: `src/app/(dashboard)/knowledge/_components/kb-tree-nav.tsx`

Context: `kb-tree-nav.tsx` defines `const onCreateRoot = async () => { ... createKbPage({}) ... }` around line 570 (the handler bound to the "+ Новая страница" button). We add a subscription effect that calls it on `create-page`.

- [ ] **Step 1: Add the import**

At the top of `kb-tree-nav.tsx`, add:

```tsx
import { KB_COMMAND_EVENT, type KbCommand } from "@/lib/kb-hotkeys";
```

Also ensure `useEffect` is imported from `react` (it is already used elsewhere in this file — confirm the existing `import { ... } from "react"` includes `useEffect`; if not, add it).

- [ ] **Step 2: Add the subscription effect**

Immediately AFTER the `onCreateRoot` definition (the block `const onCreateRoot = async () => { ... };` around line 570-578), insert:

```tsx
  // Хоткей создания страницы (Mod+Shift+P) — тот же путь, что кнопка
  // «+ Новая страница». Server-action всё равно проверяет kb.create_pages.
  useEffect(() => {
    const onCommand = (e: Event) => {
      const command = (e as CustomEvent<{ command: KbCommand }>).detail
        .command;
      if (command === "create-page") {
        void onCreateRoot();
      }
    };
    window.addEventListener(KB_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(KB_COMMAND_EVENT, onCommand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Type-check**

Run: `/Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output (pass).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/knowledge/_components/kb-tree-nav.tsx"
git commit -m "feat(kb): hotkey for creating a new page"
```

---

### Task 5: Add shortcuts to the help modal registry + handbook

**Files:**
- Modify: `src/lib/hotkeys.ts`
- Modify: `docs/handbook/profile/hotkeys.md`

- [ ] **Step 1: Extend the "База знаний" group**

In `src/lib/hotkeys.ts`, replace the "База знаний" group's `entries` array so it reads exactly:

```ts
    entries: [
      { keys: ["Mod", "K"], description: "Открыть поиск по страницам" },
      { keys: ["Mod", "Shift", "L"], description: "Заблокировать / разблокировать страницу" },
      { keys: ["Mod", "Shift", "F"], description: "Добавить / убрать страницу из избранного" },
      { keys: ["Mod", "Shift", "D"], description: "Дублировать страницу" },
      { keys: ["Mod", "Shift", "P"], description: "Создать новую страницу" },
      { keys: ["Mod", "Shift", "H"], description: "Открыть историю версий" },
      { keys: ["Mod", "Z"], description: "Отменить удаление вида коллекции" },
      { keys: ["Mod", "Enter"], description: "Отправить комментарий / ответ в треде" },
      { keys: ["Esc"], description: "Закрыть композер или всплывающее окно" },
    ],
```

(The `Kbd`/`renderToken` rendering in `hotkeys-dialog.tsx` already handles any token list — no component change needed.)

- [ ] **Step 2: Update the handbook page**

In `docs/handbook/profile/hotkeys.md`, replace the **«База знаний:»** bullet list with:

```markdown
**База знаний:**

- `⌘/Ctrl + K` — поиск по страницам.
- `⌘/Ctrl + Shift + L` — заблокировать / разблокировать страницу.
- `⌘/Ctrl + Shift + F` — добавить / убрать из избранного.
- `⌘/Ctrl + Shift + D` — дублировать страницу.
- `⌘/Ctrl + Shift + P` — создать новую страницу.
- `⌘/Ctrl + Shift + H` — открыть историю версий.
- `⌘/Ctrl + Z` — отменить удаление вида коллекции.
- `⌘/Ctrl + Enter` — отправить комментарий или ответ в треде.
- `Esc` — закрыть композер или всплывающее окно.
```

Add to the **FAQ / частые ошибки** section one more Q/A:

```markdown
- **Q:** Почему «создать страницу» — `Shift+P`, а не `Shift+N`?
  **A:** `⌘/Ctrl+Shift+N` зарезервировано браузером (окно инкогнито) и
  не перехватывается приложением. Поэтому `P` (page).
```

- [ ] **Step 3: Type-check + lint**

Run: `/Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/tsc --noEmit -p tsconfig.json && /Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/next lint --dir src`
Expected: no tsc output; `✔ No ESLint warnings or errors`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/hotkeys.ts docs/handbook/profile/hotkeys.md
git commit -m "docs(kb): document page hotkeys in help modal + handbook"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the matcher test**

Run: `node --test --experimental-strip-types src/lib/kb-hotkeys.test.mts`
Expected: 10/10 PASS.

- [ ] **Step 2: Full type-check + lint (the required CI set)**

Run: `/Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/tsc --noEmit -p tsconfig.json && /Users/pavel.oplochko/Desktop/Projects/crm/node_modules/.bin/next lint --dir src`
Expected: no tsc output; `✔ No ESLint warnings or errors`.

- [ ] **Step 3: Manual smoke (dev server)**

Run `pnpm dev` (worktree needs `pnpm install` + `.env.local` copied from main repo + local Supabase running — see prior session). Open a KB page (`/knowledge/<slug>`), then:

- `Mod+Shift+L` → page locks/unlocks; the ⋯-menu lock toggle reflects the same state.
- `Mod+Shift+F` → favorite toggles (star in menu stays in sync).
- `Mod+Shift+D` → a duplicate is created and you navigate to it.
- `Mod+Shift+P` → a new root page is created (same as the "+" button).
- `Mod+Shift+H` → version-history dialog opens; `Esc` closes it.
- With cursor inside the editor, the above still work and do NOT corrupt typed text.
- On `/knowledge` index (no page open) the page-level combos do nothing destructive.
- Open the help modal (`Shift + ?`) → the 5 new rows appear under "База знаний"; on Win/Linux they render with `Ctrl`.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "test(kb): verify page hotkeys end-to-end"
```
(Skip if nothing changed.)

---

## Self-Review

**Spec coverage:** lock/favorite/duplicate/create/version-history → Tasks 1–5; pure matcher + node:test → Task 1; KB-scoped listener in layout → Task 2; reuse existing handlers (no dup logic) → Tasks 3–4; help modal + handbook → Task 5; permission no-op via existing guards → Task 3 (guards) + server-side recheck noted; test plan → Task 6. All spec sections covered.

**Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output.

**Type consistency:** `KbCommand` union and `KB_COMMAND_EVENT` defined in Task 1, imported unchanged in Tasks 2–4; handler names (`onToggleLock`, `onToggleFavorite`, `onDuplicate`, `setVersionsOpen`, `onCreateRoot`) and prop names (`canLock`, `canDuplicate`, `canViewVersionHistory`, `pageId`) match the actual `kb-page-menu.tsx` / `kb-tree-nav.tsx` source verified during planning.
