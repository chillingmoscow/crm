"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  createFinanceCategory,
  updateFinanceCategory,
} from "@/lib/finance/categories";
import type {
  FinanceCategoryFormInput,
  FinanceCategoryGroupRow,
  FinanceCategoryRow,
} from "@/types/finance";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: FinanceCategoryGroupRow[];
} & (
  | { mode: "create"; defaultType: "income" | "expense"; category?: never }
  | { mode: "edit"; category: FinanceCategoryRow; defaultType?: never }
);

const NO_GROUP = "__none__";

export function CategoryFormSheet(props: Props) {
  const { open, onOpenChange, groups, mode } = props;
  const router = useRouter();

  const initial: FinanceCategoryFormInput = {
    name:        mode === "edit" ? props.category.name        : "",
    type:        mode === "edit" ? props.category.type        : props.defaultType,
    description: mode === "edit" ? props.category.description : null,
    color:       mode === "edit" ? props.category.color       : null,
    icon:        mode === "edit" ? props.category.icon        : null,
    group_id:    mode === "edit" ? props.category.group_id    : null,
    sort_order:  mode === "edit" ? props.category.sort_order  : 0,
  };

  const [form, setForm] = useState<FinanceCategoryFormInput>(initial);
  const [saving, setSaving] = useState(false);

  // When the same Sheet is reused for sequential edits, re-seed state
  // from props on each open. (Without this, the form keeps the last
  // edit's values when switching to a different category.)
  useEffect(() => {
    if (open) setForm(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode === "edit" ? props.category.id : props.defaultType]);

  // Restrict groups to those compatible with the chosen type.
  // category_groups.type is one of {income, expense, mixed, null}.
  // null/mixed are always allowed; income matches income, expense matches expense.
  const compatibleGroups = groups.filter(
    (g) => !g.type || g.type === "mixed" || g.type === form.type
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Укажите название");
      return;
    }
    setSaving(true);
    const result =
      mode === "create"
        ? await createFinanceCategory(form)
        : await updateFinanceCategory(props.category.id, form);
    setSaving(false);

    const error = "error" in result ? result.error : null;
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(mode === "create" ? "Статья создана" : "Статья сохранена");
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>
            {mode === "create"
              ? form.type === "income"
                ? "Новая статья дохода"
                : "Новая статья расхода"
              : "Редактировать статью"}
          </SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "Используется в форме транзакции, чтобы помечать доход или расход."
              : "Изменения отразятся во всех транзакциях с этой статьёй."}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col gap-4 px-6 py-4 overflow-y-auto"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Название</Label>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={form.type === "income" ? "Выручка" : "Закупка продуктов"}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-type">Тип</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm((f) => ({
                ...f,
                type: v as "income" | "expense",
                // Drop group when its type doesn't match the new category type.
                group_id:
                  f.group_id &&
                  groups.find((g) => g.id === f.group_id)?.type &&
                  groups.find((g) => g.id === f.group_id)?.type !== "mixed" &&
                  groups.find((g) => g.id === f.group_id)?.type !== v
                    ? null
                    : f.group_id,
              }))}
              disabled={mode === "edit"}
            >
              <SelectTrigger id="cat-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Доход</SelectItem>
                <SelectItem value="expense">Расход</SelectItem>
              </SelectContent>
            </Select>
            {mode === "edit" && (
              <p className="text-xs text-muted-foreground">
                Тип статьи нельзя менять — это поломало бы исторические транзакции.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-group">Группа</Label>
            <Select
              value={form.group_id ?? NO_GROUP}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, group_id: v === NO_GROUP ? null : v }))
              }
            >
              <SelectTrigger id="cat-group">
                <SelectValue placeholder="Без группы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>Без группы</SelectItem>
                {compatibleGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-color">Цвет (hex)</Label>
              <Input
                id="cat-color"
                value={form.color ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, color: e.target.value || null }))
                }
                placeholder="22c55e"
                maxLength={7}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-sort">Порядок</Label>
              <Input
                id="cat-sort"
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-description">Описание</Label>
            <Textarea
              id="cat-description"
              value={form.description ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value || null }))
              }
              placeholder="Необязательно"
              rows={3}
            />
          </div>
        </form>

        <SheetFooter className="border-t px-6 py-3 sm:justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {mode === "create" ? "Создать" : "Сохранить"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
