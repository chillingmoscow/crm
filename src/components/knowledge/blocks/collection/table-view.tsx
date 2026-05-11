"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Loader2, Pin, Plus, Type } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { PropertyValueControl } from "@/app/(dashboard)/knowledge/_components/kb-page-properties";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { KbCollectionItem } from "@/lib/knowledge/collection-actions";
import {
  findPropertyForCollectionField,
  isCollectionFieldVisible,
  type KbCollectionColumnWidths,
  type KbCollectionField,
  type KbCollectionViewLayoutSettings,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
import {
  MIN_TABLE_COLUMN_WIDTH,
  collectionFieldDisplayProperty,
  minTableColumnWidthForField,
  type FieldDropPlacement,
} from "@/lib/knowledge/collection-fields";
import type { KbCollectionSortDirection } from "@/lib/knowledge/collection-sort";
import type { KbProperty, KbPropertyType } from "@/types/knowledge";

import { CollectionAddFieldMenu } from "./add-field-menu";
import {
  CollectionColumnMenu,
  CollectionTitleColumnMenu,
} from "./column-menu";
import {
  FIELD_ICONS,
  MAX_TABLE_COLUMN_WIDTH,
  TABLE_TITLE_COLUMN_WIDTH_ID,
  collectionFieldMenuLabel,
  stopBlockInteraction,
  stopBlockMenuAction,
  type CollectionTableCellId,
  type CollectionTableSelection,
} from "./shared";

function CollectionTableTitleCell({
  item,
  selected,
  editing,
  showPageIcon,
  onSelect,
  onEdit,
  onCancel,
  onCommit,
}: {
  item: KbCollectionItem;
  selected: boolean;
  editing: boolean;
  showPageIcon: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(item.title || "Без названия");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(item.title || "Без названия");
  }, [editing, item.title]);

  useEffect(() => {
    if (!editing) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  }, [editing]);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        className="kb-collection-table-title-input"
        aria-label="Название записи"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(event.currentTarget.value);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(item.title || "Без названия");
            onCancel();
          }
        }}
      />
    );
  }

  return (
    <div
      className="kb-collection-table-title-interactive"
      data-selected={selected || undefined}
      onClick={(event) => {
        stopBlockMenuAction(event);
        if (selected) {
          onEdit();
        } else {
          onSelect();
        }
      }}
    >
      <Link
        href={`/knowledge/${item.slug}`}
        className="kb-collection-table-title-link"
        onClick={(event) => event.stopPropagation()}
      >
        {showPageIcon && (
          <KbPageIcon icon={item.icon} color={item.icon_color} size={17} />
        )}
        <span className="kb-collection-table-title-text">
          {item.title || "Без названия"}
        </span>
      </Link>
    </div>
  );
}

