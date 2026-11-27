"use client";

import type { ReactNode } from "react";
import type { SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MotionPresence } from "@/components/shared/motion-presence";
import { pluralRu } from "@/lib/format/plural";
import { TableControlPin } from "./table-control-pin";
import { TableSortSettings } from "./table-sort-settings";

/**
 * Ряд условий списка (design-system § «List-страница»): сортировка →
 * разделитель → фильтры → поиск → «Очистить все». Правила видимости зашиты
 * здесь, чтобы списки их не повторяли:
 *
 * - ряд виден, если он открыт кнопкой фильтров, выбран фильтр или задана
 *   сортировка; один поиск ряд не открывает;
 * - выбранный фильтр виден всегда, даже если ряд свёрнут (за это отвечает
 *   вызывающий: рендерит чип при `open || value`);
 * - чип поиска появляется, только когда ряд уже виден по другой причине.
 */
export function TableConditions({
  label,
  open,
  hasFilters,
  sorting,
  onSortingChange,
  sortFields,
  sortLabels,
  search,
  onSearchClear,
  onReset,
  children,
}: {
  /** Подпись ряда для скринридера: «Условия списка сотрудников». */
  label: string;
  /** Ряд открыт кнопкой фильтров. */
  open: boolean;
  /** Выбран хотя бы один фильтр. */
  hasFilters: boolean;
  sorting: SortingState;
  onSortingChange: (next: SortingState) => void;
  sortFields: readonly string[];
  sortLabels: Record<string, string>;
  search?: string;
  onSearchClear?: () => void;
  /** Сбросить фильтры, поиск и сортировку. */
  onReset: () => void;
  /** Чипы фильтров. */
  children?: ReactNode;
}) {
  const hasSort = sorting.length > 0;
  const visible = open || hasFilters || hasSort;
  const q = search?.trim() ?? "";
  const showFilters = open || hasFilters;
  // Ряд условий плавно раскрывается и сворачивается (docs/motion.md), а не
  // появляется рывком; свёрнутый не занимает места.
  return (
    <div className="motion-expand" data-open={visible} aria-hidden={!visible || undefined}>
    <div>
    <div className="flex flex-wrap items-center gap-2 pb-0.5" aria-label={label}>
      {/* Каждый элемент ряда появляется и уходит плавно (docs/motion.md). */}
      <MotionPresence show={hasSort}>
        {sorting.length ? (
          <TableSortPin
            sorting={sorting}
            onChange={onSortingChange}
            fields={sortFields}
            labels={sortLabels}
          />
        ) : null}
      </MotionPresence>
      <MotionPresence show={hasSort && showFilters && !!children}>
        <span aria-hidden className="mx-1 h-5 w-px self-center bg-border" />
      </MotionPresence>
      <MotionPresence show={showFilters && !!children} className="gap-2">
        {children}
      </MotionPresence>
      <MotionPresence show={!!(q && onSearchClear)}>
        {q && onSearchClear ? <TableSearchPin value={q} onClear={onSearchClear} /> : null}
      </MotionPresence>
      <MotionPresence show={!!(hasFilters || q || hasSort)}>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onReset}
        >
          Очистить все
        </Button>
      </MotionPresence>
    </div>
    </div>
    </div>
  );
}

/** Пин сортировки: одна — стрелка и поле, несколько — «N сортировок». Есть сброс. */
export function TableSortPin({
  sorting,
  onChange,
  fields,
  labels,
}: {
  sorting: SortingState;
  onChange: (next: SortingState) => void;
  fields: readonly string[];
  labels: Record<string, string>;
}) {
  if (!sorting.length) return null;
  const single = sorting.length === 1 ? sorting[0] : null;
  return (
    <TableControlPin
      active
      label={
        single
          ? labels[single.id]
          : `${sorting.length} ${pluralRu(sorting.length, "сортировка", "сортировки", "сортировок")}`
      }
      icon={
        single ? single.desc ? <ArrowDown /> : <ArrowUp /> : <ArrowUpDown />
      }
      clearLabel="Сбросить сортировку"
      onClear={() => onChange([])}
      contentClassName="w-auto p-3"
    >
      <TableSortSettings
        sorting={sorting}
        onChange={onChange}
        fields={fields}
        labels={labels}
      />
    </TableControlPin>
  );
}

/** Чип активного поиска со сбросом. */
export function TableSearchPin({
  value,
  onClear,
}: {
  value: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex h-8 max-w-64 items-center gap-1 rounded-full border border-brand/20 bg-brand/10 pl-3 pr-1 text-sm text-brand">
      <span className="truncate">Поиск: «{value}»</span>
      <button
        type="button"
        aria-label="Сбросить поиск"
        onClick={onClear}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-brand/15"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
