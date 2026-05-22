"use client";

import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type ManagedTableColumn = {
  id: string;
  label: string;
  visible: boolean;
  canHide?: boolean;
  width?: number;
};

type TableColumnManagerProps = {
  columns: ManagedTableColumn[];
  onVisibilityChange: (columnId: string, visible: boolean) => void;
  onMoveColumn: (activeId: string, overId: string) => void;
  onReset: () => void;
};

export function TableColumnManager({
  columns,
  onVisibilityChange,
  onMoveColumn,
  onReset,
}: TableColumnManagerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onMoveColumn(String(active.id), String(over.id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Столбцы таблицы
        </div>
        {/* Подпись вместо иконки + Tooltip: Radix Popover автофокусит первый
            фокусируемый элемент, а Tooltip раскрывается по фокусу — из-за
            этого на тач-устройствах подсказка «Сбросить» всплывала при
            каждом открытии поповера. Текстовая кнопка убирает этот эффект. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs text-muted-foreground"
          onClick={onReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Сбросить
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={columns.map((column) => column.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {columns.map((column) => (
              <SortableColumnRow
                key={column.id}
                column={column}
                onVisibilityChange={onVisibilityChange}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="text-xs text-muted-foreground">
        Перетаскивайте строки, чтобы менять порядок колонок
      </div>
    </div>
  );
}

function SortableColumnRow({
  column,
  onVisibilityChange,
}: {
  column: ManagedTableColumn;
  onVisibilityChange: (columnId: string, visible: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={[
        "flex items-center gap-2 rounded-md border bg-background px-2 py-2 text-sm",
        isDragging ? "relative z-10 shadow-md" : "",
      ].join(" ")}
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground active:cursor-grabbing"
        aria-label={`Переместить ${column.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox
        checked={column.visible}
        disabled={column.canHide === false}
        onCheckedChange={(checked) => onVisibilityChange(column.id, Boolean(checked))}
        aria-label={`Показать ${column.label}`}
      />
      <span className="min-w-0 flex-1 truncate">{column.label}</span>
    </div>
  );
}
