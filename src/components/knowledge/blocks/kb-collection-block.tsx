"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eye,
  EyeOff,
  FileText,
  GalleryHorizontalEnd,
  GripVertical,
  Hash,
  Link as LinkIcon,
  ListChecks,
  Loader2,
  Plus,
  PlusSquare,
  Settings2,
  Star,
  Table2,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { PropertyValueControl } from "@/app/(dashboard)/knowledge/_components/kb-page-properties";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  createKbCollectionView,
  createKbCollectionRecord,
  deleteKbCollectionView,
  duplicateKbCollectionView,
  getOrCreateKbPageCollection,
  listKbCollectionItems,
  syncKbCollectionRecords,
  updateKbCollection,
  updateKbCollectionView,
  type KbCollectionState,
  type KbCollectionItem,
} from "@/lib/knowledge/collection-actions";
import {
  KB_COLLECTION_DEFAULT_TITLE,
  createCollectionField,
  collectionFieldToProperty,
  findPropertyForCollectionField,
  getPageCollectionId,
  inferCollectionSchemaFromProperties,
  isCollectionFieldVisible,
  KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  KB_COLLECTION_EMPTY_SCHEMA,
  KB_COLLECTION_FIELD_LABELS,
  KB_COLLECTION_FIELD_TYPES,
  KB_COLLECTION_VIEW_LABELS,
  normalizeCollectionTitle,
  normalizeCollectionViewName,
  normalizeCollectionViewType,
  parseCollectionSchemaJson,
  parseVisibleFieldIdsJson,
  serializeCollectionSchema,
  serializeVisibleFieldIds,
  setCollectionFieldPropertyValue,
  type KbCollectionField,
  type KbCollectionLegacyBlock,
  type KbCollectionSchema,
  type KbCollectionView,
  type KbCollectionViewConfig,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
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

const SAVE_CELL_DEBOUNCE_MS = 650;
type FieldDropPlacement = "before" | "after";

type CollectionDocumentBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: CollectionDocumentBlock[];
};

