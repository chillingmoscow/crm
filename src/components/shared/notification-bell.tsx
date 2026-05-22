"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Archive, Bell, CheckCheck, X } from "lucide-react";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { cn } from "@/lib/utils";
import {
  archiveAllRead,
  archiveNotification,
  getNotificationActors,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unarchiveNotification,
} from "@/app/(dashboard)/notifications/actions";
import type {
  Notification,
  NotificationActor,
  NotificationPayload,
} from "@/app/(dashboard)/notifications/actions";
import { createClient } from "@/lib/supabase/client";
import { KbNotificationRow } from "@/components/shared/notification-row";
import {
  TIME_BUCKET_LABELS,
  TIME_BUCKET_ORDER,
  groupByTimeBucket,
} from "@/lib/notifications/group-by-time";

type Scope = "active" | "archived";
type ReadFilter = "all" | "unread";

const PAGE_SIZE = 50;

/**
 * Notion-style notification bell. Phase 2 plan §2:
 *   • Scope tabs: Active / Archive.
 *   • Filter tabs: Все / Непрочитанные.
 *   • Time-grouping (Today / This week / Last week / Older).
 *   • Read-state divider (unread выше read'ов внутри каждой группы).
 *   • Preview-cards с actor + verb + entity + snippet (см. KbNotificationRow).
 *   • Inline-actions (payload.actions[]) или дефолтная «Открыть».
 *   • Hover-archive / Hover-restore button per row.
 *   • Footer: «Прочитать все» + «Архивировать прочит.».
 *   • Pagination — load-more по scroll'у до низа.
 *   • Realtime — INSERT'ы prepend'ятся в active-scope state.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("active");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");

  // Раздельные state per-scope чтобы переключение tab'а не передёргивало
  // fetch и сохранялся scroll.
  const [activeNotifs, setActiveNotifs] = useState<Notification[]>([]);
  const [archiveNotifs, setArchiveNotifs] = useState<Notification[]>([]);
  const [actorsMap, setActorsMap] = useState<Map<string, NotificationActor>>(
    new Map(),
  );
  const [loaded, setLoaded] = useState({ active: false, archived: false });
  const [hasMore, setHasMore] = useState({ active: true, archived: true });
  const [, startTransition] = useTransition();

  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** In-flight guard для load-more: scroll-handler срабатывает на
   *  каждый scroll-event пока юзер у нижнего края → без guard'а
   *  multiple overlapping fetch'и с одним cursor'ом → дубликаты
   *  rows в state'е (Codex #91 P1). */
  const loadingMoreRef = useRef<{ active: boolean; archived: boolean }>({
    active: false,
    archived: false,
  });

  const supabase = useMemo(() => createClient(), []);

  const currentList = scope === "active" ? activeNotifs : archiveNotifs;
  const unreadCount = activeNotifs.filter((n) => !n.read).length;

  // ── Fetch helpers ────────────────────────────────────────────────
  const ensureActorsForList = useCallback(
    async (rows: Notification[]) => {
      const missing = new Set<string>();
      for (const n of rows) {
        if (n.actor_user_id && !actorsMap.has(n.actor_user_id)) {
          missing.add(n.actor_user_id);
        }
      }
      if (missing.size === 0) return;
      const fetched = await getNotificationActors(Array.from(missing));
      setActorsMap((prev) => {
        const next = new Map(prev);
        for (const a of fetched) next.set(a.id, a);
        return next;
      });
    },
    [actorsMap],
  );

  const loadInitial = useCallback(
    async (s: Scope) => {
      const data = await getNotifications({ scope: s, limit: PAGE_SIZE });
      if (s === "active") setActiveNotifs(data);
      else setArchiveNotifs(data);
      setLoaded((prev) => ({ ...prev, [s]: true }));
      setHasMore((prev) => ({ ...prev, [s]: data.length === PAGE_SIZE }));
      void ensureActorsForList(data);
    },
    [ensureActorsForList],
  );

  const loadMore = useCallback(
    async (s: Scope) => {
      // In-flight guard (Codex #91 P1): один scroll-event может
      // стрельнуть несколько раз пока fetch pending'ует. Без этого
      // флага получаем дубль pages в state'е.
      if (loadingMoreRef.current[s]) return;
      const list = s === "active" ? activeNotifs : archiveNotifs;
      if (list.length === 0) return;
      const oldest = list[list.length - 1];
      loadingMoreRef.current[s] = true;
      try {
        const data = await getNotifications({
          scope: s,
          before: oldest.created_at,
          limit: PAGE_SIZE,
        });
        if (s === "active") setActiveNotifs((prev) => [...prev, ...data]);
        else setArchiveNotifs((prev) => [...prev, ...data]);
        setHasMore((prev) => ({ ...prev, [s]: data.length === PAGE_SIZE }));
        void ensureActorsForList(data);
      } finally {
        loadingMoreRef.current[s] = false;
      }
    },
    [activeNotifs, archiveNotifs, ensureActorsForList],
  );

  // ── Initial fetch on mount + realtime subscribe ─────────────────
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      // Active scope — горячий путь, fetch'им сразу. Archive — лениво
      // при первом switch'е tab'а.
      await loadInitial("active");

      channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const raw = payload.new as Record<string, unknown>;
            const row: Notification = {
              id: raw.id as string,
              type: (raw.type as string) ?? "system",
              category: (raw.category as string) ?? "system",
              title: (raw.title as string) ?? "",
              body: (raw.body as string | null) ?? null,
              link: (raw.link as string | null) ?? null,
              read: Boolean(raw.read),
              archived_at: (raw.archived_at as string | null) ?? null,
              actor_user_id: (raw.actor_user_id as string | null) ?? null,
              entity_type: (raw.entity_type as string | null) ?? null,
              entity_id: (raw.entity_id as string | null) ?? null,
              payload: (raw.payload as NotificationPayload) ?? {},
              created_at: raw.created_at as string,
            };
            setActiveNotifs((prev) =>
              prev.some((n) => n.id === row.id) ? prev : [row, ...prev],
            );
            // Lazy-fetch actor для нового row'а.
            if (row.actor_user_id) {
              void ensureActorsForList([row]);
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // Lazy-load archive scope при первом switch'е.
  useEffect(() => {
    if (scope === "archived" && !loaded.archived) {
      void loadInitial("archived");
    }
  }, [scope, loaded.archived, loadInitial]);

  // ── Outside click closes dropdown ───────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Scroll → load more ──────────────────────────────────────────
  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 80 && hasMore[scope]) {
      void loadMore(scope);
    }
  }, [scope, hasMore, loadMore]);

  // ── Action handlers ─────────────────────────────────────────────
  const handleOpen = (notif: Notification) => {
    if (!notif.read) {
      setActiveNotifs((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)),
      );
      setArchiveNotifs((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)),
      );
      startTransition(async () => {
        await markNotificationRead(notif.id);
      });
    }
    if (notif.link) {
      setOpen(false);
      router.push(notif.link);
    }
  };

  const handleArchiveOne = (id: string) => {
    // Move row из active state'а в archive state — оптимистично + без
    // refetch'а. Codex #91 P2 fix: refetch'ить limit:1 из archived'а
    // некорректно — sorted by created_at, в первой странице обычно
    // самые свежие архивы, наша только что архивированная (но
    // старая по дате) могла туда не попасть → silent disappearance.
    let moved: Notification | null = null;
    setActiveNotifs((prev) => {
      const found = prev.find((n) => n.id === id);
      if (found) {
        moved = { ...found, archived_at: new Date().toISOString() };
      }
      return prev.filter((n) => n.id !== id);
    });
    if (moved && loaded.archived) {
      // Insert в archive state'е по created_at-desc позиции.
      setArchiveNotifs((prev) => {
        const next = [...prev, moved!].sort((a, b) =>
          a.created_at < b.created_at ? 1 : -1,
        );
        return next;
      });
    }
    startTransition(async () => {
      await archiveNotification(id);
    });
  };

  const handleUnarchiveOne = (id: string) => {
    setArchiveNotifs((prev) => prev.filter((n) => n.id !== id));
    startTransition(async () => {
      await unarchiveNotification(id);
      // Реrequery active чтобы row вернулся.
      await loadInitial("active");
    });
  };

  const handleMarkAllRead = () => {
    setActiveNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  };

  const handleArchiveAllRead = () => {
    const readIds = new Set(
      activeNotifs.filter((n) => n.read).map((n) => n.id),
    );
    setActiveNotifs((prev) => prev.filter((n) => !readIds.has(n.id)));
    startTransition(async () => {
      await archiveAllRead();
      if (loaded.archived) await loadInitial("archived");
    });
  };

  // ── Render ──────────────────────────────────────────────────────
  // Apply read-filter (только в active scope; archive показывает всё
  // что архивировано, deshabilitar filter там).
  const filteredList =
    scope === "active" && readFilter === "unread"
      ? currentList.filter((n) => !n.read)
      : currentList;

  // В active scope: разделяем на unread + read половины внутри каждой
  // time-bucket'ы для read-state divider'а. В archive — оба типа в
  // одном потоке (они уже архивированы).
  const groups = groupByTimeBucket(filteredList);

  return (
    <div className="relative" ref={ref}>
      <IconTooltip label="Уведомления">
        <button
          type="button"
          aria-label="Уведомления"
          onClick={() => setOpen((v) => !v)}
          className="relative inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Bell className="w-[18px] h-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground inline-flex items-center justify-center leading-none ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </IconTooltip>

      {open && (
        <div
          className={cn(
            // Mobile: оверлей на весь экран поверх контента.
            "fixed inset-0 z-50 flex flex-col bg-background",
            // Desktop (sm+): привязанный к колокольчику dropdown, как раньше.
            "sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:h-auto sm:w-[420px] sm:overflow-hidden sm:rounded-xl sm:border sm:shadow-lg",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm">Уведомления</span>
              {unreadCount > 0 && scope === "active" && (
                <span className="text-xs bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 leading-none">
                  {unreadCount}
                </span>
              )}
            </div>
            {/* Закрыть — только на мобильном (на desktop закрывается
                по клику вне dropdown'а). */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть уведомления"
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Scope tabs */}
          <div className="flex gap-1 px-4 pb-2">
            <button
              type="button"
              onClick={() => setScope("active")}
              className={cn(
                "text-xs px-3 py-1 rounded-full transition-colors",
                scope === "active"
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              Входящие
            </button>
            <button
              type="button"
              onClick={() => setScope("archived")}
              className={cn(
                "text-xs px-3 py-1 rounded-full transition-colors inline-flex items-center gap-1",
                scope === "archived"
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              <Archive className="size-3" />
              Архив
            </button>
          </div>

          {/* Read filter (только в active) */}
          {scope === "active" && (
            <div className="flex gap-1 px-4 pb-3 border-b border-border/40">
              {(["all", "unread"] as ReadFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setReadFilter(f)}
                  className={cn(
                    "text-[11px] px-2.5 py-0.5 rounded-md transition-colors",
                    readFilter === f
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {f === "all" ? "Все" : "Непрочитанные"}
                </button>
              ))}
            </div>
          )}

          {/* List */}
          <div
            ref={listRef}
            onScroll={onListScroll}
            className="flex-1 overflow-y-auto sm:max-h-[480px]"
          >
            {!loaded[scope] && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Загрузка…
              </div>
            )}
            {loaded[scope] && filteredList.length === 0 && (
              <div className="px-4 py-12 text-center">
                <Bell className="size-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground">
                  {scope === "active"
                    ? "Нет уведомлений"
                    : "Архив пуст"}
                </p>
              </div>
            )}
            {loaded[scope] &&
              filteredList.length > 0 &&
              TIME_BUCKET_ORDER.map((bucket) => {
                const bucketRows = groups.get(bucket);
                if (!bucketRows || bucketRows.length === 0) return null;
                return (
                  <BucketSection
                    key={bucket}
                    label={TIME_BUCKET_LABELS[bucket]}
                    rows={bucketRows}
                    actorsMap={actorsMap}
                    onOpen={handleOpen}
                    onArchive={scope === "active" ? handleArchiveOne : undefined}
                    onUnarchive={scope === "archived" ? handleUnarchiveOne : undefined}
                    inArchive={scope === "archived"}
                  />
                );
              })}
            {loaded[scope] && hasMore[scope] && filteredList.length >= PAGE_SIZE && (
              <div className="px-4 py-2 text-center text-[11px] text-muted-foreground">
                Прокрутите вниз чтобы загрузить ещё
              </div>
            )}
          </div>

          {/* Footer actions */}
          {scope === "active" && filteredList.length > 0 && (
            <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/40 bg-muted/20">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Прочитать все
                </button>
              )}
              {activeNotifs.some((n) => n.read) && (
                <button
                  type="button"
                  onClick={handleArchiveAllRead}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" />
                  Архивировать прочитанные
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BucketSection({
  label,
  rows,
  actorsMap,
  onOpen,
  onArchive,
  onUnarchive,
  inArchive,
}: {
  label: string;
  rows: Notification[];
  actorsMap: Map<string, NotificationActor>;
  onOpen: (notif: Notification) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  inArchive: boolean;
}) {
  // В active-scope: разделяем unread + read внутри bucket'а — Notion
  // показывает unread первыми, разделитель, потом read. В archive
  // всё в одном потоке (read-state теряет смысл там).
  const unread = inArchive ? [] : rows.filter((r) => !r.read);
  const read = inArchive ? rows : rows.filter((r) => r.read);

  return (
    <div>
      <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 sticky top-0 z-[1]">
        {label}
      </div>
      {unread.map((n) => (
        <KbNotificationRow
          key={n.id}
          notification={n}
          actor={n.actor_user_id ? actorsMap.get(n.actor_user_id) ?? null : null}
          onOpen={onOpen}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          inArchive={inArchive}
        />
      ))}
      {!inArchive && unread.length > 0 && read.length > 0 && (
        <div className="px-4 py-1 text-[10px] text-muted-foreground/70 border-t border-b border-border/30 bg-muted/10">
          Прочитанные
        </div>
      )}
      {read.map((n) => (
        <KbNotificationRow
          key={n.id}
          notification={n}
          actor={n.actor_user_id ? actorsMap.get(n.actor_user_id) ?? null : null}
          onOpen={onOpen}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          inArchive={inArchive}
        />
      ))}
    </div>
  );
}
