"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  deactivateFinanceCategory,
  deleteFinanceCategory,
  reactivateFinanceCategory,
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
};

type TypeTab = "all" | "income" | "expense";

export function CategoriesClient({ categories, groups, canManage }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TypeTab>("all");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<null | { type: "income" | "expense" }>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const groupsById = useMemo(() => {
    const map = new Map<string, FinanceCategoryGroupRow>();
    for (const g of groups) map.set(g.id, g);
    return map;
  }, [groups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru-RU");
    return categories.filter((c) => {
      if (!showInactive && !c.is_active) return false;
      if (tab !== "all" && c.type !== tab) return false;
      if (q && !c.name.toLocaleLowerCase("ru-RU").includes(q)) return false;
      return true;
    });
  }, [categories, search, tab, showInactive]);

  const incomeRows  = filtered.filter((c) => c.type === "income");
  const expenseRows = filtered.filter((c) => c.type === "expense");

  const editing =
    editingId !== null
      ? categories.find((c) => c.id === editingId) ?? null
      : null;

  const handleDeactivate = (id: string, name: string) => {
    if (!window.confirm(`Скрыть статью «${name}»? Существующие транзакции сохранят ссылку.`)) return;
    setBusyId(id);
    startTransition(async () => {
      const { error } = await deactivateFinanceCategory(id);
      setBusyId(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Статья скрыта");
      router.refresh();
    });
  };

  const handleRestore = (id: string) => {
    setBusyId(id);
    startTransition(async () => {
      const { error } = await reactivateFinanceCategory(id);
      setBusyId(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Статья восстановлена");
      router.refresh();
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (
      !window.confirm(
        `Удалить статью «${name}» безвозвратно? Если на неё ссылаются транзакции, ссылка станет пустой.`
      )
    ) {
      return;
    }
    setBusyId(id);
    startTransition(async () => {
      const { error } = await deleteFinanceCategory(id);
      setBusyId(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Статья удалена");
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
        {canManage && (
          <Label className="flex items-center gap-2 text-sm text-muted-foreground font-normal cursor-pointer select-none">
            <Checkbox
              checked={showInactive}
              onCheckedChange={(v) => setShowInactive(v === true)}
            />
            Показать скрытые
          </Label>
        )}
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
            onDeactivate={handleDeactivate}
            onRestore={handleRestore}
            onDelete={handleDelete}
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
            onDeactivate={handleDeactivate}
            onRestore={handleRestore}
            onDelete={handleDelete}
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
  onDeactivate,
  onRestore,
  onDelete,
}: {
  title: string;
  icon: React.ReactNode;
  rows: FinanceCategoryRow[];
  groupsById: Map<string, FinanceCategoryGroupRow>;
  canManage: boolean;
  busyId: string | null;
  onEdit: (id: string) => void;
  onDeactivate: (id: string, name: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string, name: string) => void;
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
            const inactive = !row.is_active;
            return (
              <li
                key={row.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2",
                  inactive && "opacity-60"
                )}
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
                  {inactive && (
                    <Badge variant="outline" className="text-xs font-normal shrink-0">
                      скрыта
                    </Badge>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(row.id)}
                      disabled={busyId === row.id}
                      title="Редактировать"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {row.is_active ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeactivate(row.id, row.name)}
                        disabled={busyId === row.id}
                        title="Скрыть"
                      >
                        {busyId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onRestore(row.id)}
                        disabled={busyId === row.id}
                        title="Восстановить"
                      >
                        {busyId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {!row.is_active && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(row.id, row.name)}
                        disabled={busyId === row.id}
                        title="Удалить навсегда"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
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
