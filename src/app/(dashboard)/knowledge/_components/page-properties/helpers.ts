import type { ComponentType } from "react";
import { nanoid } from "nanoid";
import {
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronDown,
  Hash,
  Link as LinkIcon,
  ListChecks,
  Star,
  Type as TypeIcon,
} from "lucide-react";

import type { KbProperty, KbPropertyType } from "@/types/knowledge";

export const TYPE_ICONS: Record<
  KbPropertyType,
  ComponentType<{ className?: string }>
> = {
  text: TypeIcon,
  number: Hash,
  date: CalendarIcon,
  checkbox: CheckSquare,
  select: ChevronDown,
  "multi-select": ListChecks,
  url: LinkIcon,
  rating: Star,
};

export const TYPE_LABELS: Record<KbPropertyType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  checkbox: "Чекбокс",
  select: "Выбор",
  "multi-select": "Мультивыбор",
  url: "Ссылка",
  rating: "Рейтинг",
};

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

/** Создаёт пустое property указанного типа с дефолтным `name`.
 *  Default name = label типа («Текст» / «Число» / …) — без префикса
 *  «Свойство»; юзер сразу переименовывает в осмысленное. */
export function makeProperty(
  type: KbPropertyType,
  name?: string,
): KbProperty {
  const id = nanoid(8);
  const baseName = name ?? TYPE_LABELS[type];
  switch (type) {
    case "text":
      return { id, name: baseName, type: "text", value: "" };
    case "number":
      return { id, name: baseName, type: "number", value: null };
    case "date":
      return { id, name: baseName, type: "date", value: null };
    case "checkbox":
      return { id, name: baseName, type: "checkbox", value: false };
    case "select":
      return { id, name: baseName, type: "select", value: null, options: [] };
    case "multi-select":
      return {
        id,
        name: baseName,
        type: "multi-select",
        value: [],
        options: [],
      };
    case "url":
      return { id, name: baseName, type: "url", value: "" };
    case "rating":
      return { id, name: baseName, type: "rating", value: null };
  }
}

export function getCollectionScope(property: KbProperty) {
  return property.scope?.type === "collection" ? property.scope : null;
}

export function isPageProperty(property: KbProperty): boolean {
  return property.scope?.type !== "collection";
}
