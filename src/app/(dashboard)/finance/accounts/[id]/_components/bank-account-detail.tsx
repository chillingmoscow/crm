"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  restoreBankAccount,
  softDeleteBankAccount,
} from "@/lib/finance/bank-accounts";
import { BankAccountForm } from "../../_components/bank-account-form";
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
};

export function BankAccountDetail({
  row,
  legalEntities,
  venues,
  groups,
  canManage,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"delete" | "restore" | null>(null);
  const [, startTransition] = useTransition();

  const isDeleted = !!row.deleted_at;

  const handleSoftDelete = () => {
    if (
      !window.confirm(
        `Удалить счёт «${row.name}»? Существующие транзакции сохранят ссылку.`
      )
    ) {
      return;
    }
    setBusy("delete");
    startTransition(async () => {
      const { error } = await softDeleteBankAccount(row.id);
      setBusy(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Счёт удалён");
      router.push("/finance/accounts");
    });
  };

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
            {formatRub(Number(row.balance), row.currency)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Изменяется только через транзакции.
          </p>
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
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
              Счёт в удалённых. Восстановите его, чтобы редактировать.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatRub(value: number, currency = "RUB"): string {
  const formatted = value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  if (currency === "RUB") return `${formatted} ₽`;
  if (currency === "USD") return `${formatted} $`;
  if (currency === "EUR") return `${formatted} €`;
  return `${formatted} ${currency}`;
}
