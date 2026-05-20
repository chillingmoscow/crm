/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Loader2,
  Search as SearchIcon,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableControls, TableControlPin } from "@/components/shared/table";
import { cn } from "@/lib/utils";
import { submitInventoryDocumentDraft } from "@/app/(dashboard)/inventory/actions";

type EditorDocument = {
  id: string;
  documentNumber: string;
  storeTitle: string | null;
  status: string;
  baseLastUpdateDate: string | null;
  /** ISO timestamp последней QR-синхронизации акта. Используется в
      hydration: draft до sync — игнорируем (старый, sync свежее);
      draft после sync — restore (легитимные правки user'а). */
  syncedAt: string | null;
};

type EditorItem = {
  id: string;
  productName: string;
  article: string | null;
  barcode: string | null;
  measureUnitName: string | null;
  actualAmount: number | null;
  submittedAmount: number | null;
  imageUrl: string | null;
  groupId: string | null;
  groupPath: string | null;
};

type EditorGroup = {
  id: string;
  name: string;
  parentGroupId: string | null;
  depth: number;
  path: string;
};

type DraftPayload = {
  values: Record<string, string>;
  savedAt: string;
  document: EditorDocument;
  items: EditorItem[];
};

const DB_NAME = "sheerly-inventory-drafts";
const STORE_NAME = "drafts";
type SortMode =
  | "order"
  | "name_asc" | "name_desc"
  | "empty_first" | "empty_last"
  | "group_asc" | "group_desc";

const SORT_OPTIONS: { value: SortMode; label: string; direction?: "asc" | "desc" }[] = [
  { value: "order",       label: "Порядок QR" },
  { value: "name_asc",    label: "Название А → Я",  direction: "asc"  },
  { value: "name_desc",   label: "Название Я → А",  direction: "desc" },
  { value: "empty_first", label: "Пустые сверху",   direction: "asc"  },
  { value: "empty_last",  label: "Пустые снизу",    direction: "desc" },
  { value: "group_asc",   label: "Группа А → Я",    direction: "asc"  },
  { value: "group_desc",  label: "Группа Я → А",    direction: "desc" },
];

const SORT_LABEL_BY_VALUE: Record<SortMode, string> = Object.fromEntries(
  SORT_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SortMode, string>;

const SORT_DIRECTION_BY_VALUE: Record<SortMode, "asc" | "desc" | undefined> = Object.fromEntries(
  SORT_OPTIONS.map((option) => [option.value, option.direction]),
) as Record<SortMode, "asc" | "desc" | undefined>;

const DEFAULT_SORT_MODE: SortMode = "order";

// Фильтр «Заполненность» — какие строки показывать в форме акта.
// «all»     — все позиции (дефолт),
// «filled»  — только те, где actual_amount уже введён,
// «empty»   — только те, где значение пустое (это рабочая выборка
//             для линейного сотрудника, чтобы видеть «что осталось
//             посчитать»).
type FillState = "all" | "filled" | "empty";
const DEFAULT_FILL_STATE: FillState = "all";
const FILL_STATE_LABEL: Record<FillState, string> = {
  all:    "Все позиции",
  filled: "Только заполненные",
  empty:  "Только пустые",
};

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readDraft(key: string): Promise<DraftPayload | null> {
  const database = await openDraftDb();
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve((request.result as DraftPayload | undefined) ?? null);
  });
}

