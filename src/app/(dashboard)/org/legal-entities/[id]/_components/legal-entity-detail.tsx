"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LegalEntityForm } from "../../_components/legal-entity-form";
import {
  restoreLegalEntity,
  syncLegalEntityFromDadata,
  type LegalEntityRow,
  type LegalEntityArchiveImpact,
} from "@/lib/org/legal-entities";
import { LegalEntityDangerZone } from "./legal-entity-danger-zone";

type Props = {
  row: LegalEntityRow;
  canManage: boolean;
  canDelete: boolean;
  /** True только для владельца аккаунта — гейт для archive/restore/delete
      (server actions требуют ownership independently of canManage). */
  canArchive: boolean;
  archiveImpact: LegalEntityArchiveImpact;
  /** Hide the «Обновить из DaData» button when DaData isn't configured. */
  dadataEnabled?: boolean;
};

export function LegalEntityDetailClient({
  row,
  canManage,
  canDelete,
  canArchive,
  archiveImpact,
  dadataEnabled = true,
}: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const isArchived = !!row.archived_at;

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

  const onRestore = async () => {
    setRestoring(true);
    const { error } = await restoreLegalEntity(row.id);
    setRestoring(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Юрлицо восстановлено");
    router.refresh();
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
        {isArchived && canArchive && (
          <Button
            type="button"
            variant="outline"
            onClick={onRestore}
            disabled={restoring}
          >
            {restoring ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Восстановить
          </Button>
        )}
      </div>

      {isArchived && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Юрлицо в архиве. Восстановите, чтобы редактировать и использовать
          в новых счетах / транзакциях / заведениях.
        </div>
      )}

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

      {/* Danger zone — только владельцу аккаунта (archive/delete
          actions гейтятся owner-check на сервере, см. Codex P2 #373).
          Для не-архивных. Архивные имеют кнопку «Восстановить» в шапке. */}
      {canArchive && !isArchived ? (
        <LegalEntityDangerZone
          legalEntityId={row.id}
          legalEntityName={row.name}
          impact={archiveImpact}
          canHardDelete={canDelete}
        />
      ) : null}
    </div>
  );
}
