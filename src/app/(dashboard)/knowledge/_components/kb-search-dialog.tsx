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
import { Loader2, Search, FileText } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        {/* Radix requires a DialogTitle for a11y; hide it visually. */}
        <DialogTitle className="sr-only">Поиск по базе знаний</DialogTitle>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5
                     [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3
                     [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            placeholder="Поиск по базе знаний…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
        {query.trim().length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
            <Search className="size-5" />
            Начните печатать, чтобы искать
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Ищем…
          </div>
        )}

        {!loading && query.trim().length > 0 && hits.length === 0 && (
          <CommandEmpty>Ничего не найдено</CommandEmpty>
        )}

        {!loading && hits.length > 0 && (
          <div className="overflow-hidden p-1">
            {hits.map((hit) => (
              <CommandItem
                key={hit.id}
                // cmdk uses `value` for matching. We disable filtering,
                // but `value` still drives keyboard selection — make
                // it unique per row.
                value={hit.id}
                onSelect={() => onSelect(hit.slug)}
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-base">
                  {hit.icon ?? <FileText className="size-3.5 text-muted-foreground" />}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="truncate text-sm font-medium">
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

        {/* Footer hints — only visible when there's space. */}
        <div
          aria-hidden="true"
          className="flex items-center justify-end gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground"
        >
          <span>
            <kbd className="mr-1 rounded border bg-muted px-1">↑↓</kbd>
            навигация
          </span>
          <span>
            <kbd className="mr-1 rounded border bg-muted px-1">Enter</kbd>
            открыть
          </span>
          <span>
            <kbd className="mr-1 rounded border bg-muted px-1">Esc</kbd>
            закрыть
          </span>
        </div>
          </CommandList>
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
