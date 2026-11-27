"use client";

import { Archive, ArchiveRestore, Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { statusTones } from "@/components/ui/status-badge";
import {
  getNotificationTypeSpec,
  notificationTone,
} from "@/lib/notifications/registry";
import { stackNamesPreview } from "@/lib/notifications/stack";
import { countRu } from "@/lib/format/plural";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type {
  Notification,
  NotificationActor,
} from "@/app/(dashboard)/notifications/actions";
import { personInitials } from "@/lib/format/initials";
import { avatarImageUrl } from "@/lib/people/avatar-thumb";

/**
 * Notion-style строка уведомления для bell'а.
 *
 * Структура:
 *   • Avatar/icon (36×36) — аватар человека (автор или кандидат), иначе
 *     иконка типа в цвете раздела.
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
  /** Фото человека, о котором уведомление (кандидат), если оно есть. */
  entityPhoto?: string | null;
  /** Строка внутри раскрытой стопки — с отступом под заголовок стопки. */
  nested?: boolean;
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
  entityPhoto,
  nested = false,
}: KbNotificationRowProps) {
  const spec = getNotificationTypeSpec(notification.type);

  // Title:
  //   • Если есть actor + verb из registry — собираем «<Actor> <verb>».
  //   • Иначе — рендерим notification.title as-is (system-emit'ы без actor'а).
  const useStructuredTitle = actor && spec.verb;
  const showMarkRead = !inArchive && !notification.read && Boolean(onMarkRead);
  const hasHoverActions =
    showMarkRead || (!inArchive && onArchive) || (inArchive && onUnarchive);

  return (
    <div
      data-notification-row
      data-unread={!notification.read}
      data-nested={nested || undefined}
      className={cn(
        "group relative flex items-start gap-3 px-4 py-3",
        nested && "pl-16",
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
      <NotificationAvatar
        notification={notification}
        actor={actor}
        entityPhoto={entityPhoto}
      />

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {/* Title row: actor + verb + entity-chip. */}
        <div
          data-notification-title
          className="text-sm leading-snug text-foreground"
        >
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
          <p
            data-notification-body
            className="text-[13px] leading-snug text-muted-foreground line-clamp-3"
          >
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
            hasHoverActions && "group-hover:opacity-0 group-focus-visible:opacity-0 group-has-[:focus-visible]:opacity-0",
          )}
        >
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
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
          <div className="absolute right-0 top-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[:focus-visible]:opacity-100 transition-opacity">
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

/**
 * Слева в строке: у уведомления о человеке — его аватар (автор действия или
 * кандидат из анкеты), у остальных — иконка типа в цвете раздела
 * (`CATEGORY_TONES`, тоны статусной палитры — одинаково в обеих темах).
 */
function NotificationAvatar({
  notification,
  actor,
  entityPhoto,
}: {
  notification: Notification;
  actor?: NotificationActor | null;
  entityPhoto?: string | null;
}) {
  const person = actor?.full_name ?? personEntityName(notification);
  const photo = actor
    ? actor.avatar_url && avatarImageUrl(actor.avatar_url, 96)
    : entityPhoto;
  if (person) {
    return (
      <span
        data-notification-avatar
        // Обводка: на подложке непрочитанной строки `bg-muted` сливается с фоном.
        className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border"
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="size-9 object-cover" />
        ) : (
          personInitials(person)
        )}
      </span>
    );
  }
  return <NotificationTypeIcon type={notification.type} />;
}

export function NotificationTypeIcon({ type }: { type: string }) {
  const Icon = getNotificationTypeSpec(type).icon;
  return (
    <span
      data-notification-avatar
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        statusTones[notificationTone(type)],
      )}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

/** Имя человека, о котором уведомление без автора: кандидат из анкеты. */
export function personEntityName(notification: Notification): string | null {
  if (notification.entity_type !== "candidate") return null;
  return extractEntityTitle(notification.title) || null;
}

interface NotificationStackRowProps {
  type: string;
  items: Notification[];
  actorsMap: Map<string, NotificationActor>;
  open: boolean;
  onToggle: () => void;
  /** id раскрывающейся панели — для `aria-controls`. */
  panelId: string;
  onMarkRead?: (ids: string[]) => void;
  onArchive?: (ids: string[]) => void;
  onUnarchive?: (ids: string[]) => void;
  inArchive?: boolean;
}