function CollectionTableNewRow({
  rowStyle,
  fields,
  creating,
  onCreate,
}: {
  rowStyle: CSSProperties;
  fields: KbCollectionField[];
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <div
      className="kb-collection-table-row kb-collection-table-new-row"
      role="row"
      style={rowStyle}
    >
      <button
        type="button"
        className="kb-collection-table-title-cell kb-collection-table-new-cell"
        role="cell"
        disabled={creating}
        onClick={(event) => {
          stopBlockMenuAction(event);
          onCreate();
        }}
      >
        {creating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        <span>Добавить</span>
      </button>
      {fields.map((field) => (
        <div
          key={field.id}
          className="kb-collection-table-cell"
          role="cell"
        />
      ))}
      <div
        className="kb-collection-table-cell kb-collection-table-add-field-spacer"
        role="cell"
        aria-hidden
      />
    </div>
  );
}

export function CollectionTableView({
  items,
  fields,
  collectionId,
  collectionTitle,
  canEdit,
  columnWidths,
  layoutSettings,
  autoEditTitleItemId,
  visibleFieldIds,
  onChangeValue,
  onUpdateField,
  onRemoveField,
  onDuplicateField,
  onReorderField,
  onInsertField,
  onSetFieldVisible,
  onSortField,
  onResizeColumns,
  onConsumeAutoEditTitle,
  onAddField,
  onCreateRecord,
  onRenameItemTitle,
  creating,
}: {
  items: KbCollectionItem[];
  fields: KbCollectionField[];
  collectionId: string;
  collectionTitle: string;
  canEdit: boolean;
  columnWidths: KbCollectionColumnWidths;
  layoutSettings: KbCollectionViewLayoutSettings;
  autoEditTitleItemId: string | null;
  visibleFieldIds: KbCollectionVisibleFieldIds;
  onChangeValue: (
    pageId: string,
    field: KbCollectionField,
    value: KbProperty["value"],
  ) => void;
  onUpdateField: (id: string, patch: Partial<KbCollectionField>) => void;
  onRemoveField: (id: string) => void;
  onDuplicateField: (id: string) => void;
  onReorderField: (
    activeId: string,
    targetId: string,
    placement?: FieldDropPlacement,
  ) => void;
  onInsertField: (
    type: KbPropertyType,
    targetId: string,
    placement: FieldDropPlacement,
    name?: string,
  ) => void;
  onSetFieldVisible: (id: string, visible: boolean) => void;
  onSortField: (id: string, direction: KbCollectionSortDirection) => void;
  onResizeColumns: (widths: KbCollectionColumnWidths) => void;
  onConsumeAutoEditTitle: () => void;
  onAddField: (type: KbPropertyType) => void;
  onCreateRecord: () => void;
  onRenameItemTitle: (pageId: string, title: string) => void;
  creating: boolean;
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef(fields);
  const suppressHeaderClickRef = useRef(false);
  const [openFieldMenuId, setOpenFieldMenuId] = useState<string | null>(null);
  const [titleColumnMenuOpen, setTitleColumnMenuOpen] = useState(false);
  const [titleColumnName, setTitleColumnName] = useState("Страница");
  const [titleColumnPinned, setTitleColumnPinned] = useState(false);
  const [titleColumnWrap, setTitleColumnWrap] = useState(false);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [selectedCell, setSelectedCell] =
    useState<CollectionTableSelection | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [draftColumnWidths, setDraftColumnWidths] =
    useState<KbCollectionColumnWidths>(columnWidths);
  const [resizeIndicatorX, setResizeIndicatorX] = useState<number | null>(null);
  const consumedAutoEditTitleRef = useRef<string | null>(null);
  const [columnDrag, setColumnDrag] = useState<{
    activeId: string;
    indicatorIndex: number;
    x: number;
    previewX: number;
    previewWidth: number;
  } | null>(null);
  const getDraftColumnWidth = (columnId: string, fallback: number) => {
    const value = draftColumnWidths[columnId];
    const minWidth =
      columnId === TABLE_TITLE_COLUMN_WIDTH_ID
        ? MIN_TABLE_COLUMN_WIDTH
        : fields.find((field) => field.id === columnId)
          ? minTableColumnWidthForField(
              fields.find((field) => field.id === columnId)!,
            )
          : MIN_TABLE_COLUMN_WIDTH;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(
      Math.max(value, minWidth),
      MAX_TABLE_COLUMN_WIDTH,
    );
  };
  const titleColumnWidth = getDraftColumnWidth(
    TABLE_TITLE_COLUMN_WIDTH_ID,
    320,
  );
  const fieldColumnWidths = fields.map((field) =>
    getDraftColumnWidth(field.id, Math.max(220, minTableColumnWidthForField(field))),
  );
  const gridTemplateColumns = [
    `${titleColumnWidth}px`,
    ...fieldColumnWidths.map((width) => `${width}px`),
    ...(canEdit ? ["44px"] : []),
  ].join(" ");
  const rowStyle: CSSProperties = { gridTemplateColumns };
  const draggingColumnId = columnDrag?.activeId ?? null;

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    setDraftColumnWidths(columnWidths);
  }, [columnWidths]);

  const blurActiveCellEditor = useCallback(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      tableRef.current?.contains(active)
    ) {
      active.blur();
    }
  }, []);

  useEffect(() => {
    if (!autoEditTitleItemId) return;
    if (consumedAutoEditTitleRef.current === autoEditTitleItemId) return;
    if (!items.some((item) => item.id === autoEditTitleItemId)) return;

    consumedAutoEditTitleRef.current = autoEditTitleItemId;
    setSelectedCell({ itemId: autoEditTitleItemId, cellId: "title" });
    setEditingTitleId(autoEditTitleItemId);
    onConsumeAutoEditTitle();
  }, [autoEditTitleItemId, items, onConsumeAutoEditTitle]);

  useEffect(() => {
    if (!selectedCell && !editingTitleId) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-kb-collection-cell]")) return;
      setSelectedCell(null);
      setEditingTitleId(null);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [editingTitleId, selectedCell]);

  useEffect(() => {
    if (!openFieldMenuId && !titleColumnMenuOpen && !addFieldOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          ".kb-collection-column-menu, .kb-collection-table-head-cell, .kb-collection-table-add-field",
        )
      ) {
        return;
      }
      setOpenFieldMenuId(null);
      setTitleColumnMenuOpen(false);
      setAddFieldOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [addFieldOpen, openFieldMenuId, titleColumnMenuOpen]);

  const isCellSelected = useCallback(
    (itemId: string, cellId: CollectionTableCellId) =>
      selectedCell?.itemId === itemId && selectedCell.cellId === cellId,
    [selectedCell],
  );

  const getColumnDropTarget = useCallback(
    (clientX: number, previewWidth = 0, grabOffset = 0) => {
    const table = tableRef.current;
    if (!table) {
      return { indicatorIndex: 0, x: 0, previewX: 0, previewWidth };
    }

    const headers = Array.from(
      table.querySelectorAll<HTMLElement>("[data-kb-collection-field-id]"),
    );
    if (headers.length === 0) {
      return { indicatorIndex: 0, x: 0, previewX: 0, previewWidth };
    }

    const tableRect = table.getBoundingClientRect();
    const firstRect = headers[0].getBoundingClientRect();
    const lastRect = headers[headers.length - 1].getBoundingClientRect();
    const clampedX = Math.min(
      Math.max(clientX, firstRect.left),
      lastRect.right,
    );
    const indicatorIndex = headers.findIndex((header) => {
      const rect = header.getBoundingClientRect();
      return clampedX < rect.left + rect.width / 2;
    });
    const nextIndicatorIndex =
      indicatorIndex === -1 ? headers.length : indicatorIndex;
    const edgeClientX =
      nextIndicatorIndex >= headers.length
        ? lastRect.right
        : headers[nextIndicatorIndex].getBoundingClientRect().left;
    const previewLeft = Math.min(
      Math.max(clientX - grabOffset, firstRect.left),
      Math.max(firstRect.left, lastRect.right - previewWidth),
    );

    return {
      indicatorIndex: nextIndicatorIndex,
      x: edgeClientX - tableRect.left,
      previewX: previewLeft - tableRect.left,
      previewWidth,
    };
    },
    [],
  );

  const finishColumnDrag = useCallback(
    (activeId: string, clientX: number) => {
      const currentFields = fieldsRef.current;
      if (currentFields.length < 2) return;

      const target = getColumnDropTarget(clientX);
      const activeIndex = currentFields.findIndex(
        (field) => field.id === activeId,
      );
      if (activeIndex < 0) return;

      if (
        target.indicatorIndex === activeIndex ||
        target.indicatorIndex === activeIndex + 1
      ) {
        return;
      }

      if (target.indicatorIndex >= currentFields.length) {
        const lastField = currentFields[currentFields.length - 1];
        onReorderField(activeId, lastField.id, "after");
        return;
      }

      const targetField = currentFields[target.indicatorIndex];
      onReorderField(activeId, targetField.id, "before");
    },
    [getColumnDropTarget, onReorderField],
  );

  const startColumnDrag = (
    event: React.PointerEvent<HTMLElement>,
    field: KbCollectionField,
  ) => {
    if (!canEdit || event.button !== 0 || fields.length < 2) return;

    event.stopPropagation();
    const fieldId = field.id;
    const headerRect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const grabOffset = event.clientX - headerRect.left;
    const previewWidth = headerRect.width;
    let started = false;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!started && Math.hypot(deltaX, deltaY) < 7) return;

      if (!started) {
        started = true;
        suppressHeaderClickRef.current = true;
        setOpenFieldMenuId(null);
      }

      moveEvent.preventDefault();
      setColumnDrag({
        activeId: fieldId,
        ...getColumnDropTarget(moveEvent.clientX, previewWidth, grabOffset),
      });
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      cleanup();
      if (started) {
        upEvent.preventDefault();
        setColumnDrag(null);
        finishColumnDrag(fieldId, upEvent.clientX);
        window.setTimeout(() => {
          suppressHeaderClickRef.current = false;
        }, 0);
      }
    };

    const handlePointerCancel = () => {
      cleanup();
      setColumnDrag(null);
      suppressHeaderClickRef.current = false;
    };

    document.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
  };

  const startColumnResize = (
    event: React.PointerEvent<HTMLElement>,
    columnId: string,
  ) => {
    if (!canEdit || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    suppressHeaderClickRef.current = true;

    const table = tableRef.current;
    const headerCell = event.currentTarget.closest<HTMLElement>(
      ".kb-collection-table-head-cell",
    );
    if (!table || !headerCell) return;

    const tableRect = table.getBoundingClientRect();
    const headerRect = headerCell.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = headerRect.width;
    let latestWidth = startWidth;

    const updateIndicator = (width: number) => {
      setResizeIndicatorX(headerRect.left - tableRect.left + width);
    };

    updateIndicator(startWidth);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const minWidth =
        columnId === TABLE_TITLE_COLUMN_WIDTH_ID
          ? MIN_TABLE_COLUMN_WIDTH
          : fieldsRef.current.find((field) => field.id === columnId)
            ? minTableColumnWidthForField(
                fieldsRef.current.find((field) => field.id === columnId)!,
              )
            : MIN_TABLE_COLUMN_WIDTH;
      latestWidth = Math.min(
        Math.max(startWidth + moveEvent.clientX - startX, minWidth),
        MAX_TABLE_COLUMN_WIDTH,
      );
      setDraftColumnWidths((current) => ({
        ...current,
        [columnId]: latestWidth,
      }));
      updateIndicator(latestWidth);
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.body.style.cursor = "";
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      cleanup();
      upEvent.preventDefault();
      setResizeIndicatorX(null);
      onResizeColumns({
        ...draftColumnWidths,
        [columnId]: latestWidth,
      });
      window.setTimeout(() => {
        suppressHeaderClickRef.current = false;
      }, 0);
    };

    const handlePointerCancel = () => {
      cleanup();
      setResizeIndicatorX(null);
      setDraftColumnWidths(columnWidths);
      suppressHeaderClickRef.current = false;
    };

    document.body.style.cursor = "col-resize";
    document.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
  };

  return (
    <div
      className="kb-collection-table-scroll"
      role="region"
      data-menu-open={
        openFieldMenuId || titleColumnMenuOpen || addFieldOpen
          ? true
          : undefined
      }
    >
      <div
        ref={tableRef}
        className="kb-collection-table"
        role="table"
        aria-label="Записи коллекции"
        data-column-dragging={columnDrag ? true : undefined}
        data-title-pinned={titleColumnPinned || undefined}
        data-title-wrap={
          titleColumnWrap || layoutSettings.wrapContent || undefined
        }
        data-vertical-lines={layoutSettings.showVerticalLines || undefined}
        data-wrap-content={layoutSettings.wrapContent || undefined}
      >
        <div
          className="kb-collection-table-row kb-collection-table-row-head"
          role="row"
          style={rowStyle}
        >
          <Popover
            open={titleColumnMenuOpen}
            onOpenChange={setTitleColumnMenuOpen}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="kb-collection-table-head-cell kb-collection-table-title-col kb-collection-table-title-head"
                role="columnheader"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!suppressHeaderClickRef.current) return;
                  event.preventDefault();
                  suppressHeaderClickRef.current = false;
                }}
              >
                <span className="kb-collection-table-heading">
                  <Type className="size-3.5" />
                  <span>{titleColumnName}</span>
                  {titleColumnPinned && <Pin className="size-3.5" />}
                </span>
                {canEdit && (
                  <span
                    className="kb-collection-column-resizer"
                    aria-hidden
                    onPointerDown={(event) =>
                      startColumnResize(event, TABLE_TITLE_COLUMN_WIDTH_ID)
                    }
                  />
                )}
              </button>
            </PopoverTrigger>
            {canEdit && (
              <PopoverContent
                align="start"
                sideOffset={6}
                className="kb-collection-column-menu"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={stopBlockInteraction}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <CollectionTitleColumnMenu
                  name={titleColumnName}
                  pinned={titleColumnPinned}
                  wrap={titleColumnWrap}
                  onRename={setTitleColumnName}
                  onPinnedChange={setTitleColumnPinned}
                  onWrapChange={setTitleColumnWrap}
                  onInsertRight={(type, name) => {
                    if (fields[0]) {
                      onInsertField(type, fields[0].id, "before", name);
                    } else {
                      onAddField(type);
                    }
                    setTitleColumnMenuOpen(false);
                  }}
                />
              </PopoverContent>
            )}
          </Popover>
          {fields.map((field) => {
            const Icon = FIELD_ICONS[field.type];
            const headerButton = (
              <button
                type="button"
                className="kb-collection-table-head-cell kb-collection-table-draggable-head"
                role="columnheader"
                data-kb-collection-field-id={field.id}
                data-dragging={draggingColumnId === field.id || undefined}
                onPointerDown={(event) => startColumnDrag(event, field)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!suppressHeaderClickRef.current) return;
                  event.preventDefault();
                  suppressHeaderClickRef.current = false;
                }}
              >
                <span className="kb-collection-table-heading">
                  {field.icon ? (
                    <KbPageIcon
                      icon={field.icon}
                      color={field.iconColor ?? null}
                      size={14}
                    />
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                  {field.name && <span>{field.name}</span>}
                </span>
                {canEdit && (
                  <span
                    className="kb-collection-column-resizer"
                    aria-hidden
                    onPointerDown={(event) =>
                      startColumnResize(event, field.id)
                    }
                  />
                )}
              </button>
            );
            const headerTrigger = field.description ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>{headerButton}</PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="text-xs px-2 py-1">
                  <div className="grid gap-0.5">
                    <strong className="font-semibold leading-tight">
                      {collectionFieldMenuLabel(field)}
                    </strong>
                    <span className="text-muted-foreground leading-tight">
                      {field.description}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              <PopoverTrigger asChild>{headerButton}</PopoverTrigger>
            );
            return (
              <Popover
                key={field.id}
                open={openFieldMenuId === field.id}
                onOpenChange={(open) =>
                  setOpenFieldMenuId((current) =>
                    open ? field.id : current === field.id ? null : current,
                  )
                }
              >
                {headerTrigger}
                {canEdit && (
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="kb-collection-column-menu"
                    onPointerDown={stopBlockInteraction}
                    onMouseDown={stopBlockInteraction}
                    onClick={stopBlockInteraction}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                  >
                    <CollectionColumnMenu
                      field={field}
                      visible={isCollectionFieldVisible(
                        field.id,
                        visibleFieldIds,
                      )}
                      onUpdate={(patch) => onUpdateField(field.id, patch)}
                      onRemove={() => {
                        onRemoveField(field.id);
                        setOpenFieldMenuId(null);
                      }}
                      onDuplicate={() => {
                        onDuplicateField(field.id);
                        setOpenFieldMenuId(null);
                      }}
                      onSort={(direction) => {
                        onSortField(field.id, direction);
                        setOpenFieldMenuId(null);
                      }}
                      onInsert={(type, name, placement) => {
                        onInsertField(type, field.id, placement, name);
                        setOpenFieldMenuId(null);
                      }}
                      onVisibleChange={(visible) =>
                        onSetFieldVisible(field.id, visible)
                      }
                    />
                  </PopoverContent>
                )}
              </Popover>
            );
          })}
          {canEdit && (
            <Popover open={addFieldOpen} onOpenChange={setAddFieldOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="kb-collection-table-head-cell kb-collection-table-add-field"
                  role="columnheader"
                  aria-label="Добавить свойство"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Plus className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={6}
                className="kb-collection-column-menu"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={stopBlockInteraction}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <CollectionAddFieldMenu
                  onAdd={(type) => {
                    onAddField(type);
                    setAddFieldOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
        {items.map((item) => (
          <div
            key={item.id}
            className="kb-collection-table-row"
            role="row"
            style={rowStyle}
          >
            <div
              className="kb-collection-table-title-cell"
              role="cell"
              data-kb-collection-cell
              data-selected={isCellSelected(item.id, "title") || undefined}
            >
              <CollectionTableTitleCell
                item={item}
                selected={isCellSelected(item.id, "title")}
                editing={editingTitleId === item.id}
                showPageIcon={layoutSettings.showPageIcon}
                onSelect={() => {
                  blurActiveCellEditor();
                  setSelectedCell({ itemId: item.id, cellId: "title" });
                  setEditingTitleId(null);
                }}
                onEdit={() => {
                  blurActiveCellEditor();
                  setSelectedCell({ itemId: item.id, cellId: "title" });
                  setEditingTitleId(item.id);
                }}
                onCancel={() => setEditingTitleId(null)}
                onCommit={(title) => {
                  setEditingTitleId(null);
                  onRenameItemTitle(item.id, title);
                }}
              />
            </div>
            {fields.map((field) => {
              const property = collectionFieldDisplayProperty(
                findPropertyForCollectionField(
                  item.properties,
                  field,
                  collectionId,
                ),
                field,
                {
                  collectionId,
                  collectionTitle,
                },
              );
              const selected = isCellSelected(item.id, field.id);
              return (
                <div
                  key={field.id}
                  className="kb-collection-table-cell"
                  role="cell"
                  data-field-type={field.type}
                  data-display-variant={field.displayVariant ?? undefined}
                  data-rating-variant={field.ratingVariant ?? undefined}
                  data-kb-collection-cell
                  data-selected={selected || undefined}
                  onPointerDownCapture={(event) => {
                    blurActiveCellEditor();
                    setEditingTitleId(null);
                    if (selected) return;
                    stopBlockMenuAction(event);
                    setSelectedCell({ itemId: item.id, cellId: field.id });
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <PropertyValueControl
                    property={property}
                    canEdit={canEdit}
                    canEditOptions={false}
                    onChangeValue={(value) =>
                      onChangeValue(item.id, field, value)
                    }
                    onChangeOptions={() => {}}
                    onChangeOptionColors={() => {}}
                  />
                </div>
              );
            })}
            {canEdit && (
              <div
                className="kb-collection-table-cell kb-collection-table-add-field-spacer"
                role="cell"
                aria-hidden
              />
            )}
          </div>
        ))}
        {canEdit && (
          <CollectionTableNewRow
            rowStyle={rowStyle}
            fields={fields}
            creating={creating}
            onCreate={onCreateRecord}
          />
        )}
        {canEdit &&
          items.length === 0 &&
          Array.from({ length: 2 }).map((_, index) => (
            <div
              key={`blank-${index}`}
              className="kb-collection-table-row kb-collection-table-blank-row"
              role="row"
              style={rowStyle}
              aria-hidden
            >
              <div className="kb-collection-table-title-cell" role="cell" />
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="kb-collection-table-cell"
                  role="cell"
                />
              ))}
              <div
                className="kb-collection-table-cell kb-collection-table-add-field-spacer"
                role="cell"
              />
            </div>
          ))}
        {columnDrag && (
          <>
            {(() => {
              const field = fields.find((item) => item.id === columnDrag.activeId);
              if (!field) return null;
              const Icon = FIELD_ICONS[field.type];
              return (
                <div
                  className="kb-collection-column-drag-preview"
                  style={{
                    left: columnDrag.previewX,
                    width: columnDrag.previewWidth,
                  }}
                  aria-hidden
                >
                  <Icon className="size-3.5" />
                  <span>{field.name}</span>
                </div>
              );
            })()}
            <div
              className="kb-collection-column-drop-indicator"
              style={{ left: columnDrag.x }}
              aria-hidden
            />
          </>
        )}
        {resizeIndicatorX !== null && (
          <div
            className="kb-collection-column-resize-indicator"
            style={{ left: resizeIndicatorX }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
