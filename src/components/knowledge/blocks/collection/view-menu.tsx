"use client";

import { useEffect, useState } from "react";

import {
  ArrowLeft,
  Check,
  Copy,
  ListChecks,
  Paintbrush,
  Pencil,
  Settings2,
  Table2,
  Trash2,
  Type,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  KB_COLLECTION_VIEW_LABELS,
  type KbCollectionView,
  type KbCollectionViewIcon,
  type KbCollectionViewTabDisplay,
} from "@/lib/knowledge/collection";

import { CollectionViewIconPicker } from "./icon-pickers";
import {
  VIEW_TAB_DISPLAY_LABELS,
  getCollectionViewFallbackIcon,
  stopBlockMenuAction,
} from "./shared";

export function CollectionViewMenu({
  viewName,
  description,
  icon,
  tabDisplay,
  viewType,
  canDelete,
  onRename,
  onChangeDescription,
  onChangeIcon,
  onChangeTabDisplay,
  onChangeLayout,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  viewName: string;
  description: string;
  icon: KbCollectionViewIcon;
  tabDisplay: KbCollectionViewTabDisplay;
  viewType: KbCollectionView;
  canDelete: boolean;
  onRename: (name: string) => void;
  onChangeDescription: (description: string) => void;
  onChangeIcon: (icon: KbCollectionViewIcon) => void;
  onChangeTabDisplay: (display: KbCollectionViewTabDisplay) => void;
  onChangeLayout: (view: KbCollectionView) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [panel, setPanel] = useState<
    "root" | "rename" | "layout" | "display"
  >("root");
  const [nameDraft, setNameDraft] = useState(viewName);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  // На мобильном не автофокусим поле переименования — иначе при открытии
  // панели сразу всплывает клавиатура. На desktop фокус удобен.
  const isMobile = useIsMobile();

  useEffect(() => {
    setNameDraft(viewName);
  }, [viewName]);

  useEffect(() => {
    setDescriptionDraft(description);
  }, [description]);

  if (panel === "rename") {
    return (
      <div className="kb-collection-column-menu-panel">
        <div className="kb-collection-column-insert-head">
          <button
            type="button"
            className="kb-collection-settings-back"
            aria-label="Назад"
            onClick={(event) => {
              stopBlockMenuAction(event);
              setPanel("root");
            }}
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="kb-collection-column-insert-subtitle">
            Переименовать вид
          </div>
        </div>
        <div className="kb-collection-column-menu-name">
          <CollectionViewIconPicker
            value={icon}
            onChange={onChangeIcon}
          />
          <Input
            value={nameDraft}
            className="h-9 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            aria-label="Название вида"
            autoFocus={!isMobile}
            onChange={(event) => setNameDraft(event.currentTarget.value)}
            onBlur={() => onRename(nameDraft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRename(event.currentTarget.value);
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setNameDraft(viewName);
                setPanel("root");
              }
            }}
          />
        </div>
        <label className="kb-collection-view-description-field">
          <span>Описание</span>
          <textarea
            value={descriptionDraft}
            className="kb-collection-view-description-input"
            placeholder="Описание вида"
            rows={3}
            onChange={(event) =>
              setDescriptionDraft(event.currentTarget.value)
            }
            onBlur={() => onChangeDescription(descriptionDraft)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDescriptionDraft(description);
                setPanel("root");
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onChangeDescription(event.currentTarget.value);
                setPanel("root");
              }
            }}
          />
        </label>
      </div>
    );
  }

  if (panel === "display") {
    const DisplayIcon = getCollectionViewFallbackIcon({ icon, viewType });
    return (
      <div className="kb-collection-column-menu-panel">
        <div className="kb-collection-column-insert-head">
          <button
            type="button"
            className="kb-collection-settings-back"
            aria-label="Назад"
            onClick={(event) => {
              stopBlockMenuAction(event);
              setPanel("root");
            }}
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="kb-collection-column-insert-subtitle">
            Отображение
          </div>
        </div>
        {(["text-icon", "text", "icon"] as const).map((display) => {
          const Icon =
            display === "text"
              ? Type
              : display === "icon"
                ? DisplayIcon
                : Paintbrush;
          return (
            <button
              key={display}
              type="button"
              className="kb-collection-column-menu-row"
              data-active={tabDisplay === display || undefined}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onChangeTabDisplay(display);
              }}
            >
              <Icon className="size-4" />
              <span>{VIEW_TAB_DISPLAY_LABELS[display]}</span>
              {tabDisplay === display && <Check className="size-4" />}
            </button>
          );
        })}
      </div>
    );
  }

  if (panel === "layout") {
    return (
      <div className="kb-collection-column-menu-panel">
        <div className="kb-collection-column-insert-head">
          <button
            type="button"
            className="kb-collection-settings-back"
            aria-label="Назад"
            onClick={(event) => {
              stopBlockMenuAction(event);
              setPanel("root");
            }}
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="kb-collection-column-insert-subtitle">
            Отображать как
          </div>
        </div>
        {(["table", "list"] as const).map((nextView) => {
          const Icon = nextView === "table" ? Table2 : ListChecks;
          const active = viewType === nextView;
          return (
            <button
              key={nextView}
              type="button"
              className="kb-collection-column-menu-row"
              data-active={active || undefined}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onChangeLayout(nextView);
              }}
            >
              <Icon className="size-4" />
              <span>{KB_COLLECTION_VIEW_LABELS[nextView]}</span>
              {active && <Check className="size-4" />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="kb-collection-column-menu-panel">
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("rename");
        }}
      >
        <Pencil className="size-4" />
        <span>Переименовать</span>
        <span />
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("display");
        }}
      >
        <Paintbrush className="size-4" />
        <span>Отображение</span>
        <span className="kb-collection-settings-row-value">
          {VIEW_TAB_DISPLAY_LABELS[tabDisplay]}
        </span>
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onEdit();
        }}
      >
        <Settings2 className="size-4" />
        <span>Настроить вид</span>
        <span />
      </button>
      <div className="kb-collection-column-menu-separator" />
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onDuplicate();
        }}
      >
        <Copy className="size-4" />
        <span>Дублировать вид</span>
        <span />
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row text-destructive"
        disabled={!canDelete}
        onClick={(event) => {
          stopBlockMenuAction(event);
          onDelete();
        }}
      >
        <Trash2 className="size-4" />
        <span>Удалить вид</span>
        <span />
      </button>
    </div>
  );
}
