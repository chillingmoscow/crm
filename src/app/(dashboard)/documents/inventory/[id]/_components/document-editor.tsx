/* eslint-disable @next/next/no-img-element */
"use client";

import { submitInventoryBatches } from "@/lib/inventory/submit-batches";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Eye,
  Loader2,
  Lock,
  PackageOpen,
  SearchX,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  TableConditions,
  TableControls,
  TableFilterChip,
  TableSortPicker,
} from "@/components/shared/table";
import { formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import { markInventoryDraftStarted, submitInventoryDocumentDraft } from "@/app/(dashboard)/inventory/_actions/draft";
import { isInventoryFormLocked } from "@/lib/inventory/act-status";
import {
  canAdoptLegacyDraft,
  inventoryDraftKey,
  legacyInventoryDraftKey,
} from "@/lib/inventory/draft-key";

type EditorDocument = {
  id: string;
  documentNumber: string;
  storeTitle: string | null;
  status: string;
  /** Акт проведён в QR. Используется в stale-draft логике (synced_at). */
  processed: boolean;
  /** Можно ли использовать QR-`actualAmount` как fallback при prefill формы.
      true для актов, которые уже считали (ready_for_review / recount_pending /
      processed и т.п.) — там actual_amount = реальные числа исполнителя
      (их и должен видеть проверяющий, без округления). false для свежего
      черновика первого счёта (synced / assigned / in_progress без возвратов) —
      там actual_amount = QR-нули, подставлять нельзя. Считается на сервере. */
  prefillFromActual: boolean;
  baseLastUpdateDate: string | null;
  /** ISO timestamp последней QR-синхронизации акта. Используется в
      hydration: draft до sync — игнорируем (старый, sync свежее);
      draft после sync — restore (легитимные правки user'а). */
  syncedAt: string | null;
  /** ISO timestamp последнего возврата акта на пересчёт. Используется в
      hydration аналогично syncedAt: draft, сохранённый ДО возврата, не
      должен перезатирать значения, которые менеджер уже видел. */
  lastReturnedAt: string | null;
  recountCount: number;
  /** Исполнитель акта: только ему достаётся черновик со старого общего ключа. */
  assignedTo: string | null;
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
  needsRecount: boolean;
  recountNote: string | null;
};

type EditorGroup = {
  id: string;
  name: string;
  parentGroupId: string | null;
  depth: number;
  path: string;
};

/**
 * Черновик в IndexedDB. Только то, что реально читается при восстановлении.
 *
 * Раньше сюда клался ещё и весь акт — `document` и все `items` вместе с
 * подписанными ссылками на картинки. Это ~150-200 КБ структурированного клона,
 * и записывались они заново при каждом срабатывании автосейва: при вводе
 * «посмотрел на полку → ввёл число» паузы длиннее дебаунса, то есть на
 * практике полная сериализация акта на каждую введённую позицию. Читались при
 * этом всегда ровно два поля (см. восстановление ниже).
 */
type DraftPayload = {
  values: Record<string, string>;
  savedAt: string;
};

const DB_NAME = "sheerly-inventory-drafts";
const STORE_NAME = "drafts";
// Multi-sort 1-в-1 с эталоном documents-table.tsx: поле + направление в
// одном combined-значении, sorts хранится массивом (порядок = приоритет).
// Дефолт = пустой массив (порядок QR).
type FormSortField = "name" | "group" | "empty";
type FormSortMode =
  | "name_asc"  | "name_desc"
  | "group_asc" | "group_desc"
  | "empty_first" | "empty_last";

const FORM_SORT_FIELDS: FormSortField[] = ["name", "group", "empty"];

const FORM_SORT_FIELD_LABEL: Record<FormSortField, string> = {
  name:  "Название",
  group: "Группа",
  empty: "Заполненность",
};

function formSortToField(mode: FormSortMode): FormSortField {
  if (mode === "name_asc"  || mode === "name_desc")  return "name";
  if (mode === "group_asc" || mode === "group_desc") return "group";
  return "empty";
}

function formSortToDirection(mode: FormSortMode): "asc" | "desc" {
  if (mode === "empty_first") return "asc";
  if (mode === "empty_last")  return "desc";
  return mode.endsWith("_asc") ? "asc" : "desc";
}

function combineFormSort(field: FormSortField, direction: "asc" | "desc"): FormSortMode {
  if (field === "name")  return direction === "asc" ? "name_asc"  : "name_desc";
  if (field === "group") return direction === "asc" ? "group_asc" : "group_desc";
  return direction === "asc" ? "empty_first" : "empty_last";
}

// Ряд условий (TableConditions / TableSortPicker) говорит на языке TanStack
// `SortingState` — `{ id, desc }[]`. Форма хранит режимы (`name_asc`,
// `empty_first`, …): переходники держат обе формы в соответствии, порядок
// элементов = приоритет, «пустые сверху» = asc.
type FormSortingEntry = { id: string; desc: boolean };

function formSortsToSorting(sorts: readonly FormSortMode[]): FormSortingEntry[] {
  return sorts.map((mode) => ({
    id: formSortToField(mode),
    desc: formSortToDirection(mode) === "desc",
  }));
}

function sortingToFormSorts(sorting: readonly FormSortingEntry[]): FormSortMode[] {
  const seen = new Set<FormSortField>();
  const next: FormSortMode[] = [];
  for (const entry of sorting) {
    const field = entry.id as FormSortField;
    if (!FORM_SORT_FIELDS.includes(field) || seen.has(field)) continue;
    seen.add(field);
    next.push(combineFormSort(field, entry.desc ? "desc" : "asc"));
  }
  return next;
}

// «Черновик сохранён в 14:05» — без секунд. Черновик из IndexedDB может быть
// и вчерашним: тогда с датой («16 ноября, 14:05»).
const draftTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatDraftSavedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? `Черновик сохранён в ${draftTimeFormat.format(date)}`
    : `Черновик сохранён ${formatDayMonthTime(date)}`;
}

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
const FILL_STATE_OPTIONS = (Object.keys(FILL_STATE_LABEL) as FillState[]).map((state) => ({
  // «Все позиции» = пустое значение чипа: фильтр не выбран.
  value: state === DEFAULT_FILL_STATE ? "" : state,
  label: FILL_STATE_LABEL[state],
}));

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