async function writeDraft(key: string, payload: DraftPayload) {
  const database = await openDraftDb();
  return new Promise<void>((resolve) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(payload, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function deleteDraft(key: string) {
  const database = await openDraftDb();
  return new Promise<void>((resolve) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function toInputValue(value: number | null) {
  return value === null || value === undefined ? "" : String(value);
}

function parseAmount(value: string) {
  if (!value.trim()) return null;
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function InventoryDocumentEditor({
  document,
  groups,
  items,
}: {
  document: EditorDocument;
  groups: EditorGroup[];
  items: EditorItem[];
}) {
  const router = useRouter();
  // Initial value поля: приоритет submittedAmount (наш CRM писал через
  // submit-flow), fallback на actualAmount (синкнулось из QR — если
  // пользователь заполнял акт напрямую в QR-backoffice). Без fallback
  // форма выглядела пустой, хотя данные из QR в БД есть.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        toInputValue(item.submittedAmount ?? item.actualAmount),
      ])
    )
  );
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [fillState, setFillState] = useState<FillState>(DEFAULT_FILL_STATE);
  const [sortMode, setSortMode] = useState<SortMode>(DEFAULT_SORT_MODE);
  // По дефолту pin-row скрыт, кнопка «Фильтры» нейтральна. Поведение —
  // как у /documents/inventory (см. feedback_table_standardization_checklist).
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Snapshot значений «на момент сортировки» — обновляется только при
  // blur input'а или смене sortMode. Без этого режим «Пустые сверху/снизу»
  // перестраивал список на КАЖДЫЙ keystroke (sort использовал live
  // values), выкидывая активную ячейку в другое место (UX-баг).
  // Теперь строка остаётся на месте пока user печатает; перестановка
  // случается после выхода из поля.
  const [sortValuesSnapshot, setSortValuesSnapshot] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        toInputValue(item.submittedAmount ?? item.actualAmount),
      ])
    )
  );

  const itemOrderById = useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items]
  );

  const childrenByGroupId = useMemo(() => {
    const ids = new Set(groups.map((group) => group.id));
    const children = new Map<string, EditorGroup[]>();
    for (const group of groups) {
      if (!group.parentGroupId || !ids.has(group.parentGroupId)) continue;
      const rows = children.get(group.parentGroupId) ?? [];
      rows.push(group);
      children.set(group.parentGroupId, rows);
    }
    return children;
  }, [groups]);

  const selectedGroupIds = useMemo(() => {
    if (!selectedGroupId) return null;
    const ids = new Set<string>();
    function walk(groupId: string) {
      if (ids.has(groupId)) return;
      ids.add(groupId);
      for (const child of childrenByGroupId.get(groupId) ?? []) {
        walk(child.id);
      }
    }
    walk(selectedGroupId);
    return ids;
  }, [childrenByGroupId, selectedGroupId]);

  const visibleItems = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (selectedGroupIds && (!item.groupId || !selectedGroupIds.has(item.groupId))) {
        return false;
      }
      // Fill-state фильтр — на live values, не snapshot: пользователь
      // ожидает, что после ввода значения строка пропадает из «только
      // пустые» (а не сохраняется до blur, как snapshot-сортировка).
      if (fillState !== "all") {
        const isFilled = (values[item.id] ?? "").trim() !== "";
        if (fillState === "filled" && !isFilled) return false;
        if (fillState === "empty"  &&  isFilled) return false;
      }
      if (!search) return true;
      return [
        item.productName,
        item.article,
        item.barcode,
        item.measureUnitName,
        item.groupPath,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });

    return [...filtered].sort((left, right) => {
      if (sortMode === "name_asc") return left.productName.localeCompare(right.productName, "ru");
      if (sortMode === "name_desc") return right.productName.localeCompare(left.productName, "ru");
      if (sortMode === "group_asc" || sortMode === "group_desc") {
        const byCategory = (left.groupPath ?? "—").localeCompare(right.groupPath ?? "—", "ru");
        const result = byCategory || left.productName.localeCompare(right.productName, "ru");
        return sortMode === "group_asc" ? result : -result;
      }
      if (sortMode === "empty_first" || sortMode === "empty_last") {
        // Используем snapshot, не live values — иначе на каждый
        // keystroke в active input строка перепрыгивала.
        const leftEmpty = (sortValuesSnapshot[left.id] ?? "").trim() === "";
        const rightEmpty = (sortValuesSnapshot[right.id] ?? "").trim() === "";
        if (leftEmpty !== rightEmpty) {
          return sortMode === "empty_first"
            ? leftEmpty ? -1 : 1
            : leftEmpty ? 1 : -1;
        }
      }
      return (itemOrderById.get(left.id) ?? 0) - (itemOrderById.get(right.id) ?? 0);
    });
  }, [fillState, itemOrderById, items, searchQuery, selectedGroupIds, sortMode, sortValuesSnapshot, values]);

  // При переключении sortMode на «пусто-фильтр» — обновить snapshot, чтобы
  // первая сортировка отражала текущие values.
  useEffect(() => {
    if (sortMode === "empty_first" || sortMode === "empty_last") {
      setSortValuesSnapshot({ ...values });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode]);

  const draftKey = useMemo(
    () => `inventory:${document.id}`,
    [document.id]
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const draft = await readDraft(draftKey);
      if (!alive) return;
      if (draft?.values) {
        // Игнорируем draft если он СТАРШЕ последнего QR-sync:
        //  - Сценарий-1 (закрывает первоначальный bug #390): старая сессия
        //    открыла акт когда actual_amount=NULL, autosave записал
        //    пустой draft. Потом QR-sync заполнил actual_amount. Сейчас
        //    page rendering показывает prefill из QR, но stale draft
        //    перезатирает его на пустоту. Условие draft.savedAt <
        //    document.syncedAt отсеивает этот случай.
        //  - Сценарий-2 (Codex P2 #390): легитимная очистка полей user'ом
        //    после sync — draft.savedAt > document.syncedAt → restore
        //    работает, включая полностью-пустой draft (user намеренно
        //    очистил всё).
        // Если syncedAt отсутствует (старые акты до миграции 194 / тестовые
        // случаи) — fallback на restore (легитимный draft user'а
        // приоритетнее пустого начального state).
        const draftSavedMs = Date.parse(draft.savedAt);
        const syncedMs = document.syncedAt ? Date.parse(document.syncedAt) : NaN;
        const draftIsStale =
          Number.isFinite(draftSavedMs) &&
          Number.isFinite(syncedMs) &&
          draftSavedMs < syncedMs;
        if (!draftIsStale) {
          // Обновляем values + snapshot одной транзакцией: иначе если user
          // включил «пустые сверху/снизу» ДО завершения hydration,
          // sortValuesSnapshot оставался pre-draft → неправильный порядок
          // строк после загрузки (Codex P2 #388).
          setValues((prev) => {
            const next = { ...prev, ...draft.values };
            setSortValuesSnapshot(next);
            return next;
          });
          setSavedAt(draft.savedAt);
        }
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // document.syncedAt используется в hydration (выше) для сравнения
    // с draft.savedAt. Linter просит включить в deps; используем eslint-
    // disable вместо реальной зависимости — мы хотим run **только** при
    // смене документа (draftKey зависит от document.id), повторный run
    // при изменении syncedAt не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!loaded) return;
    const timeout = window.setTimeout(() => {
      const nextSavedAt = new Date().toISOString();
      void writeDraft(draftKey, {
        values,
        savedAt: nextSavedAt,
        document,
        items,
      });
      setSavedAt(nextSavedAt);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [document, draftKey, items, loaded, values]);

  useEffect(() => {
    const hasChanges = items.some(
      (item) => values[item.id] !== toInputValue(item.submittedAmount ?? item.actualAmount),
    );
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [items, values]);

  // ── Controls state-derivatives ────────────────────────────
  const hasGroupFilter = Boolean(selectedGroupId);
  const hasFillFilter = fillState !== DEFAULT_FILL_STATE;
  const hasActiveFilters = hasGroupFilter || hasFillFilter;
  const hasSortActive = sortMode !== DEFAULT_SORT_MODE;
  const hasSearch = searchQuery.trim().length > 0;
  const hasAnyActive = hasActiveFilters || hasSortActive || hasSearch;
  // search-пин показываем только когда уже видны другие pin-row контролы —
  // 1-в-1 эталон documents-table.tsx.
  const showSearchPin = hasSearch && (filtersVisible || hasSortActive || hasActiveFilters);

  const selectedGroupPath = useMemo(
    () => groups.find((group) => group.id === selectedGroupId)?.path ?? null,
    [groups, selectedGroupId],
  );

  const onClearAll = useCallback(() => {
    setSearchQuery("");
    setSearchOpen(false);
    setSelectedGroupId("");
    setFillState(DEFAULT_FILL_STATE);
    setSortMode(DEFAULT_SORT_MODE);
  }, []);

  const sortDirection = SORT_DIRECTION_BY_VALUE[sortMode];

  const submit = () => {
    if (!online) {
      toast.error("Нет соединения. Черновик сохранен на устройстве.");
      return;
    }

    startTransition(async () => {
      const filledItems = items
        .map((item) => ({
          item,
          value: values[item.id] ?? "",
        }))
        .filter(({ value }) => value.trim() !== "");
      if (filledItems.length === 0) {
        toast.error("Заполните хотя бы одну позицию акта");
        return;
      }

      const result = await submitInventoryDocumentDraft({
        documentId: document.id,
        baseLastUpdateDate: document.baseLastUpdateDate,
        items: filledItems.map(({ item, value }) => ({
          itemId: item.id,
          actualAmount: parseAmount(value),
        })),
      });
      if (result.error) {
        toast.error(result.error);
        if (result.refreshDocument) {
          router.refresh();
        }
        return;
      }
      await deleteDraft(draftKey);
      toast.success(result.resultsHasLineAmounts
        ? "Акт отправлен в Quick Resto"
        : "Акт отправлен, но QR не вернул построчные итоги");
      router.refresh();
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-3 md:px-6 md:py-5">
      {/* Шапка с back-кнопкой, табами, номером, статусом и контекстом
          склада/позиций — в shared layout (см. inventory/[id]/layout.tsx).
          Здесь: слева — статус draft'а / offline, справа — контролы. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {!online ? (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <WifiOff className="mr-1 h-3 w-3" />
              Оффлайн
            </span>
          ) : null}
          {savedAt ? <span>Черновик {new Date(savedAt).toLocaleTimeString("ru-RU")}</span> : null}
        </div>

        {/* Контролы — search / filters-toggle / sort-popover.
            Паттерн 1-в-1 с /documents/inventory. */}
        <TableControls
          search={{
            value: searchQuery,
            onChange: setSearchQuery,
            open: searchOpen,
            onOpenChange: setSearchOpen,
            placeholder: "Поиск",
          }}
          filters={{
            active: hasActiveFilters,
            label: filtersVisible ? "Скрыть фильтры" : "Показать фильтры",
            onClick: () => setFiltersVisible((v) => !v),
          }}
          sort={{
            active: hasSortActive,
            content: <SortFieldPanel sortMode={sortMode} onChange={setSortMode} />,
          }}
        />
      </div>

      {/* Pin-row — порядок 1-в-1 с эталоном documents-table.tsx:
          Сортировка → divider → Фильтры (Группа) → divider → Поиск → «Очистить все». */}
      {(filtersVisible || hasSortActive || hasSearch) ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {hasSortActive ? (
            <TableControlPin
              active
              icon={
                sortDirection === "asc"  ? <ArrowUp   className="h-3.5 w-3.5" /> :
                sortDirection === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> :
                                           <ArrowUpDown className="h-3.5 w-3.5" />
              }
              label={SORT_LABEL_BY_VALUE[sortMode]}
              onClear={() => setSortMode(DEFAULT_SORT_MODE)}
              clearLabel="Сбросить сортировку"
              contentClassName="w-auto p-3"
            >
              <SortFieldPanel sortMode={sortMode} onChange={setSortMode} />
            </TableControlPin>
          ) : null}

          {hasSortActive && (filtersVisible || showSearchPin) ? <PinDivider /> : null}

          {filtersVisible ? (
            <>
              <TableControlPin
                active={hasFillFilter}
                label={hasFillFilter ? `Заполненность: ${FILL_STATE_LABEL[fillState]}` : "Заполненность"}
                onClear={hasFillFilter ? () => setFillState(DEFAULT_FILL_STATE) : undefined}
                clearLabel="Сбросить заполненность"
              >
                <FillStatePicker value={fillState} onChange={setFillState} />
              </TableControlPin>

              <TableControlPin
                active={hasGroupFilter}
                label={hasGroupFilter && selectedGroupPath ? `Группа: ${selectedGroupPath}` : "Группа"}
                onClear={hasGroupFilter ? () => setSelectedGroupId("") : undefined}
                clearLabel="Сбросить группу"
              >
                <GroupPicker
                  value={selectedGroupId}
                  groups={groups}
                  onChange={setSelectedGroupId}
                />
              </TableControlPin>
            </>
          ) : null}

          {filtersVisible && showSearchPin ? <PinDivider /> : null}

          {showSearchPin ? (
            <TableControlPin
              active
              icon={<SearchIcon className="h-3.5 w-3.5" />}
              label={`Поиск: ${searchQuery.trim()}`}
              onClear={() => { setSearchQuery(""); setSearchOpen(false); }}
              clearLabel="Очистить поиск"
            >
              <div className="space-y-2 p-2">
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Поиск"
                  className="h-8"
                />
                <p className="text-xs text-muted-foreground">
                  По названию, артикулу, штрих-коду и группе.
                </p>
              </div>
            </TableControlPin>
          ) : null}

          {hasAnyActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onClearAll}
            >
              Очистить все
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        {visibleItems.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            По текущему поиску и группе позиций нет.
          </div>
        ) : visibleItems.map((item) => {
          const isFilled = (values[item.id] ?? "").trim() !== "";
          return (
          <div
            key={item.id}
            className={cn(
              "grid grid-cols-[64px_1fr_112px] items-center gap-3 rounded-lg border p-2 transition-colors",
              // Заполненные строки — brand-tint (виден и в light, и в dark);
              // пустые — neutral.
              isFilled
                ? "border-brand/30 bg-brand/5 dark:border-brand/40 dark:bg-brand/10"
                : "border-border bg-background",
            )}
          >
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.productName} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">нет фото</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{item.productName}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {item.article ? <span>Арт. {item.article}</span> : null}
                {item.barcode ? <span>{item.barcode}</span> : null}
                {item.measureUnitName ? <span>{item.measureUnitName}</span> : null}
                {item.groupPath ? <span>{item.groupPath}</span> : null}
              </div>
            </div>
            <Input
              inputMode="decimal"
              value={values[item.id] ?? ""}
              onChange={(event) => {
                const next = event.target.value.replace(/[^\d.,-]/g, "");
                setValues((prev) => ({ ...prev, [item.id]: next }));
              }}
              onBlur={() => {
                // Обновляем snapshot для sort режима «пусто-фильтр» —
                // перестановка строк случается ТОЛЬКО при потере фокуса,
                // не во время ввода.
                if (sortMode === "empty_first" || sortMode === "empty_last") {
                  setSortValuesSnapshot({ ...values });
                }
              }}
              aria-label={`Факт: ${item.productName}`}
              className="text-right"
            />
          </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 mt-4 border-t bg-background/95 py-3 backdrop-blur">
        <Button type="button" size="lg" className="w-full" disabled={isPending || !loaded} onClick={submit}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <span className="ml-2">Отправить в Quick Resto</span>
        </Button>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PinDivider() {
  return <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
}

/**
 * Контент popover'а сортировки (одиночный sort). Эталон вёрстки —
 * SortFieldPanel в documents-table.tsx (список полей через
 * `space-y-1` + кнопки `rounded-sm px-3 py-2`). Без min-w/p-обёрток —
 * padding даёт сам PopoverContent.
 */
function SortFieldPanel({
  sortMode,
  onChange,
}: {
  sortMode: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  return (
    <div className="space-y-1">
      {SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">{option.label}</span>
          {sortMode === option.value ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Контент popover'а Группа-фильтра. Эталон — VenuePicker/StorePicker
 * в documents-table.tsx (max-h + overflow-y, кнопки rounded-sm
 * px-3 py-2). Иерархия групп — paddingLeft по depth.
 */
function GroupPicker({
  value,
  groups,
  onChange,
}: {
  value: string;
  groups: EditorGroup[];
  onChange: (groupId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">
        В акте нет групп ингредиентов.
      </div>
    );
  }
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      <button
        type="button"
        onClick={() => onChange("")}
        className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
      >
        <span className="truncate">Все группы акта</span>
        {value === "" ? <Check className="h-4 w-4 shrink-0" /> : null}
      </button>
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => onChange(group.id)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
          style={{ paddingLeft: 12 + Math.min(group.depth, 8) * 12 }}
        >
          <span className="truncate">{group.path}</span>
          {value === group.id ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Контент popover'а Заполненность-фильтра. Three-state: все / только
 * заполненные / только пустые.
 */
function FillStatePicker({
  value,
  onChange,
}: {
  value: FillState;
  onChange: (next: FillState) => void;
}) {
  const options: { value: FillState; label: string }[] = [
    { value: "all",    label: "Все позиции" },
    { value: "filled", label: "Только заполненные" },
    { value: "empty",  label: "Только пустые" },
  ];
  return (
    <div className="space-y-0.5 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">{option.label}</span>
          {value === option.value ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}
