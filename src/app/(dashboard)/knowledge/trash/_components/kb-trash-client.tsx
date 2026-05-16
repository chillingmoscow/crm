"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Search, Trash2 } from "lucide-react";
import {
  differenceInCalendarDays,
  isToday,
  isYesterday,
} from "date-fns";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  hardDeleteKbPages,
  restoreKbPages,
} from "@/lib/knowledge/pages";
import { TrashItemRow, type TrashRow } from "./trash-item-row";

/** Срок хранения страницы в корзине до автоудаления, дней. UI-расчёт;
 *  фактический auto-purge cron — отдельная задача (вне scope этого PR). */
const RETENTION_DAYS = 30;
interface KbTrashClientProps {
  rows: TrashRow[];
}

/** Корзина базы знаний: поиск, мультиселект, массовые
 *  «Восстановить» / «Удалить навсегда», группировка по дате удаления
 *  и обратный отсчёт хранения. Дизайн — sheerly.pen `QvQz1`. */
export function KbTrashClient({ rows }: KbTrashClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.title || "Без названия").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const groups = useMemo(() => groupByDeletion(filtered), [filtered]);

  const selectedIds = useMemo(
    () => filtered.filter((r) => selected.has(r.id)).map((r) => r.id),
    [filtered, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  // restoreKbPages / hardDeleteKbPages — partial-success: продолжают
  // после ошибки и применяют успешные. Поэтому всегда refresh'им и
  // чистим выбор, а об успехе/ошибке сообщаем независимо (Codex #314 P2).
  const runRestore = (ids: string[]) => {
    if (ids.length === 0) return;
    startTransition(async () => {
      const { restored, error } = await restoreKbPages(ids);
      if (restored > 0) {
        toast.success(
          restored > 1
            ? `Восстановлено страниц: ${restored}`
            : "Страница восстановлена",
        );
      }
      if (error) toast.error(`Часть не восстановлена: ${error}`);
      clearSelection();
      router.refresh();
    });
  };

  const runHardDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    startTransition(async () => {
      const { deleted, error } = await hardDeleteKbPages(ids);
      if (deleted > 0) {
        toast.success(
          deleted > 1
            ? `Удалено навсегда: ${deleted}`
            : "Страница удалена навсегда",
        );
      }
      if (error) toast.error(`Часть не удалена: ${error}`);
      clearSelection();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar: поиск по названию (клиентский фильтр). */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию"
          className="pl-9"
        />
      </div>

      {/* Bulk-bar — виден только при наличии выбора. */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-brand/10 px-4 py-2.5">
          <span className="flex-1 text-sm font-semibold text-brand">
            Выбрано {selectedIds.length} {pageWord(selectedIds.length)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => runRestore(selectedIds)}
            className="border-brand/30 text-brand hover:bg-brand/10 hover:text-brand"
          >
            <RotateCcw />
            Восстановить
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmBulkDelete(true)}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
            Удалить навсегда
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Ничего не найдено"
          description="По этому запросу в корзине нет страниц. Измените запрос."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {group.label}
              </h2>
              <ul className="flex flex-col overflow-hidden rounded-xl border bg-card divide-y">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <TrashItemRow
                      row={row}
                      selected={selected.has(row.id)}
                      onToggle={() => toggle(row.id)}
                      onRestore={() => runRestore([row.id])}
                      onHardDelete={() => runHardDelete([row.id])}
                      pending={pending}
                      daysLeft={daysLeft(row.deletedAt)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <AlertDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить навсегда?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedIds.length} {pageWord(selectedIds.length)} и все их
              подстраницы будут удалены безвозвратно. Это действие нельзя
              отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => runHardDelete(selectedIds)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить навсегда
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

interface TrashGroup {
  key: string;
  label: string;
  rows: TrashRow[];
}

/** Группирует по «корзинной» давности удаления: Сегодня / Вчера /
 *  На прошлой неделе / Ранее. Порядок групп фиксированный. */
function groupByDeletion(rows: TrashRow[]): TrashGroup[] {
  const order = ["today", "yesterday", "week", "earlier"] as const;
  const labels: Record<(typeof order)[number], string> = {
    today: "Сегодня",
    yesterday: "Вчера",
    week: "На прошлой неделе",
    earlier: "Ранее",
  };
  const buckets = new Map<string, TrashRow[]>();
  for (const r of rows) {
    const key = bucketOf(r.deletedAt);
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return order
    .filter((k) => buckets.has(k))
    .map((k) => ({ key: k, label: labels[k], rows: buckets.get(k)! }));
}

function bucketOf(deletedAt: string | null): string {
  if (!deletedAt) return "earlier";
  const d = new Date(deletedAt);
  if (isToday(d)) return "today";
  if (isYesterday(d)) return "yesterday";
  if (differenceInCalendarDays(new Date(), d) <= 7) return "week";
  return "earlier";
}

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return RETENTION_DAYS;
  const elapsed = differenceInCalendarDays(new Date(), new Date(deletedAt));
  return Math.max(0, RETENTION_DAYS - elapsed);
}

/** RU-склонение слова «страница» по числу. */
function pageWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "страниц";
  if (mod10 === 1) return "страница";
  if (mod10 >= 2 && mod10 <= 4) return "страницы";
  return "страниц";
}
