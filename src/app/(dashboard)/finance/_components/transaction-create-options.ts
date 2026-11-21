import { ArrowLeftRight, Minus, Plus, type LucideIcon } from "lucide-react";

import type { TransactionRow } from "@/types/finance";

/**
 * Пункты меню «Добавить операцию» — одни и те же в журнале операций и на
 * дашборде. Плитка значка по палитре статусов DS: `bg-{c}-500/10` и
 * `text-{c}-700` / тёмная тема `400`, перевод — нейтральный.
 */
export const TRANSACTION_CREATE_OPTIONS: {
  type: TransactionRow["type"];
  label: string;
  icon: LucideIcon;
  tone: string;
}[] = [
  {
    type: "income",
    label: "Приход",
    icon: Plus,
    tone: "bg-green-500/10 text-green-700 dark:text-green-400",
  },
  {
    type: "expense",
    label: "Расход",
    icon: Minus,
    tone: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
  {
    type: "transfer",
    label: "Перевод",
    icon: ArrowLeftRight,
    tone: "bg-muted text-muted-foreground",
  },
];
