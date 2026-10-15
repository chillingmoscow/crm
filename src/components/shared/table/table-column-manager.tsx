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
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 whitespace-nowrap text-[13px] font-medium text-foreground">
          Столбцы
        </div>
        {/* Подпись вместо иконки + Tooltip: Radix Popover автофокусит первый
            фокусируемый элемент, а Tooltip раскрывается по фокусу — из-за
            этого на тач-устройствах подсказка «Сбросить» всплывала при
            каждом открытии поповера. Текстовая кнопка убирает этот эффект. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-xs font-normal text-muted-foreground focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-offset-0"
          onClick={onReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Сбросить
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={columns.map((column) => column.id)} strategy={verticalListSortingStrategy}>
          <div className="max-h-[min(400px,60dvh)] space-y-0.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
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
        "flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors hover:bg-muted/60",
        isDragging ? "relative z-10 shadow-md" : "",
      ].join(" ")}
    >
      <button
        type="button"
        className="flex size-7 touch-none items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground cursor-grab active:cursor-grabbing"
        aria-label={`Переместить ${column.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox
        className="size-4 rounded-[5px] border-border data-[state=checked]:border-brand data-[state=checked]:bg-brand"
        checked={column.visible}
        disabled={column.canHide === false}
        onCheckedChange={(checked) => onVisibilityChange(column.id, Boolean(checked))}
        aria-label={`Показать ${column.label}`}
      />
      <span className="min-w-0 flex-1 truncate">{column.label}</span>
    </div>
  );
}
