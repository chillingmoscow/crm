"use client";

import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  Plus,
  Trash2,
  MoreHorizontal,
  Type as TypeIcon,
  Hash,
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  saveKbPageProperties,
  saveKbTemplateProperties,
} from "@/lib/knowledge/properties";
import type { KbProperty, KbPropertyType } from "@/types/knowledge";

interface KbPagePropertiesProps {
  /** Идентификатор страницы или шаблона. */
  targetId: string;
  /** Куда сохраняем — page (kb_pages) или template (kb_templates). */
  mode: "page" | "template";
  initialProperties: KbProperty[];
  canEdit: boolean;
}

const TYPE_ICONS: Record<KbPropertyType, React.ComponentType<{ className?: string }>> = {
  text: TypeIcon,
  number: Hash,
  date: CalendarIcon,
  checkbox: CheckSquare,
  select: ChevronDown,
};

const TYPE_LABELS: Record<KbPropertyType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  checkbox: "Чекбокс",
  select: "Выбор",
};

const SAVE_DEBOUNCE_MS = 1500;

/** Создаёт пустое property указанного типа с дефолтным `name`. */
function makeProperty(type: KbPropertyType, name?: string): KbProperty {
  const id = nanoid(8);
  const baseName = name ?? `Свойство ${TYPE_LABELS[type].toLowerCase()}`;
  switch (type) {
    case "text":
      return { id, name: baseName, type: "text", value: "" };
    case "number":
      return { id, name: baseName, type: "number", value: null };
    case "date":
      return { id, name: baseName, type: "date", value: null };
    case "checkbox":
      return { id, name: baseName, type: "checkbox", value: false };
    case "select":
      return { id, name: baseName, type: "select", value: null, options: [] };
  }
}

