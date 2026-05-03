"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { searchKbPages } from "@/lib/knowledge/search";
import type { KbSearchHit } from "@/types/knowledge";

const DEBOUNCE_MS = 180;

// ─── Context — lets any client component anywhere under the layout
//     open the dialog (e.g. tree-header «Поиск» button). ────────────

type SearchCtx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const KbSearchContext = createContext<SearchCtx | null>(null);

export function useKbSearch(): SearchCtx {
  const ctx = useContext(KbSearchContext);
  if (!ctx) {
    throw new Error("useKbSearch must be used inside <KbSearchProvider>");
  }
  return ctx;
}

interface KbSearchProviderProps {
  children: ReactNode;
}

/**
 * Mounts the KB search dialog once at the layout level + hooks the
 * Cmd+K / Ctrl+K global shortcut. Children get access to `open()` /
 * `close()` via useKbSearch().
 *
 * Implementation notes:
 *  ─ Server-side filtering through `searchKbPages` (Postgres
 *    websearch_to_tsquery + ts_headline). cmdk's default client-side
 *    filter is disabled (shouldFilter prop on CommandDialog).
 *  ─ Snippet comes from ts_headline with <mark>…</mark> markers.
 *    We tokenize and render mark spans with React (no
 *    dangerouslySetInnerHTML; KB content is user-typed and could
 *    contain literal `<` `>` characters).
 *  ─ Debounce 180ms — snappy enough that typing feels live, but
 *    one query per word, not per keystroke.
 */
export function KbSearchProvider({ children }: KbSearchProviderProps) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  // Global Cmd+K / Ctrl+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<SearchCtx>(
    () => ({ open, close, isOpen }),
    [open, close, isOpen],
  );

  return (
    <KbSearchContext.Provider value={value}>
      {children}
      <KbSearchDialog open={isOpen} onOpenChange={setOpen} />
    </KbSearchContext.Provider>
  );
}

// ─── Dialog body ──────────────────────────────────────────────────────

interface KbSearchDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

function KbSearchDialog({ open, onOpenChange }: KbSearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KbSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  // Bumps every time the user types so we can ignore stale responses.
  const requestSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the dialog state every time it (re)opens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setLoading(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }, [open]);

  // Debounced server search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open) return;
    if (query.trim().length === 0) {
      setHits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const seq = ++requestSeqRef.current;
    debounceRef.current = setTimeout(async () => {
      const { hits: rows, error } = await searchKbPages(query, 20);
      // Drop stale responses — only the latest seq wins.
      if (seq !== requestSeqRef.current) return;
      setLoading(false);
      if (error) {
        setHits([]);
        return;
      }
      setHits(rows);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  const onSelect = (slug: string) => {
    onOpenChange(false);
    router.push(`/knowledge/${slug}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Дизайн по sheerly.pen → WFrIM:
          - 720px wide, rounded-[14px]
          - Search bar с padding 18/20, border-bottom, ⌘K kbd справа
          - Result rows с padding 10/20, hover/active fill-muted
          - Footer с подсказками (border-top, fill-muted)
          AI-quick row из дизайна намеренно опущен — фича ещё не
          реализована, рендерить статичный плейсхолдер было бы
          мисли и сбивало пользователя. */}
      <DialogContent
        className="max-w-[720px] p-0 gap-0 rounded-[14px] overflow-hidden shadow-xl
                   [&>button:last-child]:hidden top-[20%] translate-y-0"
      >
        {/* Radix requires a DialogTitle for a11y; hide it visually. */}
        <DialogTitle className="sr-only">Поиск по базе знаний</DialogTitle>
        <Command
          shouldFilter={false}
          className="bg-background [&_[cmdk-input-wrapper]]:border-0
                     [&_[cmdk-input]]:h-auto [&_[cmdk-input]]:py-0
                     [&_[cmdk-item]]:rounded-none"
        >
          {/* Search bar */}
          <div className="flex items-center gap-3 border-b px-5 py-[18px]" cmdk-input-wrapper="">
            <Search className="size-[18px] shrink-0 text-muted-foreground" />
            <CommandInput
              placeholder="Поиск по базе знаний…"
              value={query}
              onValueChange={setQuery}
              className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="inline-flex items-center rounded-[5px] border bg-background px-1.5 py-[3px] text-[11px] font-medium tracking-[0.3px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>

          <CommandList className="max-h-[400px] overflow-y-auto">
            {query.trim().length === 0 && !loading && (
              <>
                {/* «Недавние» — sticky-style section header */}
                <div className="px-5 pt-[14px] pb-2 text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                  Недавние
                </div>
                <div className="px-2 pb-1 text-sm text-muted-foreground italic">
                  <div className="px-3 py-3 text-center">
                    Начните печатать, чтобы искать
                  </div>
                </div>
              </>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Ищем…
              </div>
            )}

            {!loading && query.trim().length > 0 && hits.length === 0 && (
              <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
                Ничего не найдено
              </CommandEmpty>
            )}

            {!loading && hits.length > 0 && (
              <div className="py-1">
                {hits.map((hit) => (
                  <CommandItem
                    key={hit.id}
                    // cmdk uses `value` for matching. We disable filtering,
                    // but `value` still drives keyboard selection — make
                    // it unique per row.
                    value={hit.id}
                    onSelect={() => onSelect(hit.slug)}
                    className="px-5 py-2.5 gap-3 data-[selected=true]:bg-muted aria-selected:bg-muted"
                  >
                    <KbPageIcon icon={hit.icon} color={hit.icon_color} size={16} />
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="truncate text-sm font-medium text-foreground">
                        {hit.title || "Без названия"}
                      </span>
                      {hit.snippet && (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          <SnippetMarks raw={hit.snippet} />
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </div>
            )}
          </CommandList>

          {/* Footer hints */}
          <div
            aria-hidden="true"
            className="flex items-center justify-end gap-[18px] border-t bg-muted/40 px-5 py-3 text-[11px] font-medium tracking-[0.2px] text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <kbd className="inline-flex items-center rounded border bg-background px-1 py-0.5 text-[10px]">↑↓</kbd>
              навигация
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="inline-flex items-center rounded border bg-background px-1 py-0.5 text-[10px]">⏎</kbd>
              открыть
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="inline-flex items-center rounded border bg-background px-1 py-0.5 text-[10px]">Esc</kbd>
              закрыть
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Render ts_headline output: replace <mark>…</mark> markers with
 * <mark> elements, keep everything else as plain text. Avoids
 * dangerouslySetInnerHTML on user-typed content. */
function SnippetMarks({ raw }: { raw: string }) {
  // Split on the marker pair, keep delimiters via regex groups.
  // ts_headline output never includes other tags — we configured only
  // StartSel/StopSel in the migration (see kb_search RPC).
  const parts = raw.split(/(<mark>|<\/mark>)/g);
  let inMark = false;
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part === "<mark>") {
      inMark = true;
      return;
    }
    if (part === "</mark>") {
      inMark = false;
      return;
    }
    if (!part) return;
    out.push(
      inMark ? (
        <mark key={i} className="rounded-sm bg-yellow-200/60 px-0.5 text-foreground dark:bg-yellow-500/30">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  });
  return <>{out}</>;
}

// ─── Trigger button (used in the tree header) ──────────────────────

export function KbSearchTrigger() {
  const { open } = useKbSearch();
  return (
    <button
      type="button"
      onClick={open}
      className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5
                 text-xs text-muted-foreground hover:bg-accent
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="size-3.5" />
      <span className="flex-1 text-left">Поиск</span>
      <CommandShortcut className="ml-0">⌘K</CommandShortcut>
    </button>
  );
}
