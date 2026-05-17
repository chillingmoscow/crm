import Link from "next/link";
import {
  FilePlus2,
  FileEdit,
  Pencil,
  ArrowRightFromLine,
  Lock,
  LockOpen,
  Trash2,
  RotateCcw,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type { KbAuditEvent } from "@/lib/knowledge/audit";
import { KbAuditRestoreButton } from "./kb-audit-restore-button";

/** Название страницы в тексте события. Если страница ещё жива (есть
 *  snapshot и не в корзине) — кликабельная ссылка на неё; иначе —
 *  просто выделенный текст (удалённую/hard-deleted не открыть). */
function PageTitle({
  event,
  text,
}: {
  event: KbAuditEvent;
  text: string;
}) {
  const label = `«${text || "Без названия"}»`;
  if (event.page && event.page.deleted_at === null) {
    return (
      <Link
        href={`/knowledge/${event.page.slug}`}
        className="font-medium text-foreground underline-offset-2 hover:underline"
      >
        {label}
      </Link>
    );
  }
  return <strong className="font-medium">{label}</strong>;
}

/** Описание action_code для рендера: иконка, цвет, человеко-читаемая
 *  фраза. payload-data берётся из event.details (jsonb из триггера). */
interface EventSpec {
  icon: LucideIcon;
  iconClass: string;
  buildLabel: (event: KbAuditEvent) => React.ReactNode;
}

const SPECS: Record<string, EventSpec> = {
  "kb_page.created": {
    icon: FilePlus2,
    iconClass: "text-emerald-600 bg-emerald-50",
    buildLabel: (e) => (
      <>
        создал(а) страницу{" "}
        <PageTitle event={e} text={e.details.title as string} />
      </>
    ),
  },
  "kb_page.edited": {
    icon: Pencil,
    iconClass: "text-sky-600 bg-sky-50",
    buildLabel: (e) => (
      <>
        изменил(а) страницу{" "}
        <PageTitle event={e} text={e.details.title as string} />
      </>
    ),
  },
  "kb_page.renamed": {
    icon: FileEdit,
    iconClass: "text-blue-600 bg-blue-50",
    buildLabel: (e) => (
      <>
        переименовал(а):{" "}
        <span className="text-muted-foreground line-through">
          {(e.details.old_title as string) || "Без названия"}
        </span>
        {" → "}
        <PageTitle event={e} text={e.details.new_title as string} />
      </>
    ),
  },
  "kb_page.moved": {
    icon: ArrowRightFromLine,
    iconClass: "text-violet-600 bg-violet-50",
    buildLabel: (e) => {
      const oldParent = (e.details.old_parent_id as string | null) ?? null;
      const newParent = (e.details.new_parent_id as string | null) ?? null;
      const where = newParent ? "вложенную страницу" : "корневую страницу";
      const from = oldParent ? "из вложенной ветки" : "с корневого уровня";
      return (
        <>
          переместил(а){" "}
          <PageTitle event={e} text={e.details.title as string} /> {from} в{" "}
          {where}
        </>
      );
    },
  },
  "kb_page.deleted": {
    icon: Trash2,
    iconClass: "text-destructive bg-destructive/10",
    buildLabel: (e) => {
      const cascadedRoot = e.details.cascaded_root as string | null;
      const isCascaded = cascadedRoot && cascadedRoot !== e.entity_id;
      return (
        <>
          {isCascaded ? "удалил(а) каскадом" : "удалил(а)"} страницу{" "}
          <PageTitle event={e} text={e.details.title as string} />
        </>
      );
    },
  },
  "kb_page.restored": {
    icon: RotateCcw,
    iconClass: "text-foreground bg-muted",
    buildLabel: (e) => (
      <>
        восстановил(а) страницу{" "}
        <PageTitle event={e} text={e.details.title as string} /> из корзины
      </>
    ),
  },
  "kb_page.required_reading_toggled": {
    icon: BookOpen,
    iconClass: "text-amber-600 bg-amber-50",
    buildLabel: (e) => {
      // Legacy events (миграция 087) использовали payload key `enabled`,
      // новые (миграция 096) — `new_value`. Fallback нужен чтобы не
      // рендерить старые «отметил» как «снял» (Codex #85 P1).
      const newValue = Boolean(
        (e.details as { new_value?: boolean; enabled?: boolean }).new_value ??
          (e.details as { enabled?: boolean }).enabled,
      );
      return (
        <>
          {newValue
            ? "пометил(а) страницу как обязательную к прочтению"
            : "снял(а) флаг обязательного прочтения со страницы"}{" "}
          <PageTitle event={e} text={e.details.title as string} />
        </>
      );
    },
  },
  "kb_page.locked": {
    icon: Lock,
    iconClass: "text-amber-600 bg-amber-50",
    buildLabel: (e) => (
      <>
        закрыл(а) страницу{" "}
        <PageTitle event={e} text={e.details.title as string} /> от
        редактирования
      </>
    ),
  },
  "kb_page.unlocked": {
    icon: LockOpen,
    iconClass: "text-foreground bg-muted",
    buildLabel: (e) => (
      <>
        снял(а) защиту от редактирования со страницы{" "}
        <PageTitle event={e} text={e.details.title as string} />
      </>
    ),
  },
};

export function KbAuditEventRow({
  event,
  canRestore = false,
}: {
  event: KbAuditEvent;
  /** `kb.delete_pages` — показывает inline-кнопку «Восстановить»
   *  у событий удаления, если страница ещё в корзине. */
  canRestore?: boolean;
}) {
  const spec = SPECS[event.action_code];
  const Icon = spec?.icon ?? FileEdit;
  const iconClass = spec?.iconClass ?? "text-muted-foreground bg-muted";
  const label = spec ? spec.buildLabel(event) : event.action_code;

  // Если страница ещё существует и не deleted — добавляем link на неё.
  // Soft-deleted page рендерим без ссылки (юзер всё равно её не откроет
  // — RLS на kb_pages пропустит только тех у кого kb.delete_pages, и
  // ссылка на /knowledge/<slug> вернёт notFound).
  const pageStillVisible = event.page && event.page.deleted_at === null;

  // Кнопка «Восстановить» — у КОРНЕВОГО события удаления, если
  // страница ещё в корзине (snapshot есть И deleted_at заполнен =
  // не hard-deleted). Каскадно-удалённые дочерние строки исключаем:
  // restoreKbPage(childId) восстановил бы только ребёнка, оставив
  // родителя в корзине → orphan. Root-событие выше в журнале вернёт
  // всю ветку (Codex #324 P1). Корень: cascaded_root == entity_id
  // либо отсутствует.
  const cascadedRoot = event.details.cascaded_root as string | null;
  const isCascadedChild =
    cascadedRoot != null && cascadedRoot !== event.entity_id;
  const canRestoreThis =
    canRestore &&
    event.action_code === "kb_page.deleted" &&
    !isCascadedChild &&
    event.page != null &&
    event.page.deleted_at !== null;

  return (
    <li className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-accent/40 transition-colors">
      <span
        className={cn(
          "shrink-0 inline-flex items-center justify-center size-8 rounded-full mt-0.5",
          iconClass,
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm leading-snug">
            <span className="font-medium text-foreground">
              {event.actor?.name ?? "Система"}
            </span>{" "}
            <span className="text-foreground">{label}</span>
          </div>
          {canRestoreThis && (
            <KbAuditRestoreButton pageId={event.page!.id} />
          )}
        </div>
        <div className="text-[12px] text-muted-foreground flex items-center gap-2 flex-wrap">
          <time dateTime={event.created_at} data-tip={event.created_at}>
            {formatRelative(event.created_at)}
          </time>
          {pageStillVisible && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <Link
                href={`/knowledge/${event.page!.slug}`}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <KbPageIcon
                  icon={event.page!.icon}
                  color={event.page!.icon_color}
                  size={12}
                />
                <span className="truncate max-w-[200px]">
                  {event.page!.title || "Без названия"}
                </span>
              </Link>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** Простой relative-форматтер: «5 минут назад», «3 часа назад»,
 *  «вчера», иначе DD.MM.YYYY. Без external-deps. */
function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ч назад`;
  const diffDays = Math.round(diffHr / 24);
  if (diffDays === 1) return "вчера";
  if (diffDays < 7) return `${diffDays} дн назад`;
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
