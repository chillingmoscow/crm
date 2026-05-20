"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  Pencil,
  Plus,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  archiveFinanceCategory,
} from "@/lib/finance/categories";
import type {
  FinanceCategoryGroupRow,
  FinanceCategoryRow,
} from "@/types/finance";
import { CategoryFormSheet } from "./category-form";

type Props = {
  categories: FinanceCategoryRow[];
  groups: FinanceCategoryGroupRow[];
  canManage: boolean;
  archivedCount: number;
};

type TypeTab = "all" | "income" | "expense";

export function CategoriesClient({ categories, groups, canManage, archivedCount }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TypeTab>("all");
  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<null | { type: "income" | "expense" }>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const groupsById = useMemo(() => {
    const map = new Map<string, FinanceCategoryGroupRow>();
    for (const g of groups) map.set(g.id, g);
    return map;
  }, [groups]);

  // Архивные не показываем в общем списке — для них /archive страница.
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru-RU");
    return categories.filter((c) => {
      if (c.archived_at) return false;
      if (tab !== "all" && c.type !== tab) return false;
      if (q && !c.name.toLocaleLowerCase("ru-RU").includes(q)) return false;
      return true;
    });
  }, [categories, search, tab]);

  const incomeRows  = filtered.filter((c) => c.type === "income");
  const expenseRows = filtered.filter((c) => c.type === "expense");

  const editing =
    editingId !== null
      ? categories.find((c) => c.id === editingId) ?? null
      : null;

  const handleArchive = (id: string, name: string) => {
    if (!window.confirm(`Архивировать статью «${name}»? Существующие транзакции сохранят ссылку. Восстановить можно из /finance/categories/archive.`)) return;
    setBusyId(id);
    startTransition(async () => {
      const { error } = await archiveFinanceCategory(id, { confirmName: name });
      setBusyId(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Статья в архиве");
      router.refresh();
    });
  };

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Статьи доходов и расходов</h2>
          <p className="text-sm text-muted-foreground">
            Используются в транзакциях для разделения денежных потоков.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateMode({ type: "income" })}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Новая статья дохода
            </Button>
            <Button
              type="button"
              onClick={() => setCreateMode({ type: "expense" })}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Новая статья расхода
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border bg-background p-0.5 text-sm">
          <TabButton active={tab === "all"}     onClick={() => setTab("all")}>Все</TabButton>
          <TabButton active={tab === "income"}  onClick={() => setTab("income")}>Доходы</TabButton>
          <TabButton active={tab === "expense"} onClick={() => setTab("expense")}>Расходы</TabButton>
        </div>
        <div className="relative flex-1 min-w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию"
            className="pl-9"
          />
        </div>
        {archivedCount > 0 ? (
          <Button asChild variant="outline" size="sm" className="text-muted-foreground">
            <Link href="/finance/categories/archive">
              <Archive className="mr-1.5 h-4 w-4" />
              Архив ({archivedCount})
            </Link>
          </Button>
        ) : null}
      </div>

      {/* Lists */}
      <div className="grid gap-6 md:grid-cols-2">
        {(tab === "all" || tab === "income") && (
          <CategoryColumn
            title="Доходы"
            icon={<ArrowUpCircle className="h-4 w-4 text-emerald-600" />}
            rows={incomeRows}
            groupsById={groupsById}
            canManage={canManage}
            busyId={busyId}
            onEdit={setEditingId}
            onArchive={handleArchive}
          />
        )}
        {(tab === "all" || tab === "expense") && (
          <CategoryColumn
            title="Расходы"
            icon={<ArrowDownCircle className="h-4 w-4 text-rose-600" />}
            rows={expenseRows}
            groupsById={groupsById}
            canManage={canManage}
            busyId={busyId}
            onEdit={setEditingId}
            onArchive={handleArchive}
          />
        )}
      </div>

      {/* Create / edit sheet */}
      {canManage && createMode && (
        <CategoryFormSheet
          mode="create"
          defaultType={createMode.type}
          groups={groups}
          open
          onOpenChange={(o) => !o && setCreateMode(null)}
        />
      )}
      {canManage && editing && (
        <CategoryFormSheet
          mode="edit"
          category={editing}
          groups={groups}
          open
          onOpenChange={(o) => !o && setEditingId(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-sm transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function CategoryColumn({
  title,
  icon,
  rows,
  groupsById,
  canManage,
  busyId,
  onEdit,
  onArchive,
}: {
  title: string;
  icon: React.ReactNode;
  rows: FinanceCategoryRow[];
  groupsById: Map<string, FinanceCategoryGroupRow>;
  canManage: boolean;
  busyId: string | null;
  onEdit: (id: string) => void;
  onArchive: (id: string, name: string) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
        <span className="text-xs">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic px-1">Нет статей</p>
      ) : (
        <ul className="divide-y rounded-md border bg-background">
          {rows.map((row) => {
            const group = row.group_id ? groupsById.get(row.group_id) : null;
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {row.color && (
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: hexFromInput(row.color) }}
                      aria-hidden
                    />
                  )}
                  <span className="truncate text-sm">{row.name}</span>
                  {group && (
                    <Badge variant="secondary" className="text-xs font-normal shrink-0">
                      {group.name}
                    </Badge>
                  )}
                  {row.is_system && (
                    <Badge variant="outline" className="text-xs font-normal shrink-0">
                      системная
                    </Badge>
                  )}
                </div>
                {canManage && !row.is_system && (
                  <div className="flex items-center gap-1 shrink-0">
                    <IconTooltip label="Редактировать">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(row.id)}
                        disabled={busyId === row.id}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </IconTooltip>
                    <IconTooltip label="Архивировать">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onArchive(row.id, row.name)}
                        disabled={busyId === row.id}
                      >
                        {busyId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </Button>
                    </IconTooltip>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Tolerate `#abcdef` or `abcdef` from the DB column.
function hexFromInput(input: string): string {
  return input.startsWith("#") ? input : `#${input}`;
}
