"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, RotateCcw, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import { AuditEventRow } from "@/components/audit/audit-event-row";
import { listAuditEvents, type AuditEvent } from "@/lib/audit/list";
import { groupEventsByDate } from "@/lib/audit/group-by-date";
import {
  AUDIT_ACTION_CATEGORIES,
  categoriesToLikePatterns,
} from "@/lib/audit/action-categories";
import { AUDIT_SECTIONS } from "@/lib/audit/sections";
import { cn } from "@/lib/utils";

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
 *  Записи сгруппированы по дням (сутки — в `timeZone`, как и время в
 *  строке). Над лентой фильтры: «Действие» (общие категории журнала) и
 *  «Раздел» (тип объекта) — в режиме actor по всем разделам, в режиме
 *  entity только если передан `sections` (у сотрудника в журнал входят
 *  зарплатный учёт, медкнижка и форма). Фильтры применяются на сервере,
 *  поэтому «Показать события старее» догружает уже отфильтрованное.
 *
 *  Initial-страница приезжает с сервера (pre-fetched в page.tsx). При
 *  смене фильтров и «Показать события старее» дёргается тот же
 *  listAuditEvents через server-action — без полной навигации.
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

type FilterOption = { value: string; label: string };

type CommonProps = {
  canView: boolean;
  exactTime?: boolean;
  timeZone?: string;
  initialEvents: AuditEvent[];
  initialHasMore: boolean;
  /** Варианты фильтра «Раздел» (entity_type). По умолчанию: в режиме
   *  actor — все разделы журнала, в режиме entity — фильтра нет. */
  sections?: FilterOption[];
  /** `false` — без фильтров (короткая история в панели транзакции). */
  filterable?: boolean;
};

export type EntityAuditTabProps = (EntityModeProps | ActorModeProps) &
  CommonProps;

const ACTION_OPTIONS: FilterOption[] = AUDIT_ACTION_CATEGORIES.map((c) => ({
  value: c.id,
  label: c.name,
}));
const ALL_SECTIONS: FilterOption[] = AUDIT_SECTIONS.map((s) => ({
  value: s.id,
  label: s.name,
}));

type Filters = { sections: string[]; actions: string[] };
const NO_FILTERS: Filters = { sections: [], actions: [] };

