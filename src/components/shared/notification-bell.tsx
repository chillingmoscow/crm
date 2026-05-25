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
import { Archive, Bell, CheckCheck, ListFilter, X } from "lucide-react";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { NotificationSettings } from "@/components/shared/notification-settings";
import {
  TIME_BUCKET_LABELS,
  TIME_BUCKET_ORDER,
  groupByTimeBucket,
} from "@/lib/notifications/group-by-time";

type Scope = "active" | "archived";
/** Единый фильтр (свёрнутые scope + read-filter), как в Notion. */
type View = "all" | "unread" | "archived";

const PAGE_SIZE = 50;

const HDR_BTN =
  "inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors";

/**
 * Notion-style колокольчик уведомлений.
 *   • Шапка: заголовок + кластер icon-кнопок (прочитать все,
 *     архивировать прочитанные, фильтр, настройки push) с RU-тултипами.
 *   • Фильтр сворачивает scope+read в один dropdown: все / непрочитанные
 *     / архив. Отдельных вкладок и футера нет.
 *   • Список: time-grouping, строки с dot-непрочитанного справа и
 *     hover-действиями.
 *   • Realtime — INSERT'ы prepend'ятся в active-список.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("all");

  const scope: Scope = view === "archived" ? "archived" : "active";

  // Раздельные state per-scope чтобы переключение фильтра не передёргивало
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
  /** In-flight guard для load-more (Codex #91 P1). */
  const loadingMoreRef = useRef<{ active: boolean; archived: boolean }>({
    active: false,
    archived: false,
  });

  const supabase = useMemo(() => createClient(), []);

  const currentList = scope === "active" ? activeNotifs : archiveNotifs;
  const unreadCount = activeNotifs.filter((n) => !n.read).length;
  const hasReadActive = activeNotifs.some((n) => n.read);

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
      if (loadingMoreRef.current[s]) return;
      const list = s === "active" ? activeNotifs : archiveNotifs;
      if (list.length === 0) return;
      const oldest = list[list.length - 1];
      loadingMoreRef.current[s] = true;
      try {
        const data = await getNotifications({
          scope: s,
          before: oldest.created_at,
          beforeId: oldest.id,
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

  // Lazy-load archive scope при первом переключении фильтра на «Архив».
  useEffect(() => {
    if (scope === "archived" && !loaded.archived) {
      void loadInitial("archived");
    }
  }, [scope, loaded.archived, loadInitial]);

  // ── Outside click closes dropdown ───────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Игнорируем клики внутри Radix-порталов (dropdown «Фильтр»,
      // popover настроек, tooltip) — они рендерятся вне ref'а.
      if (target.closest("[data-radix-popper-content-wrapper]")) return;
      if (ref.current && !ref.current.contains(target)) {
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

  const handleMarkReadOne = (id: string) => {
    setActiveNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    startTransition(async () => {
      await markNotificationRead(id);
    });
  };

  const handleArchiveOne = (id: string) => {
    let moved: Notification | null = null;
    setActiveNotifs((prev) => {
      const found = prev.find((n) => n.id === id);
      if (found) {
        moved = { ...found, archived_at: new Date().toISOString() };
      }
      return prev.filter((n) => n.id !== id);
    });
    if (moved && loaded.archived) {
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
    const readIds = new Set(activeNotifs.filter((n) => n.read).map((n) => n.id));
    setActiveNotifs((prev) => prev.filter((n) => !readIds.has(n.id)));
    startTransition(async () => {
      await archiveAllRead();
      if (loaded.archived) await loadInitial("archived");
    });
  };

  // ── Render ──────────────────────────────────────────────────────
  const filteredList =
    view === "unread" ? currentList.filter((n) => !n.read) : currentList;
  const groups = groupByTimeBucket(filteredList);

  const emptyText =
    view === "archived"
      ? "Архив пуст"
      : view === "unread"
        ? "Нет непрочитанных"
        : "Нет уведомлений";

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
            "fixed inset-0 z-50 flex flex-col bg-popover",
            // Desktop (sm+): привязанный к колокольчику dropdown.
            "sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:h-auto sm:w-[400px] sm:overflow-hidden sm:rounded-[10px] sm:border sm:shadow-md",
          )}
        >
          {/* Header: title + icon-actions */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-sm">Уведомления</span>
              {unreadCount > 0 && (
                <span className="text-[11px] font-semibold bg-brand/10 text-brand rounded-full px-1.5 leading-5">
                  {unreadCount}
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {scope === "active" && unreadCount > 0 && (
                <IconTooltip label="Прочитать все">
                  <button
                    type="button"
                    aria-label="Прочитать все"
                    onClick={handleMarkAllRead}
                    className={HDR_BTN}
                  >
                    <CheckCheck className="size-[18px]" />
                  </button>
                </IconTooltip>
              )}
              {scope === "active" && hasReadActive && (
                <IconTooltip label="Архивировать прочитанные">
                  <button
                    type="button"
                    aria-label="Архивировать прочитанные"
                    onClick={handleArchiveAllRead}
                    className={HDR_BTN}
                  >
                    <Archive className="size-[18px]" />
                  </button>
                </IconTooltip>
              )}

              <DropdownMenu>
                <IconTooltip label="Фильтр">
                  <DropdownMenuTrigger className={HDR_BTN} aria-label="Фильтр">
                    <ListFilter className="size-[18px]" />
                  </DropdownMenuTrigger>
                </IconTooltip>
                <DropdownMenuContent align="end" sideOffset={6}>
                  <DropdownMenuLabel>Показывать</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={view}
                    onValueChange={(v) => setView(v as View)}
                  >
                    <DropdownMenuRadioItem value="all">
                      Непрочитанные и прочитанные
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="unread">
                      Только непрочитанные
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="archived">
                      Архив
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <NotificationSettings />

              {/* Закрыть — только на мобильном. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть уведомления"
                className={cn(HDR_BTN, "sm:hidden")}
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

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
                <p className="text-xs text-muted-foreground">{emptyText}</p>
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
                    onMarkRead={
                      scope === "active" ? handleMarkReadOne : undefined
                    }
                    onArchive={scope === "active" ? handleArchiveOne : undefined}
                    onUnarchive={
                      scope === "archived" ? handleUnarchiveOne : undefined
                    }
                    inArchive={scope === "archived"}
                  />
                );
              })}
            {loaded[scope] &&
              hasMore[scope] &&
              filteredList.length >= PAGE_SIZE && (
                <div className="px-4 py-2 text-center text-[11px] text-muted-foreground">
                  Прокрутите вниз чтобы загрузить ещё
                </div>
              )}
          </div>
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
  onMarkRead,
  onArchive,
  onUnarchive,
  inArchive,
}: {
  label: string;
  rows: Notification[];
  actorsMap: Map<string, NotificationActor>;
  onOpen: (notif: Notification) => void;
  onMarkRead?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  inArchive: boolean;
}) {
  return (
    <div>
      <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 sticky top-0 z-[1]">
        {label}
      </div>
      {rows.map((n) => (
        <KbNotificationRow
          key={n.id}
          notification={n}
          actor={n.actor_user_id ? actorsMap.get(n.actor_user_id) ?? null : null}
          onOpen={onOpen}
          onMarkRead={onMarkRead}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          inArchive={inArchive}
        />
      ))}
    </div>
  );
}
