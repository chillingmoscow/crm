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
import { usePathname, useRouter } from "next/navigation";
import { anotherDialogOpen } from "@/lib/dom/open-dialog";
import { openCommandPalette } from "@/components/shared/command-palette";
import { Loader2, Search, Sparkles, ArrowLeft } from "lucide-react";
import { errorText } from "@/lib/actions/error-text";

import { Command as CommandPrimitive } from "cmdk";

import {
  Command,
  CommandEmpty,
  CommandList,
  CommandItem,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyIllustration } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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

/** То же, но без ошибки вне провайдера — для общих компонентов (кнопка
 *  поиска в верхней панели), которые живут и вне базы знаний. */
export function useKbSearchOptional(): SearchCtx | null {
  return useContext(KbSearchContext);
}

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

  // Cmd+K / Ctrl+K — в базе знаний. В остальных разделах то же сочетание
  // открывает общую палитру (components/shared/command-palette.tsx), а
  // этот поиск — её действием «Поиск по базе знаний».
  const pathname = usePathname() ?? "";
  const onKnowledge = pathname === "/knowledge" || pathname.startsWith("/knowledge/");
  useEffect(() => {
    if (!onKnowledge) return;
    const onKey = (e: KeyboardEvent) => {
      // e.code — та же клавиша в русской раскладке (там e.key — «л»).
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        // Поверх другого окна (палитра из кнопки поиска, панель) не
        // открываемся; своё окно ⌘K закрывает. Если палитра только что
        // закрылась этим же нажатием (она слушает раньше и уже вызвала
        // preventDefault), поиск базы не открываем.
        if (e.defaultPrevented) return;
        if (anotherDialogOpen("data-kb-search")) return;
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKnowledge]);

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
  // Человек выбрал результат стрелками — Enter открывает его, а не ИИ.
  const pickedResultRef = useRef(false);
  const [hits, setHits] = useState<KbSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
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
      setSearchFailed(false);
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
      setSearchFailed(false);
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
        setSearchFailed(true);
        return;
      }
      setSearchFailed(false);
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
        // Английский технический текст пользователю не показываем.
        error: result.error ? errorText(new Error(result.error), "ИИ-поиск временно недоступен") : null,
      };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Свой вид окна поиска (DS это разрешает), токены — из шкалы: ширина
          720, радиус 12, shadow-lg, строки 14/12, «Спросить ИИ» — brand/10. */}
      <DialogContent
        data-kb-search=""
        hideClose
        className="top-[20%] max-w-[720px] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 shadow-lg sm:rounded-xl"
      >
        {/* Radix requires a DialogTitle for a11y; hide it visually. */}
        <DialogTitle className="sr-only">Поиск по базе знаний</DialogTitle>
        <Command
          shouldFilter={false}
          className="bg-background [&_[cmdk-item]]:rounded-none"
        >
          {/* Строка поиска: лупа, поле 16px, ⌘K справа. Сырой cmdk Input —
              shadcn CommandInput добавляет свою лупу и обёртку. */}
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <Search className="size-[18px] shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              placeholder="Поиск по базе знаний…"
              value={query}
              onValueChange={(next) => {
                pickedResultRef.current = false;
                setQuery(next);
              }}
              onKeyDown={(event) => {
                // Стрелки — человек выбирает найденную страницу: тогда Enter
                // открывает её (cmdk), а не спрашивает ИИ.
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  pickedResultRef.current = true;
                  return;
                }
                // Иначе Enter запускает «Спросить ИИ» (как ⏎ в AI-баннере по
                // дизайну WFrIM). Перехватываем до cmdk (он бы выбрал
                // подсвеченный результат). stopPropagation — чтобы
                // Command-root не обработал то же нажатие.
                if (
                  event.key === "Enter" &&
                  aiAskEnabled &&
                  !ai &&
                  !pickedResultRef.current &&
                  query.trim().length >= 4
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  void onAskAi();
                }
              }}
              className="h-7 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hide-on-coarse-pointer inline-flex items-center rounded-sm border bg-muted px-1.5 py-px font-mono text-xs font-semibold text-muted-foreground">
              ⌘K
            </kbd>
          </div>

          {/* «Спросить ИИ» — строка под поиском в brand/10, ⏎ справа. Видна
              при включённом ИИ, прячется в режиме ответа. Запрос короче
              4 символов кнопка не отправляет (см. onAskAi). */}
          {aiAskEnabled && !ai && (
            <button
              type="button"
              onClick={() => void onAskAi()}
              className="flex w-full items-center gap-3 border-b bg-brand/10 px-5 py-3 text-left transition-colors hover:bg-brand/15 focus-visible:bg-brand/15 focus-visible:outline-none"
            >
              <Sparkles className="size-[18px] shrink-0 text-brand" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-brand">
                Спросить ИИ о базе знаний: задайте вопрос своими словами
              </span>
              <kbd className="hide-on-coarse-pointer inline-flex items-center rounded-sm border bg-background px-1.5 py-px font-mono text-xs font-semibold text-muted-foreground">
                ⏎
              </kbd>
            </button>
          )}

          <CommandList className="max-h-[400px] overflow-y-auto">
            {query.trim().length === 0 && !loading && (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                Начните печатать, чтобы искать по названиям и тексту страниц
              </p>
            )}

            {/* AI answer panel */}
            {ai && (
              <div className="px-5 py-4 border-b bg-muted/30">
                <button
                  type="button"
                  onClick={() => setAi(null)}
                  className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-4" /> Вернуться к поиску
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
                        <div className="text-xs font-medium text-muted-foreground">Источники</div>
                        <ul className="flex flex-col gap-0.5">
                          {ai.sources.map((src) => (
                            <li key={src.page_id}>
                              <button
                                type="button"
                                onClick={() => onSelect(src.page_slug)}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                              >
                                <KbPageIcon
                                  icon={src.page_icon}
                                  color={src.page_icon_color}
                                  size={14}
                                />
                                <span className="flex-1 truncate text-foreground">
                                  {src.page_title || "Без названия"}
                                </span>
                                <span className="text-xs tabular-nums text-muted-foreground">
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

            {loading && !ai && <SearchSkeleton />}

            {!loading && !ai && searchFailed && query.trim().length > 0 && (
              <p className="px-5 py-8 text-center text-sm text-destructive">
                Не удалось выполнить поиск. Попробуйте ещё раз
              </p>
            )}

            {!loading && !ai && !searchFailed && query.trim().length > 0 && hits.length === 0 && (
              <CommandEmpty className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                <EmptyIllustration kind="search" className="h-[72px] w-[90px]" />
                <span className="text-sm font-medium">Ничего не найдено</span>
                <span className="text-[13px] text-muted-foreground">
                  {aiAskEnabled
                    ? "Попробуйте другое слово или задайте вопрос ИИ"
                    : "Попробуйте другое слово"}
                </span>
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

          {/* Footer: переход в общий поиск + подсказки клавиш. Поиск в
              верхней панели в базе ищет по страницам; всё остальное
              приложение — отсюда, одной строкой. */}
          <div className="flex items-center gap-4 border-t bg-accent px-5 py-2 text-xs font-medium text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                requestAnimationFrame(() => openCommandPalette());
              }}
              className="-ml-2 inline-flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <Search className="size-4" />
              Искать во всём приложении
            </button>
            <div className="flex-1" />
            <div aria-hidden="true" className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <kbd className="inline-flex items-center rounded-sm border bg-background px-1 py-0.5 text-xs">↑↓</kbd>
                навигация
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="inline-flex items-center rounded-sm border bg-background px-1 py-0.5 text-xs">⏎</kbd>
                открыть
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="inline-flex items-center rounded-sm border bg-background px-1 py-0.5 text-xs">Esc</kbd>
                закрыть
              </span>
            </div>
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
        <mark key={i} className="rounded-sm bg-brand/15 px-0.5 text-foreground">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  });
  return <>{out}</>;
}

/** Заготовка результатов, пока идёт поиск (как в общей палитре). */
function SearchSkeleton() {
  return (
    <div role="status" aria-label="Ищем" aria-busy className="space-y-1 px-5 py-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <Skeleton className="size-4 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5" style={{ width: `${56 - i * 12}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
