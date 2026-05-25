"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveStyles, useEditorSelectionChange } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { toast } from "sonner";
import {
  Baseline,
  Bold,
  Check,
  ChevronUp,
  Code,
  Copy,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Quote,
  Sparkles,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  type LucideIcon,
} from "lucide-react";

import { runKbAiCommand, type KbAiCommand } from "@/lib/knowledge/ai-commands";
import {
  KB_AI_COMMAND_SPECS,
  NON_TEXT_AI_BLOCK_TYPES,
  applyAiResultToEditor,
  resolveAiSourceText,
} from "@/lib/knowledge/ai-command-specs";

/**
 * Мобильный тулбар форматирования (плавающий бар НАД выделением).
 *
 * Зачем: на iOS WebKit плавающий FormattingToolbar BlockNote ведёт себя плохо —
 * не помещается на узком экране, ловит клавиатуру, а Radix BlockTypeSelect внутри
 * не открывается по тапу. Поэтому свой бар: марки/тип/цвет/ссылка работают через
 * editor-API, а выбор типа блока / цвет — через полноэкранные touch-листы
 * (не Radix Select/Popover, которые на iOS капризят).
 *
 * Работает через editor-API BlockNote 0.49: useActiveStyles (реактивные марки +
 * textColor), editor.toggleStyles/addStyles, getTextCursorPosition().block +
 * updateBlock (тип блока), createLink/getSelectedLinkUrl (ссылка).
 *
 * Позиционирование: бар ставим НАД прямоугольником выделения, в КООРДИНАТАХ
 * ДОКУМЕНТА (top = scrollY + selRect.top − высота бара − зазор), position:absolute.
 * Почему так, а не «фикс. бар над клавиатурой»: на iOS position:fixed во время
 * открытой клавиатуры ломается (элемент уезжает при скролле), а пересчёт fixed на
 * каждый scroll даёт дёрганье + раздувает скролл. Бар, привязанный к позиции
 * выделения, скроллится вместе с текстом естественно — без scroll-листенера,
 * без дёрганья. Пересчёт только на смену выделения / фокус / resize вьюпорта.
 *
 * Видимость — по фокусу редактора (бар нужен и без soft-клавиатуры, напр. на
 * touch-устройстве с внешней клавиатурой).
 *
 * Состав: тип блока + B/I/U/S/код + цвет текста/фона + ссылка. Комментарий / AI
 * на баре — следующий fast-follow (завязаны на comments-extension / AI-команды).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

type MarkKey = "bold" | "italic" | "underline" | "strike" | "code";

type ActiveStyles = Partial<Record<MarkKey, boolean>> & {
  textColor?: string;
  backgroundColor?: string;
};

const MARKS: { key: MarkKey; icon: LucideIcon; label: string }[] = [
  { key: "bold", icon: Bold, label: "Жирный" },
  { key: "italic", icon: Italic, label: "Курсив" },
  { key: "underline", icon: Underline, label: "Подчёркнутый" },
  { key: "strike", icon: Strikethrough, label: "Зачёркнутый" },
  { key: "code", icon: Code, label: "Код" },
];

type BlockTypeOption = {
  key: string;
  label: string;
  icon: LucideIcon;
  type: string;
  props?: Record<string, unknown>;
  level?: number;
};

const BLOCK_TYPES: BlockTypeOption[] = [
  { key: "paragraph", label: "Текст", icon: Type, type: "paragraph" },
  { key: "h1", label: "Заголовок 1", icon: Heading1, type: "heading", props: { level: 1 }, level: 1 },
  { key: "h2", label: "Заголовок 2", icon: Heading2, type: "heading", props: { level: 2 }, level: 2 },
  { key: "h3", label: "Заголовок 3", icon: Heading3, type: "heading", props: { level: 3 }, level: 3 },
  { key: "bullet", label: "Маркированный список", icon: List, type: "bulletListItem" },
  { key: "numbered", label: "Нумерованный список", icon: ListOrdered, type: "numberedListItem" },
  { key: "check", label: "Чек-лист", icon: ListChecks, type: "checkListItem" },
  { key: "quote", label: "Цитата", icon: Quote, type: "quote" },
];

// Цвета текста BlockNote (ключи — как в BN; реальный цвет в редакторе задаёт
// сам BN через data-text-color, тут hex — только превью свотча в пикере).
const TEXT_COLORS: { key: string; label: string; css: string | null }[] = [
  { key: "default", label: "Авто", css: null },
  { key: "gray", label: "Серый", css: "#9b9a97" },
  { key: "brown", label: "Коричневый", css: "#64473a" },
  { key: "red", label: "Красный", css: "#e03e3e" },
  { key: "orange", label: "Оранжевый", css: "#d9730d" },
  { key: "yellow", label: "Жёлтый", css: "#dfab01" },
  { key: "green", label: "Зелёный", css: "#4d8a6a" },
  { key: "blue", label: "Синий", css: "#0b6e99" },
  { key: "purple", label: "Фиолетовый", css: "#6940a5" },
  { key: "pink", label: "Розовый", css: "#ad1a72" },
];

type SheetKind = "block" | "color" | "link" | "more" | "ai";

/** Типы блоков, на которых комментарий бессмысленен (leaf-media / структурные).
 *  Зеркало NON_COMMENTABLE_BLOCK_TYPES + table из blocknote-editor.tsx —
 *  держим локально, чтобы не тянуть зависимость из большого host-файла. */
