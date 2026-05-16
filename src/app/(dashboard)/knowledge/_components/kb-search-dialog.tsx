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
import { Loader2, Search, Sparkles, ArrowLeft } from "lucide-react";

import { Command as CommandPrimitive } from "cmdk";

import {
  Command,
  CommandEmpty,
  CommandList,
  CommandItem,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { searchKbPages } from "@/lib/knowledge/search";
import { askKbAi, type KbAiSource } from "@/lib/knowledge/ai-rag";
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
  /** kb.ask_ai permission + accounts.ai_enabled. Если true — в search-
   *  диалоге появляется CTA «Спросить ИИ» сверху. */
  aiAskEnabled?: boolean;
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
export function KbSearchProvider({ children, aiAskEnabled = false }: KbSearchProviderProps) {
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
      <KbSearchDialog open={isOpen} onOpenChange={setOpen} aiAskEnabled={aiAskEnabled} />
    </KbSearchContext.Provider>
  );
}

// ─── Dialog body ──────────────────────────────────────────────────────

interface KbSearchDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  aiAskEnabled: boolean;
}

interface KbAiState {
  question: string;
  loading: boolean;
  answer: string | null;
  sources: KbAiSource[];
  error: string | null;
}

function KbSearchDialog({ open, onOpenChange, aiAskEnabled }: KbSearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KbSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  // AI-mode: когда юзер кликнул «Спросить ИИ», прячем результаты
  // search'а и показываем answer-panel. Reset на новом query/close.
  const [ai, setAi] = useState<KbAiState | null>(null);
  // Bumps every time the user types so we can ignore stale responses.
  const requestSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the dialog state every time it (re)opens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setLoading(false);
      setAi(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }, [open]);

  // Сбрасываем AI-mode при изменении query.
  useEffect(() => {
    if (ai && ai.question !== query) setAi(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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

  const onAskAi = async () => {
    const question = query.trim();
    if (question.length < 4) return;
    setAi({
      question,
      loading: true,
      answer: null,
      sources: [],
      error: null,
    });
    const result = await askKbAi({ question });
    // Если юзер успел поменять query за время запроса — игнорируем.
    setAi((prev) => {
      if (!prev || prev.question !== question) return prev;
      return {
        question,
        loading: false,
        answer: result.answer,
        sources: result.sources,
        error: result.error,
      };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Дизайн по sheerly.pen → WFrIM:
          - 720px wide, rounded-[14px]
          - Search bar с padding 18/20, border-bottom, ⌘K kbd справа
          - AI Quick — постоянный голубой баннер под search-bar'ом
            (node NnFB2), активен когда ИИ включён
          - Result rows с padding 10/20, hover/active fill-accent
          - Footer с подсказками (border-top, fill-accent) */}
      <DialogContent
        className="max-w-[720px] p-0 gap-0 rounded-[14px] overflow-hidden shadow-xl
                   [&>button:last-child]:hidden top-[20%] translate-y-0"
      >
        {/* Radix requires a DialogTitle for a11y; hide it visually. */}
        <DialogTitle className="sr-only">Поиск по базе знаний</DialogTitle>
        <Command
          shouldFilter={false}
          className="bg-background [&_[cmdk-item]]:rounded-none"
        >
          {/* Search bar — дизайн sheerly.pen → WFrIM · node Haeij:
              одна иконка-лупа, крупный инпут 15px, ⌘K kbd справа,
              padding 18/20, один border-bottom. Используем сырой
              cmdk Input (не shadcn CommandInput — тот инжектит
              собственную иконку + обёртку → было две лупы). */}
          <div className="flex items-center gap-3 border-b px-5 py-[18px]">
            <Search className="size-[18px] shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              placeholder="Поиск по базе знаний…"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                // Enter запускает «Спросить ИИ» (как ⏎ в AI-баннере по
                // дизайну WFrIM). Перехватываем до cmdk (он бы выбрал
                // подсвеченный результат). stopPropagation — чтобы
                // Command-root не обработал то же нажатие.
                if (
                  event.key === "Enter" &&
                  aiAskEnabled &&
                  !ai &&
                  query.trim().length >= 4
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  void onAskAi();
                }
              }}
              className="h-7 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="inline-flex items-center rounded-[5px] border bg-background px-[7px] py-[3px] text-[11px] font-medium tracking-[0.3px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>

          {/* AI quick-row — постоянный баннер сразу под search-bar'ом
              (sheerly.pen → WFrIM · node NnFB2): голубой фон, синяя
              sparkles-иконка, ⏎ kbd справа. Виден всегда при включённом
              ИИ; прячется в AI-mode (там answer-panel). Клик с запросом
              < 4 символов — no-op (см. onAskAi). */}
          {aiAskEnabled && !ai && (
            <button
              type="button"
              onClick={() => void onAskAi()}
              className="flex w-full items-center gap-3 border-b bg-blue-50 px-5 py-[14px] text-left
                         transition-colors hover:bg-blue-100 focus-visible:outline-none
                         focus-visible:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/60"
            >
              <Sparkles className="size-[18px] shrink-0 text-blue-700 dark:text-blue-400" />
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-blue-900 dark:text-blue-200">
                Спросить ИИ о базе знаний — задайте вопрос своими словами
              </span>
              <kbd className="inline-flex items-center rounded-[5px] border bg-background px-[7px] py-[3px] text-[11px] font-medium text-muted-foreground">
                ⏎
              </kbd>
            </button>
          )}

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

            {/* AI answer panel */}
            {ai && (
              <div className="px-5 py-4 border-b bg-muted/30">
                <button
                  type="button"
                  onClick={() => setAi(null)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground mb-2"
                >
                  <ArrowLeft className="size-3" /> Вернуться к поиску
                </button>
                {ai.loading && (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    ИИ думает над «{ai.question}»…
                  </div>
                )}
                {!ai.loading && ai.error && (
                  <div className="py-2 text-sm text-destructive">
                    {ai.error}
                  </div>
                )}
                {!ai.loading && ai.answer && (
                  <div className="flex flex-col gap-3">
                    <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                      {ai.answer}
                    </div>
                    {ai.sources.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                          Источники
                        </div>
                        <ul className="flex flex-col gap-0.5">
                          {ai.sources.map((src) => (
                            <li key={src.page_id}>
                              <button
                                type="button"
                                onClick={() => onSelect(src.page_slug)}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                              >
                                <KbPageIcon
                                  icon={src.page_icon}
                                  color={src.page_icon_color}
                                  size={14}
                                />
                                <span className="flex-1 truncate text-foreground">
                                  {src.page_title || "Без названия"}
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {Math.round(src.similarity * 100)}%
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {loading && !ai && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Ищем…
              </div>
            )}

            {!loading && !ai && query.trim().length > 0 && hits.length === 0 && (
              <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
                Ничего не найдено
              </CommandEmpty>
            )}

            {!loading && !ai && hits.length > 0 && (
              <div className="py-1">
                {hits.map((hit) => (
                  <CommandItem
                    key={hit.id}
                    // cmdk uses `value` for matching. We disable filtering,
                    // but `value` still drives keyboard selection — make
                    // it unique per row.
                    value={hit.id}
                    onSelect={() => onSelect(hit.slug)}
                    className="px-5 py-2.5 gap-3 data-[selected=true]:bg-accent aria-selected:bg-accent"
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
            className="flex items-center justify-end gap-[18px] border-t bg-accent px-5 py-3 text-[11px] font-medium tracking-[0.2px] text-muted-foreground"
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

import { IconTooltip } from "@/components/ui/icon-tooltip";

export function KbSearchTrigger() {
  const { open } = useKbSearch();
  return (
    <IconTooltip label="Поиск (⌘K)">
      <button
        type="button"
        onClick={open}
        aria-label="Поиск (Cmd+K)"
        className="inline-flex items-center justify-center size-6 rounded-md
                   text-muted-foreground hover:bg-accent hover:text-foreground
                   transition-colors
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-3.5" />
      </button>
    </IconTooltip>
  );
}
