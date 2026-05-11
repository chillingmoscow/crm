"use client";

import Link from "next/link";

import { ChevronDown } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { PropertyValueControl } from "@/app/(dashboard)/knowledge/_components/kb-page-properties";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { KbCollectionItem } from "@/lib/knowledge/collection-actions";
import {
  findPropertyForCollectionField,
  type KbCollectionField,
  type KbCollectionViewLayoutSettings,
} from "@/lib/knowledge/collection";
import { collectionFieldDisplayProperty } from "@/lib/knowledge/collection-fields";
import type { KbCollectionItemGroup } from "@/lib/knowledge/collection-group";
import type { KbProperty } from "@/types/knowledge";

import {
  hasCollectionPropertyDisplayValue,
  stopBlockInteraction,
} from "./shared";

export function CollectionListView({
  items,
  groups,
  fields,
  collectionId,
  collectionTitle,
  canEdit,
  layoutSettings,
  onChangeValue,
}: {
  items: KbCollectionItem[];
  groups: KbCollectionItemGroup<KbCollectionItem>[];
  fields: KbCollectionField[];
  collectionId: string;
  collectionTitle: string;
  canEdit: boolean;
  layoutSettings: KbCollectionViewLayoutSettings;
  onChangeValue: (
    pageId: string,
    field: KbCollectionField,
    value: KbProperty["value"],
  ) => void;
}) {
  if (groups.length > 0) {
    return (
      <div className="kb-collection-grouped-stack">
        {groups.map((group) => (
          <section key={group.key} className="kb-collection-group">
            <CollectionGroupHeader label={group.label} count={group.items.length} />
            <div className="kb-collection-list">
              {group.items.map((item) => (
                <CollectionItemRow
                  key={item.id}
                  item={item}
                  fields={fields}
                  collectionId={collectionId}
                  collectionTitle={collectionTitle}
                  canEdit={canEdit}
                  layoutSettings={layoutSettings}
                  onChangeValue={onChangeValue}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="kb-collection-list">
      {items.map((item) => (
        <CollectionItemRow
          key={item.id}
          item={item}
          fields={fields}
          collectionId={collectionId}
          collectionTitle={collectionTitle}
          canEdit={canEdit}
          layoutSettings={layoutSettings}
          onChangeValue={onChangeValue}
        />
      ))}
    </div>
  );
}

export function CollectionGroupHeader({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className="kb-collection-group-header">
      <ChevronDown className="size-4" />
      <span>{label}</span>
      <span className="kb-collection-group-count">{count}</span>
    </div>
  );
}

function CollectionItemRow({
  item,
  fields,
  collectionId,
  collectionTitle,
  canEdit,
  layoutSettings,
  onChangeValue,
}: {
  item: KbCollectionItem;
  fields: KbCollectionField[];
  collectionId: string;
  collectionTitle: string;
  canEdit: boolean;
  layoutSettings: KbCollectionViewLayoutSettings;
  onChangeValue: (
    pageId: string,
    field: KbCollectionField,
    value: KbProperty["value"],
  ) => void;
}) {
  const preview = item.plain_text.trim();

  return (
    <div className="kb-collection-row">
      <Link href={`/knowledge/${item.slug}`} className="kb-collection-row-main">
        {layoutSettings.showPageIcon && (
          <KbPageIcon icon={item.icon} color={item.icon_color} size={18} />
        )}
        <div className="min-w-0 flex-1">
          <div className="kb-collection-row-title">
            {item.title || "Без названия"}
          </div>
          {preview && <div className="kb-collection-preview">{preview}</div>}
        </div>
      </Link>
      {fields.length > 0 && (
        <div
          className="kb-collection-properties"
          data-wrap={layoutSettings.wrapContent || undefined}
        >
          {fields.map((field) => (
            <CollectionPropertyChip
              key={field.id}
              field={field}
              property={findPropertyForCollectionField(
                item.properties,
                field,
                collectionId,
              )}
              collectionId={collectionId}
              collectionTitle={collectionTitle}
              canEdit={canEdit}
              onChangeValue={(value) => onChangeValue(item.id, field, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionPropertyChip({
  field,
  property,
  collectionId,
  collectionTitle,
  canEdit,
  onChangeValue,
}: {
  field: KbCollectionField;
  property: KbProperty | null;
  collectionId: string;
  collectionTitle: string;
  canEdit: boolean;
  onChangeValue: (value: KbProperty["value"]) => void;
}) {
  const displayProperty = collectionFieldDisplayProperty(property, field, {
    collectionId,
    collectionTitle,
  });
  if (!hasCollectionPropertyDisplayValue(displayProperty)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="kb-collection-property"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          <PropertyValueControl
            property={displayProperty}
            canEdit={canEdit}
            canEditOptions={false}
            onChangeValue={onChangeValue}
            onChangeOptions={() => {}}
            onChangeOptionColors={() => {}}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs">
        <strong className="font-semibold leading-tight">{field.name}</strong>
      </TooltipContent>
    </Tooltip>
  );
}
