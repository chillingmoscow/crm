"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { User } from "lucide-react";

import { searchKbMentions, type KbMentionPerson } from "@/lib/knowledge/mentions";
import { cn } from "@/lib/utils";

/**
 * @-mention dropdown для plain-textarea-композеров комментариев.
 *
 * Контекст: outer KB-editor использует BlockNote SuggestionMenuController
 * для @-mention'ов (см. KbMentionMenu). Composer комментариев — обычный
 * <textarea>, поэтому суггест-меню BN недоступно. Здесь — самодельный
 * аналог:
 *   • Trigger: `@` в начале текста или после whitespace.
 *   • Поиск people через searchKbMentions (та же server-action).
 *   • На выбор — заменяем `@<query>` на `@<FullName> ` и регистрируем
 *     mention-token в state.
 *   • На submit caller вызывает buildBodyFromText(text, mentions) →
 *     BN body с kbStaffMention chip'ами для каждого mention'а,
 *     найденного substring-search'ом.
 *
 * Tokens живут в массиве { userId, fullName, avatarUrl }. Position не
 * отслеживаем — substring-search на submit'е достаточен, и не ломается
 * при редактировании текста до/после mention'а. Если юзер сломает
 * текст mention'а («@Ив н Иванов»), substring-match не найдёт → notif
 * не пойдёт (acceptable trade-off).
 *
 * Notif-сторона: после submit'а comments-store вызывает
 * `kb_emit_comment_mentions` (миграция 090) с user-ids из
 * extractMentionedUserIds(body). Idempotency через PK
 * kb_comment_user_mentions(comment_id, user_id) — повторная попытка
 * не дублирует.
 */

export interface KbCommentMention {
  /** auth.users.id */
  userId: string;
  /** Полное имя сотрудника, как оно вставлено в текст после `@`. */
  fullName: string;
  /** Avatar URL (или "" если нет). */
  avatarUrl: string;
}

interface UseCommentMentionDropdownArgs {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: (next: string) => void;
  /** Pre-existing mentions из original body (для EditCommentRow).
   *  Без этого редактирование коммента с уже-вставленными mention'ами
   *  drop'ало бы их chip'ы — substring-search на submit'е без записей
   *  в mentions list ничего не находит. */
  initialMentions?: KbCommentMention[];
}

interface DropdownState {
  open: boolean;
  /** Позиция `@` в тексте — на submit'е там вставится chip. */
  triggerStart: number;
  /** Текущий query (символы между `@` и каретой). */
  query: string;
  items: KbMentionPerson[];
  loading: boolean;
  activeIndex: number;
  /** Pixel-position dropdown'а в координатах document'а. */
  top: number;
  left: number;
}

const INITIAL_STATE: DropdownState = {
  open: false,
  triggerStart: -1,
  query: "",
  items: [],
  loading: false,
  activeIndex: 0,
  top: 0,
  left: 0,
};

/**
 * Hook для встраивания @-mention dropdown'а в любую textarea.
 *
 * Возвращает:
 *  - `mentions` — список зарегистрированных mention'ов; на submit
 *    вызвать `buildBodyFromText(text, mentions)`.
 *  - `dropdown` — ReactNode dropdown'а; рендерить рядом с textarea
 *    (он сам портал'нётся в body).
 *  - `handleKeyDown` — навешать на onKeyDown textarea ДО кастомных
 *    Enter-handler'ов: hook intercept'ит ↑↓Enter/Esc когда dropdown
 *    открыт и возвращает `true` чтобы caller прервал свою обработку.
 *  - `resetMentions` — очистить mentions list (после успешного submit).
 */
