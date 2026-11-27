"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Eye,
  History,
  Loader2,
  RotateCcw,
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { errorText } from "@/lib/actions/error-text";
import { countRu } from "@/lib/format/plural";
import { kbChangeKindLabel, kbVersionDeltaLabel } from "@/lib/knowledge/version-labels";
import {
  getKbPageVersion,
  getKbPageVersionDiffData,
  listKbPageVersions,
  restoreKbPageVersion,
  type KbPageVersionWithAuthor,
  type KbVersionDiffData,
} from "@/lib/knowledge/versions";
import type { KbBlock, KbPageVersionRow } from "@/types/knowledge";
import { PersonAvatar } from "@/components/people/person-avatar";

interface KbVersionHistoryProps {
  pageId: string;
  /** Per-role gate. Disables the restore action when false. */
  canEdit: boolean;
  /** Открытие снаружи (меню ⋯ страницы); своей кнопки у панели нет. */
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
    loading: () => <SnapshotSkeleton />,
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
      toast.error(errorText(new Error(result.error), "Не удалось восстановить версию"));
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

  const versionCount = rows?.length ?? 0;
  const description =
    rows && rows.length > 0
      ? `${countRu(versionCount, "версия", "версии", "версий")} · ${countRu(sessionCount, "сессия правки", "сессии правки", "сессий правки")}`
      : undefined;

  return (
    <EditDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="История версий"
      description={description}
    >
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
    </EditDrawer>
  );
}

/** Заготовка списка сессий, пока история грузится. */
function SessionsSkeleton() {
  return (
    <div role="status" aria-label="Загружаем историю" aria-busy className="space-y-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
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
  if (loading) return <SessionsSkeleton />;
  if (error)
    return (
      <EmptyState
        illustration="error"
        title="Не удалось загрузить историю"
        // Русский текст сервера (например, «Нет доступа к истории версий»)
        // показываем как есть — повтор его не исправит; технический — общей фразой.
        description={errorText(new Error(error), "Попробуйте ещё раз через несколько секунд")}
        action={
          <Button size="sm" variant="outline" onClick={onRetry}>
            Повторить
          </Button>
        }
      />
    );
  if (groups !== null && groups.length === 0)
    return (
      <EmptyState
        icon={History}
        title="Истории пока нет"
        description="Первая версия появится после изменения текста, заголовка или свойств"
      />
    );
  if (!groups) return null;

  return (
    <>
      {groups.map((group) => (
        <DrawerSection key={group.label} title={group.label}>
          <div className="space-y-2">
            {group.sessions.map((session) => (
              <VersionSessionCard
                key={session.id}
                session={session}
                canEdit={canEdit}
                currentVersionNumber={currentVersionNumber}
                restoringVersion={restoring}
                onRestore={onRestore}
                pageId={pageId}
              />
            ))}
          </div>
        </DrawerSection>
      ))}
    </>
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
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <Avatar author={session.author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{authorName(session.author)}</span>
            <span className="text-[13px] text-muted-foreground">
              {timeRange(session.startAt, session.endAt)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {session.changeKinds.map((kind) => (
              <StatusBadge key={kind} tone="neutral">
                {kbChangeKindLabel(kind)}
              </StatusBadge>
            ))}
            <DeltaBadge delta={session.delta} />
            <span className="text-xs text-muted-foreground">
              {countRu(changedCount, "сохранение", "сохранения", "сохранений")}
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
    <div className={cn("bg-background", isCurrent && "bg-brand/5")}>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
          />
          <span className="text-sm font-medium">
            {format(new Date(row.updated_at), "HH:mm", { locale: ru })}
          </span>
          {isCurrent && <StatusBadge tone="info">Текущая</StatusBadge>}
          <DeltaBadge delta={row.delta} />
        </button>
        <Button variant="ghost" size="sm" onClick={onPreview}>
          <Eye className="size-4" />
          Просмотреть
        </Button>
      </div>
      {expanded && (
        <div className="border-t px-4 py-3">
          {loadingDiff && (
            <div role="status" aria-label="Сравниваем версии" aria-busy className="space-y-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          )}
          {!loadingDiff && diffError && (
            <p className="text-sm text-destructive">Не удалось сравнить версии. Попробуйте ещё раз</p>
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

/** Заготовка снимка страницы, пока он грузится. */
function SnapshotSkeleton() {
  return (
    <div role="status" aria-label="Загружаем снимок" aria-busy className="mx-auto max-w-[720px] space-y-4 px-6 py-8">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
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
      {/* Просмотр как у документов: широкое общее окно, подвал — DialogFooter. */}
      <DialogContent className="flex h-[min(90dvh,900px)] max-w-4xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Версия {row.version_number}</DialogTitle>
          <DialogDescription>
            {authorName(row.author)} · {metaLabel}
            {/* В описании, а не подсказкой подвала: та скрыта на телефоне,
                а восстановление идёт без подтверждения. */}
            <span className="block">
              Комментарии в снимок не входят.
              {canRestore && " Восстановление создаст новую текущую версию, прежние сохранятся"}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-y">
          {loading && <SnapshotSkeleton />}
          {!loading && error && (
            <EmptyState
              illustration="error"
              title="Не удалось открыть версию"
              description="Закройте окно и попробуйте ещё раз"
              className="m-6"
            />
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
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Закрыть</Button>
          </DialogClose>
          {canRestore && (
            <Button onClick={onRestore} disabled={restoring || loading}>
              {restoring ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              Восстановить эту версию
            </Button>
          )}
        </DialogFooter>
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
        В этой версии нет текста для сравнения. Полный снимок можно открыть кнопкой «Просмотреть»
      </p>
    );
  }
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Текст не изменился: правили заголовок, значок или свойства
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Только изменённые фрагменты</span>
        {(truncated || hiddenCount > 0) && (
          <span>
            {truncated
              ? "Показана часть изменений"
              : `Ещё ${countRu(hiddenCount, "изменение", "изменения", "изменений")}`}
          </span>
        )}
      </div>
      <div className="max-h-[260px] space-y-2 overflow-y-auto text-sm leading-6">
        {changes.map((change, idx) => (
          <div key={idx} className="space-y-1.5 rounded-lg border p-3">
            {change.removed && (
              <div className="flex items-start gap-2">
                <StatusBadge tone="danger" className="mt-0.5">Удалено</StatusBadge>
                <del className="min-w-0 whitespace-pre-wrap break-words text-muted-foreground">
                  {change.removed}
                </del>
              </div>
            )}
            {change.added && (
              <div className="flex items-start gap-2">
                <StatusBadge tone="success" className="mt-0.5">Добавлено</StatusBadge>
                <ins className="min-w-0 whitespace-pre-wrap break-words no-underline">
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

function DeltaBadge({ delta }: { delta: number | null }) {
  const { text, tone } = kbVersionDeltaLabel(delta);
  return <StatusBadge tone={tone}>{text}</StatusBadge>;
}

function Avatar({ author }: { author: EnrichedVersion["author"] }) {
  // Стоит внутри кнопки сессии — тихий аватар без карточки фото.
  return (
    <PersonAvatar
      src={author?.avatar_url ?? null}
      name={authorName(author)}
      size="md"
      interactive={false}
    />
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
