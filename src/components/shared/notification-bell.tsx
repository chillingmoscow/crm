"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useContext,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Archive, Bell, CheckCheck, ListFilter, MoreHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkspaceAppearance } from "@/components/shared/workspace-appearance";
import appearance from "@/components/shared/workspace-appearance.module.css";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import {
  archiveAllRead,
  archiveNotification,
  archiveNotifications,
  getNotificationActors,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsRead,
  unarchiveNotification,
  unarchiveNotifications,
} from "@/app/(dashboard)/notifications/actions";
import type {
  Notification,
  NotificationActor,
  NotificationPayload,
} from "@/app/(dashboard)/notifications/actions";
import { createClient } from "@/lib/supabase/client";
import {
  KbNotificationRow,
  NotificationClockContext,
  NotificationStackRow,
  type NotificationClock,
} from "@/components/shared/notification-row";
import { ExpandPanel } from "@/components/shared/overview-toggle";
import { stackNotifications } from "@/lib/notifications/stack";
import { NotificationSettings } from "@/components/shared/notification-settings";
import {
  TIME_BUCKET_LABELS,
  TIME_BUCKET_ORDER,
  groupByTimeBucket,
} from "@/lib/notifications/group-by-time";

type Scope = "active" | "archived";
/** Единый фильтр (свёрнутые scope + read-filter), как в Notion. */
type View = "all" | "unread" | "archived";

const PAGE_SIZE = 50; // столько же грузит страница «Уведомления» на сервере
const UPDATE_RELOAD_DEBOUNCE_MS = 300;

const HDR_BTN =
  "inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors";

/**
 * Notion-style колокольчик уведомлений. В режиме `inbox` — страница
 * «Уведомления»: шапка с действиями и вкладки представления.
 *   • Шапка: заголовок + кластер icon-кнопок (прочитать все,
 *     архивировать прочитанные, фильтр, настройки push) с RU-тултипами.
 *   • Фильтр сворачивает scope+read в один dropdown: все / непрочитанные
 *     / архив. Отдельных вкладок и футера нет.
 *   • Список: time-grouping, строки с dot-непрочитанного справа и
 *     hover-действиями.
 *   • Realtime — INSERT'ы prepend'ятся в active-список.
 */
/** Первая страница входящих, загруженная сервером (страница «Уведомления»). */
export type NotificationsInitial = {
  notifications: Notification[];
  actors: NotificationActor[];
  /** Время сервера (мс) — «сейчас» до монтирования. */
  now: number;
  /** Пояс аккаунта: границы «Сегодня», «На этой неделе» и даты строк. */
  timeZone: string;
};

