"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { INVENTORY_STATUS_LABEL } from "@/components/shared/inventory-status-badge";
import {
  DOCUMENT_STATUSES,
  type DocumentSortMode,
  type DocumentStatus,
} from "@/lib/inventory/list-documents-shared";

import type { AssigneeOption } from "./assignee-select";
import {
  SORT_FIELDS,
  SORT_FIELD_LABEL,
  combineSort,
  sortToDirection,
  sortToField,
  type SortField,
  type StoreOption,
  type VenueOption,
} from "./documents-table-utils";

const STATUS_LABEL = INVENTORY_STATUS_LABEL as Record<DocumentStatus, string>;

export function PinDivider() {
  return <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
}

// ─── Pin labels ──────────────────────────────────────────────────────────────

export function venuePinLabel(venue: string | undefined, venues: VenueOption[]): string {
  if (!venue || venue === "all") return "Заведения";
  if (venue === "unassigned") return "Не распределённые";
  return venues.find((v) => v.id === venue)?.name ?? "Заведения";
}

export function statusPinLabel(status: DocumentStatus[] | undefined): string {
  if (!status || status.length === 0) return "Статус";
  if (status.length === 1) return STATUS_LABEL[status[0]];
  return `Статус: ${status.length}`;
}

export function assigneePinLabel(assigned: string | undefined, staff: AssigneeOption[]): string {
  if (!assigned || assigned === "any") return "Исполнитель";
  if (assigned === "me") return "На меня";
  if (assigned === "none") return "Без назначения";
  return staff.find((s) => s.id === assigned)?.name ?? "Исполнитель";
}

export function reviewerPinLabel(reviewer: string | undefined, staff: AssigneeOption[]): string {
  if (!reviewer || reviewer === "any") return "Проверяющий";
  if (reviewer === "me") return "Проверяю я";
  if (reviewer === "none") return "Без проверяющего";
  return staff.find((s) => s.id === reviewer)?.name ?? "Проверяющий";
}

export function storePinLabel(store: string[] | undefined, stores: StoreOption[]): string {
  if (!store || store.length === 0) return "Склад";
  if (store.length === 1) return stores.find((s) => s.id === store[0])?.title ?? "Склад";
  return `Склад: ${store.length}`;
}

// ─── Pickers ─────────────────────────────────────────────────────────────────

export function VenuePicker({
  value,
  venues,
  onChange,
}: {
  value: string;
  venues: VenueOption[];
  onChange: (v: string) => void;
}) {
  const options = [
    { value: "all", label: "Все заведения" },
    { value: "unassigned", label: "Не распределённые" },
    ...venues.map((v) => ({ value: v.id, label: v.name })),
  ];
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            opt.value === value ? "bg-accent" : null,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function StatusPicker({
  value,
  onToggle,
}: {
  value: DocumentStatus[];
  onToggle: (s: DocumentStatus) => void;
}) {
  const selected = new Set(value);
  return (
    <div className="space-y-0.5 p-1">
      {DOCUMENT_STATUSES.map((status) => (
        <label
          key={status}
          className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent cursor-pointer"
        >
          <Checkbox checked={selected.has(status)} onCheckedChange={() => onToggle(status)} />
          <span>{STATUS_LABEL[status]}</span>
        </label>
      ))}
    </div>
  );
}

export function StorePicker({
  value,
  stores,
  onToggle,
}: {
  value: string[];
  stores: StoreOption[];
  onToggle: (id: string) => void;
}) {
  const selected = new Set(value);
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {stores.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">Складов нет</div>
      ) : (
        stores.map((store) => (
          <label
            key={store.id}
            className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent cursor-pointer"
          >
            <Checkbox
              checked={selected.has(store.id)}
              onCheckedChange={() => onToggle(store.id)}
            />
            <span className="truncate">{store.title}</span>
          </label>
        ))
      )}
    </div>
  );
}