function KbCollectionBlock({ block, editor }: CollectionRenderProps) {
  const router = useRouter();
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
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(KB_COLLECTION_DEFAULT_TITLE);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
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
  const ActiveViewIcon = view === "table" ? Table2 : GalleryHorizontalEnd;

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
    updateSchema({ version: 1, fields: [...schema.fields, field] });
    updateFieldOrderIds([
      ...orderCollectionFields(schema.fields, fieldOrderIds).map(
        (item) => item.id,
      ),
      field.id,
    ]);
    if (visibleFieldIds !== null) {
      updateVisibleFieldIds([...visibleFieldIds, field.id]);
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
          };
        }
        return { ...field, ...patch };
      }),
    });
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
    const slug = result?.slug ?? null;
    const error = result?.error ?? null;
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать запись");
      return;
    }
    router.push(`/knowledge/${slug}`);
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

  const deleteView = async (viewId: string) => {
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
  };

  const blockStyle = (
    previewWidth
      ? { "--kb-collection-preview-width": `${previewWidth}px` }
      : undefined
  ) as CSSProperties | undefined;

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
        <div className="kb-collection-title">
          <ActiveViewIcon className="size-4 text-brand" />
          {renamingTitle ? (
            <Input
              ref={titleInputRef}
              value={titleDraft}
              autoFocus
              className="kb-collection-title-input"
              aria-label="Название коллекции"
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
              aria-label="Переименовать коллекцию"
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
          <span className="kb-collection-count">{items.length}</span>
        </div>
        {editable && (
          <div className="kb-collection-actions">
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="kb-collection-icon-btn"
                  aria-label="Настройки коллекции"
                  onPointerDown={stopBlockInteraction}
                  onMouseDown={stopBlockInteraction}
                  onClick={stopBlockInteraction}
                >
                  <Settings2 className="size-4" />
                </Button>
              </PopoverTrigger>
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
                  title={collectionTitle}
                  viewTitle={viewTitle}
                  fields={orderedFields}
                  view={view}
                  views={collectionState?.views ?? []}
                  activeViewId={collectionState?.activeViewId ?? null}
                  visibleFieldIds={visibleFieldIds}
                  onRename={renameCollection}
                  onRenameView={updateViewTitle}
                  onChangeViewType={updateViewType}
                  onSwitchView={switchView}
                  onCreateView={createView}
                  onDuplicateView={duplicateView}
                  onDeleteView={deleteView}
                  onAddField={addField}
                  onUpdateField={updateField}
                  onRemoveField={removeField}
                  onReorderField={reorderField}
                  onSetFieldVisible={setFieldVisible}
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
              Новая запись
            </Button>
          </div>
        )}
      </div>

      {loading || collectionLoading ? (
        <div className="kb-collection-state">
          <Loader2 className="size-4 animate-spin" />
          Загружаем записи
        </div>
      ) : items.length === 0 ? (
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
      ) : (
        <>
          {view === "table" ? (
            <CollectionTableView
              items={items}
              fields={visibleFields}
              collectionId={collectionId}
              collectionTitle={collectionTitle}
              canEdit={editable}
              visibleFieldIds={visibleFieldIds}
              onChangeValue={updateItemPropertyValue}
              onUpdateField={updateField}
              onRemoveField={removeField}
              onReorderField={reorderField}
              onInsertField={insertField}
              onSetFieldVisible={setFieldVisible}
            />
          ) : (
            <div className="kb-collection-list">
              {items.map((item) => (
                <CollectionItemRow
                  key={item.id}
                  item={item}
                  fields={visibleFields}
                  collectionId={collectionId}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CollectionLayoutOptions({
  view,
  onChange,
}: {
  view: KbCollectionView;
  onChange: (view: KbCollectionView) => void;
}) {
  return (
    <div
      className="kb-collection-layout-grid"
      role="group"
      aria-label="Layout"
    >
      {(["table", "list"] as const).map((nextView) => {
        const active = view === nextView;
        const Icon = nextView === "table" ? Table2 : GalleryHorizontalEnd;
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
    </div>
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
          const Icon = view.viewType === "table" ? Table2 : GalleryHorizontalEnd;
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
              <Icon className="size-4" />
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

function CollectionItemRow({
  item,
  fields,
  collectionId,
}: {
  item: KbCollectionItem;
  fields: KbCollectionField[];
  collectionId: string;
}) {
  const preview = item.plain_text.trim();

  return (
    <Link href={`/knowledge/${item.slug}`} className="kb-collection-row">
      <div className="kb-collection-row-main">
        <KbPageIcon icon={item.icon} color={item.icon_color} size={18} />
        <div className="min-w-0 flex-1">
          <div className="kb-collection-row-title">
            {item.title || "Без названия"}
          </div>
          {preview && <div className="kb-collection-preview">{preview}</div>}
        </div>
      </div>
      {fields.length > 0 && (
        <div className="kb-collection-properties">
          {fields.map((field) => (
            <CollectionPropertyChip
              key={field.id}
              field={field}
              property={findPropertyForCollectionField(
                item.properties,
                field,
                collectionId,
              )}
            />
          ))}
        </div>
      )}
    </Link>
  );
}

function CollectionPropertyChip({
  field,
  property,
}: {
  field: KbCollectionField;
  property: KbProperty | null;
}) {
  const Icon = FIELD_ICONS[field.type];
  const value = property ? formatPropertyValue(property) : "";

  return (
    <span className="kb-collection-property">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="kb-collection-property-name">{field.name}</span>
      <span
        className={cn(
          "kb-collection-property-value",
          !value && "text-muted-foreground/55",
        )}
      >
        {value || "Пусто"}
      </span>
    </span>
  );
}

function CollectionTableView({
  items,
  fields,
  collectionId,
  collectionTitle,
  canEdit,
  visibleFieldIds,
  onChangeValue,
  onUpdateField,
  onRemoveField,
  onReorderField,
  onInsertField,
  onSetFieldVisible,
}: {
  items: KbCollectionItem[];
  fields: KbCollectionField[];
  collectionId: string;
  collectionTitle: string;
  canEdit: boolean;
  visibleFieldIds: KbCollectionVisibleFieldIds;
  onChangeValue: (
    pageId: string,
    field: KbCollectionField,
    value: KbProperty["value"],
  ) => void;
  onUpdateField: (id: string, patch: Partial<KbCollectionField>) => void;
  onRemoveField: (id: string) => void;
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
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef(fields);
  const suppressHeaderClickRef = useRef(false);
  const [openFieldMenuId, setOpenFieldMenuId] = useState<string | null>(null);
  const [columnDrag, setColumnDrag] = useState<{
    activeId: string;
    indicatorIndex: number;
    x: number;
    previewX: number;
    previewWidth: number;
  } | null>(null);
  const gridTemplateColumns =
    fields.length > 0
      ? `minmax(220px, 240px) repeat(${fields.length}, minmax(150px, 1fr))`
      : "minmax(220px, 1fr)";
  const rowStyle: CSSProperties = { gridTemplateColumns };
  const draggingColumnId = columnDrag?.activeId ?? null;

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

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

  return (
    <div className="kb-collection-table-scroll" role="region">
      <div
        ref={tableRef}
        className="kb-collection-table"
        role="table"
        aria-label="Записи коллекции"
        data-column-dragging={columnDrag ? true : undefined}
      >
        <div
          className="kb-collection-table-row kb-collection-table-row-head"
          role="row"
          style={rowStyle}
        >
          <div
            className="kb-collection-table-head-cell kb-collection-table-title-col"
            role="columnheader"
          >
            Страница
          </div>
          {fields.map((field) => {
            const Icon = FIELD_ICONS[field.type];
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
                <PopoverTrigger asChild>
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
                      <Icon className="size-3.5" />
                      <span>{field.name}</span>
                    </span>
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
        </div>
        {items.map((item) => (
          <div
            key={item.id}
            className="kb-collection-table-row"
            role="row"
            style={rowStyle}
          >
            <div className="kb-collection-table-title-cell" role="cell">
              <Link href={`/knowledge/${item.slug}`}>
                <KbPageIcon icon={item.icon} color={item.icon_color} size={17} />
                <span>{item.title || "Без названия"}</span>
              </Link>
            </div>
            {fields.map((field) => {
              const property =
                findPropertyForCollectionField(
                  item.properties,
                  field,
                  collectionId,
                ) ??
                collectionFieldToProperty(field, {
                  collectionId,
                  collectionTitle,
                });
              return (
                <div
                  key={field.id}
                  className="kb-collection-table-cell"
                  role="cell"
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
      </div>
    </div>
  );
}

function CollectionColumnMenu({
  field,
  visible,
  onUpdate,
  onRemove,
  onInsert,
  onVisibleChange,
}: {
  field: KbCollectionField;
  visible: boolean;
  onUpdate: (patch: Partial<KbCollectionField>) => void;
  onRemove: () => void;
  onInsert: (
    type: KbPropertyType,
    name: string,
    placement: FieldDropPlacement,
  ) => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const [panel, setPanel] = useState<"root" | FieldDropPlacement>("root");
  const [name, setName] = useState(field.name);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<KbPropertyType>("text");

  useEffect(() => {
    setName(field.name);
  }, [field.id, field.name]);

  const commitName = () => {
    const nextName = name.trim() || KB_COLLECTION_FIELD_LABELS[field.type];
    setName(nextName);
    if (nextName !== field.name) onUpdate({ name: nextName });
  };

  if (panel !== "root") {
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

  const Icon = FIELD_ICONS[field.type];

  return (
    <div className="kb-collection-column-menu-panel">
      <div className="kb-collection-column-menu-name">
        <Icon className="size-4" />
        <Input
          value={name}
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
      </div>
      <label className="kb-collection-column-menu-row">
        <Type className="size-4" />
        <span>Тип</span>
        <select
          className="kb-collection-column-menu-select"
          value={field.type}
          aria-label="Тип свойства"
          onChange={(event) =>
            onUpdate({ type: event.currentTarget.value as KbPropertyType })
          }
        >
          {KB_COLLECTION_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {KB_COLLECTION_FIELD_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onVisibleChange(!visible);
        }}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        <span>{visible ? "Скрыть" : "Показать"}</span>
      </button>
      <div className="kb-collection-column-menu-separator" />
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("before");
        }}
      >
        <PlusSquare className="size-4" />
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
        <PlusSquare className="size-4" />
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
        <Trash2 className="size-4" />
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
        {KB_COLLECTION_FIELD_TYPES.map((fieldType) => {
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
  title,
  viewTitle,
  fields,
  view,
  views,
  activeViewId,
  visibleFieldIds,
  onRename,
  onRenameView,
  onChangeViewType,
  onSwitchView,
  onCreateView,
  onDuplicateView,
  onDeleteView,
  onAddField,
  onUpdateField,
  onRemoveField,
  onReorderField,
  onSetFieldVisible,
}: {
  title: string;
  viewTitle: string;
  fields: KbCollectionField[];
  view: KbCollectionView;
  views: KbCollectionViewConfig[];
  activeViewId: string | null;
  visibleFieldIds: KbCollectionVisibleFieldIds;
  onRename: (title: string) => void;
  onRenameView: (title: string) => void;
  onChangeViewType: (view: KbCollectionView) => void;
  onSwitchView: (viewId: string) => void;
  onCreateView: (view: KbCollectionView) => void;
  onDuplicateView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
  onAddField: (type: KbPropertyType) => void;
  onUpdateField: (id: string, patch: Partial<KbCollectionField>) => void;
  onRemoveField: (id: string) => void;
  onReorderField: (
    activeId: string,
    targetId: string,
    placement?: FieldDropPlacement,
  ) => void;
  onSetFieldVisible: (id: string, visible: boolean) => void;
}) {
  const [panel, setPanel] = useState<
    "root" | "view" | "layout" | "views" | "properties"
  >("root");
  const [titleDraft, setTitleDraft] = useState(title);
  const [viewTitleDraft, setViewTitleDraft] = useState(viewTitle);
  const skipTitleCommitRef = useRef(false);
  const skipViewTitleCommitRef = useRef(false);
  const visibleCount = fields.filter((field) =>
    isCollectionFieldVisible(field.id, visibleFieldIds),
  ).length;

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  useEffect(() => {
    setViewTitleDraft(viewTitle);
  }, [viewTitle]);

  const commitTitle = (value = titleDraft) => {
    if (skipTitleCommitRef.current) {
      skipTitleCommitRef.current = false;
      return;
    }
    const nextTitle = normalizeCollectionTitle(value);
    setTitleDraft(nextTitle);
    onRename(nextTitle);
  };

  const commitViewTitle = (value = viewTitleDraft) => {
    if (skipViewTitleCommitRef.current) {
      skipViewTitleCommitRef.current = false;
      return;
    }
    const nextTitle = normalizeCollectionViewName(value, view);
    setViewTitleDraft(nextTitle);
    onRenameView(nextTitle);
  };

  if (panel === "view") {
    const ViewIcon = view === "table" ? Table2 : GalleryHorizontalEnd;
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Вид" onBack={() => setPanel("root")} />
        <div className="kb-collection-settings-name-row">
          <ViewIcon className="size-4" />
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
        </div>
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
            <span>Layout</span>
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
              setPanel("views");
            }}
          >
            <ListChecks className="size-4" />
            <span>Все виды</span>
            <span className="kb-collection-settings-row-value">
              {views.length}
            </span>
            <ChevronRight className="size-4" />
          </button>
          {activeViewId && (
            <>
              <button
                type="button"
                className="kb-collection-settings-nav-row"
                onClick={(event) => {
                  stopBlockMenuAction(event);
                  onDuplicateView(activeViewId);
                }}
              >
                <Copy className="size-4" />
                <span>Дублировать вид</span>
                <span />
                <span />
              </button>
              <button
                type="button"
                className="kb-collection-settings-nav-row text-destructive"
                disabled={views.length <= 1}
                onClick={(event) => {
                  stopBlockMenuAction(event);
                  onDeleteView(activeViewId);
                }}
              >
                <Trash2 className="size-4" />
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

  if (panel === "layout") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Layout" onBack={() => setPanel("view")} />
        <CollectionLayoutOptions view={view} onChange={onChangeViewType} />
      </div>
    );
  }

  if (panel === "views") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Все виды" onBack={() => setPanel("view")} />
        <CollectionViewsEditor
          views={views}
          activeViewId={activeViewId}
          onSwitchView={onSwitchView}
          onCreateView={onCreateView}
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
        {fields.length === 0 ? (
          <div className="kb-collection-settings-empty">
            Добавьте свойство, чтобы показывать его в коллекции.
          </div>
        ) : (
          <div className="kb-collection-properties-editor-list">
            {fields.map((field) => (
              <CollectionFieldEditor
                key={field.id}
                field={field}
                visible={isCollectionFieldVisible(field.id, visibleFieldIds)}
                onUpdate={(patch) => onUpdateField(field.id, patch)}
                onRemove={() => onRemoveField(field.id)}
                onReorder={onReorderField}
                onVisibleChange={(visible) =>
                  onSetFieldVisible(field.id, visible)
                }
              />
            ))}
          </div>
        )}
        <div className="kb-collection-add-field-row">
          <select
            className="kb-collection-native-select"
            defaultValue=""
            aria-label="Добавить свойство"
            onChange={(event) => {
              const value = event.currentTarget.value as KbPropertyType | "";
              if (!value) return;
              onAddField(value);
              event.currentTarget.value = "";
            }}
          >
            <option value="" disabled>
              Добавить свойство
            </option>
            {KB_COLLECTION_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {KB_COLLECTION_FIELD_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="kb-collection-settings-panel">
      <div className="kb-collection-settings-title">Настройки коллекции</div>
      <div className="kb-collection-settings-name-row">
        <Database className="size-4" />
        <Input
          value={titleDraft}
          className="kb-collection-settings-name-input"
          aria-label="Название коллекции"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
          onChange={(event) => setTitleDraft(event.currentTarget.value)}
          onBlur={(event) => commitTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitTitle(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              skipTitleCommitRef.current = true;
              setTitleDraft(title);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="kb-collection-settings-root-list">
        <button
          type="button"
          className="kb-collection-settings-nav-row"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("view");
          }}
        >
          {view === "table" ? (
            <Table2 className="size-4" />
          ) : (
            <GalleryHorizontalEnd className="size-4" />
          )}
          <span>Вид</span>
          <span className="kb-collection-settings-row-value">
            {viewTitle}
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
          <Eye className="size-4" />
          <span>Свойства</span>
          <span className="kb-collection-settings-row-value">
            {visibleCount}
          </span>
          <ChevronRight className="size-4" />
        </button>
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
  const Icon = FIELD_ICONS[field.type];
  const [name, setName] = useState(field.name);

  useEffect(() => {
    setName(field.name);
  }, [field.id, field.name]);

  const commitName = () => {
    const nextName = name.trim() || KB_COLLECTION_FIELD_LABELS[field.type];
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
      <Icon className="size-4 text-muted-foreground" />
      <Input
        value={name}
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
      <select
        className="kb-collection-field-type"
        value={field.type}
        aria-label="Тип свойства"
        onChange={(event) =>
          onUpdate({ type: event.currentTarget.value as KbPropertyType })
        }
      >
        {KB_COLLECTION_FIELD_TYPES.map((type) => (
          <option key={type} value={type}>
            {KB_COLLECTION_FIELD_LABELS[type]}
          </option>
        ))}
      </select>
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

function formatPropertyValue(property: KbProperty): string {
  switch (property.type) {
    case "text":
    case "url":
      return property.value.trim();
    case "number":
      return property.value === null ? "" : String(property.value);
    case "date":
      return property.value ?? "";
    case "checkbox":
      return property.value ? "Да" : "Нет";
    case "select":
      return property.value ?? "";
    case "multi-select":
      return property.value.join(", ");
    case "rating": {
      if (property.value === null) return "";
      const max = property.max ?? 5;
      return `${property.value}/${max}`;
    }
  }
}

function orderCollectionFields(
  fields: KbCollectionField[],
  fieldOrderIds: string[] | null,
): KbCollectionField[] {
  if (!fieldOrderIds || fieldOrderIds.length === 0) return fields;

  const byId = new Map(fields.map((field) => [field.id, field]));
  const ordered: KbCollectionField[] = [];
  const usedIds = new Set<string>();

  for (const fieldId of fieldOrderIds) {
    const field = byId.get(fieldId);
    if (!field || usedIds.has(fieldId)) continue;
    ordered.push(field);
    usedIds.add(fieldId);
  }

  for (const field of fields) {
    if (!usedIds.has(field.id)) ordered.push(field);
  }

  return ordered;
}

function reorderCollectionFieldIds(
  fields: KbCollectionField[],
  fieldOrderIds: string[] | null,
  activeId: string,
  targetId: string,
  placement: FieldDropPlacement,
): string[] | null {
  const ids = orderCollectionFields(fields, fieldOrderIds).map(
    (field) => field.id,
  );
  const fromIndex = ids.indexOf(activeId);
  const targetIndex = ids.indexOf(targetId);
  if (fromIndex < 0 || targetIndex < 0) return null;

  const nextIds = [...ids];
  const [movedId] = nextIds.splice(fromIndex, 1);
  const nextTargetIndex = nextIds.indexOf(targetId);
  if (nextTargetIndex < 0) return null;

  const insertIndex =
    placement === "after" ? nextTargetIndex + 1 : nextTargetIndex;
  if (nextIds[insertIndex] === movedId) return null;
  nextIds.splice(insertIndex, 0, movedId);
  return nextIds;
}

function insertCollectionFieldId(
  fields: KbCollectionField[],
  fieldOrderIds: string[] | null,
  newFieldId: string,
  targetId: string,
  placement: FieldDropPlacement,
): string[] {
  const ids = orderCollectionFields(fields, fieldOrderIds)
    .map((field) => field.id)
    .filter((fieldId) => fieldId !== newFieldId);
  const targetIndex = ids.indexOf(targetId);
  const insertIndex =
    targetIndex < 0
      ? ids.length
      : placement === "after"
        ? targetIndex + 1
        : targetIndex;
  ids.splice(insertIndex, 0, newFieldId);
  return ids;
}

function getDocumentCollectionBlocks(
  editor: unknown,
): CollectionDocumentBlock[] {
  const documentBlocks = (editor as { document?: unknown }).document;
  if (!Array.isArray(documentBlocks)) return [];

  const collectionBlocks: CollectionDocumentBlock[] = [];
  walkDocumentBlocks(
    documentBlocks as CollectionDocumentBlock[],
    (documentBlock) => {
      if (documentBlock.type === "collection") {
        collectionBlocks.push(documentBlock);
      }
    },
  );
  return collectionBlocks;
}

function buildLegacyCollectionBlocks(
  editor: unknown,
): KbCollectionLegacyBlock[] {
  return getDocumentCollectionBlocks(editor).map((documentBlock) => {
    const props = documentBlock.props ?? {};
    return {
      blockId: documentBlock.id,
      title: typeof props.title === "string" ? props.title : undefined,
      view: normalizeCollectionViewType(props.view),
      viewTitle:
        typeof props.viewTitle === "string" ? props.viewTitle : undefined,
      schemaJson:
        typeof props.schemaJson === "string"
          ? props.schemaJson
          : KB_COLLECTION_EMPTY_SCHEMA,
      visibleFieldIdsJson:
        typeof props.visibleFieldIdsJson === "string"
          ? props.visibleFieldIdsJson
          : KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
      fieldOrderIdsJson:
        typeof props.fieldOrderIdsJson === "string"
          ? props.fieldOrderIdsJson
          : KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
    };
  });
}

function walkDocumentBlocks(
  blocks: CollectionDocumentBlock[],
  visit: (block: CollectionDocumentBlock) => void,
) {
  for (const block of blocks) {
    visit(block);
    if (Array.isArray(block.children) && block.children.length > 0) {
      walkDocumentBlocks(block.children, visit);
    }
  }
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
