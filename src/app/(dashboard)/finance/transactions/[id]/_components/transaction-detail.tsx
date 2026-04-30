"use client";

import Link from "next/link";
import {
  ArrowLeftRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AttachmentUploader,
  type AttachmentRowDisplay,
} from "@/components/shared/attachment-uploader";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionRow,
} from "@/types/finance";

type LegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};
type VenueOption = { id: string; name: string };

type Props = {
  row: TransactionRow;
  legalEntities: LegalEntityOption[];
  venues: VenueOption[];
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  attachments: AttachmentRowDisplay[];
  /** finance.upload_attachments — gates upload button. */
  canUploadAttachments: boolean;
  /** finance.delete_attachments — gates detach + hard-delete buttons. */
  canDeleteAttachments: boolean;
};

export function TransactionDetail({
  row,
  legalEntities,
  venues,
  bankAccounts,
  categories,
  counterparties,
  attachments,
  canUploadAttachments,
  canDeleteAttachments,
}: Props) {
  const isDeleted = !!row.deleted_at;

  const leName = (id: string | null) =>
    id
      ? legalEntities.find((le) => le.id === id)?.short_name ??
        legalEntities.find((le) => le.id === id)?.name ??
        "—"
      : "—";
  const venueName = (id: string | null) =>
    id ? venues.find((v) => v.id === id)?.name ?? null : null;
  const bankAccountName = (id: string | null) =>
    id ? bankAccounts.find((b) => b.id === id)?.name ?? "—" : "—";
  const categoryName = (id: string | null) =>
    id ? categories.find((c) => c.id === id)?.name ?? null : null;
  const counterpartyName = (id: string | null) =>
    id ? counterparties.find((c) => c.id === id)?.name ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TypeBadge type={row.type} />
            <span className="text-sm text-muted-foreground tabular-nums">
              #{row.public_id}
            </span>
            {isDeleted && (
              <Badge variant="outline" className="font-normal">
                удалена
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-semibold tabular-nums">
            <AmountText tx={row} />
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {formatDate(row.date)}
          </p>
        </div>
        {/* Edit / delete buttons land in stage 4.5b. */}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Детали</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          <Field label="Юрлицо" value={leName(row.legal_entity_id)} />
          <Field label="Точка" value={venueName(row.venue_id) ?? "—"} />
          <Field label="Счёт" value={bankAccountName(row.bank_account_id)}>
            {row.type !== "transfer" && (
              <Link
                href={`/finance/accounts/${row.bank_account_id}`}
                className="ml-2 text-xs text-muted-foreground hover:underline"
              >
                Открыть
              </Link>
            )}
          </Field>

          {row.type === "transfer" && (
            <>
              <Field
                label="Получатель — счёт"
                value={bankAccountName(row.to_bank_account_id)}
              />
              <Field
                label="Получатель — юрлицо"
                value={leName(row.to_legal_entity_id)}
              />
            </>
          )}

          {row.type !== "transfer" && (
            <>
              <Field label="Статья" value={categoryName(row.category_id) ?? "—"} />
              <Field
                label="Контрагент"
                value={counterpartyName(row.counterparty_id) ?? "—"}
              >
                {row.counterparty_id && (
                  <Link
                    href={`/finance/counterparties/${row.counterparty_id}`}
                    className="ml-2 text-xs text-muted-foreground hover:underline"
                  >
                    Открыть
                  </Link>
                )}
              </Field>
            </>
          )}

          <Field
            label="Источник"
            value={
              row.source === "manual"
                ? "Введено вручную"
                : row.source === "quickresto"
                  ? "QuickResto"
                  : row.source === "import"
                    ? "Импорт"
                    : row.source === "bank_sync"
                      ? "Банковская синхронизация"
                      : row.source
            }
          />
          {row.source_external_id && (
            <Field label="Внешний ID" value={row.source_external_id} />
          )}

          {row.description && (
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground">Описание</div>
              <div className="mt-1 whitespace-pre-wrap">{row.description}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Документы</CardTitle>
        </CardHeader>
        <CardContent>
          <AttachmentUploader
            parent={{ kind: "transaction", id: row.id }}
            attachments={attachments}
            defaultDocumentType="receipt"
            // No edit form yet, but uploads still make sense — каждый
            // user with upload_attachments может прикреплять чеки к
            // существующим транзакциям. На soft-deleted строки —
            // полная блокировка, чтобы не плодить орфаны.
            readOnly={isDeleted}
            canUpload={canUploadAttachments}
            canDetach={canDeleteAttachments}
            canHardDelete={canDeleteAttachments}
          />
        </CardContent>
      </Card>

      {/* Audit footer */}
      <div className="text-xs text-muted-foreground space-y-1">
        <div>Создано: {formatDateTime(row.created_at)}</div>
        {row.updated_at && <div>Обновлено: {formatDateTime(row.updated_at)}</div>}
        {row.deleted_at && (
          <div className="text-rose-700">
            Удалено: {formatDateTime(row.deleted_at)}
          </div>
        )}
      </div>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/finance/transactions">К списку</Link>
        </Button>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center">
        <span>{value}</span>
        {children}
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: TransactionRow["type"] }) {
  if (type === "income") {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 font-normal">
        <TrendingUp className="mr-1 h-3 w-3" />
        Доход
      </Badge>
    );
  }
  if (type === "expense") {
    return (
      <Badge variant="secondary" className="bg-rose-100 text-rose-700 hover:bg-rose-100 font-normal">
        <TrendingDown className="mr-1 h-3 w-3" />
        Расход
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-sky-100 text-sky-700 hover:bg-sky-100 font-normal">
      <ArrowLeftRight className="mr-1 h-3 w-3" />
      Перевод
    </Badge>
  );
}

function AmountText({ tx }: { tx: TransactionRow }) {
  const formatted = formatRub(Number(tx.amount), tx.currency);
  if (tx.type === "income") return <span className="text-emerald-700">+{formatted}</span>;
  if (tx.type === "expense") return <span className="text-rose-700">−{formatted}</span>;
  return <span>{formatted}</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