export function AssignedPicker({
  value,
  staff,
  onChange,
}: {
  value: string;
  staff: AssigneeOption[];
  onChange: (v: string) => void;
}) {
  const options = [
    { value: "any",  label: "Любой исполнитель" },
    { value: "me",   label: "На меня" },
    { value: "none", label: "Без назначения" },
    ...staff.map((s) => ({ value: s.id, label: s.name })),
  ];
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            opt.value === value ? "bg-accent" : null,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ReviewerPicker({
  value,
  staff,
  onChange,
}: {
  value: string;
  staff: AssigneeOption[];
  onChange: (v: string) => void;
}) {
  const options = [
    { value: "any",  label: "Любой проверяющий" },
    { value: "me",   label: "Проверяю я" },
    { value: "none", label: "Без проверяющего" },
    ...staff.map((s) => ({ value: s.id, label: s.name })),
  ];
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            opt.value === value ? "bg-accent" : null,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Popover из шапки таблицы (TableControls.sort.content). Эталон:
 * SortFieldPanel в dev/table-lab. Один список полей; клик на поле,
 * которого ещё нет в сортировке — APPEND с направлением asc.
 * Поле, которое уже в сортировке, помечается «Добавлено».
 */
export function SortFieldPanel({
  sorts,
  onChange,
}: {
  sorts: DocumentSortMode[];
  onChange: (next: DocumentSortMode[]) => void;
}) {
  const usedFields = new Set(sorts.map((mode) => sortToField(mode)));
  return (
    <div className="space-y-3">
      <p className="px-3 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      <div className="space-y-1">
        {SORT_FIELDS.map((field) => {
          const used = usedFields.has(field);
          return (
            <button
              key={field}
              type="button"
              onClick={() => {
                if (used) return;
                onChange([...sorts, combineSort(field, "asc")]);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
                used ? "bg-accent text-muted-foreground" : null,
              )}
            >
              <span>{SORT_FIELD_LABEL[field]}</span>
              {used ? <span className="text-xs">Добавлено</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Содержимое пина активной сортировки. Эталон: SortPinEditor в
 * dev/table-lab. Каждая сортировка — строка с field-select +
 * direction-select + крестик. Кнопки: «Добавить сортировку» (список
 * неиспользованных полей) и «Удалить сортировку» (всё).
 */
export function SortPinEditor({
  sorts,
  onChange,
}: {
  sorts: DocumentSortMode[];
  onChange: (next: DocumentSortMode[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);

  const unusedFields = SORT_FIELDS.filter(
    (field) => !sorts.some((mode) => sortToField(mode) === field),
  );

  const updateAt = (index: number, next: DocumentSortMode) => {
    onChange(sorts.map((mode, i) => (i === index ? next : mode)));
  };

  const replaceField = (index: number, field: SortField) => {
    const currentDirection = sortToDirection(sorts[index]);
    updateAt(index, combineSort(field, currentDirection));
  };

  const removeAt = (index: number) => {
    onChange(sorts.filter((_, i) => i !== index));
  };

  return (
    <div className="w-[min(420px,calc(100vw-3rem))] space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>

      <div className="space-y-2">
        {sorts.map((mode, index) => {
          const field = sortToField(mode);
          const direction = sortToDirection(mode);
          return (
            <div key={`${field}-${index}`} className="grid grid-cols-[1fr_72px_32px] items-center gap-2">
              <Select value={field} onValueChange={(value) => replaceField(index, value as SortField)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_FIELDS.map((option) => {
                    const disabled = sorts.some(
                      (other, otherIndex) => otherIndex !== index && sortToField(other) === option,
                    );
                    return (
                      <SelectItem key={option} value={option} disabled={disabled}>
                        {SORT_FIELD_LABEL[option]}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              <Select
                value={direction}
                onValueChange={(value) => updateAt(index, combineSort(field, value as "asc" | "desc"))}
              >
                <SelectTrigger
                  className="h-9 w-[72px] justify-center gap-1 px-2"
                  aria-label={direction === "asc" ? "По возрастанию" : "По убыванию"}
                >
                  {direction === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">
                    <span className="inline-flex items-center gap-2">
                      <ArrowUp className="h-3.5 w-3.5" /> По возрастанию
                    </span>
                  </SelectItem>
                  <SelectItem value="desc">
                    <span className="inline-flex items-center gap-2">
                      <ArrowDown className="h-3.5 w-3.5" /> По убыванию
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => removeAt(index)}
                aria-label="Удалить сортировку"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>

      {showAdd && unusedFields.length > 0 ? (
        <div className="rounded-lg border bg-background p-2">
          {unusedFields.map((field) => (
            <button
              key={field}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange([...sorts, combineSort(field, "asc")]);
                setShowAdd(false);
              }}
            >
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              {SORT_FIELD_LABEL[field]}
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
          disabled={unusedFields.length === 0}
          onClick={() => setShowAdd((current) => !current)}
        >
          <Plus className="h-4 w-4" />
          Добавить сортировку
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
          onClick={() => onChange([])}
        >
          <Trash2 className="h-4 w-4" />
          Удалить сортировку
        </Button>
      </div>
    </div>
  );
}
