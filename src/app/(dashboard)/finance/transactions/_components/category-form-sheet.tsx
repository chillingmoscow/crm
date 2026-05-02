"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createFinanceCategory } from "@/lib/finance/categories";

import { generateRandomColor } from "../_lib/utils";

const COLOR_PALETTE = [
  "#FF6B6B", "#FF9F43", "#FFC93C", "#A0E14C",
  "#4ECDC4", "#45B7D1", "#5C6BC0", "#7E57C2",
  "#AB47BC", "#EC407A", "#66BB6A", "#9CCC65",
] as const;

type Props = {
  open: boolean;
  defaultType: "income" | "expense";
  onClose: () => void;
  onCreated: (id: string) => void;
};

/**
 * Inline-create sheet for a finance category. After save we surface the
 * new id to the caller — the transaction form's category picker
 * auto-selects it without race against context refresh.
 */
export function CategoryFormSheet({ open, defaultType, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">(defaultType);
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(COLOR_PALETTE[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setType(defaultType);
      setDescription("");
      setColor(COLOR_PALETTE[0]);
    }
  }, [open, defaultType]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Укажите название статьи");
      return;
    }
    setSaving(true);
    const { id, error } = await createFinanceCategory({
      name: name.trim(),
      type,
      description: description.trim() || null,
      color,
    });
    setSaving(false);
    if (error || !id) {
      toast.error(error ?? "Не удалось создать статью");
      return;
    }
    toast.success("Статья создана");
    onCreated(id);
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Новая статья"
      description="Создайте статью расхода или прихода и применяйте её в операциях."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Создать
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="cat-name">
          Название <span className="text-destructive">*</span>
        </Label>
        <Input
          id="cat-name"
          placeholder="Например: Аренда офиса"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label>Тип</Label>
        <Select value={type} onValueChange={(v) => setType(v as "income" | "expense")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">Приход</SelectItem>
            <SelectItem value="expense">Расход</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Цвет метки</Label>
          <button
            type="button"
            onClick={() => setColor(generateRandomColor())}
            className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
          >
            <RefreshCw className="h-3 w-3" />
            Сменить
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn(
                "h-7 w-7 rounded-full transition-all",
                color === c
                  ? "ring-2 ring-offset-2 ring-brand ring-offset-background"
                  : "hover:scale-110"
              )}
              style={{ backgroundColor: c }}
              aria-label={`Цвет ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cat-desc">Описание</Label>
        <Textarea
          id="cat-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Необязательно — например, контекст или комментарий"
        />
      </div>
    </EditDrawer>
  );
}
