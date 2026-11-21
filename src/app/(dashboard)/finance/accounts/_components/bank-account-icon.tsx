import { Banknote, CreditCard, Landmark, Lock, Wallet, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BankAccountType } from "@/types/database";

const ICONS: Record<BankAccountType, LucideIcon> = {
  cash: Wallet,
  checking: Landmark,
  debit_card: CreditCard,
  fund: Banknote,
  safe: Lock,
};

/**
 * Плитка вида счёта: 36px в строке таблицы, 56px в шапке карточки
 * (DS «Фото предмета в строке» и «сущность не человек»).
 */
export function BankAccountIcon({ type, size = "row" }: { type: BankAccountType; size?: "row" | "header" }) {
  const Icon = ICONS[type] ?? Wallet;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center bg-muted text-muted-foreground",
        size === "header" ? "size-14 rounded-[14px]" : "size-9 rounded-md",
      )}
    >
      <Icon className={size === "header" ? "size-7" : "size-4"} />
    </span>
  );
}
