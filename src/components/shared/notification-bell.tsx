"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, Check, CheckCheck, Info, UserPlus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/app/(dashboard)/notifications/actions";
import type { Notification } from "@/app/(dashboard)/notifications/actions";

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
  return <Info className={`${cls} text-muted-foreground`} />;
}

type FilterTab = "all" | "unread";

// ── Component ────────────────────────────────────────────────
export function NotificationBell() {
  const [open, setOpen]               = useState(false);
  const [tab, setTab]                 = useState<FilterTab>("all");
  const [notifications, setNotifs]    = useState<Notification[]>([]);
  const [loaded, setLoaded]           = useState(false);
  const [isPending, startTransition]  = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Load on first open
  useEffect(() => {
    if (!open || loaded) return;
    getNotifications().then((data) => {
      setNotifs(data);
      setLoaded(true);
    });
  }, [open, loaded]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

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
      {/* Bell button */}
      <Button
        variant="ghost"
        size="icon"
        className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
        aria-label="Уведомления"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-destructive" />
        )}
      </Button>

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
                  className={`px-4 py-3 flex gap-3 ${
                    notif.read ? "" : "bg-blue-50/50 dark:bg-blue-950/10"
                  }`}
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
                          onClick={() => handleMarkRead(notif.id)}
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
