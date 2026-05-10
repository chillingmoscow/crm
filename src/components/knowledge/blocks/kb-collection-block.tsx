"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import {
  ArrowLeft,
  ArrowDownAZ,
  ArrowRight,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  EyeOff,
  FileText,
  GalleryHorizontalEnd,
  GripVertical,
  Hash,
  Info,
  ArrowUpDown,
  Link as LinkIcon,
  ListFilter,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Paintbrush,
  Pencil,
  Pin,
  Plus,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Settings2,
  Star,
  Table2,
  Trash2,
  Type,
  WrapText,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbIconPickerBody } from "@/components/knowledge/kb-icon-picker";
import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import { PropertyValueControl } from "@/app/(dashboard)/knowledge/_components/kb-page-properties";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  createKbCollectionView,
  createKbCollectionRecord,
  deleteKbCollectionView,
  duplicateKbCollectionView,
  getOrCreateKbPageCollection,
  listKbCollectionItems,
  restoreKbCollectionView,
  syncKbCollectionRecords,
  updateKbCollection,
  updateKbCollectionRecordTitle,
  updateKbCollectionView,
  type KbCollectionState,
  type KbCollectionItem,
} from "@/lib/knowledge/collection-actions";
import {
  KB_COLLECTION_DEFAULT_TITLE,
  createCollectionField,
  createCollectionFilter,
  findPropertyForCollectionField,
  getPageCollectionId,
  inferCollectionSchemaFromProperties,
  isCollectionFieldVisible,
  KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  KB_COLLECTION_EMPTY_SCHEMA,
  KB_COLLECTION_CREATABLE_FIELD_TYPES,
  KB_COLLECTION_FIELD_LABELS,
  KB_COLLECTION_VIEW_LABELS,
  normalizeCollectionTitle,
  normalizeCollectionViewName,
  normalizeCollectionViewType,
  parseCollectionSchemaJson,
  parseVisibleFieldIdsJson,
  serializeCollectionSchema,
  serializeVisibleFieldIds,
  setCollectionFieldPropertyValue,
  createDefaultCollectionViewLayoutSettings,
  type KbCollectionColumnWidths,
  type KbCollectionField,
  type KbCollectionFilter,
  type KbCollectionFilterOperator,
  type KbCollectionSchema,
  type KbCollectionView,
  type KbCollectionViewConfig,
  type KbCollectionViewIcon,
  type KbCollectionViewLayoutSettings,
  type KbCollectionViewTabDisplay,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
import {
  createCollectionGrouping,
  groupCollectionItems,
  type KbCollectionGrouping,
  type KbCollectionItemGroup,
} from "@/lib/knowledge/collection-group";
import {
  createCollectionSort,
  sortCollectionItems,
  type KbCollectionSort,
  type KbCollectionSortDirection,
} from "@/lib/knowledge/collection-sort";
import {
  defaultFilterOperator,
  filterCollectionItems,
  filterOperatorNeedsValue,
  filterOperatorsForField,
  normalizeFilterInputValue,
  normalizeFilterOperatorForField,
} from "@/lib/knowledge/collection-filter";
import {
  formatPropertyValue,
  sortDirectionLabel,
} from "@/lib/knowledge/collection-format";
import {
  buildLegacyCollectionBlocks,
  collectionFieldDisplayProperty,
  collectionFieldTypeOptions,
  insertCollectionFieldId,
  MIN_TABLE_COLUMN_WIDTH,
  minTableColumnWidthForField,
  orderCollectionFields,
  reorderCollectionFieldIds,
  type FieldDropPlacement,
} from "@/lib/knowledge/collection-fields";
import { saveKbPageProperties } from "@/lib/knowledge/properties";
import type { KbProperty, KbPropertyType } from "@/types/knowledge";

type KbCollectionRuntime = {
  pageId: string | null;
  canCreatePages: boolean;
};

const KbCollectionRuntimeContext = createContext<KbCollectionRuntime>({
  pageId: null,
  canCreatePages: false,
});

export function KbCollectionRuntimeProvider({
  value,
  children,
}: {
  value: KbCollectionRuntime;
  children: ReactNode;
}) {
  return (
    <KbCollectionRuntimeContext.Provider value={value}>
      {children}
    </KbCollectionRuntimeContext.Provider>
  );
}

const collectionBlockConfig = {
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

type CollectionRenderProps = ReactCustomBlockRenderProps<
  typeof collectionBlockConfig
>;

const FIELD_ICONS: Record<
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

const VIEW_TAB_DISPLAY_LABELS: Record<KbCollectionViewTabDisplay, string> = {
  "text-icon": "Текст и иконка",
  text: "Только текст",
  icon: "Только иконка",
};

function getCollectionViewFallbackIcon(viewConfig: {
  icon?: KbCollectionViewIcon;
  viewType: KbCollectionView;
}) {
  return viewConfig.viewType === "table" ? Database : ListChecks;
}

const SAVE_CELL_DEBOUNCE_MS = 650;
const TABLE_TITLE_COLUMN_WIDTH_ID = "__title";
const MAX_TABLE_COLUMN_WIDTH = 640;

type CollectionSettingsPanel =
  | "layout"
  | "display"
  | "properties"
  | "filters"
  | "sorts"
  | "grouping"
  | "views";
type CollectionTableCellId = "title" | string;
type CollectionTableSelection = {
  itemId: string;
  cellId: CollectionTableCellId;
};

function KbCollectionBlock({ block, editor }: CollectionRenderProps) {
  const runtime = useContext(KbCollectionRuntimeContext);
  const editable = editor.isEditable;
  const canCreate = editable && runtime.canCreatePages && Boolean(runtime.pageId);
  const [items, setItems] = useState<KbCollectionItem[]>([]);
  const [collectionState, setCollectionState] =
    useState<KbCollectionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] =
    useState<CollectionSettingsPanel | null>(null);
  const [viewMenuId, setViewMenuId] = useState<string | null>(null);
  const [moreViewsOpen, setMoreViewsOpen] = useState(false);
  const [createViewMenuOpen, setCreateViewMenuOpen] = useState(false);
  const [viewSearch, setViewSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [pendingTitleEditItemId, setPendingTitleEditItemId] = useState<
    string | null
  >(null);
  const [visibleViewTabCount, setVisibleViewTabCount] = useState<number | null>(
    null,
  );
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(KB_COLLECTION_DEFAULT_TITLE);
  const deletedViewUndoRef = useRef<KbCollectionViewConfig | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const viewTabsRef = useRef<HTMLDivElement>(null);
  const viewTabsMeasureRef = useRef<HTMLDivElement>(null);
  const collectionStateRef = useRef<KbCollectionState | null>(null);
  const collectionStatePageIdRef = useRef<string | null>(null);
  const pendingViewOrderRef = useRef<KbCollectionViewConfig[] | null>(null);
  const viewDragMovedRef = useRef(false);
  const settingsOpenGuardUntilRef = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<KbCollectionItem[]>([]);
  const cancelTitleRenameRef = useRef(false);
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const legacyCollectionId = runtime.pageId
    ? getPageCollectionId(runtime.pageId)
    : block.props.collectionId || block.id;
  const legacyCollectionTitle = normalizeCollectionTitle(block.props.title);
  const legacyView = normalizeCollectionViewType(block.props.view);
  const legacyViewTitle = normalizeCollectionViewName(
    block.props.viewTitle,
    legacyView,
  );
  const activeView =
    collectionState?.views.find(
      (item) => item.id === collectionState.activeViewId,
    ) ??
    collectionState?.views[0] ??
    null;
  const collectionId =
    collectionState?.collection.collectionKey ?? legacyCollectionId;
  const collectionTitle =
    collectionState?.collection.title ?? legacyCollectionTitle;
  const dbCollectionId = collectionState?.collection.id ?? null;
  const view: KbCollectionView = activeView?.viewType ?? legacyView;
  const viewTitle = activeView?.name ?? legacyViewTitle;
  const ActiveViewIcon = view === "table" ? Table2 : ListChecks;
  const activeColumnWidths = activeView?.columnWidths ?? {};
  const activeLayoutSettings =
    activeView?.layoutSettings ?? createDefaultCollectionViewLayoutSettings(view);

  const schema = useMemo(
    () =>
      collectionState?.collection.schema ??
      parseCollectionSchemaJson(block.props.schemaJson),
    [block.props.schemaJson, collectionState?.collection.schema],
  );
  const visibleFieldIds = useMemo(
    () =>
      activeView
        ? activeView.visibleFieldIds
        : parseVisibleFieldIdsJson(block.props.visibleFieldIdsJson),
    [activeView, block.props.visibleFieldIdsJson],
  );
  const fieldOrderIds = useMemo(
    () =>
      activeView
        ? activeView.fieldOrderIds
        : parseVisibleFieldIdsJson(block.props.fieldOrderIdsJson),
    [activeView, block.props.fieldOrderIdsJson],
  );
  const orderedFields = useMemo(
    () => orderCollectionFields(schema.fields, fieldOrderIds),
    [fieldOrderIds, schema.fields],
  );
  const visibleFields = useMemo(
    () =>
      orderedFields.filter((field) =>
        isCollectionFieldVisible(field.id, visibleFieldIds),
      ),
    [orderedFields, visibleFieldIds],
  );
  const activeFilters = activeView?.filters ?? [];
  const activeSorts = activeView?.sorts ?? [];
  const activeGrouping = activeView?.grouping ?? null;
  const viewTabs = collectionState?.views ?? [];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredItems = useMemo(
    () => filterCollectionItems(items, schema.fields, activeFilters, collectionId),
    [activeFilters, collectionId, items, schema.fields],
  );
  const searchedItems = useMemo(() => {
    if (!normalizedSearchQuery) return filteredItems;
    return filteredItems.filter((item) => {
      const values = [
        item.title,
        item.plain_text,
        ...visibleFields.map((field) =>
          formatPropertyValue(
            collectionFieldDisplayProperty(
              findPropertyForCollectionField(item.properties, field, collectionId),
              field,
              { collectionId, collectionTitle },
            ),
          ),
        ),
      ];
      return values.some((value) =>
        value.toLowerCase().includes(normalizedSearchQuery),
      );
    });
  }, [
    collectionId,
    collectionTitle,
    filteredItems,
    normalizedSearchQuery,
    visibleFields,
  ]);
  const sortedItems = useMemo(
    () => sortCollectionItems(searchedItems, schema.fields, activeSorts, collectionId),
    [activeSorts, collectionId, schema.fields, searchedItems],
  );
  const groupedItems = useMemo(
    () =>
      groupCollectionItems(
        sortedItems,
        schema.fields,
        activeGrouping,
        collectionId,
      ),
    [activeGrouping, collectionId, schema.fields, sortedItems],
  );
  const visibleViewTabs = useMemo(() => {
    if (visibleViewTabCount === null || visibleViewTabCount >= viewTabs.length) {
      return viewTabs;
    }
    const count = Math.max(1, visibleViewTabCount);
    const visible = viewTabs.slice(0, count);
    if (
      collectionState?.activeViewId &&
      !visible.some((item) => item.id === collectionState.activeViewId)
    ) {
      const active = viewTabs.find(
        (item) => item.id === collectionState.activeViewId,
      );
      if (active) return [...visible.slice(0, Math.max(0, count - 1)), active];
    }
    return visible;
  }, [collectionState?.activeViewId, viewTabs, visibleViewTabCount]);
  const hiddenViewTabs = useMemo(
    () => viewTabs.filter((item) => !visibleViewTabs.some((tab) => tab.id === item.id)),
    [viewTabs, visibleViewTabs],
  );
  const searchedViewTabs = useMemo(() => {
    const query = viewSearch.trim().toLowerCase();
    if (!query) return viewTabs;
    return viewTabs.filter((item) => item.name.toLowerCase().includes(query));
  }, [viewSearch, viewTabs]);
  const inferredSchema = useMemo(
    () =>
      inferCollectionSchemaFromProperties(
        items.map((item) => item.properties),
        collectionId,
      ),
    [collectionId, items],
  );

  const loadItems = useCallback(async () => {
    if (!runtime.pageId) {
      setItems([]);
      setItemsLoaded(true);
      return;
    }
    setLoading(true);
    setItemsLoaded(false);
    const result = await listKbCollectionItems(runtime.pageId);
    const rows = result?.rows ?? [];
    const error = result?.error ?? null;
    if (error) {
      toast.error(`Не удалось загрузить коллекцию: ${error}`);
    } else {
      setItems(rows);
    }
    setLoading(false);
    setItemsLoaded(true);
  }, [runtime.pageId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useLayoutEffect(() => {
    const element = blockRef.current;
    if (!element) return;

    const updatePreviewWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      if (nextWidth <= 0) return;
      setPreviewWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );
    };

    updatePreviewWidth();
    const resizeObserver = new ResizeObserver(updatePreviewWidth);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    collectionStateRef.current = collectionState;
  }, [collectionState]);

  useLayoutEffect(() => {
    const container = viewTabsRef.current;
    const measure = viewTabsMeasureRef.current;
    if (!container || !measure) return;

    const updateVisibleTabs = () => {
      const containerWidth = container.getBoundingClientRect().width;
      const tabNodes = Array.from(
        measure.querySelectorAll<HTMLElement>("[data-kb-view-tab-measure]"),
      );
      if (containerWidth <= 0 || tabNodes.length === 0) {
        setVisibleViewTabCount(null);
        return;
      }
      const moreNode = measure.querySelector<HTMLElement>(
        "[data-kb-view-more-measure]",
      );
      const addNode = measure.querySelector<HTMLElement>(
        "[data-kb-view-add-measure]",
      );
      const gap = 6;
      const moreWidth = (moreNode?.getBoundingClientRect().width ?? 86) + gap;
      const addWidth =
        editable && tabNodes.length > 0
          ? (addNode?.getBoundingClientRect().width ?? 36) + gap
          : 0;
      let usedWidth = 0;
      let nextCount = tabNodes.length;

      for (let index = 0; index < tabNodes.length; index += 1) {
        const width = tabNodes[index]!.getBoundingClientRect().width;
        const hasHiddenTabs = index < tabNodes.length - 1;
        const reserve = hasHiddenTabs ? moreWidth : addWidth;
        if (usedWidth + width + reserve <= containerWidth || index === 0) {
          usedWidth += width + gap;
          nextCount = index + 1;
          continue;
        }
        break;
      }

      setVisibleViewTabCount((current) =>
        current === nextCount ? current : nextCount,
      );
    };

    updateVisibleTabs();
    const resizeObserver = new ResizeObserver(updateVisibleTabs);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [editable, viewTabs.length, viewTabs.map((item) => item.name).join("\u0000")]);

  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!renamingTitle) setTitleDraft(collectionTitle);
  }, [collectionTitle, renamingTitle]);

  useEffect(() => {
    if (!renamingTitle) return;
    window.requestAnimationFrame(() => {
      titleInputRef.current?.select();
    });
  }, [renamingTitle]);

  useEffect(() => {
    if (!runtime.pageId) {
      setCollectionState(null);
      collectionStatePageIdRef.current = null;
      return;
    }

    const currentState = collectionStateRef.current;
    if (
      collectionStatePageIdRef.current === runtime.pageId &&
      currentState
    ) {
      if (
        block.props.viewId &&
        currentState.views.some((item) => item.id === block.props.viewId) &&
        currentState.activeViewId !== block.props.viewId
      ) {
        setCollectionState({
          ...currentState,
          activeViewId: block.props.viewId,
        });
      }
      return;
    }

    let cancelled = false;
    setCollectionLoading(true);
    const legacyBlocks = buildLegacyCollectionBlocks(editor);
    void getOrCreateKbPageCollection({
      pageId: runtime.pageId,
      blockId: block.id,
      preferredViewId: block.props.viewId || null,
      legacyBlocks,
    }).then((result) => {
      if (cancelled) return;
      setCollectionLoading(false);
      if (result.error || !result.state) {
        if (editable) {
          toast.error(
            `Не удалось загрузить настройки коллекции: ${result.error}`,
          );
        }
        return;
      }

      setCollectionState(result.state);
      collectionStatePageIdRef.current = runtime.pageId;
      const nextProps: Record<string, string> = {};
      if (block.props.collectionId !== result.state.collection.collectionKey) {
        nextProps.collectionId = result.state.collection.collectionKey;
      }
      if (block.props.viewId !== result.state.activeViewId) {
        nextProps.viewId = result.state.activeViewId;
      }
      if (Object.keys(nextProps).length > 0 && editable) {
        editor.updateBlock(block.id, { props: nextProps } as never);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    block.id,
    block.props.collectionId,
    block.props.viewId,
    editable,
    editor,
    runtime.pageId,
  ]);

  useEffect(() => {
    if (!editable || !runtime.pageId || !itemsLoaded) return;
    if (schema.fields.length === 0 && inferredSchema.fields.length > 0) return;
    if (!dbCollectionId && collectionState !== null) return;

    const timer = window.setTimeout(() => {
      void syncKbCollectionRecords({
        parentPageId: runtime.pageId!,
        ...(dbCollectionId
          ? { collectionDbId: dbCollectionId }
          : {
              schemaJson: serializeCollectionSchema(schema),
              collectionId,
              collectionTitle,
            }),
      }).then((result) => {
        const error = result?.error ?? null;
        if (error) {
          toast.error(`Не удалось применить поля коллекции: ${error}`);
        }
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    collectionId,
    collectionTitle,
    collectionState,
    dbCollectionId,
    editable,
    inferredSchema.fields.length,
    itemsLoaded,
    runtime.pageId,
    schema,
  ]);

  const updateSchema = (nextSchema: KbCollectionSchema) => {
    if (!dbCollectionId) {
      editor.updateBlock(block.id, {
        props: { schemaJson: serializeCollectionSchema(nextSchema) },
      } as never);
      return;
    }
    setCollectionState((current) =>
      current
        ? {
            ...current,
            collection: { ...current.collection, schema: nextSchema },
          }
        : current,
    );
    void updateKbCollection({
      collectionId: dbCollectionId,
      schemaJson: serializeCollectionSchema(nextSchema),
    }).then((result) => {
      if (result.error || !result.collection) {
        toast.error(`Не удалось сохранить схему: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? { ...current, collection: result.collection! }
          : current,
      );
      if (runtime.pageId) {
        void syncKbCollectionRecords({
          parentPageId: runtime.pageId,
          collectionDbId: result.collection.id,
        }).then(({ error }) => {
          if (error) toast.error(`Не удалось применить поля: ${error}`);
        });
      }
    });
  };

  const updateVisibleFieldIds = useCallback(
    (next: KbCollectionVisibleFieldIds) => {
      if (!activeView) {
        editor.updateBlock(block.id, {
          props: { visibleFieldIdsJson: serializeVisibleFieldIds(next) },
        } as never);
        return;
      }
      const viewId = activeView.id;
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === viewId ? { ...item, visibleFieldIds: next } : item,
              ),
            }
          : current,
      );
      void updateKbCollectionView({
        viewId,
        visibleFieldIds: next,
      }).then((result) => {
        if (result.error || !result.view) {
          toast.error(`Не удалось сохранить видимость полей: ${result.error}`);
          return;
        }
        setCollectionState((current) =>
          current
            ? {
                ...current,
                views: current.views.map((item) =>
                  item.id === result.view!.id ? result.view! : item,
                ),
              }
            : current,
        );
      });
    },
    [activeView, block.id, editor],
  );

  const updateFieldOrderIds = useCallback(
    (next: string[] | null) => {
      if (!activeView) {
        editor.updateBlock(block.id, {
          props: { fieldOrderIdsJson: serializeVisibleFieldIds(next) },
        } as never);
        return;
      }
      const viewId = activeView.id;
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === viewId ? { ...item, fieldOrderIds: next } : item,
              ),
            }
          : current,
      );
      void updateKbCollectionView({
        viewId,
        fieldOrderIds: next,
      }).then((result) => {
        if (result.error || !result.view) {
          toast.error(`Не удалось сохранить порядок полей: ${result.error}`);
          return;
        }
        setCollectionState((current) =>
          current
            ? {
                ...current,
                views: current.views.map((item) =>
                  item.id === result.view!.id ? result.view! : item,
                ),
              }
            : current,
        );
      });
    },
    [activeView, block.id, editor],
  );

  useEffect(() => {
    if (!editable || !itemsLoaded || schema.fields.length > 0) return;
    if (inferredSchema.fields.length === 0) return;
    updateSchema(inferredSchema);
    if (visibleFieldIds !== null) {
      updateVisibleFieldIds(inferredSchema.fields.map((field) => field.id));
    }
    if (fieldOrderIds !== null) {
      updateFieldOrderIds(inferredSchema.fields.map((field) => field.id));
    }
  }, [
    editable,
    fieldOrderIds,
    inferredSchema,
    itemsLoaded,
    schema.fields.length,
    updateFieldOrderIds,
    updateVisibleFieldIds,
    visibleFieldIds,
  ]);

  const updateViewType = (nextView: KbCollectionView) => {
    if (nextView === view || !activeView) return;
    const nextName =
      viewTitle === KB_COLLECTION_VIEW_LABELS[view]
        ? KB_COLLECTION_VIEW_LABELS[nextView]
        : viewTitle;
    const viewId = activeView.id;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId
                ? { ...item, viewType: nextView, name: nextName }
                : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      viewType: nextView,
      name: nextName,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось изменить тип вида: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateViewTitle = (nextTitle: string) => {
    if (!activeView) return;
    const title = normalizeCollectionViewName(nextTitle, view);
    const viewId = activeView.id;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, name: title } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      viewType: view,
      name: title,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось переименовать вид: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateViewTitleById = (viewId: string, nextTitle: string) => {
    const targetView = collectionState?.views.find((item) => item.id === viewId);
    if (!targetView) return;
    const title = normalizeCollectionViewName(nextTitle, targetView.viewType);
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, name: title } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      viewType: targetView.viewType,
      name: title,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось переименовать вид: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateViewDescriptionById = (viewId: string, description: string) => {
    const targetView = collectionState?.views.find((item) => item.id === viewId);
    if (!targetView || targetView.description === description.trim()) return;
    const nextDescription = description.trim().slice(0, 280);
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId
                ? { ...item, description: nextDescription }
                : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      description: nextDescription,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить описание вида: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateActiveViewDescription = (description: string) => {
    if (!activeView) return;
    updateViewDescriptionById(activeView.id, description);
  };

  const updateViewIconById = (viewId: string, icon: KbCollectionViewIcon) => {
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, icon } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({ viewId, icon }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить иконку вида: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateActiveViewIcon = (icon: KbCollectionViewIcon) => {
    if (!activeView) return;
    updateViewIconById(activeView.id, icon);
  };

  const updateViewTabDisplayById = (
    viewId: string,
    tabDisplay: KbCollectionViewTabDisplay,
  ) => {
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, tabDisplay } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({ viewId, tabDisplay }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить отображение вида: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateActiveViewTabDisplay = (
    tabDisplay: KbCollectionViewTabDisplay,
  ) => {
    if (!activeView) return;
    updateViewTabDisplayById(activeView.id, tabDisplay);
  };

  const updateActiveViewLayoutSettings = (
    patch: Partial<KbCollectionViewLayoutSettings>,
  ) => {
    if (!activeView) return;
    const viewId = activeView.id;
    const nextSettings = {
      ...createDefaultCollectionViewLayoutSettings(activeView.viewType),
      ...activeView.layoutSettings,
      ...patch,
    };
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId
                ? { ...item, layoutSettings: nextSettings }
                : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      layoutSettings: nextSettings,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить настройки вида: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateColumnWidths = (nextWidths: KbCollectionColumnWidths) => {
    if (!activeView) return;
    const viewId = activeView.id;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, columnWidths: nextWidths } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      columnWidths: nextWidths,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить ширину столбцов: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateViewTypeById = (viewId: string, nextView: KbCollectionView) => {
    const targetView = collectionState?.views.find((item) => item.id === viewId);
    if (!targetView || targetView.viewType === nextView) return;
    const nextName =
      targetView.name === KB_COLLECTION_VIEW_LABELS[targetView.viewType]
        ? KB_COLLECTION_VIEW_LABELS[nextView]
        : targetView.name;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId
                ? { ...item, viewType: nextView, name: nextName }
                : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      viewType: nextView,
      name: nextName,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось изменить тип вида: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const renameCollection = (nextTitle: string) => {
    const title = normalizeCollectionTitle(nextTitle);
    setTitleDraft(title);
    if (title === collectionTitle) return;
    if (!dbCollectionId) {
      editor.updateBlock(block.id, { props: { title } } as never);
      return;
    }
    setCollectionState((current) =>
      current
        ? {
            ...current,
            collection: { ...current.collection, title },
          }
        : current,
    );
    void updateKbCollection({ collectionId: dbCollectionId, title }).then(
      (result) => {
        if (result.error || !result.collection) {
          toast.error(`Не удалось переименовать коллекцию: ${result.error}`);
          return;
        }
        setCollectionState((current) =>
          current ? { ...current, collection: result.collection! } : current,
        );
        if (runtime.pageId) {
          void syncKbCollectionRecords({
            parentPageId: runtime.pageId,
            collectionDbId: result.collection.id,
          }).then(({ error }) => {
            if (error) toast.error(`Не удалось применить название: ${error}`);
          });
        }
      },
    );
  };

  const commitTitleRename = (nextTitle = titleDraft) => {
    if (cancelTitleRenameRef.current) {
      cancelTitleRenameRef.current = false;
      return;
    }
    renameCollection(nextTitle);
    setRenamingTitle(false);
  };

  const reorderField = (
    activeId: string,
    targetId: string,
    placement: FieldDropPlacement = "before",
  ) => {
    if (activeId === targetId && placement === "before") return;
    const nextOrder = reorderCollectionFieldIds(
      schema.fields,
      fieldOrderIds,
      activeId,
      targetId,
      placement,
    );
    if (!nextOrder) return;
    updateFieldOrderIds(nextOrder);
  };

  const insertField = (
    type: KbPropertyType,
    targetId: string,
    placement: FieldDropPlacement,
    name?: string,
  ) => {
    const targetIndex = schema.fields.findIndex((field) => field.id === targetId);
    if (targetIndex < 0) return;

    const field = createCollectionField(type, name?.trim() || undefined);
    updateSchema({ version: 1, fields: [...schema.fields, field] });
    updateFieldOrderIds(
      insertCollectionFieldId(
        schema.fields,
        fieldOrderIds,
        field.id,
        targetId,
        placement,
      ),
    );
    if (visibleFieldIds !== null) {
      const nextVisible = [...visibleFieldIds];
      const visibleTargetIndex = nextVisible.indexOf(targetId);
      nextVisible.splice(
        visibleTargetIndex < 0
          ? nextVisible.length
          : placement === "after"
            ? visibleTargetIndex + 1
            : visibleTargetIndex,
        0,
        field.id,
      );
      updateVisibleFieldIds(nextVisible);
    }
  };

  const addField = (type: KbPropertyType) => {
    const field = createCollectionField(type);
    const previousFieldIds = schema.fields.map((item) => item.id);
    updateSchema({ version: 1, fields: [...schema.fields, field] });
    updateFieldOrderIds([
      ...orderCollectionFields(schema.fields, fieldOrderIds).map(
        (item) => item.id,
      ),
      field.id,
    ]);
    updateVisibleFieldIds([
      ...(visibleFieldIds ?? previousFieldIds),
      field.id,
    ]);

    if (activeView && collectionState) {
      const viewsToFreeze = collectionState.views.filter(
        (viewConfig) =>
          viewConfig.id !== activeView.id &&
          viewConfig.visibleFieldIds === null,
      );
      if (viewsToFreeze.length > 0) {
        setCollectionState((current) =>
          current
            ? {
                ...current,
                views: current.views.map((viewConfig) =>
                  viewsToFreeze.some((item) => item.id === viewConfig.id)
                    ? { ...viewConfig, visibleFieldIds: previousFieldIds }
                    : viewConfig,
                ),
              }
            : current,
        );
        for (const viewConfig of viewsToFreeze) {
          void updateKbCollectionView({
            viewId: viewConfig.id,
            visibleFieldIds: previousFieldIds,
          }).then((result) => {
            if (result.error) {
              toast.error(
                `Не удалось сохранить видимость полей: ${result.error}`,
              );
            }
          });
        }
      }
    }
  };

  const updateField = (id: string, patch: Partial<KbCollectionField>) => {
    updateSchema({
      version: 1,
      fields: schema.fields.map((field) => {
        if (field.id !== id) return field;
        if (patch.type && patch.type !== field.type) {
          return {
            ...createCollectionField(patch.type, field.name),
            id: field.id,
            description: field.description,
            icon: field.icon,
            iconColor: field.iconColor,
          };
        }
        return { ...field, ...patch };
      }),
    });
  };

  const duplicateField = (id: string) => {
    const fieldIndex = schema.fields.findIndex((field) => field.id === id);
    if (fieldIndex < 0) return;
    const field = schema.fields[fieldIndex]!;
    const duplicate = {
      ...field,
      id: createCollectionField(field.type).id,
      name: field.name ? `${field.name} копия` : "Копия",
    };
    updateSchema({
      version: 1,
      fields: [
        ...schema.fields.slice(0, fieldIndex + 1),
        duplicate,
        ...schema.fields.slice(fieldIndex + 1),
      ],
    });
    updateFieldOrderIds(
      insertCollectionFieldId(
        schema.fields,
        fieldOrderIds,
        duplicate.id,
        id,
        "after",
      ),
    );
    updateVisibleFieldIds([
      ...(visibleFieldIds ?? schema.fields.map((item) => item.id)),
      duplicate.id,
    ]);
  };

  const removeField = (id: string) => {
    updateSchema({
      version: 1,
      fields: schema.fields.filter((field) => field.id !== id),
    });
    if (visibleFieldIds !== null) {
      updateVisibleFieldIds(visibleFieldIds.filter((fieldId) => fieldId !== id));
    }
    if (fieldOrderIds !== null) {
      updateFieldOrderIds(fieldOrderIds.filter((fieldId) => fieldId !== id));
    }
  };

  const setFieldVisible = (id: string, visible: boolean) => {
    const current =
      visibleFieldIds ??
      schema.fields.map((field) => field.id);
    const next = visible
      ? Array.from(new Set([...current, id]))
      : current.filter((fieldId) => fieldId !== id);
    updateVisibleFieldIds(next);
  };

  const updateFilters = (nextFilters: KbCollectionFilter[]) => {
    if (!activeView) return;
    const viewId = activeView.id;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, filters: nextFilters } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      filters: nextFilters,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить фильтры: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const sortField = (fieldId: string, direction: KbCollectionSortDirection) => {
    updateSorts([
      createCollectionSort(fieldId, direction),
      ...activeSorts.filter((sort) => sort.fieldId !== fieldId),
    ]);
  };

  const updateSorts = (nextSorts: KbCollectionSort[]) => {
    if (!activeView) return;
    const viewId = activeView.id;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, sorts: nextSorts } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      sorts: nextSorts,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить сортировки: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const updateGrouping = (nextGrouping: KbCollectionGrouping | null) => {
    if (!activeView) return;
    const viewId = activeView.id;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: current.views.map((item) =>
              item.id === viewId ? { ...item, grouping: nextGrouping } : item,
            ),
          }
        : current,
    );
    void updateKbCollectionView({
      viewId,
      grouping: nextGrouping,
    }).then((result) => {
      if (result.error || !result.view) {
        toast.error(`Не удалось сохранить группировку: ${result.error}`);
        return;
      }
      setCollectionState((current) =>
        current
          ? {
              ...current,
              views: current.views.map((item) =>
                item.id === result.view!.id ? result.view! : item,
              ),
            }
          : current,
      );
    });
  };

  const createRecord = async () => {
    if (!runtime.pageId || !canCreate) return;
    setCreating(true);
    const result = await createKbCollectionRecord({
      parentPageId: runtime.pageId,
      ...(dbCollectionId
        ? { collectionDbId: dbCollectionId }
        : {
            schemaJson: serializeCollectionSchema(schema),
            collectionId,
            collectionTitle,
          }),
    });
    setCreating(false);
    const row = result?.row ?? null;
    const error = result?.error ?? null;
    if (error || !row) {
      toast.error(error ?? "Не удалось создать запись");
      return;
    }
    setItems((current) =>
      current.some((item) => item.id === row.id) ? current : [...current, row],
    );
    setPendingTitleEditItemId(row.id);
  };

  const updateItemTitle = (pageId: string, title: string) => {
    const nextTitle = title.trim() || "Без названия";
    setItems((current) =>
      current.map((item) =>
        item.id === pageId ? { ...item, title: nextTitle } : item,
      ),
    );
    void updateKbCollectionRecordTitle({
      pageId,
      title: nextTitle,
    }).then((result) => {
      if (result.error || !result.title) {
        toast.error(`Не удалось переименовать запись: ${result.error}`);
        return;
      }
      setItems((current) =>
        current.map((item) =>
          item.id === pageId ? { ...item, title: result.title! } : item,
        ),
      );
    });
  };

  const scheduleSaveItemProperties = (
    pageId: string,
    properties: KbProperty[],
  ) => {
    const currentTimer = saveTimersRef.current.get(pageId);
    if (currentTimer) window.clearTimeout(currentTimer);

    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(pageId);
      void saveKbPageProperties({
        pageId,
        properties,
        force_new_version: false,
      }).then(({ error }) => {
        if (error) {
          toast.error(`Не удалось сохранить ячейку: ${error}`);
        }
      });
    }, SAVE_CELL_DEBOUNCE_MS);

    saveTimersRef.current.set(pageId, timer);
  };

  const updateItemPropertyValue = (
    pageId: string,
    field: KbCollectionField,
    value: KbProperty["value"],
  ) => {
    let nextPropertiesToSave: KbProperty[] | null = null;
    const nextItems = itemsRef.current.map((item) => {
      if (item.id !== pageId) return item;
      const nextProperties = setCollectionFieldPropertyValue(
        item.properties,
        field,
        { collectionId, collectionTitle },
        value,
      );
      nextPropertiesToSave = nextProperties;
      return { ...item, properties: nextProperties };
    });

    itemsRef.current = nextItems;
    setItems(nextItems);
    if (nextPropertiesToSave) {
      scheduleSaveItemProperties(pageId, nextPropertiesToSave);
    }
  };

  const switchView = (viewId: string) => {
    if (!collectionState?.views.some((item) => item.id === viewId)) return;
    setCollectionState((current) =>
      current ? { ...current, activeViewId: viewId } : current,
    );
    if (editable) {
      editor.updateBlock(block.id, { props: { viewId } } as never);
    }
  };

  const reorderViewTabs = (activeId: string, targetId: string) => {
    if (activeId === targetId) return;
    setCollectionState((current) => {
      if (!current) return current;
      const activeIndex = current.views.findIndex((item) => item.id === activeId);
      const targetIndex = current.views.findIndex((item) => item.id === targetId);
      if (activeIndex === -1 || targetIndex === -1) return current;
      const nextViews = [...current.views];
      const [moved] = nextViews.splice(activeIndex, 1);
      if (!moved) return current;
      nextViews.splice(targetIndex, 0, moved);
      const positionedViews = nextViews.map((item, index) => ({
        ...item,
        position: index,
      }));
      pendingViewOrderRef.current = positionedViews;
      return {
        ...current,
        views: positionedViews,
      };
    });
  };

  const persistViewTabOrder = () => {
    const views =
      pendingViewOrderRef.current ?? collectionStateRef.current?.views ?? [];
    pendingViewOrderRef.current = null;
    for (const [index, viewConfig] of views.entries()) {
      void updateKbCollectionView({
        viewId: viewConfig.id,
        position: index,
      }).then((result) => {
        if (result.error) {
          toast.error(`Не удалось сохранить порядок видов: ${result.error}`);
        }
      });
    }
  };

  const createView = async (viewType: KbCollectionView) => {
    if (!dbCollectionId) return;
    const result = await createKbCollectionView({
      collectionId: dbCollectionId,
      viewType,
    });
    if (result.error || !result.view) {
      toast.error(`Не удалось создать вид: ${result.error}`);
      return;
    }
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: [...current.views, result.view!],
            activeViewId: result.view!.id,
          }
        : current,
    );
    editor.updateBlock(block.id, { props: { viewId: result.view.id } } as never);
  };

  const duplicateView = async (viewId: string) => {
    const result = await duplicateKbCollectionView({ viewId });
    if (result.error || !result.view) {
      toast.error(`Не удалось дублировать вид: ${result.error}`);
      return;
    }
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: [...current.views, result.view!],
            activeViewId: result.view!.id,
          }
        : current,
    );
    editor.updateBlock(block.id, { props: { viewId: result.view.id } } as never);
  };

  const restoreDeletedView = useCallback(async () => {
    const deletedView = deletedViewUndoRef.current;
    if (!deletedView) return;

    const restoreResult = await restoreKbCollectionView({ view: deletedView });
    if (restoreResult.error || !restoreResult.view) {
      toast.error(`Не удалось вернуть вид: ${restoreResult.error}`);
      return;
    }

    deletedViewUndoRef.current = null;
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: [...current.views, restoreResult.view!].sort(
              (a, b) => a.position - b.position,
            ),
            activeViewId: restoreResult.view!.id,
          }
        : current,
    );
    editor.updateBlock(block.id, {
      props: { viewId: restoreResult.view.id },
    } as never);
  }, [block.id, editor]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (!deletedViewUndoRef.current) return;

      event.preventDefault();
      void restoreDeletedView();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [restoreDeletedView]);

  const deleteView = async (viewId: string) => {
    const deletedView = collectionState?.views.find((item) => item.id === viewId);
    const result = await deleteKbCollectionView({ viewId });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setCollectionState((current) =>
      current
        ? {
            ...current,
            views: result.views,
            activeViewId: result.activeViewId ?? current.activeViewId,
          }
        : current,
    );
    if (result.activeViewId) {
      editor.updateBlock(block.id, {
        props: { viewId: result.activeViewId },
      } as never);
    }
    deletedViewUndoRef.current = deletedView ?? null;
  };

  const blockStyle = (
    previewWidth
      ? { "--kb-collection-preview-width": `${previewWidth}px` }
      : undefined
  ) as CSSProperties | undefined;

  const openSettingsPanel = (panel: CollectionSettingsPanel | null = null) => {
    setSettingsPanel(panel);
    setSettingsOpen(true);
  };

  const handleSettingsOpenChange = (open: boolean) => {
    if (!open && Date.now() < settingsOpenGuardUntilRef.current) return;
    setSettingsOpen(open);
    if (!open) setSettingsPanel(null);
  };

  const openSettingsForView = (
    viewId: string,
    panel: CollectionSettingsPanel | null = null,
  ) => {
    if (viewId !== collectionState?.activeViewId) switchView(viewId);
    settingsOpenGuardUntilRef.current = Date.now() + 180;
    setSettingsPanel(panel);
    setSettingsOpen(true);
    window.setTimeout(() => {
      setViewMenuId(null);
      setMoreViewsOpen(false);
    }, 0);
  };

  const startViewTabDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    item: KbCollectionViewConfig,
    measure: boolean,
  ) => {
    if (!editable || measure || event.button !== 0) return;

    event.stopPropagation();
    const row = viewTabsRef.current;
    if (!row) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const rowRect = row.getBoundingClientRect();
    const rowCenterY = rowRect.top + rowRect.height / 2;
    let started = false;

    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!started && Math.hypot(deltaX, deltaY) < 7) return;

      if (!started) {
        started = true;
        viewDragMovedRef.current = true;
        setDraggingViewId(item.id);
        setViewMenuId(null);
        setMoreViewsOpen(false);
      }

      moveEvent.preventDefault();
      const constrainedX = Math.min(
        Math.max(moveEvent.clientX, rowRect.left + 1),
        rowRect.right - 1,
      );
      const target = document
        .elementFromPoint(constrainedX, rowCenterY)
        ?.closest<HTMLElement>("[data-kb-view-tab-id]");
      const targetId = target?.dataset.kbViewTabId;
      if (targetId && targetId !== item.id) {
        reorderViewTabs(item.id, targetId);
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      cleanup();
      if (started) {
        upEvent.preventDefault();
        persistViewTabOrder();
      }
      setDraggingViewId(null);
      window.setTimeout(() => {
        viewDragMovedRef.current = false;
      }, 0);
    };

    const handlePointerCancel = () => {
      cleanup();
      setDraggingViewId(null);
      viewDragMovedRef.current = false;
    };

    document.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
  };

  const renderViewTab = (item: KbCollectionViewConfig, measure = false) => {
    const active = item.id === collectionState?.activeViewId;
    const tabDisplay = item.tabDisplay ?? "text-icon";
    const showTabIcon = tabDisplay !== "text";
    const showTabText = tabDisplay !== "icon";
    const tooltipDescription = item.description.trim();
    const tabButton = (
      <button
        key={item.id}
        type="button"
        className="kb-collection-view-tab"
        data-active={active || undefined}
        data-dragging={draggingViewId === item.id || undefined}
        data-kb-view-tab-measure={measure || undefined}
        data-kb-view-tab-id={measure ? undefined : item.id}
        aria-pressed={active}
        aria-label={item.name}
        onPointerDown={(event) => startViewTabDrag(event, item, measure)}
        onMouseDown={stopBlockInteraction}
        onContextMenu={(event) => {
          if (measure) return;
          event.preventDefault();
          event.stopPropagation();
          setViewMenuId(item.id);
        }}
        onClick={(event) => {
          stopBlockMenuAction(event);
          if (measure) return;
          if (viewDragMovedRef.current) return;
          if (active) {
            setViewMenuId(item.id);
            return;
          }
          switchView(item.id);
        }}
      >
        {showTabIcon && (
          <KbPageIcon
            icon={item.icon}
            color={null}
            size={16}
            fallback={getCollectionViewFallbackIcon(item)}
          />
        )}
        {showTabText && <span>{item.name}</span>}
      </button>
    );

    if (measure) return tabButton;
    return (
      <Popover
        key={item.id}
        open={viewMenuId === item.id}
        onOpenChange={(open) =>
          setViewMenuId((current) => (open ? item.id : current === item.id ? null : current))
        }
      >
        {tooltipDescription ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>{tabButton}</PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs">
              <strong className="font-semibold leading-tight">
                {tooltipDescription}
              </strong>
            </TooltipContent>
          </Tooltip>
        ) : (
          <PopoverTrigger asChild>{tabButton}</PopoverTrigger>
        )}
        <PopoverContent
          align="start"
          sideOffset={6}
          className="kb-collection-view-menu"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <CollectionViewMenu
            viewName={item.name}
            description={item.description}
            icon={item.icon}
            tabDisplay={item.tabDisplay}
            viewType={item.viewType}
            canDelete={viewTabs.length > 1}
            onRename={(name) => updateViewTitleById(item.id, name)}
            onChangeDescription={(description) =>
              updateViewDescriptionById(item.id, description)
            }
            onChangeIcon={(icon) => updateViewIconById(item.id, icon)}
            onChangeTabDisplay={(display) =>
              updateViewTabDisplayById(item.id, display)
            }
            onChangeLayout={(nextView) => updateViewTypeById(item.id, nextView)}
            onEdit={() => openSettingsForView(item.id)}
            onDuplicate={() => {
              setViewMenuId(null);
              void duplicateView(item.id);
            }}
            onDelete={() => {
              setViewMenuId(null);
              void deleteView(item.id);
            }}
          />
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div
      ref={blockRef}
      className="kb-collection-block"
      data-kb-collection-block
      data-editable={editable || undefined}
      data-settings-open={settingsOpen || undefined}
      contentEditable={false}
      style={blockStyle}
    >
      <div className="kb-collection-header">
        {activeLayoutSettings.showDataSourceTitle && (
        <div className="kb-collection-title-row">
          <div className="kb-collection-title">
            {renamingTitle ? (
              <Input
                ref={titleInputRef}
                value={titleDraft}
                autoFocus
                className="kb-collection-title-input"
                aria-label="Название базы"
                onFocus={(event) => event.currentTarget.select()}
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={stopBlockInteraction}
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                onBlur={(event) => commitTitleRename(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitTitleRename(event.currentTarget.value);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelTitleRenameRef.current = true;
                    setTitleDraft(collectionTitle);
                    setRenamingTitle(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="kb-collection-title-button"
                disabled={!editable}
                aria-label="Переименовать базу"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={(event) => {
                  stopBlockMenuAction(event);
                  if (editable) setRenamingTitle(true);
                }}
              >
                {collectionTitle}
              </button>
            )}
            <span className="kb-collection-count">{sortedItems.length}</span>
          </div>
        </div>
        )}
        <div className="kb-collection-toolbar">
          <div
            ref={viewTabsRef}
            className="kb-collection-view-tabs"
            aria-label="Виды коллекции"
          >
            {viewTabs.length > 0 ? (
              visibleViewTabs.map((item) => renderViewTab(item))
            ) : (
              <div className="kb-collection-view-tab" data-active>
                <ActiveViewIcon className="size-4" />
                <span>{viewTitle}</span>
              </div>
            )}
            {hiddenViewTabs.length > 0 && (
              <Popover open={moreViewsOpen} onOpenChange={setMoreViewsOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="kb-collection-view-tab kb-collection-view-more"
                    aria-label="Еще виды"
                    onPointerDown={stopBlockInteraction}
                    onMouseDown={stopBlockInteraction}
                    onClick={stopBlockInteraction}
                  >
                    {hiddenViewTabs.length} еще...
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="kb-collection-view-overflow-menu"
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={stopBlockInteraction}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <div className="kb-collection-view-overflow-panel">
                    <Input
                      value={viewSearch}
                      className="kb-collection-view-overflow-search"
                      placeholder="Найти вид..."
                      aria-label="Найти вид"
                      onPointerDown={stopBlockInteraction}
                      onMouseDown={stopBlockInteraction}
                      onClick={stopBlockInteraction}
                      onChange={(event) =>
                        setViewSearch(event.currentTarget.value)
                      }
                    />
                    <div className="kb-collection-view-overflow-list">
                      {searchedViewTabs.map((item) => {
                        const active = item.id === collectionState?.activeViewId;
                        return (
                          <div
                            key={item.id}
                            className="kb-collection-view-overflow-row"
                            data-active={active || undefined}
                            data-dragging={draggingViewId === item.id || undefined}
                            role="button"
                            tabIndex={0}
                            draggable={editable}
                            onPointerDown={stopBlockInteraction}
                            onMouseDown={stopBlockInteraction}
                            onDragStart={(event) => {
                              if (!editable) return;
                              setDraggingViewId(item.id);
                              viewDragMovedRef.current = false;
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", item.id);
                            }}
                            onDragOver={(event) => {
                              if (!draggingViewId || draggingViewId === item.id) {
                                return;
                              }
                              event.preventDefault();
                              viewDragMovedRef.current = true;
                              reorderViewTabs(draggingViewId, item.id);
                            }}
                            onDrop={(event) => event.preventDefault()}
                            onDragEnd={() => {
                              if (viewDragMovedRef.current) persistViewTabOrder();
                              setDraggingViewId(null);
                              window.setTimeout(() => {
                                viewDragMovedRef.current = false;
                              }, 0);
                            }}
                            onClick={(event) => {
                              stopBlockMenuAction(event);
                              if (viewDragMovedRef.current) return;
                              switchView(item.id);
                              setMoreViewsOpen(false);
                            }}
                          >
                            <GripVertical className="size-4" />
                            <KbPageIcon
                              icon={item.icon}
                              color={null}
                              size={16}
                              fallback={getCollectionViewFallbackIcon(item)}
                            />
                            <span>{item.name}</span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="kb-collection-view-overflow-more-btn"
                                  aria-label="Действия вида"
                                  onPointerDown={stopBlockInteraction}
                                  onMouseDown={stopBlockInteraction}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                  }}
                                >
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                sideOffset={6}
                                className="kb-collection-view-menu"
                                onPointerDown={stopBlockInteraction}
                                onMouseDown={stopBlockInteraction}
                                onClick={stopBlockInteraction}
                                onOpenAutoFocus={(event) =>
                                  event.preventDefault()
                                }
                              >
                                <CollectionViewMenu
                                  viewName={item.name}
                                  description={item.description}
                                  icon={item.icon}
                                  tabDisplay={item.tabDisplay}
                                  viewType={item.viewType}
                                  canDelete={viewTabs.length > 1}
                                  onRename={(name) =>
                                    updateViewTitleById(item.id, name)
                                  }
                                  onChangeDescription={(description) =>
                                    updateViewDescriptionById(
                                      item.id,
                                      description,
                                    )
                                  }
                                  onChangeIcon={(icon) =>
                                    updateViewIconById(item.id, icon)
                                  }
                                  onChangeTabDisplay={(display) =>
                                    updateViewTabDisplayById(item.id, display)
                                  }
                                  onChangeLayout={(nextView) =>
                                    updateViewTypeById(item.id, nextView)
                                  }
                                  onEdit={() => openSettingsForView(item.id)}
                                  onDuplicate={() => {
                                    setMoreViewsOpen(false);
                                    void duplicateView(item.id);
                                  }}
                                  onDelete={() => {
                                    setMoreViewsOpen(false);
                                    void deleteView(item.id);
                                  }}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="kb-collection-view-overflow-new"
                      onPointerDown={stopBlockInteraction}
                      onMouseDown={stopBlockInteraction}
                      onClick={(event) => {
                        stopBlockMenuAction(event);
                        setMoreViewsOpen(false);
                        openSettingsPanel("views");
                      }}
                    >
                      <Plus className="size-4" />
                      <span>Новый вид</span>
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {editable && hiddenViewTabs.length === 0 && viewTabs.length > 0 && (
              <Popover
                open={createViewMenuOpen}
                onOpenChange={setCreateViewMenuOpen}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="kb-collection-view-add-inline"
                        aria-label="Добавить вид"
                        onPointerDown={stopBlockInteraction}
                        onMouseDown={stopBlockInteraction}
                        onClick={stopBlockInteraction}
                      >
                        <Plus className="size-4" />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs">
                    <strong className="font-semibold leading-tight">
                      Добавить вид
                    </strong>
                  </TooltipContent>
                </Tooltip>
                <PopoverContent
                  align="start"
                  sideOffset={8}
                  className="kb-collection-create-view-menu"
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={stopBlockInteraction}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <CollectionCreateViewPanel
                    onCreate={(nextView) => {
                      setCreateViewMenuOpen(false);
                      void createView(nextView);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            <div
              ref={viewTabsMeasureRef}
              className="kb-collection-view-tabs-measure"
              aria-hidden
            >
              {viewTabs.map((item) => renderViewTab(item, true))}
              <span
                className="kb-collection-view-tab kb-collection-view-more"
                data-kb-view-more-measure
              >
                99 еще...
              </span>
              <span
                className="kb-collection-view-add-inline"
                data-kb-view-add-measure
              >
                <Plus className="size-4" />
              </span>
            </div>
          </div>
          {editable && (
          <div
            className="kb-collection-actions"
            data-collapsed={toolbarCollapsed || undefined}
          >
            <IconTooltip label={toolbarCollapsed ? "Раскрыть" : "Скрыть"}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="kb-collection-icon-btn kb-collection-toolbar-toggle"
                aria-label={toolbarCollapsed ? "Раскрыть панель" : "Скрыть панель"}
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={(event) => {
                  stopBlockMenuAction(event);
                  setToolbarCollapsed((current) => !current);
                }}
              >
                {toolbarCollapsed ? (
                  <ChevronsLeft className="size-4" />
                ) : (
                  <ChevronsRight className="size-4" />
                )}
              </Button>
            </IconTooltip>
            {!toolbarCollapsed && (
              <>
            <div
              className="kb-collection-search"
              data-open={searchOpen || undefined}
            >
              <Input
                value={searchQuery}
                className="kb-collection-search-input"
                placeholder="Поиск"
                aria-label="Поиск по коллекции"
                tabIndex={searchOpen ? 0 : -1}
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={stopBlockInteraction}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSearchQuery("");
                    setSearchOpen(false);
                  }
                }}
              />
              {(searchOpen || searchQuery.trim()) && (
                <button
                  type="button"
                  className="kb-collection-search-clear"
                  aria-label="Очистить поиск"
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    setSearchQuery("");
                    setSearchOpen(false);
                  }}
                >
                  <X className="size-4" />
                </button>
              )}
              <IconTooltip label="Поиск">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="kb-collection-icon-btn"
                  data-active={searchOpen || searchQuery.trim() ? true : undefined}
                  aria-label="Поиск"
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    setSearchOpen((current) => !current);
                  }}
                >
                  <Search className="size-4" />
                </Button>
              </IconTooltip>
            </div>
            <IconTooltip label="Фильтры">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="kb-collection-icon-btn"
                data-active={activeFilters.length > 0 || undefined}
                aria-label="Фильтры"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={(event) => {
                  stopBlockMenuAction(event);
                  openSettingsPanel("filters");
                }}
              >
                <ListFilter className="size-4" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Сортировки">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="kb-collection-icon-btn"
                data-active={activeSorts.length > 0 || undefined}
                aria-label="Сортировки"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={(event) => {
                  stopBlockMenuAction(event);
                  openSettingsPanel("sorts");
                }}
              >
                <ArrowUpDown className="size-4" />
              </Button>
            </IconTooltip>
            <Popover
              open={settingsOpen}
              onOpenChange={handleSettingsOpenChange}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="kb-collection-icon-btn"
                      aria-label="Настройки вида"
                      onPointerDown={stopBlockInteraction}
                      onMouseDown={stopBlockInteraction}
                      onClick={stopBlockInteraction}
                    >
                      <Settings2 className="size-4" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs">
                  <strong className="font-semibold leading-tight">
                    Настройки вида
                  </strong>
                </TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="kb-collection-settings"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={stopBlockInteraction}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <CollectionSettings
                  viewTitle={viewTitle}
                  viewDescription={activeView?.description ?? ""}
                  viewIcon={activeView?.icon ?? (view === "table" ? "database" : "list-checks")}
                  viewTabDisplay={activeView?.tabDisplay ?? "text-icon"}
                  layoutSettings={activeLayoutSettings}
                  fields={orderedFields}
                  view={view}
                  views={collectionState?.views ?? []}
                  activeViewId={collectionState?.activeViewId ?? null}
                  visibleFieldIds={visibleFieldIds}
                  filters={activeFilters}
                  sorts={activeSorts}
                  grouping={activeGrouping}
                  initialPanel={settingsPanel}
                  onRenameView={updateViewTitle}
                  onUpdateViewDescription={updateActiveViewDescription}
                  onUpdateViewIcon={updateActiveViewIcon}
                  onUpdateViewTabDisplay={updateActiveViewTabDisplay}
                  onUpdateViewLayoutSettings={updateActiveViewLayoutSettings}
                  onChangeViewType={updateViewType}
                  onSwitchView={switchView}
                  onCreateView={createView}
                  onDuplicateView={duplicateView}
                  onDeleteView={deleteView}
                  onReorderField={reorderField}
                  onSetFieldVisible={setFieldVisible}
                  onUpdateFilters={updateFilters}
                  onUpdateSorts={updateSorts}
                  onUpdateGrouping={updateGrouping}
                />
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              size="sm"
              className="kb-collection-add-btn"
              disabled={!canCreate || creating}
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                void createRecord();
              }}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Добавить
            </Button>
              </>
            )}
            {toolbarCollapsed && (
            <Popover
              open={settingsOpen}
              onOpenChange={handleSettingsOpenChange}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="kb-collection-icon-btn"
                      aria-label="Настройки вида"
                      onPointerDown={stopBlockInteraction}
                      onMouseDown={stopBlockInteraction}
                      onClick={stopBlockInteraction}
                    >
                      <Settings2 className="size-4" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs">
                  <strong className="font-semibold leading-tight">
                    Настройки вида
                  </strong>
                </TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="kb-collection-settings"
                onPointerDown={stopBlockInteraction}
                onMouseDown={stopBlockInteraction}
                onClick={stopBlockInteraction}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <CollectionSettings
                  viewTitle={viewTitle}
                  viewDescription={activeView?.description ?? ""}
                  viewIcon={activeView?.icon ?? (view === "table" ? "database" : "list-checks")}
                  viewTabDisplay={activeView?.tabDisplay ?? "text-icon"}
                  layoutSettings={activeLayoutSettings}
                  fields={orderedFields}
                  view={view}
                  views={collectionState?.views ?? []}
                  activeViewId={collectionState?.activeViewId ?? null}
                  visibleFieldIds={visibleFieldIds}
                  filters={activeFilters}
                  sorts={activeSorts}
                  grouping={activeGrouping}
                  initialPanel={settingsPanel}
                  onRenameView={updateViewTitle}
                  onUpdateViewDescription={updateActiveViewDescription}
                  onUpdateViewIcon={updateActiveViewIcon}
                  onUpdateViewTabDisplay={updateActiveViewTabDisplay}
                  onUpdateViewLayoutSettings={updateActiveViewLayoutSettings}
                  onChangeViewType={updateViewType}
                  onSwitchView={switchView}
                  onCreateView={createView}
                  onDuplicateView={duplicateView}
                  onDeleteView={deleteView}
                  onReorderField={reorderField}
                  onSetFieldVisible={setFieldVisible}
                  onUpdateFilters={updateFilters}
                  onUpdateSorts={updateSorts}
                  onUpdateGrouping={updateGrouping}
                />
              </PopoverContent>
            </Popover>
            )}
          </div>
          )}
        </div>
      </div>

      {loading || collectionLoading ? (
        <div className="kb-collection-state">
          <Loader2 className="size-4 animate-spin" />
          Загружаем записи
        </div>
      ) : items.length === 0 && view !== "table" ? (
        <button
          type="button"
          className="kb-collection-empty"
          disabled={!canCreate}
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            void createRecord();
          }}
        >
          <FileText className="size-5" />
          <span className="font-medium">Нет записей</span>
          {canCreate && <span>Создать первую запись</span>}
        </button>
      ) : items.length > 0 && sortedItems.length === 0 ? (
        <div className="kb-collection-state">
          <EyeOff className="size-4" />
          {normalizedSearchQuery
            ? "Нет записей по поиску"
            : "Нет записей по фильтрам"}
        </div>
      ) : (
        <>
          {view === "table" ? (
            groupedItems.length > 0 ? (
              <div className="kb-collection-grouped-stack">
                {groupedItems.map((group) => (
                  <section key={group.key} className="kb-collection-group">
                    <CollectionGroupHeader
                      label={group.label}
                      count={group.items.length}
                    />
                    <CollectionTableView
                      items={group.items}
                      fields={visibleFields}
                      collectionId={collectionId}
                      collectionTitle={collectionTitle}
                      canEdit={editable}
                      columnWidths={activeColumnWidths}
                      layoutSettings={activeLayoutSettings}
                      autoEditTitleItemId={pendingTitleEditItemId}
                      visibleFieldIds={visibleFieldIds}
                      onChangeValue={updateItemPropertyValue}
                      onUpdateField={updateField}
                      onRemoveField={removeField}
                      onDuplicateField={duplicateField}
                      onReorderField={reorderField}
                      onInsertField={insertField}
                      onSetFieldVisible={setFieldVisible}
                      onSortField={sortField}
                      onResizeColumns={updateColumnWidths}
                      onConsumeAutoEditTitle={() =>
                        setPendingTitleEditItemId(null)
                      }
                      onAddField={addField}
                      onCreateRecord={createRecord}
                      onRenameItemTitle={updateItemTitle}
                      creating={creating}
                    />
                  </section>
                ))}
              </div>
            ) : (
              <CollectionTableView
                items={sortedItems}
                fields={visibleFields}
                collectionId={collectionId}
                collectionTitle={collectionTitle}
                canEdit={editable}
                columnWidths={activeColumnWidths}
                layoutSettings={activeLayoutSettings}
                autoEditTitleItemId={pendingTitleEditItemId}
                visibleFieldIds={visibleFieldIds}
                onChangeValue={updateItemPropertyValue}
                onUpdateField={updateField}
                onRemoveField={removeField}
                onDuplicateField={duplicateField}
                onReorderField={reorderField}
                onInsertField={insertField}
                onSetFieldVisible={setFieldVisible}
                onSortField={sortField}
                onResizeColumns={updateColumnWidths}
                onConsumeAutoEditTitle={() => setPendingTitleEditItemId(null)}
                onAddField={addField}
                onCreateRecord={createRecord}
                onRenameItemTitle={updateItemTitle}
                creating={creating}
              />
            )
          ) : (
            <CollectionListView
              items={sortedItems}
              groups={groupedItems}
              fields={visibleFields}
              collectionId={collectionId}
              collectionTitle={collectionTitle}
              canEdit={editable}
              layoutSettings={activeLayoutSettings}
              onChangeValue={updateItemPropertyValue}
            />
          )}
        </>
      )}
    </div>
  );
}

function CollectionLayoutOptions({
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

function CollectionViewsEditor({
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

function CollectionCreateViewPanel({
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

function CollectionViewIconPicker({
  value,
  onChange,
}: {
  value: KbCollectionViewIcon;
  onChange: (icon: KbCollectionViewIcon) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kb-collection-view-icon-picker"
          aria-label="Изменить иконку вида"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          <KbPageIcon icon={value} color={null} size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[380px] p-0 rounded-[10px]"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <KbIconPickerBody
          value={value}
          color={null}
          onChange={(next) => onChange(next.icon ?? "database")}
          onCommitClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function CollectionFieldIconPicker({
  field,
  onChange,
}: {
  field: KbCollectionField;
  onChange: (patch: Partial<KbCollectionField>) => void;
}) {
  const [open, setOpen] = useState(false);
  const FallbackIcon = FIELD_ICONS[field.type];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kb-collection-view-icon-picker"
          aria-label="Изменить иконку свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          {field.icon ? (
            <KbPageIcon
              icon={field.icon}
              color={field.iconColor ?? null}
              size={18}
            />
          ) : (
            <FallbackIcon className="size-4 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[380px] p-0 rounded-[10px]"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <KbIconPickerBody
          value={field.icon ?? null}
          color={field.iconColor ?? null}
          onChange={(next) =>
            onChange({
              icon: next.icon ?? undefined,
              iconColor: next.color ?? undefined,
            })
          }
          onCommitClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function CollectionViewMenu({
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
            autoFocus
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

function CollectionListView({
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

function CollectionGroupHeader({
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

function hasCollectionPropertyDisplayValue(property: KbProperty): boolean {
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

function CollectionAddFieldMenu({
  onAdd,
}: {
  onAdd: (type: KbPropertyType) => void;
}) {
  return (
    <div className="kb-collection-column-menu-panel">
      <div className="kb-collection-column-insert-subtitle">
        Добавить свойство
      </div>
      <div className="kb-collection-column-type-list">
        {KB_COLLECTION_CREATABLE_FIELD_TYPES.map((type) => {
          const Icon = FIELD_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              className="kb-collection-column-type-option"
              onClick={(event) => {
                stopBlockMenuAction(event);
                onAdd(type);
              }}
            >
              <Icon className="size-4" />
              <span>{KB_COLLECTION_FIELD_LABELS[type]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

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

function CollectionTableView({
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

function CollectionTitleColumnMenu({
  name,
  pinned,
  wrap,
  onRename,
  onPinnedChange,
  onWrapChange,
  onInsertRight,
}: {
  name: string;
  pinned: boolean;
  wrap: boolean;
  onRename: (name: string) => void;
  onPinnedChange: (pinned: boolean) => void;
  onWrapChange: (wrap: boolean) => void;
  onInsertRight: (type: KbPropertyType, name: string) => void;
}) {
  const [panel, setPanel] = useState<"root" | "after">("root");
  const [nameDraft, setNameDraft] = useState(name);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<KbPropertyType>("text");

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  const commitName = () => {
    const nextName = nameDraft.trim() || "Страница";
    setNameDraft(nextName);
    onRename(nextName);
  };

  if (panel === "after") {
    return (
      <CollectionColumnInsertPanel
        placement="after"
        name={newFieldName}
        type={newFieldType}
        onBack={() => setPanel("root")}
        onNameChange={setNewFieldName}
        onTypeChange={setNewFieldType}
        onCreate={() => onInsertRight(newFieldType, newFieldName)}
      />
    );
  }

  return (
    <div className="kb-collection-column-menu-panel">
      <div className="kb-collection-column-menu-name">
        <Type className="size-4" />
        <Input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitName();
              event.currentTarget.blur();
            }
          }}
          className="h-9 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          aria-label="Название колонки страницы"
        />
      </div>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onPinnedChange(!pinned);
        }}
      >
        <Pin className="size-4" />
        <span>{pinned ? "Открепить" : "Закрепить"}</span>
        {pinned && <Check className="size-4" />}
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onWrapChange(!wrap);
        }}
      >
        <WrapText className="size-4" />
        <span>Сворачивать текст</span>
        {wrap && <Check className="size-4" />}
      </button>
      <div className="kb-collection-column-menu-separator" />
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("after");
        }}
      >
        <ArrowRight className="size-4" />
        <span>Вставить справа</span>
        <span />
      </button>
    </div>
  );
}

function CollectionColumnMenu({
  field,
  visible,
  onUpdate,
  onRemove,
  onDuplicate,
  onSort,
  onInsert,
  onVisibleChange,
}: {
  field: KbCollectionField;
  visible: boolean;
  onUpdate: (patch: Partial<KbCollectionField>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSort: (direction: KbCollectionSortDirection) => void;
  onInsert: (
    type: KbPropertyType,
    name: string,
    placement: FieldDropPlacement,
  ) => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const [panel, setPanel] = useState<
    "root" | FieldDropPlacement | "sort" | "icon"
  >("root");
  const [name, setName] = useState(field.name);
  const [descriptionDraft, setDescriptionDraft] = useState(
    field.description ?? "",
  );
  const [descriptionOpen, setDescriptionOpen] = useState(
    Boolean(field.description),
  );
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<KbPropertyType>("text");

  useEffect(() => {
    setName(field.name);
  }, [field.id, field.name]);
  useEffect(() => {
    setDescriptionDraft(field.description ?? "");
  }, [field.id, field.description]);
  useEffect(() => {
    setDescriptionOpen(Boolean(field.description));
  }, [field.id]);

  const commitName = () => {
    const nextName = name.trim();
    setName(nextName);
    if (nextName !== field.name) onUpdate({ name: nextName });
  };
  const commitDescription = (value = descriptionDraft) => {
    const nextDescription = value.trim().slice(0, 280);
    setDescriptionDraft(nextDescription);
    onUpdate({ description: nextDescription || undefined });
  };

  if (panel !== "root") {
    if (panel === "icon") {
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
              Иконка свойства
            </div>
          </div>
          <div className="kb-collection-inline-icon-picker">
            <KbIconPickerBody
              value={field.icon ?? null}
              color={field.iconColor ?? null}
              onChange={(next) =>
                onUpdate({
                  icon: next.icon ?? undefined,
                  iconColor: next.color ?? undefined,
                })
              }
              onCommitClose={() => setPanel("root")}
            />
          </div>
        </div>
      );
    }

    if (panel === "sort") {
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
              Сортировать
            </div>
          </div>
          <button
            type="button"
            className="kb-collection-column-menu-row"
            onClick={(event) => {
              stopBlockMenuAction(event);
              onSort("asc");
            }}
          >
            <ArrowDownAZ className="size-4" />
            <span>По возрастанию</span>
            <span />
          </button>
          <button
            type="button"
            className="kb-collection-column-menu-row"
            onClick={(event) => {
              stopBlockMenuAction(event);
              onSort("desc");
            }}
          >
            <ArrowDownAZ className="size-4 rotate-180" />
            <span>По убыванию</span>
            <span />
          </button>
        </div>
      );
    }

    return (
      <CollectionColumnInsertPanel
        placement={panel}
        name={newFieldName}
        type={newFieldType}
        onBack={() => setPanel("root")}
        onNameChange={setNewFieldName}
        onTypeChange={setNewFieldType}
        onCreate={() => onInsert(newFieldType, newFieldName, panel)}
      />
    );
  }

  return (
    <div className="kb-collection-column-menu-panel">
      <div className="kb-collection-column-menu-name">
        <button
          type="button"
          className="kb-collection-view-icon-picker"
          aria-label="Изменить иконку свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("icon");
          }}
        >
          {field.icon ? (
            <KbPageIcon
              icon={field.icon}
              color={field.iconColor ?? null}
              size={18}
            />
          ) : (
            (() => {
              const Icon = FIELD_ICONS[field.type];
              return <Icon className="size-4 text-muted-foreground" />;
            })()
          )}
        </button>
        <Input
          value={name}
          placeholder="Свойство"
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className="h-9 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          aria-label="Название свойства"
        />
        <button
          type="button"
          className={cn(
            "kb-collection-view-description-trigger",
            field.description && "text-foreground",
          )}
          aria-label="Описание свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setDescriptionOpen((current) => !current);
          }}
        >
          <KB_PROPERTY_UI_ICONS.description className="size-4" />
        </button>
      </div>
      {descriptionOpen && (
        <Input
          value={descriptionDraft}
          placeholder="Добавить описание..."
          className="kb-collection-column-description-input"
          aria-label="Описание свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
          onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
          onBlur={(event) => commitDescription(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDescription(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDescriptionDraft(field.description ?? "");
              event.currentTarget.blur();
            }
          }}
        />
      )}
      <label className="kb-collection-column-menu-row">
        <KB_PROPERTY_UI_ICONS.type className="size-4" />
        <span>Тип</span>
        <select
          className="kb-collection-column-menu-select"
          value={field.type}
          aria-label="Тип свойства"
          onChange={(event) =>
            onUpdate({ type: event.currentTarget.value as KbPropertyType })
          }
        >
          {collectionFieldTypeOptions(field.type).map((type) => (
            <option key={type} value={type}>
              {KB_COLLECTION_FIELD_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      {field.type === "number" && (
        <>
          <label className="kb-collection-column-menu-row">
            <KB_PROPERTY_UI_ICONS.display className="size-4" />
            <span>Вид</span>
            <select
              className="kb-collection-column-menu-select"
              value={field.displayVariant === "rating" ? "rating" : "number"}
              aria-label="Вид числа"
              onChange={(event) =>
                onUpdate({
                  displayVariant:
                    event.currentTarget.value === "rating"
                      ? "rating"
                      : undefined,
                  ratingVariant:
                    event.currentTarget.value === "rating"
                      ? field.ratingVariant ?? "stars"
                      : undefined,
                  ratingShowValue:
                    event.currentTarget.value === "rating"
                      ? field.ratingShowValue ?? true
                      : undefined,
                  max:
                    event.currentTarget.value === "rating"
                      ? field.max ?? 5
                      : undefined,
                })
              }
            >
              <option value="number">Число</option>
              <option value="rating">Рейтинг</option>
            </select>
          </label>
          {field.displayVariant === "rating" && (
            <>
              <label className="kb-collection-column-menu-row">
                <KB_PROPERTY_UI_ICONS.scale className="size-4" />
                <span>Максимум</span>
                <select
                  className="kb-collection-column-menu-select"
                  value={field.max ?? 5}
                  aria-label="Максимум рейтинга"
                  onChange={(event) =>
                    onUpdate({
                      max: Number(event.currentTarget.value) as 3 | 5 | 10,
                    })
                  }
                >
                  {[3, 5, 10].map((max) => (
                    <option key={max} value={max}>
                      {max}
                    </option>
                  ))}
                </select>
              </label>
              <label className="kb-collection-column-menu-row">
                <KB_PROPERTY_UI_ICONS.rating className="size-4" />
                <span>Рейтинг</span>
                <select
                  className="kb-collection-column-menu-select"
                  value={field.ratingVariant ?? "stars"}
                  aria-label="Вид рейтинга"
                  onChange={(event) =>
                    onUpdate({
                      ratingVariant: event.currentTarget.value as "stars" | "slider",
                    })
                  }
                >
                  <option value="stars">Звёзды</option>
                  <option value="slider">Слайдер</option>
                </select>
              </label>
              {field.ratingVariant === "slider" && (
                <button
                  type="button"
                  className="kb-collection-column-menu-row"
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    onUpdate({
                      ratingShowValue: field.ratingShowValue === false,
                    });
                  }}
                >
                  <KB_PROPERTY_UI_ICONS.showValue className="size-4" />
                  <span>Показывать число</span>
                  {(field.ratingShowValue ?? true) && (
                    <Check className="size-4" />
                  )}
                </button>
              )}
            </>
          )}
        </>
      )}
      {field.type === "checkbox" && (
        <label className="kb-collection-column-menu-row">
          <KB_PROPERTY_UI_ICONS.display className="size-4" />
          <span>Вид</span>
          <select
            className="kb-collection-column-menu-select"
            value={field.displayVariant === "switch" ? "switch" : "checkbox"}
            aria-label="Вид чекбокса"
            onChange={(event) =>
              onUpdate({
                displayVariant:
                  event.currentTarget.value === "switch"
                    ? "switch"
                    : undefined,
              })
            }
          >
            <option value="checkbox">Чекбокс</option>
            <option value="switch">Триггер</option>
          </select>
        </label>
      )}
      {field.type === "text" && (
        <button
          type="button"
          className="kb-collection-column-menu-row"
          onClick={(event) => {
            stopBlockMenuAction(event);
            onUpdate({ collapsed: !field.collapsed });
          }}
        >
          <WrapText className="size-4" />
          <span>Сворачивать текст</span>
          {field.collapsed && <Check className="size-4" />}
        </button>
      )}
      {field.type === "url" && (
        <button
          type="button"
          className="kb-collection-column-menu-row"
          onClick={(event) => {
            stopBlockMenuAction(event);
            onUpdate({ urlCollapsed: !field.urlCollapsed });
          }}
        >
          <WrapText className="size-4" />
          <span>Сокращать ссылку</span>
          {field.urlCollapsed && <Check className="size-4" />}
        </button>
      )}
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onVisibleChange(!visible);
        }}
      >
        {visible ? (
          <KB_PROPERTY_UI_ICONS.hidden className="size-4" />
        ) : (
          <KB_PROPERTY_UI_ICONS.visibility className="size-4" />
        )}
        <span>{visible ? "Скрыть" : "Показать"}</span>
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
        <KB_PROPERTY_UI_ICONS.duplicate className="size-4" />
        <span>Дублировать</span>
        <span />
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("sort");
        }}
      >
        <KB_PROPERTY_UI_ICONS.sort className="size-4" />
        <span>Сортировать</span>
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("before");
        }}
      >
        <ArrowLeft className="size-4" />
        <span>Вставить слева</span>
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("after");
        }}
      >
        <ArrowRight className="size-4" />
        <span>Вставить справа</span>
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row text-destructive"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onRemove();
        }}
      >
        <KB_PROPERTY_UI_ICONS.delete className="size-4" />
        <span>Удалить свойство</span>
      </button>
    </div>
  );
}

function CollectionColumnInsertPanel({
  placement,
  name,
  type,
  onBack,
  onNameChange,
  onTypeChange,
  onCreate,
}: {
  placement: FieldDropPlacement;
  name: string;
  type: KbPropertyType;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onTypeChange: (type: KbPropertyType) => void;
  onCreate: () => void;
}) {
  const ActiveIcon = FIELD_ICONS[type];

  return (
    <div className="kb-collection-column-insert-panel">
      <div className="kb-collection-column-insert-head">
        <button
          type="button"
          className="kb-collection-settings-back"
          aria-label="Назад"
          onClick={(event) => {
            stopBlockMenuAction(event);
            onBack();
          }}
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="kb-collection-settings-panel-title">
          {placement === "before" ? "Колонка слева" : "Колонка справа"}
        </div>
      </div>
      <div className="kb-collection-column-menu-name">
        <ActiveIcon className="size-4" />
        <Input
          value={name}
          autoFocus
          onChange={(event) => onNameChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCreate();
            }
          }}
          className="h-9 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          placeholder="Название свойства"
          aria-label="Название нового свойства"
        />
      </div>
      <div className="kb-collection-column-insert-subtitle">
        Выберите тип
      </div>
      <div className="kb-collection-column-type-grid">
        {KB_COLLECTION_CREATABLE_FIELD_TYPES.map((fieldType) => {
          const Icon = FIELD_ICONS[fieldType];
          const active = type === fieldType;
          return (
            <button
              key={fieldType}
              type="button"
              className="kb-collection-column-type-option"
              data-active={active || undefined}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onTypeChange(fieldType);
              }}
            >
              <Icon className="size-4" />
              <span>{KB_COLLECTION_FIELD_LABELS[fieldType]}</span>
              {active && <Check className="ml-auto size-4" />}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        size="sm"
        className="kb-collection-column-create-btn"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onCreate();
        }}
      >
        Создать свойство
      </Button>
    </div>
  );
}

function CollectionSettings({
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

function collectionFieldMenuLabel(field: KbCollectionField): string {
  return field.name.trim() || KB_COLLECTION_FIELD_LABELS[field.type];
}

function CollectionFieldVisibilityEditor({
  fields,
  visibleFieldIds,
  onReorder,
  onVisibleChange,
}: {
  fields: KbCollectionField[];
  visibleFieldIds: KbCollectionVisibleFieldIds;
  onReorder: (
    activeId: string,
    targetId: string,
    placement?: FieldDropPlacement,
  ) => void;
  onVisibleChange: (id: string, visible: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFields = fields.filter((field) =>
    isCollectionFieldVisible(field.id, visibleFieldIds),
  );
  const hiddenFields = fields.filter(
    (field) => !isCollectionFieldVisible(field.id, visibleFieldIds),
  );
  const matchesQuery = (field: KbCollectionField) => {
    if (!normalizedQuery) return true;
    return collectionFieldMenuLabel(field).toLowerCase().includes(normalizedQuery);
  };

  const renderRow = (field: KbCollectionField, visible: boolean) => {
    const Icon = FIELD_ICONS[field.type];
    return (
      <div
        key={field.id}
        className="kb-collection-property-visibility-row"
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", field.id);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const activeId = event.dataTransfer.getData("text/plain");
          if (activeId && activeId !== field.id) onReorder(activeId, field.id, "before");
        }}
      >
        <GripVertical className="kb-collection-property-visibility-drag size-4" />
        {field.icon ? (
          <KbPageIcon
            icon={field.icon}
            color={field.iconColor ?? null}
            className="size-4 text-muted-foreground"
          />
        ) : (
          <Icon className="size-4 text-muted-foreground" />
        )}
        <span className="kb-collection-property-visibility-name">
          {collectionFieldMenuLabel(field)}
        </span>
        <button
          type="button"
          className="kb-collection-property-visibility-toggle"
          aria-label={visible ? "Скрыть свойство" : "Показать свойство"}
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            onVisibleChange(field.id, !visible);
          }}
        >
          {visible ? (
            <KB_PROPERTY_UI_ICONS.visibility className="size-4" />
          ) : (
            <KB_PROPERTY_UI_ICONS.hidden className="size-4" />
          )}
        </button>
      </div>
    );
  };

  const shownRows = visibleFields.filter(matchesQuery);
  const hiddenRows = hiddenFields.filter(matchesQuery);

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства в таблице, чтобы управлять их отображением в виде.
      </div>
    );
  }

  return (
    <div className="kb-collection-property-visibility-editor">
      <Input
        value={query}
        placeholder="Найти свойство..."
        className="kb-collection-property-visibility-search"
        aria-label="Найти свойство"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="kb-collection-property-visibility-section">
        <div className="kb-collection-property-visibility-heading">
          <span>Показаны</span>
          {visibleFields.length > 0 && (
            <button
              type="button"
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                visibleFields.forEach((field) => onVisibleChange(field.id, false));
              }}
            >
              Скрыть все
            </button>
          )}
        </div>
        {shownRows.length === 0 ? (
          <div className="kb-collection-property-visibility-empty">
            Нет показанных свойств
          </div>
        ) : (
          shownRows.map((field) => renderRow(field, true))
        )}
      </div>
      <div className="kb-collection-property-visibility-section">
        <div className="kb-collection-property-visibility-heading">
          <span>Скрыты</span>
          {hiddenFields.length > 0 && (
            <button
              type="button"
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                hiddenFields.forEach((field) => onVisibleChange(field.id, true));
              }}
            >
              Показать все
            </button>
          )}
        </div>
        {hiddenRows.length === 0 ? (
          <div className="kb-collection-property-visibility-empty">
            Нет скрытых свойств
          </div>
        ) : (
          hiddenRows.map((field) => renderRow(field, false))
        )}
      </div>
    </div>
  );
}

function CollectionFieldSelect({
  fields,
  value,
  placeholder,
  emptyLabel,
  searchPlaceholder,
  onChange,
}: {
  fields: KbCollectionField[];
  value: string;
  placeholder: string;
  emptyLabel?: string;
  searchPlaceholder: string;
  onChange: (fieldId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedField = fields.find((field) => field.id === value);
  const selectedLabel = selectedField
    ? collectionFieldMenuLabel(selectedField)
    : emptyLabel ?? placeholder;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFields = fields.filter((field) =>
    collectionFieldMenuLabel(field).toLowerCase().includes(normalizedQuery),
  );

  const renderIcon = (field: KbCollectionField) => {
    const Icon = FIELD_ICONS[field.type];
    return field.icon ? (
      <KbPageIcon icon={field.icon} color={field.iconColor ?? null} size={16} />
    ) : (
      <Icon className="size-4 text-muted-foreground" />
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kb-collection-field-select-trigger"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          {selectedField ? (
            renderIcon(selectedField)
          ) : (
            <span className="kb-collection-field-select-empty-icon" />
          )}
          <span>{selectedLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="kb-collection-field-select-menu"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Input
          value={query}
          placeholder={searchPlaceholder}
          className="kb-collection-field-select-search"
          aria-label={searchPlaceholder}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="kb-collection-field-select-list">
          {emptyLabel && (
            <button
              type="button"
              className="kb-collection-field-select-option"
              data-active={!value || undefined}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onChange("");
                setOpen(false);
              }}
            >
              <span className="kb-collection-field-select-empty-icon" />
              <span>{emptyLabel}</span>
              {!value && <Check className="size-4" />}
            </button>
          )}
          {filteredFields.length === 0 ? (
            <div className="kb-collection-field-select-empty">
              Свойства не найдены
            </div>
          ) : (
            filteredFields.map((field) => {
              const active = field.id === value;
              return (
                <button
                  key={field.id}
                  type="button"
                  className="kb-collection-field-select-option"
                  data-active={active || undefined}
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    onChange(field.id);
                    setOpen(false);
                  }}
                >
                  {renderIcon(field)}
                  <span>{collectionFieldMenuLabel(field)}</span>
                  {active && <Check className="size-4" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CollectionFiltersEditor({
  fields,
  filters,
  onChange,
}: {
  fields: KbCollectionField[];
  filters: KbCollectionFilter[];
  onChange: (filters: KbCollectionFilter[]) => void;
}) {
  const validFilters = filters.filter((filter) =>
    fields.some((field) => field.id === filter.fieldId),
  );

  const updateFilter = (id: string, patch: Partial<KbCollectionFilter>) => {
    onChange(
      validFilters.map((filter) => {
        if (filter.id !== id) return filter;
        const next = { ...filter, ...patch };
        const field = fields.find((item) => item.id === next.fieldId);
        if (field && !filterOperatorNeedsValue(field, next.operator)) {
          delete next.value;
        }
        return next;
      }),
    );
  };

  const addFilter = (fieldId: string) => {
    if (!fieldId) return;
    const field = fields.find((item) => item.id === fieldId);
    if (!field) return;
    onChange([...validFilters, createCollectionFilter(field.id, defaultFilterOperator(field))]);
  };

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства, чтобы фильтровать записи.
      </div>
    );
  }

  return (
    <div className="kb-collection-filters-editor">
      {validFilters.length === 0 ? (
        <div className="kb-collection-settings-empty">
          Фильтры не заданы. Вид показывает все записи коллекции.
        </div>
      ) : (
        validFilters.map((filter) => {
          const field = fields.find((item) => item.id === filter.fieldId);
          if (!field) return null;
          const operators = filterOperatorsForField(field);
          const operator = normalizeFilterOperatorForField(field, filter.operator);
          const needsValue = filterOperatorNeedsValue(field, operator);

          return (
            <div key={filter.id} className="kb-collection-filter-row">
              <CollectionFieldSelect
                fields={fields}
                value={field.id}
                placeholder="Выбрать свойство"
                searchPlaceholder="Найти свойство..."
                onChange={(fieldId) => {
                  const nextField = fields.find((item) => item.id === fieldId);
                  if (!nextField) return;
                  updateFilter(filter.id, {
                    fieldId: nextField.id,
                    operator: defaultFilterOperator(nextField),
                    value: undefined,
                  });
                }}
              />
              <select
                className="kb-collection-filter-select"
                value={operator}
                aria-label="Оператор фильтра"
                onChange={(event) =>
                  updateFilter(filter.id, {
                    operator: event.currentTarget.value as KbCollectionFilterOperator,
                  })
                }
              >
                {operators.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              {needsValue ? (
                <Input
                  value={filter.value == null ? "" : String(filter.value)}
                  className="kb-collection-filter-input"
                  aria-label="Значение фильтра"
                  onChange={(event) =>
                    updateFilter(filter.id, {
                      value: normalizeFilterInputValue(
                        field,
                        event.currentTarget.value,
                      ),
                    })
                  }
                />
              ) : (
                <span className="kb-collection-filter-placeholder" />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onChange(validFilters.filter((item) => item.id !== filter.id))
                }
                aria-label="Удалить фильтр"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })
      )}
      <CollectionFieldSelect
        fields={fields}
        value=""
        placeholder="Добавить фильтр"
        searchPlaceholder="Найти свойство..."
        onChange={addFilter}
      />
    </div>
  );
}

function CollectionSortsEditor({
  fields,
  sorts,
  onChange,
}: {
  fields: KbCollectionField[];
  sorts: KbCollectionSort[];
  onChange: (sorts: KbCollectionSort[]) => void;
}) {
  const validSorts = sorts.filter((sort) =>
    fields.some((field) => field.id === sort.fieldId),
  );

  const updateSort = (id: string, patch: Partial<KbCollectionSort>) => {
    onChange(
      validSorts.map((sort) =>
        sort.id === id ? { ...sort, ...patch } : sort,
      ),
    );
  };

  const addSort = (fieldId: string) => {
    if (!fieldId) return;
    const field = fields.find((item) => item.id === fieldId);
    if (!field) return;
    onChange([...validSorts, createCollectionSort(field.id, "asc")]);
  };

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства, чтобы сортировать записи.
      </div>
    );
  }

  return (
    <div className="kb-collection-sorts-editor">
      {validSorts.length === 0 ? (
        <div className="kb-collection-settings-empty">
          Сортировки не заданы. Вид использует порядок страниц.
        </div>
      ) : (
        validSorts.map((sort) => {
          const field = fields.find((item) => item.id === sort.fieldId);
          if (!field) return null;

          return (
            <div key={sort.id} className="kb-collection-sort-row">
              <CollectionFieldSelect
                fields={fields}
                value={field.id}
                placeholder="Выбрать свойство"
                searchPlaceholder="Найти свойство..."
                onChange={(fieldId) =>
                  updateSort(sort.id, { fieldId })
                }
              />
              <select
                className="kb-collection-sort-select"
                value={sort.direction}
                aria-label="Направление сортировки"
                onChange={(event) =>
                  updateSort(sort.id, {
                    direction: event.currentTarget
                      .value as KbCollectionSortDirection,
                  })
                }
              >
                <option value="asc">{sortDirectionLabel(field, "asc")}</option>
                <option value="desc">{sortDirectionLabel(field, "desc")}</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onChange(validSorts.filter((item) => item.id !== sort.id))
                }
                aria-label="Удалить сортировку"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })
      )}
      <CollectionFieldSelect
        fields={fields}
        value=""
        placeholder="Добавить сортировку"
        searchPlaceholder="Найти свойство..."
        onChange={addSort}
      />
    </div>
  );
}

function CollectionGroupingEditor({
  fields,
  grouping,
  onChange,
}: {
  fields: KbCollectionField[];
  grouping: KbCollectionGrouping | null;
  onChange: (grouping: KbCollectionGrouping | null) => void;
}) {
  const currentField = fields.find((field) => field.id === grouping?.fieldId);
  const direction = grouping?.direction ?? "asc";

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства, чтобы группировать записи.
      </div>
    );
  }

  return (
    <div className="kb-collection-grouping-editor">
      <div className="kb-collection-grouping-row">
        <KB_PROPERTY_UI_ICONS.grouping className="size-4 text-muted-foreground" />
        <CollectionFieldSelect
          fields={fields}
          value={currentField?.id ?? ""}
          placeholder="Выбрать свойство"
          emptyLabel="Без группировки"
          searchPlaceholder="Найти свойство..."
          onChange={(fieldId) => {
            onChange(fieldId ? createCollectionGrouping(fieldId, direction) : null);
          }}
        />
      </div>
      {currentField ? (
        <>
          <div className="kb-collection-grouping-row">
            <ArrowDownAZ className="size-4 text-muted-foreground" />
            <select
              className="kb-collection-grouping-select"
              value={direction}
              aria-label="Направление группировки"
              onChange={(event) =>
                onChange(
                  createCollectionGrouping(
                    currentField.id,
                    event.currentTarget.value as KbCollectionSortDirection,
                  ),
                )
              }
            >
              <option value="asc">
                {sortDirectionLabel(currentField, "asc")}
              </option>
              <option value="desc">
                {sortDirectionLabel(currentField, "desc")}
              </option>
            </select>
          </div>
          <button
            type="button"
            className="kb-collection-settings-nav-row text-destructive"
            onPointerDown={stopBlockInteraction}
            onMouseDown={stopBlockInteraction}
            onClick={(event) => {
              stopBlockMenuAction(event);
              onChange(null);
            }}
          >
            <Trash2 className="size-4" />
            <span>Убрать группировку</span>
            <span />
            <span />
          </button>
        </>
      ) : (
        <div className="kb-collection-settings-empty">
          Вид показывает записи без группировки.
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CollectionFieldEditor({
  field,
  visible,
  onUpdate,
  onRemove,
  onReorder,
  onVisibleChange,
}: {
  field: KbCollectionField;
  visible: boolean;
  onUpdate: (patch: Partial<KbCollectionField>) => void;
  onRemove: () => void;
  onReorder: (
    activeId: string,
    targetId: string,
    placement?: FieldDropPlacement,
  ) => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const [name, setName] = useState(field.name);
  const [descriptionDraft, setDescriptionDraft] = useState(
    field.description ?? "",
  );

  useEffect(() => {
    setName(field.name);
  }, [field.id, field.name]);
  useEffect(() => {
    setDescriptionDraft(field.description ?? "");
  }, [field.id, field.description]);

  const commitName = () => {
    const nextName = name.trim();
    setName(nextName);
    if (nextName !== field.name) onUpdate({ name: nextName });
  };

  return (
    <div
      className="kb-collection-field-editor"
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const activeId = event.dataTransfer.getData("text/plain");
        if (activeId) onReorder(activeId, field.id, "before");
      }}
    >
      <span
        className="kb-collection-field-drag size-4 text-muted-foreground/65"
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", field.id);
        }}
      >
        <GripVertical className="size-4" />
      </span>
      <CollectionFieldIconPicker field={field} onChange={onUpdate} />
      <Input
        value={name}
        placeholder="Свойство"
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        aria-label="Название свойства"
      />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "kb-collection-view-description-trigger",
              field.description && "text-foreground",
            )}
            aria-label="Описание свойства"
            onPointerDown={stopBlockInteraction}
            onMouseDown={stopBlockInteraction}
            onClick={stopBlockInteraction}
          >
            <Info className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[260px] p-2"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Input
            value={descriptionDraft}
            placeholder="Описание свойства"
            className="h-8"
            aria-label="Описание свойства"
            onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
            onBlur={() =>
              onUpdate({
                description: descriptionDraft.trim().slice(0, 280) || undefined,
              })
            }
          />
        </PopoverContent>
      </Popover>
      <select
        className="kb-collection-field-type"
        value={field.type}
        aria-label="Тип свойства"
        onChange={(event) =>
          onUpdate({ type: event.currentTarget.value as KbPropertyType })
        }
      >
        {collectionFieldTypeOptions(field.type).map((type) => (
          <option key={type} value={type}>
            {KB_COLLECTION_FIELD_LABELS[type]}
          </option>
        ))}
      </select>
      {field.type === "number" && (
        <select
          className="kb-collection-field-type"
          value={field.displayVariant === "rating" ? "rating" : "number"}
          aria-label="Вид числа"
          onChange={(event) =>
            onUpdate({
              displayVariant:
                event.currentTarget.value === "rating"
                  ? "rating"
                  : undefined,
              ratingVariant:
                event.currentTarget.value === "rating"
                  ? field.ratingVariant ?? "stars"
                  : undefined,
              ratingShowValue:
                event.currentTarget.value === "rating"
                  ? field.ratingShowValue ?? true
                  : undefined,
              max:
                event.currentTarget.value === "rating"
                  ? field.max ?? 5
                  : undefined,
            })
          }
        >
          <option value="number">Число</option>
          <option value="rating">Рейтинг</option>
        </select>
      )}
      {field.type === "number" && field.displayVariant === "rating" && (
        <>
          <select
            className="kb-collection-field-type"
            value={field.max ?? 5}
            aria-label="Максимум рейтинга"
            onChange={(event) =>
              onUpdate({
                max: Number(event.currentTarget.value) as 3 | 5 | 10,
              })
            }
          >
            {[3, 5, 10].map((max) => (
              <option key={max} value={max}>
                {max}
              </option>
            ))}
          </select>
          <select
            className="kb-collection-field-type"
            value={field.ratingVariant ?? "stars"}
            aria-label="Вид рейтинга"
            onChange={(event) =>
              onUpdate({
                ratingVariant: event.currentTarget.value as "stars" | "slider",
              })
            }
          >
            <option value="stars">Звёзды</option>
            <option value="slider">Слайдер</option>
          </select>
          {field.ratingVariant === "slider" && (
            <label className="kb-collection-field-toggle">
              <input
                type="checkbox"
                checked={field.ratingShowValue !== false}
                onChange={(event) =>
                  onUpdate({ ratingShowValue: event.currentTarget.checked })
                }
              />
              Число
            </label>
          )}
        </>
      )}
      {field.type === "checkbox" && (
        <select
          className="kb-collection-field-type"
          value={field.displayVariant === "switch" ? "switch" : "checkbox"}
          aria-label="Вид чекбокса"
          onChange={(event) =>
            onUpdate({
              displayVariant:
                event.currentTarget.value === "switch" ? "switch" : undefined,
            })
          }
        >
          <option value="checkbox">Чекбокс</option>
          <option value="switch">Триггер</option>
        </select>
      )}
      {field.type === "text" && (
        <label className="kb-collection-field-toggle">
          <input
            type="checkbox"
            checked={field.collapsed === true}
            onChange={(event) => onUpdate({ collapsed: event.currentTarget.checked })}
          />
          Свернуть
        </label>
      )}
      {field.type === "url" && (
        <label className="kb-collection-field-toggle">
          <input
            type="checkbox"
            checked={field.urlCollapsed === true}
            onChange={(event) =>
              onUpdate({ urlCollapsed: event.currentTarget.checked })
            }
          />
          Сократить
        </label>
      )}
      <Switch
        checked={visible}
        onCheckedChange={onVisibleChange}
        aria-label={visible ? "Скрыть свойство" : "Показать свойство"}
        className="scale-90"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="Удалить свойство"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function stopBlockInteraction(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function stopBlockMenuAction(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function CollectionToExternalHTML() {
  return <div>Коллекция</div>;
}

export const kbCollectionBlockSpec = createReactBlockSpec(
  collectionBlockConfig,
  () => ({
    render: KbCollectionBlock,
    toExternalHTML: CollectionToExternalHTML,
  }),
);
