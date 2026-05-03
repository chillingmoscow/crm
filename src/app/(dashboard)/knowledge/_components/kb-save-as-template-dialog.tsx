"use client";

import { useState } from "react";
import { Loader2, BookmarkPlus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { createKbTemplate } from "@/lib/knowledge/templates";

interface KbSaveAsTemplateDialogProps {
  pageId: string;
  pageTitle: string;
}

/**
 * «Сохранить страницу как шаблон» — кнопка в KbPageActions для
 * пользователей с `kb.manage_templates`. Без этого права кнопка
 * не рендерится.
 *
 * Диалог: name (по дефолту = page.title) + опциональные description /
 * category. Submit → createKbTemplate(source_page_id=pageId).
 * После успеха — toast «Шаблон сохранён».
 */
export function KbSaveAsTemplateDialog({
  pageId,
  pageTitle,
}: KbSaveAsTemplateDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(pageTitle || "Без названия");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Укажите название шаблона");
      return;
    }
    setPending(true);
    const { error } = await createKbTemplate({
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      source_page_id: pageId,
    });
    setPending(false);
    if (error) {
      toast.error(`Не удалось сохранить шаблон: ${error}`);
      return;
    }
    toast.success(`Шаблон «${name.trim()}» сохранён`);
    setOpen(false);
    // Reset для следующего открытия (с дефолтным title).
    setName(pageTitle || "Без названия");
    setDescription("");
    setCategory("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconTooltip label="Сохранить как шаблон">
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Сохранить как шаблон"
            className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <BookmarkPlus className="w-[18px] h-[18px]" />
          </button>
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="max-w-[440px] p-0 gap-0 [&>button:last-child]:hidden">
        <form onSubmit={onSubmit}>
          <div className="flex items-start gap-3.5 px-6 pt-6 pb-4">
            <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-full bg-brand/10 text-brand">
              <BookmarkPlus className="size-[18px]" />
            </span>
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
              <DialogTitle className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
                Сохранить как шаблон
              </DialogTitle>
              <DialogDescription className="text-sm leading-snug text-muted-foreground">
                Контент страницы (без attachments / комментариев / истории)
                сохранится как готовый blueprint. Иконка и цвет тоже
                подтянутся.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Закрыть"
                className="inline-flex shrink-0 items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </div>
          <div className="px-6 pb-4 pl-[78px] flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kb-tpl-name">Название</Label>
              <Input
                id="kb-tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kb-tpl-category">Категория (опц.)</Label>
              <Input
                id="kb-tpl-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Например: Регламенты, Онбординг"
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kb-tpl-description">Описание (опц.)</Label>
              <Input
                id="kb-tpl-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Когда использовать этот шаблон"
                disabled={pending}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookmarkPlus className="size-4" />
              )}
              Сохранить шаблон
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
