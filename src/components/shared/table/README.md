# Shared Table Module

`/dev/table-lab` is the permanent sandbox for table UX. Keep experimental table behavior there until it is approved, then move only stable pieces into product screens.

## Stack

- `@tanstack/react-table` for headless table state: sorting, filtering, pagination, selection, column visibility, order and sizing.
- shadcn/Radix primitives for popovers, menus, checkboxes, buttons and tooltips.
- `@dnd-kit/*` for column ordering.
- `localStorage` preferences by `tableId` for column visibility, order, width and page size.

## Components

- `TablePageHeader` keeps title, subtitle, meta text and right-side actions together.
- `TableControls` is independent from the table and can sit near the title, above the table or in a compact mobile toolbar.
- `TableControlPin` renders active search/filter/sort chips.
- `TableColumnManager` controls visibility, order and saved widths.
- `TableBulkBar` shows group actions. Prefer the floating variant when selected rows may be far from the table header.
- `TablePagination` standardizes page size, range text and navigation.
- `TableRowMenu` standardizes the `...` row action menu.
- `TableSplitButton` is for primary `+` actions with a secondary dropdown area.
- `useTableState` owns search, filters, sorting, pagination, selection and persisted column preferences.

## UX Rules

- Toolbar buttons stay near the page title or primary section header.
- Search opens inline near the search icon.
- The filter button toggles the pins row. It should not open a separate configuration popover by default.
- Pins are grouped as sorting, filters and search. Use vertical separators between groups, not between every pin.
- Search pin is the rightmost pin before reset. If search is the only active condition and the pins row is hidden, do not show a search pin.
- Sorting is Notion-like: the toolbar opens a field list, then one active sort pin summarizes the current sort. Multiple sorts are edited inside that pin.
- Header clicks must preserve existing sorts: first click adds ascending, second changes to descending, third removes only that column.
- Desktop tables default to full width. Mobile/list variants can be constrained when the page context needs a narrower working area.
- Selected rows should get a subtle background tint without changing row height.

## Tooltip Compatibility

PR312 introduces a shared tooltip contract. Do not add local size/color classes to `TooltipContent` in table components unless there is a product-specific reason. Prefer the global tooltip styling or the `data-tip` / `data-tip-sub` contract where the global tooltip is expected.

Disabled controls do not reliably emit hover/focus events. If a disabled action needs a reason tooltip, wrap the disabled control or show the reason outside the disabled element.

## Adoption

Keep `/dev/table-lab` as the reference page. After a pattern is accepted there, adopt it gradually on production pages: employees, inventory document filling, inventory results and finance. Do not mass-rewrite working screens from an unapproved lab state.

Before opening a PR for table module changes, run:

```bash
./node_modules/.bin/tsc --noEmit
npm run lint
curl -sS -I http://localhost:3400/login
```
