"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  EyeOff,
  FileText,
  GripVertical,
  ArrowUpDown,
  ListFilter,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Plus,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Settings2,
  Table2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
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
  findPropertyForCollectionField,
  getPageCollectionId,
  inferCollectionSchemaFromProperties,
  isCollectionFieldVisible,
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
  type KbCollectionSchema,
  type KbCollectionView,
  type KbCollectionViewConfig,
  type KbCollectionViewIcon,
  type KbCollectionViewLayoutSettings,
  type KbCollectionViewTabDisplay,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
import {
  groupCollectionItems,
  type KbCollectionGrouping,
} from "@/lib/knowledge/collection-group";
import {
  createCollectionSort,
  sortCollectionItems,
  type KbCollectionSort,
  type KbCollectionSortDirection,
} from "@/lib/knowledge/collection-sort";
import { filterCollectionItems } from "@/lib/knowledge/collection-filter";
import { formatPropertyValue } from "@/lib/knowledge/collection-format";
import {
  buildLegacyCollectionBlocks,
  collectionFieldDisplayProperty,
  insertCollectionFieldId,
  orderCollectionFields,
  reorderCollectionFieldIds,
  type FieldDropPlacement,
} from "@/lib/knowledge/collection-fields";
import { saveKbPageProperties } from "@/lib/knowledge/properties";
import type { KbProperty, KbPropertyType } from "@/types/knowledge";

import { collectionBlockConfig, type CollectionRenderProps } from "./collection/block-config";
import { CollectionCreateViewPanel } from "./collection/layout-options";
import {
  CollectionGroupHeader,
  CollectionListView,
} from "./collection/list-view";
import { CollectionSettings } from "./collection/settings/settings-panel";
import { CollectionTableView } from "./collection/table-view";
import { CollectionViewMenu } from "./collection/view-menu";
import {
  KbCollectionRuntimeProvider,
  useKbCollectionRuntime,
} from "./collection/runtime-provider";
import {
  SAVE_CELL_DEBOUNCE_MS,
  getCollectionViewFallbackIcon,
  stopBlockInteraction,
  stopBlockMenuAction,
  type CollectionSettingsPanel,
} from "./collection/shared";

export { KbCollectionRuntimeProvider };

function KbCollectionBlock({ block, editor }: CollectionRenderProps) {
  const runtime = useKbCollectionRuntime();
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
  // Wrap nullish-default fallbacks in useMemo: without this, every render
  // creates a fresh `[]` reference, which forces downstream useMemos
  // (filteredItems / sortedItems / groupedItems) to recompute on every
  // render even when the underlying view didn't change.
  const activeFilters = useMemo(
    () => activeView?.filters ?? [],
    [activeView?.filters],
  );
  const activeSorts = useMemo(
    () => activeView?.sorts ?? [],
    [activeView?.sorts],
  );
  const activeGrouping = activeView?.grouping ?? null;
  const viewTabs = useMemo(
    () => collectionState?.views ?? [],
    [collectionState?.views],
  );
  // Deferred copy: the input stays bound to `searchQuery` for snappy
  // keystrokes, but the heavy `searchedItems` filter (O(items × fields))
  // reads `deferredSearchQuery`. React schedules the filter pass at a
  // lower priority and discards intermediate values on fast typing.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
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

  // Fingerprint of viewTabs names — re-measure when the set of visible
  // tab labels changes. Extracted to a memoized scalar so lint can
  // statically check the useLayoutEffect dep array (complex expressions
  // inline are blocked by react-hooks/exhaustive-deps).
  const viewTabsLabelFingerprint = useMemo(
    () => viewTabs.map((item) => item.name).join("\u0000"),
    [viewTabs],
  );

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
  }, [editable, viewTabs.length, viewTabsLabelFingerprint]);

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

  const updateSchema = useCallback(
    (nextSchema: KbCollectionSchema) => {
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
    },
    [block.id, dbCollectionId, editor, runtime.pageId],
  );

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
    updateSchema,
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
      onMouseDownCapture={(event) => {
        // DESKTOP: глушим дефолт mousedown на chrome блока, чтобы ProseMirror
        // (нативный listener, React-stopPropagation его не берёт) не ставил
        // каретку/выделение под island'ом. На iOS этого НЕдостаточно —
        // contenteditable фокусируется на `touchend`, ДО mousedown, поэтому
        // клавиатуру глушим отдельно в onClickCapture (ниже). Поля ввода и
        // ячейки исключаем — им фокус/редактирование нужны.
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(
            "input, textarea, select, [contenteditable='true'], [role='cell']",
          )
        ) {
          return;
        }
        event.preventDefault();
      }}
      onClickCapture={(event) => {
        // iOS: тап по chrome блока (тулбар/вкладки/шапки колонок) фокусирует
        // contenteditable-редактор под island'ом на `touchend` → вылезает
        // клавиатура. preventDefault на mousedown тут не успевает (фокус уже
        // случился). Поэтому на click (уже ПОСЛЕ фокуса) снимаем фокус с
        // редактора — клавиатура прячется. Не трогаем поля ввода и ячейки
        // (им фокус нужен) и блюрим ТОЛЬКО если активен сам редактор, чтобы
        // не мешать поповерам/инпутам. preventDefault не зовём — тап/клик и
        // открытие поповеров работают как обычно.
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(
            "input, textarea, select, [contenteditable='true'], [role='cell']",
          )
        ) {
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        if (
          active &&
          (active.classList.contains("ProseMirror") ||
            active.closest?.(".ProseMirror, .bn-editor"))
        ) {
          active.blur();
        }
      }}
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
