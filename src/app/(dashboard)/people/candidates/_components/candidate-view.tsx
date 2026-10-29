"use client";
import { useEffect, useState } from "react";
import { Eye, LayoutGrid, List, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TableColumnManager, useTableState } from "@/components/shared/table";
import type { Candidate } from "@/lib/candidates/types";
import { FieldSelect, dateLabel, plural } from "./fields";

export const FIELD_LABELS = {
  full_name: "Кандидат",
  photo: "Фотография",
  desired_position: "Должность",
  status: "Статус",
  phone: "Телефон",
  submitted_at: "Дата заявки",
  age: "Возраст",
  salary_expectation: "Ожидания по зарплате",
  address: "Адрес",
  experience: "Опыт работы",
  education: "Образование",
} as const;
export type CandidateField = keyof typeof FIELD_LABELS;
const boardFields: CandidateField[] = [
  "photo",
  "desired_position",
  "age",
  "salary_expectation",
  "submitted_at",
  "phone",
  "address",
  "experience",
  "education",
];
const listFields: CandidateField[] = [
  "full_name",
  "desired_position",
  "status",
  "phone",
  "submitted_at",
  "photo",
  "age",
  "salary_expectation",
  "address",
  "experience",
  "education",
];
const boardColumns = boardFields.map((id) => ({
  id,
  defaultVisible: !["phone", "address", "experience", "education"].includes(id),
}));
const listColumns = listFields.map((id) => ({
  id,
  defaultVisible: [
    "full_name",
    "desired_position",
    "status",
    "phone",
    "submitted_at",
  ].includes(id),
}));

export function useCandidateView(key: string) {
  const [view, changeView] = useState<"board" | "table">("board");
  const storageKey = `sheerly.candidates.view.${key}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "board" || saved === "table") changeView(saved);
    } catch {
      /* preferences are optional */
    }
  }, [storageKey]);
  const board = useTableState({
    tableId: `candidates.cards.${key}`,
    columns: boardColumns,
    defaultPageSize: 5,
  });
  const table = useTableState({
    tableId: `candidates.list.${key}`,
    columns: listColumns,
    defaultPageSize: 25,
  });
  const setView = (next: "board" | "table") => {
    changeView(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* keep the selected view for this session */
    }
  };
  const visibleCards = boardFields.filter(
    (id) => board.columnVisibility[id] !== false,
  );
  const visibleColumns = table.columnOrder.filter(
    (id): id is CandidateField =>
      listFields.includes(id as CandidateField) &&
      (id === "full_name" || table.columnVisibility[id] !== false),
  );
  return {
    view,
    setView,
    board,
    table,
    visibleCards,
    visibleColumns,
    boardPageSize: [5, 10, 20].includes(board.pagination.pageSize)
      ? board.pagination.pageSize
      : 5,
    listPageSize: [25, 50, 100].includes(table.pagination.pageSize)
      ? table.pagination.pageSize
      : 25,
  };
}
export type CandidateViewState = ReturnType<typeof useCandidateView>;

export function CandidateViewMenu({ state }: { state: CandidateViewState }) {
  const isBoard = state.view === "board";
  const move = (active: string, over: string) =>
    state.table.setColumnOrder((order) => {
      const next = [...order],
        from = next.indexOf(active),
        to = next.indexOf(over);
      if (from < 0 || to < 0) return order;
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          aria-label="Вид"
        >
          <Eye className="size-4" />
          Вид
          <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 p-4">
        <div
          className="grid grid-cols-2 gap-2"
          aria-label="Представление кандидатов"
        >
          <Button
            size="sm"
            variant={isBoard ? "secondary" : "outline"}
            aria-pressed={isBoard}
            onClick={() => state.setView("board")}
          >
            <LayoutGrid className="mr-2 size-4" />
            Доска
          </Button>
          <Button
            size="sm"
            variant={!isBoard ? "secondary" : "outline"}
            aria-pressed={!isBoard}
            onClick={() => state.setView("table")}
          >
            <List className="mr-2 size-4" />
            Список
          </Button>
        </div>
        {isBoard ? (
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Поля на карточке</h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={state.board.resetColumns}
              >
                Сбросить
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Имя кандидата показывается всегда.
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {boardFields.map((id) => (
                <label
                  key={id}
                  className="flex min-h-8 items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={state.board.columnVisibility[id] !== false}
                    aria-label={`Показать на карточке: ${FIELD_LABELS[id]}`}
                    onCheckedChange={(value) =>
                      state.board.setColumnVisibility((current) => ({
                        ...current,
                        [id]: value === true,
                      }))
                    }
                  />
                  {FIELD_LABELS[id]}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-t pt-3">
            <TableColumnManager
              columns={state.table.columnOrder
                .filter((id) => listFields.includes(id as CandidateField))
                .map((id) => ({
                  id,
                  label: FIELD_LABELS[id as CandidateField],
                  visible:
                    id === "full_name" ||
                    state.table.columnVisibility[id] !== false,
                  canHide: id !== "full_name",
                }))}
              onVisibilityChange={(id, visible) =>
                state.table.setColumnVisibility((current) => ({
                  ...current,
                  [id]: id === "full_name" || visible,
                }))
              }
              onMoveColumn={move}
              onReset={state.table.resetColumns}
            />
          </div>
        )}
        <div className="border-t pt-3">
          <FieldSelect
            label={isBoard ? "Карточек в столбце" : "Строк на странице"}
            value={String(isBoard ? state.boardPageSize : state.listPageSize)}
            onChange={(value) =>
              (isBoard ? state.board.setPagination : state.table.setPagination)(
                { pageIndex: 0, pageSize: Number(value) },
              )
            }
            options={(isBoard ? [5, 10, 20] : [25, 50, 100]).map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function candidateFieldText(
  candidate: Candidate,
  field: CandidateField,
) {
  if (field === "submitted_at") return dateLabel(candidate.submitted_at);
  if (field === "age")
    return candidate.age
      ? `${candidate.age} ${plural(candidate.age, ["год", "года", "лет"])}`
      : "Не указан";
  if (field === "photo" || field === "status") return "";
  const value = candidate[field];
  return value === null || value === "" ? "Не указано" : String(value);
}
