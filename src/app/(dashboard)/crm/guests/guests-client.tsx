"use client";
/* eslint-disable @next/next/no-img-element -- Private signed photo URLs are served directly, never cached by the image optimizer. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Plus,
  Settings2,
  RefreshCw,
  Camera,
  Archive,
  RotateCcw,
  ChevronRight,
  SearchX,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ExpandPanel } from "@/components/shared/overview-toggle";
import { PageFrame } from "@/components/shared/page-frame";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { TimePicker } from "@/components/ui/time-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerStatus,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatDateCell } from "@/lib/format/date";
import { formatGuestBirthday } from "@/lib/guests/source";
import {
  defaultGuestRules,
  guestFields,
  guestHistoryActions,
  type GuestList,
  type GuestDetail,
  type Guest,
  type GuestEditable,
  type GuestFilters,
  type GuestConfiguration,
} from "@/lib/guests/types";
import {
  loadGuests,
  loadGuest,
  saveGuest,
  uploadGuestPhoto,
  guestConfiguration,
  saveGuestRules,
  readGuests,
} from "./actions";
// ── Столбцы списка ───────────────────────────────────────────

type ColKey = "photo" | "name" | "group" | "discount" | "birthday" | "updated";
type SortKey = GuestFilters["sort"];

const labels: Record<ColKey, string> = {
  photo: "Фото",
  name: "Гость",
  group: "Группа",
  discount: "Скидка",
  birthday: "День рождения",
  updated: "Обновлено",
};
const columnConfig = [
  { id: "photo", defaultSize: 72 },
  { id: "name", defaultSize: 300 },
  { id: "group", defaultSize: 220 },
  { id: "discount", defaultSize: 110 },
  { id: "birthday", defaultSize: 170 },
  { id: "updated", defaultSize: 150, defaultVisible: false },
];
/** Столбцы, по которым сортирует сервер (id столбца = ключ сортировки). */
const sortFields: SortKey[] = ["name", "group", "birthday", "updated"];
const pageSizes = [25, 50, 100] as const;

function guestSource(g: Guest) {
  return g.data.sourceMissing
    ? "Нет в Quick Resto"
    : g.data.regular
      ? "Постоянный гость"
      : g.qrId
        ? "Quick Resto"
        : "Карточка заведения";
}
const dateTime = (v: string) =>
  new Date(v).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
