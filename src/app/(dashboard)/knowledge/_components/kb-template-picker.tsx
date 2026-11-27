"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Loader2, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DialogHeader,
  DialogIcon,
} from "@/components/ui/dialog";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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
  /** Управляемый режим (меню «+» дерева): владелец держит открытие,
   *  своя кнопка-иконка не рисуется. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
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
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: KbTemplatePickerProps) {
  const router = useRouter();
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined && onOpenChangeProp !== undefined;
  const open = isControlled ? openProp : openInternal;
  const setOpen = isControlled ? onOpenChangeProp : setOpenInternal;
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [templates, setTemplates] = useState<KbTemplateRow[]>([]);
  const { confirm, dialog: confirmDialog } = useConfirm();

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
    // setOpen стабилен: свой useState или setState владельца (меню «+»).
  }, [open, setOpen]);

  const onUse = async (templateId: string) => {
    setPending(templateId);
    const { slug, error } = await applyKbTemplate({
      template_id: templateId,
      parent_id: parentId,
    });
    setPending(null);
    // Hard fail: страница вообще не создалась (нет slug). Только тогда
    // не уходим со списка — иначе дубль-клик создал бы дубль-страницу.
    if (!slug) {
      toast.error(`Не удалось создать из шаблона: ${error ?? "?"}`);
      return;
    }
    // Partial fail: slug есть, но что-то не доехало (например, контент).
    // Страница уже в БД — редиректим, юзер увидит её и сможет либо
    // дописать вручную, либо удалить. Без этой ветки клик-retry создал
    // бы дубль (см. Codex #45 P1).
    if (error) {
      toast.warning(`Создана с предупреждением: ${error}`);
    }
    setOpen(false);
    router.push(`/knowledge/${slug}`);
  };

  const onDelete = async (templateId: string, name: string) => {
    const ok = await confirm({
      title: `Удалить шаблон «${name}»?`,
      description: "Страницы, уже созданные из шаблона, останутся.",
      confirmLabel: "Удалить шаблон",
      destructive: true,
    });
    if (!ok) return;
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
      {!isControlled && (
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
      )}
      <DialogContent>
        <DialogHeader>
          <DialogIcon tone="default" icon={LayoutTemplate} />
          <DialogTitle>Создать страницу из шаблона</DialogTitle>
          <DialogDescription>
            Структура и оформление шаблона перенесутся в новую страницу
          </DialogDescription>
        </DialogHeader>
        {confirmDialog}
        <div className="-mx-2 flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-2">
          {loading && (
            <div role="status" aria-label="Загружаем шаблоны" aria-busy className="space-y-3 py-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2 p-2">
                  <Skeleton className="size-6 shrink-0 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5" style={{ width: `${60 - i * 12}%` }} />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && templates.length === 0 && (
            <EmptyState
              icon={LayoutTemplate}
              title="Шаблонов пока нет"
              description="Сохраните любую страницу как шаблон в её меню ⋯"
              className="min-h-0"
            />
          )}
          {!loading &&
            grouped.map(({ category, items }) => (
              <div key={category ?? "_none"} className="flex flex-col gap-1.5">
                {category && (
                  <span className="text-xs font-medium text-muted-foreground">
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
                            <span className="truncate text-xs text-muted-foreground">
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
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                          >
                            {deleting === tmpl.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
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
