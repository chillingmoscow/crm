import { ArrowLeftRight, ArrowRight } from "lucide-react";

import { CategoryColorDot } from "@/components/finance/category-color";
import {
  formatAmount,
  signedAmountClass,
  type AmountRoundingScale,
} from "@/lib/format/amount";
import { cn } from "@/lib/utils";
import type { TransactionRow } from "@/types/finance";

import { linkifyParts } from "../_lib/utils";

const CURRENCY_SYMBOL: Record<string, string> = { RUB: "₽", USD: "$", EUR: "€" };

export function currencySymbol(currency: string | null | undefined): string {
  return CURRENCY_SYMBOL[currency ?? "RUB"] ?? currency ?? "₽";
}

/**
 * Сумма операции по правилам `Money` (design-system «Деньги»): знак и цвет
 * через `signedAmountClass`, валюта отдельным серым символом меньшего кегля.
 * Отличие от `Money` — валюта счёта и точность из настройки аккаунта
 * «Округление сумм»: счета бывают не в рублях.
 */
export function TxAmount({
  value,
  currency = "RUB",
  signed,
  scale,
  className,
}: {
  /** Со знаком: приход > 0, расход < 0. Без знака — перевод. */
  value: number;
  currency?: string;
  signed: boolean;
  scale: AmountRoundingScale;
  className?: string;
}) {
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  return (
    <span
      className={cn(
        "whitespace-nowrap tabular-nums",
        signed ? signedAmountClass(value) : null,
        className,
      )}
    >
      {sign}
      {formatAmount(Math.abs(value), scale)}
      <span className="ml-0.5 text-[0.85em] font-normal text-muted-foreground">
        {currencySymbol(currency)}
      </span>
    </span>
  );
}

/** Знак суммы по типу: приход +, расход −, перевод без знака. */
export function signedTxAmount(tx: Pick<TransactionRow, "type" | "amount">): number {
  const amount = Number(tx.amount);
  return tx.type === "expense" ? -amount : amount;
}

export function CategoryCell({
  tx,
  category,
}: {
  tx: TransactionRow;
  category: { name: string; color: string | null; archived_at: string | null } | null;
}) {
  if (tx.type === "transfer")
    return (
      <span className="flex min-w-0 items-center gap-2">
        <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">Перевод</span>
      </span>
    );
  if (!category)
    return <span className="text-muted-foreground">Без статьи</span>;
  return (
    <span className="flex min-w-0 items-center gap-2" data-tip={category.name}>
      {/* Место под точку держим и без цвета: названия статей стоят ровно. */}
      <span className="flex size-2 shrink-0 items-center justify-center">
        <CategoryColorDot color={category.color} size="sm" />
      </span>
      <span className="truncate">{category.name}</span>
    </span>
  );
}

export function AccountCell({
  tx,
  accountName,
}: {
  tx: TransactionRow;
  accountName: (id: string | null) => string | null;
}) {
  const from = accountName(tx.bank_account_id) ?? "Счёт недоступен";
  if (tx.type !== "transfer") {
    return (
      <span className="block truncate" data-tip={from}>
        {from}
      </span>
    );
  }
  const to = accountName(tx.to_bank_account_id) ?? "Счёт недоступен";
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-tip={`${from} → ${to}`}>
      <span className="truncate">{from}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="на счёт" />
      <span className="truncate">{to}</span>
    </span>
  );
}

/** Описание в одну строку; ссылки кликабельны и не открывают строку. */
export function DescriptionText({ text }: { text: string | null }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="block truncate" data-tip={text}>
      {linkifyParts(text).map((part, i) =>
        part.type === "link" ? (
          <a
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  );
}