const NON_COMMENTABLE_MOBILE_BLOCK_TYPES = new Set([
  "image",
  "video",
  "audio",
  "file",
  "divider",
  "gallery",
  "collection",
  "table",
]);

function matchBlockType(
  block: { type?: string; props?: Record<string, unknown> } | undefined,
): BlockTypeOption {
  if (!block) return BLOCK_TYPES[0];
  if (block.type === "heading") {
    const level = block.props?.level as number | undefined;
    const exact = BLOCK_TYPES.find(
      (o) => o.type === "heading" && o.level === level,
    );
    if (exact) return exact;
    // H4–H6 (нет в списке доступных типов): показываем РЕАЛЬНЫЙ уровень, но с
    // уникальным key, которого нет среди BLOCK_TYPES — чтобы ни один пункт
    // листа не помечался активным и блок не выглядел как «Заголовок 1»
    // (иначе юзер случайно понизит H4→H1). Codex P2 на #447.
    return {
      key: `heading-${level ?? "x"}`,
      label: `Заголовок ${level ?? ""}`.trim(),
      icon: Heading3,
      type: "heading",
      props: { level: level ?? 3 },
      level,
    };
  }
  // Не-heading типы в BLOCK_TYPES уникальны по type (level не задан).
  return BLOCK_TYPES.find((o) => o.type === block.type) ?? BLOCK_TYPES[0];
}

/**
 * Прямоугольник текущего выделения (в координатах VIEWPORT). Для схлопнутой
 * каретки getBoundingClientRect даёт нулевой rect — тогда берём первый из
 * getClientRects(). Возвращает null, если выделения/каретки в DOM нет.
 */