export function NotificationBell({
  mode = "popover",
  initial,
}: {
  mode?: "popover" | "inbox";
  /**
   * Входящие с сервера: список приходит в первой разметке, и страница не
   * растёт, когда скелетон сменяется строками.
   */
  initial?: NotificationsInitial;
} = {}) {
  const isInbox = mode === "inbox";
  const modern = useWorkspaceAppearance();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("all");

  const scope: Scope = view === "archived" ? "archived" : "active";

  // Раздельные state per-scope чтобы переключение фильтра не передёргивало
  // fetch и сохранялся scroll.
  const [activeNotifs, setActiveNotifs] = useState<Notification[]>(
    initial?.notifications ?? [],
  );
  // Прислал ли сервер первую страницу: тогда при монтировании её не
  // перечитываем (подписка на новые всё равно включается).
  const [servedInitial] = useState(!!initial);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [archiveNotifs, setArchiveNotifs] = useState<Notification[]>([]);
  const [actorsMap, setActorsMap] = useState<Map<string, NotificationActor>>(
    () => new Map((initial?.actors ?? []).map((a) => [a.id, a])),
  );
  /** Фото кандидатов для уведомлений об анкетах: id → адрес (null — без фото). */
  const [candidatePhotos, setCandidatePhotos] = useState<
    Map<string, string | null>
  >(new Map());
  const requestedPhotosRef = useRef<Set<string>>(new Set());
  /** Раскрытые стопки однотипных уведомлений. */
  const [openStacks, setOpenStacks] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState({ active: !!initial, archived: false });
  const [hasMore, setHasMore] = useState({
    active: initial ? initial.notifications.length === PAGE_SIZE : true,
    archived: true,
  });
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
    // «Прочитать стопку» из 13 записей — 13 событий UPDATE подряд:
    // перечитываем список один раз, когда они утихнут.
    let reloadTimer: number | undefined;
    let resynced = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      if (!servedInitial) await loadInitial("active");

      channel = supabase
        .channel(`notifications:${user.id}:${mode}`)
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
            if (row.type === "candidate.new") window.dispatchEvent(new Event("candidates:changed"));
            // Фоновое создание акта закончилось — сказать сразу, где бы
            // пользователь ни был. id тоста = id уведомления: колокольчиков на
            // странице может быть два (меню и мобильная шапка), тост один.
            if (row.type === "inventory.document.creation_done" || row.type === "inventory.document.creation_failed") {
              const show = row.type === "inventory.document.creation_done" ? toast.success : toast.error;
              const link = row.link;
              show(row.title, {
                id: row.id,
                description: row.body ?? undefined,
                duration: 10_000,
                ...(link ? { action: { label: "Открыть акт", onClick: () => router.push(link) } } : {}),
              });
            }
            if (row.actor_user_id) {
              void ensureActorsForList([row]);
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            if (cancelled) return;
            window.clearTimeout(reloadTimer);
            reloadTimer = window.setTimeout(() => {
              if (cancelled) return;
              void loadInitial("active");
              setLoaded((prev) => ({ ...prev, archived: false }));
            }, UPDATE_RELOAD_DEBOUNCE_MS);
          },
        )
        .subscribe((status) => {
          // Список пришёл с сервера (или из кэша роутера при «Назад»): после
          // подписки тихо перечитываем первую страницу — так не теряются
          // уведомления между запросом сервера и подпиской, а прочитанное
          // не остаётся непрочитанным. Список меняется, только если правда
          // изменился.
          if (status !== "SUBSCRIBED" || !servedInitial || resynced || cancelled) return;
          resynced = true;
          void getNotifications({ scope: "active", limit: PAGE_SIZE })
            .then((data) => {
              if (cancelled) return;
              setActiveNotifs((prev) => (sameNotifications(prev, data) ? prev : data));
              setHasMore((prev) => ({ ...prev, active: data.length === PAGE_SIZE }));
              void ensureActorsForList(data);
            })
            .catch(() => {});
        });
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(reloadTimer);
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, mode, servedInitial]);

  // Lazy-load archive scope при первом переключении фильтра на «Архив».
  useEffect(() => {
    if (scope === "archived" && !loaded.archived) {
      void loadInitial("archived");
    }
  }, [scope, loaded.archived, loadInitial]);

  // Фото кандидатов для уведомлений об анкетах. Без права на кандидатов
  // ответ 403 — остаются инициалы.
  useEffect(() => {
    const ids = [...activeNotifs, ...archiveNotifs]
      .filter((n) => n.entity_type === "candidate" && n.entity_id)
      .map((n) => n.entity_id!)
      .filter((id) => !requestedPhotosRef.current.has(id))
      .slice(0, 100);
    if (ids.length === 0) return;
    for (const id of ids) requestedPhotosRef.current.add(id);
    void fetch(`/api/people/candidate-photos?ids=${ids.join(",")}`)
      .then(async (response) => {
        if (!response.ok) return;
        const photos: Record<string, { photo_thumb_url?: string | null }> =
          await response.json();
        setCandidatePhotos((prev) => {
          const next = new Map(prev);
          for (const id of ids) next.set(id, photos[id]?.photo_thumb_url ?? null);
          return next;
        });
      })
      .catch(() => {});
  }, [activeNotifs, archiveNotifs]);

  // ── Outside click closes dropdown ───────────────────────────────
  useEffect(() => {
    if (!open || isInbox) return;
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
  }, [open, isInbox]);

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

  // Стопка: одно действие на все её уведомления.
  const handleMarkReadMany = (ids: string[]) => {
    const set = new Set(ids);
    setActiveNotifs((prev) =>
      prev.map((n) => (set.has(n.id) ? { ...n, read: true } : n)),
    );
    startTransition(async () => {
      await markNotificationsRead(ids);
    });
  };

  const handleArchiveMany = (ids: string[]) => {
    const set = new Set(ids);
    const archivedAt = new Date().toISOString();
    const moved = activeNotifs
      .filter((n) => set.has(n.id))
      .map((n) => ({ ...n, archived_at: archivedAt }));
    setActiveNotifs((prev) => prev.filter((n) => !set.has(n.id)));
    if (moved.length > 0 && loaded.archived) {
      setArchiveNotifs((prev) =>
        [...prev, ...moved].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      );
    }
    startTransition(async () => {
      await archiveNotifications(ids);
    });
  };

  const handleUnarchiveMany = (ids: string[]) => {
    const set = new Set(ids);
    setArchiveNotifs((prev) => prev.filter((n) => !set.has(n.id)));
    startTransition(async () => {
      await unarchiveNotifications(ids);
      await loadInitial("active");
    });
  };

  const toggleStack = (key: string) =>
    setOpenStacks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
  const filteredList =
    view === "unread" ? currentList.filter((n) => !n.read) : currentList;
  // До монтирования — «сейчас» и пояс с сервера: разметка и первая
  // отрисовка в браузере совпадают (сервер живёт в UTC). Потом — текущее время.
  const clock: NotificationClock = {
    now: mounted ? null : (initial?.now ?? null),
    timeZone: initial?.timeZone,
  };
  const groups = groupByTimeBucket(
    filteredList,
    new Date(clock.now ?? Date.now()),
    clock.timeZone,
  );

  const emptyText =
    view === "archived"
      ? "Архив пуст"
      : view === "unread"
        ? "Нет непрочитанных"
        : "Нет уведомлений";

  // Список: общий для колокольчика и страницы «Уведомления».
  const list = (
    <div
      ref={listRef}
      onScroll={onListScroll}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto",
        !isInbox && "sm:max-h-[480px]",
      )}
    >
      {!loaded[scope] && <NotificationsSkeleton />}
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
              candidatePhotos={candidatePhotos}
              openStacks={openStacks}
              onToggleStack={toggleStack}
              idPrefix={mode}
              onOpen={handleOpen}
              onMarkRead={
                scope === "active" ? handleMarkReadOne : undefined
              }
              onArchive={
                scope === "active" ? handleArchiveOne : undefined
              }
              onUnarchive={
                scope === "archived" ? handleUnarchiveOne : undefined
              }
              onMarkReadMany={
                scope === "active" ? handleMarkReadMany : undefined
              }
              onArchiveMany={
                scope === "active" ? handleArchiveMany : undefined
              }
              onUnarchiveMany={
                scope === "archived" ? handleUnarchiveMany : undefined
              }
              inArchive={scope === "archived"}
            />
          );
        })}
      {loaded[scope] &&
        hasMore[scope] &&
        filteredList.length >= PAGE_SIZE && (
          <div className="px-4 py-2 text-center text-xs text-muted-foreground">
            Прокрутите вниз чтобы загрузить ещё
          </div>
        )}
    </div>
  );

  // Страница «Уведомления»: шапка 36px с действиями, под ней вкладки
  // представления (как в «Зарплате»), ниже — список.
  if (isInbox) {
    const canMarkAll = scope === "active" && unreadCount > 0;
    const canArchiveRead = scope === "active" && hasReadActive;
    return (
      <div className="min-w-0" ref={ref}>
        <TablePageHeader
          title="Уведомления"
          actions={
            <>
              {canMarkAll && (
                <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
                  <CheckCheck className="size-4" />
                  Прочитать все
                </Button>
              )}
              {/* Настройки push — своя кнопка-поповер, в размер ряда шапки. */}
              <NotificationSettings variant="toolbar" />
              {canArchiveRead && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-9 px-0"
                      aria-label="Ещё действия с уведомлениями"
                      data-tip="Ещё"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={6}>
                    <DropdownMenuItem onSelect={handleArchiveAllRead}>
                      <Archive className="size-4" />
                      Архивировать прочитанные
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          }
        />
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as View)}
          className={cn(tabStyle.tabs, "mt-4")}
        >
          <TabsList aria-label="Показать уведомления">
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="unread">
              {unreadCount > 0 ? `Непрочитанные · ${unreadCount}` : "Непрочитанные"}
            </TabsTrigger>
            <TabsTrigger value="archived">Архив</TabsTrigger>
          </TabsList>
          <TabsContent value={view} className="!mt-5">
            <div
              role="region"
              aria-label="Список уведомлений"
              className={cn(
                "flex min-h-[420px] max-h-[calc(100dvh-300px)] flex-col overflow-hidden rounded-xl border bg-background",
                modern && appearance.notificationsInbox,
              )}
            >
              <NotificationClockContext.Provider value={clock}>{list}</NotificationClockContext.Provider>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

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
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-xs font-semibold text-destructive-foreground inline-flex items-center justify-center leading-none ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </IconTooltip>

      {open && (
        <div
          role="region"
          aria-label="Список уведомлений"
          className={cn(
            // Появление — как у всплывающих окон: из угла кнопки
            // (docs/motion.md, `.motion-popper-in`).
            "motion-popper-in origin-top-right",
            // Mobile: оверлей на весь экран поверх контента.
            "fixed inset-0 z-50 flex flex-col bg-popover",
            // Desktop (sm+): привязанный к колокольчику dropdown.
            "sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:h-auto sm:w-[400px] sm:overflow-hidden sm:rounded-[10px] sm:border sm:shadow-md",
            modern && appearance.notificationsPopover,
          )}
        >
          {/* Header: title + icon-actions */}
          <div
            data-notification-toolbar
            className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-sm">Уведомления</span>
              {unreadCount > 0 && (
                <span className="text-xs font-semibold bg-brand/10 text-brand rounded-full px-1.5 leading-5">
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

              {!modern && (
                <DropdownMenu>
                  <IconTooltip label="Фильтр">
                    <DropdownMenuTrigger
                      className={HDR_BTN}
                      aria-label="Фильтр"
                    >
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
              )}

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

          {modern && (
            <div className={appearance.popoverViews}>
              <NotificationViews
                view={view}
                setView={setView}
                unreadCount={unreadCount}
              />
            </div>
          )}
          <NotificationClockContext.Provider value={clock}>{list}</NotificationClockContext.Provider>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="border-t px-4 py-3 text-center text-sm font-medium text-brand hover:bg-muted/40"
          >
            Все уведомления →
          </Link>
        </div>
      )}
    </div>
  );
}

/** Тот же список: те же строки в том же порядке и с тем же состоянием. */
function sameNotifications(a: Notification[], b: Notification[]) {
  return (
    a.length === b.length &&
    a.every(
      (n, i) =>
        n.id === b[i].id &&
        n.read === b[i].read &&
        n.archived_at === b[i].archived_at &&
        n.title === b[i].title &&
        n.body === b[i].body,
    )
  );
}

/** Заглушка списка при первой загрузке — по форме строк уведомлений. */
function NotificationsSkeleton() {
  return (
    <div role="status" aria-label="Загружаем уведомления" className="divide-y divide-border/60">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function BucketSection({
  label,
  rows,
  actorsMap,
  candidatePhotos,
  openStacks,
  onToggleStack,
  idPrefix,
  onOpen,
  onMarkRead,
  onArchive,
  onUnarchive,
  onMarkReadMany,
  onArchiveMany,
  onUnarchiveMany,
  inArchive,
}: {
  label: string;
  rows: Notification[];
  actorsMap: Map<string, NotificationActor>;
  candidatePhotos: Map<string, string | null>;
  openStacks: Set<string>;
  onToggleStack: (key: string) => void;
  /** Колокольчик и страница могут быть на экране вместе — id панелей разные. */
  idPrefix: string;
  onOpen: (notif: Notification) => void;
  onMarkRead?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onMarkReadMany?: (ids: string[]) => void;
  onArchiveMany?: (ids: string[]) => void;
  onUnarchiveMany?: (ids: string[]) => void;
  inArchive: boolean;
}) {
  const { timeZone } = useContext(NotificationClockContext);
  const row = (n: Notification, nested = false) => (
    <KbNotificationRow
      key={n.id}
      notification={n}
      actor={n.actor_user_id ? (actorsMap.get(n.actor_user_id) ?? null) : null}
      entityPhoto={
        n.entity_type === "candidate" && n.entity_id
          ? (candidatePhotos.get(n.entity_id) ?? null)
          : null
      }
      nested={nested}
      onOpen={onOpen}
      onMarkRead={onMarkRead}
      onArchive={onArchive}
      onUnarchive={onUnarchive}
      inArchive={inArchive}
    />
  );
  return (
    <div>
      <div
        data-notification-bucket
        className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 sticky top-0 z-[1]"
      >
        {label}
      </div>
      {stackNotifications(rows, timeZone).map((entry) => {
        if (entry.kind === "single") return row(entry.item);
        const open = openStacks.has(entry.key);
        const panelId = `${idPrefix}-${entry.key.replace(/[^a-z0-9]+/gi, "-")}`;
        return (
          <div key={entry.key}>
            <NotificationStackRow
              type={entry.type}
              items={entry.items}
              actorsMap={actorsMap}
              open={open}
              onToggle={() => onToggleStack(entry.key)}
              panelId={panelId}
              onMarkRead={onMarkReadMany}
              onArchive={onArchiveMany}
              onUnarchive={onUnarchiveMany}
              inArchive={inArchive}
            />
            <ExpandPanel id={panelId} open={open}>
              <div role="group" aria-label="Уведомления стопки">
                {entry.items.map((n) => row(n, true))}
              </div>
            </ExpandPanel>
          </div>
        );
      })}
    </div>
  );
}

function NotificationViews({
  view,
  setView,
  unreadCount,
}: {
  view: View;
  setView: (view: View) => void;
  unreadCount: number;
}) {
  return (
    <div
      role="group"
      aria-label="Показать уведомления"
      className={appearance.notificationViews}
    >
      {(
        [
          { id: "all", label: "Все" },
          { id: "unread", label: "Непрочитанные" },
          { id: "archived", label: "Архив" },
        ] as const
      ).map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={view === item.id}
          onClick={() => setView(item.id)}
        >
          {item.label}
          {item.id === "unread" && unreadCount > 0 && (
            <span>{unreadCount}</span>
          )}
        </button>
      ))}
    </div>
  );
}
