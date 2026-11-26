import Link from "next/link";

import { cn } from "@/lib/utils";
import { describeAuditEvent } from "@/lib/audit/format";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbRestoreIconButton } from "@/components/audit/kb-restore-icon-button";
import type { AuditEvent } from "@/lib/audit/list";
import { genderizeNode } from "@/components/audit/genderize-node";
import type { ActorGender } from "@/lib/audit/gender";

interface AuditEventRowProps {
  event: AuditEvent;
  exactTime?: boolean;
  timeZone?: string;
  /** Скрыть ссылку-сноску на сущность под строкой. Имя сотрудника
   *  всё равно зашито в headline (см. format.tsx) — флаг убирает только
   *  избыточный link под timestamp'ом, когда журнал рендерится на
   *  карточке самой сущности. */
  hideEntity?: boolean;
  /** Строки сгруппированы по дням (дата — в заголовке группы): под
   *  строкой только время «14:05» (с `exactTime` — с секундами). */
  timeOnly?: boolean;
  /** `kb.delete_pages` — показывает компактную кнопку-восстановление
   *  у удалённой KB-страницы (которая ещё в корзине). */
  canRestoreKb?: boolean;
}

export function AuditEventRow({
  event,
  hideEntity = false,
  canRestoreKb = false,
  exactTime = false,
  timeOnly = false,
  timeZone,
}: AuditEventRowProps) {
  const {
    icon: Icon,
    iconClass,
    headline,
    details,
  } = describeAuditEvent(event);
  // Без автора и без внешнего автора действие подписано «Система» — глагол
  // в женском роде («Система удалила»).
  const gender: ActorGender = event.actor
    ? (event.actor.gender as ActorGender)
    : typeof event.details.source_author === "string"
      ? null
      : "female";

  return (
    <li className="flex items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/30">
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
            {event.actor?.name ?? (typeof event.details.source_author === "string" ? event.details.source_author : "Система")}
          </span>{" "}
          <span className="text-foreground">{genderizeNode(headline, gender)}</span>
        </div>
        {details && <div className="pl-0.5">{genderizeNode(details, gender)}</div>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <time
            dateTime={event.created_at}
            data-tip={new Date(event.created_at).toLocaleString("ru-RU", {
              timeZone,
              ...(event.details.source_precision === "day" ? { dateStyle: "short" as const } : {}),
            })}
          >
            {event.details.source_precision === "day"
              ? timeOnly
                ? "В течение дня"
                : new Date(event.created_at).toLocaleDateString("ru-RU", { timeZone })
              : timeOnly
              ? new Date(event.created_at).toLocaleTimeString("ru-RU", {
                  timeZone,
                  hour: "2-digit",
                  minute: "2-digit",
                  ...(exactTime ? { second: "2-digit" as const } : {}),
                })
              : exactTime
              ? new Date(event.created_at).toLocaleString("ru-RU", {
                  timeZone,
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : formatRelative(event.created_at)}
          </time>
          {!hideEntity && (
            <EntityReference event={event} canRestoreKb={canRestoreKb} />
          )}
        </div>
      </div>
    </li>
  );
}

function EntityReference({
  event,
  canRestoreKb = false,
}: {
  event: AuditEvent;
  canRestoreKb?: boolean;
}) {
  const { entity } = event;
  if (!entity) return null;

  if (entity.type === "kb_page") {
    if (entity.deleted_at) {
      // Restore показываем только у КОРНЕВОГО события удаления:
      //  • именно kb_page.deleted (не на «изменил/переименовал»
      //    строке, чей snapshot тоже может быть deleted);
      //  • не каскадно-удалённый потомок (cascaded_root == entity_id
      //    либо отсутствует) — иначе restoreKbPage(childId) вернул бы
      //    только ветку ребёнка, оставив родителя в корзине (orphan;
      //    та же защита была в старом KbAuditEventRow / Codex #324).
      const cascadedRoot = event.details.cascaded_root as
        string | null | undefined;
      const isCascadedChild =
        cascadedRoot != null && cascadedRoot !== event.entity_id;
      const isRootDelete =
        event.action_code === "kb_page.deleted" && !isCascadedChild;
      if (!canRestoreKb || !isRootDelete) return null;
      return (
        <>
          <span className="text-muted-foreground/50">·</span>
          <KbRestoreIconButton pageId={entity.id} />
        </>
      );
    }
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/knowledge/${entity.slug}`}
          className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-brand"
        >
          <KbPageIcon icon={entity.icon} color={entity.icon_color} size={12} />
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
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть карточку
        </Link>
      </>
    );
  }

  if (entity.type === "role") {
    // Системные роли (venue_id=null) — owner — не имеют редактируемой
    // страницы, ссылку не показываем.
    if (!entity.venue_id) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/people/roles/${entity.id}`}
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть должность
        </Link>
      </>
    );
  }

  if (entity.type === "department") {
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/people/departments/${entity.id}`}
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть подразделение
        </Link>
      </>
    );
  }

  // invitation — нет отдельной страницы, статус показываем как подсказку.
  if (entity.type === "invitation") {
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <span className="text-muted-foreground">
          {entity.status === "pending"
            ? "ожидает"
            : entity.status === "accepted"
              ? "принято"
              : entity.status}
        </span>
      </>
    );
  }

  if (entity.type === "transaction") {
    if (entity.deleted_at) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/finance/transactions?id=${entity.id}`}
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть транзакцию
        </Link>
      </>
    );
  }

  if (entity.type === "bank_account") {
    if (entity.deleted_at) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/finance/accounts/${entity.id}`}
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть счёт
        </Link>
      </>
    );
  }

  if (entity.type === "finance_category") {
    // Архивированные категории (archived_at NOT NULL) — без линка, по
    // аналогии с soft-deleted transaction/bank_account/counterparty.
    // Миграция 202: is_active → archived_at.
    if (entity.archived_at) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href="/finance/categories"
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть статью
        </Link>
      </>
    );
  }

  if (entity.type === "counterparty") {
    if (entity.deleted_at) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href="/finance/counterparties"
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть контрагента
        </Link>
      </>
    );
  }

  if (entity.type === "venue") {
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/org/venues/${entity.id}`}
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть заведение
        </Link>
      </>
    );
  }

  if (entity.type === "legal_entity") {
    // Архивированные юрлица — без линка (по аналогии с category).
    // Миграция 200: is_active → archived_at (null = live).
    if (entity.archived_at) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/org/legal-entities/${entity.id}`}
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть юрлицо
        </Link>
      </>
    );
  }

  if (entity.type === "account") {
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href="/org/account"
          className="text-muted-foreground transition-colors hover:text-brand"
        >
          открыть аккаунт
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
