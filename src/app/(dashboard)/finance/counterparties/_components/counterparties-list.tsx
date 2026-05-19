"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  CounterpartyGroupRow,
  CounterpartyRow,
} from "@/types/finance";

type Props = {
  counterparties: CounterpartyRow[];
  groups: CounterpartyGroupRow[];
  canManage: boolean;
  archivedCount: number;
};

const ALL_GROUPS = "__all__";
const NO_GROUP = "__none__";

const LEGAL_FORM_LABELS: Record<string, string> = {
  IP:    "ИП",
  OOO:   "ООО",
  AO:    "АО",
  PAO:   "ПАО",
  NKO:   "НКО",
  OTHER: "—",
};

export function CounterpartiesList({ counterparties, groups, canManage, archivedCount }: Props) {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);

  // Архивные в общем списке не показываем — для них отдельная страница
  // /finance/counterparties/archive. Список тут — только live.
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru-RU");
    const cleanQ = q.replace(/\D/g, "");
    return counterparties.filter((cp) => {
      if (cp.deleted_at) return false;
      if (groupFilter === NO_GROUP && cp.group_id) return false;
      if (groupFilter !== ALL_GROUPS && groupFilter !== NO_GROUP && cp.group_id !== groupFilter) return false;
      if (!q) return true;
      const name = cp.name.toLocaleLowerCase("ru-RU");
      if (name.includes(q)) return true;
      if (cp.contact_person && cp.contact_person.toLocaleLowerCase("ru-RU").includes(q)) return true;
      // INN search: ignore non-digits in user query so "ИНН 7707..." still matches.
      if (cleanQ.length >= 4 && cp.inn && cp.inn.includes(cleanQ)) return true;
      return false;
    });
  }, [counterparties, search, groupFilter]);

  const groupName = (id: string | null): string | null => {
    if (!id) return null;
    return groups.find((g) => g.id === id)?.name ?? null;
  };

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Контрагенты</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Поставщики, клиенты и партнёры аккаунта.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archivedCount > 0 ? (
            <Button asChild variant="outline" size="sm" className="text-muted-foreground">
              <Link href="/finance/counterparties/archive">
                <Archive className="mr-1.5 h-4 w-4" />
                Архив ({archivedCount})
              </Link>
            </Button>
          ) : null}
          {canManage && (
            <Button asChild>
              <Link href="/finance/counterparties/new">
                <Plus className="mr-1.5 h-4 w-4" />
                Создать
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, ИНН, контактному лицу"
            className="pl-9"
          />
        </div>
        {groups.length > 0 && (
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-56">
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
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {counterparties.length === 0
              ? "Контрагентов пока нет."
              : "Ничего не найдено по текущему фильтру."}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border border-border bg-background">
          {filtered.map((cp) => {
            const gName = groupName(cp.group_id);
            const deleted = !!cp.deleted_at;
            return (
              <li key={cp.id}>
                <Link
                  href={`/finance/counterparties/${cp.id}`}
                  className={cn(
                    "flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent transition-colors",
                    deleted && "opacity-60"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{cp.name}</span>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {LEGAL_FORM_LABELS[cp.legal_form] ?? cp.legal_form}
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
                      {cp.inn ? `ИНН ${cp.inn}` : "ИНН не указан"}
                      {cp.contact_person ? ` • ${cp.contact_person}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {cp.dadata_synced_at
                      ? `DaData ${new Date(cp.dadata_synced_at).toLocaleDateString("ru-RU")}`
                      : "вручную"}
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
