/* eslint-disable @next/next/no-img-element */
"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Loader2,
  Plus,
  Search as SearchIcon,
  Trash2,
  WifiOff,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TableControls, TableControlPin } from "@/components/shared/table";
import { cn } from "@/lib/utils";
import { markInventoryDraftStarted, submitInventoryDocumentDraft } from "@/app/(dashboard)/inventory/_actions/draft";
import { isInventoryFormLocked } from "@/lib/inventory/act-status";

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
          ? "border-rose-300 bg-rose-500/5 dark:border-rose-500/40 dark:bg-rose-500/10"
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
          <span className="text-xs text-muted-foreground">нет фото</span>
        </div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 break-words text-sm font-medium">{item.productName}</div>
          {needsRecount ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              <AlertTriangle className="h-3 w-3" />
              Пересчёт
            </span>
          ) : null}
        </div>
        {item.groupPath ? (
          <div className="mt-1 truncate text-xs text-muted-foreground">{item.groupPath}</div>
        ) : null}
        {needsRecount && item.recountNote ? (
          <div className="mt-1 text-[11px] italic text-rose-700 dark:text-rose-300">
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
}: {
  document: EditorDocument;
  groups: EditorGroup[];
  items: EditorItem[];
}) {
  const router = useRouter();
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
    if (!loaded) return;
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
  }, [document, draftKey, items, loaded, values]);

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
  const hasSearch = searchQuery.trim().length > 0;
  const hasAnyActive = hasActiveFilters || hasSortActive || hasSearch;
  // search-пин показываем только когда уже видны другие pin-row контролы —
  // 1-в-1 эталон documents-table.tsx.
  const showSearchPin = hasSearch && (filtersVisible || hasSortActive || hasActiveFilters);

  const selectedGroupPath = useMemo(
    () => groups.find((group) => group.id === selectedGroupId)?.path ?? null,
    [groups, selectedGroupId],
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
      toast.error("Нет соединения. Черновик сохранен на устройстве.");
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

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-3 py-3 md:px-6 md:py-5">
      {/* Баннер режима «пересчёт»: акт вернули, исполнитель видит подсказку
          какие именно строки требуют повторного счёта. */}
      {isRecountPending ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-rose-300 bg-rose-500/5 px-4 py-3 dark:border-rose-500/40 dark:bg-rose-500/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-300" />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-rose-700 dark:text-rose-200">
              Акт вернули на пересчёт
            </div>
            <p className="mt-0.5 text-rose-700/90 dark:text-rose-300/90">
              {flaggedItemsCount > 0
                ? `Перепроверьте отмеченные позиции (${flaggedItemsCount} ${flaggedItemsCount === 1 ? "строка" : "строк"}) и завершите акт.`
                : "Перепроверьте позиции и завершите акт."}
            </p>
          </div>
        </div>
      ) : null}

      {/* Баннер «заполнение закрыто»: акт ушёл на проверку / проведён /
          финализирован — форма только для чтения. */}
      {formLocked ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-sm">
            <div className="font-medium">Заполнение закрыто</div>
            <p className="mt-0.5 text-muted-foreground">
              Акт уже отправлен на проверку. Изменить факт нельзя — итоги
              ведёт проверяющий. Если нужно пересчитать позиции, проверяющий
              вернёт акт на пересчёт.
            </p>
          </div>
        </div>
      ) : null}

      {/* Закреплённая «шапка» формы: контролы + активные фильтры + прогресс
          остаются вверху при прокрутке длинного списка позиций. Скролл —
          оконный (форма не в overflow-контейнере), поэтому sticky top-0. */}
      <div className="sticky top-0 z-20 bg-background pt-3 pb-2">
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
            content: <SortFieldPanel sorts={sorts} onChange={setSorts} />,
          }}
        />
      </div>

      {/* Pin-row — порядок 1-в-1 с эталоном documents-table.tsx:
          Сортировка → divider → Фильтры (Группа) → divider → Поиск → «Очистить все». */}
      {/* Pin-row НЕ показываем, если активен только поиск (без фильтров/
          сортировки) — иначе торчит одинокая «Очистить все». */}
      {(filtersVisible || hasSortActive || hasActiveFilters || flaggedItemsCount > 0) ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {/* Тоггл «Только на пересчёт» — доступен, когда есть отмеченные
              строки (в первую очередь на пересчёте). Простой on/off-пин, без
              поповера. */}
          {flaggedItemsCount > 0 ? (
            <button
              type="button"
              onClick={() => setRecountOnly((v) => !v)}
              aria-pressed={recountOnly}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                recountOnly
                  ? "border-rose-300 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 dark:border-rose-500/40 dark:text-rose-300"
                  : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Только на пересчёт
            </button>
          ) : null}

          {flaggedItemsCount > 0 && (hasSortActive || filtersVisible || showSearchPin) ? <PinDivider /> : null}

          {hasSortActive ? (
            <TableControlPin
              active
              icon={
                sorts.length === 1
                  ? formSortToDirection(sorts[0]) === "asc"
                    ? <ArrowUp className="h-3.5 w-3.5" />
                    : <ArrowDown className="h-3.5 w-3.5" />
                  : <ArrowUpDown className="h-3.5 w-3.5" />
              }
              label={
                sorts.length === 1
                  ? FORM_SORT_FIELD_LABEL[formSortToField(sorts[0])]
                  : `${sorts.length} сортировки`
              }
              onClear={() => setSorts([])}
              clearLabel="Сбросить сортировку"
              contentClassName="w-auto p-3"
            >
              <SortPinEditor sorts={sorts} onChange={setSorts} />
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

      {/* Прогресс заполнения — пока акт ещё заполняется (форма не залочена). */}
      {!formLocked && totalCount > 0 ? (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Заполнено {filledCount} из {totalCount}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      ) : null}
      </div>
      {/* /закреплённая шапка формы */}

      <div className="space-y-2">
        {visibleItems.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            По текущему поиску и группе позиций нет.
          </div>
        ) : visibleItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            value={values[item.id] ?? ""}
            // На пересчёте редактируем только отмеченные строки; остальные
            // read-only (исполнитель не трогает то, что не просили считать).
            disabled={formLocked || (isRecountPending && !item.needsRecount)}
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

      {/* Submit-кнопка — паттерн detail-страницы из spec §«Entity detail page»:
          форма-действие живёт в футере формы, правым выравниванием, default
          Button (не full-width, не sticky). Эталон — /people/staff/[userId].
          На recount_pending — text меняется на «Завершить пересчёт». */}
      <div className="mt-6 flex justify-end pt-1">
        {formLocked ? (
          <p className="text-sm text-muted-foreground">
            Заполнение закрыто — акт на проверке.
          </p>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    disabled={isPending || !loaded || hasUnfilled}
                    onClick={submit}
                  >
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {isRecountPending ? "Завершить пересчёт" : "Завершить"}
                  </Button>
                </span>
              </TooltipTrigger>
              {hasUnfilled ? (
                <TooltipContent>
                  Заполните все строки: осталось {unfilledCount}
                </TooltipContent>
              ) : null}
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

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

// ─── Sub-components ──────────────────────────────────────────────────────────

function PinDivider() {
  return <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
}

/**
 * Popover из шапки таблицы (TableControls.sort.content). Эталон 1-в-1 с
 * SortFieldPanel из documents-table.tsx: title «СОРТИРОВКА», список полей,
 * клик на свободном — APPEND с asc, уже добавленные показывают «Добавлено»
 * и disabled-стиль.
 */
function SortFieldPanel({
  sorts,
  onChange,
}: {
  sorts: FormSortMode[];
  onChange: (next: FormSortMode[]) => void;
}) {
  const usedFields = new Set(sorts.map((mode) => formSortToField(mode)));
  return (
    <div className="space-y-3">
      <p className="px-3 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      <div className="space-y-1">
        {FORM_SORT_FIELDS.map((field) => {
          const used = usedFields.has(field);
          return (
            <button
              key={field}
              type="button"
              onClick={() => {
                if (used) return;
                onChange([...sorts, combineFormSort(field, "asc")]);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
                used ? "bg-accent text-muted-foreground" : null,
              )}
            >
              <span>{FORM_SORT_FIELD_LABEL[field]}</span>
              {used ? <span className="text-xs">Добавлено</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Контент пина активной сортировки. Эталон 1-в-1 с SortPinEditor из
 * documents-table.tsx: каждая сортировка — строка с field-Select +
 * direction-Select (↑/↓) + крестик. Кнопки: «+ Добавить сортировку»
 * (раскрывает список неиспользованных полей) и «🗑 Удалить сортировку»
 * (очищает всё).
 */
function SortPinEditor({
  sorts,
  onChange,
}: {
  sorts: FormSortMode[];
  onChange: (next: FormSortMode[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);

  const unusedFields = FORM_SORT_FIELDS.filter(
    (field) => !sorts.some((mode) => formSortToField(mode) === field),
  );

  const updateAt = (index: number, next: FormSortMode) => {
    onChange(sorts.map((mode, i) => (i === index ? next : mode)));
  };

  const replaceField = (index: number, field: FormSortField) => {
    const currentDirection = formSortToDirection(sorts[index]);
    updateAt(index, combineFormSort(field, currentDirection));
  };

  const removeAt = (index: number) => {
    onChange(sorts.filter((_, i) => i !== index));
  };

  return (
    <div className="w-[min(420px,calc(100vw-3rem))] space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>

      <div className="space-y-2">
        {sorts.map((mode, index) => {
          const field = formSortToField(mode);
          const direction = formSortToDirection(mode);
          return (
            <div key={`${field}-${index}`} className="grid grid-cols-[1fr_72px_32px] items-center gap-2">
              <Select
                value={field}
                onValueChange={(value) => replaceField(index, value as FormSortField)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORM_SORT_FIELDS.map((option) => {
                    const disabled = sorts.some(
                      (other, otherIndex) => otherIndex !== index && formSortToField(other) === option,
                    );
                    return (
                      <SelectItem key={option} value={option} disabled={disabled}>
                        {FORM_SORT_FIELD_LABEL[option]}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              <Select
                value={direction}
                onValueChange={(value) =>
                  updateAt(index, combineFormSort(field, value as "asc" | "desc"))
                }
              >
                <SelectTrigger
                  className="h-9 w-[72px] justify-center gap-1 px-2"
                  aria-label={direction === "asc" ? "По возрастанию" : "По убыванию"}
                >
                  {direction === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">
                    <span className="inline-flex items-center gap-2">
                      <ArrowUp className="h-3.5 w-3.5" /> По возрастанию
                    </span>
                  </SelectItem>
                  <SelectItem value="desc">
                    <span className="inline-flex items-center gap-2">
                      <ArrowDown className="h-3.5 w-3.5" /> По убыванию
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => removeAt(index)}
                aria-label="Удалить сортировку"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>

      {showAdd && unusedFields.length > 0 ? (
        <div className="rounded-lg border bg-background p-2">
          {unusedFields.map((field) => (
            <button
              key={field}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange([...sorts, combineFormSort(field, "asc")]);
                setShowAdd(false);
              }}
            >
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              {FORM_SORT_FIELD_LABEL[field]}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-1 border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          disabled={unusedFields.length === 0}
          onClick={() => setShowAdd((current) => !current)}
        >
          <Plus className="h-4 w-4" />
          Добавить сортировку
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
          onClick={() => onChange([])}
        >
          <Trash2 className="h-4 w-4" />
          Удалить сортировку
        </Button>
      </div>
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
