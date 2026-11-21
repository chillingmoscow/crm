"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ClipboardCheck, FileX2, Inbox, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TableRowMenu, type TableRowMenuAction } from "@/components/shared/table";
import { getDeleteLockReason } from "@/lib/inventory/act-status";
import { deleteInventoryDocument } from "@/app/(dashboard)/inventory/_actions/documents";
import type { DocumentListRow } from "@/lib/inventory/list-documents-shared";

import { PersonChip, inventoryPersonHref, type AssigneeOption } from "./assignee-select";
import { getDocHref } from "./documents-table-utils";

/**
 * Ячейка исполнителя/проверяющего для пользователя без права назначать.
 * Показывает бейдж сотрудника; для завершённого (locked) акта — ссылку на
 * страницу сотрудника, но только если есть доступ к разделу «Сотрудники»
 * (canViewStaff). Иначе — статичный бейдж; клик по строке открывает акт.
 */
export function ReadonlyPersonCell({
  userId,
  staff,
  locked,
  canViewStaff,
}: {
  userId: string | null;
  staff: AssigneeOption[];
  locked: boolean;
  canViewStaff: boolean;
}) {
  const member = userId ? staff.find((m) => m.id === userId) ?? null : null;
  if (!member) return <span className="text-sm text-muted-foreground">—</span>;
  if (locked && canViewStaff) {
    return <PersonChip person={member} href={inventoryPersonHref(member.id)} />;
  }
  return <PersonChip person={member} />;
}

/** Меню выбора сотрудника в панели массовых действий. */
export function BulkAssignMenu({
  label,
  clearLabel,
  icon,
  staff,
  disabled,
  onPick,
}: {
  label: string;
  /** Первый пункт: снять назначение у всех выбранных актов. */
  clearLabel: string;
  icon?: React.ReactNode;
  staff: AssigneeOption[];
  disabled?: boolean;
  onPick: (userId: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {icon}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuItem onClick={() => onPick(null)} className="text-muted-foreground">
          {clearLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {staff.map((member) => (
          <DropdownMenuItem key={member.id} onClick={() => onPick(member.id)}>
            {member.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Подтверждение удаления одного акта: общий диалог, ошибка остаётся в нём. */
export function DeleteActDialog({
  doc,
  open,
  onOpenChange,
  onDeleted,
}: {
  doc: Pick<DocumentListRow, "id" | "document_number">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [isDeleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const runDelete = () => {
    setError(null);
    startDelete(async () => {
      try {
        const result = await deleteInventoryDocument({ documentId: doc.id });
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(`Акт № ${doc.document_number} удалён`);
        onOpenChange(false);
        onDeleted();
      } catch {
        setError("Не удалось удалить акт. Попробуйте ещё раз.");
      }
    });
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title={`Удалить акт № ${doc.document_number}?`}
      description="Удалятся акт и все его позиции. Если акт пришёл из Quick Resto, он вернётся при следующей синхронизации: чтобы удалить его насовсем, удалите его и в Quick Resto."
      confirmLabel="Удалить акт"
      pendingLabel="Удаляем…"
      destructive
      busy={isDeleting}
      error={error}
      onConfirm={runDelete}
    />
  );
}

/** Меню «⋯» строки: открыть акт; удалить — только когда удаление доступно. */
export function DocumentRowMenu({
  doc,
  canManage,
  canViewResults,
}: {
  doc: DocumentListRow;
  canManage: boolean;
  canViewResults: boolean;
}) {
  const router = useRouter();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const deleteLockReason = getDeleteLockReason({
    status: doc.status,
    resultsSnapshotAt: doc.results_snapshot_at,
  });

  const actions = useMemo(() => {
    const items: TableRowMenuAction[] = [
      {
        label: "Открыть акт",
        icon: <ClipboardCheck className="h-4 w-4" />,
        onSelect: () => router.push(getDocHref(doc, canViewResults)),
      },
    ];
    // Проведённый акт и акт с зафиксированными итогами удалить нельзя —
    // серверный экшен всё равно откажет. Пункт меню, который заведомо
    // закончится ошибкой, не показываем.
    if (canManage && deleteLockReason === null) {
      items.push({
        label: "Удалить акт",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        separatorBefore: true,
        onSelect: () => setConfirmDeleteOpen(true),
      });
    }
    return items;
  }, [doc, router, canManage, canViewResults, deleteLockReason]);

  return (
    <>
      <TableRowMenu actions={actions} />
      <DeleteActDialog
        doc={doc}
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        onDeleted={() => router.refresh()}
      />
    </>
  );
}

/** Пустой список: ничего не найдено по условиям или актов ещё нет. */
export function DocumentsEmptyState({
  canSync,
  hasActive,
  syncing,
  onClearAll,
  onSync,
}: {
  canSync: boolean;
  hasActive: boolean;
  syncing: boolean;
  onClearAll: () => void;
  onSync: () => void;
}) {
  if (hasActive) {
    return (
      <EmptyState
        icon={FileX2}
        title="Актов не найдено"
        description="Измените условия поиска или сбросьте фильтры"
        action={
          <Button variant="outline" onClick={onClearAll}>
            Сбросить поиск и фильтры
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={Inbox}
      title="Актов инвентаризации пока нет"
      description={
        canSync
          ? "Создайте акт в Quick Resto и синхронизируйте список"
          : "Акты появятся после синхронизации с Quick Resto"
      }
      action={
        canSync ? (
          <Button onClick={onSync} disabled={syncing}>
            <RefreshCw className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Синхронизируем…" : "Синхронизировать"}
          </Button>
        ) : null
      }
    />
  );
}
