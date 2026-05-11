# `page-properties/` — Per-type controls and helpers for KbPageProperties

Carved out of `../kb-page-properties.tsx` (started at 2778 lines; now ~1509). The main orchestrator (`KbPageProperties`, `PropertyRow`, `PropertyGroupHeader`, `CollectionScopedPropertyRow`, `PropertyRowDragPreview`, `PropertyValueControl`) lives in the original file. This directory holds the leaf controls (one per `KbPropertyType`) plus shared helpers/chips.

## Layout

```
page-properties/
  helpers.ts                     TYPE_ICONS / TYPE_LABELS / CREATABLE_PROPERTY_TYPES
                                 SAVE_DEBOUNCE_MS, propertyTypeOptions, makeProperty,
                                 getCollectionScope, isPageProperty
  option-chip.tsx                OptionChip + colorNameForOption + resolveOptionColor
  controls/
    text-control.tsx             TextValueControl
    url-control.tsx              UrlValueControl + shortenUrlForDisplay
    select-control.tsx           SelectControl
    multi-select-control.tsx     MultiSelectControl
    number-control.tsx           NumberValueControl (delegates to RatingValueControl)
    rating-control.tsx           RatingValueControl (stars + slider variants)
    unit-picker-items.tsx        UnitPickerItems (currency/mass/volume/piece submenu)
    property-icon-button.tsx     PropertyIconButton (KbIconPickerBody trigger)
```

## Data flow

```
KbPageProperties (kb-page-properties.tsx)
   ├─ owns: properties[], drafts, drag state, autosave debounce
   ├─ persists via saveKbPageProperties / saveKbTemplateProperties
   └─ renders for each property:
        PropertyRow
          ├─ PropertyIconButton            ← page-properties/controls/property-icon-button.tsx
          └─ PropertyValueControl (switch by type)
                ├─ text         → TextValueControl
                ├─ url          → UrlValueControl
                ├─ select       → SelectControl
                ├─ multi-select → MultiSelectControl
                ├─ number       → NumberValueControl
                │                   └─ delegates to RatingValueControl if displayVariant === "rating"
                ├─ rating       → RatingValueControl
                ├─ date         → native <input type="date"> (in PropertyValueControl)
                └─ checkbox     → <Checkbox>/<Switch> (in PropertyValueControl)
```

## Conventions

- Each control file is `"use client"` (BlockNote and others may render them inside Server Components).
- Controls accept narrow `Extract<KbProperty, { type: "…" }>` rather than the wide union.
- Controls **never** call `saveKbPageProperties` directly — they emit `onChange*` events and the orchestrator decides when to persist (debounced).
- `OptionChip` is shared between Select and MultiSelect — keep it in `option-chip.tsx`, not duplicated.
- `PropertyIconButton` is shared between `PropertyRow` and per-type controls — keep in `controls/property-icon-button.tsx` (used externally by collection blocks too).
- Adding a new property type: add a new `controls/<type>-control.tsx`, register it in `PropertyValueControl` switch, add to `TYPE_LABELS` / `TYPE_ICONS` in `helpers.ts`.

## Pure logic lives in `src/lib/`

- `palette.ts` — `PALETTE_COLORS`, `paletteChip`, `paletteDot` (option chip colors)
- `units/` — `Unit` discriminated union + formatters (`formatWithUnit`, `unitSuffix`)
- `knowledge/properties.ts` — server actions (`saveKbPageProperties`, `saveKbTemplateProperties`)

Controls should import from these layers — don't add new "data" helpers under `page-properties/`.
