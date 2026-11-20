"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import { Archive, ArchiveRestore, FileText, SearchX, Warehouse } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TableIconButton,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  TableSortPicker,
  useTableState,
  type TableRowMenuAction,
} from "@/components/shared/table";
import {
  STORE_SETUP_STATUS_HINT,
  STORE_SETUP_STATUS_LABEL,
  STORE_SETUP_STATUS_RANK,
  storeSetupStatus,
  type StoreSetupStatus,
} from "@/lib/inventory/store-setup-status";
import {
  updateInventoryStoreDepartment,
  updateInventoryStoreVenue,
} from "@/app/(dashboard)/inventory/_actions/documents";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";
import { setStoreArchived } from "../actions";
import { StoreDrawer, type StoreDrawerData } from "./store-drawer";

export type StoreRow = {
  id: string;
  title: string;
  store_code: string | null;
  description: string | null;
  local_venue_id: string | null;
  department_id: string | null;
  department_scope: "unset" | "shared" | "department";
  synced_at: string | null;
  archived_at: string | null;
};

export type DepartmentRow = {
  id: string;
  name: string;
  venue_id: string;
  archived_at: string | null;
};

export type VenueRow = {
  id: string;
  name: string;
  archived_at: string | null;
};

/** Акты инвентаризации склада: сколько и когда последний (RPC store_act_stats). */
export type StoreActStats = { count: number; lastActAt: string | null };

// ── Columns ──────────────────────────────────────────────────

type ColKey = "title" | "code" | "venue" | "department" | "lastAct" | "status";

const labels: Record<ColKey, string> = {
  title: "Склад",
  code: "Код",
  venue: "Заведение",
  department: "Подразделение",
  lastAct: "Последний акт",
  status: "Статус",
};
const columnConfig = [
  { id: "title", defaultSize: 280 },
  { id: "code", defaultSize: 110 },
  { id: "venue", defaultSize: 230 },
  { id: "department", defaultSize: 230 },
  { id: "lastAct", defaultSize: 150 },
  { id: "status", defaultSize: 200 },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];
const sortFields: ColKey[] = ["title", "code", "venue", "department", "lastAct", "status"];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

/** Подпись чужого заведения: склад к нему привязан, но имени пользователь не видит. */
const HIDDEN_VENUE = "Другое заведение (нет доступа)";
const NO_VENUE = "Не привязан";
const UNDO_WINDOW_MS = 15_000;

/**
 * Дата акта — ДД.ММ.ГГГГ в поясе Quick Resto. Пояс задан явно: строку
 * рисуют и сервер (UTC), и браузер, и без пояса они разошлись бы на гидратации.
 */
const actDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Moscow",
});

/** Строка таблицы: склад с уже вычисленными подписями — по ним сортировка и поиск. */
type StoreView = StoreRow & {
  venueLabel: string;
  departmentLabel: string;
  departmentValue: string;
  status: StoreSetupStatus;
  /** Подразделения заведения склада (без архивных) + текущее, если его среди них нет. */
  departmentOptions: OptionSelectOption[];
  venueOptions: OptionSelectOption[];
  stats: StoreActStats | null;
  /**
   * При последней синхронизации склада не было в Quick Resto: полная
   * синхронизация ставит всем пришедшим складам одно время, у пропавшего оно
   * осталось старым. Подсказка, а не статус: синхронизация могла оборваться
   * на середине.
   */
  missingInSource: boolean;
  /** После архивации у склада появились акты: возможно, его рано убрали. */
  newActsAfterArchive: boolean;
};

/**
 * Три состояния привязки в одном значении селекта: «unset» (ещё не
 * настроено), «shared» (платит общий пул) и «department:<id>». «Не задано»
 * — рабочее состояние: владелец настраивает склады по ходу, и оно должно
 * быть видно в списке, а не выглядеть как «общий склад».
 */
