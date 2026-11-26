"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  CalendarDays,
  FileCheck2,
  FileText,
  Loader2,
  RefreshCw,
  SearchX,
  Settings,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import { AnimatedMoney, AnimatedNumber } from "@/components/shared/animated-money";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { MonthPicker } from "@/components/shared/month-picker";
import { PageFrame } from "@/components/shared/page-frame";
import { PeriodStepper } from "@/components/shared/period-stepper";
import {
  DataTable,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TableIconButton,
  TablePageHeader,
  TablePagination,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryItem,
  DrawerSummaryTotal,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import {
  formatDateCell,
  formatDayMonth,
  formatDayMonthTime,
} from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import {
  supplyFieldNames,
  type SupplyConfiguration,
  type SupplyDetail,
  type SupplyFilters,
  type SupplyHistory,
  type SupplyList,
  type SupplyRow,
} from "@/lib/supplies/types";
import {
  loadSupplies,
  loadSupply,
  loadSupplyConfiguration,
  requestSupplies,
  saveSupplyReadRules,
} from "./actions";
import { SupplyPaymentPanel } from "./payment-panel";

// ── Подписи ──────────────────────────────────────────────────

/** Этапы фонового чтения Quick Resto: сначала читаем, потом сверяем. */
const stages: Record<string, string> = {
  grid_first: "Читаем накладные из Quick Resto",
  financial_first: "Читаем оплаты из Quick Resto",
  grid_verify: "Сверяем накладные с Quick Resto",
  financial_verify: "Сверяем оплаты с Quick Resto",
};
const historyActions: Record<SupplyHistory["action"], string> = {
  created: "Накладная сохранена",
  updated: "Накладная изменилась в Quick Resto",
  missing: "Накладной нет в Quick Resto",
  returned: "Накладная снова есть в Quick Resto",
  payment_linked: "Расход связан с накладной",
  payment_updated: "Изменена сумма связи с расходом",
  payment_unlinked: "Связь с расходом убрана",
  payment_changed: "Связанный расход изменился",
};

/** Статус оплаты — одни и те же слова в таблице, панели и фильтре. */
const PAYMENT: Record<
  SupplyRow["payment"]["state"],
  { label: string; tone: StatusTone; tip: string }
> = {
  paid: {
    label: "Оплачено",
    tone: "success",
    tip: "Связанные расходы покрывают сумму накладной",
  },
  partial: {
    label: "Частично",
    tone: "warning",
    tip: "Связанные расходы покрывают только часть суммы",
  },
  review: {
    label: "Проверить оплату",
    tone: "warning",
    tip: "Связанный расход или сумма накладной изменились",
  },
  unlinked: {
    label: "Не связана",
    tone: "neutral",
    tip: "Расход ещё не связан с накладной",
  },
};

type ColKey = "date" | "number" | "provider" | "store" | "amount" | "payment";
const labels: Record<ColKey, string> = {
  date: "Дата",
  number: "Накладная",
  provider: "Поставщик",
  store: "Склад",
  amount: "Сумма",
  payment: "Оплата",
};
const columnConfig = [
  { id: "date", defaultSize: 120 },
  { id: "number", defaultSize: 240 },
  { id: "provider", defaultSize: 280 },
  { id: "store", defaultSize: 200, defaultVisible: false },
  { id: "amount", defaultSize: 160 },
  { id: "payment", defaultSize: 180 },
];
const sortFields: ColKey[] = ["date", "number", "provider", "amount", "payment"];
/** Столбец таблицы → поле сортировки на сервере. Сервер сортирует по одному полю. */
const SERVER_SORT: Partial<Record<ColKey, SupplyFilters["sort"]>> = {
  date: "date",
  number: "number",
  provider: "provider",
  amount: "amount",
  payment: "paid",
};

const PAID_OPTIONS = [
  { value: "", label: "Все накладные" },
  { value: "paid", label: "Оплачено" },
  { value: "unpaid", label: "Не оплачено" },
  { value: "review", label: "Проверить" },
  { value: "draft", label: "Черновики" },
];

/** «2026-11» в поясе заведения. */
function monthIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .slice(0, 7);
  } catch {
    return new Date().toISOString().slice(0, 7);
  }
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
const MIN_MONTH = "2000-01";

// ── Мелкие части ─────────────────────────────────────────────

function PaymentBadge({ row }: { row: SupplyRow }) {
  const p = PAYMENT[row.payment.state];
  return (
    <StatusBadge tone={p.tone} tip={p.tip}>
      {p.label}
    </StatusBadge>
  );
}

