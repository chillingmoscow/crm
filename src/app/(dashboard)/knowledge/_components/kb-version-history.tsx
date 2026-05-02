"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  History,
  RotateCcw,
  Loader2,
  ChevronRight,
  Plus,
  Minus,
} from "lucide-react";
import { format, isToday, isYesterday, isThisYear } from "date-fns";
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
import {
  listKbPageVersions,
  restoreKbPageVersion,
  type KbPageVersionWithAuthor,
} from "@/lib/knowledge/versions";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import type { KbBlock } from "@/types/knowledge";

interface KbVersionHistoryProps {
  pageId: string;
  /** Per-role gate. Disables the restore action when false. */
  canEdit: boolean;
}

/** Versions enriched with derived per-row fields:
 *  - `delta`: chars added/removed vs previous (older) version. Older
 *    version is at idx + 1 in the newest-first list, so we precompute
 *    the diff once per row instead of per-render.
 */
type EnrichedVersion = KbPageVersionWithAuthor & {
  textLength: number;
  delta: number | null;
};

export function KbVersionHistory({ pageId, canEdit }: KbVersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<KbPageVersionWithAuthor[] | null>(null);
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

  // Pre-compute textLength per version + delta vs previous version
  // (older), then group by day. Newest-first, so the previous version
  // is at idx + 1.
  const groups = useMemo(() => {
    if (!rows) return null;
    const enriched: EnrichedVersion[] = rows.map((row, idx) => {
      const text = blocksToPlainText(row.content as unknown as KbBlock[]);
      const prev = rows[idx + 1];
      let delta: number | null = null;
      if (prev) {
        const prevText = blocksToPlainText(prev.content as unknown as KbBlock[]);
        delta = text.length - prevText.length;
      }
      return { ...row, textLength: text.length, delta };
    });
    return groupByDay(enriched);
  }, [rows]);

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

        <div className="flex flex-col gap-4 px-4 pb-6 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Загружаем историю…
            </div>
          )}

          {!loading && groups !== null && groups.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              История пуста. Версия запишется при первом сохранении.
            </p>
          )}

          {!loading &&
            groups !== null &&
            groups.map((group, groupIdx) => (
              <DayGroup
                key={group.label}
                group={group}
                defaultOpen={groupIdx === 0}
                canEdit={canEdit}
                restoringVersion={restoring}
                onRestore={onRestore}
                currentVersionNumber={rows?.[0]?.version_number ?? null}
              />
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Day grouping ──────────────────────────────────────────────────────

type DayBucket = {
  label: string;
  versions: EnrichedVersion[];
};

function dayLabel(d: Date): string {
  if (isToday(d)) return "Сегодня";
  if (isYesterday(d)) return "Вчера";
  return format(
    d,
    isThisYear(d) ? "d MMMM" : "d MMMM yyyy",
    { locale: ru },
  );
}

function groupByDay(versions: EnrichedVersion[]): DayBucket[] {
  const buckets = new Map<string, EnrichedVersion[]>();
  for (const v of versions) {
    const label = dayLabel(new Date(v.created_at));
    const arr = buckets.get(label) ?? [];
    arr.push(v);
    buckets.set(label, arr);
  }
  return Array.from(buckets, ([label, items]) => ({ label, versions: items }));
}

function DayGroup({
  group,
  defaultOpen,
  canEdit,
  restoringVersion,
  onRestore,
  currentVersionNumber,
}: {
  group: DayBucket;
  defaultOpen: boolean;
  canEdit: boolean;
  restoringVersion: number | null;
  onRestore: (versionNumber: number) => void;
  currentVersionNumber: number | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-left text-[11px]
                   font-medium uppercase tracking-wider text-muted-foreground
                   hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            open && "rotate-90",
          )}
        />
        <span>{group.label}</span>
        <span className="text-muted-foreground/60">·{" "}{group.versions.length}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {group.versions.map((v) => (
            <VersionRow
              key={v.id}
              row={v}
              isCurrent={v.version_number === currentVersionNumber}
              canEdit={canEdit}
              restoring={restoringVersion === v.version_number}
              onRestore={() => onRestore(v.version_number)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Compose first/last name with sane fallback. */
function authorName(a: { first_name: string | null; last_name: string | null }): string {
  const parts = [a.first_name, a.last_name].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" ") : "—";
}

/** Two-line preview of the version's content, derived from BlockNote
 * blocks via the same plain-text walker used for FTS. */
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

/** «+124» / «−18» / «—» (без изменений по длине). Знак — цветом, не +/−. */
function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="text-[10px] text-muted-foreground/60">первая версия</span>
    );
  }
  if (delta === 0) {
    return (
      <span className="text-[10px] text-muted-foreground/70">
        правки без изменения длины
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[10px] font-medium",
        positive
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-rose-500/10 text-rose-700 dark:text-rose-400",
      )}
      title={`${positive ? "Добавлено" : "Удалено"} ${Math.abs(delta)} символов`}
    >
      {positive ? <Plus className="size-2.5" /> : <Minus className="size-2.5" />}
      {Math.abs(delta)}
    </span>
  );
}

function VersionRow({
  row,
  isCurrent,
  canEdit,
  restoring,
  onRestore,
}: {
  row: EnrichedVersion;
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">v{row.version_number}</span>
          <DeltaBadge delta={row.delta} />
          {isCurrent && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Текущая
            </span>
          )}
        </div>
        <ContentSnippet content={row.content as unknown as KbBlock[]} />
        <p className="text-xs text-muted-foreground">
          {format(created, "HH:mm", { locale: ru })}
          {row.author && (
            <>
              {" · "}
              <span className="text-foreground/80">{authorName(row.author)}</span>
            </>
          )}
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
