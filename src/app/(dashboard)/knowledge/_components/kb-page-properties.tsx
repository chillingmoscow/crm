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
  Copy,
  Replace,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

// Notion-style пастельная палитра для select-options. Цвет назначается
// per-option детерминированно через хэш строки — стабилен при reorder'е,
// одна и та же опция всегда красится одинаково. Tailwind class'ы
// инлайним парами (bg + text), чтобы JIT их подхватил без safelist'а.
const OPTION_COLOR_CLASSES = [
  "bg-stone-100 text-stone-700 dark:bg-stone-800/60 dark:text-stone-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200",
  "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-200",
  "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200",
  "bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-200",
];

function colorForOption(value: string): string {
  // FNV-ish 32-bit hash. Стабилен между сессиями и устройствами —
  // мы не хотим, чтобы один и тот же «Высокий приоритет» красился по-
  // разному в разных вкладках.
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OPTION_COLOR_CLASSES[Math.abs(h) % OPTION_COLOR_CLASSES.length];
}

/** Цветной chip для select-option (как в Notion). Цвет детерминированный
 *  по хэшу `value` — стабилен при reorder и одинаков везде, где опция
 *  появляется (trigger / list / management dropdown). */
function OptionChip({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[12.5px] font-medium leading-tight max-w-full",
        colorForOption(value),
        className,
      )}
    >
      <span className="truncate">{value}</span>
    </span>
  );
}

const SAVE_DEBOUNCE_MS = 1500;

/** Создаёт пустое property указанного типа с дефолтным `name`.
 *  Default name = label типа («Текст» / «Число» / …) — без префикса
 *  «Свойство»; юзер сразу переименовывает в осмысленное. */
function makeProperty(type: KbPropertyType, name?: string): KbProperty {
  const id = nanoid(8);
  const baseName = name ?? TYPE_LABELS[type];
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(initialProperties));

  // Debounced save: каждое изменение reset'ит таймер на 1.5s.
  const scheduleSave = (next: KbProperty[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave(next);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushSave = async (next: KbProperty[]) => {
    const serialized = JSON.stringify(next);
    if (serialized === lastSavedRef.current) return;
    const action =
      mode === "page" ? saveKbPageProperties : saveKbTemplateProperties;
    const payload =
      mode === "page"
        ? { pageId: targetId, properties: next }
        : { templateId: targetId, properties: next };
    const { error } = await action(payload as never);
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

  // Дублирует property: новый id + " (копия)" к имени, value/options
  // копируются 1-в-1. Inserted сразу после оригинала.
  const duplicateProperty = (id: string) => {
    setProperties((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const orig = prev[idx];
      const copy = { ...orig, id: nanoid(8), name: `${orig.name} (копия)` };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      scheduleSave(next);
      return next;
    });
  };

  // Меняет тип property: id и name сохраняются, value сбрасывается на
  // дефолт нового типа, options стираются (если был select). Конверсия
  // value между типами сложная и lossy — проще явно reset.
  const changePropertyType = (id: string, newType: KbPropertyType) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id) return p;
        if (p.type === newType) return p;
        const fresh = makeProperty(newType, p.name);
        return { ...fresh, id: p.id };
      });
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
              onDuplicate={() => duplicateProperty(prop.id)}
              onChangeType={(t) => changePropertyType(prop.id, t)}
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
                <Plus className="size-3.5" /> Добавить свойство
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
  onDuplicate: () => void;
  onChangeType: (type: KbPropertyType) => void;
}

function PropertyRow({
  property,
  canEdit,
  onRename,
  onChangeValue,
  onChangeOptions,
  onRemove,
  onDuplicate,
  onChangeType,
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
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Replace className="size-3.5 text-muted-foreground" />
                Изменить тип
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[160px]">
                {(Object.keys(TYPE_LABELS) as KbPropertyType[]).map((t) => {
                  const TIcon = TYPE_ICONS[t];
                  const isCurrent = t === property.type;
                  return (
                    <DropdownMenuItem
                      key={t}
                      disabled={isCurrent}
                      onSelect={() => onChangeType(t)}
                    >
                      <TIcon className="size-3.5 text-muted-foreground" />
                      {TYPE_LABELS[t]}
                      {isCurrent && (
                        <span className="ml-auto text-[11px] text-muted-foreground/60">
                          текущий
                        </span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy className="size-3.5 text-muted-foreground" />
              Дублировать
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
        <TextValueControl
          value={property.value}
          onChange={onChangeValue}
        />
      ) : (
        <span className="text-[13px] whitespace-pre-wrap break-words">
          {property.value || "—"}
        </span>
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

/** Текстовое значение property: textarea, растущая по содержимому
 *  (как title в KbPageEditor). Enter не блокируем — длинные значения
 *  могут содержать переносы. Без border / bg по дефолту, чтобы плавно
 *  жить рядом с другими value-control'ами; рамка появляется на hover/
 *  focus. */
function TextValueControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: на каждом изменении сбрасываем height в auto и выставляем
  // в scrollHeight. Сброс нужен иначе scrollHeight «зависает» на
  // максимальной достигнутой высоте и не сжимается обратно при удалении.
  const resize = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      placeholder="—"
      className="w-full bg-transparent text-[13px] outline-none resize-none overflow-hidden
                 leading-snug placeholder:text-muted-foreground/50
                 border border-transparent rounded px-1 -mx-1
                 hover:border-input focus:border-input transition-colors"
    />
  );
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
    return property.value ? (
      <OptionChip value={property.value} />
    ) : (
      <span className="text-[13px] text-muted-foreground/50">—</span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Select
        value={property.value ?? ""}
        onValueChange={(v) => onChangeValue(v === "__none__" ? null : v)}
      >
        <SelectTrigger
          className="h-7 w-auto min-w-[100px] max-w-[280px] text-[13px] border-transparent bg-transparent px-1
                     hover:border-input focus:border-input
                     [&>svg]:opacity-50 hover:[&>svg]:opacity-100"
        >
          {property.value ? (
            <OptionChip value={property.value} />
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </SelectTrigger>
        <SelectContent className="max-w-[320px]">
          <SelectItem value="__none__" className="text-muted-foreground">
            (не задано)
          </SelectItem>
          {property.options.map((o) => (
            <SelectItem key={o} value={o} className="py-1.5">
              <OptionChip value={o} />
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
          <DropdownMenuContent align="start" className="min-w-[220px]">
            {property.options.map((o) => (
              <DropdownMenuItem
                key={o}
                onSelect={(e) => {
                  e.preventDefault();
                  const next = property.options.filter((x) => x !== o);
                  onChangeOptions(next);
                  if (property.value === o) onChangeValue(null);
                }}
                className="group/opt gap-2"
              >
                <OptionChip value={o} className="flex-1" />
                <X className="size-3 shrink-0 text-muted-foreground/50 group-hover/opt:text-destructive" />
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

