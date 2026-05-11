# `gallery/` — KB Gallery block components

Carved out of `src/components/knowledge/blocks/kb-gallery-block.tsx` (started at 1374 lines; now ~843). This directory holds the sub-components rendered by the main `KbGalleryBlock` orchestrator. The orchestrator stays in `../kb-gallery-block.tsx` and owns drag/drop reordering of the whole list, upload pipeline, lightbox state, and the BlockNote spec.

## Layout

```
gallery/
  shared.ts                  KB_FILE_SCHEME + stopBlockInteraction + stopBlockMenuAction
  menu-switch-indicator.tsx  GalleryMenuSwitchIndicator (toolbar toggle visual)
  resolved-image.tsx         GalleryResolvedImage (kbfile:// / signed URL / preview-cache resolver)
  caption-popover.tsx        GalleryCaptionPopoverForm
  image-picker.tsx           GalleryImagePicker (file upload + URL tabs)
  image-menu.tsx             GalleryImageMenu (per-image ⋯ menu; embeds image-picker + caption-popover)
  sortable-item.tsx          SortableGalleryItem + getPointerSortableListeners
```

Still inside `kb-gallery-block.tsx`:

- `KbGalleryBlock` (~680 lines, orchestrator)
- `GalleryToExternalHTML` (BlockNote export)
- `runWithConcurrency` and `uploadResultToUrl` helpers used by the upload pipeline
- `kbGalleryBlockSpec` export

## Data flow

```
blocknote-editor.tsx
        │
        ▼
KbGalleryBlock (kb-gallery-block.tsx)
   ├─ owns: items, columns, layout, showCaptions, imageFit, uploadingCount, lightbox state
   ├─ runs uploads via runWithConcurrency
   └─ renders:
        ├─ GalleryImagePicker     ← "add image" trigger
        ├─ GalleryMenuSwitchIndicator (in toolbar)
        ├─ DndContext + SortableContext (re-order list)
        │     └─ SortableGalleryItem (per image)
        │           ├─ GalleryResolvedImage (variant="thumb")
        │           └─ GalleryImageMenu
        │                 ├─ GalleryImagePicker (replace flow)
        │                 └─ GalleryCaptionPopoverForm
        └─ Dialog (lightbox)
              └─ GalleryResolvedImage (variant="lightbox")
```

## Pure helpers in `src/lib/knowledge/`

- `gallery.ts` — types (`KbGalleryItem`, `KbGalleryColumns`), JSON parsers, URL helpers (`extractImageUrlsFromText`, `isLikelyImageUrl`)
- `use-image-preview-cache.ts` — IndexedDB-backed preview cache hook (used by `GalleryResolvedImage`)
- `media-file-validation.ts` — file-type/size validation
- `blocks-media.ts` — URL rewriting between session-local and persistent forms

## Conventions

- Each component file is `"use client"`.
- `stopBlockInteraction` / `stopBlockMenuAction` from `shared.ts` are wired onto every interactive surface inside the gallery so BlockNote's selection/DnD doesn't swallow clicks. The collection module has its own copies of these helpers — duplication is intentional, both blocks are self-contained.
- New shared **data** helpers go to `lib/knowledge/gallery.ts`, not `shared.ts` (which is UI-shaped only).
