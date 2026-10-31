"use client";

import { useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Plus, Trash2, XCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function TableSortPicker({
  sorting,
  onChange,
  fields,
  labels,
}: {
  fields: readonly string[];
  labels: Record<string, string>;
  sorting: SortingState;
  onChange: (next: SortingState) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      {fields.map((id) => {
        const used = sorting.some((s) => s.id === id);
        return (
          <button
            key={id}
            type="button"
            disabled={used}
            className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent disabled:bg-accent disabled:text-muted-foreground"
            onClick={() => onChange([...sorting, { id, desc: false }])}
          >
            <span>{labels[id]}</span>
            {used ? <span className="text-xs">Добавлено</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TableSortSettings({
  sorting,
  onChange,
  fields,
  labels,
}: {
  fields: readonly string[];
  labels: Record<string, string>;
  sorting: SortingState;
  onChange: (next: SortingState) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const unused = fields.filter((id) => !sorting.some((s) => s.id === id));
  const updateAt = (index: number, next: SortingState[number]) =>
    onChange(sorting.map((s, i) => (i === index ? next : s)));
  return (
    <div className="w-[min(420px,calc(100vw-3rem))] space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      <div className="space-y-2">
        {sorting.map((item, index) => (
          <div
            key={item.id}
            className="grid grid-cols-[1fr_72px_24px_32px] items-center gap-2"
          >
            <Select
              value={item.id}
              onValueChange={(id) => updateAt(index, { ...item, id })}
            >
              <SelectTrigger
                className="h-9"
                aria-label={`Поле сортировки ${index + 1}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map((id) => (
                  <SelectItem
                    key={id}
                    value={id}
                    disabled={sorting.some(
                      (s, i) => i !== index && s.id === id,
                    )}
                  >
                    {labels[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={item.desc ? "desc" : "asc"}
              onValueChange={(direction) =>
                updateAt(index, { ...item, desc: direction === "desc" })
              }
            >
              <SelectTrigger
                className="h-9 w-[72px] justify-center gap-1 px-2"
                aria-label={`Направление: ${labels[item.id]}`}
              >
                {item.desc ? (
                  <ArrowDown className="size-4" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">
                  <span className="inline-flex items-center gap-2">
                    <ArrowUp className="size-3.5" />
                    По возрастанию
                  </span>
                </SelectItem>
                <SelectItem value="desc">
                  <span className="inline-flex items-center gap-2">
                    <ArrowDown className="size-3.5" />
                    По убыванию
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              disabled={!index}
              aria-label={`Повысить приоритет: ${labels[item.id]}`}
              onClick={() => {
                const next = [...sorting];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange(next);
              }}
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label={`Удалить сортировку: ${labels[item.id]}`}
              onClick={() => onChange(sorting.filter((_, i) => i !== index))}
            >
              <XCircle className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      {showAdd && unused.length > 0 ? (
        <div className="rounded-lg border bg-background p-2">
          {unused.map((id) => (
            <button
              key={id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange([...sorting, { id, desc: false }]);
                setShowAdd(false);
              }}
            >
              <ArrowUp className="size-4 text-muted-foreground" />
              {labels[id]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="space-y-1 border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          disabled={!unused.length}
          onClick={() => setShowAdd((v) => !v)}
        >
          <Plus className="size-4" />
          Добавить сортировку
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
          onClick={() => onChange([])}
        >
          <Trash2 className="size-4" />
          Удалить сортировку
        </Button>
      </div>
    </div>
  );
}
