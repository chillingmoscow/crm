import Link from "next/link";

import { cn } from "@/lib/utils";
import { describeAuditEvent } from "@/lib/audit/format";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type { AuditEvent } from "@/lib/audit/list";

interface AuditEventRowProps {
  event: AuditEvent;
  /** Скрыть ссылку-сноску на сущность под строкой. Имя сотрудника
   *  всё равно зашито в headline (см. format.tsx) — флаг убирает только
   *  избыточный link под timestamp'ом, когда журнал рендерится на
   *  карточке самой сущности. */
  hideEntity?: boolean;
}

export function AuditEventRow({ event, hideEntity = false }: AuditEventRowProps) {
  const { icon: Icon, iconClass, headline, details } = describeAuditEvent(event);

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
        <div className="text-sm leading-snug">
          <span className="font-medium text-foreground">
            {event.actor?.name ?? "Система"}
          </span>{" "}
          <span className="text-foreground">{headline}</span>
        </div>
        {details && <div className="pl-0.5">{details}</div>}
        <div className="text-[12px] text-muted-foreground flex items-center gap-2 flex-wrap">
          <time dateTime={event.created_at} title={event.created_at}>
            {formatRelative(event.created_at)}
          </time>
          {!hideEntity && <EntityReference event={event} />}
        </div>
      </div>
    </li>
  );
}

function EntityReference({ event }: { event: AuditEvent }) {
  const { entity } = event;
  if (!entity) return null;

  if (entity.type === "kb_page") {
    if (entity.deleted_at) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/knowledge/${entity.slug}`}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <KbPageIcon
            icon={entity.icon}
            color={entity.icon_color}
            size={12}
          />
          <span className="truncate max-w-[200px]">
            {entity.title || "Без названия"}
          </span>
        </Link>
      </>
    );
  }

  if (entity.type === "staff") {
    // Имя сотрудника уже зашито в headline через <StaffName>, поэтому
    // ссылку здесь не повторяем — только показываем «открыть карточку».
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/people/staff/${entity.id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          открыть карточку
        </Link>
      </>
    );
  }

  return null;
}

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