function getSelectionRect(): DOMRect | null {
  if (typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  let rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const rects = range.getClientRects();
    if (rects.length > 0) rect = rects[0];
  }
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

export function KbMobileToolbar({
  editor,
  aiEnabled = false,
  canComment = false,
  onComment,
}: {
  editor: AnyEditor;
  /** kb.use_ai + accounts.ai_enabled (проверено сервер-сайдом в host'е). */
  aiEnabled?: boolean;
  /** bundle.canComment — пользователь вправе комментировать на этой странице. */
  canComment?: boolean;
  /** Старт нового комментария к выделению (host дёргает startPendingComment). */
  onComment?: () => void;
}) {
  const activeStyles = useActiveStyles(editor) as ActiveStyles;
  const activeTextColor = activeStyles.textColor ?? "default";
  const activeBgColor = activeStyles.backgroundColor ?? "default";

  const [current, setCurrent] = useState<BlockTypeOption>(BLOCK_TYPES[0]);
  // Сырой тип текущего блока (для гейтинга AI / комментария на media-блоках —
  // matchBlockType для них даёт fallback «Текст», поэтому держим отдельно).
  const [rawBlockType, setRawBlockType] = useState<string>("paragraph");
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [aiPending, setAiPending] = useState<KbAiCommand | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Y-смещение бара в КООРДИНАТАХ ДОКУМЕНТА (бар — position:absolute, стоит НАД
  // выделением). Привязка к позиции выделения, а не к низу вьюпорта: бар
  // скроллится вместе с текстом, без дёрганья и без раздувания скролла.
  const [barTop, setBarTop] = useState(0);

  const syncBlock = useCallback(() => {
    try {
      const block = editor.getTextCursorPosition().block as
        | { type?: string; props?: Record<string, unknown> }
        | undefined;
      setCurrent(matchBlockType(block));
      setRawBlockType(block?.type ?? "paragraph");
    } catch {
      setCurrent(BLOCK_TYPES[0]);
      setRawBlockType("paragraph");
    }
  }, [editor]);

  // Пересчёт видимости (по фокусу редактора) + позиции (НАД выделением).
  // Видимость НЕ гейтим поднятием клавиатуры: на touch с внешней клавиатурой
  // soft-клавиатуры нет, иначе бар не показывался бы (P1 #447).
  const recompute = useCallback(() => {
    if (typeof window === "undefined") return;
    let focused = false;
    try {
      focused = editor.isFocused();
    } catch {
      focused = false;
    }
    setVisible(focused);
    // Позицию двигаем только когда редактор в фокусе (есть живое выделение).
    // Если фокус ушёл в наш link-инпут / открыт лист — оставляем последнюю.
    if (!focused) return;
    const rect = getSelectionRect();
    if (!rect) return;
    const barH = barRef.current?.offsetHeight ?? 48;
    const gap = 8;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    // Верх бара = верх выделения − высота бара − зазор, в координатах документа.
    setBarTop(Math.max(0, scrollY + rect.top - barH - gap));
  }, [editor]);

  // Пересчёт на смену выделения (основной триггер позиции бара) + sync типа блока.
  const onSelectionChange = useCallback(() => {
    syncBlock();
    recompute();
  }, [syncBlock, recompute]);
  useEditorSelectionChange(onSelectionChange, editor);
  useEffect(() => {
    onSelectionChange();
  }, [onSelectionChange]);

  // Скролл-листенер НЕ навешиваем: бар привязан к позиции выделения (absolute в
  // координатах документа) и скроллится вместе с текстом сам. Слушаем только
  // resize visualViewport (клавиатура открылась/закрылась → раскладка сместилась)
  // и фокус. Это и убирает дёрганье + бесконечный скролл прошлого подхода.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    recompute();
    vv?.addEventListener("resize", recompute);
    const onFocusIn = () => recompute();
    const onFocusOut = () => window.setTimeout(recompute, 0);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      vv?.removeEventListener("resize", recompute);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [recompute]);

  // Бар монтируется при visible=true с barTop=0; сразу после монтирования
  // измеряем реальную высоту и ставим над выделением (иначе первый показ — у 0).
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(recompute);
    return () => cancelAnimationFrame(id);
  }, [visible, recompute]);

  // Закрыть лист/поповер → вернуть фокус редактору → ПЕРЕСЧИТАТЬ позицию
  // несколько раз с задержками. После закрытия полноэкранного листа фокус и
  // выделение восстанавливаются не мгновенно; отложенные пересчёты ловят момент,
  // когда selection снова доступен, и ставят бар над ним.
  const closeSheetAndFocus = useCallback(() => {
    setActiveSheet(null);
    editor.focus();
    recompute();
    window.setTimeout(recompute, 150);
    window.setTimeout(recompute, 350);
    window.setTimeout(recompute, 600);
  }, [editor, recompute]);

  // Автофокус в поле URL при открытии link-поповера: курсор сразу там, второй
  // тап не нужен. Клавиатура уже поднята (юзер редактировал текст), поэтому
  // focus() просто переводит каретку в поле — отдельный gesture для подъёма
  // клавиатуры не требуется. rAF — чтобы инпут успел смонтироваться.
  useEffect(() => {
    if (activeSheet !== "link") return;
    const id = requestAnimationFrame(() => linkInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [activeSheet]);

  // Полноэкранные листы (тип блока / цвет) — как в Notion на весь экран. Убираем
  // клавиатуру при их открытии: иначе OS-слой клавиатуры перекрыл бы низ листа.
  // Выделение ProseMirror переживает blur, поэтому apply по сохранённому
  // selection работает; на закрытии листа applyX/Отмена возвращают editor.focus().
  useEffect(() => {
    if (
      activeSheet === "block" ||
      activeSheet === "color" ||
      activeSheet === "more" ||
      activeSheet === "ai"
    ) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, [activeSheet]);

  // Лочим скролл страницы под полноэкранным листом — иначе на iOS скролл
  // «протекает» на основную страницу (overscroll-behavior помогает не всегда),
  // и юзер теряет нужную строку списка. Восстанавливаем при закрытии.
  useEffect(() => {
    if (activeSheet === null || activeSheet === "link") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [activeSheet]);

  // Бар держим смонтированным, пока открыт любой поповер. Особенно важно для
  // link-инпута: тап в поле уводит фокус из редактора → editor.isFocused()
  // становится false → visible=false; без условия `activeSheet !== null` бар
  // (и сам инпут) размонтировались бы, и ввод ссылки обрывался (Codex P1 #448).
  if (typeof document === "undefined" || (!visible && activeSheet === null)) {
    return null;
  }

  const toggleMark = (key: MarkKey) => {
    editor.toggleStyles({ [key]: true } as Parameters<typeof editor.toggleStyles>[0]);
    editor.focus();
  };

  const applyBlockType = (option: BlockTypeOption) => {
    try {
      const block = editor.getTextCursorPosition().block;
      if (block) {
        editor.updateBlock(block, {
          type: option.type,
          props: option.props ?? {},
        } as Parameters<typeof editor.updateBlock>[1]);
      }
    } catch {
      /* no cursor — ничего не делаем */
    }
    closeSheetAndFocus();
    syncBlock();
  };

  const applyColor = (which: "textColor" | "backgroundColor", key: string) => {
    // BN: addStyles({ textColor | backgroundColor }); "default" сбрасывает.
    editor.addStyles({ [which]: key } as Parameters<typeof editor.addStyles>[0]);
    closeSheetAndFocus();
  };

  const openLink = () => {
    let prefill = "";
    try {
      prefill = (editor.getSelectedLinkUrl?.() as string | undefined) ?? "";
    } catch {
      /* нет ссылки в выделении */
    }
    setLinkUrl(prefill);
    setActiveSheet("link");
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url) {
      try {
        // createLink применяется к текущему выделению редактора (ProseMirror
        // держит selection при blur в наш инпут).
        editor.createLink(url);
      } catch {
        /* нет валидного выделения — игнор */
      }
    }
    closeSheetAndFocus();
  };

  // ── Блочные действия (лист «⋯») ─────────────────────────────────────
  const insertBelow = () => {
    try {
      const block = editor.getTextCursorPosition().block;
      if (block) {
        const inserted = editor.insertBlocks(
          [{ type: "paragraph" }] as Parameters<typeof editor.insertBlocks>[0],
          block,
          "after",
        );
        const next = inserted?.[0];
        if (next) editor.setTextCursorPosition(next, "start");
      }
    } catch {
      /* no cursor */
    }
    closeSheetAndFocus();
  };

  const duplicateBlock = () => {
    try {
      const block = editor.getTextCursorPosition().block as
        | { type?: string; props?: Record<string, unknown>; content?: unknown }
        | undefined;
      if (block) {
        editor.insertBlocks(
          [
            {
              type: block.type,
              props: block.props,
              content: block.content,
            },
          ] as Parameters<typeof editor.insertBlocks>[0],
          block as Parameters<typeof editor.insertBlocks>[1],
          "after",
        );
      }
    } catch {
      /* no cursor */
    }
    closeSheetAndFocus();
  };

  const deleteBlock = () => {
    try {
      const block = editor.getTextCursorPosition().block;
      if (block) {
        editor.removeBlocks([
          block,
        ] as Parameters<typeof editor.removeBlocks>[0]);
      }
    } catch {
      /* no cursor */
    }
    // После удаления каретка переезжает на соседний блок сама — просто закрываем
    // лист и возвращаем фокус (без apply по старому выделению).
    setActiveSheet(null);
    try {
      editor.focus();
    } catch {
      /* editor мог потерять блок — игнор */
    }
    syncBlock();
  };

  // ── AI-команда (лист «AI») ──────────────────────────────────────────
  const runAi = async (spec: (typeof KB_AI_COMMAND_SPECS)[number]) => {
    const { text, error: srcErr } = resolveAiSourceText(editor, spec);
    if (srcErr || !text) {
      toast.info(srcErr ?? "Нет текста для AI-команды");
      return;
    }
    setAiPending(spec.id);
    const { result, error } = await runKbAiCommand({
      command: spec.id,
      text,
    });
    setAiPending(null);
    if (error || !result) {
      toast.error(`AI: ${error ?? "пустой ответ"}`);
      return;
    }
    try {
      applyAiResultToEditor(editor, spec, result);
    } catch {
      toast.error("Не удалось вставить результат");
    }
    closeSheetAndFocus();
  };

  const CurrentIcon = current.icon;
  const showAi = aiEnabled && !NON_TEXT_AI_BLOCK_TYPES.has(rawBlockType);
  const showComment =
    canComment && !NON_COMMENTABLE_MOBILE_BLOCK_TYPES.has(rawBlockType);

  return createPortal(
    <div
      ref={barRef}
      className="kb-mobile-toolbar"
      style={{ top: barTop }}
      role="toolbar"
      aria-label="Форматирование"
      // preventDefault на mousedown сохраняет выделение/фокус редактора при
      // тапе по кнопкам бара (стандартный приём для редакторских тулбаров).
      // Только mousedown — preventDefault на pointerdown/touchstart на iOS
      // может отменить сам click. ИСКЛЮЧЕНИЕ — поля ввода (link-input): им
      // фокус нужен, иначе в них нельзя печатать.
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea")) return;
        event.preventDefault();
      }}
    >
      {/* overlay только для link-поповера (он маленький, над баром). Листы
          типа блока / цвета — полноэкранные, со своей шапкой и «Отмена». */}
      {activeSheet === "link" ? (
        <div
          className="kb-mobile-sheet-overlay"
          onClick={closeSheetAndFocus}
          aria-hidden
        />
      ) : null}

      {activeSheet === "block" ? (
        <div className="kb-mobile-fullsheet" role="dialog" aria-label="Превратить в">
          <div className="kb-mobile-fullsheet-header">
            <span className="kb-mobile-fullsheet-title">Превратить в</span>
            <button
              type="button"
              className="kb-mobile-fullsheet-cancel"
              onClick={closeSheetAndFocus}
            >
              Отмена
            </button>
          </div>
          <div className="kb-mobile-fullsheet-body" role="menu">
            {BLOCK_TYPES.map((option) => {
              const Icon = option.icon;
              const active = option.key === current.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className="kb-mobile-fullsheet-item"
                  data-active={active ? true : undefined}
                  onClick={() => applyBlockType(option)}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="flex-1 text-left">{option.label}</span>
                  {active ? <Check className="size-5 text-brand shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeSheet === "color" ? (
        <div className="kb-mobile-fullsheet" role="dialog" aria-label="Цвет блока">
          <div className="kb-mobile-fullsheet-header">
            <span className="kb-mobile-fullsheet-title">Цвет блока</span>
            <button
              type="button"
              className="kb-mobile-fullsheet-cancel"
              onClick={closeSheetAndFocus}
            >
              Отмена
            </button>
          </div>
          <div className="kb-mobile-fullsheet-body" role="menu">
            <div className="kb-mobile-fullsheet-section">Цвет текста</div>
            {TEXT_COLORS.map((color) => {
              const active = color.key === activeTextColor;
              return (
                <button
                  key={`t-${color.key}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className="kb-mobile-fullsheet-item"
                  data-active={active ? true : undefined}
                  onClick={() => applyColor("textColor", color.key)}
                >
                  <span
                    className="kb-mobile-color-chip"
                    style={color.css ? { color: color.css } : undefined}
                    data-default={color.css ? undefined : true}
                  >
                    А
                  </span>
                  <span className="flex-1 text-left">{color.label}</span>
                  {active ? <Check className="size-5 text-brand shrink-0" /> : null}
                </button>
              );
            })}

            <div className="kb-mobile-fullsheet-section">Фон текста</div>
            {TEXT_COLORS.map((color) => {
              const active = color.key === activeBgColor;
              return (
                <button
                  key={`b-${color.key}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className="kb-mobile-fullsheet-item"
                  data-active={active ? true : undefined}
                  onClick={() => applyColor("backgroundColor", color.key)}
                >
                  <span
                    className="kb-mobile-color-chip kb-mobile-color-chip-bg"
                    style={color.css ? { backgroundColor: color.css } : undefined}
                    data-default={color.css ? undefined : true}
                  >
                    А
                  </span>
                  <span className="flex-1 text-left">{color.label}</span>
                  {active ? <Check className="size-5 text-brand shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeSheet === "more" ? (
        <div className="kb-mobile-fullsheet" role="dialog" aria-label="Действия с блоком">
          <div className="kb-mobile-fullsheet-header">
            <span className="kb-mobile-fullsheet-title">Действия</span>
            <button
              type="button"
              className="kb-mobile-fullsheet-cancel"
              onClick={closeSheetAndFocus}
            >
              Отмена
            </button>
          </div>
          <div className="kb-mobile-fullsheet-body" role="menu">
            <button
              type="button"
              role="menuitem"
              className="kb-mobile-fullsheet-item"
              onClick={insertBelow}
            >
              <Plus className="size-5 shrink-0" />
              <span className="flex-1 text-left">Вставить ниже</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="kb-mobile-fullsheet-item"
              onClick={duplicateBlock}
            >
              <Copy className="size-5 shrink-0" />
              <span className="flex-1 text-left">Дублировать</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="kb-mobile-fullsheet-item kb-mobile-fullsheet-item-danger"
              onClick={deleteBlock}
            >
              <Trash2 className="size-5 shrink-0" />
              <span className="flex-1 text-left">Удалить</span>
            </button>
          </div>
        </div>
      ) : null}

      {activeSheet === "ai" ? (
        <div className="kb-mobile-fullsheet" role="dialog" aria-label="AI-команды">
          <div className="kb-mobile-fullsheet-header">
            <span className="kb-mobile-fullsheet-title">AI-команды</span>
            <button
              type="button"
              className="kb-mobile-fullsheet-cancel"
              onClick={closeSheetAndFocus}
              disabled={aiPending !== null}
            >
              Отмена
            </button>
          </div>
          <div className="kb-mobile-fullsheet-body" role="menu">
            {KB_AI_COMMAND_SPECS.map((spec) => {
              const Icon = spec.icon;
              const pending = aiPending === spec.id;
              return (
                <button
                  key={spec.id}
                  type="button"
                  role="menuitem"
                  className="kb-mobile-fullsheet-item"
                  disabled={aiPending !== null}
                  onClick={() => void runAi(spec)}
                >
                  {pending ? (
                    <Loader2 className="size-5 shrink-0 animate-spin text-brand" />
                  ) : (
                    <Icon className="size-5 shrink-0 text-brand" />
                  )}
                  <span className="flex flex-1 flex-col text-left">
                    <span className="font-medium">{spec.label}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {spec.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeSheet === "link" ? (
        <div className="kb-mobile-sheet kb-mobile-link-sheet" role="menu">
          <input
            ref={linkInputRef}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="kb-mobile-link-input"
            placeholder="Вставьте ссылку…"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
          />
          <button
            type="button"
            className="kb-mobile-link-apply"
            onClick={applyLink}
            disabled={!linkUrl.trim()}
          >
            <Check className="size-4" />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="kb-mobile-toolbar-blocktype"
        data-open={activeSheet === "block" ? true : undefined}
        onClick={() => setActiveSheet((v) => (v === "block" ? null : "block"))}
        aria-label="Тип блока"
        aria-expanded={activeSheet === "block"}
      >
        <CurrentIcon className="size-4" />
        <span className="kb-mobile-toolbar-blocktype-label">{current.label}</span>
        <ChevronUp className="size-3.5 opacity-60" />
      </button>

      <div className="kb-mobile-toolbar-marks">
        {MARKS.map((mark) => {
          const Icon = mark.icon;
          return (
            <button
              key={mark.key}
              type="button"
              className="kb-mobile-toolbar-btn"
              data-active={activeStyles[mark.key] ? true : undefined}
              aria-label={mark.label}
              aria-pressed={Boolean(activeStyles[mark.key])}
              onClick={() => toggleMark(mark.key)}
            >
              <Icon className="size-[18px]" />
            </button>
          );
        })}

        <button
          type="button"
          className="kb-mobile-toolbar-btn"
          data-active={
            activeTextColor !== "default" ||
            activeBgColor !== "default" ||
            activeSheet === "color"
              ? true
              : undefined
          }
          aria-label="Цвет текста и фон"
          aria-expanded={activeSheet === "color"}
          onClick={() => setActiveSheet((v) => (v === "color" ? null : "color"))}
        >
          <Baseline className="size-[18px]" />
        </button>

        <button
          type="button"
          className="kb-mobile-toolbar-btn"
          data-active={activeSheet === "link" ? true : undefined}
          aria-label="Ссылка"
          aria-expanded={activeSheet === "link"}
          onClick={openLink}
        >
          <Link2 className="size-[18px]" />
        </button>

        {showComment ? (
          <button
            type="button"
            className="kb-mobile-toolbar-btn"
            aria-label="Комментарий"
            onClick={() => {
              setActiveSheet(null);
              onComment?.();
            }}
          >
            <MessageSquarePlus className="size-[18px]" />
          </button>
        ) : null}

        {showAi ? (
          <button
            type="button"
            className="kb-mobile-toolbar-btn"
            data-active={activeSheet === "ai" ? true : undefined}
            aria-label="AI-команды"
            aria-expanded={activeSheet === "ai"}
            onClick={() => setActiveSheet((v) => (v === "ai" ? null : "ai"))}
          >
            <Sparkles className="size-[18px] text-brand" />
          </button>
        ) : null}

        <button
          type="button"
          className="kb-mobile-toolbar-btn"
          data-active={activeSheet === "more" ? true : undefined}
          aria-label="Действия с блоком"
          aria-expanded={activeSheet === "more"}
          onClick={() => setActiveSheet((v) => (v === "more" ? null : "more"))}
        >
          <MoreHorizontal className="size-[18px]" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
