"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ChevronRight,
  Eye,
  FileText,
  History,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  getKbPageVersion,
  getKbPageVersionDiffData,
  listKbPageVersions,
  restoreKbPageVersion,
  type KbPageVersionWithAuthor,
  type KbVersionDiffData,
} from "@/lib/knowledge/versions";
import type { KbBlock, KbPageVersionRow } from "@/types/knowledge";

interface KbVersionHistoryProps {
  pageId: string;
  /** Per-role gate. Disables the restore action when false. */
  canEdit: boolean;
  /** Controlled-mode: caller владеет open-state'ом и сам рендерит
   *  триггер. Если оба переданы — default-icon-trigger не рендерится. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

type EnrichedVersion = KbPageVersionWithAuthor & {
  textLength: number;
  delta: number | null;
};

type VersionSession = {
  id: string;
  authorKey: string;
  author: EnrichedVersion["author"];
  startAt: Date;
  endAt: Date;
  versions: EnrichedVersion[];
  changeKinds: string[];
  delta: number | null;
};

type DayBucket = {
  label: string;
  sessions: VersionSession[];
};

const SESSION_WINDOW_MS = 15 * 60 * 1000;
const DIFF_TOKEN_LIMIT = 1600;
const DIFF_GROUP_LIMIT = 20;
const KbVersionSnapshotPreview = dynamic(
  () =>
    import(
      "@/app/(dashboard)/knowledge/_components/kb-version-snapshot-preview"
    ).then((m) => m.KbVersionSnapshotPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Загружаем снимок страницы…
      </div>
    ),
  },
);

export function KbVersionHistory({
  pageId,
  canEdit,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: KbVersionHistoryProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined && onOpenChangeProp !== undefined;
  const open = isControlled ? openProp : openInternal;
  const setOpen = isControlled ? onOpenChangeProp : setOpenInternal;
  const [rows, setRows] = useState<KbPageVersionWithAuthor[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listKbPageVersions(pageId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setRows([]);
      return;
    }
    setRows(result.rows);
  }, [pageId]);

  useEffect(() => {
    setRows(null);
    setLoading(false);
    setError(null);
    setRestoring(null);
  }, [pageId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
  };

  const onRestore = async (versionNumber: number) => {
    setRestoring(versionNumber);
    const result = await restoreKbPageVersion({
      page_id: pageId,
      version_number: versionNumber,
    });
    setRestoring(null);
    if (result.error) {
      toast.error(`Не удалось восстановить версию: ${result.error}`);
      return;
    }
    toast.success("Версия восстановлена");
    setOpen(false);
    router.refresh();
  };

  const { groups, sessionCount } = useMemo(() => {
    if (!rows) return { groups: null, sessionCount: 0 };
    const enriched: EnrichedVersion[] = rows.map((row, idx) => {
      const textLength = row.text_length ?? row.plain_text.length;
      const prev = rows[idx + 1];
      const prevLength = prev
        ? (prev.text_length ?? prev.plain_text.length)
        : null;
      return {
        ...row,
        textLength,
        delta: prevLength === null ? null : textLength - prevLength,
      };
    });
    const sessions = groupIntoSessions(pruneTechnicalVersions(enriched));
    return {
      groups: groupSessionsByDay(sessions),
      sessionCount: sessions.length,
    };
  }, [rows]);

  const currentVersionNumber = rows?.[0]?.version_number ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {!isControlled && (
        <IconTooltip label="История версий">
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="История версий"
              className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <History className="w-[18px] h-[18px]" />
            </button>
          </SheetTrigger>
        </IconTooltip>
      )}
      <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-[680px]">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <SheetTitle className="text-xl">История версий</SheetTitle>
                <SheetDescription className="max-w-[520px] text-sm leading-5">
                  Здесь собраны точки восстановления страницы. Можно
                  посмотреть снимок версии, увидеть только изменённые
                  фрагменты и при необходимости откатиться.
                </SheetDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <MetricBadge
                value={rows?.length ?? 0}
                label={plural(rows?.length ?? 0, "версия", "версии", "версий")}
              />
              <MetricBadge
                value={sessionCount}
                label={plural(sessionCount, "сессия", "сессии", "сессий")}
              />
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <VersionsPane
              loading={loading}
              error={error}
              onRetry={load}
              groups={groups}
              canEdit={canEdit}
              currentVersionNumber={currentVersionNumber}
              restoring={restoring}
              onRestore={onRestore}
              pageId={pageId}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetricBadge({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground">
      {value} {label}
    </span>
  );
}

function VersionsPane({
  loading,
  error,
  onRetry,
  groups,
  canEdit,
  currentVersionNumber,
  restoring,
  onRestore,
  pageId,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  groups: DayBucket[] | null;
  canEdit: boolean;
  currentVersionNumber: number | null;
  restoring: number | null;
  onRestore: (versionNumber: number) => void;
  pageId: string;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (groups !== null && groups.length === 0) return <EmptyState />;
  if (!groups) return null;

  return (
    <div className="space-y-6">
      {groups.map((group, idx) => (
        <DayGroup
          key={group.label}
          group={group}
          defaultOpen={idx === 0}
          canEdit={canEdit}
          currentVersionNumber={currentVersionNumber}
          restoringVersion={restoring}
          onRestore={onRestore}
          pageId={pageId}
        />
      ))}
    </div>
  );
}

function LoadingState({ label = "Загружаем историю…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function ErrorState({
  title = "Не удалось загрузить историю",
  error,
  onRetry,
}: {
  title?: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <History className="mx-auto size-5 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">История пока пуста</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Первая версия появится после изменения содержимого, заголовка или свойств.
      </p>
    </div>
  );
}

function DayGroup({
  group,
  defaultOpen,
  canEdit,
  currentVersionNumber,
  restoringVersion,
  onRestore,
  pageId,
}: {
  group: DayBucket;
  defaultOpen: boolean;
  canEdit: boolean;
  currentVersionNumber: number | null;
  restoringVersion: number | null;
  onRestore: (versionNumber: number) => void;
  pageId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="sticky top-0 z-10 flex w-full items-center gap-2 bg-background/95 py-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        <span>{group.label}</span>
        <span
          className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          aria-label={`${group.sessions.length} ${plural(group.sessions.length, "сессия", "сессии", "сессий")}`}
        >
          {group.sessions.length}
        </span>
      </button>
      {open && (
        <div className="space-y-2">
          {group.sessions.map((session) => (
            <VersionSessionCard
              key={session.id}
              session={session}
              canEdit={canEdit}
              currentVersionNumber={currentVersionNumber}
              restoringVersion={restoringVersion}
              onRestore={onRestore}
              pageId={pageId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function VersionSessionCard({
  session,
  canEdit,
  currentVersionNumber,
  restoringVersion,
  onRestore,
  pageId,
}: {
  session: VersionSession;
  canEdit: boolean;
  currentVersionNumber: number | null;
  restoringVersion: number | null;
  onRestore: (versionNumber: number) => void;
  pageId: string;
}) {
  const [open, setOpen] = useState(false);
  const changedCount = session.versions.length;

  return (
    <article className="overflow-hidden rounded-lg border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/20"
      >
        <Avatar author={session.author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{authorName(session.author)}</span>
            <span className="text-sm text-muted-foreground">
              {timeRange(session.startAt, session.endAt)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {session.changeKinds.map((kind) => (
              <ChangeKindBadge key={kind} kind={kind} />
            ))}
            <DeltaBadge delta={session.delta} />
            <span className="text-xs text-muted-foreground">
              {changedCount} {plural(changedCount, "сохранение", "сохранения", "сохранений")}
            </span>
          </div>
        </div>
        <ChevronRight
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="divide-y border-t">
            {session.versions.map((version) => (
              <VersionRow
                key={version.id}
                row={version}
                pageId={pageId}
                isCurrent={version.version_number === currentVersionNumber}
                canEdit={canEdit}
                restoring={restoringVersion === version.version_number}
                onRestore={() => onRestore(version.version_number)}
              />
            ))}
        </div>
      )}
    </article>
  );
}

function VersionRow({
  row,
  pageId,
  isCurrent,
  canEdit,
  restoring,
  onRestore,
}: {
  row: EnrichedVersion;
  pageId: string;
  isCurrent: boolean;
  canEdit: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffData, setDiffData] = useState<KbVersionDiffData | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<KbPageVersionRow | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const loadDiff = async () => {
    if (diffData || loadingDiff) return;
    setLoadingDiff(true);
    setDiffError(null);
    const result = await getKbPageVersionDiffData(pageId, row.version_number);
    setLoadingDiff(false);
    if (result.error) {
      setDiffError(result.error);
      return;
    }
    setDiffData(result.row);
  };

  const loadSnapshot = async () => {
    if (snapshot || loadingSnapshot) return;
    setLoadingSnapshot(true);
    setSnapshotError(null);
    const result = await getKbPageVersion(pageId, row.version_number);
    setLoadingSnapshot(false);
    if (result.error) {
      setSnapshotError(result.error);
      return;
    }
    if (!result.row) {
      setSnapshotError("Версия не найдена");
      return;
    }
    setSnapshot(result.row);
  };

  const onToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadDiff();
  };

  const onPreview = () => {
    setPreviewOpen(true);
    void loadSnapshot();
  };

  return (
    <div className={cn("bg-background", isCurrent && "bg-primary/5")}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
          />
          <span className="text-sm font-medium">Изменения</span>
          {isCurrent && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              текущая
            </span>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {format(new Date(row.updated_at), "HH:mm", { locale: ru })}
          </span>
          <DeltaBadge delta={row.delta} />
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPreview}
          title="Просмотреть версию"
        >
          <Eye className="size-4" />
          Просмотреть
        </Button>
      </div>
      {expanded && (
        <div className="border-t bg-muted/15 px-4 py-3">
          {loadingDiff && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Строим diff…
            </div>
          )}
          {!loadingDiff && diffError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {diffError}
            </div>
          )}
          {!loadingDiff && diffData && (
            <TextDiff before={diffData.previous_plain_text} after={diffData.plain_text} />
          )}
        </div>
      )}
      <VersionPreviewDialog
        row={row}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        snapshot={snapshot}
        loading={loadingSnapshot}
        error={snapshotError}
        canRestore={canEdit && !isCurrent}
        restoring={restoring}
        onRestore={onRestore}
        pageId={pageId}
      />
    </div>
  );
}

function VersionPreviewDialog({
  row,
  open,
  onOpenChange,
  snapshot,
  loading,
  error,
  canRestore,
  restoring,
  onRestore,
  pageId,
}: {
  row: EnrichedVersion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: KbPageVersionRow | null;
  loading: boolean;
  error: string | null;
  canRestore: boolean;
  restoring: boolean;
  onRestore: () => void;
  pageId: string;
}) {
  const metaLabel = format(new Date(row.updated_at), "d MMMM yyyy, HH:mm", {
    locale: ru,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-[1440px] flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <DialogTitle className="text-xl">Снимок версии</DialogTitle>
              <DialogDescription>
                Полный read-only просмотр страницы перед восстановлением.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                {authorName(row.author)}
              </span>
              <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                {metaLabel}
              </span>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10">
          {loading && (
            <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Загружаем снимок страницы…
            </div>
          )}
          {!loading && error && (
            <div className="px-6 py-6">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="size-4" />
                {error}
              </div>
            </div>
          )}
          {!loading && !error && snapshot && (
            <KbVersionSnapshotPreview
              pageId={pageId}
              title={snapshot.title}
              icon={snapshot.icon}
              iconColor={snapshot.icon_color}
              content={((snapshot.content as unknown as KbBlock[]) ?? [])}
              properties={snapshot.properties}
            />
          )}
        </div>
        <div className="shrink-0 border-t bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Восстановление создаст новую текущую версию страницы.
            </p>
            <DialogFooter className="gap-2 p-0">
              <DialogClose asChild>
                <Button variant="outline">Закрыть</Button>
              </DialogClose>
              {canRestore && (
                <Button onClick={onRestore} disabled={restoring || loading}>
                  {restoring ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  Восстановить эту версию
                </Button>
              )}
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TextDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const { changes, hiddenCount, truncated } = useMemo(
    () => buildChangeSummary(before, after),
    [before, after],
  );
  if (!before && !after) {
    return (
      <p className="text-sm text-muted-foreground">
        В этой версии нет текстового предпросмотра. Полный снимок доступен
        для восстановления.
      </p>
    );
  }
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Текст не изменился. Проверьте бейджи выше: возможно, менялись свойства,
        заголовок или иконка.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Только изменённые фрагменты
        </span>
        {(truncated || hiddenCount > 0) && (
          <span>
            {truncated
              ? "diff укорочен"
              : `скрыто ${hiddenCount} ${plural(hiddenCount, "изменение", "изменения", "изменений")}`}
          </span>
        )}
      </div>
      <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-md bg-muted/35 p-3 text-sm leading-6">
        {changes.map((change, idx) => (
          <div key={idx} className="space-y-1.5 rounded-md border bg-background/70 p-2.5">
            {change.removed && (
              <div className="flex gap-2">
                <span className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded bg-rose-500/10 px-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                  Удалено
                </span>
                <del className="min-w-0 whitespace-pre-wrap break-words text-rose-800 decoration-rose-500/60 dark:text-rose-300">
                  {change.removed}
                </del>
              </div>
            )}
            {change.added && (
              <div className="flex gap-2">
                <span className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  Добавлено
                </span>
                <ins className="min-w-0 whitespace-pre-wrap break-words text-emerald-800 no-underline dark:text-emerald-300">
                  {change.added}
                </ins>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangeKindBadge({ kind }: { kind: string }) {
  const meta =
    kind === "title"
      ? { label: "заголовок", icon: FileText }
      : kind === "properties"
        ? { label: "свойства", icon: SlidersHorizontal }
        : kind === "icon"
          ? { label: "иконка", icon: FileText }
          : kind === "restore"
            ? { label: "восстановление", icon: Undo2 }
            : { label: "контент", icon: FileText };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-xs text-muted-foreground/70">первая версия</span>;
  }
  if (delta === 0) {
    return <span className="text-xs text-muted-foreground/70">без изменения длины</span>;
  }
  const positive = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium",
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

function Avatar({ author }: { author: EnrichedVersion["author"] }) {
  const name = authorName(author);
  if (author?.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={author.avatar_url}
        alt={name}
        className="size-8 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function authorName(author: EnrichedVersion["author"]): string {
  if (!author) return "Неизвестный автор";
  const parts = [author.first_name, author.last_name].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" ") : "Неизвестный автор";
}

function authorKey(row: EnrichedVersion): string {
  return row.created_by ?? "unknown";
}

function groupIntoSessions(rows: EnrichedVersion[]): VersionSession[] {
  const sessions: VersionSession[] = [];
  let current: VersionSession | null = null;

  for (const row of rows) {
    if (!current || !canJoinSession(current, row)) {
      current = createSession(row);
      sessions.push(current);
      continue;
    }
    current.versions.push(row);
    current.startAt = new Date(row.created_at);
    current.changeKinds = mergeKinds(current.changeKinds, row.change_kinds);
    current.delta = sumDelta(current.delta, row.delta);
  }

  return sessions;
}

function pruneTechnicalVersions(rows: EnrichedVersion[]): EnrichedVersion[] {
  const kept: EnrichedVersion[] = [];

  for (const row of rows) {
    const newer = kept[kept.length - 1];
    if (newer && isTechnicalNearDuplicate(newer, row)) {
      continue;
    }
    kept.push(row);
  }

  return kept.filter((row, idx, arr) => {
    const older = arr[idx + 1];
    return !isPureTechnicalNoop(row, older);
  });
}

function isTechnicalNearDuplicate(
  newer: EnrichedVersion,
  older: EnrichedVersion,
): boolean {
  if (authorKey(newer) !== authorKey(older)) return false;
  if (hasStructuredChange(newer) || hasStructuredChange(older)) return false;

  const gap =
    new Date(newer.updated_at).getTime() - new Date(older.updated_at).getTime();
  if (gap < 0 || gap > SESSION_WINDOW_MS) return false;

  return comparableSnapshotKey(newer) === comparableSnapshotKey(older);
}

function isPureTechnicalNoop(
  row: EnrichedVersion,
  older: EnrichedVersion | undefined,
): boolean {
  if (!older) return false;
  if (hasStructuredChange(row)) return false;
  if (row.delta !== 0 && row.delta !== null) return false;
  return comparableSnapshotKey(row) === comparableSnapshotKey(older);
}

function hasStructuredChange(row: EnrichedVersion): boolean {
  return (row.change_kinds ?? []).some((kind) =>
    kind === "properties" ||
    kind === "icon" ||
    kind === "restore" ||
    kind === "title",
  );
}

function comparableSnapshotKey(row: EnrichedVersion): string {
  return [
    normalizeComparableText(row.title),
    normalizeComparableText(row.plain_text),
  ].join("::");
}

function normalizeComparableText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function createSession(row: EnrichedVersion): VersionSession {
  return {
    id: row.id,
    authorKey: authorKey(row),
    author: row.author,
    startAt: new Date(row.created_at),
    endAt: new Date(row.updated_at),
    versions: [row],
    changeKinds: mergeKinds([], row.change_kinds),
    delta: row.delta,
  };
}

function canJoinSession(session: VersionSession, row: EnrichedVersion): boolean {
  if (session.authorKey !== authorKey(row)) return false;
  const oldest = session.versions[session.versions.length - 1];
  const gap =
    new Date(oldest.created_at).getTime() - new Date(row.updated_at).getTime();
  return gap >= 0 && gap <= SESSION_WINDOW_MS;
}

function groupSessionsByDay(sessions: VersionSession[]): DayBucket[] {
  const buckets = new Map<string, VersionSession[]>();
  for (const session of sessions) {
    const label = dayLabel(session.endAt);
    const arr = buckets.get(label) ?? [];
    arr.push(session);
    buckets.set(label, arr);
  }
  return Array.from(buckets, ([label, items]) => ({ label, sessions: items }));
}

function mergeKinds(a: string[], b: string[] | null | undefined): string[] {
  const order = ["restore", "title", "content", "properties", "icon"];
  const set = new Set<string>([...a, ...(b && b.length > 0 ? b : ["content"])]);
  return Array.from(set).sort((x, y) => {
    const ax = order.indexOf(x);
    const ay = order.indexOf(y);
    return (ax === -1 ? 99 : ax) - (ay === -1 ? 99 : ay);
  });
}

function sumDelta(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function dayLabel(d: Date): string {
  if (isToday(d)) return "Сегодня";
  if (isYesterday(d)) return "Вчера";
  return format(d, isThisYear(d) ? "d MMMM" : "d MMMM yyyy", { locale: ru });
}

function timeRange(start: Date, end: Date): string {
  const a = format(start, "HH:mm", { locale: ru });
  const b = format(end, "HH:mm", { locale: ru });
  return a === b ? a : `${a}–${b}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

type DiffPart = { type: "same" | "add" | "del"; text: string };
type DiffChange = { added: string; removed: string };

function buildWordDiff(before: string, after: string): {
  parts: DiffPart[];
  truncated: boolean;
} {
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  const truncated =
    beforeTokens.length > DIFF_TOKEN_LIMIT || afterTokens.length > DIFF_TOKEN_LIMIT;
  const a = beforeTokens.slice(0, DIFF_TOKEN_LIMIT);
  const b = afterTokens.slice(0, DIFF_TOKEN_LIMIT);
  const table = Array.from({ length: a.length + 1 }, () =>
    new Uint16Array(b.length + 1),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushPart(parts, "same", a[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pushPart(parts, "del", a[i]);
      i += 1;
    } else {
      pushPart(parts, "add", b[j]);
      j += 1;
    }
  }
  while (i < a.length) {
    pushPart(parts, "del", a[i]);
    i += 1;
  }
  while (j < b.length) {
    pushPart(parts, "add", b[j]);
    j += 1;
  }

  return { parts, truncated };
}

function buildChangeSummary(before: string, after: string): {
  changes: DiffChange[];
  hiddenCount: number;
  truncated: boolean;
} {
  const { parts, truncated } = buildWordDiff(before, after);
  const changes: DiffChange[] = [];
  let current: DiffChange | null = null;

  for (const part of parts) {
    if (part.type === "same") {
      if (current) {
        pushChange(changes, current);
        current = null;
      }
      continue;
    }
    current ??= { added: "", removed: "" };
    if (part.type === "add") {
      current.added += part.text;
    } else {
      current.removed += part.text;
    }
  }
  if (current) pushChange(changes, current);

  const visible = changes.slice(0, DIFF_GROUP_LIMIT);
  return {
    changes: visible,
    hiddenCount: Math.max(0, changes.length - visible.length),
    truncated,
  };
}

function pushChange(changes: DiffChange[], change: DiffChange) {
  const added = compactDiffText(change.added);
  const removed = compactDiffText(change.removed);
  if (!added && !removed) return;
  changes.push({ added, removed });
}

function compactDiffText(value: string): string {
  const normalized = value.replace(/[ \t]+/g, " ").trim();
  if (!normalized && value.length > 0) return "Изменены пробелы или переносы строк";
  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 700).trimEnd()}…`;
}

function tokenize(value: string): string[] {
  return value.match(/(\s+|[^\s]+)/g) ?? [];
}

function pushPart(parts: DiffPart[], type: DiffPart["type"], text: string) {
  const last = parts[parts.length - 1];
  if (last?.type === type) {
    last.text += text;
    return;
  }
  parts.push({ type, text });
}
