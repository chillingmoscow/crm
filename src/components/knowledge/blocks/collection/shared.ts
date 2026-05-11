import {
  Calendar,
  CheckSquare,
  ChevronDown,
  Database,
  Hash,
  Link as LinkIcon,
  ListChecks,
  Star,
  Type,
} from "lucide-react";
import type React from "react";

import {
  KB_COLLECTION_FIELD_LABELS,
  type KbCollectionField,
  type KbCollectionView,
  type KbCollectionViewIcon,
  type KbCollectionViewTabDisplay,
} from "@/lib/knowledge/collection";
import type { KbProperty, KbPropertyType } from "@/types/knowledge";

// ─── Constants ──────────────────────────────────────────────────────────────

export const SAVE_CELL_DEBOUNCE_MS = 650;
export const TABLE_TITLE_COLUMN_WIDTH_ID = "__title";
export const MAX_TABLE_COLUMN_WIDTH = 640;

// ─── Shared types ───────────────────────────────────────────────────────────

export type CollectionSettingsPanel =
  | "layout"
  | "display"
  | "properties"
  | "filters"
  | "sorts"
  | "grouping"
  | "views";

export type CollectionTableCellId = "title" | string;

export type CollectionTableSelection = {
  itemId: string;
  cellId: CollectionTableCellId;
};

// ─── Icons ──────────────────────────────────────────────────────────────────

export const FIELD_ICONS: Record<
  KbPropertyType,
  React.ComponentType<{ className?: string }>
> = {
  text: Type,
  number: Hash,
  date: Calendar,
  checkbox: CheckSquare,
  select: ChevronDown,
  "multi-select": ListChecks,
  url: LinkIcon,
  rating: Star,
};

export const VIEW_TAB_DISPLAY_LABELS: Record<
  KbCollectionViewTabDisplay,
  string
> = {
  "text-icon": "Текст и иконка",
  text: "Только текст",
  icon: "Только иконка",
};

export function getCollectionViewFallbackIcon(viewConfig: {
  icon?: KbCollectionViewIcon;
  viewType: KbCollectionView;
}) {
  return viewConfig.viewType === "table" ? Database : ListChecks;
}

// ─── DOM helpers ────────────────────────────────────────────────────────────

export function stopBlockInteraction(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function stopBlockMenuAction(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

// ─── Property helpers ───────────────────────────────────────────────────────

export function hasCollectionPropertyDisplayValue(
  property: KbProperty,
): boolean {
  switch (property.type) {
    case "text":
    case "url":
      return property.value.trim().length > 0;
    case "number":
    case "rating":
      return property.value !== null;
    case "date":
      return Boolean(property.value);
    case "checkbox":
      return property.value === true;
    case "select":
      return Boolean(property.value);
    case "multi-select":
      return property.value.length > 0;
  }
}

export function collectionFieldMenuLabel(field: KbCollectionField): string {
  return field.name.trim() || KB_COLLECTION_FIELD_LABELS[field.type];
}
