"use client";

import { Archive, ArchiveRestore, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { getNotificationTypeSpec } from "@/lib/notifications/registry";
import type {
  Notification,
  NotificationActor,
} from "@/app/(dashboard)/notifications/actions";

/**
 * Notion-style строка уведомления для bell'а.
 *
 * Структура:
 *   • Avatar/icon (24×24) — actor.avatar если есть, иначе type-иконка.
 *   • Title row: «<actor> <verb> <entity>» + relative time.
 *   • Preview-block (если payload.preview): italic snippet в muted-bg
 *     карточке (line-clamp-3).
 *   • Action buttons (payload.actions[]) или дефолтная «Открыть».
 *   • Hover-archive button справа.
 *   • Unread-indicator dot слева.
 */

interface KbNotificationRowProps {
  notification: Notification;
  /** Актёр (если notification.actor_user_id есть). Caller'ом
   *  предоставляется через batch-fetch. */
  actor?: NotificationActor | null;
  /** Open notif (mark read + navigate). */
  onOpen: (notif: Notification) => void;
  /** Archive notif (только в active scope'е). */
  onArchive?: (id: string) => void;
  /** Unarchive notif (только в archive scope'е). */
  onUnarchive?: (id: string) => void;
  /** Если в archive — рендерим Restore вместо Archive. */
  inArchive?: boolean;
}

export function KbNotificationRow({
  notification,
  actor,
  onOpen,
  onArchive,
  onUnarchive,
  inArchive = false,
}: KbNotificationRowProps) {
  const spec = getNotificationTypeSpec(notification.type);
  const Icon = spec.icon;
  const initials = getInitials(actor?.full_name);

  // Title:
  //   • Если есть actor + verb из registry — собираем «<Actor> <verb>».
  //   • Иначе — рендерим notification.title as-is (system-emit'ы без actor'а).
  const useStructuredTitle = actor && spec.verb;
  const preview = (notification.payload as { preview?: string })?.preview ?? null;

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2.5",
        "border-b border-border/40 last:border-b-0",
        notification.read
          ? "bg-transparent"
          : "bg-blue-50/40 dark:bg-blue-950/20",
        "hover:bg-accent/50 transition-colors cursor-pointer",
      )}
      onClick={() => onOpen(notification)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(notification);
        }
      }}
    >
      {/* Unread-indicator (сине-маркер, абсолютно слева). */}
      {!notification.read && (
        <span
          aria-hidden
          className="absolute left-1 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-blue-500"
        />
      )}

      {/* Avatar / type-icon. */}
      <div className="shrink-0 size-7 rounded-full bg-muted flex items-center justify-center overflow-hidden">
        {actor?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={actor.avatar_url}
            alt=""
            className="size-7 rounded-full object-cover"
          />
        ) : actor ? (
          <span className="text-[11px] font-semibold text-muted-foreground">
            {initials}
          </span>
        ) : (
          <Icon className={cn("size-4", spec.iconColor)} />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {/* Title row */}
        <div className="text-sm leading-snug text-foreground">
          {useStructuredTitle ? (
            <>
              <span className="font-medium">{actor!.full_name}</span>{" "}
              <span className="text-muted-foreground">{spec.verb}</span>{" "}
              <span className="font-medium">«{stripActorPrefix(notification.title, actor!.full_name)}»</span>
            </>
          ) : (
            <span className="font-medium">{notification.title}</span>
          )}
        </div>

        {/* Preview snippet (если есть). */}
        {preview && (
          <div className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5">
            <p className="text-[12px] italic text-muted-foreground leading-snug line-clamp-3">
              {preview}
            </p>
          </div>
        )}

        {/* Time + body row */}
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {relativeTime(notification.created_at)}
        </div>

        {/* Inline-actions (payload.actions[]) — пока не используются
            эмиттерами; reserved для finance/schedule. Дефолтная
            «Открыть» рендерится только если нет custom-actions и есть
            link. */}
        <NotificationActions
          notification={notification}
          onOpen={() => onOpen(notification)}
        />
      </div>

      {/* Hover-archive button (right-aligned). Только в active-scope'е
          для archive, в archive-scope'е для unarchive. */}
      {(onArchive || onUnarchive) && (
        <button
          type="button"
          aria-label={inArchive ? "Восстановить" : "В архив"}
          title={inArchive ? "Восстановить из архива" : "Архивировать"}
          onClick={(e) => {
            e.stopPropagation();
            if (inArchive) {
              onUnarchive?.(notification.id);
            } else {
              onArchive?.(notification.id);
            }
          }}
          className={cn(
            "absolute top-2 right-2",
            "inline-flex items-center justify-center size-7 rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-foreground",
            "opacity-0 group-hover:opacity-100 transition-opacity",
          )}
        >
          {inArchive ? (
            <ArchiveRestore className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

function NotificationActions({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: () => void;
}) {
  const customActions =
    (notification.payload as { actions?: Array<{ label: string }> })?.actions ?? [];

  if (customActions.length > 0) {
    return (
      <div className="flex items-center gap-1.5 mt-0.5">
        {customActions.map((action, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // TODO future: dispatch via action-registry. Для MVP
              // просто открываем link (если есть).
              onOpen();
            }}
            className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-border bg-background hover:bg-accent text-[11px] font-medium transition-colors"
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }

  // Дефолтная «Открыть» если есть link (90% kb-emit'ов).
  if (notification.link) {
    return (
      <div className="flex items-center gap-1.5 mt-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-border bg-background hover:bg-accent text-[11px] font-medium transition-colors"
        >
          <ExternalLink className="size-3" />
          Открыть
        </button>
      </div>
    );
  }
  return null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Если title начинается с «Actor: ...» (legacy формат), strip
 *  actor-prefix чтобы entity был чистым. Иначе возвращаем оригинал.
 *  Для notif'ов без structured-title не вызываем. */
function stripActorPrefix(title: string, actorName: string): string {
  // Текущие эмиттеры (миграция 100) ставят title вроде
  // «Вас упомянули: Регламент кассы». Извлекаем часть после ': ' —
  // обычно это название entity. Fallback на raw title.
  const idx = title.indexOf(": ");
  if (idx > 0 && idx < 80) {
    return title.slice(idx + 2);
  }
  // Если actor.full_name не в title — оставляем как есть.
  if (!title.includes(actorName)) return title;
  return title;
}