function ReadValue({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function History({
  entries,
  timezone,
  money,
}: {
  entries: SupplyHistory[];
  timezone: string;
  money: (cents: number) => string;
}) {
  const when = (v: string) =>
    formatDayMonthTime(v, new Date(), timezone) ?? "—";
  const show = (key: string, value: unknown): string => {
    if (value == null || value === "") return "Не указано";
    if (typeof value === "boolean") return value ? "Да" : "Нет";
    if (key === "amountCents" && typeof value === "number") return money(value);
    if ((key === "invoiceAt" || key === "paidAt") && typeof value === "string")
      return when(value);
    if (
      (key === "invoiceDate" || key === "paidDate") &&
      typeof value === "string"
    )
      return formatDateCell(value) ?? value;
    return Array.isArray(value)
      ? value.join(" · ") || "Без замечаний"
      : String(value);
  };
  return (
    <DrawerTimeline>
      {entries.map((h, index) => {
        // Названия уже идентифицируют связанные объекты; технические id
        // остаются только в снимке.
        const changes = Object.keys(h.after_data ?? {}).filter(
          (key) =>
            ![
              "id",
              "version",
              "providerId",
              "storeId",
              "businessId",
              "accountId",
              "invoiceDate",
              "paidDate",
            ].includes(key) &&
            JSON.stringify(h.before_data?.[key]) !==
              JSON.stringify(h.after_data?.[key]),
        );
        return (
          <DrawerTimelineItem
            key={h.id}
            last={index === entries.length - 1}
            avatar={<DrawerAvatar name={h.actor_name} />}
            title={historyActions[h.action]}
            meta={`${h.actor_name} · ${when(h.created_at)}`}
          >
            {h.action === "updated" && changes.length > 0 && (
              <dl className="space-y-2">
                {changes.map((key) => (
                  <div key={key} className="text-xs">
                    <dt className="text-muted-foreground">
                      {supplyFieldNames[key] ?? "Данные накладной"}
                    </dt>
                    <dd className="mt-1 break-words">
                      <span className="text-muted-foreground line-through">
                        {show(key, h.before_data?.[key])}
                      </span>
                      <span aria-hidden> → </span>
                      {show(key, h.after_data?.[key])}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {h.action.startsWith("payment_") && (
              <p className="text-xs tabular-nums">
                {h.after_data?.publicId != null
                  ? `Расход №${String(h.after_data.publicId)} · `
                  : ""}
                {h.action === "payment_changed" ? (
                  h.after_data?.unavailable ? (
                    "Расход недоступен в этом заведении"
                  ) : h.after_data?.cancelled ? (
                    "Расход отменён"
                  ) : (
                    "Данные расхода изменились"
                  )
                ) : (
                  <>
                    {h.before_data?.amountCents != null && (
                      <span className="text-muted-foreground line-through">
                        {money(Number(h.before_data.amountCents))}
                      </span>
                    )}
                    {h.before_data?.amountCents != null && (
                      <span aria-hidden> → </span>
                    )}
                    {money(Number(h.after_data?.amountCents ?? 0))}
                  </>
                )}
              </p>
            )}
            {h.reason ? (
              <p className="break-words text-xs text-muted-foreground">
                {h.reason}
              </p>
            ) : null}
          </DrawerTimelineItem>
        );
      })}
    </DrawerTimeline>
  );
}

// ── Экран ────────────────────────────────────────────────────

export function SuppliesClient({
  initial,
  initialFilters,
  amountRoundingScale,
}: {
  initial: SupplyList;
  initialFilters: SupplyFilters;
  amountRoundingScale: AmountRoundingScale;
}) {
  const money = useCallback(
    (cents: number) => formatMoney(cents / 100, "RUB", amountRoundingScale),
    [amountRoundingScale],
  );
  const [data, setData] = useState(initial),
    [filters, setFilters] = useState(initialFilters),
    [loading, setLoading] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [error, setError] = useState("");
  const st = useTableState({
    tableId: "documents.supplies",
    columns: columnConfig,
  });

  const listSequence = useRef(0),
    filtersRef = useRef(filters),
    initialMonthChosen = useRef(!!initial.sourceVersion);
  filtersRef.current = filters;
  const change = (patch: Partial<SupplyFilters>) => {
    initialMonthChosen.current = true;
    setFilters((old) => ({ ...old, ...patch, page: 0 }));
  };

  const refresh = useCallback(
    async (f: SupplyFilters, quiet = false) => {
      const seq = ++listSequence.current;
      if (!quiet) setLoading(true);
      try {
        const next = await loadSupplies(f, initial.venueId);
        if (seq !== listSequence.current) return;
        // Первая загрузка после пустого заведения: открываем последний месяц
        // с накладными, а не пустой текущий.
        if (
          !initialMonthChosen.current &&
          next.sourceVersion &&
          next.months.length
        ) {
          initialMonthChosen.current = true;
          const selected = next.months.filter((m) => m <= f.month).at(-1);
          if (selected && selected !== f.month) {
            setFilters((old) => ({ ...old, month: selected, page: 0 }));
            return;
          }
        }
        setData(next);
        setError("");
        if (f.page > 0 && f.page * f.size >= next.total)
          setFilters((old) => ({ ...old, page: 0 }));
      } catch (e) {
        if (seq === listSequence.current)
          setError(
            e instanceof Error
              ? e.message
              : "Не удалось загрузить накладные. Проверьте соединение",
          );
      } finally {
        if (seq === listSequence.current) setLoading(false);
      }
    },
    [initial.venueId],
  );
  useEffect(() => {
    const timer = setTimeout(() => void refresh(filters), 200);
    return () => clearTimeout(timer);
  }, [filters, refresh]);

  // Пока идёт чтение Quick Resto, список обновляется сам — только на
  // видимой вкладке, чтобы фоновые вкладки не дёргали сервер.
  const reading = ["pending", "running"].includes(data.job?.state ?? "");
  useEffect(() => {
    if (!reading) return;
    let busy = false;
    const tick = () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      void refresh(filtersRef.current, true).finally(() => {
        busy = false;
      });
    };
    const timer = setInterval(tick, 4000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reading, refresh]);

  // ── Сортировка: сервер сортирует по одному полю ────────────
  const changeSorting = (next: SortingState) => {
    const one = next.slice(-1);
    st.setSorting(one);
    const key = one[0] ? SERVER_SORT[one[0].id as ColKey] : undefined;
    change(
      key ? { sort: key, desc: one[0].desc } : { sort: "date", desc: true },
    );
  };

  // ── Карточка накладной ─────────────────────────────────────
  const detailSequence = useRef(0);
  const [detail, setDetail] = useState<SupplyDetail | null>(null),
    [cardId, setCardId] = useState<string | null>(null),
    [detailError, setDetailError] = useState(""),
    [historyMore, setHistoryMore] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false);
  const openSupply = async (id: string) => {
    const seq = ++detailSequence.current;
    setCardId(id);
    setDetail(null);
    setDetailError("");
    setHistoryLoading(false);
    try {
      const next = await loadSupply(initial.venueId, id);
      if (seq === detailSequence.current) {
        setHistoryMore(next.history.length > 20);
        setDetail({ ...next, history: next.history.slice(0, 20) });
      }
    } catch (e) {
      if (seq === detailSequence.current)
        setDetailError(
          e instanceof Error ? e.message : "Не удалось открыть накладную",
        );
    }
  };
  const moreHistory = async () => {
    if (!detail || historyLoading) return;
    const seq = detailSequence.current,
      id = detail.id,
      before = detail.history.at(-1)?.id;
    if (!before) return;
    setHistoryLoading(true);
    try {
      const next = await loadSupply(initial.venueId, id, before);
      if (seq === detailSequence.current) {
        setHistoryMore(next.history.length > 20);
        setDetail((old) =>
          old?.id === id
            ? {
                ...old,
                history: [...old.history, ...next.history.slice(0, 20)],
              }
            : old,
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить историю",
      );
    } finally {
      if (seq === detailSequence.current) setHistoryLoading(false);
    }
  };
  // Сессию карточки фиксируем до асинхронного сохранения в дочерней секции:
  // если прочитать ref после него, можно подхватить уже другую накладную.
  const displayedSession = detailSequence.current;

  // ── Настройки источника ────────────────────────────────────
  const settingsSequence = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [config, setConfig] = useState<SupplyConfiguration | null>(null),
    [settingsError, setSettingsError] = useState(""),
    [ids, setIds] = useState<number[]>([]),
    [autoRead, setAutoRead] = useState(false),
    [interval, setReadInterval] = useState("60"),
    [comment, setComment] = useState(""),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [showErrors, setShowErrors] = useState(false),
    [requesting, setRequesting] = useState(false);
  const openSettings = async () => {
    const seq = ++settingsSequence.current;
    setSettingsOpen(true);
    setConfig(null);
    setSettingsError("");
    setSaveError("");
    setShowErrors(false);
    setComment("");
    try {
      const next = await loadSupplyConfiguration(initial.venueId);
      if (seq !== settingsSequence.current) return;
      const rules = next.versions[0]?.config;
      setConfig(next);
      setIds(
        rules?.businessIds ??
          (next.companies.length === 1 ? [next.companies[0].id] : []),
      );
      setAutoRead(rules?.autoRead ?? false);
      setReadInterval(String(rules?.intervalMinutes ?? 60));
    } catch (e) {
      if (seq === settingsSequence.current)
        setSettingsError(
          e instanceof Error ? e.message : "Не удалось открыть настройки",
        );
    }
  };
  const oldRules = config?.versions[0]?.config;
  // Комментарий сам по себе ничего не меняет — «Сохранить» активна только
  // при изменении настроек.
  const dirty =
    !!config &&
    (autoRead !== (oldRules?.autoRead ?? false) ||
      interval !== String(oldRules?.intervalMinutes ?? 60) ||
      JSON.stringify(ids) !==
        JSON.stringify(
          oldRules?.businessIds ??
            (config.companies.length === 1 ? [config.companies[0].id] : []),
        ));
  const intervalNumber = Number(interval);
  const intervalError =
    !Number.isInteger(intervalNumber) ||
    intervalNumber < 15 ||
    intervalNumber > 1440
      ? "Укажите целое число минут от 15 до 1 440"
      : "";
  const idsError = ids.length ? "" : "Выберите заведение Quick Resto";
  const { guard, dialog: discardDialog } = useDiscardGuard(
    dirty || comment.trim() !== "",
    "Изменения настроек не сохранятся",
  );
  const closeSettings = () => {
    settingsSequence.current++;
    setSettingsOpen(false);
  };
  const saveSettings = async () => {
    if (!config || saving) return;
    const provider = config.provider ?? oldRules?.provider;
    if (!provider) {
      setSaveError(
        "Не удалось проверить подключение Quick Resto. Откройте настройки заново",
      );
      return;
    }
    if (intervalError || idsError) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await saveSupplyReadRules(
        initial.venueId,
        config.versions[0]?.version ?? 0,
        { autoRead, intervalMinutes: intervalNumber, businessIds: ids },
        provider,
        comment,
      );
      closeSettings();
      toast.success("Настройки источника сохранены");
      await refresh(filtersRef.current);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Не удалось сохранить настройки",
      );
    } finally {
      setSaving(false);
    }
  };
  const readSource = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      await requestSupplies(initial.venueId);
      await refresh(filtersRef.current, true);
      toast.success("Обновление накладных запущено");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось запустить обновление",
      );
    } finally {
      setRequesting(false);
    }
  };
  const companies = config
    ? [
        ...config.companies,
        ...Object.entries(oldRules?.businessNames ?? {})
          .filter(([id]) => !config.companies.some((c) => c.id === Number(id)))
          .map(([id, name]) => ({ id: Number(id), name })),
      ]
    : [];
  // Заведение Quick Resto меняют только до первой загрузки: после неё смена
  // требует сверки уже сохранённых связей с расходами.
  const companiesLocked = !!oldRules && !!data.sourceVersion;

  // ── Таблица ────────────────────────────────────────────────
  const storeColumnVisible = st.columnVisibility.store !== false;
  const hasFilters =
    !!filters.paid || !!filters.provider || !!filters.store || filters.missing;
  const isFiltered = hasFilters || filters.search.trim() !== "";
  const resetConditions = () => {
    st.setSorting([]);
    change({
      paid: "",
      provider: null,
      store: null,
      missing: false,
      search: "",
      sort: "date",
      desc: true,
    });
  };

  const columns = useMemo<ColumnDef<SupplyRow>[]>(
    () => [
      {
        id: "date",
        header: labels.date,
        size: 120,
        minSize: 100,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDateCell(row.original.data.invoiceDate) ?? "—"}
          </span>
        ),
      },
      {
        id: "number",
        header: labels.number,
        size: 240,
        minSize: 160,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          const flag = r.missing
            ? "Нет в Quick Resto"
            : !r.data.processed
              ? "Черновик"
              : null;
          const store = storeColumnVisible ? null : r.data.storeTitle;
          return (
            <div className="min-w-0">
              {/* Настоящая кнопка в первой ячейке: накладную можно открыть с клавиатуры. */}
              <button
                type="button"
                className="block max-w-full truncate text-left font-medium tabular-nums transition-colors duration-200 hover:text-brand"
                data-tip={`Накладная №${r.data.number}`}
                onClick={() => void openSupply(r.id)}
              >
                №{r.data.number}
              </button>
              {flag || store ? (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {flag ? (
                    <span
                      className={
                        r.missing ? "text-amber-700 dark:text-amber-400" : ""
                      }
                      data-tip={
                        r.missing
                          ? "При последней проверке накладной не было в Quick Resto"
                          : "Накладная не проведена в Quick Resto"
                      }
                    >
                      {flag}
                    </span>
                  ) : null}
                  {flag && store ? " · " : null}
                  {store ? <span data-tip={store}>{store}</span> : null}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "provider",
        header: labels.provider,
        size: 280,
        minSize: 160,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-0">
              {r.data.providerName ? (
                <span className="block truncate" data-tip={r.data.providerName}>
                  {r.data.providerName}
                </span>
              ) : (
                <span className="text-muted-foreground">Не указан</span>
              )}
              {r.data.issues.length > 0 && (
                <span
                  className="mt-0.5 block truncate text-xs text-amber-700 dark:text-amber-400"
                  data-tip={r.data.issues.join(" · ")}
                >
                  Проверить данные
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "store",
        header: labels.store,
        size: 200,
        minSize: 120,
        cell: ({ row }) => (
          <span className="block truncate" data-tip={row.original.data.storeTitle}>
            {row.original.data.storeTitle}
          </span>
        ),
      },
      {
        id: "amount",
        header: labels.amount,
        size: 160,
        minSize: 110,
        cell: ({ row }) => money(row.original.data.amountCents),
      },
      {
        id: "payment",
        header: labels.payment,
        size: 180,
        // Самая длинная подпись — «Проверить оплату»: бейдж не режем.
        minSize: 160,
        cell: ({ row }) => <PaymentBadge row={row.original} />,
      },
    ],
    // openSupply стабилен по смыслу: читает только ref и сеттеры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, storeColumnVisible],
  );

  const table = useReactTable({
    data: data.rows,
    columns,
    state: {
      sorting: st.sorting,
      pagination: { pageIndex: filters.page, pageSize: filters.size },
      columnVisibility: { ...st.columnVisibility, number: true },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    rowCount: data.total,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    autoResetPageIndex: false,
  });

  // ── Шапка ──────────────────────────────────────────────────
  const currentMonth = monthIn(data.timezone);
  const checkedText = data.checkedAt
    ? formatDayMonthTime(data.checkedAt, new Date(), data.timezone)
    : null;
  const refreshButton =
    data.canConfigure && data.configured ? (
      <span
        className="inline-flex"
        data-tip={
          reading
            ? "Идёт обновление из Quick Resto"
            : checkedText
              ? `Quick Resto проверен ${checkedText}`
              : "Прочитать накладные и оплаты из Quick Resto"
        }
      >
        <Button
          size="sm"
          className="h-9 gap-2"
          disabled={reading || requesting}
          onClick={() => void readSource()}
        >
          <RefreshCw
            className={
              reading || requesting
                ? "size-4 animate-spin motion-reduce:animate-none"
                : "size-4"
            }
          />
          {reading ? "Обновляются…" : "Обновить накладные"}
        </Button>
      </span>
    ) : null;

  const jobError = data.job?.error ?? "";

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs
        items={[{ label: "Документы" }, { label: "Приходные накладные" }]}
      />
      <TablePageHeader
        title="Приходные накладные"
        count={data.total}
        period={
          <>
            <PeriodStepper
              previous="Предыдущий месяц"
              next="Следующий месяц"
              previousDisabled={filters.month <= MIN_MONTH}
              onPrevious={() => change({ month: shiftMonth(filters.month, -1) })}
              onNext={() => change({ month: shiftMonth(filters.month, 1) })}
            >
              <MonthPicker
                variant="period"
                prefix=""
                ariaLabel="Месяц накладных"
                value={filters.month + "-01"}
                min={MIN_MONTH + "-01"}
                onChange={(month) => change({ month: month.slice(0, 7) })}
              />
            </PeriodStepper>
            {filters.month !== currentMonth ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => change({ month: currentMonth })}
              >
                Сегодня
              </Button>
            ) : null}
          </>
        }
        actions={
          <TableControls
            search={{
              value: filters.search,
              onChange: (search) => change({ search: search.slice(0, 120) }),
              open: searchOpen,
              onOpenChange: setSearchOpen,
              placeholder: "Номер или поставщик",
            }}
            filters={{
              active: hasFilters,
              onClick: () => setFiltersOpen((v) => !v),
            }}
            sort={{
              active: st.sorting.length > 0,
              content: (
                <TableSortPicker
                  sorting={st.sorting}
                  onChange={changeSorting}
                  fields={sortFields}
                  labels={labels}
                />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder.map((id) => {
                    const c = table.getColumn(id)!;
                    return {
                      id,
                      label: labels[id as ColKey],
                      visible: c.getIsVisible(),
                      canHide: c.getCanHide(),
                    };
                  })}
                  onVisibilityChange={(id, v) =>
                    table.getColumn(id)?.toggleVisibility(v)
                  }
                  onMoveColumn={(a, b) =>
                    st.setColumnOrder((order) =>
                      arrayMove(order, order.indexOf(a), order.indexOf(b)),
                    )
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            secondaryActions={
              data.canConfigure ? (
                <TableIconButton
                  label="Настройки источника"
                  onClick={() => void openSettings()}
                >
                  <Settings />
                </TableIconButton>
              ) : null
            }
            primaryActions={refreshButton}
          />
        }
      />
      <TableConditions
        label="Условия списка накладных"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={filters.search}
        onSearchClear={() => change({ search: "" })}
        onReset={resetConditions}
      >
        {(filtersOpen || !!filters.paid) && (
          <TableFilterChip
            label="Оплата"
            value={filters.paid}
            onChange={(paid) => change({ paid: paid as SupplyFilters["paid"] })}
            options={PAID_OPTIONS}
          />
        )}
        {(filtersOpen || !!filters.provider) && (
          <TableFilterChip
            label="Поставщик"
            value={filters.provider ? String(filters.provider) : ""}
            onChange={(id) => change({ provider: id ? Number(id) : null })}
            searchPlaceholder="Найти поставщика"
            options={[
              { value: "", label: "Все поставщики" },
              ...data.providers.map((p) => ({
                value: String(p.id),
                label: p.name,
              })),
            ]}
          />
        )}
        {(filtersOpen || !!filters.store) && (
          <TableFilterChip
            label="Склад"
            value={filters.store ? String(filters.store) : ""}
            onChange={(id) => change({ store: id ? Number(id) : null })}
            options={[
              { value: "", label: "Все склады" },
              ...data.stores.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        )}
        {(filtersOpen || filters.missing) && (
          <TableFilterChip
            label="Нет в Quick Resto"
            value={filters.missing ? "show" : ""}
            onChange={(v) => change({ missing: v === "show" })}
            options={[
              { value: "", label: "Скрывать" },
              { value: "show", label: "Показывать" },
            ]}
          />
        )}
      </TableConditions>

      {reading && (
        <p role="status" className="text-sm text-muted-foreground">
          {stages[data.job?.phase ?? ""] ?? "Ждём начала обновления"}
          {data.job?.cursor
            ? ` · ${countRu(data.job.cursor, "накладная", "накладные", "накладных")}`
            : ""}
          . Пока обновление идёт, показаны прежние данные
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="min-w-0 flex-1">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void refresh(filters)}
          >
            Повторить
          </Button>
        </div>
      )}
      {!reading && jobError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="min-w-0 flex-1">
            Не удалось обновить накладные из Quick Resto: {jobError}
          </p>
          {data.canConfigure && data.configured ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={requesting}
              onClick={() => void readSource()}
            >
              Повторить
            </Button>
          ) : null}
        </div>
      )}

      {data.sourceVersion ? (
        <MetricStrip label="Итоги за месяц">
          <Metric
            primary
            label="Сумма накладных"
            value={<AnimatedMoney value={data.amountCents / 100} scale={amountRoundingScale} />}
            hint={
              isFiltered
                ? "С учётом поиска и фильтров"
                : checkedText
                  ? `Quick Resto проверен ${checkedText}`
                  : undefined
            }
          />
          <Metric label="Оплачено" value={<AnimatedMoney value={data.paidCents / 100} scale={amountRoundingScale} />} hint="Подтверждено расходами" />
          <Metric label="Не оплачено" value={<AnimatedMoney value={data.unpaidCents / 100} scale={amountRoundingScale} />} hint="Осталось связать с расходами" />
          <Metric
            label="Проверить оплату"
            value={<AnimatedNumber value={data.reviewCount} />}
            hint={
              data.reviewCount
                ? "Расход или сумма накладной изменились"
                : "Всё сходится"
            }
          />
        </MetricStrip>
      ) : null}

      {!data.sourceVersion && !data.rows.length ? (
        <EmptyState
          icon={FileText}
          title="Накладные ещё не загружены"
          description={
            !data.canConfigure
              ? "Накладные из Quick Resto загружает владелец аккаунта"
              : data.configured
                ? "Загрузите накладные и оплаты из Quick Resto"
                : "Выберите заведение Quick Resto в настройках, затем загрузите накладные"
          }
          action={
            data.canConfigure ? (
              <Button
                disabled={reading || requesting}
                onClick={() =>
                  void (data.configured ? readSource() : openSettings())
                }
              >
                {reading || requesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : data.configured ? (
                  <RefreshCw className="size-4" />
                ) : (
                  <Settings className="size-4" />
                )}
                {data.configured ? "Загрузить накладные" : "Настроить источник"}
              </Button>
            ) : undefined
          }
        />
      ) : !data.rows.length && isFiltered ? (
        <EmptyState
          icon={SearchX}
          title="Накладные не найдены"
          description="Измените условия поиска или сбросьте фильтры"
          action={
            <Button variant="outline" onClick={resetConditions}>
              Очистить все
            </Button>
          }
        />
      ) : !data.rows.length ? (
        <EmptyState
          icon={FileText}
          title="За этот месяц накладных нет"
          description="Выберите другой месяц"
        />
      ) : (
        <>
          <div
            aria-busy={loading}
            className={loading ? "opacity-60 transition-opacity" : undefined}
          >
            <DataTable
              table={table}
              label="Приходные накладные"
              labels={labels}
              onColumnSizingChange={st.setColumnSizing}
              sorting={st.sorting}
              onSortingChange={changeSorting}
              sortable={sortFields}
              numeric={["amount"]}
              onRowClick={(row) => void openSupply(row.original.id)}
              empty={null}
              totals={{ amount: money(data.amountCents) }}
              mobile={{
                label: "Карточки накладных",
                nameColumn: "number",
                statusColumn: "payment",
              }}
            />
          </div>
          <TablePagination
            pageIndex={filters.page}
            pageSize={filters.size}
            total={data.total}
            onPageChange={(page) => setFilters((old) => ({ ...old, page }))}
            onPageSizeChange={(size) =>
              setFilters((old) => ({
                ...old,
                page: 0,
                size: size as SupplyFilters["size"],
              }))
            }
          />
        </>
      )}

      {/* ── Панель накладной ─────────────────────────────── */}
      <EditDrawer
        open={cardId !== null}
        onOpenChange={(open) => {
          if (!open) {
            detailSequence.current++;
            setCardId(null);
          }
        }}
        title={detail ? `Накладная №${detail.data.number}` : "Накладная"}
        titleAccessory={
          detail ? (
            <>
              <DrawerStatus
                label={PAYMENT[detail.payment.state].label}
                tone={PAYMENT[detail.payment.state].tone}
              />
              {(detail.missing || !detail.data.processed) && (
                <DrawerStatus
                  label={detail.missing ? "Нет в Quick Resto" : "Черновик"}
                  tone={detail.missing ? "warning" : "neutral"}
                />
              )}
            </>
          ) : undefined
        }
        description={detail?.data.providerName ?? undefined}
      >
        {detailError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p className="min-w-0 flex-1">{detailError}</p>
            {cardId ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void openSupply(cardId)}
              >
                Повторить
              </Button>
            ) : null}
          </div>
        ) : !detail ? (
          <div role="status" aria-label="Загружаем накладную" className="space-y-5">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-20 rounded-lg" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <DrawerSummary label="Данные накладной">
              <DrawerSummaryTotal label="Сумма накладной">
                {money(detail.data.amountCents)}
              </DrawerSummaryTotal>
              <DrawerSummaryItem icon={<CalendarDays />} label="Дата и склад">
                {formatDayMonth(detail.data.invoiceDate) ?? "—"} ·{" "}
                {detail.data.storeTitle}
              </DrawerSummaryItem>
              <DrawerSummaryItem icon={<FileCheck2 />} label="Проведение">
                {detail.data.processed
                  ? "Проведена в Quick Resto"
                  : "Черновик, не проведена в Quick Resto"}
              </DrawerSummaryItem>
              {detail.data.authorName ? (
                <DrawerSummaryItem
                  icon={<UserRound />}
                  label="Создал в Quick Resto"
                >
                  {detail.data.authorName}
                </DrawerSummaryItem>
              ) : null}
            </DrawerSummary>

            {detail.data.issues.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">Проверьте данные накладной</p>
                <ul className="mt-1 list-inside list-disc space-y-1">
                  {detail.data.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <SupplyPaymentPanel
              key={`${detail.id}:${detail.revision}`}
              venue={initial.venueId}
              detail={detail}
              timezone={data.timezone}
              onChanged={async () => {
                await refresh(filtersRef.current, true);
                if (displayedSession !== detailSequence.current) return;
                const next = await loadSupply(initial.venueId, detail.id);
                if (displayedSession !== detailSequence.current) return;
                setHistoryMore(next.history.length > 20);
                setDetail({ ...next, history: next.history.slice(0, 20) });
              }}
            />

            <DrawerSection title="Данные Quick Resto">
              <dl className="grid gap-3 sm:grid-cols-2">
                <ReadValue label="Отметка об оплате">
                  {detail.data.paid ? "Оплачена" : "Не оплачена"}
                </ReadValue>
                {detail.data.paidDate ? (
                  <ReadValue label="Дата оплаты">
                    {formatDateCell(detail.data.paidDate) ?? "—"}
                  </ReadValue>
                ) : null}
                {detail.data.accountTitle ? (
                  <ReadValue label="Счёт оплаты">
                    {detail.data.accountTitle}
                  </ReadValue>
                ) : null}
                <ReadValue label="Номер в Quick Resto">
                  {String(detail.data.id)}
                </ReadValue>
              </dl>
            </DrawerSection>

            <DrawerSection title="История изменений">
              {detail.history.length ? (
                <History
                  entries={detail.history}
                  timezone={data.timezone}
                  money={money}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Изменений пока нет</p>
              )}
              {historyMore && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={historyLoading}
                  onClick={() => void moreHistory()}
                >
                  {historyLoading ? "Загружаем…" : "Показать ещё"}
                </Button>
              )}
            </DrawerSection>
          </div>
        )}
      </EditDrawer>

      {/* ── Панель настроек источника ────────────────────── */}
      <EditDrawer
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open && !saving) guard(closeSettings);
        }}
        title="Настройки источника"
        description="Quick Resto"
        footer={
          config ? (
            <>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => guard(closeSettings)}
              >
                Отмена
              </Button>
              <Button
                className="min-w-32"
                disabled={saving || !dirty}
                onClick={() => void saveSettings()}
              >
                {saving ? "Сохраняем…" : "Сохранить"}
              </Button>
            </>
          ) : undefined
        }
      >
        {settingsError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p className="min-w-0 flex-1">{settingsError}</p>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => void openSettings()}
            >
              Повторить
            </Button>
          </div>
        ) : !config ? (
          <div role="status" aria-label="Загружаем настройки" className="space-y-5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        ) : (
          <form
            className="flex flex-col gap-5 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) void saveSettings();
            }}
          >
            <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
            {config.sourceError && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                {config.sourceError}
              </div>
            )}
            <DrawerSection
              title="Заведения Quick Resto"
              description={
                companiesLocked
                  ? "Заведение меняют только до первой загрузки накладных"
                  : undefined
              }
            >
              <fieldset className="space-y-3">
                <legend className="sr-only">Заведения Quick Resto</legend>
                {companies.length ? (
                  companies.map((company) => (
                    <label key={company.id} className="flex items-center gap-3">
                      <Checkbox
                        checked={ids.includes(company.id)}
                        disabled={saving || companiesLocked}
                        onCheckedChange={(checked) =>
                          setIds((old) =>
                            (checked
                              ? [...old, company.id]
                              : old.filter((id) => id !== company.id)
                            ).sort((a, b) => a - b),
                          )
                        }
                      />
                      {company.name}
                    </label>
                  ))
                ) : (
                  <p className="text-muted-foreground">
                    В Quick Resto нет доступных заведений
                  </p>
                )}
                {showErrors && idsError ? (
                  <p className="text-xs text-destructive">{idsError}</p>
                ) : null}
              </fieldset>
            </DrawerSection>
            <DrawerSection title="Обновление">
              <label className="flex items-center justify-between gap-4">
                <span>Обновлять накладные автоматически</span>
                <Switch
                  checked={autoRead}
                  disabled={saving}
                  onCheckedChange={setAutoRead}
                />
              </label>
              <Field
                id="supply-read-interval"
                label="Интервал, минут"
                hint="От 15 до 1 440"
                error={showErrors && intervalError ? intervalError : null}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={1440}
                    value={interval}
                    disabled={saving}
                    onChange={(e) => setReadInterval(e.target.value)}
                  />
                )}
              </Field>
              <p className="text-xs text-muted-foreground">
                Обновление читает накладные и оплаты из Quick Resto. Операции и
                остатки счетов оно не меняет
              </p>
            </DrawerSection>
            <DrawerSection title="Комментарий">
              <Textarea
                aria-label="Комментарий к изменению"
                value={comment}
                maxLength={1000}
                rows={3}
                disabled={saving}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Необязательно. Например, включили автообновление"
              />
            </DrawerSection>
            {saveError ? (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            ) : null}
            {config.versions.length > 0 && (
              <DrawerSection title="История настроек">
                <DrawerTimeline>
                  {config.versions.map((v, index) => (
                    <DrawerTimelineItem
                      key={v.id}
                      last={index === config.versions.length - 1}
                      avatar={<DrawerAvatar name={v.actor_name} />}
                      title={`Версия ${v.version} · ${
                        v.config.autoRead
                          ? `каждые ${v.config.intervalMinutes} мин`
                          : "обновление вручную"
                      }`}
                      meta={`${v.actor_name} · ${
                        formatDayMonthTime(v.created_at, new Date(), data.timezone) ?? "—"
                      }`}
                    >
                      <p className="break-words text-xs text-muted-foreground">
                        {v.reason}
                      </p>
                    </DrawerTimelineItem>
                  ))}
                </DrawerTimeline>
              </DrawerSection>
            )}
          </form>
        )}
      </EditDrawer>
      {discardDialog}
    </PageFrame>
  );
}
