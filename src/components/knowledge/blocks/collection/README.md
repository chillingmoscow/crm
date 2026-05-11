# `collection/` — KB Collection block components

Carved out of `src/components/knowledge/blocks/kb-collection-block.tsx` (started at 7019 lines; ongoing decomposition). This directory holds the leaf / supporting components and shared utilities used by the main `KbCollectionBlock`. The main block file itself still lives at `../kb-collection-block.tsx` and owns the heavy state machinery (items, views, schema, save pipeline) plus the BlockNote spec — it will keep shrinking as more sub-components migrate here.

## Layout

```
collection/
  block-config.ts            BlockNote propSchema + CollectionRenderProps
  runtime-provider.tsx       KbCollectionRuntimeProvider + useKbCollectionRuntime
  shared.ts                  Cross-component constants, icons, DOM helpers, type aliases
  add-field-menu.tsx         CollectionAddFieldMenu (type picker for new property)
  icon-pickers.tsx           CollectionViewIconPicker + CollectionFieldIconPicker
  layout-options.tsx         CollectionLayoutOptions + CollectionCreateViewPanel
  views-editor.tsx           CollectionViewsEditor (switch / create view list)
  list-view.tsx              CollectionListView + GroupHeader + ItemRow + PropertyChip
  settings/
    field-select.tsx                 dropdown of fields (used by filters/sorts/grouping)
    field-visibility-editor.tsx      shown/hidden two-list + DnD reorder
    filters-editor.tsx               adds/edits per-view filters
    sorts-editor.tsx                 adds/edits per-view sorts
    grouping-editor.tsx              single grouping field + direction
```

Still inside `kb-collection-block.tsx` (planned for follow-up extraction):

- `KbCollectionBlock` (~2400 lines, the orchestrator — owns all state)
- `CollectionViewMenu` (per-view ⋯ menu)
- `CollectionTableView` + `CollectionTableTitleCell` + `CollectionTableNewRow`
- `CollectionTitleColumnMenu` + `CollectionColumnMenu` + `CollectionColumnInsertPanel`
- `CollectionSettings` + `SettingsPanelHeader` (the slide-out settings drawer)
- `CollectionFieldEditor` — **dead code**; nobody calls it. `eslint-disable` is masking the unused warning. Slated for deletion (separate PR).

## Data flow

```
blocknote-editor.tsx
        │
        ▼
KbCollectionRuntimeProvider (runtime-provider.tsx)
   value: { pageId, canCreatePages }
        │  context
        ▼
KbCollectionBlock (kb-collection-block.tsx)
   ├─ loads collection state (listKbCollectionItems / getOrCreateKbPageCollection)
   ├─ owns: items, views, activeViewId, schema, filters, sorts, grouping
   ├─ derives:  visibleFields × filterCollectionItems × sortCollectionItems
   │           × groupCollectionItems  (all in lib/knowledge/collection-*)
   └─ renders:
        ├─ CollectionViewsEditor (header tabs)
        ├─ CollectionViewMenu (active view dropdown)
        ├─ CollectionLayoutOptions / CollectionCreateViewPanel (settings drawer)
        ├─ Settings sub-editors (visibility / filters / sorts / grouping / field-editor)
        ├─ CollectionListView   ← list mode
        └─ CollectionTableView  ← table mode
              ├─ CollectionTableTitleCell
              ├─ CollectionTableNewRow
              ├─ CollectionColumnMenu / TitleColumnMenu / ColumnInsertPanel
              └─ uses CollectionGroupHeader (re-exported from list-view.tsx)
```

## Pure logic lives in `src/lib/knowledge/`

The block file is the **only** consumer that should orchestrate state. Pure data manipulation has been pulled out into a sibling layer that's testable under `node --test`:

- `collection.ts` — types, JSON parsers, schema helpers, `findPropertyForCollectionField`
- `collection-actions.ts` — server actions (Supabase RPC)
- `collection-filter.ts` — `filterCollectionItems`, `matchesCollectionFilter`, operator helpers
- `collection-format.ts` — `formatPropertyValue`, `sortDirectionLabel`
- `collection-fields.ts` — `orderCollectionFields`, reorder/insert, document-block walking, `collectionFieldDisplayProperty`
- `collection-sort.ts` — `sortCollectionItems`
- `collection-group.ts` — `groupCollectionItems`

Whenever a component here needs a pure transform, import it from `@/lib/knowledge/…` rather than re-implementing it. New helpers should be added there, not in `shared.ts` (which is for **UI**-shaped constants/utilities — icons, event-stoppers, label strings).

## Conventions

- Each component file is `"use client"`.
- Imports order: `react` → external libs → `@/components/*` → `@/lib/*` → `@/types/*` → relative (`./…`, `../…`).
- Components receive everything they need via props. No reaching into Provider context except inside the orchestrator and in `useKbCollectionRuntime` consumers (currently only the orchestrator).
- DOM-event stoppers — `stopBlockInteraction` and `stopBlockMenuAction` from `shared.ts` — are wired onto every interactive surface inside the block so BlockNote's selection / DnD doesn't swallow clicks.

## Tests

Pure modules under `src/lib/knowledge/collection-*.test.mts` (run with `node --experimental-strip-types --test <path>`). Component tests are not in place — render-level testing for these BlockNote-embedded components is out of scope until BlockNote test harness is wired.
