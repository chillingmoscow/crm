"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

/**
 * Мультисортировка списочных таблиц: несколько полей одновременно, порядок
 * полей значим и виден пользователю номерком у стрелки.
 *
 * Правило клика по заголовку одно на все таблицы: asc → desc → выключено.
 * Новое поле добавляется в конец, уже выбранные не сбрасывает.
 *
 * Раньше это было написано дважды — в списке актов и в итогах акта — почти
 * дословно, вплоть до вёрстки индикатора. Разъезжались молча: одинаковый
 * жест на двух экранах не обязан был давать одинаковый результат.
 *
 * Режимы сортировки у каждой таблицы свои (`date_desc`, `empty_first`, …),
 * поэтому кодек передаётся снаружи — хук знает только про поле и направление.
 */

export type SortDirection = "asc" | "desc";

export type SortCodec<Mode extends string, Field extends string> = {
  toField: (mode: Mode) => Field;
  toDirection: (mode: Mode) => SortDirection;
  combine: (field: Field, direction: SortDirection) => Mode;
};

export type MultiSort<Field extends string> = {
  cycleSort: (field: Field) => void;
  headerIndicator: (columnId: string) => ReactNode;
  headerAriaSort: (columnId: string) => "ascending" | "descending" | "none" | undefined;
  sortableColumnIds: Set<string>;
};

export function useMultiSort<Mode extends string, Field extends string>(input: {
  sorts: Mode[];
  onChange: (next: Mode[]) => void;
  /** id колонки → поле сортировки. Колонки вне карты не сортируются. */
  columnToField: Record<string, Field>;
  codec: SortCodec<Mode, Field>;
}): MultiSort<Field> {
  const { sorts, onChange, columnToField, codec } = input;

  const sortableColumnIds = useMemo(() => new Set(Object.keys(columnToField)), [columnToField]);

  const indexOfField = (field: Field | undefined) =>
    field == null ? -1 : sorts.findIndex((mode) => codec.toField(mode) === field);

  const cycleSort = (field: Field) => {
    const index = indexOfField(field);
    if (index < 0) {
      onChange([...sorts, codec.combine(field, "asc")]);
      return;
    }
    if (codec.toDirection(sorts[index]) === "asc") {
      const next = sorts.slice();
      next[index] = codec.combine(field, "desc");
      onChange(next);
      return;
    }
    onChange(sorts.filter((_, i) => i !== index));
  };

  const headerIndicator = (columnId: string): ReactNode => {
    const index = indexOfField(columnToField[columnId]);
    if (index < 0) return null;
    return (
      <span className="inline-flex items-center gap-0.5">
        {codec.toDirection(sorts[index]) === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )}
        {sorts.length > 1 ? <span className="text-[10px] tabular-nums">{index + 1}</span> : null}
      </span>
    );
  };

  // ascending/descending для активной колонки, none — для сортируемой, но
  // неотсортированной; undefined — для несортируемой (атрибута быть не должно).
  const headerAriaSort = (columnId: string): "ascending" | "descending" | "none" | undefined => {
    const field = columnToField[columnId];
    if (!field) return undefined;
    const index = indexOfField(field);
    if (index < 0) return "none";
    return codec.toDirection(sorts[index]) === "asc" ? "ascending" : "descending";
  };

  return { cycleSort, headerIndicator, headerAriaSort, sortableColumnIds };
}
