/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CheckCircle2, Filter, Loader2, Search, SlidersHorizontal, WifiOff, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { submitInventoryDocumentDraft } from "../../../actions";

type EditorDocument = {
  id: string;
  documentNumber: string;
  storeTitle: string | null;
  status: string;
  baseLastUpdateDate: string | null;
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
const SORT_OPTIONS = [
  { value: "order", label: "Порядок QR" },
  { value: "name_asc", label: "Название А → Я" },
  { value: "name_desc", label: "Название Я → А" },
  { value: "empty_first", label: "Пустые сверху" },
  { value: "empty_last", label: "Пустые снизу" },
  { value: "group_asc", label: "Группа А → Я" },
  { value: "group_desc", label: "Группа Я → А" },
] as const;

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
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, toInputValue(item.submittedAmount)]))
  );
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [sortMode, setSortMode] = useState("order");
  const [isPending, startTransition] = useTransition();

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
        const leftEmpty = (values[left.id] ?? "").trim() === "";
        const rightEmpty = (values[right.id] ?? "").trim() === "";
        if (leftEmpty !== rightEmpty) {
          return sortMode === "empty_first"
            ? leftEmpty ? -1 : 1
            : leftEmpty ? 1 : -1;
        }
      }
      return (itemOrderById.get(left.id) ?? 0) - (itemOrderById.get(right.id) ?? 0);
    });
  }, [itemOrderById, items, searchQuery, selectedGroupIds, sortMode, values]);

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
        setValues((prev) => ({ ...prev, ...draft.values }));
        setSavedAt(draft.savedAt);
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
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
    const hasChanges = items.some((item) => values[item.id] !== toInputValue(item.submittedAmount));
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [items, values]);

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
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/inventory/documents">
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-2">Акты</span>
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link className="underline underline-offset-2" href={`/inventory/documents/${document.id}/results`}>
            Итоги
          </Link>
          {!online ? (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-amber-700">
              <WifiOff className="mr-1 h-3 w-3" />
              Оффлайн
            </span>
          ) : null}
          {savedAt ? <span>Черновик {new Date(savedAt).toLocaleTimeString("ru-RU")}</span> : null}
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-semibold">Акт № {document.documentNumber}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Склад: {document.storeTitle ?? "не указан"} · {visibleItems.length} из {items.length} позиций
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {searchOpen ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 md:max-w-xl">
            <Input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по названию, артикулу, штрих-коду"
              className="min-w-0"
            />
            <Button type="button" size="icon" variant="outline" aria-label="Скрыть поиск" onClick={() => {
              setSearchQuery("");
              setSearchOpen(false);
            }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button type="button" size="icon" variant="outline" aria-label="Поиск" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant={selectedGroupId ? "default" : "outline"}
              aria-label="Фильтры"
            >
              <Filter className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Фильтры
            </div>
            <label className="text-sm font-medium" htmlFor="document-group-filter">
              Группа ингредиентов
            </label>
            <select
              id="document-group-filter"
              value={selectedGroupId}
              onChange={(event) => setSelectedGroupId(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">Все группы акта</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {"\u00A0".repeat(Math.min(group.depth, 8) * 2)}
                  {group.path}
                </option>
              ))}
            </select>
            {selectedGroupId ? (
              <Button
                type="button"
                className="mt-3 w-full"
                variant="outline"
                onClick={() => setSelectedGroupId("")}
              >
                Сбросить фильтр
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="icon" variant={sortMode === "order" ? "outline" : "default"} aria-label="Сортировка">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Сортировка
            </div>
            <div className="space-y-1">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => setSortMode(option.value)}
                >
                  <span>{option.label}</span>
                  {sortMode === option.value ? <Check className="h-4 w-4" /> : null}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-2">
        {visibleItems.length === 0 ? (
          <div className="rounded-lg border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
            По текущему поиску и группе позиций нет.
          </div>
        ) : visibleItems.map((item) => (
          <div key={item.id} className="grid grid-cols-[64px_1fr_112px] items-center gap-3 rounded-lg border bg-background p-2">
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
              aria-label={`Факт: ${item.productName}`}
              className="text-right"
            />
          </div>
        ))}
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