const departmentValueOf = (store: StoreRow) =>
  store.department_scope === "department" && store.department_id
    ? `department:${store.department_id}`
    : store.department_scope === "shared"
      ? "shared"
      : "unset";

export function StoresClient({
  stores: initialStores,
  venues,
  departments,
  actStats,
  lastSyncedAt,
  canManage,
  canSync,
  canViewDocuments,
  canViewHistory,
}: {
  stores: StoreRow[];
  venues: VenueRow[];
  departments: DepartmentRow[];
  actStats: Record<string, StoreActStats>;
  lastSyncedAt: string | null;
  canManage: boolean;
  canSync: boolean;
  canViewDocuments: boolean;
  canViewHistory: boolean;
}) {
  const router = useRouter();

  // Выбор применяется сразу, без ожидания: запись быстрая, а раньше спиннер
  // висел до полной перерисовки страницы (router.refresh заново тянул все
  // склады и подразделения). Поверх серверного списка лежат два слоя правок:
  //  - confirmed — уже записано в базу, но серверный список ещё старый;
  //  - pending — последний выбор, ответ на который ещё не пришёл.
  // Серверные действия одного клиента Next выполняет по очереди, поэтому
  // ответы приходят в порядке выбора. Ошибка откатывает только свой выбор и
  // только если после него склад не меняли: более новый выбор не затирается.
  // Когда приходит свежий серверный список (синхронизация вызывает
  // router.refresh), confirmed сбрасывается — база уже в нём; pending остаются.
  type Layer = { confirmed: Partial<StoreRow>; pending: Partial<StoreRow> | null; seq: number };
  const [layers, setLayers] = useState<Record<string, Layer>>({});
  const [serverStores, setServerStores] = useState(initialStores);
  if (serverStores !== initialStores) {
    setServerStores(initialStores);
    setLayers((current) => {
      const next: Record<string, Layer> = {};
      for (const [id, layer] of Object.entries(current)) {
        if (layer.pending) next[id] = { ...layer, confirmed: {} };
      }
      return next;
    });
  }
  const seqRef = useRef(0);

  const applyChange = async (
    storeId: string,
    patch: Partial<StoreRow>,
    write: () => Promise<{ error?: string | null; notice?: string | null }>,
  ) => {
    const seq = ++seqRef.current;
    setLayers((current) => {
      const layer = current[storeId] ?? { confirmed: {}, pending: null, seq };
      return { ...current, [storeId]: { ...layer, pending: { ...(layer.pending ?? {}), ...patch }, seq } };
    });
    let result: { error?: string | null; notice?: string | null };
    try {
      result = await write();
    } catch {
      // Сетевой сбой или выкатка новой версии: откатываем выбор так же, как
      // при ошибке сервера, иначе поле навсегда показывало бы несохранённое.
      result = { error: "Не удалось сохранить. Проверьте соединение и повторите" };
    }
    setLayers((current) => {
      const layer = current[storeId];
      if (!layer) return current;
      const latest = layer.seq === seq;
      const confirmed = result.error ? layer.confirmed : { ...layer.confirmed, ...patch };
      return { ...current, [storeId]: { confirmed, pending: latest ? null : layer.pending, seq: layer.seq } };
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.notice) toast.message(result.notice);
  };

  // Записанное в базу, но ещё не пришедшее с сервера (архив и возврат).
  const confirmPatch = (storeId: string, patch: Partial<StoreRow>) =>
    setLayers((current) => {
      const layer = current[storeId] ?? { confirmed: {}, pending: null, seq: ++seqRef.current };
      return { ...current, [storeId]: { ...layer, confirmed: { ...layer.confirmed, ...patch } } };
    });

  // Архивное заведение выбрать нельзя: резолвер привязки его тоже обходит
  // (src/lib/inventory/default-venue.ts), и предлагать то, что автоматика
  // считает нерабочим, — значит вести пользователя в тупик.
  const activeVenues = useMemo(() => venues.filter((venue) => !venue.archived_at), [venues]);
  const venueById = useMemo(() => new Map(venues.map((venue) => [venue.id, venue])), [venues]);

  // Подразделения принадлежат заведению: складу предлагаем только подразделения
  // его заведения. Выбор из чужого заведения база всё равно отклонит.
  // Архивное подразделение, как и архивное заведение, не предлагаем к выбору.
  const { departmentsByVenue, departmentById } = useMemo(() => {
    const byVenue = new Map<string, DepartmentRow[]>();
    for (const department of departments) {
      if (department.archived_at) continue;
      const list = byVenue.get(department.venue_id) ?? [];
      list.push(department);
      byVenue.set(department.venue_id, list);
    }
    return { departmentsByVenue: byVenue, departmentById: new Map(departments.map((d) => [d.id, d])) };
  }, [departments]);

  const lastSyncedTime = lastSyncedAt ? new Date(lastSyncedAt).getTime() : null;

  const rows: StoreView[] = useMemo(
    () =>
      initialStores.map((raw) => {
        const layer = layers[raw.id];
        const store = layer ? { ...raw, ...layer.confirmed, ...(layer.pending ?? {}) } : raw;

        /*
         * Опции заведения. Текущая привязка обязана быть среди них, иначе
         * селект со значением, которого нет в списке, покажет пустую подпись —
         * и будет выглядеть так, будто склад не привязан, хотя он привязан.
         * Два случая, когда текущего заведения нет в общем списке:
         *  - оно архивное (мы сами их отфильтровали) — показываем с пометкой;
         *  - его не видно пользователю. Списки приходят из политик РАЗНОЙ
         *    ширины: склады видны целиком по inventory.manage_stores
         *    (миграция 230), а заведения — только те, где у человека активная
         *    роль (миграция 198). Имени такого заведения у нас нет, поэтому
         *    показываем нейтральную подпись — но показываем, чтобы не соврать
         *    про привязку.
         */
        const currentVenue = store.local_venue_id ? venueById.get(store.local_venue_id) : undefined;
        const venueLabel = !store.local_venue_id
          ? NO_VENUE
          : currentVenue
            ? `${currentVenue.name}${currentVenue.archived_at ? " (в архиве)" : ""}`
            : HIDDEN_VENUE;
        const venueOptions: OptionSelectOption[] = [
          { value: "", label: NO_VENUE },
          ...activeVenues.map((venue) => ({ value: venue.id, label: venue.name })),
          ...(store.local_venue_id && (!currentVenue || currentVenue.archived_at)
            ? [{ value: store.local_venue_id, label: venueLabel }]
            : []),
        ];

        const storeDepartments = store.local_venue_id ? (departmentsByVenue.get(store.local_venue_id) ?? []) : [];
        const departmentValue = departmentValueOf(store);
        // Текущее подразделение обязано быть среди опций по той же причине.
        // Не попадает в список оно в двух случаях: подразделение в архиве (мы
        // его отфильтровали) или не видно среди загруженных.
        const currentDepartment = store.department_id ? departmentById.get(store.department_id) : undefined;
        const currentDepartmentLabel = currentDepartment
          ? `${currentDepartment.name}${currentDepartment.archived_at ? " (в архиве)" : ""}`
          : "Другое подразделение";
        const extraDepartment =
          store.department_id && !storeDepartments.some((department) => department.id === store.department_id);
        const departmentOptions: OptionSelectOption[] = [
          ...storeDepartments.map((department) => ({ value: `department:${department.id}`, label: department.name })),
          ...(extraDepartment ? [{ value: `department:${store.department_id}`, label: currentDepartmentLabel }] : []),
        ];
        // Пустая группа ничего не объясняет: говорим, почему выбрать не из чего.
        // Раньше это была строка под полем, но в строке таблицы ей нет места.
        if (departmentOptions.length === 0) {
          departmentOptions.push({
            value: "__no_departments__",
            label: store.local_venue_id ? "В заведении нет подразделений" : "Сначала выберите заведение",
            disabled: true,
          });
        }
        const departmentLabel =
          departmentValue === "shared"
            ? "Общий склад"
            : departmentValue === "unset"
              ? "Не задано"
              : currentDepartmentLabel;

        const stats = actStats[store.id] ?? null;
        return {
          ...store,
          venueLabel,
          venueOptions,
          departmentValue,
          departmentLabel,
          departmentOptions,
          stats,
          missingInSource: Boolean(
            lastSyncedTime && store.synced_at && new Date(store.synced_at).getTime() < lastSyncedTime,
          ),
          newActsAfterArchive: Boolean(
            store.archived_at &&
              stats?.lastActAt &&
              new Date(stats.lastActAt).getTime() > new Date(store.archived_at).getTime(),
          ),
          status: storeSetupStatus({
            venueId: store.local_venue_id,
            scope: store.department_scope,
            departmentId: store.department_id,
            departmentArchived: Boolean(currentDepartment?.archived_at),
          }),
        };
      }),
    [initialStores, layers, venueById, activeVenues, departmentsByVenue, departmentById, actStats, lastSyncedTime],
  );

  const updateDepartment = (store: StoreView, value: string) => {
    const input = value.startsWith("department:")
      ? { storeId: store.id, scope: "department" as const, departmentId: value.slice("department:".length) }
      : { storeId: store.id, scope: value === "shared" ? ("shared" as const) : ("unset" as const), departmentId: null };
    return applyChange(store.id, { department_scope: input.scope, department_id: input.departmentId }, () =>
      updateInventoryStoreDepartment(input),
    );
  };

  const updateVenue = (store: StoreView, venueId: string) => {
    const nextVenueId = venueId || null;
    // Так же, как триггер в базе: смена или снятие заведения снимает привязку
    // к подразделению (оно принадлежит прежнему заведению), а «общий склад»
    // переживает смену заведения.
    const dropsDepartment = store.department_scope === "department" && nextVenueId !== store.local_venue_id;
    return applyChange(
      store.id,
      {
        local_venue_id: nextVenueId,
        ...(dropsDepartment ? { department_scope: "unset" as const, department_id: null } : {}),
      },
      () => updateInventoryStoreVenue({ storeId: store.id, venueId: nextVenueId }),
    );
  };

  // ── Архив ──────────────────────────────────────────────────

  const [showArchive, setShowArchive] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<StoreView | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const restore = async (store: Pick<StoreView, "id" | "title">) => {
    const result = await setStoreArchived(store.id, false).catch(() => ({
      error: "Не удалось вернуть склад. Проверьте соединение и повторите",
    }));
    if (result.error) {
      toast.error(result.error);
      return;
    }
    confirmPatch(store.id, { archived_at: null });
    toast.success(`Склад «${store.title}» возвращён из архива`);
    router.refresh();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const store = archiveTarget;
    setArchiveBusy(true);
    setArchiveError(null);
    const result = await setStoreArchived(store.id, true).catch(() => ({
      error: "Не удалось отправить склад в архив. Проверьте соединение и повторите",
    }));
    setArchiveBusy(false);
    if (result.error) {
      setArchiveError(result.error);
      return;
    }
    confirmPatch(store.id, { archived_at: new Date().toISOString() });
    setArchiveTarget(null);
    if (openStoreId === store.id) setOpenStoreId(null);
    toast(`Склад «${store.title}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: { label: "Отменить", onClick: () => void restore(store) },
    });
    router.refresh();
  };

  // В карточке «Акты склада» — кнопка в подвале, в её меню только архив.
  const menuActions = (store: StoreView, withDocuments = true): TableRowMenuAction[] => [
    ...(canViewDocuments && withDocuments
      ? [
          {
            label: "Акты склада",
            icon: <FileText />,
            onSelect: () => router.push(`/documents/inventory?store=${store.id}`),
          },
        ]
      : []),
    ...(canManage
      ? [
          store.archived_at
            ? {
                label: "Вернуть из архива",
                icon: <ArchiveRestore />,
                onSelect: () => void restore(store),
                separatorBefore: canViewDocuments && withDocuments,
              }
            : {
                label: "В архив",
                icon: <Archive />,
                onSelect: () => {
                  setArchiveError(null);
                  setArchiveTarget(store);
                },
                separatorBefore: canViewDocuments && withDocuments,
              },
        ]
      : []),
  ];
  const hasMenu = canViewDocuments || canManage;

  // ── Список: поиск, условия, сортировка ─────────────────────

  const st = useTableState({ tableId: "org.stores", columns: columnConfig });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [venueFilter, setVenueFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  const liveRows = useMemo(() => rows.filter((store) => !store.archived_at), [rows]);
  const archivedRows = useMemo(() => rows.filter((store) => store.archived_at), [rows]);
  const modeRows = showArchive ? archivedRows : liveRows;

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filtered = useMemo(
    () =>
      modeRows.filter((store) => {
        if (
          q &&
          ![store.title, store.store_code, store.description].some((text) =>
            text?.toLocaleLowerCase("ru").includes(q),
          )
        )
          return false;
        if (venueFilter === "none" && store.local_venue_id) return false;
        if (venueFilter && venueFilter !== "none" && store.local_venue_id !== venueFilter) return false;
        if (statusFilter === "attention" && store.status === "ready") return false;
        if (statusFilter === "ready" && store.status !== "ready") return false;
        return true;
      }),
    [modeRows, q, venueFilter, statusFilter],
  );
  const hasFilters = Boolean(venueFilter || statusFilter);
  const isFiltered = q.length > 0 || hasFilters;
  const resetConditions = () => {
    setVenueFilter("");
    setStatusFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  // В фильтре — заведения, к которым склады реально привязаны, плюс «Не привязан».
  const venueFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const store of modeRows) if (store.local_venue_id) seen.set(store.local_venue_id, store.venueLabel);
    return [
      { value: "", label: "Все заведения" },
      ...[...seen.entries()]
        .sort((a, b) => collator.compare(a[1], b[1]))
        .map(([value, label]) => ({ value, label })),
      { value: "none", label: NO_VENUE },
    ];
  }, [modeRows]);

  // Панель склада держит id, а данные берёт из текущей строки — после правки
  // привязки в таблице панель сразу показывает новое значение.
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const openStore = rows.find((store) => store.id === openStoreId) ?? null;
  const drawerData: StoreDrawerData | null = openStore
    ? {
        id: openStore.id,
        title: openStore.title,
        code: openStore.store_code,
        description: openStore.description,
        venueLabel: openStore.venueLabel,
        departmentLabel: openStore.departmentLabel,
        status: openStore.status,
        archivedAt: openStore.archived_at,
        stats: openStore.stats,
        missingInSource: openStore.missingInSource,
      }
    : null;

  const selectClass = "h-9 w-full min-w-0 px-3";
  // В архиве привязки не правятся: склад скрыт, его сначала возвращают.
  const editable = canManage && !showArchive;

  const columns: ColumnDef<StoreView>[] = [
    {
      id: "title",
      header: labels.title,
      size: 280,
      minSize: 180,
      enableHiding: false,
      accessorFn: (store) => store.title,
      sortingFn: (a, b) => collator.compare(a.original.title, b.original.title),
      cell: ({ row }) => {
        const store = row.original;
        const description = store.description?.trim();
        const missing = store.missingInSource && !store.archived_at;
        return (
          <div className="min-w-0">
            {/* Настоящая кнопка в первой ячейке: строку можно открыть и с клавиатуры. */}
            <button
              type="button"
              className="block max-w-full truncate text-left font-medium hover:underline"
              data-tip={store.title}
              onClick={() => setOpenStoreId(store.id)}
            >
              {store.title}
            </button>
            {missing || description ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {/* Пометка — второй строкой, а не бейджем рядом с названием:
                    в узком столбце бейдж съедал название до «С…». */}
                {missing ? (
                  <span
                    className="text-amber-700 dark:text-amber-400"
                    data-tip="При последней синхронизации склада не было в Quick Resto"
                    data-tip-sub="Если он больше не нужен, отправьте его в архив"
                  >
                    Нет в Quick Resto
                  </span>
                ) : null}
                {missing && description ? " · " : null}
                {description ? <span data-tip={description}>{description}</span> : null}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "code",
      header: labels.code,
      size: 110,
      minSize: 80,
      accessorFn: (store) => store.store_code ?? undefined,
      sortUndefined: "last",
      sortingFn: (a, b) => collator.compare(a.original.store_code ?? "", b.original.store_code ?? ""),
      cell: ({ row }) =>
        row.original.store_code ? (
          <span className="block truncate tabular-nums" data-tip={row.original.store_code}>
            {row.original.store_code}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "venue",
      header: labels.venue,
      size: 230,
      minSize: 180,
      accessorFn: (store) => store.venueLabel,
      // «Не привязан» — в конец списка при любом направлении: это не заведение.
      sortingFn: (a, b) =>
        Number(!a.original.local_venue_id) - Number(!b.original.local_venue_id) ||
        collator.compare(a.original.venueLabel, b.original.venueLabel),
      cell: ({ row }) => {
        const store = row.original;
        if (!editable)
          return (
            <span
              className={`block truncate ${store.local_venue_id ? "" : "text-muted-foreground"}`}
              data-tip={store.venueLabel}
            >
              {store.venueLabel}
            </span>
          );
        return (
          <OptionSelect
            aria-label={`Заведение склада «${store.title}»`}
            className={selectClass}
            value={store.local_venue_id ?? ""}
            onValueChange={(next) => void updateVenue(store, next)}
            options={store.venueOptions}
          />
        );
      },
    },
    {
      id: "department",
      header: labels.department,
      size: 230,
      minSize: 180,
      accessorFn: (store) => store.departmentLabel,
      sortingFn: (a, b) => collator.compare(a.original.departmentLabel, b.original.departmentLabel),
      cell: ({ row }) => {
        const store = row.original;
        if (!editable)
          return (
            <span
              className={`block truncate ${store.departmentValue === "unset" ? "text-muted-foreground" : ""}`}
              data-tip={store.departmentLabel}
            >
              {store.departmentLabel}
            </span>
          );
        return (
          <OptionSelect
            aria-label={`Подразделение склада «${store.title}»`}
            className={selectClass}
            value={store.departmentValue}
            onValueChange={(next) => void updateDepartment(store, next)}
            options={[
              { value: "unset", label: "Не задано" },
              { value: "shared", label: "Общий склад" },
            ]}
            groups={[{ label: "Подразделения", options: store.departmentOptions }]}
          />
        );
      },
    },
    {
      id: "lastAct",
      header: labels.lastAct,
      size: 150,
      minSize: 130,
      accessorFn: (store) => (store.stats?.lastActAt ? new Date(store.stats.lastActAt).getTime() : undefined),
      sortUndefined: "last",
      cell: ({ row }) => {
        const store = row.original;
        if (!store.stats?.lastActAt) return <span className="text-muted-foreground">—</span>;
        const text = actDate.format(new Date(store.stats.lastActAt));
        const tip = `Актов инвентаризации: ${store.stats.count}`;
        return canViewDocuments ? (
          <Link
            href={`/documents/inventory?store=${store.id}`}
            className="tabular-nums hover:underline"
            data-tip={tip}
            data-tip-sub="Открыть акты склада"
          >
            {text}
          </Link>
        ) : (
          <span className="tabular-nums" data-tip={tip}>
            {text}
          </span>
        );
      },
    },
    {
      id: "status",
      header: labels.status,
      size: 200,
      // Самая длинная подпись — «Подразделение в архиве»: бейдж не режем.
      minSize: 196,
      accessorFn: (store) => STORE_SETUP_STATUS_RANK[store.status],
      cell: ({ row }) => {
        const store = row.original;
        if (store.archived_at) {
          const since = actDate.format(new Date(store.archived_at));
          return store.newActsAfterArchive ? (
            <StatusBadge
              tone="warning"
              tip={`В архиве с ${since}, но после этого у склада появились акты. Верните его, если склад снова работает`}
            >
              Новые акты
            </StatusBadge>
          ) : (
            <StatusBadge tip={`В архиве с ${since}`}>В архиве</StatusBadge>
          );
        }
        return (
          <StatusBadge
            tone={store.status === "ready" ? "success" : "warning"}
            tip={STORE_SETUP_STATUS_HINT[store.status]}
          >
            {STORE_SETUP_STATUS_LABEL[store.status]}
          </StatusBadge>
        );
      },
    },
    ...(hasMenu
      ? [
          {
            id: "actions",
            size: ROW_MENU_COLUMN_SIZE,
            minSize: ROW_MENU_COLUMN_SIZE,
            maxSize: ROW_MENU_COLUMN_SIZE,
            enableHiding: false,
            enableResizing: false,
            enableSorting: false,
            cell: ({ row }) => {
              const menu = menuActions(row.original);
              return menu.length > 0 ? <TableRowMenu actions={menu} /> : null;
            },
          } satisfies ColumnDef<StoreView>,
        ]
      : []),
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: {
      sorting: st.sorting,
      pagination: st.pagination,
      columnVisibility: { ...st.columnVisibility, title: true, actions: hasMenu },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    onSortingChange: st.setSorting,
    onPaginationChange: st.setPagination,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getRowId: (store) => store.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const changeSorting = (next: typeof st.sorting) => {
    st.setSorting(next);
    firstPage();
  };

  const attentionCount = liveRows.filter((store) => store.status !== "ready").length;
  const toggleArchive = () => {
    setShowArchive((value) => !value);
    // Статус настройки в архиве не нужен: фильтр по нему там ничего не отберёт.
    setStatusFilter("");
    firstPage();
  };

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Организация" }, { label: "Склады" }]} />
      <TablePageHeader
        title={showArchive ? "Склады в архиве" : "Склады"}
        count={isFiltered ? `${filtered.length} из ${modeRows.length}` : modeRows.length}
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
              placeholder: "Название или код",
            }}
            filters={{
              active: hasFilters,
              onClick: () => setFiltersOpen((v) => !v),
            }}
            sort={{
              active: st.sorting.length > 0,
              content: (
                <TableSortPicker sorting={st.sorting} onChange={changeSorting} fields={sortFields} labels={labels} />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder
                    .filter((id) => id !== "actions")
                    .map((id) => {
                      const c = table.getColumn(id)!;
                      return {
                        id,
                        label: labels[id as ColKey],
                        visible: c.getIsVisible(),
                        canHide: c.getCanHide(),
                      };
                    })}
                  onVisibilityChange={(id, v) => table.getColumn(id)?.toggleVisibility(v)}
                  onMoveColumn={(a, b) =>
                    st.setColumnOrder((order) => arrayMove(order, order.indexOf(a), order.indexOf(b)))
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            // Архив — кнопкой в ряду инструментов, как у шаблонов смен; пока
            // архив пуст, кнопки нет.
            secondaryActions={
              archivedRows.length > 0 || showArchive ? (
                <TableIconButton
                  label={showArchive ? "Вернуться к действующим складам" : `Архив складов · ${archivedRows.length}`}
                  active={showArchive}
                  onClick={toggleArchive}
                >
                  <Archive />
                </TableIconButton>
              ) : null
            }
            primaryActions={<InventorySyncButton layout="toolbar" canSync={canSync} lastSyncedAt={lastSyncedAt} />}
          />
        }
      />
      <TableConditions
        label="Условия списка складов"
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
        {!showArchive && (filtersOpen || !!statusFilter) && (
          <TableFilterChip
            label="Статус"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              firstPage();
            }}
            options={[
              { value: "", label: "Все склады" },
              { value: "attention", label: "Требуют настройки" },
              { value: "ready", label: "Настроены" },
            ]}
          />
        )}
        {(filtersOpen || !!venueFilter) && (
          <TableFilterChip
            label="Заведение"
            value={venueFilter}
            onChange={(v) => {
              setVenueFilter(v);
              firstPage();
            }}
            options={venueFilterOptions}
          />
        )}
      </TableConditions>

      {modeRows.length === 0 ? (
        showArchive ? (
          <EmptyState
            icon={Archive}
            title="Архив пуст"
            description="Сюда попадают склады, которые больше не используются"
            action={
              <Button variant="outline" onClick={toggleArchive}>
                К действующим складам
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Warehouse}
            title="Складов пока нет"
            description={
              archivedRows.length > 0
                ? "Все склады в архиве"
                : canSync
                  ? "Склады появятся после синхронизации с Quick Resto"
                  : "Склады появятся после синхронизации с Quick Resto. Её запускает сотрудник с доступом к интеграции"
            }
          />
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Склады не найдены"
          description="Измените условия поиска или сбросьте фильтры"
          action={
            <Button variant="outline" onClick={resetConditions}>
              Очистить все
            </Button>
          }
        />
      ) : (
        <>
          {/* Сколько складов мешают расчёту недостачи — видно, не открывая фильтр.
              Нажатие сразу отбирает их. */}
          {!showArchive && attentionCount > 0 && statusFilter !== "attention" ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
            >
              <p className="min-w-0 flex-1">
                {attentionCount === liveRows.length
                  ? "Ни один склад не настроен до конца: недостачу по ним не посчитать полностью"
                  : `Требуют настройки: ${attentionCount} из ${liveRows.length}. Без заведения и подразделения недостачу по складу не посчитать полностью`}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  setStatusFilter("attention");
                  firstPage();
                }}
              >
                Показать
              </Button>
            </div>
          ) : null}
          <DataTable
            table={table}
            label={showArchive ? "Склады в архиве" : "Склады"}
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            onRowClick={(row) => setOpenStoreId(row.original.id)}
            empty={null}
            mobile={{ label: "Карточки складов", nameColumn: "title", statusColumn: "status" }}
          />
          <TablePagination
            pageIndex={st.pagination.pageIndex}
            pageSize={st.pagination.pageSize}
            total={filtered.length}
            onPageChange={(pageIndex) => st.setPagination((p) => ({ ...p, pageIndex }))}
            onPageSizeChange={(pageSize) => st.setPagination({ pageIndex: 0, pageSize })}
          />
        </>
      )}

      <StoreDrawer
        store={drawerData}
        onOpenChange={(open) => {
          if (!open) setOpenStoreId(null);
        }}
        menu={openStore ? menuActions(openStore, false) : []}
        canViewHistory={canViewHistory}
        canViewDocuments={canViewDocuments}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !archiveBusy) setArchiveTarget(null);
        }}
        title={archiveTarget ? `Отправить склад «${archiveTarget.title}» в архив?` : "Отправить склад в архив?"}
        description={
          <>
            Склад пропадёт из списка складов. Это не удаление: акты, итоги и расчёт недостачи по нему не
            изменятся, синхронизация с Quick Resto его не вернёт. Найти склад можно по кнопке «Архив» в ряду
            инструментов.
          </>
        }
        confirmLabel="В архив"
        pendingLabel="Отправляем…"
        busy={archiveBusy}
        error={archiveError}
        onConfirm={() => void confirmArchive()}
      />
    </PageFrame>
  );
}
