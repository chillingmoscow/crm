"use client";

/**
 * Демо для паттерна «Сохранённые виды/пресеты фильтров».
 *
 * История: эта механика была реализована в первой итерации
 * `/documents` (PR1), но по UX-обсуждению ушла из боевой страницы
 * туда, где ей место — в lab. Тут сохраняем её отдельно, чтобы
 * можно было переиспользовать на любой таблице в будущем без
 * перепридумывания.
 *
 * Ключевые отличия от первой попытки:
 * - **Табы, не пины.** Линейка табов всегда сверху таблицы, как в
 *   Linear/GitHub Projects, всегда в быстром доступе. Не прячется
 *   под кнопкой «Фильтры».
 * - **Active-tab подсвечивается брендовым акцентом.**
 * - **Built-in пресеты захардкожены**, custom — localStorage.
 * - Custom можно удалить.
 * - Кнопка «Сохранить вид» — справа от табов, появляется, когда
 *   текущая комбинация фильтров не совпадает с активным табом.
 *
 * Для интеграции в реальную страницу:
 * 1. Передаёшь текущий querystring (без `page`/`size`) → используется
 *    как сравнение с `view.query` для подсветки активного таба.
 * 2. Применение вида → `router.replace(pathname + ?query)`.
 * 3. Сохранение текущего → `URLSearchParams(searchParams)` минус
 *    page/size, имя через `prompt()` или модалку.
 */

import { useEffect, useMemo, useState } from "react";
import { Bookmark, BookmarkPlus, Inbox, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ViewPreset = {
  id: string;
  name: string;
  /** querystring snapshot, e.g. "status=assigned,in_progress&sort=date_desc" */
  query: string;
  builtin?: boolean;
};

type Props = {
  storageKey: string;
  builtinViews: ViewPreset[];
  /** Querystring текущего состояния таблицы (без page/size). */
  currentQuery: string;
  onApply: (view: ViewPreset) => void;
  onSaveCurrent: (name: string) => string; // returns id of created view
};

export function ViewPresetsTabs({
  storageKey,
  builtinViews,
  currentQuery,
  onApply,
  onSaveCurrent,
}: Props) {
  const [customViews, setCustomViews] = useState<ViewPreset[]>([]);

  // Hydrate from localStorage after mount (SSR-safe).
  useEffect(() => {
    setCustomViews(loadCustomViews(storageKey));
  }, [storageKey]);

  const allViews = useMemo(
    () => [...builtinViews, ...customViews],
    [builtinViews, customViews],
  );

  const activeView = useMemo(
    () => allViews.find((v) => normalizeQuery(v.query) === normalizeQuery(currentQuery)) ?? null,
    [allViews, currentQuery],
  );

  const handleSaveAs = () => {
    const name = window.prompt("Название представления");
    if (!name) return;
    const id = onSaveCurrent(name);
    const view: ViewPreset = { id, name, query: currentQuery };
    const next = [...customViews, view];
    setCustomViews(next);
    saveCustomViews(storageKey, next);
  };

  const handleDelete = (id: string) => {
    const next = customViews.filter((v) => v.id !== id);
    setCustomViews(next);
    saveCustomViews(storageKey, next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b pb-2">
      {allViews.map((view) => (
        <button
          key={view.id}
          type="button"
          onClick={() => onApply(view)}
          className={cn(
            "group inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
            activeView?.id === view.id
              ? "bg-brand/10 text-brand"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {view.builtin ? <Inbox className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          <span className="truncate max-w-[160px]">{view.name}</span>
          {!view.builtin ? (
            <button
              type="button"
              className="ml-1 text-muted-foreground/70 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Удалить «${view.name}»?`)) handleDelete(view.id);
              }}
              aria-label={`Удалить ${view.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </button>
      ))}

      {!activeView && currentQuery.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground"
          onClick={handleSaveAs}
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
          Сохранить вид
        </Button>
      ) : null}
    </div>
  );
}

function loadCustomViews(storageKey: string): ViewPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ViewPreset[];
    return Array.isArray(parsed) ? parsed.filter((v) => v && v.id && v.name) : [];
  } catch {
    return [];
  }
}

function saveCustomViews(storageKey: string, views: ViewPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(views));
}

function normalizeQuery(qs: string): string {
  const params = new URLSearchParams(qs);
  params.delete("page");
  params.delete("size");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

// ─── Sandbox demo wrapper ────────────────────────────────────────────────────

/**
 * Простая обёртка для table-lab tab'а. Имитирует «текущий querystring»
 * через локальный state. Для боевой страницы — заменить на чтение из
 * useSearchParams + router.replace.
 */
export function ViewPresetsDemo() {
  const [currentQuery, setCurrentQuery] = useState("");

  const builtin: ViewPreset[] = [
    { id: "inbox",     name: "Все",            query: "",                                  builtin: true },
    { id: "my",        name: "Мои назначения", query: "assigned=me",                       builtin: true },
    { id: "ready",     name: "Ждут проверки",  query: "status=ready_for_review",           builtin: true },
    { id: "processed", name: "Готовые",        query: "status=processed",                  builtin: true },
  ];

  let counter = 0;
  return (
    <div className="space-y-4">
      <ViewPresetsTabs
        storageKey="lab.view-presets-demo"
        builtinViews={builtin}
        currentQuery={currentQuery}
        onApply={(v) => setCurrentQuery(v.query)}
        onSaveCurrent={() => {
          counter += 1;
          return `custom-${Date.now()}-${counter}`;
        }}
      />

      <div className="rounded-lg border bg-muted/40 p-4 text-sm">
        <p className="mb-2 font-medium">Текущий querystring (имитация):</p>
        <code className="block break-all rounded bg-background px-2 py-1 text-xs">
          {currentQuery || "(пусто — все акты)"}
        </code>
        <p className="mt-3 text-xs text-muted-foreground">
          Поиграйся: нажми на «Мои назначения» — querystring сменится, активный таб подсветится.
          Введи свой querystring через DevTools (
          <code>localStorage.setItem(&apos;lab.view-presets-demo&apos;, ...)</code>) и обнови — кастомные
          табы появятся справа от built-in.
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <p className="font-medium">Произвольное querystring для теста:</p>
        <input
          type="text"
          value={currentQuery}
          onChange={(e) => setCurrentQuery(e.target.value)}
          placeholder="status=processed&sort=date_desc"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
