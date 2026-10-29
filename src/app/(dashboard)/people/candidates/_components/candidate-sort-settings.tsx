"use client";

import type { SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CANDIDATE_SORT_FIELDS } from "@/lib/candidates/types";
import { FIELD_LABELS, type CandidateField } from "./candidate-table";

export function CandidateSortSettings({
  sorting,
  onChange,
}: {
  sorting: SortingState;
  onChange: (next: SortingState) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm font-medium">
        Сортировка
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onChange([])}
        >
          Сбросить
        </Button>
      </div>
      {sorting.map((item, index) => (
        <div
          key={item.id}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
        >
          <span className="w-4 text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {FIELD_LABELS[item.id as CandidateField]}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={`Изменить направление: ${FIELD_LABELS[item.id as CandidateField]}`}
            onClick={() =>
              onChange(
                sorting.map((s) =>
                  s.id === item.id ? { ...s, desc: !s.desc } : s,
                ),
              )
            }
          >
            {item.desc ? (
              <ArrowDown className="size-3.5" />
            ) : (
              <ArrowUp className="size-3.5" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!index}
            aria-label={`Повысить приоритет: ${FIELD_LABELS[item.id as CandidateField]}`}
            onClick={() => {
              const next = [...sorting];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              onChange(next);
            }}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={`Убрать сортировку: ${FIELD_LABELS[item.id as CandidateField]}`}
            onClick={() => onChange(sorting.filter((s) => s.id !== item.id))}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <select
        aria-label="Добавить уровень сортировки"
        className="w-full rounded-md border bg-background p-2 text-sm"
        value=""
        onChange={(e) => {
          if (e.target.value)
            onChange([...sorting, { id: e.target.value, desc: false }]);
        }}
      >
        <option value="">Добавить уровень…</option>
        {CANDIDATE_SORT_FIELDS.filter(
          (id) => !sorting.some((s) => s.id === id),
        ).map((id) => (
          <option key={id} value={id}>
            {FIELD_LABELS[id]}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Клик по заголовку: по возрастанию, по убыванию, без сортировки.
        Несколько полей применяются по порядку.
      </p>
    </div>
  );
}
