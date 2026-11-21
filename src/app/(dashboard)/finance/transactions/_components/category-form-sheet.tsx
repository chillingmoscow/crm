"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createFinanceCategory } from "@/lib/finance/categories";

// Цвета статей финансов хранятся как hex (так их задаёт и страница
// «Статьи»), поэтому здесь не палитра дизайн-системы, а набор hex.
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
 * Новая статья прямо из формы операции. После создания отдаёт id — форма
 * сразу её выбирает.
 */
export function CategoryFormSheet({ open, defaultType, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">(defaultType);
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(COLOR_PALETTE[0]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setType(defaultType);
    setDescription("");
    setColor(COLOR_PALETTE[0]);
    setNameError(null);
    setServerError(null);
  }, [open, defaultType]);

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError("Укажите название статьи");
      return;
    }
    setSaving(true);
    setServerError(null);
    const { id, error } = await createFinanceCategory({
      name: name.trim(),
      type,
      description: description.trim() || null,
      color,
    }).catch(() => ({ id: null, error: "Нет связи с сервером. Проверьте соединение и повторите" }));
    setSaving(false);
    if (error || !id) {
      setServerError(error ?? "Не удалось создать статью");
      return;
    }
    toast.success("Статья создана");
    onCreated(id);
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
      title="Новая статья"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} className="min-w-36">
            {saving ? "Создаём…" : "Создать статью"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <Field label="Название" required error={nameError}>
          {(control) => (
            <Input
              {...control}
              placeholder="Например: аренда"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              autoFocus
            />
          )}
        </Field>

        <Field label="Тип">
          {(control) => (
            <OptionSelect
              {...control}
              value={type}
              onValueChange={(v) => setType(v as "income" | "expense")}
              options={[
                { value: "expense", label: "Расход" },
                { value: "income", label: "Приход" },
              ]}
            />
          )}
        </Field>

        <div className="grid gap-2">
          <span className="text-sm font-medium" id="cat-color-label">
            Цвет
          </span>
          <div role="radiogroup" aria-labelledby="cat-color-label" className="flex flex-wrap gap-2">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Цвет ${COLOR_PALETTE.indexOf(c) + 1}`}
                onClick={() => setColor(c)}
                className={cn(
                  "touch-target inline-flex size-7 items-center justify-center rounded-full text-white transition-shadow",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                  color === c && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: c }}
              >
                {color === c ? <Check className="size-3.5" /> : null}
              </button>
            ))}
          </div>
        </div>

        <Field label="Описание">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Например: что относить к этой статье"
            />
          )}
        </Field>

        {serverError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            {serverError}
          </p>
        ) : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </EditDrawer>
  );
}
