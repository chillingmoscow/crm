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
  createKbCollectionRecord,
  listKbCollectionItems,
  syncKbCollectionRecords,
  type KbCollectionItem,
} from "@/lib/knowledge/collection-actions";
import {
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
  parseCollectionSchemaJson,
  parseVisibleFieldIdsJson,
  serializeCollectionSchema,
  serializeVisibleFieldIds,
  setCollectionFieldPropertyValue,
  type KbCollectionField,
  type KbCollectionSchema,
  type KbCollectionView,
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

const COLLECTION_VIEW_LABELS: Record<KbCollectionView, string> = {
  list: "Галерея",
  table: "Таблица",
};

const SAVE_CELL_DEBOUNCE_MS = 650;
const DEFAULT_COLLECTION_TITLE = "Коллекция";
type FieldDropPlacement = "before" | "after";

type CollectionDocumentBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: CollectionDocumentBlock[];
};

type SharedCollectionProps = Partial<{
  title: string;
  collectionId: string;
  schemaJson: string;
}>;

function KbCollectionBlock({ block, editor }: CollectionRenderProps) {
  const router = useRouter();
  const runtime = useContext(KbCollectionRuntimeContext);
  const editable = editor.isEditable;
  const canCreate = editable && runtime.canCreatePages && Boolean(runtime.pageId);
  const [items, setItems] = useState<KbCollectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(DEFAULT_COLLECTION_TITLE);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<KbCollectionItem[]>([]);
  const cancelTitleRenameRef = useRef(false);
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const collectionId = runtime.pageId
    ? getPageCollectionId(runtime.pageId)
    : block.props.collectionId || block.id;
  const collectionTitle = normalizeCollectionTitle(block.props.title);
  const view: KbCollectionView =
    block.props.view === "table" ? "table" : "list";

  const schema = useMemo(
    () => parseCollectionSchemaJson(block.props.schemaJson),
    [block.props.schemaJson],
  );
  const visibleFieldIds = useMemo(
    () => parseVisibleFieldIdsJson(block.props.visibleFieldIdsJson),
    [block.props.visibleFieldIdsJson],
  );
  const visibleFields = useMemo(
    () =>
      schema.fields.filter((field) =>
        isCollectionFieldVisible(field.id, visibleFieldIds),
      ),
    [schema.fields, visibleFieldIds],
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
    if (!editable || !runtime.pageId || !itemsLoaded) return;
    if (schema.fields.length === 0 && inferredSchema.fields.length > 0) return;

    const schemaJson = serializeCollectionSchema(schema);
    const timer = window.setTimeout(() => {
      void syncKbCollectionRecords({
        parentPageId: runtime.pageId!,
        schemaJson,
        collectionId,
        collectionTitle,
      }).then((result) => {
        const error = result?.error ?? null;
        if (error) {
          toast.error(`Не удалось применить поля коллекции: ${error}`);
        }
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    block.props.schemaJson,
    collectionId,
    collectionTitle,
    editable,
    inferredSchema.fields.length,
    itemsLoaded,
    runtime.pageId,
    schema,
  ]);

  const updateSchema = (nextSchema: KbCollectionSchema) => {
    updateSharedCollectionProps({
      schemaJson: serializeCollectionSchema(nextSchema),
    });
  };

  const updateVisibleFieldIds = useCallback(
    (next: KbCollectionVisibleFieldIds) => {
      editor.updateBlock(block.id, {
        props: { visibleFieldIdsJson: serializeVisibleFieldIds(next) },
      } as never);
    },
    [block.id, editor],
  );

  const updateSharedCollectionProps = useCallback(
    (patch: SharedCollectionProps) => {
      const blocks = getDocumentCollectionBlocks(editor);
      const targetIds = blocks.length > 0 ? blocks.map((item) => item.id) : [block.id];

      for (const targetId of targetIds) {
        editor.updateBlock(targetId, { props: patch } as never);
      }
    },
    [block.id, editor],
  );

  useEffect(() => {
    if (!editable || !runtime.pageId) return;
    const blocks = getDocumentCollectionBlocks(editor);
    const needsSync =
      blocks.length === 0 ||
      blocks.some((item) => item.props?.collectionId !== collectionId);
    if (!needsSync) return;
    updateSharedCollectionProps({ collectionId });
  }, [
    collectionId,
    editable,
    editor,
    runtime.pageId,
    updateSharedCollectionProps,
  ]);

  useEffect(() => {
    if (!editable || !itemsLoaded || schema.fields.length > 0) return;
    if (inferredSchema.fields.length === 0) return;
    updateSharedCollectionProps({
      schemaJson: serializeCollectionSchema(inferredSchema),
    });
    if (visibleFieldIds !== null) {
      updateVisibleFieldIds(inferredSchema.fields.map((field) => field.id));
    }
  }, [
    editable,
    inferredSchema,
    itemsLoaded,
    schema.fields.length,
    updateSharedCollectionProps,
    updateVisibleFieldIds,
    visibleFieldIds,
  ]);

  useEffect(() => {
    if (!editable || !runtime.pageId) return;
    const blocks = getDocumentCollectionBlocks(editor);
    if (blocks.length < 2) return;

    const currentSchemaJson = serializeCollectionSchema(schema);
    const bestSchemaJson = pickCanonicalCollectionSchemaJson(
      blocks,
      currentSchemaJson,
    );
    if (bestSchemaJson !== currentSchemaJson) {
      updateSharedCollectionProps({ schemaJson: bestSchemaJson });
      return;
    }

    const bestTitle = pickCanonicalCollectionTitle(blocks, collectionTitle);
    if (bestTitle !== collectionTitle) {
      updateSharedCollectionProps({ title: bestTitle });
    }
  }, [
    collectionTitle,
    editable,
    editor,
    runtime.pageId,
    schema,
    updateSharedCollectionProps,
  ]);

  const updateView = (nextView: KbCollectionView) => {
    if (nextView === view) return;
    editor.updateBlock(block.id, {
      props: { view: nextView },
    } as never);
  };

  const renameCollection = (nextTitle: string) => {
    const title = normalizeCollectionTitle(nextTitle);
    setTitleDraft(title);
    if (title === collectionTitle) return;
    updateSharedCollectionProps({ title });
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
    const fromIndex = schema.fields.findIndex((field) => field.id === activeId);
    const targetIndex = schema.fields.findIndex((field) => field.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;

    const nextFields = [...schema.fields];
    const [moved] = nextFields.splice(fromIndex, 1);
    const nextTargetIndex = nextFields.findIndex((field) => field.id === targetId);
    if (nextTargetIndex < 0) return;
    const insertIndex = placement === "after" ? nextTargetIndex + 1 : nextTargetIndex;
    if (nextFields[insertIndex]?.id === moved.id) return;
    nextFields.splice(insertIndex, 0, moved);
    updateSchema({ version: 1, fields: nextFields });
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
    const nextFields = [...schema.fields];
    nextFields.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, field);
    updateSchema({ version: 1, fields: nextFields });
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
      schemaJson: serializeCollectionSchema(schema),
      collectionId,
      collectionTitle,
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
          <Database className="size-4 text-brand" />
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
                  schema={schema}
                  view={view}
                  visibleFieldIds={visibleFieldIds}
                  onRename={renameCollection}
                  onChangeView={updateView}
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

      {loading ? (
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

function CollectionViewOptions({
  view,
  onChange,
}: {
  view: KbCollectionView;
  onChange: (view: KbCollectionView) => void;
}) {
  return (
    <div className="kb-collection-view-options" role="group" aria-label="Вид">
      {(["list", "table"] as const).map((nextView) => {
        const active = view === nextView;
        const Icon = nextView === "list" ? GalleryHorizontalEnd : Table2;
        return (
          <button
            key={nextView}
            type="button"
            className="kb-collection-view-card"
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
            <span>{COLLECTION_VIEW_LABELS[nextView]}</span>
          </button>
        );
      })}
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
  schema,
  view,
  visibleFieldIds,
  onRename,
  onChangeView,
  onAddField,
  onUpdateField,
  onRemoveField,
  onReorderField,
  onSetFieldVisible,
}: {
  title: string;
  schema: KbCollectionSchema;
  view: KbCollectionView;
  visibleFieldIds: KbCollectionVisibleFieldIds;
  onRename: (title: string) => void;
  onChangeView: (view: KbCollectionView) => void;
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
  const [panel, setPanel] = useState<"root" | "view" | "properties">("root");
  const [titleDraft, setTitleDraft] = useState(title);
  const skipTitleCommitRef = useRef(false);
  const visibleCount = schema.fields.filter((field) =>
    isCollectionFieldVisible(field.id, visibleFieldIds),
  ).length;

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  const commitTitle = (value = titleDraft) => {
    if (skipTitleCommitRef.current) {
      skipTitleCommitRef.current = false;
      return;
    }
    const nextTitle = normalizeCollectionTitle(value);
    setTitleDraft(nextTitle);
    onRename(nextTitle);
  };

  if (panel === "view") {
    return (
      <div className="kb-collection-settings-panel">
        <SettingsPanelHeader title="Вид" onBack={() => setPanel("root")} />
        <CollectionViewOptions view={view} onChange={onChangeView} />
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
        {schema.fields.length === 0 ? (
          <div className="kb-collection-settings-empty">
            Добавьте свойство, чтобы показывать его в коллекции.
          </div>
        ) : (
          <div className="kb-collection-properties-editor-list">
            {schema.fields.map((field) => (
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
          <GalleryHorizontalEnd className="size-4" />
          <span>Вид</span>
          <span className="kb-collection-settings-row-value">
            {COLLECTION_VIEW_LABELS[view]}
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

function normalizeCollectionTitle(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_COLLECTION_TITLE;
  const title = value.trim();
  return title || DEFAULT_COLLECTION_TITLE;
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

function pickCanonicalCollectionSchemaJson(
  blocks: CollectionDocumentBlock[],
  currentSchemaJson: string,
): string {
  let bestJson = currentSchemaJson;
  let bestFieldCount = parseCollectionSchemaJson(currentSchemaJson).fields.length;

  for (const block of blocks) {
    const schemaJson =
      typeof block.props?.schemaJson === "string"
        ? block.props.schemaJson
        : KB_COLLECTION_EMPTY_SCHEMA;
    const normalizedJson = serializeCollectionSchema(
      parseCollectionSchemaJson(schemaJson),
    );
    const fieldCount = parseCollectionSchemaJson(normalizedJson).fields.length;
    if (fieldCount > bestFieldCount) {
      bestJson = normalizedJson;
      bestFieldCount = fieldCount;
    }
  }

  return bestJson;
}

function pickCanonicalCollectionTitle(
  blocks: CollectionDocumentBlock[],
  currentTitle: string,
): string {
  if (currentTitle !== DEFAULT_COLLECTION_TITLE) return currentTitle;

  for (const block of blocks) {
    const title = normalizeCollectionTitle(block.props?.title);
    if (title !== DEFAULT_COLLECTION_TITLE) return title;
  }

  return currentTitle;
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
