"use client";

import { useEffect, useRef, useState } from "react";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Paintbrush,
  Type,
} from "lucide-react";

import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import { Input } from "@/components/ui/input";
import {
  isCollectionFieldVisible,
  KB_COLLECTION_VIEW_LABELS,
  normalizeCollectionViewName,
  type KbCollectionField,
  type KbCollectionFilter,
  type KbCollectionView,
  type KbCollectionViewConfig,
  type KbCollectionViewIcon,
  type KbCollectionViewLayoutSettings,
  type KbCollectionViewTabDisplay,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
import type { FieldDropPlacement } from "@/lib/knowledge/collection-fields";
import type { KbCollectionGrouping } from "@/lib/knowledge/collection-group";
import type { KbCollectionSort } from "@/lib/knowledge/collection-sort";

import { CollectionViewIconPicker } from "../icon-pickers";
import { CollectionLayoutOptions } from "../layout-options";
import {
  VIEW_TAB_DISPLAY_LABELS,
  getCollectionViewFallbackIcon,
  stopBlockInteraction,
  stopBlockMenuAction,
  type CollectionSettingsPanel,
} from "../shared";
import { CollectionViewsEditor } from "../views-editor";
import { CollectionFieldVisibilityEditor } from "./field-visibility-editor";
import { CollectionFiltersEditor } from "./filters-editor";
import { CollectionGroupingEditor } from "./grouping-editor";
import { CollectionSortsEditor } from "./sorts-editor";

export function CollectionSettings({
  viewTitle,
  viewDescription,
  viewIcon,
  viewTabDisplay,
  layoutSettings,
  fields,
  view,
  views,
  activeViewId,
  visibleFieldIds,
  filters,
  sorts,
  grouping,
  initialPanel,
  onRenameView,
  onUpdateViewDescription,
  onUpdateViewIcon,
  onUpdateViewTabDisplay,
  onUpdateViewLayoutSettings,
  onChangeViewType,
  onSwitchView,
  onCreateView,
  onDuplicateView,
  onDeleteView,
  onReorderField,
  onSetFieldVisible,
  onUpdateFilters,
  onUpdateSorts,
  onUpdateGrouping,
}: {
  viewTitle: string;
  viewDescription: string;
  viewIcon: KbCollectionViewIcon;
  viewTabDisplay: KbCollectionViewTabDisplay;
  layoutSettings: KbCollectionViewLayoutSettings;
  fields: KbCollectionField[];
  view: KbCollectionView;
  views: KbCollectionViewConfig[];
  activeViewId: string | null;
  visibleFieldIds: KbCollectionVisibleFieldIds;
  filters: KbCollectionFilter[];
  sorts: KbCollectionSort[];
  grouping: KbCollectionGrouping | null;
  initialPanel: CollectionSettingsPanel | null;
  onRenameView: (title: string) => void;
  onUpdateViewDescription: (description: string) => void;
  onUpdateViewIcon: (icon: KbCollectionViewIcon) => void;
  onUpdateViewTabDisplay: (display: KbCollectionViewTabDisplay) => void;
  onUpdateViewLayoutSettings: (
    patch: Partial<KbCollectionViewLayoutSettings>,
  ) => void;
  onChangeViewType: (view: KbCollectionView) => void;
  onSwitchView: (viewId: string) => void;
  onCreateView: (view: KbCollectionView) => void;
  onDuplicateView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
  onReorderField: (
    activeId: string,
    targetId: string,
    placement?: FieldDropPlacement,
  ) => void;
  onSetFieldVisible: (id: string, visible: boolean) => void;
  onUpdateFilters: (filters: KbCollectionFilter[]) => void;
  onUpdateSorts: (sorts: KbCollectionSort[]) => void;
  onUpdateGrouping: (grouping: KbCollectionGrouping | null) => void;
}) {
  const [panel, setPanel] = useState<
    | "root"
    | "layout"
    | "views"
    | "properties"
    | "filters"
    | "sorts"
    | "grouping"
    | "display"
  >("root");
  const visibleFilterCount = filters.filter((filter) =>
    fields.some((field) => field.id === filter.fieldId),
  ).length;
  const visibleSortCount = sorts.filter((sort) =>
    fields.some((field) => field.id === sort.fieldId),
  ).length;
  const groupingField = fields.find((field) => field.id === grouping?.fieldId);
  const [viewTitleDraft, setViewTitleDraft] = useState(viewTitle);
  const [viewDescriptionDraft, setViewDescriptionDraft] =
    useState(viewDescription);
  const [descriptionOpen, setDescriptionOpen] = useState(Boolean(viewDescription));
  const skipViewTitleCommitRef = useRef(false);
  const visibleCount = fields.filter((field) =>
    isCollectionFieldVisible(field.id, visibleFieldIds),
  ).length;

  useEffect(() => {
    if (initialPanel) setPanel(initialPanel);
  }, [initialPanel]);

  useEffect(() => {
    setViewTitleDraft(viewTitle);
  }, [viewTitle]);

  useEffect(() => {
    setViewDescriptionDraft(viewDescription);
  }, [viewDescription]);

  const commitViewTitle = (value = viewTitleDraft) => {
    if (skipViewTitleCommitRef.current) {
      skipViewTitleCommitRef.current = false;
      return;
    }
    const nextTitle = normalizeCollectionViewName(value, view);
    setViewTitleDraft(nextTitle);
    onRenameView(nextTitle);
  };

  const commitViewDescription = (value = viewDescriptionDraft) => {
    const nextDescription = value.trim().slice(0, 280);
    setViewDescriptionDraft(nextDescription);
    onUpdateViewDescription(nextDescription);
  };
  const ViewIcon = getCollectionViewFallbackIcon({
    icon: viewIcon,
    viewType: view,
  });

  if (panel === "layout") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Вид" onBack={() => setPanel("root")} />
        <CollectionLayoutOptions
          view={view}
          settings={layoutSettings}
          onChange={onChangeViewType}
          onUpdateSettings={onUpdateViewLayoutSettings}
        />
      </div>
    );
  }

  if (panel === "display") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader
          title="Отображение"
          onBack={() => setPanel("root")}
        />
        <div className="kb-collection-view-list">
          {(["text-icon", "text", "icon"] as const).map((display) => {
            const Icon =
              display === "text"
                ? Type
                : display === "icon"
                  ? ViewIcon
                  : Paintbrush;
            return (
              <button
                key={display}
                type="button"
                className="kb-collection-view-row"
                data-active={viewTabDisplay === display || undefined}
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={(event) => {
                  stopBlockMenuAction(event);
                  onUpdateViewTabDisplay(display);
                }}
              >
                <Icon className="size-4" />
                <span>{VIEW_TAB_DISPLAY_LABELS[display]}</span>
                <span />
                {viewTabDisplay === display && <Check className="size-4" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (panel === "views") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Виды" onBack={() => setPanel("root")} />
        <CollectionViewsEditor
          views={views}
          activeViewId={activeViewId}
          onSwitchView={onSwitchView}
          onCreateView={onCreateView}
        />
      </div>
    );
  }

  if (panel === "filters") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Фильтры" onBack={() => setPanel("root")} />
        <CollectionFiltersEditor
          fields={fields}
          filters={filters}
          onChange={onUpdateFilters}
        />
      </div>
    );
  }

  if (panel === "sorts") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Сортировки" onBack={() => setPanel("root")} />
        <CollectionSortsEditor
          fields={fields}
          sorts={sorts}
          onChange={onUpdateSorts}
        />
      </div>
    );
  }

  if (panel === "grouping") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader
          title="Группировка"
          onBack={() => setPanel("root")}
        />
        <CollectionGroupingEditor
          fields={fields}
          grouping={grouping}
          onChange={onUpdateGrouping}
        />
      </div>
    );
  }

  if (panel === "properties") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader
          title="Свойства"
          onBack={() => setPanel("root")}
        />
        <CollectionFieldVisibilityEditor
          fields={fields}
          visibleFieldIds={visibleFieldIds}
          onReorder={onReorderField}
          onVisibleChange={onSetFieldVisible}
        />
      </div>
    );
  }

  return (
    <div className="kb-collection-settings-panel">
      <div className="kb-collection-settings-title">Настройки вида</div>
      <div className="kb-collection-settings-name-row">
        <CollectionViewIconPicker
          value={viewIcon}
          onChange={onUpdateViewIcon}
        />
        <div className="kb-collection-settings-name-input-wrap">
          <Input
            value={viewTitleDraft}
            className="kb-collection-settings-name-input"
            aria-label="Название вида"
            onPointerDown={stopBlockInteraction}
            onMouseDown={stopBlockInteraction}
            onClick={stopBlockInteraction}
            onChange={(event) => setViewTitleDraft(event.currentTarget.value)}
            onBlur={(event) => commitViewTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitViewTitle(event.currentTarget.value);
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                skipViewTitleCommitRef.current = true;
                setViewTitleDraft(viewTitle);
                event.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            className="kb-collection-view-description-trigger"
            aria-label="Добавить описание вида"
            onPointerDown={stopBlockInteraction}
            onMouseDown={stopBlockInteraction}
            onClick={(event) => {
              stopBlockMenuAction(event);
              setDescriptionOpen((current) => !current);
            }}
          >
            <span>i</span>
          </button>
        </div>
      </div>
      {descriptionOpen && (
        <Input
          value={viewDescriptionDraft}
          className="kb-collection-settings-description-compact"
          placeholder="Добавить описание..."
          aria-label="Описание вида"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
          onChange={(event) =>
            setViewDescriptionDraft(event.currentTarget.value)
          }
          onBlur={(event) => commitViewDescription(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitViewDescription(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setViewDescriptionDraft(viewDescription);
              event.currentTarget.blur();
            }
          }}
        />
      )}
      <div className="kb-collection-settings-root-list">
        <button
          type="button"
          className="kb-collection-settings-nav-row"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("layout");
          }}
        >
          <ViewIcon className="size-4" />
          <span>Вид</span>
          <span className="kb-collection-settings-row-value">
            {KB_COLLECTION_VIEW_LABELS[view]}
          </span>
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className="kb-collection-settings-nav-row"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("display");
          }}
        >
          <KB_PROPERTY_UI_ICONS.display className="size-4" />
          <span>Отображение</span>
          <span className="kb-collection-settings-row-value">
            {VIEW_TAB_DISPLAY_LABELS[viewTabDisplay]}
          </span>
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className="kb-collection-settings-nav-row"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("properties");
          }}
        >
          <KB_PROPERTY_UI_ICONS.visibility className="size-4" />
          <span>Свойства</span>
          <span className="kb-collection-settings-row-value">
            {visibleCount}
          </span>
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className="kb-collection-settings-nav-row"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("filters");
          }}
        >
          <KB_PROPERTY_UI_ICONS.filter className="size-4" />
          <span>Фильтры</span>
          <span className="kb-collection-settings-row-value">
            {visibleFilterCount}
          </span>
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className="kb-collection-settings-nav-row"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("sorts");
          }}
        >
          <KB_PROPERTY_UI_ICONS.sortDirection className="size-4" />
          <span>Сортировки</span>
          <span className="kb-collection-settings-row-value">
            {visibleSortCount}
          </span>
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className="kb-collection-settings-nav-row"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("grouping");
          }}
        >
          <KB_PROPERTY_UI_ICONS.grouping className="size-4" />
          <span>Группировка</span>
          <span className="kb-collection-settings-row-value">
            {groupingField?.name ?? "Нет"}
          </span>
          <ChevronRight className="size-4" />
        </button>
        {activeViewId && (
          <>
            <button
              type="button"
              className="kb-collection-settings-nav-row"
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onDuplicateView(activeViewId);
              }}
            >
              <KB_PROPERTY_UI_ICONS.duplicate className="size-4" />
              <span>Дублировать вид</span>
              <span />
              <span />
            </button>
            <button
              type="button"
              className="kb-collection-settings-nav-row text-destructive"
              disabled={views.length <= 1}
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onDeleteView(activeViewId);
              }}
            >
              <KB_PROPERTY_UI_ICONS.delete className="size-4" />
              <span>Удалить вид</span>
              <span />
              <span />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsPanelHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="kb-collection-settings-panel-head">
      <button
        type="button"
        className="kb-collection-settings-back"
        aria-label="Назад"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={(event) => {
          stopBlockMenuAction(event);
          onBack();
        }}
      >
        <ArrowLeft className="size-4" />
      </button>
      <div className="kb-collection-settings-panel-title">{title}</div>
    </div>
  );
}
