"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  AtSign,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  Info,
  MessageCircle,
  UserPlus,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/app/(dashboard)/notifications/actions";
import type { Notification } from "@/app/(dashboard)/notifications/actions";
import { createClient } from "@/lib/supabase/client";

// ── Helpers ─────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1)  return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours  < 24)  return `${hours} ч назад`;
  const days  = Math.floor(hours  / 24);
  if (days   < 7)   return `${days} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

function NotifIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 shrink-0";
  if (type === "invite")  return <UserPlus      className={`${cls} text-blue-500`} />;
  if (type === "warning") return <AlertTriangle className={`${cls} text-amber-500`} />;
  // KB-нотификации (Sprint D Phase 4) — разные иконки per-type, чтобы
  // в bell'е визуально отличать «упомянули» от «обязательно прочесть»
  // от «новый ответ в треде».
  if (type === "kb.mention_in_page" || type === "kb.mention_in_comment")
    return <AtSign className={`${cls} text-blue-500`} />;
  if (type === "kb.required_reading_assigned")
    return <BookOpen className={`${cls} text-amber-500`} />;
  if (type === "kb.comment_replied")
    return <MessageCircle className={`${cls} text-emerald-500`} />;
  // Fallback для неизвестных kb.* — общий warning.
  if (type.startsWith("kb."))
    return <AlertTriangle className={`${cls} text-amber-500`} />;
  return <Info className={`${cls} text-muted-foreground`} />;
}

type FilterTab = "all" | "unread";

// ── Component ────────────────────────────────────────────────
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen]               = useState(false);
  const [tab, setTab]                 = useState<FilterTab>("all");
  const [notifications, setNotifs]    = useState<Notification[]>([]);
  const [loaded, setLoaded]           = useState(false);
  const [isPending, startTransition]  = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Memo'ize browser supabase client — иначе useEffect ниже создаст
  // новый instance на каждом render'е и Realtime channel будет
  // переподключаться. createClient() из @supabase/ssr возвращает
  // singleton-like, но useMemo страхует от перерасчёта deps.
  const supabase = useMemo(() => createClient(), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Initial fetch на mount'е (а не on-open) + realtime subscription.
  // Без mount-fetch'а bell-counter всегда был 0 пока юзер не кликнет
  // bell — что воспринималось как «уведомления не работают». Realtime
  // на INSERT (filter user_id=eq.<my id>) держит count живым без F5.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      // Initial fetch.
      const data = await getNotifications();
      if (cancelled) return;
      setNotifs(data);
      setLoaded(true);

      // Realtime: INSERT events on notifications filtered by my user_id
      // (миграция 089 добавила таблицу в supabase_realtime publication).
      // На каждый новый row prepend'им в локальный list — bell-counter
      // обновляется мгновенно.
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
            console.info("[bell] realtime INSERT received", {
              id: (payload.new as { id?: string }).id,
              type: (payload.new as { type?: string }).type,
            });
            const row = payload.new as {
              id: string;
              type: string;
              title: string;
              body: string | null;
              link: string | null;
              read: boolean;
              created_at: string;
            };
            // Дедуп: если строка уже в state'е (например, доехала
            // через initial fetch а потом через realtime), не
            // дублируем.
            setNotifs((prev) =>
              prev.some((n) => n.id === row.id) ? prev : [row, ...prev],
            );
          },
        )
        .subscribe((status, err) => {
          // Status'ы из Supabase Realtime: SUBSCRIBED / CHANNEL_ERROR /
          // TIMED_OUT / CLOSED. Логируем чтобы при F12 на боевой странице
          // юзер видел "[bell] subscribed" — если не видит, значит RLS
          // или publication поломаны и notifs не доедут до этого канала.
          console.info("[bell] subscribe status", { status, userId: user.id, error: err?.message });
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Click on row → mark read (optimistic) + navigate via Next.js router
  // (без full page reload). Если link отсутствует — только пометка.
  const handleRowClick = (notif: Notification) => {
    if (!notif.read) {
      // Optimistic, server-action в фоне.
      setNotifs((prev) =>
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

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markNotificationRead(id);
      setNotifs((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
      setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    });
  };

  const visible = tab === "unread"
    ? notifications.filter((n) => !n.read)
    : notifications;

  return (
    <div className="relative" ref={ref}>
      {/* Bell button — стиль топбара DS iedpv: 36×36, без border,
          bg-background, иконка muted-foreground → foreground на hover. */}
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

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[360px] bg-background border rounded-xl shadow-lg flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm">Уведомления</span>
              {unreadCount > 0 && (
                <span className="text-xs bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 leading-none">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={isPending}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Всё прочитано
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 px-4 pb-3">
            {(["all", "unread"] as FilterTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-xs px-3 py-1 rounded-full transition-colors ${
                  tab === t
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {t === "all" ? "Все" : "Непрочитанные"}
              </button>
            ))}
          </div>

          <Separator />

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {!loaded && (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                Загрузка...
              </div>
            )}
            {loaded && visible.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground gap-2">
                <Bell className="w-8 h-8 opacity-30" />
                {tab === "unread" ? "Нет непрочитанных" : "Нет уведомлений"}
              </div>
            )}
            {loaded && visible.map((notif, i) => (
              <div key={notif.id}>
                {i > 0 && <Separator />}
                <div
                  role={notif.link ? "button" : undefined}
                  tabIndex={notif.link ? 0 : undefined}
                  onClick={() => handleRowClick(notif)}
                  onKeyDown={(e) => {
                    // Игнорируем bubbled events от вложенных интерактивов
                    // (например, Enter/Space на «Прочитано»-кнопке внутри
                    // строки): иначе row-handler утащит юзера на link
                    // вместо того чтобы просто пометить как прочитанное.
                    // Codex #77 P2.
                    if (e.target !== e.currentTarget) return;
                    if (notif.link && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      handleRowClick(notif);
                    }
                  }}
                  className={`px-4 py-3 flex gap-3 ${
                    notif.read ? "" : "bg-blue-50/50 dark:bg-blue-950/10"
                  } ${
                    notif.link
                      ? "cursor-pointer hover:bg-accent/60"
                      : ""
                  } transition-colors`}
                >
                  {/* Icon + unread dot */}
                  <div className="flex flex-col items-center pt-0.5 shrink-0 gap-1.5">
                    <NotifIcon type={notif.type} />
                    {!notif.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${notif.read ? "text-muted-foreground" : "font-medium"}`}>
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        {relativeTime(notif.created_at)}
                      </span>
                      {!notif.read && (
                        <button
                          onClick={(e) => {
                            // Без stopPropagation row-onClick тоже выстрелит
                            // и зачем-то перейдёт по link'у при клике на
                            // «Прочитано» — нелогично.
                            e.stopPropagation();
                            handleMarkRead(notif.id);
                          }}
                          disabled={isPending}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Check className="w-3 h-3" />
                          Прочитано
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
