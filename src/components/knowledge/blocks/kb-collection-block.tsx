"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  Database,
  FileText,
  Hash,
  Link as LinkIcon,
  ListChecks,
  Loader2,
  Plus,
  Settings2,
  Star,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
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
  findPropertyForCollectionField,
  isCollectionFieldVisible,
  KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  KB_COLLECTION_EMPTY_SCHEMA,
  KB_COLLECTION_FIELD_LABELS,
  KB_COLLECTION_FIELD_TYPES,
  parseCollectionSchemaJson,
  parseVisibleFieldIdsJson,
  serializeCollectionSchema,
  serializeVisibleFieldIds,
  type KbCollectionField,
  type KbCollectionSchema,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
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
      values: ["list"] as const,
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

function KbCollectionBlock({ block, editor }: CollectionRenderProps) {
  const router = useRouter();
  const runtime = useContext(KbCollectionRuntimeContext);
  const editable = editor.isEditable;
  const canCreate = editable && runtime.canCreatePages && Boolean(runtime.pageId);
  const [items, setItems] = useState<KbCollectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const loadItems = useCallback(async () => {
    if (!runtime.pageId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { rows, error } = await listKbCollectionItems(runtime.pageId);
    if (error) {
      toast.error(`Не удалось загрузить коллекцию: ${error}`);
    } else {
      setItems(rows);
    }
    setLoading(false);
  }, [runtime.pageId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!editable || !runtime.pageId || schema.fields.length === 0) return;

    const schemaJson = serializeCollectionSchema(schema);
    const timer = window.setTimeout(() => {
      void syncKbCollectionRecords({
        parentPageId: runtime.pageId!,
        schemaJson,
      }).then(({ updated, error }) => {
        if (error) {
          toast.error(`Не удалось применить поля коллекции: ${error}`);
          return;
        }
        if (updated > 0) void loadItems();
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [block.props.schemaJson, editable, loadItems, runtime.pageId, schema]);

  const updateSchema = (nextSchema: KbCollectionSchema) => {
    editor.updateBlock(block.id, {
      props: { schemaJson: serializeCollectionSchema(nextSchema) },
    } as never);
  };

  const updateVisibleFieldIds = (next: KbCollectionVisibleFieldIds) => {
    editor.updateBlock(block.id, {
      props: { visibleFieldIdsJson: serializeVisibleFieldIds(next) },
    } as never);
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
    const { slug, error } = await createKbCollectionRecord({
      parentPageId: runtime.pageId,
      schemaJson: serializeCollectionSchema(schema),
    });
    setCreating(false);
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать запись");
      return;
    }
    router.push(`/knowledge/${slug}`);
  };

  return (
    <div
      className="kb-collection-block"
      data-kb-collection-block
      data-editable={editable || undefined}
      contentEditable={false}
    >
      <div className="kb-collection-header">
        <div className="kb-collection-title">
          <Database className="size-4 text-brand" />
          <span>Коллекция</span>
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
                  schema={schema}
                  visibleFieldIds={visibleFieldIds}
                  onAddField={addField}
                  onUpdateField={updateField}
                  onRemoveField={removeField}
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
        <div className="kb-collection-list">
          {items.map((item) => (
            <CollectionItemRow
              key={item.id}
              item={item}
              fields={visibleFields}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionItemRow({
  item,
  fields,
}: {
  item: KbCollectionItem;
  fields: KbCollectionField[];
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
              property={findPropertyForCollectionField(item.properties, field)}
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

function CollectionSettings({
  schema,
  visibleFieldIds,
  onAddField,
  onUpdateField,
  onRemoveField,
  onSetFieldVisible,
}: {
  schema: KbCollectionSchema;
  visibleFieldIds: KbCollectionVisibleFieldIds;
  onAddField: (type: KbPropertyType) => void;
  onUpdateField: (id: string, patch: Partial<KbCollectionField>) => void;
  onRemoveField: (id: string) => void;
  onSetFieldVisible: (id: string, visible: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="kb-collection-settings-title">Настройки коллекции</div>
      <div className="flex flex-col gap-2">
        {schema.fields.length === 0 ? (
          <div className="kb-collection-settings-empty">
            Добавьте поле, чтобы показывать свойства записей в списке.
          </div>
        ) : (
          schema.fields.map((field) => (
            <CollectionFieldEditor
              key={field.id}
              field={field}
              visible={isCollectionFieldVisible(field.id, visibleFieldIds)}
              onUpdate={(patch) => onUpdateField(field.id, patch)}
              onRemove={() => onRemoveField(field.id)}
              onVisibleChange={(visible) => onSetFieldVisible(field.id, visible)}
            />
          ))
        )}
      </div>
      <div className="kb-collection-add-field-row">
        <select
          className="kb-collection-native-select"
          defaultValue=""
          aria-label="Добавить поле"
          onChange={(event) => {
            const value = event.currentTarget.value as KbPropertyType | "";
            if (!value) return;
            onAddField(value);
            event.currentTarget.value = "";
          }}
        >
          <option value="" disabled>
            Добавить поле
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

function CollectionFieldEditor({
  field,
  visible,
  onUpdate,
  onRemove,
  onVisibleChange,
}: {
  field: KbCollectionField;
  visible: boolean;
  onUpdate: (patch: Partial<KbCollectionField>) => void;
  onRemove: () => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const Icon = FIELD_ICONS[field.type];

  return (
    <div className="kb-collection-field-editor">
      <Icon className="size-4 text-muted-foreground" />
      <Input
        value={field.name}
        onChange={(event) => onUpdate({ name: event.currentTarget.value })}
        className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        aria-label="Название поля"
      />
      <select
        className="kb-collection-field-type"
        value={field.type}
        aria-label="Тип поля"
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
        aria-label={visible ? "Скрыть поле" : "Показать поле"}
        className="scale-90"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="Удалить поле"
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
