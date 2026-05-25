"use client";

import { Archive, ArchiveRestore, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { getNotificationTypeSpec } from "@/lib/notifications/registry";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type {
  Notification,
  NotificationActor,
} from "@/app/(dashboard)/notifications/actions";

/**
 * Notion-style строка уведомления для bell'а.
 *
 * Структура:
 *   • Avatar/icon (28×28) — actor.avatar если есть, иначе type-иконка.
 *   • Title row: «<actor> <verb> <entity>».
 *   • Body-snippet (для system-emit'ов без actor'а) — line-clamp-3.
 *   • Action buttons (payload.actions[]).
 *   • Справа: дата + dot непрочитанного; на hover дата сменяется
 *     кнопками действий («Отметить прочитанным» / «В архив» /
 *     «Восстановить») — как в Notion.
 */

interface KbNotificationRowProps {
  notification: Notification;
  /** Актёр (если notification.actor_user_id есть). Caller'ом
   *  предоставляется через batch-fetch. */
  actor?: NotificationActor | null;
  /** Open notif (mark read + navigate). */
  onOpen: (notif: Notification) => void;
  /** Пометить прочитанным (только active scope, только для непрочит.). */
  onMarkRead?: (id: string) => void;
  /** Archive notif (только в active scope'е). */
  onArchive?: (id: string) => void;
  /** Unarchive notif (только в archive scope'е). */
  onUnarchive?: (id: string) => void;
  /** Если в archive — рендерим Restore вместо Archive. */
  inArchive?: boolean;
}

const ROW_ACTION_BTN =
  "inline-flex items-center justify-center size-7 rounded-md bg-background text-muted-foreground hover:bg-accent hover:text-foreground border border-border/60";

export function KbNotificationRow({
  notification,
  actor,
  onOpen,
  onMarkRead,
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
  const showMarkRead = !inArchive && !notification.read && Boolean(onMarkRead);
  const hasHoverActions =
    showMarkRead || (!inArchive && onArchive) || (inArchive && onUnarchive);

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2.5 px-4 py-2.5",
        "border-b border-border/40 last:border-b-0",
        "hover:bg-accent/50 transition-colors cursor-pointer",
      )}
      onClick={() => onOpen(notification)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Ignore bubbled keypresses из nested buttons (archive,
        // inline-actions). Без этого Enter/Space на child-button'е
        // ловится тут И в самом button-handler'е → юзер случайно
        // mark'ает read и открывает link, пытаясь выполнить child
        // action. См. Codex #91 P1.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(notification);
        }
      }}
    >
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
        {/* Title row: actor + verb + entity-chip. */}
        <div className="text-sm leading-snug text-foreground">
          {useStructuredTitle ? (
            <>
              <span className="font-medium">{actor!.full_name}</span>{" "}
              <span className="text-muted-foreground">{spec.verb}</span>{" "}
              <EntityChip notification={notification} />
            </>
          ) : (
            <span className="font-medium">{notification.title}</span>
          )}
        </div>

        {/* Body-snippet для system-emit'ов без actor'а (birthday /
            medical_book_expiring) — это и есть полезный текст. */}
        {!useStructuredTitle && notification.body && (
          <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">
            {notification.body}
          </p>
        )}

        {/* Inline custom-actions (payload.actions[]) — reserved для
            будущих finance/schedule с Approve/Deny. */}
        <NotificationActions
          notification={notification}
          onOpen={() => onOpen(notification)}
        />
      </div>

      {/* Правая колонка: дата + dot непрочитанного. На hover дата
          сменяется кнопками действий (Notion-паттерн). */}
      <div className="relative shrink-0 self-start pt-0.5">
        <div
          className={cn(
            "flex items-center gap-1.5 transition-opacity",
            hasHoverActions && "group-hover:opacity-0",
          )}
        >
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
            {relativeTime(notification.created_at)}
          </span>
          {!notification.read && (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-brand"
            />
          )}
        </div>

        {hasHoverActions && (
          <div className="absolute right-0 top-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {showMarkRead && (
              <IconTooltip label="Отметить прочитанным">
                <button
                  type="button"
                  aria-label="Отметить прочитанным"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead?.(notification.id);
                  }}
                  className={ROW_ACTION_BTN}
                >
                  <Check className="size-3.5" />
                </button>
              </IconTooltip>
            )}
            {!inArchive && onArchive && (
              <IconTooltip label="В архив">
                <button
                  type="button"
                  aria-label="В архив"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchive(notification.id);
                  }}
                  className={ROW_ACTION_BTN}
                >
                  <Archive className="size-3.5" />
                </button>
              </IconTooltip>
            )}
            {inArchive && onUnarchive && (
              <IconTooltip label="Восстановить">
                <button
                  type="button"
                  aria-label="Восстановить"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnarchive(notification.id);
                  }}
                  className={ROW_ACTION_BTN}
                >
                  <ArchiveRestore className="size-3.5" />
                </button>
              </IconTooltip>
            )}
          </div>
        )}
      </div>
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

  if (customActions.length === 0) return null;

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

/** Entity-chip — кликабельная ссылка с иконкой страницы (или дефолтным
 *  FileText для не-page entity). Inline в title-row, по стилю как
 *  KbPageMention в editor'е.
 *
 *  Title извлекается из payload.page_title (заполняется эмиттерами в
 *  миграции 100) или fallback'ится на parsing notification.title после
 *  «: ». slug извлекается из notification.link (`/knowledge/<slug>`).
 *
 *  Click пробрасывается row'у через bubbling — link не вызывается
 *  напрямую, чтобы row отметил read и сделал router.push. */
function EntityChip({ notification }: { notification: Notification }) {
  const payload = notification.payload as {
    page_title?: string;
    page_icon?: string | null;
    page_icon_color?: string | null;
  };
  const title = payload.page_title ?? extractEntityTitle(notification.title);
  return (
    <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-foreground font-medium hover:bg-accent transition-colors">
      <KbPageIcon
        icon={payload.page_icon ?? null}
        color={payload.page_icon_color ?? null}
        size={14}
      />
      <span className="truncate">{title}</span>
    </span>
  );
}

/** Если title в формате «<prefix>: <entity>», возвращает <entity>.
 *  Используется для legacy-notif'ов где payload.page_title отсутствует. */
function extractEntityTitle(title: string): string {
  const idx = title.indexOf(": ");
  if (idx > 0 && idx < 80) return title.slice(idx + 2);
  return title;
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

