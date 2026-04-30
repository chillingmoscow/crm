"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Banknote,
  CreditCard,
  Landmark,
  Lock,
  Plus,
  Search,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  BankAccountGroupRow,
  BankAccountRow,
} from "@/types/finance";
import type { BankAccountType } from "@/types/database";

type Props = {
  accounts: BankAccountRow[];
  groups: BankAccountGroupRow[];
  legalEntityNames: Record<string, string>;
  canManage: boolean;
};

const ALL_GROUPS = "__all__";
const NO_GROUP = "__none__";
const ALL_TYPES = "__all_types__";

const TYPE_LABEL: Record<BankAccountType, string> = {
  cash:       "Касса",
  checking:   "Расчётный счёт",
  debit_card: "Карта",
  fund:       "Фонд",
  safe:       "Сейф",
};

const TYPE_ICON: Record<BankAccountType, LucideIcon> = {
  cash:       Wallet,
  checking:   Landmark,
  debit_card: CreditCard,
  fund:       Banknote,
  safe:       Lock,
};

export function AccountsList({
  accounts,
  groups,
  legalEntityNames,
  canManage,
}: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);
  const [showDeleted, setShowDeleted] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru-RU");
    return accounts.filter((a) => {
      if (!showDeleted && a.deleted_at) return false;
      if (typeFilter !== ALL_TYPES && a.type !== typeFilter) return false;
      if (groupFilter === NO_GROUP && a.group_id) return false;
      if (
        groupFilter !== ALL_GROUPS &&
        groupFilter !== NO_GROUP &&
        a.group_id !== groupFilter
      )
        return false;
      if (!q) return true;
      const name = a.name.toLocaleLowerCase("ru-RU");
      if (name.includes(q)) return true;
      if (a.bank_name && a.bank_name.toLocaleLowerCase("ru-RU").includes(q)) return true;
      return false;
    });
  }, [accounts, search, typeFilter, groupFilter, showDeleted]);

  const groupName = (id: string | null): string | null => {
    if (!id) return null;
    return groups.find((g) => g.id === id)?.name ?? null;
  };

  // Total balance of currently visible (non-deleted) accounts in their
  // raw currency. Mixed currencies are summed naively — RU MVP, all
  // accounts default to RUB.
  const visibleTotal = filtered
    .filter((a) => !a.deleted_at)
    .reduce((acc, a) => acc + Number(a.balance), 0);

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Счета</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Кассы, расчётные счета, карты, фонды и сейфы. Балансы пересчитываются
            автоматически при создании транзакций.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/finance/accounts/new">
              <Plus className="mr-1.5 h-4 w-4" />
              Создать
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или банку"
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>Все типы</SelectItem>
            {(Object.keys(TYPE_LABEL) as BankAccountType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {groups.length > 0 && (
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_GROUPS}>Все группы</SelectItem>
              <SelectItem value={NO_GROUP}>Без группы</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {canManage && (
          <Label className="flex items-center gap-2 text-sm text-muted-foreground font-normal cursor-pointer select-none">
            <Checkbox
              checked={showDeleted}
              onCheckedChange={(v) => setShowDeleted(v === true)}
            />
            Показать удалённые
          </Label>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="text-sm text-muted-foreground mb-3">
          Сумма по показанным активным счетам: <span className="font-medium text-foreground tabular-nums">{formatRub(visibleTotal)}</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {accounts.length === 0
              ? "Счетов пока нет."
              : "Ничего не найдено по текущему фильтру."}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border border-border bg-background">
          {filtered.map((a) => {
            const Icon = TYPE_ICON[a.type];
            const gName = groupName(a.group_id);
            const leName = legalEntityNames[a.legal_entity_id] ?? "—";
            const deleted = !!a.deleted_at;
            return (
              <li key={a.id}>
                <Link
                  href={`/finance/accounts/${a.id}`}
                  className={cn(
                    "flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent transition-colors",
                    deleted && "opacity-60"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex aspect-square size-9 items-center justify-center rounded-md bg-muted shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{a.name}</span>
                        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {TYPE_LABEL[a.type]}
                        </span>
                        {gName && (
                          <Badge variant="secondary" className="text-xs font-normal shrink-0">
                            {gName}
                          </Badge>
                        )}
                        {deleted && (
                          <Badge variant="outline" className="text-xs font-normal shrink-0">
                            удалён
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {leName}
                        {a.bank_name ? ` • ${a.bank_name}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium tabular-nums shrink-0">
                    {formatRub(Number(a.balance), a.currency)}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
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