export function useCommentMentionDropdown({
  textareaRef,
  text,
  setText,
  initialMentions,
}: UseCommentMentionDropdownArgs): {
  mentions: KbCommentMention[];
  dropdown: ReactNode;
  handleKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  resetMentions: () => void;
} {
  const [state, setState] = useState<DropdownState>(INITIAL_STATE);
  // initialMentions — снимок: если caller перерисовывается с
  // меняющимся initialMentions, не reset'им юзерские правки. Берём
  // только первый снимок через lazy initializer.
  const [mentions, setMentions] = useState<KbCommentMention[]>(
    () => initialMentions ?? [],
  );

  // Stable текущий fetch-id, чтобы старые результаты не перезаписывали
  // свежий query (race при быстрой печати).
  const fetchIdRef = useRef(0);

  // Закрываем dropdown
  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // Запуск/обновление dropdown'а на каждый text-change или selection
  // change. Идём от позиции каретки назад, ищем последний `@` без
  // whitespace между ним и кареткой; если такой найден — open.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const update = () => {
      const caret = ta.selectionStart ?? 0;
      const before = text.slice(0, caret);
      // Найти последний `@` после whitespace (или в начале строки),
      // без пробелов между ним и кареткой.
      const m = before.match(/(?:^|\s)(@[^\s@]{0,30})$/);
      if (!m) {
        if (state.open) close();
        return;
      }
      const triggerToken = m[1]; // "@query"
      const query = triggerToken.slice(1);
      const triggerStart = caret - triggerToken.length;

      // Pixel-position: используем bounding rect textarea'и + измеряем
      // позицию каретки через hidden mirror div.
      const { top, left } = computeCaretCoords(ta, triggerStart);

      setState((prev) => ({
        ...prev,
        open: true,
        triggerStart,
        query,
        top,
        left,
        // Сбрасываем activeIndex когда query меняется — иначе можно
        // случайно «выбрать» айтем который уже не в списке.
        activeIndex: prev.query === query ? prev.activeIndex : 0,
      }));
    };
    update();
    // selectionchange события нужны если юзер кликает caret или
    // навигирует стрелками без изменения text.
    const handler = () => update();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [text, textareaRef, state.open, close]);

  // Fetch items когда query меняется. Debounce 100ms.
  useEffect(() => {
    if (!state.open) return;
    const fetchId = ++fetchIdRef.current;
    setState((prev) => ({ ...prev, loading: true }));
    const t = setTimeout(async () => {
      const res = await searchKbMentions(state.query);
      if (fetchId !== fetchIdRef.current) return;
      // Только people: страницы в комментариях не упоминаем (нельзя
      // отнотифицировать страницу).
      const people = res.items.filter(
        (it): it is KbMentionPerson => it.kind === "person",
      );
      setState((prev) => ({ ...prev, items: people, loading: false }));
    }, 100);
    return () => clearTimeout(t);
  }, [state.open, state.query]);

  // Применить selected item — заменить `@query` на `@FullName ` в
  // text и зарегистрировать mention.
  const applyItem = useCallback(
    (item: KbMentionPerson) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const triggerStart = state.triggerStart;
      const caret = ta.selectionStart ?? 0;
      const replacement = `@${item.full_name} `;
      const next =
        text.slice(0, triggerStart) + replacement + text.slice(caret);
      setText(next);
      setMentions((prev) => {
        // Дедуп: если уже есть mention этого user'а, не добавляем
        // повторно (буст для readability + RPC всё равно дедуп'нет).
        if (prev.some((m) => m.userId === item.id)) return prev;
        return [
          ...prev,
          {
            userId: item.id,
            fullName: item.full_name,
            avatarUrl: item.avatar_url ?? "",
          },
        ];
      });
      // Восстановить каретку после replacement'а.
      const newCaret = triggerStart + replacement.length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
      });
      close();
    },
    [text, textareaRef, state.triggerStart, setText, close],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!state.open || state.items.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          activeIndex: Math.min(prev.activeIndex + 1, prev.items.length - 1),
        }));
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          activeIndex: Math.max(prev.activeIndex - 1, 0),
        }));
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = state.items[state.activeIndex];
        if (item) applyItem(item);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [state, applyItem, close],
  );

  const resetMentions = useCallback(() => setMentions([]), []);

  // Render через портал: dropdown позиционируется absolute по pixel-
  // координатам каретки. В body чтобы не клипилось overflow:hidden
  // парентов textarea.
  const dropdown = useMemo(() => {
    if (!state.open) return null;
    if (typeof document === "undefined") return null;
    return createPortal(
      <div
        className="fixed z-[10000]"
        style={{ top: state.top, left: state.left }}
      >
        <DropdownList
          items={state.items}
          loading={state.loading}
          activeIndex={state.activeIndex}
          onSelect={applyItem}
          onHover={(i) => setState((prev) => ({ ...prev, activeIndex: i }))}
        />
      </div>,
      document.body,
    );
  }, [state, applyItem]);

  return { mentions, dropdown, handleKeyDown, resetMentions };
}

