"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  restoreBankAccount,
  type BankAccountArchiveImpact,
} from "@/lib/finance/bank-accounts";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import { BankAccountForm } from "../../_components/bank-account-form";
import { BankAccountDangerZone } from "./bank-account-danger-zone";
import type {
  BankAccountGroupRow,
  BankAccountRow,
} from "@/types/finance";

type LegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};

type VenueOption = {
  id: string;
  name: string;
};

type Props = {
  row: BankAccountRow;
  legalEntities: LegalEntityOption[];
  venues: VenueOption[];
  groups: BankAccountGroupRow[];
  canManage: boolean;
  canArchive: boolean;
  canHardDelete: boolean;
  archiveImpact: BankAccountArchiveImpact;
  amountRoundingScale: AmountRoundingScale;
};

export function BankAccountDetail({
  row,
  legalEntities,
  venues,
  groups,
  canManage,
  canArchive,
  canHardDelete,
  archiveImpact,
  amountRoundingScale,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"restore" | null>(null);
  const [, startTransition] = useTransition();

  const isDeleted = !!row.deleted_at;

  const handleRestore = () => {
    setBusy("restore");
    startTransition(async () => {
      const { error } = await restoreBankAccount(row.id);
      setBusy(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Счёт восстановлен");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Balance — read-only display. The bank_account_balance_guard
          trigger (migration 040) silently rejects direct writes to
          balance from the app layer; the value reflects accumulated
          transaction effects only. */}
      <Card>
        <CardHeader>
          <CardTitle>Баланс</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {formatRub(Number(row.balance), row.currency, amountRoundingScale)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Изменяется только через транзакции.
          </p>
        </CardContent>
      </Card>

      {isDeleted && canArchive && (
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Реквизиты</CardTitle>
        </CardHeader>
        <CardContent>
          {/* key={row.id} forces remount on row change so useState(initial)
              stays in sync — App Router can keep the same instance under
              the dynamic segment otherwise (PR #16 lesson). */}
          <BankAccountForm
            key={row.id}
            mode="edit"
            bankAccountId={row.id}
            initial={row}
            legalEntities={legalEntities}
            venues={venues}
            groups={groups}
            readOnly={!canManage || isDeleted}
          />
          {isDeleted && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              Счёт в архиве. Восстановите его, чтобы редактировать.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Danger zone — только владельцу (archive/delete actions гейтятся
          owner-check на сервере). Для не-архивных. Архивные имеют
          кнопку «Восстановить» в шапке + могут быть удалены из /archive. */}
      {canArchive && !isDeleted ? (
        <BankAccountDangerZone
          bankAccountId={row.id}
          bankAccountName={row.name}
          impact={archiveImpact}
          canHardDelete={canHardDelete}
        />
      ) : null}
    </div>
  );
}

function formatRub(value: number, currency: string, scale: AmountRoundingScale): string {
  return formatMoney(value, currency, scale);
}
