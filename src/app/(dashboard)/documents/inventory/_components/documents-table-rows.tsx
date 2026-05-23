"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  ClipboardCheck,
  FileX2,
  Inbox,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableRowMenu } from "@/components/shared/table";
import { InventoryStatusBadge } from "@/components/shared/inventory-status-badge";
import { getAssigneeLockReason, getReviewerLockReason } from "@/lib/inventory/act-status";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import { cn } from "@/lib/utils";
import { deleteInventoryDocument } from "@/app/(dashboard)/inventory/actions";
import type { DocumentListRow } from "@/lib/inventory/list-documents-shared";

import {
  AssigneeSelect,
  PersonChip,
  inventoryPersonHref,
  type AssigneeOption,
} from "./assignee-select";
import { ReviewerSelect } from "./reviewer-select";
import { formatDate, getDocHref } from "./documents-table-utils";

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
    return (
      <div data-row-interactive onClick={(e) => e.stopPropagation()}>
        <PersonChip person={member} href={inventoryPersonHref(member.id)} />
      </div>
    );
  }
  return <PersonChip person={member} />;
}

export function BulkAssignMenu({
  label,
  icon,
  staff,
  disabled,
  onPick,
}: {
  label: string;
  icon?: React.ReactNode;
  staff: AssigneeOption[];
  disabled?: boolean;
  onPick: (userId: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={disabled}>
          {icon}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onPick(null)} className="text-muted-foreground">
          Снять
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

export function DesktopRowMenu({
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
  const [isDeleting, startDelete] = useTransition();

  const actions = useMemo(() => {
    const items: { label: string; icon: React.ReactNode; onSelect: () => void; destructive?: boolean; separatorBefore?: boolean }[] = [];
    // После объединения экранов акта табами «Заполнение/Итоги» в shared
    // layout — переключение через UI акта, поэтому в row-menu один
    // пункт «Открыть» по умолчанию-табу из getDocHref. getDocHref сам
    // учитывает canViewResults, чтобы fill-only пользователей не уносило
    // на /results, куда у них нет доступа (Codex P1 #396).
    items.push({
      label: "Открыть",
      icon: <ClipboardCheck className="h-4 w-4" />,
      onSelect: () => router.push(getDocHref(doc, canViewResults)),
    });
    if (canManage) {
      items.push({
        label: "Удалить",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        separatorBefore: true,
        onSelect: () => setConfirmDeleteOpen(true),
      });
    }
    return items;
  }, [doc, router, canManage, canViewResults]);

  const runDelete = () => {
    startDelete(async () => {
      try {
        const result = await deleteInventoryDocument({ documentId: doc.id });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`Акт № ${doc.document_number} удалён`);
        setConfirmDeleteOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить акт");
      }
    });
  };

  return (
    <div data-row-interactive onClick={(e) => e.stopPropagation()}>
      <TableRowMenu actions={actions} />
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить акт № {doc.document_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Это удалит акт и все его позиции. Если акт пришёл из Quick Resto,
              он может вернуться при следующей синхронизации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                runDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function EmptyTableBody({
  canSync,
  hasActive,
  onClearAll,
  onSync,
}: {
  canSync: boolean;
  hasActive: boolean;
  onClearAll: () => void;
  onSync: () => void;
}) {
  if (hasActive) {
    return (
      <div className="p-4">
        <EmptyState
          icon={FileX2}
          title="Ничего не найдено"
          description="Измените фильтры, расширьте период или очистите запрос"
          action={
            <Button variant="outline" onClick={onClearAll}>
              <X />
              Очистить фильтры
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="p-4">
      <EmptyState
        icon={Inbox}
        title="Актов инвентаризации пока нет"
        description="Создайте акт в Quick Resto и запустите синхронизацию, чтобы увидеть его здесь."
        action={
          canSync ? (
            <Button variant="outline" onClick={onSync}>
              <RefreshCw />
              Синхронизировать QR
            </Button>
          ) : null
        }
      />
    </div>
  );
}

export function MobileCard({
  doc,
  staff,
  canManage,
  canViewResults,
  canViewStaff,
  amountRoundingScale,
  searchActive,
}: {
  doc: DocumentListRow;
  staff: AssigneeOption[];
  canManage: boolean;
  canViewResults: boolean;
  canViewStaff: boolean;
  amountRoundingScale: AmountRoundingScale;
  searchActive: boolean;
}) {
  const router = useRouter();
  const [assignSheetOpen, setAssignSheetOpen] = useState(false);
  const [reviewerSheetOpen, setReviewerSheetOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  // Подавляем «click-through» навигацию после закрытия меню действий: на тач-
  // устройствах тап по пункту меню закрывает его, и «призрачный» click падает
  // на кликабельную карточку → она уводила в акт вместо открытия панели.
  const lastMenuCloseRef = useRef(0);
  const href = getDocHref(doc, canViewResults);
  const assigneeName = staff.find((m) => m.id === doc.assigned_to)?.name;
  const reviewerName = staff.find((m) => m.id === doc.reviewer_id)?.name;

  const runDelete = () => {
    startDelete(async () => {
      try {
        const result = await deleteInventoryDocument({ documentId: doc.id });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`Акт № ${doc.document_number} удалён`);
        setConfirmDeleteOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить акт");
      }
    });
  };

  const rowActions = useMemo(() => {
    const items: { label: string; icon: React.ReactNode; onSelect: () => void; destructive?: boolean; separatorBefore?: boolean }[] = [];
    items.push({
      label: "Открыть",
      icon: <ClipboardCheck className="h-4 w-4" />,
      onSelect: () => router.push(getDocHref(doc, canViewResults)),
    });
    if (canManage) {
      const canEditAssignee = getAssigneeLockReason(doc.status) === null;
      const canEditReviewer = getReviewerLockReason(doc.status) === null;
      if (canEditAssignee) {
        items.push({
          label: "Изменить исполнителя",
          icon: <UserPlus className="h-4 w-4" />,
          onSelect: () => setAssignSheetOpen(true),
          separatorBefore: true,
        });
      }
      if (canEditReviewer) {
        items.push({
          label: "Изменить проверяющего",
          icon: <ShieldCheck className="h-4 w-4" />,
          onSelect: () => setReviewerSheetOpen(true),
          separatorBefore: !canEditAssignee,
        });
      }
      items.push({
        label: "Удалить",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        separatorBefore: !canEditAssignee && !canEditReviewer,
        onSelect: () => setConfirmDeleteOpen(true),
      });
    }
    return items;
  }, [doc, router, canManage, canViewResults]);

  return (
    <div
      className="relative rounded-lg border bg-card p-3"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("[data-row-interactive]")) return;
        // Подавляем навигацию-«призрак» сразу после закрытия меню (тач).
        if (Date.now() - lastMenuCloseRef.current < 500) return;
        router.push(href);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Строка 1: № + дата + статус */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={href} className="text-sm font-medium hover:underline" data-row-interactive>
              № {doc.document_number}
            </Link>
            <span className="text-xs text-muted-foreground">{formatDate(doc.invoice_date)}</span>
            <InventoryStatusBadge status={doc.status} className="text-[10px]" />
          </div>

          {/* Строка 2: комментарий (если есть) */}
          {doc.comment ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">{doc.comment}</div>
          ) : null}

          {searchActive && doc.matched_ingredients && doc.matched_ingredients.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {doc.matched_ingredients.map((name) => (
                <span key={name} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
                  <SearchIcon className="h-2.5 w-2.5" />
                  {name}
                </span>
              ))}
            </div>
          ) : null}

          {/* Строка 3: склад + результат (нетто, как на десктопе) */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {doc.store_title ? (
              <span className="text-muted-foreground">{doc.store_title}</span>
            ) : null}
            {(() => {
              if (!doc.results_has_line_amounts) {
                return <span className="text-muted-foreground">—</span>;
              }
              const net = (doc.surplus_sum ?? 0) - (doc.shortfall_sum ?? 0);
              const sign = net > 0 ? "+" : net < 0 ? "−" : "";
              return (
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    net > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : net < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground",
                  )}
                >
                  {sign}
                  {formatMoney(Math.abs(net), "RUB", amountRoundingScale)}
                </span>
              );
            })()}
          </div>

          {/* Строка 4: исполнитель */}
          <div className="mt-1 text-xs text-muted-foreground">
            {assigneeName ? <>Исполнитель: {assigneeName}</> : "Исполнитель не назначен"}
          </div>

          {/* Строка 5: проверяющий (если назначен) */}
          {reviewerName ? (
            <div className="mt-0.5 text-xs text-muted-foreground">Проверяющий: {reviewerName}</div>
          ) : null}
        </div>
        <div data-row-interactive>
          <TableRowMenu
            actions={rowActions}
            onOpenChange={(open) => {
              if (!open) lastMenuCloseRef.current = Date.now();
            }}
          />
        </div>
      </div>

      {assignSheetOpen ? (
        <div
          data-row-interactive
          className="absolute inset-x-0 bottom-0 z-10 rounded-b-lg border-t bg-background p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Назначить</span>
            <button
              type="button"
              onClick={() => setAssignSheetOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <AssigneeSelect
            documentId={doc.id}
            assignedTo={doc.assigned_to}
            staff={staff}
            lockReason={getAssigneeLockReason(doc.status)}
            linkToPerson={canViewStaff}
          />
        </div>
      ) : null}

      {reviewerSheetOpen ? (
        <div
          data-row-interactive
          className="absolute inset-x-0 bottom-0 z-10 rounded-b-lg border-t bg-background p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Проверяющий</span>
            <button
              type="button"
              onClick={() => setReviewerSheetOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ReviewerSelect
            documentId={doc.id}
            reviewerId={doc.reviewer_id}
            staff={staff}
            lockReason={getReviewerLockReason(doc.status)}
            linkToPerson={canViewStaff}
          />
        </div>
      ) : null}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить акт № {doc.document_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Это удалит акт и все его позиции. Если акт пришёл из Quick Resto,
              он может вернуться при следующей синхронизации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                runDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
