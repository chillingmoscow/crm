"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import {
  GROUP_NAME_MAX,
  groupDraftsDirty,
  validateGroupDrafts,
  type SavedGroup,
} from "@/lib/finance/bank-account-groups";
import { saveBankAccountGroups } from "@/lib/finance/bank-accounts";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import type { BankAccountGroupRow } from "@/types/finance";

type Row = { key: string; id: string | null; name: string };

const rowsFrom = (groups: BankAccountGroupRow[]): Row[] =>
  groups.map((g) => ({ key: g.id, id: g.id, name: g.name }));

/**
 * Панель «Группы счетов»: добавить, переименовать, расставить по порядку,
 * удалить. Сохраняется всё сразу одной кнопкой. Группа — только ярлык для
 * списка: удаление снимает её со счетов, сами счета и операции остаются.
 *
 * `groups` приходят уже упорядоченными (`listBankAccountGroups`).
 */
export function BankAccountGroupsDrawer({
  open,
  onOpenChange,
  groups,
  accountsByGroup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: BankAccountGroupRow[];
  /** Сколько действующих счетов в каждой группе. */
  accountsByGroup: Map<string, number>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(groups));
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const nextKey = useRef(0);
  const focusKey = useRef<string | null>(null);

  // Каждое открытие — с тем, что сейчас в базе (после router.refresh
  // приходят новые `groups`).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRows(rowsFrom(groups));
      setShowErrors(false);
      setServerError(null);
      setConfirmOpen(false);
    }
  }

  // Для «есть ли изменения» важен порядок, в котором группы показаны;
  // настоящие номера сервер сверяет сам.
  const saved: SavedGroup[] = useMemo(
    () => groups.map((g, i) => ({ id: g.id, name: g.name, sort_order: i })),
    [groups],
  );
  const drafts = rows.map(({ id, name }) => ({ id, name }));
  const dirty = groupDraftsDirty(saved, drafts);
  const errors = validateGroupDrafts(drafts);
  const hasErrors = Object.keys(errors).length > 0;
  const { guard, dialog } = useDiscardGuard(dirty, "Изменения в группах не сохранятся.");

  // Группы, которые пропали из списка, и сколько счетов останется без группы.
  const keptIds = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
  const removed = groups.filter((g) => !keptIds.has(g.id));
  const orphaned = removed.reduce((sum, g) => sum + (accountsByGroup.get(g.id) ?? 0), 0);

  const reset = () => {
    setRows(rowsFrom(groups));
    setShowErrors(false);
    setServerError(null);
    setConfirmOpen(false);
  };
  const close = () => {
    onOpenChange(false);
    reset();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.key === active.id);
      const to = prev.findIndex((r) => r.key === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  };

  const addRow = () => {
    const key = `new-${nextKey.current++}`;
    focusKey.current = key;
    setRows((prev) => [...prev, { key, id: null, name: "" }]);
  };

  const persist = () => {
    setServerError(null);
    startTransition(async () => {
      try {
        const { error } = await saveBankAccountGroups(drafts);
        if (error) {
          setServerError(error);
          return;
        }
        toast.success("Группы сохранены");
        onOpenChange(false);
        setConfirmOpen(false);
        router.refresh();
      } catch {
        setServerError("Не удалось сохранить группы. Проверьте соединение и повторите");
      }
    });
  };

  const submit = () => {
    setShowErrors(true);
    if (hasErrors || !dirty) {
      if (!dirty) close();
      return;
    }
    if (orphaned > 0) setConfirmOpen(true);
    else persist();
  };

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else if (!isPending) guard(close);
        }}
        title="Группы счетов"
        description="Группа собирает счета в списке: по ней можно отфильтровать счета и увидеть их итог"
        footer={
          <>
            <Button variant="outline" onClick={() => guard(close)} disabled={isPending}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={isPending || (showErrors && hasErrors)} className="min-w-32">
              {isPending && !confirmOpen ? "Сохраняем…" : "Сохранить"}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
          {/* Без заголовка раздела: он повторил бы заголовок панели. */}
          <DrawerSection>
            {rows.length > 1 ? (
              <p className="text-[13px] text-muted-foreground">
                Порядок здесь — порядок групп в фильтре и в выборе у счёта. Перетащите группу за ручку слева
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Групп пока нет. Например, «Банк», «Наличные» и «Резервы»
              </p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col gap-2">
                    {rows.map((row, index) => (
                      <GroupRow
                        key={row.key}
                        row={row}
                        index={index}
                        count={row.id ? (accountsByGroup.get(row.id) ?? 0) : null}
                        error={showErrors ? errors[index] : undefined}
                        disabled={isPending}
                        canDrag={rows.length > 1}
                        autoFocus={focusKey.current === row.key}
                        onChange={(name) => {
                          setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, name } : r)));
                        }}
                        onRemove={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            <div>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addRow} disabled={isPending}>
                <Plus className="size-4" />
                Добавить группу
              </Button>
            </div>
            {removed.length > 0 && orphaned > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {countRu(orphaned, "счёт останется", "счёта останутся", "счетов останутся")} без группы. Сами
                счета и операции не изменятся
              </p>
            ) : null}
            {serverError && !confirmOpen ? (
              <p role="alert" className="text-xs text-destructive">
                {serverError}
              </p>
            ) : null}
          </DrawerSection>
        </form>
      </EditDrawer>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next && !isPending) {
            setConfirmOpen(false);
            setServerError(null);
          }
        }}
        title={
          removed.length === 1 ? `Удалить группу «${removed[0].name}»?` : `Удалить ${countRu(removed.length, "группу", "группы", "групп")}?`
        }
        description={`${countRu(orphaned, "счёт останется", "счёта останутся", "счетов останутся")} без группы. Сами счета, их баланс и операции не изменятся`}
        confirmLabel={removed.length === 1 ? "Удалить группу" : "Удалить группы"}
        pendingLabel="Сохраняем…"
        destructive
        busy={isPending}
        error={serverError}
        onConfirm={persist}
      />
      {dialog}
    </>
  );
}

function GroupRow({
  row,
  index,
  count,
  error,
  disabled,
  canDrag,
  autoFocus,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  /** null — группа ещё не сохранена. */
  count: number | null;
  error?: string;
  disabled: boolean;
  canDrag: boolean;
  autoFocus: boolean;
  onChange: (name: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.key,
    disabled: !canDrag || disabled,
  });
  const label = row.name.trim() || `Группа ${index + 1}`;
  const inputId = `ba-group-${row.key}`;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("grid gap-1.5 rounded-lg bg-background", isDragging && "relative z-10 shadow-md")}
    >
      <div className="flex items-center gap-2">
        {canDrag ? (
          <button
            type="button"
            className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing"
            aria-label={`Переместить группу «${label}»`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <Input
          id={inputId}
          value={row.name}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Название группы"
          maxLength={GROUP_NAME_MAX + 20}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-label={`Название группы ${index + 1}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="min-w-0 flex-1"
        />
        <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
          {count === null ? "новая" : count === 0 ? "нет счетов" : countRu(count, "счёт", "счёта", "счетов")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Удалить группу «${label}»`}
          data-tip="Удалить группу"
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {error ? (
        <p id={`${inputId}-error`} className={cn("text-xs text-destructive", canDrag && "pl-10")}>
          {error}
        </p>
      ) : null}
    </li>
  );
}
