import Link from "next/link";

import { cn } from "@/lib/utils";
import { describeAuditEvent } from "@/lib/audit/format";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbRestoreIconButton } from "@/components/audit/kb-restore-icon-button";
import type { AuditEvent } from "@/lib/audit/list";

interface AuditEventRowProps {
  event: AuditEvent;
  /** Скрыть ссылку-сноску на сущность под строкой. Имя сотрудника
   *  всё равно зашито в headline (см. format.tsx) — флаг убирает только
   *  избыточный link под timestamp'ом, когда журнал рендерится на
   *  карточке самой сущности. */
  hideEntity?: boolean;
  /** `kb.delete_pages` — показывает компактную кнопку-восстановление
   *  у удалённой KB-страницы (которая ещё в корзине). */
  canRestoreKb?: boolean;
}

export function AuditEventRow({
  event,
  hideEntity = false,
  canRestoreKb = false,
}: AuditEventRowProps) {
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
          <time dateTime={event.created_at} data-tip={event.created_at}>
            {formatRelative(event.created_at)}
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
      // Страница в корзине — открыть нельзя. Тем, кто может удалять,
      // показываем компактную кнопку восстановления (иконка+подсказка).
      if (!canRestoreKb) return null;
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

  if (entity.type === "role") {
    // Системные роли (venue_id=null) — owner — не имеют редактируемой
    // страницы, ссылку не показываем.
    if (!entity.venue_id) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/people/roles/${entity.id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
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
          className="text-muted-foreground hover:text-foreground transition-colors"
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
          className="text-muted-foreground hover:text-foreground transition-colors"
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
          href="/finance/accounts"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          открыть счёт
        </Link>
      </>
    );
  }

  if (entity.type === "finance_category") {
    // Архивированные категории (is_active=false) — без линка, по
    // аналогии с soft-deleted transaction/bank_account/counterparty.
    if (!entity.is_active) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href="/finance/categories"
          className="text-muted-foreground hover:text-foreground transition-colors"
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
          className="text-muted-foreground hover:text-foreground transition-colors"
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
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          открыть заведение
        </Link>
      </>
    );
  }

  if (entity.type === "legal_entity") {
    // Архивированные юрлица — без линка (по аналогии с category).
    if (!entity.is_active) return null;
    return (
      <>
        <span className="text-muted-foreground/50">·</span>
        <Link
          href={`/org/legal-entities/${entity.id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
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
          className="text-muted-foreground hover:text-foreground transition-colors"
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
