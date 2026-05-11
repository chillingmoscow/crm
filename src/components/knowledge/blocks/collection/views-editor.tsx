"use client";

import {
  Check,
  GalleryHorizontalEnd,
  Plus,
  Table2,
} from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import {
  KB_COLLECTION_VIEW_LABELS,
  type KbCollectionView,
  type KbCollectionViewConfig,
} from "@/lib/knowledge/collection";

import {
  getCollectionViewFallbackIcon,
  stopBlockInteraction,
  stopBlockMenuAction,
} from "./shared";

export function CollectionViewsEditor({
  views,
  activeViewId,
  onSwitchView,
  onCreateView,
}: {
  views: KbCollectionViewConfig[];
  activeViewId: string | null;
  onSwitchView: (viewId: string) => void;
  onCreateView: (view: KbCollectionView) => void;
}) {
  return (
    <div className="kb-collection-views-editor">
      <div className="kb-collection-view-list">
        {views.map((view) => {
          const active = view.id === activeViewId;
          return (
            <button
              key={view.id}
              type="button"
              className="kb-collection-view-row"
              data-active={active || undefined}
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onSwitchView(view.id);
              }}
            >
              <KbPageIcon
                icon={view.icon}
                color={null}
                size={16}
                fallback={getCollectionViewFallbackIcon(view)}
              />
              <span>{view.name}</span>
              <span className="kb-collection-settings-row-value">
                {KB_COLLECTION_VIEW_LABELS[view.viewType]}
              </span>
              {active && <Check className="size-4" />}
            </button>
          );
        })}
      </div>
      <div className="kb-collection-column-menu-separator" />
      <div className="kb-collection-view-list">
        {(["list", "table"] as const).map((viewType) => {
          const Icon = viewType === "table" ? Table2 : GalleryHorizontalEnd;
          return (
            <button
              key={viewType}
              type="button"
              className="kb-collection-view-row"
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onCreateView(viewType);
              }}
            >
              <Plus className="size-4" />
              <span>Создать {KB_COLLECTION_VIEW_LABELS[viewType].toLowerCase()}</span>
              <span className="kb-collection-settings-row-value">
                <Icon className="size-4" />
              </span>
              <span />
            </button>
          );
        })}
      </div>
    </div>
  );
}