// Начальное значение поля акта. Приоритет — submittedAmount (подсчёт в нашем
// CRM). Fallback на QR-`actualAmount` — только когда prefillFromActual=true
// (акт уже считали: review / recount / проведён). Для свежего черновика
// первого счёта fallback подавлен — иначе QR-нули делают форму «100%
// заполненной». При проверке/пересчёте это даёт исполнителю/проверяющему
// увидеть реально введённые числа (без округления, через String()).
function editorInitialValue(
  item: Pick<EditorItem, "submittedAmount" | "actualAmount" | "needsRecount">,
  prefillFromActual: boolean,
  recountMode: boolean,
) {
  // В режиме пересчёта отмеченные строки НЕ предзаполняем: их и вернули
  // потому, что числу не поверили. С предзаполнением «Завершить пересчёт»
  // проходило одним кликом по старым значениям, а в итогах это выглядело как
  // «было 3 → стало 3» — неотличимо от честного пересчёта, при котором
  // значение подтвердилось.
  if (recountMode && item.needsRecount) return "";
  return toInputValue(item.submittedAmount ?? (prefillFromActual ? item.actualAmount : null));
}

function parseAmount(value: string) {
  if (!value.trim()) return null;
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  // Факт — физический остаток, не может быть отрицательным. Невалидное
  // число (например «1.2.3» → NaN) и минус → null = «не заполнено».
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

// Санитайзер ввода факта: только цифры и один десятичный разделитель,
// без знака. Не даёт оставить в поле «1.2.3» / «--5» / «5-» — иначе
// ячейка выглядела бы заполненной, а parseAmount возвращал бы null,
// и сервер резал бы весь батч generic-ошибкой.
function sanitizeAmountInput(raw: string) {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const firstSep = cleaned.search(/[.,]/);
  if (firstSep === -1) return cleaned;
  return cleaned.slice(0, firstSep + 1) + cleaned.slice(firstSep + 1).replace(/[.,]/g, "");
}

/**
 * Строка позиции акта.
 *
 * Вынесена в отдельный memo-компонент не ради чистоты файла. `values` — один
 * объект на всю форму, и `setValues` менял его identity на каждый введённый
 * символ: перерисовывался весь список. На акте в триста позиций это порядка
 * трёх тысяч узлов на реконсиляцию, триста вызовов `cn()` на обёртках строк и
 * ещё триста внутри `Input` (там `tailwind-merge`) — и всё это на одно нажатие
 * клавиши.
 *
 * Строка получает только своё значение и стабильные колбэки, поэтому
 * перерисовывается ровно та, в которой печатают. Колбэки обязаны оставаться
 * стабильными (см. `handleValueChange` и соседей) — иначе memo бесполезен.
 */
const ItemRow = memo(function ItemRow({
  item,
  value,
  disabled,
  needsRecount,
  onValueChange,
  onBlur,
  onPreview,
}: {
  item: EditorItem;
  value: string;
  disabled: boolean;
  needsRecount: boolean;
  onValueChange: (itemId: string, next: string) => void;
  onBlur: () => void;
  onPreview: (url: string, name: string) => void;
}) {
  const isFilled = value.trim() !== "";
  const imageUrl = item.imageUrl;
  return (
    <div
      // Подсветка «на пересчёт» приоритетнее «заполненной»: строка, которую
      // вернули, должна оставаться заметной и после того, как в неё ввели
      // новое число.
      className={cn(
        "grid grid-cols-[64px_1fr_auto] items-center gap-3 rounded-lg border p-2 transition-colors",
        needsRecount
          ? "border-destructive/30 bg-destructive/5"
          : isFilled
            ? "border-brand/30 bg-brand/5 dark:border-brand/40 dark:bg-brand/10"
            : "border-border bg-background",
      )}
    >
      {imageUrl ? (
        <button
          type="button"
          onClick={() => onPreview(imageUrl, item.productName)}
          className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-muted transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Открыть фото: ${item.productName}`}
        >
          <img
            src={imageUrl}
            alt={item.productName}
            // Акт бывает на 300 позиций, и без lazy браузер ставил в
            // очередь 300 запросов к storage сразу после прихода HTML —
            // форма «открывалась долго» уже после ответа сервера.
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
          <span className="text-xs text-muted-foreground">Нет фото</span>
        </div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 break-words text-sm font-medium">{item.productName}</div>
          {needsRecount ? (
            <StatusBadge tone="danger" icon={<AlertTriangle />}>
              Пересчёт
            </StatusBadge>
          ) : null}
        </div>
        {item.groupPath ? (
          <div className="mt-1 truncate text-xs text-muted-foreground">{item.groupPath}</div>
        ) : null}
        {needsRecount && item.recountNote ? (
          <div className="mt-1 text-xs italic text-destructive">
            «{item.recountNote}»
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Input
          inputMode="decimal"
          disabled={disabled}
          value={value}
          onChange={(event) => onValueChange(item.id, sanitizeAmountInput(event.target.value))}
          onBlur={onBlur}
          aria-label={`Факт: ${item.productName}`}
          className="w-20 text-right"
        />
        {/* Фикс-слот единицы измерения — чтобы поля ввода были на одной
            вертикали независимо от длины «шт»/«л»/«кг». */}
        <span className="w-8 shrink-0 text-xs text-muted-foreground">{item.measureUnitName ?? ""}</span>
      </div>
    </div>
  );
});

export function InventoryDocumentEditor({
  document,
  groups,
  items,
  canFill,
  currentUserId,
  creation = null,
}: {
  document: EditorDocument;
  groups: EditorGroup[];
  items: EditorItem[];
  /** Чей черновик на этом устройстве читать и писать (см. draftKey). */
  currentUserId: string;
  /** Может ли текущий пользователь заполнять акт: управляющий актами или
      назначенный исполнитель (та же проверка, что у отправки). Иначе форма
      только для чтения, а черновик на устройстве не читается и не пишется. */
  canFill: boolean;
  /** Позиции ещё досылаются в фоне (акт создан из Sheerly): форма закрыта,
      страница перечитывается, пока задание не закончится. */
  creation?: { done: number; total: number } | null;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!creation) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [creation, router]);
  // Акт вернули на пересчёт: отмеченные строки перезаполняются с нуля, и
  // отправляются в Quick Resto тоже только они (см. submit).
  const isRecountPending = document.status === "recount_pending";
  // Initial value поля — см. editorInitialValue: submittedAmount (подсчёт в
  // CRM), а QR-`actualAmount` как fallback только для проведённого акта.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        editorInitialValue(item, document.prefillFromActual, isRecountPending),
      ])
    )
  );
  // Последние значения для колбэков, которые не должны зависеть от `values`.
  // Зависели бы — их identity менялась бы на каждый символ, memo строк
  // обнулялся бы, и весь смысл выделения строки в компонент пропал бы.
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  // Просмотр фото ингредиента в попапе (удобно на мобильном).
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [fillState, setFillState] = useState<FillState>(DEFAULT_FILL_STATE);
  // «Только на пересчёт»: фильтр показывает лишь позиции с needsRecount. По
  // умолчанию включён, когда акт вернули на пересчёт и есть отмеченные строки —
  // исполнитель сразу видит, что перепроверять (остальные в этом режиме
  // редактировать нельзя, см. disabled у поля ввода ниже).
  const [recountOnly, setRecountOnly] = useState(
    () => isRecountPending && items.some((it) => it.needsRecount),
  );
  // После submit'а вызывается router.refresh(): props обновляются без
  // ремаунта. Если пересчёт сбросил все needsRecount-флаги — выключаем фильтр,
  // иначе список остался бы отфильтрован по устаревшему условию и выглядел бы
  // пустым, пока юзер не нажмёт «Очистить все» (Codex P2).
  useEffect(() => {
    if (recountOnly && !items.some((it) => it.needsRecount)) {
      setRecountOnly(false);
    }
  }, [items, recountOnly]);
  // sorts: пустой массив = «Порядок QR» (исходный). Каждый элемент = combined
  // field+direction. Применяется по приоритету (первый — основной ключ).
  const [sorts, setSorts] = useState<FormSortMode[]>([]);
  // По дефолту pin-row скрыт, кнопка «Фильтры» нейтральна. Поведение —
  // как у /documents/inventory (см. feedback_table_standardization_checklist).
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Guard: переводим акт в in_progress только один раз за сессию (на первом
  // непустом черновике). Ref, чтобы не перерендеривать и не зависеть от него
  // в effect-deps.
  const draftStartedRef = useRef(false);

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
        editorInitialValue(item, document.prefillFromActual, isRecountPending),
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
      // «Только на пересчёт» — лишь отмеченные строки.
      if (recountOnly && !item.needsRecount) return false;
      // Fill-state фильтр — по snapshot, как и сортировка по заполненности.
      //
      // На live-значениях он съедал ввод: в режиме «Только пустые» первая же
      // цифра делала строку заполненной, строка мгновенно выпадала из выборки,
      // input размонтировался и терял фокус. Из «125» в акт уходило «1» — и
      // расхождение по позиции возникало на ровном месте, а сама строка в
      // «Только пустые» больше не показывалась. Snapshot обновляется на blur и
      // при смене фильтра, поэтому строка покидает выборку после того, как
      // исполнитель вышел из поля.
      if (fillState !== "all") {
        const isFilled = (sortValuesSnapshot[item.id] ?? "").trim() !== "";
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
      // Применяем сорты по приоритету. Tiebreaker — порядок QR (исходный).
      for (const mode of sorts) {
        const field = formSortToField(mode);
        const dir = formSortToDirection(mode);
        let cmp = 0;
        if (field === "name") {
          cmp = left.productName.localeCompare(right.productName, "ru");
        } else if (field === "group") {
          cmp = (left.groupPath ?? "—").localeCompare(right.groupPath ?? "—", "ru");
        } else {
          // «empty»: пустые сверху (asc) / снизу (desc). Используем snapshot,
          // не live values — иначе на каждый keystroke в active input строка
          // перепрыгивала бы.
          const leftEmpty  = (sortValuesSnapshot[left.id]  ?? "").trim() === "";
          const rightEmpty = (sortValuesSnapshot[right.id] ?? "").trim() === "";
          if (leftEmpty !== rightEmpty) cmp = leftEmpty ? -1 : 1;
        }
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return (itemOrderById.get(left.id) ?? 0) - (itemOrderById.get(right.id) ?? 0);
    });
    // values в зависимостях больше нет: и фильтр, и сортировка по
    // заполненности читают snapshot. Заодно список из 300 строк перестал
    // пересобираться на каждый введённый символ.
  }, [fillState, itemOrderById, items, recountOnly, searchQuery, selectedGroupIds, sorts, sortValuesSnapshot]);

  // Snapshot обслуживает и сортировку по заполненности, и фильтр «Только
  // пустые/заполненные»: оба перестраивают список и не должны делать это на
  // каждый введённый символ. При включении сортировки или смене фильтра
  // синхронизируем snapshot с текущими значениями.
  useEffect(() => {
    const hasEmptySort = sorts.some((mode) => formSortToField(mode) === "empty");
    if (hasEmptySort || fillState !== DEFAULT_FILL_STATE) {
      setSortValuesSnapshot({ ...values });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorts, fillState]);

  // Черновик — свой у каждого человека: на общем планшете новый исполнитель
  // раньше открывал акт с числами предыдущего (ключ был один на акт).
  const draftKey = useMemo(
    () => inventoryDraftKey(document.id, currentUserId),
    [document.id, currentUserId]
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
    // Тот, кто заполнять не может, черновик не трогает: ни своих значений,
    // ни чужих (если на устройстве считали этот акт) ему не показываем.
    if (!canFill) {
      setLoaded(true);
      return;
    }
    let alive = true;
    void (async () => {
      let draft = await readDraft(draftKey);
      // Переезд со старого ключа (один черновик на акт). Забираем его только
      // исполнителю акта — почти наверняка это он и вводил числа; любой
      // другой (проверяющий, управляющий, новый исполнитель) старый черновик
      // не видит. Переносим под свой ключ и удаляем старый, дальше черновик
      // проходит ту же проверку на устаревание, что и обычный.
      if (canAdoptLegacyDraft({ assignedTo: document.assignedTo, userId: currentUserId })) {
        const legacyKey = legacyInventoryDraftKey(document.id);
        const legacy = await readDraft(legacyKey);
        if (legacy) {
          if (!draft) {
            await writeDraft(draftKey, legacy);
            draft = legacy;
          }
          await deleteDraft(legacyKey);
        }
      }
      if (!alive) return;
      if (draft?.values) {
        // Игнорируем draft если он СТАРШЕ последнего QR-sync — но ТОЛЬКО для
        // проведённого акта (processed). Логика:
        //  - Проведённый акт: QR-значения авторитетны, prefill идёт из
        //    actualAmount. Stale-draft (закрывает bug #390): старая сессия
        //    открыла акт когда actual_amount=NULL, autosave записал пустой
        //    draft; потом QR-sync заполнил actual_amount; draft.savedAt <
        //    syncedAt отсеивает перезатирание prefill пустотой. Codex P2 #390:
        //    легитимная очистка user'ом после sync (savedAt > syncedAt) —
        //    restore работает.
        //  - Непроведённый акт: подсчёт ведётся в CRM, «Синхронизировать» не
        //    должна трогать подсчёт. QR-нули в форму не подставляются, поэтому
        //    sync (bump synced_at) НЕ делает локальный черновик stale — иначе
        //    full-sync менеджера обнулял бы незавершённую работу исполнителя.
        // Если syncedAt отсутствует (старые акты до миграции 194 / тестовые
        // случаи) — fallback на restore (легитимный draft user'а
        // приоритетнее пустого начального state).
        const draftSavedMs = Date.parse(draft.savedAt);
        const syncedMs =
          document.processed && document.syncedAt ? Date.parse(document.syncedAt) : NaN;
        // last_returned_at работает по той же логике, что и syncedAt, и
        // применяется независимо от processed: draft, сохранённый ДО возврата
        // на пересчёт, не должен перезатирать значения, которые сервер вернул
        // после `returnDocumentForRecount`.
        const returnedMs = document.lastReturnedAt
          ? Date.parse(document.lastReturnedAt)
          : NaN;
        const draftIsStale =
          Number.isFinite(draftSavedMs) &&
          ((Number.isFinite(syncedMs) && draftSavedMs < syncedMs) ||
            (Number.isFinite(returnedMs) && draftSavedMs < returnedMs));
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
    if (!loaded || !canFill) return;
    const timeout = window.setTimeout(() => {
      const nextSavedAt = new Date().toISOString();
      void writeDraft(draftKey, { values, savedAt: nextSavedAt });
      setSavedAt(nextSavedAt);

      // Мост assigned/synced → in_progress: первый непустой черновик
      // означает «исполнитель начал заполнять». Серверного сигнала о
      // черновике нет (он в IndexedDB), поэтому дёргаем action один раз.
      // best-effort: статус подтянется realtime'ом списка / при навигации.
      if (
        !draftStartedRef.current
        && (document.status === "assigned" || document.status === "synced")
        && Object.values(values).some((v) => v.trim() !== "")
      ) {
        draftStartedRef.current = true;
        void markInventoryDraftStarted({ documentId: document.id });
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [canFill, document, draftKey, items, loaded, values]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // Сверяем с начальными значениями в момент ухода со страницы. Раньше
      // `values` был в зависимостях эффекта: каждое нажатие клавиши прогоняло
      // `items.some(...)` по тремстам строкам и заново переподписывало
      // слушатель окна.
      const hasChanges = items.some(
        (item) =>
          valuesRef.current[item.id]
            !== editorInitialValue(item, document.prefillFromActual, isRecountPending),
      );
      if (!hasChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [items, document.prefillFromActual, isRecountPending]);

  // ── Controls state-derivatives ────────────────────────────
  const hasGroupFilter = Boolean(selectedGroupId);
  const hasFillFilter = fillState !== DEFAULT_FILL_STATE;
  const hasRecountFilter = recountOnly;
  const hasActiveFilters = hasGroupFilter || hasFillFilter || hasRecountFilter;
  const hasSortActive = sorts.length > 0;
  // Ряд условий — общий TableConditions: ему нужна TanStack-форма сортировки.
  const sorting = useMemo(() => formSortsToSorting(sorts), [sorts]);
  const changeSorting = useCallback(
    (next: FormSortingEntry[]) => setSorts(sortingToFormSorts(next)),
    [],
  );
  const groupOptions = useMemo(
    () => [
      { value: "", label: "Все группы акта" },
      ...groups.map((group) => ({ value: group.id, label: group.path })),
    ],
    [groups],
  );

  // В режиме пересчёта исполнитель работает ТОЛЬКО с отмеченными строками:
  // они же уходят в Quick Resto. Раньше submit пушил весь акт — на 300
  // позициях это 300 запросов к backoffice вместо четырёх, и остальные строки
  // без нужды перезаписывались теми же числами.
  const flaggedItemsCount = useMemo(
    () => items.filter((item) => item.needsRecount).length,
    [items],
  );
  const submittableItems = useMemo(
    () =>
      isRecountPending && flaggedItemsCount > 0
        ? items.filter((item) => item.needsRecount)
        : items,
    [flaggedItemsCount, isRecountPending, items],
  );

  // Колбэки строки — стабильные, иначе memo не спасёт: новая identity
  // обработчика меняет props у всех трёхсот строк разом.
  const handleValueChange = useCallback((itemId: string, next: string) => {
    setValues((prev) => ({ ...prev, [itemId]: next }));
  }, []);

  const handlePreviewImage = useCallback((url: string, name: string) => {
    setPreviewImage({ url, name });
  }, []);

  // Перестановка и скрытие строк случаются ТОЛЬКО при потере фокуса, не во
  // время ввода: и сортировка по заполненности, и фильтр «Только пустые»
  // читают snapshot.
  const handleValueBlur = useCallback(() => {
    if (
      fillState !== DEFAULT_FILL_STATE ||
      sorts.some((mode) => formSortToField(mode) === "empty")
    ) {
      setSortValuesSnapshot({ ...valuesRef.current });
    }
  }, [fillState, sorts]);

  const onClearAll = useCallback(() => {
    setSearchQuery("");
    setSearchOpen(false);
    setSelectedGroupId("");
    setFillState(DEFAULT_FILL_STATE);
    setRecountOnly(false);
    setSorts([]);
  }, []);

  const submit = () => {
    if (!online) {
      toast.error("Нет соединения. Черновик сохранён на устройстве");
      return;
    }

    startTransition(async () => {
      const filledItems = submittableItems
        .map((item) => ({
          item,
          value: values[item.id] ?? "",
        }))
        // «Заполнено» = валидное неотрицательное число. Ячейка с одним
        // разделителем («.»/«,») считается пустой, не уходит на сервер.
        .filter(({ value }) => parseAmount(value) !== null);
      if (filledItems.length === 0) {
        toast.error(
          isRecountPending && flaggedItemsCount > 0
            ? "Заполните пересчитанные значения по отмеченным строкам"
            : "Заполните хотя бы одну позицию акта",
        );
        return;
      }

      const result = await submitInventoryBatches({
        documentId: document.id,
        baseLastUpdateDate: document.baseLastUpdateDate,
        items: filledItems.map(({ item, value }) => ({
          itemId: item.id,
          actualAmount: parseAmount(value),
        })),
      }, submitInventoryDocumentDraft);
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
        : "Акт отправлен, но Quick Resto не вернул итоги по строкам");
      router.refresh();
    });
  };

  // Форма только для чтения, когда акт ушёл на проверку / проведён /
  // финализирован (статусная машина — см. @/lib/inventory/act-status).
  // recount_pending сюда НЕ попадает: перерасчёт исполнителем легитимен.
  const formLocked = isInventoryFormLocked(document.status, false);
  // Прогресс и гейт «Завершить пересчёт» считаем по тем же строкам, что
  // уходят на сервер, — иначе «4 из 54» и кнопку не нажать, хотя пересчитать
  // нужно было только 4.
  const countableItems = submittableItems;
  // Прогресс заполнения — по live-значениям формы (черновик локальный, на
  // сервере его нет, поэтому считаем здесь). Показываем, пока акт заполняется.
  const filledCount = useMemo(
    () => countableItems.filter((item) => parseAmount(values[item.id] ?? "") !== null).length,
    [countableItems, values],
  );
  const totalCount = countableItems.length;
  const progressPct = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;
  // Завершать акт можно, только когда заполнены ВСЕ нужные строки (0 — тоже значение).
  const unfilledCount = totalCount - filledCount;
  const hasUnfilled = totalCount > 0 && unfilledCount > 0;

  // Форма только для чтения: акт ушёл дальше по статусу ИЛИ у человека нет
  // права заполнять этот акт (см. canFill).
  const readOnly = formLocked || !canFill;
  // Фильтр «Только на пересчёт» — только когда акт реально вернули на
  // пересчёт. На первом счёте needs_recount ставит триггер по расхождению с
  // Quick Resto ещё до подсчёта: фильтр по нему показал бы исполнителю, какие
  // строки расходятся с расчётным остатком (подсветку там тоже не показываем).
  const showRecountFilter = isRecountPending && flaggedItemsCount > 0;
  const draftLabel = savedAt ? formatDraftSavedAt(savedAt) : null;

  return (
    // Поля страницы даёт PageFrame в layout акта — своих отступов нет.
    // Колонка 720px — форма заполнения (DS «Ширина контента»).
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col">
      {/* Баннер режима «пересчёт»: акт вернули, исполнитель видит подсказку
          какие именно строки требуют повторного счёта. */}
      {isRecountPending ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">Акт вернули на пересчёт</div>
            <p className="mt-0.5">
              {flaggedItemsCount > 0
                ? `Перепроверьте отмеченные позиции (${countRu(flaggedItemsCount, "строка", "строки", "строк")}) и завершите акт.`
                : "Перепроверьте позиции и завершите акт."}
            </p>
          </div>
        </div>
      ) : null}

      {/* Баннер «заполнение закрыто»: акт ушёл на проверку / проведён /
          финализирован — форма только для чтения. */}
      {creation ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm" role="status">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand" />
          <div className="min-w-0">
            <div className="font-medium">
              Акт ещё создаётся: {creation.done} из {creation.total} позиций в Quick Resto
            </div>
            <p className="mt-0.5 text-muted-foreground">
              Позиции добавляются в фоне. Заполнять акт можно будет, когда добавятся все, — придёт
              уведомление.
            </p>
          </div>
        </div>
      ) : formLocked ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">Заполнение закрыто</div>
            <p className="mt-0.5 text-muted-foreground">
              Акт уже отправлен на проверку, изменить факт нельзя: итоги ведёт
              проверяющий. Если нужно пересчитать позиции, проверяющий вернёт
              акт на пересчёт.
            </p>
          </div>
        </div>
      ) : !canFill ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">Форма только для чтения</div>
            <p className="mt-0.5 text-muted-foreground">
              Заполнять акт могут исполнитель, проверяющий или управляющий актами.
              Чтобы внести данные, попросите назначить вас исполнителем или проверяющим.
            </p>
          </div>
        </div>
      ) : null}

      {/* Закреплённая «шапка» формы: контролы + активные фильтры + прогресс
          остаются вверху при прокрутке длинного списка позиций. Скролл —
          оконный (форма не в overflow-контейнере), поэтому sticky top-0. */}
      <div className="sticky top-0 z-20 bg-background pt-3 pb-2">
      {/* Шапка с номером, статусом и вкладками — в shared layout
          (inventory/[id]/layout.tsx). Здесь: слева — черновик / офлайн,
          справа — контролы. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {!online ? (
            <StatusBadge tone="warning" icon={<WifiOff />}>
              Офлайн
            </StatusBadge>
          ) : null}
          {draftLabel ? <span>{draftLabel}</span> : null}
        </div>

        <TableControls
          search={{
            value: searchQuery,
            onChange: setSearchQuery,
            open: searchOpen,
            onOpenChange: setSearchOpen,
            placeholder: "Название, артикул, штрих-код или группа",
          }}
          filters={{
            active: hasActiveFilters,
            label: filtersVisible ? "Скрыть фильтры" : "Показать фильтры",
            onClick: () => setFiltersVisible((v) => !v),
          }}
          sort={{
            active: hasSortActive,
            content: (
              <TableSortPicker
                sorting={sorting}
                onChange={changeSorting}
                fields={FORM_SORT_FIELDS}
                labels={FORM_SORT_FIELD_LABEL}
              />
            ),
          }}
        />
      </div>

      {/* Ряд условий — общий TableConditions (DS «List-страница»): правила
          видимости зашиты в нём, один поиск ряд не открывает. Выбранный
          фильтр виден и при свёрнутом ряде. */}
      <div className="mb-4 empty:hidden">
        <TableConditions
          label="Условия формы акта"
          open={filtersVisible}
          hasFilters={hasActiveFilters}
          sorting={sorting}
          onSortingChange={changeSorting}
          sortFields={FORM_SORT_FIELDS}
          sortLabels={FORM_SORT_FIELD_LABEL}
          search={searchQuery}
          onSearchClear={() => {
            setSearchQuery("");
            setSearchOpen(false);
          }}
          onReset={onClearAll}
        >
          {showRecountFilter && (filtersVisible || recountOnly) ? (
            <TableFilterChip
              label="Пересчёт"
              value={recountOnly ? "only" : ""}
              onChange={(value) => setRecountOnly(value === "only")}
              options={[
                { value: "", label: "Все позиции" },
                { value: "only", label: "Только на пересчёт" },
              ]}
            />
          ) : null}
          {filtersVisible || hasFillFilter ? (
            <TableFilterChip
              label="Заполненность"
              value={fillState === DEFAULT_FILL_STATE ? "" : fillState}
              onChange={(value) => setFillState((value || DEFAULT_FILL_STATE) as FillState)}
              options={FILL_STATE_OPTIONS}
            />
          ) : null}
          {groups.length > 0 && (filtersVisible || hasGroupFilter) ? (
            <TableFilterChip
              label="Группа"
              value={selectedGroupId}
              onChange={setSelectedGroupId}
              searchPlaceholder="Найти группу"
              options={groupOptions}
            />
          ) : null}
        </TableConditions>
      </div>

      {/* Прогресс заполнения — пока акт заполняется и его может заполнять
          этот человек (черновик локальный, у зрителя прогресса нет). */}
      {!readOnly && totalCount > 0 ? (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Заполнено {filledCount} из {totalCount}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500 ease-[var(--ease-soft)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      ) : null}
      </div>
      {/* /закреплённая шапка формы */}

      <div className="space-y-2">
        {visibleItems.length === 0 ? (
          items.length === 0 ? (
            <EmptyState icon={PackageOpen} title="В акте нет позиций" />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Позиций не найдено"
              description="Измените поиск или условия"
              action={
                <Button type="button" variant="outline" onClick={onClearAll}>
                  Сбросить поиск и фильтры
                </Button>
              }
            />
          )
        ) : visibleItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            value={values[item.id] ?? ""}
            // На пересчёте редактируем только отмеченные строки; остальные
            // read-only (исполнитель не трогает то, что не просили считать).
            disabled={readOnly || (isRecountPending && !item.needsRecount)}
            // Подсветку и бейдж «Пересчёт» показываем ТОЛЬКО когда акт реально
            // вернули на пересчёт (recount_pending) — тогда это «куда смотреть
            // в первую очередь». На первом счёте (Новый/Назначен/В работе)
            // авто-флаг needs_recount (триггер ставит его по расхождению с QR
            // ещё до подсчёта) — шум, его не показываем.
            needsRecount={isRecountPending && item.needsRecount}
            onValueChange={handleValueChange}
            onBlur={handleValueBlur}
            onPreview={handlePreviewImage}
          />
        ))}
      </div>

      {/* Действие формы — в футере, правым выравниванием, default Button.
          На recount_pending — «Завершить пересчёт». У закрытой формы и у
          того, кто заполнять не может, кнопки нет: причина — в плашке сверху. */}
      {!readOnly ? (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 pt-1">
          {hasUnfilled ? (
            // Причина неактивной кнопки — текстом рядом, а не только в
            // подсказке (DS «Кнопки»).
            <span className="text-sm text-muted-foreground">
              Осталось заполнить: {countRu(unfilledCount, "позиция", "позиции", "позиций")}
            </span>
          ) : null}
          <span
            className="inline-flex"
            data-tip={hasUnfilled ? `Заполните все строки: осталось ${unfilledCount}` : undefined}
          >
            <Button
              type="button"
              disabled={isPending || !loaded || hasUnfilled}
              onClick={submit}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isPending
                ? "Отправляем…"
                : isRecountPending
                  ? "Завершить пересчёт"
                  : "Завершить"}
            </Button>
          </span>
        </div>
      ) : null}

      <Dialog open={previewImage !== null} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate text-base">{previewImage?.name}</DialogTitle>
          </DialogHeader>
          {previewImage ? (
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
