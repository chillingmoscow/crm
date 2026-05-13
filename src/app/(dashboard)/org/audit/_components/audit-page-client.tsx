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
import { Search, ScrollText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { AuditEventRow } from "@/components/audit/audit-event-row";
import { groupEventsByDate } from "@/lib/audit/group-by-date";
import type { AuditEvent } from "@/lib/audit/list";
import { loadAuditFeedPage } from "@/lib/audit/feed";

import {
  DateRangeFilter,
  type DateRangeValue,
} from "@/app/(dashboard)/finance/transactions/_components/filters/date-range-filter";
import {
  MultiSelectFilter,
  type MultiSelectItem,
} from "@/app/(dashboard)/finance/transactions/_components/filters/multi-select-filter";

import type { AuditStaffOption } from "@/lib/audit/search-staff";

const SECTION_OPTIONS: MultiSelectItem[] = [
  { id: "staff", name: "Сотрудники" },
  { id: "invitation", name: "Приглашения" },
  { id: "role", name: "Должности" },
  { id: "department", name: "Подразделения" },
  { id: "transaction", name: "Транзакции" },
  { id: "bank_account", name: "Счета" },
  { id: "finance_category", name: "Статьи" },
  { id: "counterparty", name: "Контрагенты" },
  { id: "venue", name: "Заведения" },
  { id: "legal_entity", name: "Юрлица" },
  { id: "account", name: "Аккаунт" },
  { id: "kb_page", name: "База знаний" },
];

const FILTERS_VISIBLE_STORAGE_KEY = "org-audit.filters-visible";

interface Props {
  events: AuditEvent[];
  hasMore: boolean;
  error: string | null;
  staffOptions: AuditStaffOption[];
}

export function AuditPageClient({
  events,
  hasMore,
  error,
  staffOptions,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── URL state (single source of truth) ────────────────────────
  const urlQ = searchParams.get("q") ?? "";
  const urlTypes = parseCsv(searchParams.get("types"));
  const urlStaff = parseCsv(searchParams.get("staff"));
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  const urlDatePreset = searchParams.get("date_preset") ?? null;

  const updateUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      // Сброс курсора пагинации при любом изменении фильтра.
      params.delete("before_at");
      params.delete("before_id");
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
    },
    [searchParams, pathname, router],
  );

  // ── Search ────────────────────────────────────────────────────
  const [searchDraft, setSearchDraft] = useState(urlQ);
  const [searchExpanded, setSearchExpanded] = useState(!!urlQ);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync обратно из URL (back/forward).
  useEffect(() => {
    setSearchDraft(urlQ);
  }, [urlQ]);

  useEffect(() => {
    if (searchDraft === urlQ) return;
    const t = setTimeout(() => {
      updateUrl({ q: searchDraft.trim() || null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // ── Filter chips bar visibility (persisted) ───────────────────
  const [filtersVisible, setFiltersVisible] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(FILTERS_VISIBLE_STORAGE_KEY);
    if (stored !== null) setFiltersVisible(stored === "true");
  }, []);
  const toggleFiltersVisibility = () => {
    setFiltersVisible((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(FILTERS_VISIBLE_STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  // ── Computed bits ─────────────────────────────────────────────
  const dateRange = useMemo<DateRangeValue>(
    () => ({
      start: urlFrom ? parseIsoDate(urlFrom) : null,
      end: urlTo ? parseIsoDate(urlTo) : null,
    }),
    [urlFrom, urlTo],
  );

  const staffMultiSelectItems = useMemo<MultiSelectItem[]>(
    () =>
      staffOptions.map((s) => ({
        id: s.id,
        name: s.name,
      })),
    [staffOptions],
  );

  const activeFilterCount =
    (urlTypes.length > 0 ? 1 : 0) +
    (urlStaff.length > 0 ? 1 : 0) +
    (urlFrom || urlTo ? 1 : 0) +
    (urlQ ? 1 : 0);

  // ── Client-side pagination state ──────────────────────────────
  // Изначальная страница приезжает с сервера (events prop). «Загрузить
  // ещё» дёргает loadAuditFeedPage с курсором и append'ит — без полной
  // навигации, скролл сохраняется.
  //
  // При смене любого фильтра URL меняется → page.tsx ре-рендерится →
  // events/hasMore приезжают новые → reset через useEffect ниже.
  //
  // Гонка load-more × filter change: если пользователь кликнул
  // «Загрузить ещё», а потом сразу сменил фильтр, старый запрос мог бы
  // долететь и append'нуть устаревшие события. Защищаемся через
  // request-key: на старте сохраняем подпись текущих фильтров, при
  // приземлении результата сверяем с ref'ом — несовпадение значит
  // фильтры успели измениться, результат игнорируем.
  const [accumulated, setAccumulated] = useState<AuditEvent[]>(events);
  const [accumulatedHasMore, setAccumulatedHasMore] = useState(hasMore);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isLoadingMore, startLoadMore] = useTransition();

  const filtersKey = `${urlQ}|${urlTypes.join(",")}|${urlStaff.join(",")}|${urlFrom}|${urlTo}`;
  const filtersKeyRef = useRef(filtersKey);
  useEffect(() => {
    filtersKeyRef.current = filtersKey;
  }, [filtersKey]);

  useEffect(() => {
    setAccumulated(events);
    setAccumulatedHasMore(hasMore);
    setLoadMoreError(null);
  }, [events, hasMore]);

  const onLoadMore = () => {
    const last = accumulated[accumulated.length - 1];
    if (!last) return;
    const snapshotKey = filtersKey;
    startLoadMore(async () => {
      const result = await loadAuditFeedPage({
        q: urlQ || undefined,
        types: urlTypes.length > 0 ? urlTypes.join(",") : undefined,
        staff: urlStaff.length > 0 ? urlStaff.join(",") : undefined,
        from: urlFrom || undefined,
        to: urlTo || undefined,
        beforeAt: last.created_at,
        beforeId: last.id,
      });
      // Stale guard: фильтры успели поменяться — выбрасываем результат,
      // accumulator сейчас уже соответствует новому фильтру.
      if (snapshotKey !== filtersKeyRef.current) return;
      if (result.error) {
        setLoadMoreError(result.error);
        return;
      }
      setAccumulated((prev) => [...prev, ...result.events]);
      setAccumulatedHasMore(result.hasMore);
    });
  };

  const groups = useMemo(() => groupEventsByDate(accumulated), [accumulated]);
  const hasFilters = activeFilterCount > 0;
  const isInitialLoad = !searchParams.get("before_at");

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Журнал событий</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            История действий по аккаунту: приём и увольнение сотрудников,
            смена должностей, обновление контактов и HR-данных, изменения
            в базе знаний
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Expandable search */}
          <div className="flex items-center">
            {searchExpanded || searchDraft ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  autoFocus
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  onBlur={() => {
                    if (!searchDraft) setSearchExpanded(false);
                  }}
                  placeholder="Поиск по сотрудникам и страницам…"
                  className="pl-9 pr-8 h-9 w-72"
                />
                {searchDraft && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchDraft("");
                      updateUrl({ q: null });
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    aria-label="Очистить поиск"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <IconButton
                onClick={() => setSearchExpanded(true)}
                aria-label="Поиск"
              >
                <Search className="h-4 w-4" />
              </IconButton>
            )}
          </div>

          <IconButton
            onClick={toggleFiltersVisibility}
            active={activeFilterCount > 0}
            badge={activeFilterCount}
            aria-label={filtersVisible ? "Скрыть фильтры" : "Показать фильтры"}
          >
            <FilterIcon />
          </IconButton>
        </div>
      </div>

      {/* Filter chips bar */}
      {filtersVisible && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <DateRangeFilter
            value={dateRange}
            presetLabel={urlDatePreset}
            onChange={(next, preset) => {
              updateUrl({
                from: next.start ? toIsoDate(next.start) : null,
                to: next.end ? toIsoDate(next.end) : null,
                date_preset: preset,
              });
            }}
          />

          <MultiSelectFilter
            placeholder="Раздел"
            items={SECTION_OPTIONS}
            selectedIds={urlTypes}
            onChange={(ids) => {
              updateUrl({ types: ids.length > 0 ? ids.join(",") : null });
            }}
          />

          <MultiSelectFilter
            placeholder="Сотрудники"
            items={staffMultiSelectItems}
            selectedIds={urlStaff}
            onChange={(ids) => {
              updateUrl({ staff: ids.length > 0 ? ids.join(",") : null });
            }}
          />

          {urlQ && (
            <Chip
              label={`Поиск: «${urlQ}»`}
              onClear={() => {
                setSearchDraft("");
                updateUrl({ q: null });
              }}
            />
          )}

          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setSearchDraft("");
                updateUrl({
                  q: null,
                  types: null,
                  staff: null,
                  from: null,
                  to: null,
                  date_preset: null,
                });
              }}
            >
              Очистить все
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Не удалось загрузить журнал: {error}
        </div>
      )}

      {!error && accumulated.length === 0 && isInitialLoad && (
        <EmptyState
          icon={ScrollText}
          title={hasFilters ? "Ничего не найдено" : "Пока пусто"}
          description={
            hasFilters
              ? "Попробуйте изменить фильтры или сбросить их"
              : "Сюда будут попадать события по всем модулям. Появятся, как только сотрудники начнут действовать в системе"
          }
        />
      )}

      {!error && groups.length > 0 && (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.dayKey} className="flex flex-col gap-2">
              <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
                {group.title}
              </h2>
              <ul className="flex flex-col rounded-md border bg-background overflow-hidden">
                {group.events.map((event) => (
                  <AuditEventRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {loadMoreError && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Не удалось загрузить больше: {loadMoreError}
        </div>
      )}

      {accumulatedHasMore && accumulated.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="text-muted-foreground hover:text-foreground"
          >
            {isLoadingMore ? "Загружаем…" : "Загрузить ещё"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────

function IconButton({
  children,
  onClick,
  active,
  badge,
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
} & React.HTMLAttributes<HTMLElement>) {
  const className = cn(
    "relative inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background text-muted-foreground hover:bg-muted transition-colors",
    active && "bg-brand/10 border-brand/20 text-brand",
  );
  const tooltipLabel =
    typeof rest["aria-label"] === "string" ? rest["aria-label"] : undefined;
  const inner = (
    <button type="button" onClick={onClick} className={className} {...rest}>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-background bg-destructive text-[10px] font-semibold text-destructive-foreground">
          {badge}
        </span>
      )}
    </button>
  );
  return tooltipLabel ? (
    <IconTooltip label={tooltipLabel}>{inner}</IconTooltip>
  ) : (
    inner
  );
}

function FilterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-sm pl-3 pr-1.5 py-0.5 h-8">
      <span className="truncate max-w-[200px]">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Очистить"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
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
