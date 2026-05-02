"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type MultiSelectItem = {
  id: string;
  name: string;
  groupId?: string | null;
  /** Pinned at top, no group label (used for «Без статьи»/«Без контрагента»). */
  special?: boolean;
};

export type MultiSelectGroup = { id: string; name: string };

type Props = {
  placeholder: string;
  items: MultiSelectItem[];
  groups?: MultiSelectGroup[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

const ITEM_HEIGHT = 32;
const VISIBLE_HEIGHT = 240;
const VIRTUALIZE_THRESHOLD = 100;
const OVERSCAN = 4;

/**
 * Pill-style multi-select filter chip + popover with grouped, searchable
 * options and windowed list for groups beyond ~100 items. Active state
 * uses the brand-blue palette to match the design's filter chips.
 */
export function MultiSelectFilter({
  placeholder,
  items,
  groups = [],
  selectedIds,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase().trim();
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, query]);

  const grouped = useMemo(() => {
    const special = filtered.filter((i) => i.special);
    const regular = filtered.filter((i) => !i.special);

    if (groups.length === 0) {
      return {
        special,
        sections: [{ id: "__all__", name: "", items: sortItems(regular) }],
      };
    }

    const sortedGroups = [...groups].sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    );
    const sections: { id: string; name: string; items: MultiSelectItem[] }[] = [];
    for (const g of sortedGroups) {
      const gi = regular.filter((i) => i.groupId === g.id);
      if (gi.length > 0) sections.push({ id: g.id, name: g.name, items: sortItems(gi) });
    }
    const ungrouped = regular.filter((i) => !i.groupId);
    if (ungrouped.length > 0) {
      sections.push({ id: "__ungrouped__", name: "", items: sortItems(ungrouped) });
    }
    return { special, sections };
  }, [filtered, groups]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const buttonText = useMemo(() => {
    if (selectedIds.length === 0) return placeholder;
    if (selectedIds.length === 1) {
      return items.find((i) => i.id === selectedIds[0])?.name ?? placeholder;
    }
    // Match design's "+1" / "+2" suffix on first item label.
    const first = items.find((i) => i.id === selectedIds[0])?.name ?? placeholder;
    const extras = selectedIds.length - 1;
    return `${first} +${extras}`;
  }, [selectedIds, items, placeholder]);

  const hasSelection = selectedIds.length > 0;

  const toggleItem = (id: string) => {
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };

  const toggleGroup = (groupItems: MultiSelectItem[]) => {
    const ids = groupItems.map((i) => i.id);
    const allSelected = ids.every((id) => selectedSet.has(id));
    if (allSelected) onChange(selectedIds.filter((id) => !ids.includes(id)));
    else onChange(Array.from(new Set([...selectedIds, ...ids])));
  };

  const clearAll = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange([]);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setQuery(""); }}>
      <div className="relative inline-flex">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "rounded-full h-8 pl-3 pr-8 font-normal text-sm",
              hasSelection
                ? "bg-brand/10 border-brand/20 text-brand hover:bg-brand/15 hover:text-brand"
                : "bg-muted/60 border-transparent text-muted-foreground hover:bg-muted"
            )}
          >
            <span className="truncate max-w-[180px]">{buttonText}</span>
            {!hasSelection && <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />}
          </Button>
        </PopoverTrigger>
        {hasSelection && (
          <button
            type="button"
            onClick={clearAll}
            aria-label="Сбросить фильтр"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <PopoverContent align="start" className="w-[320px] p-0">
        <div className="p-3 border-b space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Поиск по ${placeholder.toLowerCase()}…`}
              className="pl-8 h-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange(items.filter((i) => !i.special).map((i) => i.id))}
              className="text-xs px-2 py-0.5 rounded-full border border-border hover:bg-accent"
            >
              Выбрать все
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs px-2 py-0.5 rounded-full border border-border hover:bg-accent"
            >
              Снять все
            </button>
          </div>
        </div>

        <div className="max-h-[300px] overflow-y-auto p-2">
          {grouped.special.length > 0 && (
            <>
              <div className="space-y-0.5">
                {grouped.special.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    checked={selectedSet.has(it.id)}
                    onToggle={() => toggleItem(it.id)}
                  />
                ))}
              </div>
              {grouped.sections.length > 0 && <Separator className="my-2" />}
            </>
          )}

          {grouped.sections.map((sec, idx) => {
            const ids = sec.items.map((i) => i.id);
            const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));
            const partial = !allSelected && ids.some((id) => selectedSet.has(id));
            const showHeader = sec.name.length > 0;
            return (
              <div key={sec.id}>
                {showHeader && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(sec.items)}
                    className="flex items-center gap-2 w-full px-1 py-1 rounded hover:bg-accent/40 text-left"
                  >
                    <Checkbox
                      checked={allSelected ? true : partial ? "indeterminate" : false}
                      tabIndex={-1}
                      className="pointer-events-none data-[state=checked]:bg-brand data-[state=checked]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:border-brand"
                    />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {sec.name}
                    </span>
                  </button>
                )}
                <div className={cn("space-y-0.5", showHeader && "pl-5")}>
                  {sec.items.length > VIRTUALIZE_THRESHOLD ? (
                    <VirtualList
                      items={sec.items}
                      renderItem={(it) => (
                        <ItemRow
                          key={it.id}
                          item={it}
                          checked={selectedSet.has(it.id)}
                          onToggle={() => toggleItem(it.id)}
                        />
                      )}
                    />
                  ) : (
                    sec.items.map((it) => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        checked={selectedSet.has(it.id)}
                        onToggle={() => toggleItem(it.id)}
                      />
                    ))
                  )}
                </div>
                {idx < grouped.sections.length - 1 && groups.length > 0 && (
                  <Separator className="my-2" />
                )}
              </div>
            );
          })}

          {grouped.special.length === 0 && grouped.sections.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Ничего не найдено
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function sortItems(items: MultiSelectItem[]): MultiSelectItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function ItemRow({
  item,
  checked,
  onToggle,
}: {
  item: MultiSelectItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 w-full px-1.5 py-1 rounded hover:bg-accent/60 text-left"
    >
      <Checkbox
        checked={checked}
        tabIndex={-1}
        className="pointer-events-none data-[state=checked]:bg-brand data-[state=checked]:border-brand"
      />
      <span className="text-sm truncate flex-1">{item.name}</span>
    </button>
  );
}

function VirtualList({
  items,
  renderItem,
}: {
  items: MultiSelectItem[];
  renderItem: (item: MultiSelectItem, index: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + VISIBLE_HEIGHT) / ITEM_HEIGHT) + OVERSCAN
  );
  const offsetY = startIndex * ITEM_HEIGHT;
  const slice = items.slice(startIndex, endIndex);

  return (
    <div
      ref={ref}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ height: VISIBLE_HEIGHT }}
      className="overflow-y-auto relative"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}>
          {slice.map((it, i) => renderItem(it, startIndex + i))}
        </div>
      </div>
    </div>
  );
}