function DropdownList({
  items,
  loading,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: KbMentionPerson[];
  loading: boolean;
  activeIndex: number;
  onSelect: (item: KbMentionPerson) => void;
  onHover: (index: number) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-popover shadow-md min-w-[220px] py-2 px-3 text-xs text-muted-foreground">
        Поиск…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-popover shadow-md min-w-[220px] py-2 px-3 text-xs text-muted-foreground">
        Никого не нашлось
      </div>
    );
  }
  return (
    <ul className="rounded-lg border border-border bg-popover shadow-md min-w-[220px] max-h-64 overflow-y-auto py-1">
      {items.map((it, i) => (
        <li key={it.id}>
          <button
            type="button"
            onMouseDown={(e) => {
              // mousedown вместо click — иначе textarea теряет фокус
              // ДО click-handler'а, dropdown'у пора закрываться.
              e.preventDefault();
              onSelect(it);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm",
              "transition-colors",
              i === activeIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
          >
            {it.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={it.avatar_url}
                alt=""
                className="size-5 rounded-full object-cover bg-muted shrink-0"
              />
            ) : (
              <span className="size-5 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center shrink-0">
                <User className="size-3" />
              </span>
            )}
            <span className="truncate">{it.full_name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Извлекает зарегистрированные kbStaffMention chip'ы из BN body.
 * Используется в EditCommentRow для pre-seed'а initialMentions hook'а
 * чтобы повторный save не drop'ал существующие mention'ы.
 */
export function extractMentionsFromCommentBody(
  body: unknown,
): KbCommentMention[] {
  const out: KbCommentMention[] = [];
  if (!Array.isArray(body)) return out;
  const seen = new Set<string>();
  for (const block of body) {
    if (!block || typeof block !== "object") continue;
    const b = block as { content?: unknown };
    if (!Array.isArray(b.content)) continue;
    for (const item of b.content) {
      if (!item || typeof item !== "object") continue;
      const it = item as {
        type?: string;
        props?: { userId?: string; fullName?: string; avatarUrl?: string };
      };
      if (
        it.type === "kbStaffMention" &&
        typeof it.props?.userId === "string" &&
        typeof it.props.fullName === "string"
      ) {
        if (seen.has(it.props.userId)) continue;
        seen.add(it.props.userId);
        out.push({
          userId: it.props.userId,
          fullName: it.props.fullName,
          avatarUrl: it.props.avatarUrl ?? "",
        });
      }
    }
  }
  return out;
}

/**
 * Конвертирует plain-text + mentions в BN body. Walk'аем text слева
 * направо, для каждого зарегистрированного mention'а ищем
 * `@<FullName>` substring (с учётом возможных дубликатов в text'е) и
 * заменяем на kbStaffMention chip. Остальное — text-runs.
 *
 * Если юзер отредактировал mention в text'е (text не содержит
 * `@<FullName>`) — chip не вставится, mention silently dropped.
 * Если text содержит `@<FullName>` несколько раз — все instance'ы
 * заменяются на chip'ы (notif пойдёт один раз, idempotency RPC).
 */
export function buildCommentBodyFromText(
  text: string,
  mentions: KbCommentMention[],
): unknown[] {
  // Edge-case: пустой text → один пустой paragraph (BN формат).
  const trimmed = text.trim();
  if (!trimmed) {
    return [{ type: "paragraph", content: [] }];
  }

  // Если mention'ов нет — простой 1-paragraph body (как раньше).
  if (mentions.length === 0) {
    return [
      {
        type: "paragraph",
        content: [{ type: "text", text: trimmed, styles: {} }],
      },
    ];
  }

  // Собираем все matches (start,end,mention) для всех mention'ов в
  // text'е. Сортируем по start. Если matches overlap'ят — приоритет
  // более раннему (longest-not-required, имена обычно не перекрываются).
  type Match = { start: number; end: number; mention: KbCommentMention };
  const matches: Match[] = [];
  for (const m of mentions) {
    const needle = `@${m.fullName}`;
    let from = 0;
    while (true) {
      const idx = text.indexOf(needle, from);
      if (idx < 0) break;
      matches.push({ start: idx, end: idx + needle.length, mention: m });
      from = idx + needle.length;
    }
  }
  // Сортируем longer-first при equal start (Codex #83 P1):
  // если есть mention'ы «Ann» и «Annabelle» одновременно, и в text'е
  // встречается «@Annabelle», обе строки matches попадают в one и
  // тот же `start`. Без secondary-sort'а по убыванию end шорт-mention
  // мог выиграть и сериализоваться как `kbStaffMention(Ann) + "abelle"`
  // → неверный получатель notif'а.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Walk text, разбивая на runs: text → kbStaffMention → text → ...
  // Конвертируем целый text в один paragraph с массивом inline-content.
  const inline: Array<Record<string, unknown>> = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue; // overlap, skip
    if (match.start > cursor) {
      const prefix = text.slice(cursor, match.start);
      if (prefix) inline.push({ type: "text", text: prefix, styles: {} });
    }
    inline.push({
      type: "kbStaffMention",
      props: {
        userId: match.mention.userId,
        fullName: match.mention.fullName,
        avatarUrl: match.mention.avatarUrl,
      },
    });
    cursor = match.end;
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    if (tail) inline.push({ type: "text", text: tail, styles: {} });
  }

  return [{ type: "paragraph", content: inline }];
}

/**
 * Простая caret-position: используем `<div>`-mirror, рисуем туда
 * `text.slice(0, caret)` со стилями textarea, измеряем bounding rect
 * последнего знака. Известный паттерн.
 */
function computeCaretCoords(
  ta: HTMLTextAreaElement,
  caretIndex: number,
): { top: number; left: number } {
  const taRect = ta.getBoundingClientRect();
  // Mirror-div с теми же стилями шрифта/паддинга, что в textarea.
  const mirror = document.createElement("div");
  const cs = window.getComputedStyle(ta);
  // Копируем достаточно стилей чтобы layout совпадал.
  const props = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "whiteSpace",
    "wordWrap",
  ];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  for (const p of props) {
    (mirror.style as unknown as Record<string, string>)[p] =
      (cs as unknown as Record<string, string>)[p] ?? "";
  }
  // Подставляем text до caret + sentinel-span чтобы измерить координаты.
  const before = ta.value.slice(0, caretIndex);
  mirror.textContent = before;
  const sentinel = document.createElement("span");
  sentinel.textContent = ta.value.slice(caretIndex) || ".";
  mirror.appendChild(sentinel);
  document.body.appendChild(mirror);
  const offsetTop = sentinel.offsetTop;
  const offsetLeft = sentinel.offsetLeft;
  document.body.removeChild(mirror);
  // Position dropdown ниже caret-line (line-height + small gap).
  // Dropdown рендерится через `position: fixed`, поэтому coords —
  // в координатах VIEWPORT'а, не document'а. window.scrollY/X
  // ДОБАВЛЯТЬ НЕ НАДО — иначе при scrolled-странице dropdown
  // улетает вниз за viewport на величину scroll'а.
  const lineHeight = parseFloat(cs.lineHeight || "20") || 20;
  return {
    top: taRect.top + offsetTop + lineHeight + 4 - ta.scrollTop,
    left: taRect.left + offsetLeft - ta.scrollLeft,
  };
}