function birthday(g: Guest) {
  return formatGuestBirthday({
    day: g.data.day ?? null,
    month: g.data.month ?? null,
    year: g.data.year ?? null,
  });
}
function GuestAvatar({
  guest,
  large = false,
}: {
  guest: Guest;
  large?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 font-medium text-brand",
        large ? "size-14 text-base" : "size-10 text-xs",
      )}
    >
      {guest.photoUrl && failed !== guest.photoUrl ? (
        <img
          src={guest.photoUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(guest.photoUrl ?? null)}
        />
      ) : (
        guest.data.name
          ?.split(/\s+/)
          .slice(0, 2)
          .map((s) => s[0])
          .join("") || "Г"
      )}
    </span>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DrawerSection
      title={title}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Скрыть" : "Показать"}
        </Button>
      }
    >
      <ExpandPanel open={open}>{children}</ExpandPanel>
    </DrawerSection>
  );
}
/** «Изменённые поля» в истории карточки: кнопка с шевроном и раскрытие. */
function HistoryChanges({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <ChevronRight
          className={cn("motion-chevron size-3.5", open && "rotate-90")}
        />
        Изменённые поля
      </button>
      <ExpandPanel open={open}>{children}</ExpandPanel>
    </div>
  );
}
/** Заглушка карточки гостя, пока она загружается. */
function GuestCardSkeleton() {
  return (
    <div role="status" aria-label="Загружаем карточку" className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-9 w-full" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
/** Заглушка настроек гостей, пока они загружаются. */
function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Загружаем настройки" className="space-y-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4 border-b py-3 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">
        {children || "—"}
      </span>
    </div>
  );
}
export function GuestsClient({ initial }: { initial: GuestList }) {
  const st = useTableState({ tableId: "crm.guests", columns: columnConfig });
  const [group, setGroup] = useState(""),
    [birthdayFilter, setBirthdayFilter] = useState<GuestFilters["birthday"]>(""),
    [archived, setArchived] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    // Сколько гостей в разделе без условий: счётчик у заголовка «N из M».
    // Сервер считает только выборку, поэтому запоминаем ответ без условий.
    [baseTotal, setBaseTotal] = useState<{ active?: number; archive?: number }>({
      active: initial.total,
    });
  // Сервер сортирует по одному полю; пусто — по имени, это не активная сортировка.
  const sort = st.sorting[0];
  const pageSize = pageSizes.find((n) => n === st.pagination.pageSize) ?? 25;
  const filters = useMemo<GuestFilters>(
    () => ({
      search: st.search,
      group,
      birthday: birthdayFilter,
      archived,
      page: st.pagination.pageIndex,
      size: pageSize,
      sort: (sort?.id as SortKey | undefined) ?? "name",
      desc: sort?.desc ?? false,
    }),
    [st.search, group, birthdayFilter, archived, st.pagination.pageIndex, pageSize, sort?.id, sort?.desc],
  );
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<GuestDetail | null>(null),
    [cardOpen, setCardOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<GuestEditable>({ name: "" }),
    [photoUrl, setPhotoUrl] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false),
    [historyMore, setHistoryMore] = useState(false),
    [tab, setTab] = useState("details"),
    [confirm, setConfirm] = useState<
      "close" | "close-settings" | "archive" | "restore" | null
    >(null),
    [config, setConfig] = useState<GuestConfiguration | null>(null),
    [settingsOpen, setSettingsOpen] = useState(false),
    [rules, setRules] = useState(defaultGuestRules),
    [rulesReason, setRulesReason] = useState("");
  const request = useRef(crypto.randomUUID()),
    listSequence = useRef(0),
    detailSequence = useRef(0),
    file = useRef<HTMLInputElement>(null);
  const params = useSearchParams(),
    router = useRouter();
  const patch = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) =>
        JSON.stringify(value) !==
        JSON.stringify(detail?.data[key as keyof GuestEditable]),
    ),
  );
  const dirty =
    editing &&
    (detail
      ? Object.keys(patch).length > 0
      : !!draft.name || Object.keys(draft).length > 1);
  const refresh = useCallback(
    async (f: GuestFilters) => {
      const seq = ++listSequence.current;
      setLoading(true);
      try {
        const next = await loadGuests(f, initial.venueId);
        if (seq === listSequence.current) {
          setData(next);
          setError("");
          if (!f.search.trim() && !f.group && !f.birthday)
            setBaseTotal((old) => ({
              ...old,
              [f.archived ? "archive" : "active"]: next.total,
            }));
        }
      } catch (e) {
        if (seq === listSequence.current)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить гостей",
          );
      } finally {
        if (seq === listSequence.current) setLoading(false);
      }
    },
    [initial.venueId],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh(filters);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, refresh]);
  const openGuest = useCallback(
    async (id: string) => {
      const seq = ++detailSequence.current;
      setDetail(null);
      setCardOpen(true);
      setEditing(false);
      setTab("details");
      try {
        const g = await loadGuest(initial.venueId, id);
        if (seq === detailSequence.current) {
          setHistoryMore(g.history.length > 20);
          setDetail({ ...g, history: g.history.slice(0, 20) });
          setDraft({ name: g.data.name ?? "" });
          setPhotoUrl(g.photoUrl ?? null);
        }
      } catch (e) {
        if (seq === detailSequence.current) {
          toast.error(
            e instanceof Error ? e.message : "Не удалось открыть гостя",
          );
          setCardOpen(false);
        }
      }
    },
    [initial.venueId],
  );
  const linked = params.get("guest");
  useEffect(() => {
    if (linked && /^[a-f0-9-]{36}$/i.test(linked)) void openGuest(linked);
  }, [linked, openGuest]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh(filters);
        if (detail && !editing && tab !== "history")
          void loadGuest(initial.venueId, detail.id)
            .then((g) => {
              setHistoryMore(g.history.length > 20);
              setDetail((old) =>
                old?.id === g.id
                  ? { ...g, history: g.history.slice(0, 20) }
                  : old,
              );
            })
            .catch(() => {});
      }
    }, 240000);
    return () => clearInterval(timer);
  }, [refresh, filters, detail, editing, initial.venueId, tab]);
  function close() {
    detailSequence.current++;
    setCardOpen(false);
    setEditing(false);
    setConfirm(null);
    if (linked) router.replace("/crm/guests", { scroll: false });
  }
  function settingsOpenChange(o: boolean) {
    if (saving) return;
    if (
      !o &&
      config &&
      JSON.stringify(rules) !==
        JSON.stringify(config.versions[0]?.config ?? defaultGuestRules)
    ) {
      setConfirm("close-settings");
      return;
    }
    setSettingsOpen(o);
  }
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));
  const changeSorting = (next: SortingState) => {
    // Сервер сортирует по одному полю: новое поле заменяет прежнее.
    st.setSorting(next.slice(-1));
    firstPage();
  };
  const hasFilters = !!group || !!birthdayFilter;
  const isFiltered = hasFilters || !!st.search.trim();
  const resetConditions = () => {
    setGroup("");
    setBirthdayFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };
  const toggleArchive = () => {
    setArchived((v) => !v);
    firstPage();
  };
  function startCreate() {
    detailSequence.current++;
    setDetail(null);
    setDraft({ name: "" });
    setPhotoUrl(null);
    setReason("");
    request.current = crypto.randomUUID();
    setEditing(true);
    setTab("details");
    setCardOpen(true);
  }
  async function save() {
    setSaving(true);
    try {
      const result = await saveGuest({
        venue: initial.venueId,
        action: detail ? "update" : "create",
        id: detail?.id ?? null,
        revision: detail?.revision ?? 0,
        request: request.current,
        patch: detail ? patch : draft,
        reason: reason || "Создание карточки гостя",
      });
      request.current = crypto.randomUUID();
      setEditing(false);
      setReason("");
      const next = await loadGuest(initial.venueId, result.id);
      setHistoryMore(next.history.length > 20);
      setDetail({ ...next, history: next.history.slice(0, 20) });
      await refresh(filters);
      toast.success("Карточка сохранена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }
  async function archive() {
    if (
      !detail ||
      !confirm ||
      confirm === "close" ||
      confirm === "close-settings"
    )
      return;
    setSaving(true);
    try {
      await saveGuest({
        venue: initial.venueId,
        action: confirm,
        id: detail.id,
        revision: detail.revision,
        request: request.current,
        patch: {},
        reason,
      });
      request.current = crypto.randomUUID();
      close();
      setReason("");
      await refresh(filters);
      toast.success(
        confirm === "archive" ? "Гость в архиве" : "Гость восстановлен",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }
  async function photoSelected(f: File | undefined) {
    if (!f) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set("photo", f);
      const result = await uploadGuestPhoto(initial.venueId, form);
      setDraft((old) => ({ ...old, photoPath: result.path }));
      setPhotoUrl(result.url);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить фотографию",
      );
    } finally {
      setSaving(false);
    }
  }
  async function settings() {
    setSettingsOpen(true);
    try {
      const c = await guestConfiguration(initial.venueId);
      setConfig(c);
      setRules(c.versions[0]?.config ?? defaultGuestRules);
      setRulesReason("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить настройки",
      );
      setSettingsOpen(false);
    }
  }
  useEffect(() => {
    if (
      !settingsOpen ||
      !config ||
      !["pending", "running"].includes(config.job?.state ?? "")
    )
      return;
    const timer = setInterval(() => {
      void guestConfiguration(initial.venueId)
        .then((next) => {
          setConfig((old) =>
            old
              ? {
                  ...old,
                  job: next.job,
                  checkedAt: next.checkedAt,
                  rows: next.rows,
                  groups: next.groups,
                }
              : old,
          );
          if (next.job?.state === "done") void refresh(filters);
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [settingsOpen, config, initial.venueId, refresh, filters]);
  const discarding = confirm?.startsWith("close") ?? false;
  const show = (v: unknown) =>
    Array.isArray(v)
      ? v.join(", ")
      : typeof v === "boolean"
        ? v
          ? "Да"
          : "Нет"
        : v == null
          ? "—"
          : String(v);

  const columns: ColumnDef<Guest>[] = [
    {
      id: "photo",
      header: labels.photo,
      size: 72,
      minSize: 72,
      cell: ({ row }) => <GuestAvatar guest={row.original} />,
    },
    {
      id: "name",
      header: labels.name,
      size: 300,
      minSize: 200,
      enableHiding: false,
      cell: ({ row }) => {
        const g = row.original;
        return (
          <div className="min-w-0">
            {/* Настоящая кнопка в ячейке имени: карточку можно открыть с клавиатуры. */}
            <button
              type="button"
              className="block max-w-full truncate text-left font-medium transition-colors duration-200 hover:text-brand"
              data-tip={g.data.name}
              onClick={() => void openGuest(g.id)}
            >
              {g.data.name}
            </button>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {guestSource(g)}
            </span>
          </div>
        );
      },
    },
    {
      id: "group",
      header: labels.group,
      size: 220,
      minSize: 120,
      cell: ({ row }) => {
        const title = row.original.data.groupTitle;
        return title ? (
          <span className="block truncate" data-tip={title}>
            {title}
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      id: "discount",
      header: labels.discount,
      size: 110,
      minSize: 90,
      cell: ({ row }) =>
        row.original.data.discountPercent != null
          ? `${row.original.data.discountPercent}%`
          : "—",
    },
    {
      id: "birthday",
      header: labels.birthday,
      size: 170,
      minSize: 140,
      cell: ({ row }) => (
        <span className="tabular-nums">{birthday(row.original) || "—"}</span>
      ),
    },
    {
      id: "updated",
      header: labels.updated,
      size: 150,
      minSize: 130,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatDateCell(row.original.updatedAt) ?? "—"}
        </span>
      ),
    },
  ];
  const table = useReactTable({
    data: data.rows,
    columns,
    state: {
      sorting: st.sorting,
      columnVisibility: { ...st.columnVisibility, name: true },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    manualSorting: true,
    manualPagination: true,
    onSortingChange: st.setSorting,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getRowId: (g) => g.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const base = archived ? baseTotal.archive : baseTotal.active;
  const count = isFiltered
    ? base != null
      ? `${data.total.toLocaleString("ru-RU")} из ${base.toLocaleString("ru-RU")}`
      : data.total.toLocaleString("ru-RU")
    : data.total.toLocaleString("ru-RU");

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <TablePageHeader
        title={archived ? "Гости в архиве" : "Гости"}
        count={count}
        actions={
          <TableControls
            search={{
              value: st.search,
              onChange: (v) => {
                st.setSearch(v);
                firstPage();
              },
              open: st.searchOpen,
              onOpenChange: st.setSearchOpen,
              placeholder: data.canDetails ? "Имя или контакт" : "Имя гостя",
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
              <>
                <TableIconButton
                  label={
                    archived ? "Вернуться к активным гостям" : "Архив гостей"
                  }
                  active={archived}
                  pressed={archived}
                  onClick={toggleArchive}
                >
                  <Archive />
                </TableIconButton>
                {data.canConfigure && (
                  <TableIconButton
                    label="Настройки гостей"
                    onClick={() => void settings()}
                  >
                    <Settings2 />
                  </TableIconButton>
                )}
              </>
            }
            primaryActions={
              data.canManage && !archived ? (
                <Button size="sm" className="h-9 gap-2" onClick={startCreate}>
                  <Plus className="size-4" />
                  Добавить гостя
                </Button>
              ) : null
            }
          />
        }
      />
      <TableConditions
        label="Условия списка гостей"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => {
          st.setSearch("");
          firstPage();
        }}
        onReset={resetConditions}
      >
        {(filtersOpen || !!group) && (
          <TableFilterChip
            label="Группа"
            value={group}
            onChange={(v) => {
              setGroup(v);
              firstPage();
            }}
            searchPlaceholder={
              data.groups.length > 8 ? "Найти группу" : undefined
            }
            options={[
              { value: "", label: "Все группы" },
              ...data.groups.map((g) => ({ value: g, label: g })),
            ]}
          />
        )}
        {(filtersOpen || !!birthdayFilter) && (
          <TableFilterChip
            label="День рождения"
            value={birthdayFilter}
            onChange={(v) => {
              setBirthdayFilter(v as GuestFilters["birthday"]);
              firstPage();
            }}
            options={[
              { value: "", label: "Все гости" },
              { value: "today", label: "Сегодня" },
              { value: "upcoming", label: "В ближайшие 14 дней" },
            ]}
          />
        )}
      </TableConditions>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
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
      {data.rows.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={SearchX}
            title="Гости не найдены"
            description="Измените условия поиска или сбросьте фильтры"
            action={
              <Button variant="outline" onClick={resetConditions}>
                Очистить все
              </Button>
            }
          />
        ) : archived ? (
          <EmptyState
            icon={Archive}
            title="Архив пуст"
            description="Сюда попадают карточки гостей, убранные из базы"
            action={
              <Button variant="outline" onClick={toggleArchive}>
                К активным гостям
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="Гостей пока нет"
            description={
              data.canConfigure
                ? "Добавьте карточку гостя или загрузите базу из Quick Resto в настройках"
                : "Добавьте карточку гостя или попросите владельца загрузить базу из Quick Resto"
            }
            action={
              data.canManage ? (
                <Button onClick={startCreate}>
                  <Plus className="mr-2 size-4" />
                  Добавить гостя
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div
            aria-busy={loading}
            className={cn(
              "transition-opacity duration-200",
              loading && "opacity-60",
            )}
          >
            <DataTable
              table={table}
              label={archived ? "Гости в архиве" : "Гости"}
              labels={labels}
              onColumnSizingChange={st.setColumnSizing}
              sorting={st.sorting}
              onSortingChange={changeSorting}
              sortable={sortFields}
              numeric={["discount"]}
              onRowClick={(row) => void openGuest(row.original.id)}
              empty={null}
              mobile={{
                label: "Карточки гостей",
                nameColumn: "name",
                photoColumn: "photo",
              }}
            />
          </div>
          <TablePagination
            pageIndex={filters.page}
            pageSize={filters.size}
            total={data.total}
            onPageChange={(pageIndex) =>
              st.setPagination((p) => ({ ...p, pageIndex }))
            }
            onPageSizeChange={(size) =>
              st.setPagination({ pageIndex: 0, pageSize: size })
            }
          />
        </>
      )}
      <EditDrawer
        open={cardOpen}
        onOpenChange={(o) => {
          if (!o) {
            if (saving) return;
            if (dirty) setConfirm("close");
            else close();
          }
        }}
        title={
          editing
            ? detail
              ? "Редактировать гостя"
              : "Новый гость"
            : (detail?.data.name ?? "Гость")
        }
        titleAccessory={
          detail?.archived ? <DrawerStatus label="В архиве" /> : undefined
        }
        footer={
          editing ? (
            <>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  if (dirty) setConfirm("close");
                  else close();
                }}
              >
                Отмена
              </Button>
              <Button
                disabled={
                  saving ||
                  !draft.name.trim() ||
                  (!detail ? false : !dirty) ||
                  (!!detail && !reason.trim())
                }
                onClick={() => void save()}
              >
                {saving ? "Сохраняем…" : "Сохранить"}
              </Button>
            </>
          ) : detail?.canManage ? (
            <>
              <Button
                variant="ghost"
                className="mr-auto"
                onClick={() => {
                  setReason("");
                  setConfirm(detail.archived ? "restore" : "archive");
                }}
              >
                {detail.archived ? (
                  <RotateCcw className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
                {detail.archived ? "Восстановить" : "В архив"}
              </Button>
              {!detail.archived && (
                <Button
                  onClick={() => {
                    const editable = Object.fromEntries(
                      Object.entries(detail.data).filter(
                        ([k]) =>
                          k in guestFields &&
                          ![
                            "groupId",
                            "groupTitle",
                            "discountPercent",
                            "sourceMissing",
                            "issues",
                          ].includes(k),
                      ),
                    );
                    setDraft({ name: "", ...editable } as GuestEditable);
                    setPhotoUrl(detail.photoUrl ?? null);
                    request.current = crypto.randomUUID();
                    setReason("");
                    setEditing(true);
                  }}
                >
                  Редактировать
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {editing ? (
          <fieldset disabled={saving} className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <GuestAvatar
                large
                guest={{
                  ...(detail ?? {
                    id: "",
                    revision: 0,
                    qrId: null,
                    legacyId: null,
                    archived: false,
                    createdAt: "",
                    updatedAt: "",
                  }),
                  data: draft,
                  photoUrl,
                }}
              />
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => file.current?.click()}
              >
                <Camera className="size-4" />
                {draft.photoPath ? "Изменить фото" : "Прикрепить фото"}
              </Button>
              {draft.photoPath && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft((d) => ({ ...d, photoPath: null }));
                    setPhotoUrl(null);
                  }}
                >
                  Убрать фото
                </Button>
              )}
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void photoSelected(e.target.files?.[0])}
              />
            </div>
            <Field label="Имя гостя">
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                maxLength={500}
              />
            </Field>
            <Field label="Телефон и другие контакты">
              <Textarea
                value={draft.contacts ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, contacts: e.target.value || null }))
                }
                maxLength={4000}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              {(["day", "month", "year"] as const).map((key, i) => (
                <Field key={key} label={["День", "Месяц", "Год"][i]}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={key === "year" ? 1900 : 1}
                    max={key === "day" ? 31 : key === "month" ? 12 : 2100}
                    placeholder="—"
                    value={draft[key] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [key]: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <p className="-mt-3 text-xs text-muted-foreground">
              Год рождения можно не указывать.
            </p>
            {detail?.qrId && (
              <div className="rounded-lg bg-muted/50 p-4 text-sm">
                <span className="text-muted-foreground">
                  Условия Quick Resto
                </span>
                <div className="mt-1 font-medium">
                  {detail.data.groupTitle ?? "Без группы"}
                  {detail.data.discountPercent != null
                    ? ` · скидка ${detail.data.discountPercent}%`
                    : ""}
                </div>
              </div>
            )}
            {(["regular", "recognized"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between">
                <Label htmlFor={`guest-${key}`}>{guestFields[key]}</Label>
                <Switch
                  id={`guest-${key}`}
                  checked={draft[key] === true}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({ ...d, [key]: checked }))
                  }
                />
              </div>
            ))}
            <Field label="Заметки">
              <Textarea
                rows={4}
                maxLength={4000}
                value={draft.note ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, note: e.target.value || null }))
                }
              />
            </Field>
            {detail && (
              <Field label="Основание изменения">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </Field>
            )}
            <CollapsibleSection title="Предпочтения и подробности">
              <div className="space-y-4">
                {(
                  [
                    "instagram",
                    "gender",
                    "sociability",
                    "work",
                    "alcohol",
                    "mobility",
                  ] as const
                ).map((key) => (
                  <Field key={key} label={guestFields[key]}>
                    <Input
                      value={draft[key] ?? ""}
                      maxLength={4000}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [key]: e.target.value || null,
                        }))
                      }
                    />
                  </Field>
                ))}
                {(
                  ["personality", "hobbies", "channels", "benefits"] as const
                ).map((key) => (
                  <Field key={key} label={guestFields[key]}>
                    <ListInput
                      value={draft[key]}
                      onChange={(values) =>
                        setDraft((d) => ({ ...d, [key]: values }))
                      }
                    />
                  </Field>
                ))}
              </div>
            </CollapsibleSection>
          </fieldset>
        ) : detail ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <GuestAvatar guest={detail} large />
              <div className="min-w-0">
                <p className="truncate font-medium">{detail.data.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.data.groupTitle ?? "Без группы"}
                  {detail.data.discountPercent != null
                    ? ` · скидка ${detail.data.discountPercent}%`
                    : ""}
                </p>
              </div>
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details">Детали</TabsTrigger>
                <TabsTrigger value="history">История</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="mt-5 text-sm">
                <Value label="День рождения">{birthday(detail)}</Value>
                <Value label="Постоянный гость">
                  {detail.data.regular == null
                    ? "Не указан"
                    : show(detail.data.regular)}
                </Value>
                {detail.canDetails &&
                  Object.entries(guestFields)
                    .filter(
                      ([k]) =>
                        ![
                          "name",
                          "day",
                          "month",
                          "year",
                          "groupTitle",
                          "groupId",
                          "discountPercent",
                          "regular",
                          "photoPath",
                          "issues",
                          "sourceMissing",
                        ].includes(k) &&
                        detail.data[k as keyof GuestEditable] != null,
                    )
                    .map(([k, l]) => (
                      <Value key={k} label={l}>
                        {show(detail.data[k as keyof GuestEditable])}
                      </Value>
                    ))}
                {!detail.canDetails && (
                  <p className="mt-4 text-muted-foreground">
                    Контакты и предпочтения доступны с правом просмотра
                    подробностей гостей.
                  </p>
                )}
                {detail.data.issues?.map((i) => (
                  <p key={i} className="mt-4 text-muted-foreground">
                    {i}
                  </p>
                ))}
                {detail.data.sourceMissing && (
                  <p className="mt-4 text-muted-foreground">
                    Гостя нет в текущем полном списке Quick Resto. Карточка
                    сохранена.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="history" className="mt-5">
                <DrawerTimeline>
                  {detail.history.map((h, index) => (
                    <DrawerTimelineItem
                      key={h.id}
                      last={index === detail.history.length - 1}
                      avatar={<DrawerAvatar name={h.actor_name} />}
                      title={
                        guestHistoryActions[h.action] ?? "Карточка обновлена"
                      }
                      meta={`${h.actor_name} · ${dateTime(h.created_at)}`}
                    >
                      {h.reason && (
                        <p className="text-muted-foreground">{h.reason}</p>
                      )}
                      {h.before_data && (
                        <HistoryChanges>
                          <div className="mt-3 space-y-1">
                            {Object.keys({ ...h.before_data, ...h.after_data })
                              .filter(
                                (k) =>
                                  JSON.stringify(
                                    h.before_data?.[k as keyof GuestEditable],
                                  ) !==
                                  JSON.stringify(
                                    h.after_data?.[k as keyof GuestEditable],
                                  ),
                              )
                              .map((k) => (
                                <p key={k} className="break-words">
                                  <span className="text-muted-foreground">
                                    {guestFields[k] ?? "Сведения"}:{" "}
                                  </span>
                                  {k === "photoPath"
                                    ? "Фотография изменена"
                                    : `${show(h.before_data?.[k as keyof GuestEditable])} → ${show(h.after_data?.[k as keyof GuestEditable])}`}
                                </p>
                              ))}
                          </div>
                        </HistoryChanges>
                      )}
                    </DrawerTimelineItem>
                  ))}
                </DrawerTimeline>
                {historyMore && (
                  <Button
                    variant="outline"
                    className="mt-4 w-full"
                    onClick={async () => {
                      try {
                        const next = await loadGuest(
                          initial.venueId,
                          detail.id,
                          detail.history[detail.history.length - 1].id,
                        );
                        setHistoryMore(next.history.length > 20);
                        setDetail((old) =>
                          old?.id === next.id
                            ? {
                                ...old,
                                history: [
                                  ...old.history,
                                  ...next.history.slice(0, 20),
                                ],
                              }
                            : old,
                        );
                      } catch {
                        toast.error("Не удалось загрузить историю");
                      }
                    }}
                  >
                    Ранее
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <GuestCardSkeleton />
        )}
      </EditDrawer>
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o && !saving) setConfirm(null);
        }}
      >
        <DialogContent hideClose aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {discarding
                ? "Не сохранять изменения?"
                : confirm === "archive"
                  ? "Переместить гостя в архив?"
                  : "Восстановить гостя?"}
            </DialogTitle>
          </DialogHeader>
          {!discarding && (
            <Field label="Основание">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
              />
            </Field>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setConfirm(null)}
            >
              Вернуться
            </Button>
            <Button
              disabled={saving || (!discarding && !reason.trim())}
              onClick={() =>
                discarding
                  ? confirm === "close-settings"
                    ? (setSettingsOpen(false), setConfirm(null))
                    : close()
                  : void archive()
              }
            >
              {discarding
                ? "Не сохранять"
                : confirm === "archive"
                  ? "В архив"
                  : "Восстановить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EditDrawer
        open={settingsOpen}
        onOpenChange={settingsOpenChange}
        title="Настройки гостей"
        footer={
          config ? (
            <>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => settingsOpenChange(false)}
              >
                Отмена
              </Button>
              <Button
                disabled={saving || !rulesReason.trim()}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await saveGuestRules(
                      initial.venueId,
                      config.versions[0]?.version ?? 0,
                      rules,
                      rulesReason,
                    );
                    setConfig(await guestConfiguration(initial.venueId));
                    setRulesReason("");
                    toast.success("Настройки сохранены");
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Не удалось сохранить",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Сохранить настройки
              </Button>
            </>
          ) : undefined
        }
      >
        {config ? (
          <>
            <DrawerSection title="Quick Resto">
              <div className="text-sm">
                <p className="text-muted-foreground">
                  {config.checkedAt
                    ? `${config.rows.toLocaleString("ru-RU")} гостей · ${dateTime(config.checkedAt)}`
                    : "База ещё не загружена"}
                </p>
                <p className="mt-2 text-muted-foreground">
                  {config.job?.state === "error"
                    ? config.job.error
                    : config.job?.state === "pending" ||
                        config.job?.state === "running"
                      ? `Обновление: ${config.job.phase === "verify" ? "проверка" : "чтение"}, ${config.job.cursor} гостей`
                      : "Группа и скидка обновляются из Quick Resto."}
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={
                    saving ||
                    ["pending", "running"].includes(config.job?.state ?? "")
                  }
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await readGuests(initial.venueId);
                      setConfig(await guestConfiguration(initial.venueId));
                      toast.success("Обновление запущено");
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : "Не удалось запустить",
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <RefreshCw className="size-4" />
                  Обновить базу
                </Button>
                <Button
                  className="mt-3 ml-2"
                  variant="ghost"
                  onClick={() =>
                    void guestConfiguration(initial.venueId)
                      .then((next) => {
                        setConfig((old) =>
                          old
                            ? {
                                ...old,
                                job: next.job,
                                checkedAt: next.checkedAt,
                                rows: next.rows,
                                groups: next.groups,
                              }
                            : old,
                        );
                        void refresh(filters);
                      })
                      .catch(() => toast.error("Не удалось проверить обновление"))
                  }
                >
                  Проверить
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="guest-auto">Обновлять автоматически</Label>
                <Switch
                  id="guest-auto"
                  checked={rules.autoRead}
                  onCheckedChange={(autoRead) =>
                    setRules((r) => ({
                      ...r,
                      autoRead,
                      ...(!autoRead
                        ? {
                            birthdayToday: false,
                            birthdayUpcoming: false,
                            groupTransitions: false,
                          }
                        : {}),
                    }))
                  }
                />
              </div>
              <Field label="Интервал обновления, минут">
                <Input
                  type="number"
                  min={15}
                  max={1440}
                  value={rules.intervalMinutes}
                  onChange={(e) =>
                    setRules((r) => ({
                      ...r,
                      intervalMinutes: Number(e.target.value),
                    }))
                  }
                />
              </Field>
            </DrawerSection>
            <DrawerSection title="Дни рождения">
              {(["birthdayToday", "birthdayUpcoming"] as const).map((k, i) => (
                <div key={k} className="flex items-center justify-between">
                  <Label htmlFor={k}>
                    {i === 0
                      ? "Напомнить в день рождения"
                      : "Напомнить заранее"}
                  </Label>
                  <Switch
                    id={k}
                    disabled={!rules.autoRead}
                    checked={rules[k]}
                    onCheckedChange={(v) => setRules((r) => ({ ...r, [k]: v }))}
                  />
                </div>
              ))}
              {rules.birthdayUpcoming && (
                <Field label="За сколько дней">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={rules.leadDays}
                    onChange={(e) =>
                      setRules((r) => ({
                        ...r,
                        leadDays: Number(e.target.value),
                      }))
                    }
                  />
                </Field>
              )}
              <TimeField
                label="Время уведомления"
                hour={rules.birthdayHour}
                minute={rules.birthdayMinute}
                onChange={(h, m) =>
                  setRules((r) => ({
                    ...r,
                    birthdayHour: h,
                    birthdayMinute: m,
                  }))
                }
              />
            </DrawerSection>
            <DrawerSection
              title="Новые гости в группе"
              actions={
                <Switch
                  id="guest-group"
                  aria-label="Новые гости в группе"
                  disabled={!rules.autoRead}
                  checked={rules.groupTransitions}
                  onCheckedChange={(groupTransitions) =>
                    setRules((r) => ({ ...r, groupTransitions }))
                  }
                />
              }
            >
              <Select
                value={String(rules.groupId)}
                onValueChange={(v) =>
                  setRules((r) => ({ ...r, groupId: Number(v) }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Группа Quick Resto" />
                </SelectTrigger>
                <SelectContent>
                  {config.groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.title} · {g.discountPercent}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TimeField
                label="Время уведомления"
                hour={rules.groupHour}
                minute={rules.groupMinute}
                onChange={(h, m) =>
                  setRules((r) => ({ ...r, groupHour: h, groupMinute: m }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Уведомляем о новых гостях после включения правила. Текущее время
                заведения. Получатели — владелец и пользователи с доступом к
                гостям.
              </p>
            </DrawerSection>
            <DrawerSection title="Основание изменения">
              <Textarea
                aria-label="Основание изменения"
                value={rulesReason}
                onChange={(e) => setRulesReason(e.target.value)}
                maxLength={1000}
              />
            </DrawerSection>
            {config.versions.length > 0 && (
              <DrawerSection title="История настроек">
                <DrawerTimeline>
                  {config.versions.map((v, index) => (
                    <DrawerTimelineItem
                      key={v.id}
                      last={index === config.versions.length - 1}
                      avatar={<DrawerAvatar name={v.actor_name} />}
                      title={`Версия ${v.version}`}
                      meta={`${v.actor_name} · ${dateTime(v.created_at)}`}
                    >
                      <p>{v.reason}</p>
                    </DrawerTimelineItem>
                  ))}
                </DrawerTimeline>
              </DrawerSection>
            )}
          </>
        ) : (
          <SettingsSkeleton />
        )}
      </EditDrawer>
    </PageFrame>
  );
}
function TimeField({
  label,
  hour,
  minute,
  onChange,
}: {
  label: string;
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  return (
    <Field label={label}>
      <TimePicker
        value={`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
        clearable={false}
        onChange={(value) => {
          const [h, m] = value.split(":").map(Number);
          if (Number.isInteger(h) && Number.isInteger(m)) onChange(h, m);
        }}
      />
    </Field>
  );
}

function ListInput({
  value,
  onChange,
}: {
  value?: string[];
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState(() => value?.join(", ") ?? "");
  return (
    <Input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
