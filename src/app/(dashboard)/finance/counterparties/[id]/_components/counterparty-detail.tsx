"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AttachmentUploader, type AttachmentRowDisplay } from "@/components/shared/attachment-uploader";
import {
  restoreCounterparty,
  softDeleteCounterparty,
  syncCounterpartyFromDadata,
} from "@/lib/finance/counterparties";
import { CounterpartyForm } from "../../_components/counterparty-form";
import type {
  CounterpartyGroupRow,
  CounterpartyRow,
} from "@/types/finance";

type Props = {
  row: CounterpartyRow;
  groups: CounterpartyGroupRow[];
  attachments: AttachmentRowDisplay[];
  canManage: boolean;
  canUploadAttachments: boolean;
  canDeleteAttachments: boolean;
  /** Hide the «Обновить из DaData» button + disable address suggestions. */
  dadataEnabled?: boolean;
};

export function CounterpartyDetail({
  row,
  groups,
  attachments,
  canManage,
  canUploadAttachments,
  canDeleteAttachments,
  dadataEnabled = true,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"sync" | "delete" | "restore" | null>(null);
  const [, startTransition] = useTransition();

  const isDeleted = !!row.deleted_at;

  const handleSync = () => {
    if (!row.inn) {
      toast.error("Нельзя обновить из DaData без ИНН");
      return;
    }
    setBusy("sync");
    startTransition(async () => {
      const { error } = await syncCounterpartyFromDadata(row.id);
      setBusy(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Данные обновлены из DaData");
      router.refresh();
    });
  };

  const handleSoftDelete = () => {
    if (
      !window.confirm(
        `Удалить контрагента «${row.name}»? Существующие транзакции сохранят ссылку.`
      )
    ) {
      return;
    }
    setBusy("delete");
    startTransition(async () => {
      const { error } = await softDeleteCounterparty(row.id);
      setBusy(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Контрагент удалён");
      router.push("/finance/counterparties");
    });
  };

  const handleRestore = () => {
    setBusy("restore");
    startTransition(async () => {
      const { error } = await restoreCounterparty(row.id);
      setBusy(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Контрагент восстановлен");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {row.inn && dadataEnabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={busy !== null}
            >
              {busy === "sync" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Обновить из DaData
            </Button>
          )}
          {isDeleted ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRestore}
              disabled={busy !== null}
            >
              {busy === "restore" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-4 w-4" />
              )}
              Восстановить
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSoftDelete}
              disabled={busy !== null}
              className="text-destructive hover:text-destructive"
            >
              {busy === "delete" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-4 w-4" />
              )}
              Удалить
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Реквизиты</CardTitle>
        </CardHeader>
        <CardContent>
          {/*
            key={row.id} forces a remount when the user navigates from
            one counterparty to another. Without it, App Router keeps
            the same component instance under the dynamic segment, so
            CounterpartyForm's useState(initial) — which only reads
            initial at mount — would keep showing the previous row's
            field values.
          */}
          <CounterpartyForm
            key={row.id}
            mode="edit"
            counterpartyId={row.id}
            initial={row}
            groups={groups}
            readOnly={!canManage || isDeleted}
            dadataEnabled={dadataEnabled}
          />
          {isDeleted && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              Контрагент в удалённых. Восстановите его, чтобы редактировать.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Документы</CardTitle>
        </CardHeader>
        <CardContent>
          {/*
            Each attachment action has its own RLS (migration 045):
              upload  → finance.upload_attachments
              detach  → finance.delete_attachments (pivot delete policy)
              delete  → finance.delete_attachments (account_files delete)
            Page-level readOnly fires when the user can't manage the
            counterparty at all or the row is soft-deleted; otherwise
            each button is gated on its own permission so a manager
            with upload but without delete_attachments doesn't see a
            Detach button that's guaranteed to fail at click.
          */}
          <AttachmentUploader
            parent={{ kind: "counterparty", id: row.id }}
            attachments={attachments}
            defaultDocumentType="contract"
            readOnly={!canManage || isDeleted}
            canUpload={canUploadAttachments}
            canDetach={canDeleteAttachments}
            canHardDelete={canDeleteAttachments}
          />
        </CardContent>
      </Card>
    </div>
  );
}