export function KbPageProperties({
  targetId,
  mode,
  initialProperties,
  canEdit,
}: KbPagePropertiesProps) {
  const [properties, setProperties] = useState<KbProperty[]>(initialProperties);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(initialProperties));

  // Debounced save: каждое изменение reset'ит таймер на 1.5s. На unmount
  // (router.push, закрытие dialog'а) — flush'имся синхронно.
  const scheduleSave = (next: KbProperty[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave(next);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushSave = async (next: KbProperty[]) => {
    const serialized = JSON.stringify(next);
    if (serialized === lastSavedRef.current) return;
    setSaving(true);
    const action =
      mode === "page" ? saveKbPageProperties : saveKbTemplateProperties;
    const payload =
      mode === "page"
        ? { pageId: targetId, properties: next }
        : { templateId: targetId, properties: next };
    const { error } = await action(payload as never);
    setSaving(false);
    if (error) {
      toast.error(`Не удалось сохранить свойства: ${error}`);
      return;
    }
    lastSavedRef.current = serialized;
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // На unmount: если есть несохранённые правки — flush.
      // (Используем sync ref — properties в closure уже свежие.)
    };
  }, []);

  const updateProperty = (id: string, patch: Partial<KbProperty>) => {
    setProperties((prev) => {
      const next = prev.map((p) =>
        p.id === id ? ({ ...p, ...patch } as KbProperty) : p,
      );
      scheduleSave(next);
      return next;
    });
  };

  const addProperty = (type: KbPropertyType) => {
    setProperties((prev) => {
      const next = [...prev, makeProperty(type)];
      scheduleSave(next);
      return next;
    });
  };

  const removeProperty = (id: string) => {
    setProperties((prev) => {
      const next = prev.filter((p) => p.id !== id);
      scheduleSave(next);
      return next;
    });
  };

  // Не рендерим пустую секцию для read-only страниц без свойств — иначе
  // на каждой странице висит пустой блок «Свойства».
  if (!canEdit && properties.length === 0) return null;

  return (
    <section
      aria-label="Свойства страницы"
      className="flex flex-col gap-1.5 px-2 -ml-2"
    >
      {properties.length > 0 && (
        <ul className="flex flex-col gap-1">
          {properties.map((prop) => (
            <PropertyRow
              key={prop.id}
              property={prop}
              canEdit={canEdit}
              onRename={(name) => updateProperty(prop.id, { name })}
              onChangeValue={(value) =>
                updateProperty(prop.id, { value } as Partial<KbProperty>)
              }
              onChangeOptions={(options) =>
                updateProperty(prop.id, { options } as Partial<KbProperty>)
              }
              onRemove={() => removeProperty(prop.id)}
            />
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex items-center gap-2 pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" /> свойство
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {(Object.keys(TYPE_LABELS) as KbPropertyType[]).map((t) => {
                const Icon = TYPE_ICONS[t];
                return (
                  <DropdownMenuItem key={t} onSelect={() => addProperty(t)}>
                    <Icon className="size-3.5 text-muted-foreground" />
                    {TYPE_LABELS[t]}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {saving && (
            <span className="text-[11px] text-muted-foreground/70">
              сохранение…
            </span>
          )}
        </div>
      )}
    </section>
  );
}

interface PropertyRowProps {
  property: KbProperty;
  canEdit: boolean;
  onRename: (name: string) => void;
  onChangeValue: (value: KbProperty["value"]) => void;
  onChangeOptions: (options: string[]) => void;
  onRemove: () => void;
}

function PropertyRow({
  property,
  canEdit,
  onRename,
  onChangeValue,
  onChangeOptions,
  onRemove,
}: PropertyRowProps) {
  const Icon = TYPE_ICONS[property.type];
  const [name, setName] = useState(property.name);
  // Sync external rename (e.g., другой клиент) на случай контролируемой
  // mutation сверху.
  useEffect(() => setName(property.name), [property.name]);

  return (
    <li className="group/row flex items-center gap-2 min-h-[28px]">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      {canEdit ? (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== property.name) onRename(trimmed);
            else setName(property.name);
          }}
          className="w-[140px] shrink-0 bg-transparent text-[13px] text-muted-foreground outline-none focus:text-foreground"
          aria-label="Имя свойства"
        />
      ) : (
        <span className="w-[140px] shrink-0 text-[13px] text-muted-foreground">
          {property.name}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <PropertyValueControl
          property={property}
          canEdit={canEdit}
          onChangeValue={onChangeValue}
          onChangeOptions={onChangeOptions}
        />
      </div>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover/row:opacity-100 focus:opacity-100"
              aria-label="Действия со свойством"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onSelect={onRemove}>
              <Trash2 className="size-3.5 text-destructive" />
              <span className="text-destructive">Удалить</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function PropertyValueControl({
  property,
  canEdit,
  onChangeValue,
  onChangeOptions,
}: {
  property: KbProperty;
  canEdit: boolean;
  onChangeValue: (value: KbProperty["value"]) => void;
  onChangeOptions: (options: string[]) => void;
}) {
  switch (property.type) {
    case "text":
      return canEdit ? (
        <Input
          value={property.value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder="—"
          className="h-7 text-[13px] border-transparent bg-transparent px-0 hover:border-input focus:border-input"
        />
      ) : (
        <span className="text-[13px]">{property.value || "—"}</span>
      );
    case "number":
      return canEdit ? (
        <Input
          type="number"
          inputMode="numeric"
          value={property.value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChangeValue(v === "" ? null : Number(v));
          }}
          placeholder="—"
          className="h-7 text-[13px] tabular-nums border-transparent bg-transparent px-0 hover:border-input focus:border-input"
        />
      ) : (
        <span className="text-[13px] tabular-nums">
          {property.value ?? "—"}
        </span>
      );
    case "date":
      return canEdit ? (
        <Input
          type="date"
          value={property.value ?? ""}
          onChange={(e) => onChangeValue(e.target.value || null)}
          className="h-7 text-[13px] tabular-nums border-transparent bg-transparent px-0 hover:border-input focus:border-input"
        />
      ) : (
        <span className="text-[13px] tabular-nums">
          {property.value ?? "—"}
        </span>
      );
    case "checkbox":
      return (
        <Checkbox
          checked={property.value}
          onCheckedChange={(v) => onChangeValue(v === true)}
          disabled={!canEdit}
          aria-label="Значение"
        />
      );
    case "select":
      return <SelectControl
        property={property}
        canEdit={canEdit}
        onChangeValue={onChangeValue}
        onChangeOptions={onChangeOptions}
      />;
  }
}

function SelectControl({
  property,
  canEdit,
  onChangeValue,
  onChangeOptions,
}: {
  property: Extract<KbProperty, { type: "select" }>;
  canEdit: boolean;
  onChangeValue: (value: string | null) => void;
  onChangeOptions: (options: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commitAdd = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    if (property.options.includes(v)) {
      toast.warning("Такая опция уже есть");
      return;
    }
    onChangeOptions([...property.options, v]);
    onChangeValue(v);
    setDraft("");
    setAdding(false);
  };

  if (!canEdit) {
    return (
      <span className="text-[13px]">
        {property.value ?? "—"}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Select
        value={property.value ?? ""}
        onValueChange={(v) => onChangeValue(v === "__none__" ? null : v)}
      >
        <SelectTrigger className="h-7 w-auto min-w-[100px] max-w-[280px] text-[13px] border-transparent bg-transparent px-1 hover:border-input focus:border-input">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" className="text-muted-foreground">
            (не задано)
          </SelectItem>
          {property.options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {property.options.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground"
              aria-label="Управление опциями"
            >
              опции ({property.options.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            {property.options.map((o) => (
              <DropdownMenuItem
                key={o}
                onSelect={(e) => {
                  e.preventDefault();
                  const next = property.options.filter((x) => x !== o);
                  onChangeOptions(next);
                  if (property.value === o) onChangeValue(null);
                }}
              >
                <Trash2 className="size-3 text-destructive" />
                <span className="flex-1">{o}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setAdding(true);
              }}
            >
              <Plus className="size-3.5" /> добавить опцию
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {(adding || property.options.length === 0) && (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitAdd}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAdd();
            } else if (e.key === "Escape") {
              setAdding(false);
              setDraft("");
            }
          }}
          placeholder="новая опция"
          className="h-7 w-[140px] text-[13px]"
        />
      )}
    </div>
  );
}

