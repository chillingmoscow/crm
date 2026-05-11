import type { ReactCustomBlockRenderProps } from "@blocknote/react";

import {
  KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  KB_COLLECTION_EMPTY_SCHEMA,
} from "@/lib/knowledge/collection";

export const collectionBlockConfig = {
  type: "collection",
  propSchema: {
    view: {
      default: "list" as const,
      values: ["list", "table"] as const,
    },
    title: {
      default: "Коллекция",
      type: "string" as const,
    },
    viewTitle: {
      default: "",
      type: "string" as const,
    },
    collectionId: {
      default: "",
      type: "string" as const,
    },
    schemaJson: {
      default: KB_COLLECTION_EMPTY_SCHEMA,
      type: "string" as const,
    },
    visibleFieldIdsJson: {
      default: KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
      type: "string" as const,
    },
    fieldOrderIdsJson: {
      default: KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
      type: "string" as const,
    },
    viewId: {
      default: "",
      type: "string" as const,
    },
  },
  content: "none" as const,
};

export type CollectionRenderProps = ReactCustomBlockRenderProps<
  typeof collectionBlockConfig
>;
