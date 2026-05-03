"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Loader2, Trash2, X, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import {
  listKbTemplates,
  applyKbTemplate,
  deleteKbTemplate,
  type KbTemplateRow,
} from "@/lib/knowledge/templates";

interface KbTemplatePickerProps {
  /** parent_id для созданной из шаблона страницы. NULL — root. */
  parentId?: string | null;
  /** Может ли текущий пользователь удалять шаблоны. */
  canManageTemplates: boolean;
}

/**
 * Picker шаблонов: открывает диалог со списком kb_templates
 * (сгруппированы по category), клик — создаёт новую страницу из
 * шаблона и редиректит на неё.
 *
 * Список фетчится при первом open'е и кэшируется на время открытого
 * диалога. Reset при закрытии — чтобы при следующем open пересмотрел
 * (на случай если в фоне created/deleted).
 */
export function KbTemplatePicker({
  parentId = null,
  canManageTemplates,
}: KbTemplatePickerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [templates, setTemplates] = useState<KbTemplateRow[]>([]);

  useEffect(() => {
    if (!open) {
      setTemplates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listKbTemplates().then(({ rows, error }) => {
      if (cancelled) return;
      setLoading(false);
      if (error) {
        toast.error(`Не удалось загрузить шаблоны: ${error}`);
        setOpen(false);
        return;
      }
      setTemplates(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onUse = async (templateId: string) => {
    setPending(templateId);
    const { slug, error } = await applyKbTemplate({
      template_id: templateId,
      parent_id: parentId,
    });
    setPending(null);
    if (error || !slug) {
      toast.error(`Не удалось создать из шаблона: ${error ?? "?"}`);
      return;
    }
    setOpen(false);
    router.push(`/knowledge/${slug}`);
    router.refresh();
  };

  const onDelete = async (templateId: string, name: string) => {
    if (!confirm(`Удалить шаблон «${name}»?`)) return;
    setDeleting(templateId);
    const { error } = await deleteKbTemplate(templateId);
    setDeleting(null);
    if (error) {
      toast.error(`Не удалось удалить: ${error}`);
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    toast.success(`Шаблон «${name}» удалён`);
  };

  // Группируем по category — чтобы в picker'е они шли блоками.
  const grouped = groupByCategory(templates);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconTooltip label="Создать из шаблона">
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Создать из шаблона"
          >
            <LayoutTemplate className="size-3.5" />
          </Button>
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="max-w-[520px] p-0 gap-0 [&>button:last-child]:hidden">
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-4">
          <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-full bg-brand/10 text-brand">
            <LayoutTemplate className="size-[18px]" />
          </span>
          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
            <DialogTitle className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
              Создать страницу из шаблона
            </DialogTitle>
            <DialogDescription className="text-sm leading-snug text-muted-foreground">
              Выберите готовый шаблон — структура и оформление подтянутся
              автоматически.
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
        <div className="px-6 pb-6 pl-[78px] flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              Загружаем шаблоны…
            </div>
          )}
          {!loading && templates.length === 0 && (
            <div className="text-sm text-muted-foreground py-4">
              Шаблонов пока нет. Создайте первый из существующей страницы —
              в меню действий страницы есть «Сохранить как шаблон».
            </div>
          )}
          {!loading &&
            grouped.map(({ category, items }) => (
              <div key={category ?? "_none"} className="flex flex-col gap-1.5">
                {category && (
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {category}
                  </span>
                )}
                <ul className="flex flex-col gap-0.5">
                  {items.map((tmpl) => (
                    <li key={tmpl.id}>
                      <div className="group flex items-center gap-2 rounded-md p-2 hover:bg-accent">
                        <span className="size-6 shrink-0 inline-flex items-center justify-center">
                          {tmpl.icon ? (
                            <KbPageIcon
                              icon={tmpl.icon}
                              color={tmpl.icon_color}
                              size={16}
                            />
                          ) : (
                            <FileText className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUse(tmpl.id)}
                          disabled={pending === tmpl.id}
                          className="flex-1 text-left flex flex-col min-w-0 disabled:opacity-50"
                        >
                          <span className="text-sm font-medium truncate">
                            {tmpl.name}
                          </span>
                          {tmpl.description && (
                            <span className="text-[12px] text-muted-foreground truncate">
                              {tmpl.description}
                            </span>
                          )}
                        </button>
                        {pending === tmpl.id && (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        )}
                        {canManageTemplates && pending !== tmpl.id && (
                          <button
                            type="button"
                            onClick={() => onDelete(tmpl.id, tmpl.name)}
                            disabled={deleting === tmpl.id}
                            aria-label={`Удалить шаблон «${tmpl.name}»`}
                            className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center size-7 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-opacity transition-colors"
                          >
                            {deleting === tmpl.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function groupByCategory(
  rows: KbTemplateRow[],
): Array<{ category: string | null; items: KbTemplateRow[] }> {
  const map = new Map<string | null, KbTemplateRow[]>();
  for (const r of rows) {
    const key = r.category ?? null;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  // Сортируем: сначала с category, потом без.
  const entries = Array.from(map.entries()).sort(([a], [b]) => {
    if (a == null) return 1;
    if (b == null) return -1;
    return a.localeCompare(b);
  });
  return entries.map(([category, items]) => ({ category, items }));
}