export function EntityAuditTab(props: EntityAuditTabProps) {
  const { canView, initialEvents, initialHasMore, filterable = true } = props;
  const sectionOptions =
    props.sections ?? (props.mode === "actor" ? ALL_SECTIONS : []);

  const [events, setEvents] = useState<AuditEvent[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // Что сейчас грузится: смена фильтров (лента приглушена) или следующая
  // страница. Ошибка помнит, что повторить.
  const [loading, setLoading] = useState<"filters" | "more" | null>(null);
  const [failed, setFailed] = useState<"filters" | "more" | null>(null);
  const request = useRef(0);

  // Reset при смене props (родитель перечитал initial-страницу).
  useEffect(() => {
    request.current += 1;
    setEvents(initialEvents);
    setHasMore(initialHasMore);
    setFilters(NO_FILTERS);
    setLoading(null);
    setFailed(null);
  }, [initialEvents, initialHasMore]);

  const filtered = filters.sections.length > 0 || filters.actions.length > 0;

  const query = (next: Filters, cursor?: AuditEvent) => {
    const scope =
      props.mode === "entity"
        ? { entityType: props.entityType, entityId: props.entityId }
        : { filterGroups: [{ actorIds: [props.actorId] }] };
    const patterns = categoriesToLikePatterns(next.actions);
    return {
      ...scope,
      entityTypes: next.sections.length > 0 ? next.sections : undefined,
      actionLikePatterns: patterns.length > 0 ? patterns : undefined,
      beforeCreatedAt: cursor?.created_at,
      beforeId: cursor?.id,
    };
  };

  const applyFilters = (next: Filters) => {
    setFilters(next);
    setFailed(null);
    const id = ++request.current;
    if (next.sections.length === 0 && next.actions.length === 0) {
      setEvents(initialEvents);
      setHasMore(initialHasMore);
      setLoading(null);
      return;
    }
    setLoading("filters");
    listAuditEvents(query(next))
      .then((result) => {
        if (id !== request.current) return;
        if (result.error) {
          setFailed("filters");
          return;
        }
        setEvents(result.events);
        setHasMore(result.hasMore);
      })
      .catch(() => {
        if (id === request.current) setFailed("filters");
      })
      .finally(() => {
        if (id === request.current) setLoading(null);
      });
  };

  const onLoadMore = () => {
    const last = events[events.length - 1];
    if (!last) return;
    setFailed(null);
    setLoading("more");
    const id = request.current;
    listAuditEvents(query(filters, last))
      .then((result) => {
        if (id !== request.current) return;
        if (result.error) {
          setFailed("more");
          return;
        }
        setEvents((prev) => [...prev, ...result.events]);
        setHasMore(result.hasMore);
      })
      .catch(() => {
        if (id === request.current) setFailed("more");
      })
      .finally(() => {
        if (id === request.current) setLoading(null);
      });
  };

  const groups = useMemo(
    () => groupEventsByDate(events, props.timeZone),
    [events, props.timeZone],
  );

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <EmptyState
          icon={ScrollText}
          title="Нет доступа"
          description="Для просмотра журнала нужно право «Видеть журнал аудита»."
        />
      </div>
    );
  }

  // Пустая история без фильтров — фильтровать нечего.
  if (initialEvents.length === 0 && !filtered) {
    const emptyTitle =
      props.mode === "actor" ? "Активность пуста" : "Журнал пуст";
    const emptyDesc =
      props.mode === "actor"
        ? "Здесь появятся действия, которые сотрудник совершит в системе: приём и увольнение, правки данных, изменения в базе знаний"
        : "Здесь появятся события по этому объекту";
    const Icon = props.mode === "actor" ? Activity : ScrollText;
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <EmptyState icon={Icon} title={emptyTitle} description={emptyDesc} />
      </div>
    );
  }

  // В entity-режиме имя сущности уже зашито в headline ⇒ entity-link
  // снизу избыточен. В actor-режиме наоборот — показать что трогали.
  const hideEntity = props.mode === "entity";

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      {filterable && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={props.mode === "actor" ? "Фильтры активности" : "Фильтры журнала"}
        >
          <TableFilterChip
            label="Действие"
            multiple
            value={filters.actions}
            options={ACTION_OPTIONS}
            onChange={(actions) => applyFilters({ ...filters, actions })}
          />
          {sectionOptions.length > 1 && (
            <TableFilterChip
              label="Раздел"
              multiple
              value={filters.sections}
              options={sectionOptions}
              onChange={(sections) => applyFilters({ ...filters, sections })}
            />
          )}
          {/* При пустом результате кнопка стоит в самом пустом блоке. */}
          {filtered && events.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-muted-foreground"
              onClick={() => applyFilters(NO_FILTERS)}
            >
              Очистить все
            </Button>
          )}
        </div>
      )}

      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Не удалось загрузить события
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              failed === "more" ? onLoadMore() : applyFilters(filters)
            }
          >
            <RotateCcw className="mr-2 size-3.5" />
            Повторить
          </Button>
        </div>
      )}

      {events.length === 0 && loading !== "filters" && !failed ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          По этим условиям событий нет
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyFilters(NO_FILTERS)}
          >
            Очистить все
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col gap-5 transition-opacity",
            loading === "filters" && "pointer-events-none opacity-50",
          )}
          aria-busy={loading === "filters"}
        >
          {groups.map((group) => (
            <section
              key={group.dayKey}
              className="flex flex-col gap-2"
              aria-label={group.title}
            >
              <h3 className="px-1 text-[13px] font-medium text-muted-foreground">
                {group.title}
              </h3>
              <ul className="flex flex-col overflow-hidden rounded-[14px] border bg-card">
                {group.events.map((event) => (
                  <AuditEventRow
                    key={event.id}
                    event={event}
                    hideEntity={hideEntity}
                    exactTime={props.exactTime}
                    timeOnly
                    timeZone={props.timeZone}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {hasMore && events.length > 0 && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={loading !== null}
            className="text-muted-foreground hover:text-foreground"
          >
            {loading === "more" ? "Загружаем…" : "Показать события старее"}
          </Button>
        </div>
      )}
    </div>
  );
}
