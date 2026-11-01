"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { PageFrame } from "@/components/shared/page-frame";
import { MonthPicker } from "@/components/shared/month-picker";
import {
  TableControls,
  TablePageHeader,
  TablePagination,
} from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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

const money = (cents: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(cents / 100);
const day = (value: string | null) =>
  value
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("ru-RU", {
        timeZone: "UTC",
      })
    : "Не указана";
const dateTime = (value: string, timezone: string) =>
  new Date(value).toLocaleString("ru-RU", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
const stages: Record<string, string> = {
  grid_first: "Чтение накладных",
  financial_first: "Чтение оплат",
  grid_verify: "Проверка накладных",
  financial_verify: "Проверка оплат",
};
const historyActions: Record<SupplyHistory["action"], string> = {
  created: "Накладная сохранена",
  updated: "Накладная обновлена",
  missing: "Накладной нет в источнике",
  returned: "Накладная снова появилась в источнике",
  payment_linked: "Платёж связан с накладной",
  payment_updated: "Распределение платежа изменено",
  payment_unlinked: "Связь с платежом удалена",
  payment_changed: "Связанный расход изменён",
};
const sorts: { value: SupplyFilters["sort"]; label: string }[] = [
  { value: "date", label: "Дата накладной" },
  { value: "number", label: "Номер" },
  { value: "provider", label: "Поставщик" },
  { value: "amount", label: "Сумма" },
  { value: "paid", label: "Оплата" },
];
function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4 border-b py-3 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
function Status({ row }: { row: SupplyRow }) {
  const text =
    row.payment.state === "paid"
      ? "Оплачено"
      : row.payment.state === "partial"
        ? "Частичная оплата"
        : row.payment.state === "review"
          ? "Проверить оплату"
          : "Платёж не связан";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        row.payment.state === "unlinked"
          ? "text-muted-foreground"
          : row.payment.state === "paid"
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-amber-700 dark:text-amber-400",
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {text}
      {(row.missing || !row.data.processed) && (
        <span className="text-muted-foreground">
          · {row.missing ? "Нет в источнике" : "Черновик"}
        </span>
      )}
    </span>
  );
}
function showChange(key: string, value: unknown, timezone: string): string {
  if (value == null || value === "") return "Не указано";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (key === "amountCents" && typeof value === "number") return money(value);
  if ((key === "invoiceAt" || key === "paidAt") && typeof value === "string")
    return dateTime(value, timezone);
  if (
    (key === "invoiceDate" || key === "paidDate") &&
    typeof value === "string"
  )
    return day(value);
  return Array.isArray(value)
    ? value.join(" · ") || "Без замечаний"
    : String(value);
}
function History({
  entries,
  timezone,
}: {
  entries: SupplyHistory[];
  timezone: string;
}) {
  return (
    <ol className="divide-y">
      {entries.map((h) => {
        // Display names already identify these references. Keep technical IDs in the snapshot only.
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
          <li key={h.id} className="space-y-2 py-4 first:pt-0">
            <p className="font-medium">{historyActions[h.action]}</p>
            <p className="text-xs text-muted-foreground">
              {h.actor_name} · {dateTime(h.created_at, timezone)}
            </p>
            {h.action === "updated" && (
              <dl className="space-y-2">
                {changes.map((key) => (
                  <div key={key} className="text-xs">
                    <dt className="text-muted-foreground">
                      {supplyFieldNames[key] ?? "Данные накладной"}
                    </dt>
                    <dd className="mt-1 break-words">
                      <span className="text-muted-foreground line-through">
                        {showChange(key, h.before_data?.[key], timezone)}
                      </span>
                      <span aria-hidden> → </span>
                      {showChange(key, h.after_data?.[key], timezone)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {h.action.startsWith("payment_") && (
              <p className="text-xs tabular-nums">
                {h.after_data?.publicId != null
                  ? `Расход №${h.after_data.publicId} · `
                  : ""}
                {h.action === "payment_changed" ? (
                  h.after_data?.unavailable ? (
                    "Расход недоступен в этом заведении"
                  ) : h.after_data?.cancelled ? (
                    "Расход отменён"
                  ) : (
                    "Данные расхода обновлены"
                  )
                ) : (
                  <>
                    {h.before_data?.amountCents != null && (
                      <span className="text-muted-foreground line-through">
                        {money(Number(h.before_data.amountCents))} →{" "}
                      </span>
                    )}
                    {money(Number(h.after_data?.amountCents ?? 0))}
                  </>
                )}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{h.reason}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function SuppliesClient({
  initial,
  initialFilters,
}: {
  initial: SupplyList;
  initialFilters: SupplyFilters;
}) {
  const [data, setData] = useState(initial),
    [filters, setFilters] = useState(initialFilters),
    [loading, setLoading] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [error, setError] = useState("");
  const [detail, setDetail] = useState<SupplyDetail | null>(null),
    [cardOpen, setCardOpen] = useState(false),
    [detailError, setDetailError] = useState(""),
    [detailTab, setDetailTab] = useState("details"),
    [historyMore, setHistoryMore] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [config, setConfig] = useState<SupplyConfiguration | null>(null),
    [settingsError, setSettingsError] = useState(""),
    [ids, setIds] = useState<number[]>([]),
    [autoRead, setAutoRead] = useState(false),
    [interval, setReadInterval] = useState("60"),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false),
    [requesting, setRequesting] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const listSequence = useRef(0),
    detailSequence = useRef(0),
    settingsSequence = useRef(0),
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
            e instanceof Error ? e.message : "Не удалось загрузить поставки",
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
  const reading = ["pending", "running"].includes(data.job?.state ?? "");
  useEffect(() => {
    if (!reading) return;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void refresh(filtersRef.current, true).finally(() => {
        busy = false;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [reading, refresh]);
  const openSupply = async (id: string) => {
    const seq = ++detailSequence.current;
    setCardOpen(true);
    setDetail(null);
    setDetailError("");
    setDetailTab("details");
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
  const openSettings = async () => {
    const seq = ++settingsSequence.current;
    setSettingsOpen(true);
    setConfig(null);
    setSettingsError("");
    setReason("");
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
  const dirty =
    !!config &&
    (reason.trim() !== "" ||
      autoRead !== (oldRules?.autoRead ?? false) ||
      interval !== String(oldRules?.intervalMinutes ?? 60) ||
      JSON.stringify(ids) !==
        JSON.stringify(
          oldRules?.businessIds ??
            (config.companies.length === 1 ? [config.companies[0].id] : []),
        ));
  const closeSettings = () => {
    if (saving) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    settingsSequence.current++;
    setSettingsOpen(false);
  };
  const saveSettings = async () => {
    if (!config || saving) return;
    const provider = config.provider ?? oldRules?.provider;
    if (!provider) {
      toast.error("Сначала проверьте подключение Quick Resto");
      return;
    }
    if (
      !ids.length ||
      !reason.trim() ||
      !Number.isInteger(Number(interval)) ||
      Number(interval) < 15 ||
      Number(interval) > 1440
    ) {
      toast.error(
        "Выберите заведение, укажите интервал от 15 до 1 440 минут и причину изменения",
      );
      return;
    }
    setSaving(true);
    try {
      await saveSupplyReadRules(
        initial.venueId,
        config.versions[0]?.version ?? 0,
        { autoRead, intervalMinutes: Number(interval), businessIds: ids },
        provider,
        reason,
      );
      setSettingsOpen(false);
      settingsSequence.current++;
      toast.success("Настройки поставок сохранены");
      await refresh(filtersRef.current);
    } catch (e) {
      toast.error(
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
  // Capture the session before a child's asynchronous save starts. Reading the
  // ref only after that save could adopt a newly opened invoice's session.
  const displayedSession = detailSequence.current;
  return (
    <PageFrame className="space-y-6">
      <TablePageHeader
        title="Поставки"
        subtitle="Накладные Quick Resto"
        actions={
          data.canConfigure && (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label="Настройки поставок"
                onClick={() => void openSettings()}
              >
                <Settings2 className="size-4" />
              </Button>
              {data.configured && (
                <Button
                  variant="outline"
                  disabled={reading || requesting}
                  onClick={() => void readSource()}
                >
                  <RefreshCw
                    className={cn(
                      "mr-2 size-4",
                      requesting && "animate-spin motion-reduce:animate-none",
                    )}
                  />
                  {reading ? "Обновляются" : "Обновить накладные"}
                </Button>
              )}
            </>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker
          value={filters.month + "-01"}
          min="2000-01-01"
          prefix=""
          ariaLabel="Месяц поставок"
          onChange={(month) => change({ month: month.slice(0, 7) })}
        />
        <TableControls
          search={{
            value: filters.search,
            onChange: (search) => change({ search }),
            open: searchOpen,
            onOpenChange: setSearchOpen,
            placeholder: "Номер или поставщик",
          }}
          filters={{
            active:
              !!filters.paid ||
              !!filters.provider ||
              !!filters.store ||
              filters.missing,
            content: (
              <div className="space-y-3">
                <Label>Фильтры</Label>
                <Select
                  value={filters.paid || "all"}
                  onValueChange={(paid) =>
                    change({
                      paid:
                        paid === "all" ? "" : (paid as SupplyFilters["paid"]),
                    })
                  }
                >
                  <SelectTrigger aria-label="Состояние накладной">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все состояния</SelectItem>
                    <SelectItem value="paid">Оплачено</SelectItem>
                    <SelectItem value="unpaid">
                      Без полной связи с оплатой
                    </SelectItem>
                    <SelectItem value="draft">Черновики</SelectItem>
                    <SelectItem value="review">Проверить данные</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={String(filters.provider ?? "all")}
                  onValueChange={(id) =>
                    change({ provider: id === "all" ? null : Number(id) })
                  }
                >
                  <SelectTrigger aria-label="Поставщик">
                    <SelectValue placeholder="Все поставщики" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все поставщики</SelectItem>
                    {data.providers.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(filters.store ?? "all")}
                  onValueChange={(id) =>
                    change({ store: id === "all" ? null : Number(id) })
                  }
                >
                  <SelectTrigger aria-label="Склад">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все склады</SelectItem>
                    {data.stores.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={filters.missing}
                    onCheckedChange={(v) => change({ missing: v === true })}
                  />
                  Включая отсутствующие в источнике
                </label>
                <Button
                  variant="ghost"
                  onClick={() =>
                    change({
                      paid: "",
                      provider: null,
                      store: null,
                      missing: false,
                      search: "",
                    })
                  }
                >
                  Сбросить фильтры
                </Button>
              </div>
            ),
          }}
          sort={{
            active: filters.sort !== "date" || !filters.desc,
            content: (
              <div className="space-y-3">
                <Label>Сортировка</Label>
                <Select
                  value={filters.sort}
                  onValueChange={(sort) =>
                    change({ sort: sort as SupplyFilters["sort"] })
                  }
                >
                  <SelectTrigger aria-label="Поле сортировки">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sorts.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => change({ desc: !filters.desc })}
                >
                  {filters.desc ? (
                    <ArrowDown className="mr-2 size-4" />
                  ) : (
                    <ArrowUp className="mr-2 size-4" />
                  )}
                  {filters.desc ? "По убыванию" : "По возрастанию"}
                </Button>
              </div>
            ),
          }}
        />
      </div>
      {reading && (
        <p role="status" className="text-sm text-muted-foreground">
          {stages[data.job?.phase ?? ""] ?? "Ожидание обновления"}
          {data.job?.cursor
            ? ` · ${data.job.cursor.toLocaleString("ru-RU")} накладных`
            : ""}
          . До завершения показаны предыдущие данные.
        </p>
      )}
      {(error || data.job?.error) && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          {error || data.job?.error}
          {error && (
            <Button variant="ghost" onClick={() => void refresh(filters)}>
              Повторить
            </Button>
          )}
        </div>
      )}
      <div
        aria-busy={loading}
        className={cn(
          "overflow-hidden rounded-lg border",
          loading && "opacity-60",
        )}
      >
        <table className="hidden w-full table-fixed text-sm md:table">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[24%]" />
            <col className="w-[29%]" />
            <col className="w-[17%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {["Дата", "Накладная", "Поставщик", "Сумма", "Оплата"].map(
                (label, i) => (
                  <th
                    key={label}
                    className={cn(
                      "px-4 py-3 font-medium",
                      i === 3 && "text-right",
                    )}
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t hover:bg-muted/40"
                onClick={() => void openSupply(row.id)}
              >
                <td className="px-4 py-4 tabular-nums">
                  {day(row.data.invoiceDate)}
                </td>
                <td className="px-4 py-4">
                  <button
                    className="block w-full truncate text-left font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openSupply(row.id);
                    }}
                  >
                    {row.data.number}
                  </button>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {row.data.storeTitle}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <span className="block truncate">
                    {row.data.providerName ?? "Не указан"}
                  </span>
                  {row.data.issues.length > 0 && (
                    <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                      Проверить данные
                    </span>
                  )}
                </td>
                <td className="px-4 py-4 text-right tabular-nums">
                  {money(row.data.amountCents)}
                </td>
                <td className="px-4 py-4">
                  <Status row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="divide-y md:hidden">
          {data.rows.map((row) => (
            <button
              key={row.id}
              onClick={() => void openSupply(row.id)}
              className="block w-full space-y-3 p-4 text-left hover:bg-muted/40"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium">
                    {row.data.providerName ?? "Поставщик не указан"}
                  </span>
                  <span className="mt-1 block break-words text-xs text-muted-foreground">
                    {row.data.number} · {day(row.data.invoiceDate)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <Status row={row} />
                <span className="text-sm tabular-nums">
                  {money(row.data.amountCents)}
                </span>
              </span>
              <span className="block text-xs text-muted-foreground">
                {row.data.storeTitle}
                {row.data.issues.length ? " · Проверить данные" : ""}
              </span>
            </button>
          ))}
        </div>
        {!data.rows.length && (
          <div className="space-y-3 px-6 py-12 text-center text-sm text-muted-foreground">
            {data.sourceVersion ? (
              <>
                <p>За выбранный период накладных нет.</p>
                <p>Выберите другой месяц или измените фильтры.</p>
              </>
            ) : (
              <>
                <p>Накладные ещё не загружены.</p>
                {data.canConfigure ? (
                  <>
                    <p>
                      Выберите заведение Quick Resto в настройках и запустите
                      обновление.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void (data.configured ? readSource() : openSettings())
                      }
                      disabled={reading || requesting}
                    >
                      {data.configured
                        ? "Загрузить накладные"
                        : "Настроить источник"}
                    </Button>
                  </>
                ) : (
                  <p>
                    Владелец может подключить источник в настройках поставок.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <p>
          {data.total.toLocaleString("ru-RU")} накладных{" "}
          <span className="text-muted-foreground">
            · {money(data.amountCents)}
          </span>
        </p>
        {data.checkedAt && (
          <p className="text-xs text-muted-foreground">
            Проверено {dateTime(data.checkedAt, data.timezone)}
          </p>
        )}
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
      <EditDrawer
        open={cardOpen}
        onOpenChange={(open) => {
          if (!open) detailSequence.current++;
          setCardOpen(open);
        }}
        title={detail ? `Накладная ${detail.data.number}` : "Накладная"}
        description={detail?.data.providerName ?? undefined}
      >
        {detailError ? (
          <p role="alert" className="text-sm text-destructive">
            {detailError}
          </p>
        ) : !detail ? (
          <div
            role="status"
            aria-label="Загрузка накладной"
            className="space-y-4"
          >
            <div className="h-24 rounded-lg bg-muted" />
            <div className="h-64 rounded-lg bg-muted" />
          </div>
        ) : (
          <div className="space-y-6 text-sm">
            <div className="space-y-3 rounded-lg bg-brand/5 p-5">
              <Status row={detail} />
              <p className="text-3xl font-semibold tabular-nums">
                {money(detail.data.amountCents)}
              </p>
              <p className="text-xs text-muted-foreground">
                {day(detail.data.invoiceDate)} · {detail.data.storeTitle}
              </p>
            </div>
            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList className="w-full justify-start">
                <TabsTrigger value="details">Детали</TabsTrigger>
                <TabsTrigger value="history">История</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="mt-5 space-y-5">
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
                <dl>
                  <Value label="Поставщик">
                    {detail.data.providerName ?? "Не указан"}
                  </Value>
                  <Value label="Склад">{detail.data.storeTitle}</Value>
                  <Value label="Проведение">
                    {detail.data.processed
                      ? "Проведена в Quick Resto"
                      : "Черновик"}
                  </Value>
                  <Value label="Оплата в Quick Resto">
                    {detail.data.paid
                      ? "Отмечена оплаченной"
                      : "Отмечена неоплаченной"}
                  </Value>
                  <Value label="Дата оплаты в Quick Resto">
                    {detail.data.paidDate
                      ? day(detail.data.paidDate)
                      : "Не указана"}
                  </Value>
                  <Value label="Счёт в Quick Resto">
                    {detail.data.accountTitle ?? "Не указан"}
                  </Value>
                  <Value label="Создал в Quick Resto">
                    {detail.data.authorName ?? "Не указан"}
                  </Value>
                  <Value label="Номер Quick Resto">{detail.data.id}</Value>
                </dl>
                {detail.data.issues.length > 0 && (
                  <div className="rounded-lg bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
                    <p className="mb-2 font-medium">Проверить данные</p>
                    <ul className="list-inside list-disc space-y-1">
                      {detail.data.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="history" className="mt-5">
                <History entries={detail.history} timezone={data.timezone} />
                {historyMore && (
                  <Button
                    variant="outline"
                    disabled={historyLoading}
                    onClick={() => void moreHistory()}
                  >
                    {historyLoading ? "Загружается" : "Показать ещё"}
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </EditDrawer>
      <EditDrawer
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) closeSettings();
        }}
        title="Настройки поставок"
        description="Источник накладных"
        footer={
          config && (
            <>
              <Button
                variant="outline"
                disabled={saving}
                onClick={closeSettings}
              >
                Отмена
              </Button>
              <Button
                disabled={saving || !dirty}
                onClick={() => void saveSettings()}
              >
                {saving ? "Сохраняется" : "Сохранить"}
              </Button>
            </>
          )
        }
      >
        {settingsError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {settingsError}
            </p>
            <Button variant="outline" onClick={() => void openSettings()}>
              Повторить
            </Button>
          </div>
        ) : !config ? (
          <div
            role="status"
            aria-label="Загрузка настроек"
            className="h-64 rounded-lg bg-muted"
          />
        ) : (
          <div className="space-y-6 text-sm">
            {config.sourceError && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 p-3 text-destructive"
              >
                {config.sourceError}
              </p>
            )}
            <fieldset className="space-y-3">
              <legend className="mb-3 font-medium">
                Заведения Quick Resto
              </legend>
              {companies.length ? (
                companies.map((company) => (
                  <label key={company.id} className="flex items-center gap-3">
                    <Checkbox
                      checked={ids.includes(company.id)}
                      disabled={saving || (!!oldRules && !!data.sourceVersion)}
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
                  Нет доступных заведений источника.
                </p>
              )}
            </fieldset>
            <label className="flex items-center justify-between gap-4">
              <span>Автоматически обновлять накладные</span>
              <Switch
                checked={autoRead}
                disabled={saving}
                onCheckedChange={setAutoRead}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-medium">Интервал, минут</span>
              <Input
                type="number"
                min={15}
                max={1440}
                value={interval}
                disabled={saving}
                onChange={(e) => setReadInterval(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-medium">Причина изменения</span>
              <Textarea
                value={reason}
                maxLength={1000}
                rows={3}
                disabled={saving}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например, подключение накладных CHILLING"
              />
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Обновление читает накладные и оплаты из Quick Resto. Финансовые
              операции и остатки счетов не меняются.
            </p>
            {config.versions.length > 0 && (
              <details className="border-t pt-4">
                <summary className="cursor-pointer font-medium">
                  История настроек
                </summary>
                <ol className="mt-3 divide-y">
                  {config.versions.map((v) => (
                    <li key={v.id} className="space-y-1 py-3">
                      <p>
                        Версия {v.version} ·{" "}
                        {v.config.autoRead
                          ? `каждые ${v.config.intervalMinutes} мин.`
                          : "обновление вручную"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {v.actor_name} · {dateTime(v.created_at, data.timezone)}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {v.reason}
                      </p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}
      </EditDrawer>
      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Закрыть без сохранения?</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            Изменения настроек не будут сохранены.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>
              Продолжить редактирование
            </Button>
            <Button
              onClick={() => {
                setConfirmClose(false);
                settingsSequence.current++;
                setSettingsOpen(false);
              }}
            >
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
