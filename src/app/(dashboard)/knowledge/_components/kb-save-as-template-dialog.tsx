"use client";

import { useState } from "react";
import { Loader2, BookmarkPlus } from "lucide-react";
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
  DialogHeader,
  DialogFooter,
  DialogIcon,
} from "@/components/ui/dialog";
import { createKbTemplate } from "@/lib/knowledge/templates";

interface KbSaveAsTemplateDialogProps {
  pageId: string;
  pageTitle: string;
  /** Controlled-mode: caller владеет open-state'ом и сам рендерит
   *  триггер (например, пункт DropdownMenu). Если оба переданы —
   *  default-icon-trigger не рендерится. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

/**
 * «Сохранить страницу как шаблон» — диалог с полями имя/описание/
 * категория, по submit'у создаёт kb_template из текущей страницы.
 * Доступен только пользователям с `kb.manage_templates`.
 *
 * Поддерживает 2 режима:
 *   1. **Standalone** (default) — рендерит icon-button-триггер 36×36,
 *      открывающий диалог. Используется если нужен отдельный topbar-action.
 *   2. **Controlled** — `open` + `onOpenChange` пробрасываются caller'ом,
 *      icon-button скрыт. Так включаем триггер из dropdown-меню
 *      (`KbPageMenu`).
 */
export function KbSaveAsTemplateDialog({
  pageId,
  pageTitle,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: KbSaveAsTemplateDialogProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined && onOpenChangeProp !== undefined;
  const open = isControlled ? openProp : openInternal;
  const setOpen = isControlled ? onOpenChangeProp : setOpenInternal;
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
      {!isControlled && (
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
      )}
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogIcon tone="default" icon={BookmarkPlus} />
            <DialogTitle>Сохранить как шаблон</DialogTitle>
            <DialogDescription>
              Содержимое страницы сохранится как шаблон — без вложений,
              комментариев и истории. Иконка и цвет тоже.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
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
          <DialogFooter>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