/**
 * Стопка однотипных уведомлений одного дня: «13 новых анкет», ниже —
 * кого или что она собрала. Нажатие раскрывает отдельные уведомления
 * (`ExpandPanel` под строкой); «Прочитать» и «В архив» действуют на всю
 * стопку.
 */
export function NotificationStackRow({
  type,
  items,
  actorsMap,
  open,
  onToggle,
  panelId,
  onMarkRead,
  onArchive,
  onUnarchive,
  inArchive = false,
}: NotificationStackRowProps) {
  const spec = getNotificationTypeSpec(type);
  const ids = items.map((n) => n.id);
  const unread = items.filter((n) => !n.read);
  const newest = items[0]!;
  const title = spec.stack
    ? countRu(items.length, ...spec.stack)
    : countRu(items.length, "уведомление", "уведомления", "уведомлений");
  // О людях — их имена («Анна Белова, Пётр Орлов и ещё 11»), об остальном —
  // самое новое уведомление и сколько ещё в стопке.
  const people = items.every((n) => n.actor_user_id || personEntityName(n));
  const names = people
    ? stackNamesPreview(
        items.map((n) =>
          n.actor_user_id
            ? (actorsMap.get(n.actor_user_id)?.full_name ?? null)
            : personEntityName(n),
        ),
      )
    : `${newest.title} и ещё ${items.length - 1}`;
  const showMarkRead = !inArchive && unread.length > 0 && Boolean(onMarkRead);
  const hasHoverActions =
    showMarkRead || (!inArchive && onArchive) || (inArchive && onUnarchive);

  return (
    <div
      data-notification-row
      data-notification-stack
      data-unread={unread.length > 0}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "group relative flex items-start gap-3 px-4 py-3",
        "border-b border-border/40 last:border-b-0",
        "hover:bg-accent/50 transition-colors cursor-pointer",
      )}
    >
      <NotificationTypeIcon type={type} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          data-notification-title
          className="flex items-center gap-1 text-sm font-medium leading-snug text-foreground"
        >
          <span className="min-w-0 truncate">{title}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "motion-chevron size-4 shrink-0 text-muted-foreground",
              open && "rotate-180",
            )}
          />
        </div>
        {names && (
          <p
            data-notification-body
            className="line-clamp-2 text-[13px] leading-snug text-muted-foreground"
          >
            {names}
          </p>
        )}
      </div>

      <div className="relative shrink-0 self-start pt-0.5">
        <div
          className={cn(
            "flex items-center gap-1.5 transition-opacity",
            hasHoverActions && "group-hover:opacity-0 group-focus-visible:opacity-0 group-has-[:focus-visible]:opacity-0",
            // Раскрытая стопка держит действия на виду: на телефоне
            // наведения нет, а «Прочитать» нужен и там.
            hasHoverActions && open && "opacity-0",
          )}
        >
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {relativeTime(newest.created_at)}
          </span>
          {unread.length > 0 && (
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand" />
          )}
        </div>
        {hasHoverActions && (
          <div
            className={cn(
              "absolute right-0 top-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[:focus-visible]:opacity-100 transition-opacity",
              open && "opacity-100",
            )}
          >
            {showMarkRead && (
              <IconTooltip label="Прочитать все в стопке">
                <button
                  type="button"
                  aria-label="Прочитать все в стопке"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead?.(unread.map((n) => n.id));
                  }}
                  className={ROW_ACTION_BTN}
                >
                  <Check className="size-3.5" />
                </button>
              </IconTooltip>
            )}
            {!inArchive && onArchive && (
              <IconTooltip label="Стопку в архив">
                <button
                  type="button"
                  aria-label="Стопку в архив"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchive(ids);
                  }}
                  className={ROW_ACTION_BTN}
                >
                  <Archive className="size-3.5" />
                </button>
              </IconTooltip>
            )}
            {inArchive && onUnarchive && (
              <IconTooltip label="Восстановить стопку">
                <button
                  type="button"
                  aria-label="Восстановить стопку"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnarchive(ids);
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
    (notification.payload as { actions?: Array<{ label: string }> })?.actions ??
    [];

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
          className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-border bg-background hover:bg-accent text-xs font-medium transition-colors"
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

