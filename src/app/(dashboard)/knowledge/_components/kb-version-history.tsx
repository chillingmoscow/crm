"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, Loader2 } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { listKbPageVersions } from "@/lib/knowledge/versions";
import { restoreKbPageVersion } from "@/lib/knowledge/versions";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import type { KbBlock, KbPageVersionRow } from "@/types/knowledge";

interface KbVersionHistoryProps {
  pageId: string;
  /** Per-role gate. Disables the restore action when false. */
  canEdit: boolean;
}

/**
 * История версий страницы. Открывается через кнопку «История» в шапке
 * страницы; рендерит side-drawer (Sheet) со списком снапшотов и
 * кнопками отката. Откат — через `restoreKbPageVersion`, который
 * снова идёт через saveKbPage и создаёт новую версию (вместо
 * мутации прошлого).
 *
 * Список тянется лениво при первом открытии — чтобы не нагружать
 * каждую страницу запросом, который пользователь может никогда
 * не сделать.
 */
export function KbVersionHistory({ pageId, canEdit }: KbVersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<KbPageVersionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const router = useRouter();

  const onOpenChange = async (next: boolean) => {
    setOpen(next);
    if (next && rows === null) {
      setLoading(true);
      const { rows, error } = await listKbPageVersions(pageId);
      setLoading(false);
      if (error) {
        toast.error(`Не удалось загрузить версии: ${error}`);
        return;
      }
      setRows(rows);
    }
  };

  const onRestore = async (versionNumber: number) => {
    setRestoring(versionNumber);
    const { error } = await restoreKbPageVersion({
      page_id: pageId,
      version_number: versionNumber,
    });
    setRestoring(null);
    if (error) {
      toast.error(`Не удалось восстановить версию: ${error}`);
      return;
    }
    toast.success(`Версия ${versionNumber} восстановлена`);
    setOpen(false);
    router.refresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="size-4" />
          История
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>История версий</SheetTitle>
          <SheetDescription>
            Снимок создаётся при каждом изменении заголовка или содержимого.
            Восстановление откатывает страницу и создаёт новую версию.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4 pb-6 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Загружаем историю…
            </div>
          )}

          {!loading && rows !== null && rows.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              История пуста. Версия запишется при первом сохранении.
            </p>
          )}

          {!loading &&
            rows !== null &&
            rows.map((v, idx) => (
              <VersionRow
                key={v.id}
                row={v}
                isCurrent={idx === 0}
                canEdit={canEdit}
                restoring={restoring === v.version_number}
                onRestore={() => onRestore(v.version_number)}
              />
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Two-line preview of the version's content, derived from BlockNote
 * blocks via the same plain-text walker used for FTS. Truncated by
 * line-clamp; empty content shows nothing instead of an empty box. */
function ContentSnippet({ content }: { content: KbBlock[] }) {
  const text = blocksToPlainText(content);
  if (!text) return null;
  return (
    <p
      className="text-xs text-muted-foreground line-clamp-2"
      title={text}
    >
      {text}
    </p>
  );
}

function VersionRow({
  row,
  isCurrent,
  canEdit,
  restoring,
  onRestore,
}: {
  row: KbPageVersionRow;
  isCurrent: boolean;
  canEdit: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const created = new Date(row.created_at);
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-md border p-3",
        isCurrent && "bg-muted/40",
      )}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">v{row.version_number}</span>
          {isCurrent && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Текущая
            </span>
          )}
        </div>
        <p className="truncate text-sm text-foreground" title={row.title}>
          {row.title || "Без названия"}
        </p>
        <ContentSnippet content={row.content as unknown as KbBlock[]} />
        <p className="text-xs text-muted-foreground">
          {format(created, "d MMMM yyyy, HH:mm", { locale: ru })}{" "}
          <span className="text-muted-foreground/70">
            ({formatDistanceToNow(created, { addSuffix: true, locale: ru })})
          </span>
        </p>
      </div>
      {!isCurrent && canEdit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRestore}
          disabled={restoring}
          title="Восстановить эту версию"
        >
          {restoring ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
        </Button>
      )}
    </div>
  );
}
