"use client";

import {
  GalleryHorizontalEnd,
  ListChecks,
  Table2,
} from "lucide-react";

import { Switch } from "@/components/ui/switch";
import {
  KB_COLLECTION_VIEW_LABELS,
  type KbCollectionView,
  type KbCollectionViewLayoutSettings,
} from "@/lib/knowledge/collection";

import {
  stopBlockInteraction,
  stopBlockMenuAction,
} from "./shared";

export function CollectionLayoutOptions({
  view,
  settings,
  onChange,
  onUpdateSettings,
}: {
  view: KbCollectionView;
  settings: KbCollectionViewLayoutSettings;
  onChange: (view: KbCollectionView) => void;
  onUpdateSettings: (patch: Partial<KbCollectionViewLayoutSettings>) => void;
}) {
  return (
    <div className="kb-collection-layout-panel">
      <div
        className="kb-collection-layout-grid"
        role="group"
        aria-label="Layout"
      >
        {(["table", "list"] as const).map((nextView) => {
          const active = view === nextView;
          const Icon = nextView === "table" ? Table2 : ListChecks;
          return (
            <button
              key={nextView}
              type="button"
              className="kb-collection-layout-card"
              data-active={active || undefined}
              aria-pressed={active}
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onChange(nextView);
              }}
            >
              <Icon className="size-5" />
              <span>{KB_COLLECTION_VIEW_LABELS[nextView]}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="kb-collection-layout-card"
          disabled
          aria-disabled
        >
          <GalleryHorizontalEnd className="size-5" />
          <span>Галерея</span>
        </button>
      </div>
      <div className="kb-collection-layout-switches">
        <CollectionLayoutSwitch
          label="Показывать название базы"
          checked={settings.showDataSourceTitle}
          onChange={(checked) =>
            onUpdateSettings({ showDataSourceTitle: checked })
          }
        />
        {view === "table" && (
          <CollectionLayoutSwitch
            label="Показывать вертикальные линии"
            checked={settings.showVerticalLines}
            onChange={(checked) =>
              onUpdateSettings({ showVerticalLines: checked })
            }
          />
        )}
        <CollectionLayoutSwitch
          label="Показывать иконку страницы"
          checked={settings.showPageIcon}
          onChange={(checked) => onUpdateSettings({ showPageIcon: checked })}
        />
        <CollectionLayoutSwitch
          label="Сворачивать весь текст"
          checked={!settings.wrapContent}
          onChange={(checked) => onUpdateSettings({ wrapContent: !checked })}
        />
      </div>
    </div>
  );
}

function CollectionLayoutSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="kb-collection-layout-switch">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function CollectionCreateViewPanel({
  onCreate,
}: {
  onCreate: (view: KbCollectionView) => void;
}) {
  const options: Array<{
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    view?: KbCollectionView;
  }> = [
    { label: "Таблица", icon: Table2, view: "table" },
    { label: "Список", icon: ListChecks, view: "list" },
    { label: "Галерея", icon: GalleryHorizontalEnd },
  ];

  return (
    <div className="kb-collection-create-view-panel">
      <div className="kb-collection-create-view-title">Добавить вид</div>
      <div className="kb-collection-create-view-grid">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.label}
              type="button"
              className="kb-collection-create-view-option"
              disabled={!option.view}
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                if (option.view) onCreate(option.view);
              }}
            >
              <Icon className="size-6" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
