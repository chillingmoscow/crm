"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw, ScrollText, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import { TableControls } from "@/components/shared/table/table-controls";
import { TableConditions } from "@/components/shared/table/table-conditions";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import {
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/shared/date-range-filter";
import { AuditEventRow } from "@/components/audit/audit-event-row";
import { cn } from "@/lib/utils";
import { groupEventsByDate } from "@/lib/audit/group-by-date";
import type { AuditEvent } from "@/lib/audit/list";
import { loadAuditFeedPage } from "@/lib/audit/feed";
import { AUDIT_ACTION_CATEGORIES } from "@/lib/audit/action-categories";
import { AUDIT_MODULES } from "@/lib/audit/modules";
import { AUDIT_SECTIONS } from "@/lib/audit/sections";
import type { AuditStaffOption } from "@/lib/audit/search-staff";

const MODULE_OPTIONS = AUDIT_MODULES.map((m) => ({ value: m.id, label: m.name }));
const ACTION_OPTIONS = AUDIT_ACTION_CATEGORIES.map((c) => ({
  value: c.id,
  label: c.name,
}));
const OBJECT_OPTIONS = AUDIT_SECTIONS.map((s) => ({ value: s.id, label: s.name }));

/** Ключи URL, которые сбрасывает «Очистить все». */
const FILTER_KEYS = [
  "q",
  "sections",
  "types",
  "actions",
  "staff",
  "from",
  "to",
  "date_preset",
] as const;

interface Props {
  events: AuditEvent[];
  hasMore: boolean;
  error: string | null;
  staffOptions: AuditStaffOption[];
  /** `kb.delete_pages` — для restore-кнопки у удалённых KB-страниц. */
  canRestoreKb?: boolean;
  /** Часовой пояс заведения: дни ленты и время в строках. */
  timeZone: string;
}

export function AuditPageClient({
  events,
  hasMore,
  error,
  staffOptions,
  canRestoreKb = false,
  timeZone,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();

  // ── URL state (single source of truth) ────────────────────────
  const urlQ = searchParams.get("q") ?? "";
  const urlSections = parseCsv(searchParams.get("sections"));
  const urlTypes = parseCsv(searchParams.get("types"));
  const urlActions = parseCsv(searchParams.get("actions"));
  const urlStaff = parseCsv(searchParams.get("staff"));
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  const urlDatePreset = searchParams.get("date_preset") ?? null;

  const updateUrl = useCallback(
    (patch: Partial<Record<(typeof FILTER_KEYS)[number], string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      startNavigation(() => {
        router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      });
    },
    [searchParams, pathname, router],
  );

  // ── Search (debounced into URL) ───────────────────────────────
  const [searchDraft, setSearchDraft] = useState(urlQ);
  const [searchOpen, setSearchOpen] = useState(Boolean(urlQ));

  // Sync обратно из URL (back/forward, «Очистить все»).
  useEffect(() => {
    setSearchDraft(urlQ);
  }, [urlQ]);

  useEffect(() => {
    if (searchDraft.trim() === urlQ) return;
    const t = setTimeout(() => {
      updateUrl({ q: searchDraft.trim() || null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // ── Conditions row ────────────────────────────────────────────
  // Скрыт по умолчанию, открывается кнопкой фильтров; выбранный фильтр
  // виден всегда (design-system → «List-страница»).
  const [filtersOpen, setFiltersOpen] = useState(false);

  const hasDate = Boolean(urlFrom || urlTo);
  const hasFilters =
    urlSections.length > 0 ||
    urlTypes.length > 0 ||
    urlActions.length > 0 ||
    urlStaff.length > 0 ||
    hasDate;
  const isFiltered = hasFilters || Boolean(urlQ);

  const dateRange = useMemo<DateRangeValue>(
    () => ({
      start: urlFrom ? parseIsoDate(urlFrom) : null,
      end: urlTo ? parseIsoDate(urlTo) : null,
    }),
    [urlFrom, urlTo],
  );

  const staffChipOptions = useMemo(
    () => staffOptions.map((s) => ({ value: s.id, label: s.name })),
    [staffOptions],
  );

  const resetAll = () => {
    setSearchDraft("");
    updateUrl(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  };

  // ── Pagination («Показать события старее») ────────────────────
  // Первая страница приезжает с сервера. Следующие догружаются тем же
  // loadAuditFeedPage с курсором и дописываются в конец без навигации.
  //
  // Гонка «догрузка × смена фильтра»: старый ответ мог бы дописать
  // события другого фильтра. На старте запоминаем подпись фильтров и
  // выбрасываем ответ, если она успела измениться.
  const [accumulated, setAccumulated] = useState<AuditEvent[]>(events);
  const [accumulatedHasMore, setAccumulatedHasMore] = useState(hasMore);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isLoadingMore, startLoadMore] = useTransition();

  const filtersKey = [
    urlQ,
    urlSections.join(","),
    urlTypes.join(","),
    urlActions.join(","),
    urlStaff.join(","),
    urlFrom,
    urlTo,
  ].join("|");
  const filtersKeyRef = useRef(filtersKey);
  useEffect(() => {
    filtersKeyRef.current = filtersKey;
  }, [filtersKey]);

  useEffect(() => {
    setAccumulated(events);
    setAccumulatedHasMore(hasMore);
    setLoadMoreFailed(false);
  }, [events, hasMore]);

  const onLoadMore = () => {
    const last = accumulated[accumulated.length - 1];
    if (!last) return;
    const snapshotKey = filtersKey;
    setLoadMoreFailed(false);
    startLoadMore(async () => {
      try {
        const result = await loadAuditFeedPage({
          q: urlQ || undefined,
          sections: csvOrUndefined(urlSections),
          types: csvOrUndefined(urlTypes),
          actions: csvOrUndefined(urlActions),
          staff: csvOrUndefined(urlStaff),
          from: urlFrom || undefined,
          to: urlTo || undefined,
          beforeAt: last.created_at,
          beforeId: last.id,
          timeZone,
        });
        if (snapshotKey !== filtersKeyRef.current) return;
        if (result.error) {
          setLoadMoreFailed(true);
          return;
        }
        setAccumulated((prev) => [...prev, ...result.events]);
        setAccumulatedHasMore(result.hasMore);
      } catch {
        if (snapshotKey === filtersKeyRef.current) setLoadMoreFailed(true);
      }
    });
  };

  const groups = useMemo(
    () => groupEventsByDate(accumulated, timeZone),
    [accumulated, timeZone],
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <PageFrame className="space-y-4">
      <Breadcrumbs
        items={[{ label: "Организация" }, { label: "Журнал событий" }]}
      />
      <TablePageHeader
        title="Журнал событий"
        actions={
          <TableControls
            search={{
              value: searchDraft,
              onChange: setSearchDraft,
              open: searchOpen,
              onOpenChange: setSearchOpen,
              placeholder: "Сотрудник, должность, страница, счёт…",
            }}
            filters={{
              active: hasFilters,
              label: filtersOpen ? "Скрыть фильтры" : "Показать фильтры",
              onClick: () => setFiltersOpen((v) => !v),
            }}
          />
        }
      />

      <TableConditions
        label="Условия журнала"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={[]}
        onSortingChange={() => {}}
        sortFields={[]}
        sortLabels={{}}
        search={urlQ}
        onSearchClear={() => {
          setSearchDraft("");
          updateUrl({ q: null });
        }}
        onReset={resetAll}
      >
        {(filtersOpen || hasDate) && (
          <DateRangeFilter
            ariaLabel="Период"
            value={dateRange}
            presetLabel={urlDatePreset}
            onChange={(next, preset) =>
              updateUrl({
                from: next.start ? toIsoDate(next.start) : null,
                to: next.end ? toIsoDate(next.end) : null,
                date_preset: preset,
              })
            }
          />
        )}
        {(filtersOpen || urlSections.length > 0) && (
          <TableFilterChip
            label="Раздел"
            multiple
            value={urlSections}
            options={MODULE_OPTIONS}
            onChange={(ids) => updateUrl({ sections: ids.join(",") || null })}
          />
        )}
        {urlTypes.length > 0 && (
          <TableFilterChip
            label="Объект"
            multiple
            value={urlTypes}
            options={OBJECT_OPTIONS}
            onChange={(ids) => updateUrl({ types: ids.join(",") || null })}
          />
        )}
        {(filtersOpen || urlActions.length > 0) && (
          <TableFilterChip
            label="Действие"
            multiple
            value={urlActions}
            options={ACTION_OPTIONS}
            onChange={(ids) => updateUrl({ actions: ids.join(",") || null })}
          />
        )}
        {(filtersOpen || urlStaff.length > 0) && (
          <TableFilterChip
            label="Сотрудники"
            multiple
            value={urlStaff}
            options={staffChipOptions}
            searchPlaceholder="Найти сотрудника"
            onChange={(ids) => updateUrl({ staff: ids.join(",") || null })}
          />
        )}
      </TableConditions>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Не удалось загрузить журнал
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => startNavigation(() => router.refresh())}
          >
            <RotateCcw className="mr-2 size-3.5" />
            Повторить
          </Button>
        </div>
      ) : accumulated.length === 0 ? (
        <EmptyState
          icon={isFiltered ? SearchX : ScrollText}
          title={isFiltered ? "Событий не найдено" : "Событий пока нет"}
          description={
            isFiltered
              ? "Измените условия поиска или сбросьте фильтры"
              : "Здесь появятся действия сотрудников во всех разделах: кто, когда и что изменил"
          }
          action={
            isFiltered ? (
              <Button variant="outline" onClick={resetAll}>
                Очистить все
              </Button>
            ) : undefined
          }
          className={cn(isNavigating && "opacity-50")}
        />
      ) : (
        <div
          className={cn(
            "flex flex-col gap-5 transition-opacity",
            isNavigating && "pointer-events-none opacity-50",
          )}
          aria-busy={isNavigating}
        >
          {groups.map((group) => (
            <section
              key={group.dayKey}
              className="flex flex-col gap-2"
              aria-label={group.title}
            >
              <h2 className="px-1 text-[13px] font-medium text-muted-foreground">
                {group.title}
              </h2>
              <ul className="flex flex-col overflow-hidden rounded-lg border bg-card">
                {group.events.map((event) => (
                  <AuditEventRow
                    key={event.id}
                    event={event}
                    canRestoreKb={canRestoreKb}
                    timeOnly
                    timeZone={timeZone}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {loadMoreFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Не удалось загрузить события
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onLoadMore}
          >
            <RotateCcw className="mr-2 size-3.5" />
            Повторить
          </Button>
        </div>
      )}

      {!error && accumulatedHasMore && accumulated.length > 0 && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore || isNavigating}
            className="text-muted-foreground hover:text-foreground"
          >
            {isLoadingMore ? "Загружаем…" : "Показать события старее"}
          </Button>
        </div>
      )}
    </PageFrame>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvOrUndefined(values: string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

function parseIsoDate(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
