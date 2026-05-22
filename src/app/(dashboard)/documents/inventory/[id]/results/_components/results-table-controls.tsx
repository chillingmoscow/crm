"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  RESULT_RECOUNT_LABEL,
  RESULT_SORT_FIELDS,
  RESULT_SORT_FIELD_LABEL,
  RESULT_STATUS_LABEL,
  combineResultSort,
  resultSortToDirection,
  resultSortToField,
  type ResultRecountFilter,
  type ResultSortField,
  type ResultSortMode,
  type ResultStatusFilter,
} from "./results-table-utils";

export function ResultPinDivider() {
  return <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
}

/**
 * Popover из sort-кнопки в шапке. Список полей; клик на свободном — APPEND
 * с asc, уже добавленные показывают «Добавлено».
 */
export function ResultSortFieldPanel({
  sorts,
  onChange,
}: {
  sorts: ResultSortMode[];
  onChange: (next: ResultSortMode[]) => void;
}) {
  const usedFields = new Set(sorts.map((mode) => resultSortToField(mode)));
  return (
    <div className="space-y-3">
      <p className="px-3 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      <div className="space-y-1">
        {RESULT_SORT_FIELDS.map((field) => {
          const used = usedFields.has(field);
          return (
            <button
              key={field}
              type="button"
              onClick={() => {
                if (used) return;
                onChange([...sorts, combineResultSort(field, "asc")]);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
                used ? "bg-accent text-muted-foreground" : null,
              )}
            >
              <span>{RESULT_SORT_FIELD_LABEL[field]}</span>
              {used ? <span className="text-xs">Добавлено</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Контент активного sort-pin: строки field-Select + direction-Select + ×. */
export function ResultSortPinEditor({
  sorts,
  onChange,
}: {
  sorts: ResultSortMode[];
  onChange: (next: ResultSortMode[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const unusedFields = RESULT_SORT_FIELDS.filter(
    (field) => !sorts.some((mode) => resultSortToField(mode) === field),
  );

  const updateAt = (index: number, next: ResultSortMode) => {
    onChange(sorts.map((mode, i) => (i === index ? next : mode)));
  };
  const replaceField = (index: number, field: ResultSortField) => {
    updateAt(index, combineResultSort(field, resultSortToDirection(sorts[index])));
  };
  const removeAt = (index: number) => onChange(sorts.filter((_, i) => i !== index));

  return (
    <div className="w-[min(420px,calc(100vw-3rem))] space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Сортировка</p>
      <div className="space-y-2">
        {sorts.map((mode, index) => {
          const field = resultSortToField(mode);
          const direction = resultSortToDirection(mode);
          return (
            <div key={`${field}-${index}`} className="grid grid-cols-[1fr_72px_32px] items-center gap-2">
              <Select value={field} onValueChange={(value) => replaceField(index, value as ResultSortField)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESULT_SORT_FIELDS.map((option) => {
                    const disabled = sorts.some(
                      (other, otherIndex) => otherIndex !== index && resultSortToField(other) === option,
                    );
                    return (
                      <SelectItem key={option} value={option} disabled={disabled}>
                        {RESULT_SORT_FIELD_LABEL[option]}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Select
                value={direction}
                onValueChange={(value) => updateAt(index, combineResultSort(field, value as "asc" | "desc"))}
              >
                <SelectTrigger
                  className="h-9 w-[72px] justify-center gap-1 px-2"
                  aria-label={direction === "asc" ? "По возрастанию" : "По убыванию"}
                >
                  {direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
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
        <div className="rounded-lg border bg-card p-2">
          {unusedFields.map((field) => (
            <button
              key={field}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange([...sorts, combineResultSort(field, "asc")]);
                setShowAdd(false);
              }}
            >
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              {RESULT_SORT_FIELD_LABEL[field]}
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

export function ResultGroupPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; name: string }>;
  onChange: (groupId: string) => void;
}) {
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      <button
        type="button"
        onClick={() => onChange("all")}
        className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
      >
        <span className="truncate">Все группы</span>
        {value === "all" ? <Check className="h-4 w-4 shrink-0" /> : null}
      </button>
      {options.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => onChange(group.id)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">{group.name}</span>
          {value === group.id ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}

export function ResultStatusPicker({
  value,
  onChange,
}: {
  value: ResultStatusFilter;
  onChange: (next: ResultStatusFilter) => void;
}) {
  const options: ResultStatusFilter[] = ["all", "included", "excluded", "resort"];
  return (
    <div className="space-y-0.5 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">{RESULT_STATUS_LABEL[option]}</span>
          {value === option ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}

export function ResultRecountPicker({
  value,
  onChange,
}: {
  value: ResultRecountFilter;
  onChange: (next: ResultRecountFilter) => void;
}) {
  const options: ResultRecountFilter[] = ["all", "flagged", "clear"];
  return (
    <div className="space-y-0.5 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">{RESULT_RECOUNT_LABEL[option]}</span>
          {value === option ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}
