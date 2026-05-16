"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LegalEntityForm } from "../../_components/legal-entity-form";
import {
  deleteLegalEntity,
  syncLegalEntityFromDadata,
  type LegalEntityRow,
} from "@/lib/org/legal-entities";

type Props = {
  row: LegalEntityRow;
  canManage: boolean;
  canDelete: boolean;
  /** Hide the «Обновить из DaData» button when DaData isn't configured. */
  dadataEnabled?: boolean;
};

export function LegalEntityDetailClient({
  row,
  canManage,
  canDelete,
  dadataEnabled = true,
}: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onSync = async () => {
    if (!row.inn) {
      toast.error("У юрлица не указан ИНН — нечего обновлять");
      return;
    }
    setSyncing(true);
    const { error } = await syncLegalEntityFromDadata(row.id);
    setSyncing(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Данные обновлены из DaData");
    router.refresh();
  };

  const onDelete = async () => {
    if (
      !window.confirm(
        "Удалить юрлицо безвозвратно?\n\nЕсли к нему привязаны заведения — удаление будет отклонено: сначала переключите эти заведения на другое юрлицо."
      )
    ) {
      return;
    }
    setDeleting(true);
    const { error } = await deleteLegalEntity(row.id);
    setDeleting(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Юрлицо удалено");
    router.push("/org/legal-entities");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManage && dadataEnabled && (
          <Button
            type="button"
            variant="outline"
            onClick={onSync}
            disabled={syncing || !row.inn}
            // Нативный title — портальный data-tip не ловит события на
            // disabled-кнопке, а подсказка тут объясняет причину
            // блокировки (Codex P2).
            title={!row.inn ? "Сначала укажите ИНН" : undefined}
          >
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Обновить из DaData
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Удалить
          </Button>
        )}
      </div>

      {row.dadata_synced_at && (
        <p className="text-xs text-muted-foreground">
          Последний раз синхронизировано с DaData:{" "}
          {new Date(row.dadata_synced_at).toLocaleString("ru-RU")}
        </p>
      )}

      <LegalEntityForm
        mode="edit"
        legalEntityId={row.id}
        readOnly={!canManage}
        dadataEnabled={dadataEnabled}
        initial={{
          name:                   row.name,
          short_name:             row.short_name,
          legal_form:             row.legal_form,
          inn:                    row.inn,
          kpp:                    row.kpp,
          ogrn:                   row.ogrn,
          okpo:                   row.okpo,
          okved:                  row.okved,
          tax_system:             row.tax_system,
          vat_payer:              row.vat_payer,
          legal_address:          row.legal_address,
          actual_address:         row.actual_address,
          postal_address:         row.postal_address,
          director_name:          row.director_name,
          director_position:      row.director_position,
          accountant_name:        row.accountant_name,
          signature_basis:        row.signature_basis,
          phone:                  row.phone,
          email:                  row.email,
          website:                row.website,
          default_bank_name:      row.default_bank_name,
          default_bik:            row.default_bik,
          default_account_number: row.default_account_number,
          default_corr_account:   row.default_corr_account,
        }}
      />
    </div>
  );
}
