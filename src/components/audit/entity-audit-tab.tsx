"use client";

import { useEffect, useState, useTransition } from "react";
import { Activity, ScrollText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { AuditEventRow } from "@/components/audit/audit-event-row";
import { listAuditEvents, type AuditEvent } from "@/lib/audit/list";

/** Reusable «Журнал» / «Активность» вкладка для карточек сущностей.
 *
 *  Два режима через discriminated props:
 *   • mode='entity' — события про эту сущность (entityType + entityId).
 *     Имя сущности в headline и так есть — entity-ссылка снизу прячется
 *     через `hideEntity`.
 *   • mode='actor'  — события, которые этот пользователь совершил
 *     (filterGroups с actorIds). Имя сущности (объекта действия)
 *     наоборот показывается, чтобы было понятно что/кого трогали.
 *
 *  Initial-страница приезжает с сервера (pre-fetched в page.tsx). При
 *  «Загрузить ещё» дёргается тот же listAuditEvents через server-action
 *  и append'ится в state — без полной навигации.
 */
type EntityModeProps = {
  mode: "entity";
  entityType: string;
  entityId: string;
};

type ActorModeProps = {
  mode: "actor";
  actorId: string;
};

type CommonProps = {
  canView: boolean;
  initialEvents: AuditEvent[];
  initialHasMore: boolean;
};

export type EntityAuditTabProps = (EntityModeProps | ActorModeProps) & CommonProps;

export function EntityAuditTab(props: EntityAuditTabProps) {
  const { canView, initialEvents, initialHasMore } = props;

  const [events, setEvents] = useState<AuditEvent[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Reset при смене props (если родитель меняет initial-стейт по фильтрам).
  useEffect(() => {
    setEvents(initialEvents);
    setHasMore(initialHasMore);
    setError(null);
  }, [initialEvents, initialHasMore]);

  const onLoadMore = () => {
    const last = events[events.length - 1];
    if (!last) return;
    startTransition(async () => {
      const query =
        props.mode === "entity"
          ? {
              entityType: props.entityType,
              entityId: props.entityId,
              beforeCreatedAt: last.created_at,
              beforeId: last.id,
            }
          : {
              filterGroups: [{ actorIds: [props.actorId] }],
              beforeCreatedAt: last.created_at,
              beforeId: last.id,
            };
      const result = await listAuditEvents(query);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEvents((prev) => [...prev, ...result.events]);
      setHasMore(result.hasMore);
    });
  };

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <EmptyState
          icon={ScrollText}
          title="Нет доступа"
          description="Для просмотра журнала нужно право «Видеть журнал аудита»."
        />
      </div>
    );
  }

  if (events.length === 0) {
    const emptyTitle = props.mode === "actor" ? "Активность пуста" : "Журнал пуст";
    const emptyDesc =
      props.mode === "actor"
        ? "Здесь появятся действия, которые сотрудник совершит в системе: приёмы / увольнения, правки данных, изменения в базе знаний и т.д."
        : "Здесь появятся события по этому объекту.";
    const Icon = props.mode === "actor" ? Activity : ScrollText;
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <EmptyState icon={Icon} title={emptyTitle} description={emptyDesc} />
      </div>
    );
  }

  // В entity-режиме имя сущности уже зашито в headline ⇒ entity-link
  // снизу избыточен. В actor-режиме наоборот — показать что трогали.
  const hideEntity = props.mode === "entity";

  return (
    <div className="mx-auto w-full max-w-[760px] flex flex-col gap-3">
      <ul className="flex flex-col rounded-md border bg-background overflow-hidden">
        {events.map((event) => (
          <AuditEventRow key={event.id} event={event} hideEntity={hideEntity} />
        ))}
      </ul>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Не удалось загрузить: {error}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isPending}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {isPending ? "Загружаем…" : "Показать события старее →"}
          </button>
        </div>
      )}
    </div>
  );
}
