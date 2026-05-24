"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveStyles, useEditorSelectionChange } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  Baseline,
  Bold,
  Check,
  ChevronUp,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Type,
  Underline,
  type LucideIcon,
} from "lucide-react";

/**
 * Мобильный тулбар форматирования (фикс. бар снизу, над клавиатурой).
 *
 * Зачем: на iOS WebKit плавающий FormattingToolbar BlockNote ведёт себя плохо —
 * не помещается на узком экране, ловит клавиатуру, а Radix BlockTypeSelect внутри
 * не открывается по тапу. Это десктоп-паттерн «выдели → всплыло поверх текста».
 * Здесь — паттерн Notion/Word: всегда-видимый бар над клавиатурой, не над текстом
 * (нет наезда), а выбор типа блока / цвет / ссылка — через touch-поповер снизу
 * (не Radix Select/Popover, которые на iOS капризят).
 *
 * Работает через editor-API BlockNote 0.49: useActiveStyles (реактивные марки +
 * textColor), editor.toggleStyles/addStyles, getTextCursorPosition().block +
 * updateBlock (тип блока), createLink/getSelectedLinkUrl (ссылка).
 *
 * Видимость — по фокусу редактора (бар нужен и без soft-клавиатуры, напр. на
 * touch-устройстве с внешней клавиатурой). Позицию над клавиатурой считаем
 * через window.visualViewport (bottom = высота клавиатуры; 0 если опущена).
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

type SheetKind = "block" | "color" | "link";

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

export function KbMobileToolbar({ editor }: { editor: AnyEditor }) {
  const activeStyles = useActiveStyles(editor) as ActiveStyles;
  const activeTextColor = activeStyles.textColor ?? "default";
  const activeBgColor = activeStyles.backgroundColor ?? "default";

  const [current, setCurrent] = useState<BlockTypeOption>(BLOCK_TYPES[0]);
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [bottom, setBottom] = useState(0);

  const syncBlock = useCallback(() => {
    try {
      const block = editor.getTextCursorPosition().block as
        | { type?: string; props?: Record<string, unknown> }
        | undefined;
      setCurrent(matchBlockType(block));
    } catch {
      setCurrent(BLOCK_TYPES[0]);
    }
  }, [editor]);

  useEditorSelectionChange(syncBlock, editor);
  useEffect(() => {
    syncBlock();
  }, [syncBlock]);

  // Пересчёт видимости (по фокусу редактора) + позиции (над клавиатурой через
  // visualViewport). Видимость НЕ гейтим поднятием клавиатуры: на touch с
  // внешней клавиатурой soft-клавиатуры нет, иначе бар не показывался бы (P1 #447).
  const recompute = useCallback(() => {
    let focused = false;
    try {
      focused = editor.isFocused();
    } catch {
      focused = false;
    }
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) {
      setBottom(0);
      setVisible(focused);
      return;
    }
    // Высота клавиатуры = разница layout- и visual-viewport'а снизу.
    const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    setBottom(keyboard);
    setVisible(focused);
  }, [editor]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    recompute();
    // Только resize (показ/скрытие клавиатуры) пересчитывает позицию. НЕ
    // слушаем vv "scroll": на вертикальном скролле он менял vv.offsetTop →
    // бар «уезжал» вниз; position:fixed и так держит бар над клавиатурой.
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

  // Закрыть лист/поповер → вернуть фокус редактору → ПЕРЕСЧИТАТЬ позицию
  // несколько раз с задержками. После закрытия полноэкранного листа клавиатура
  // переанимируется, и одиночный resize мог прийти с промежуточной высотой —
  // бар улетал в середину экрана (скрин 3). Отложенные пересчёты ловят момент,
  // когда клавиатура встала на место.
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

  // ВАЖНО: НЕ блюрим редактор при открытии листа. Раньше блюрили, чтобы убрать
  // клавиатуру (Notion-style full-page). Но цикл blur → editor.focus() (при
  // закрытии) ломал позиционирование fixed-бара на iOS: после refocus iOS
  // считает fixed относительно visual-viewport, и наш bottom=keyboardHeight
  // удваивался → бар улетал в середину экрана. Теперь клавиатура остаётся, а
  // лист рендерим в области НАД клавиатурой (bottom = keyboardHeight, см. JSX) —
  // позиция бара больше не ломается.

  // Лочим скролл страницы под полноэкранным листом — иначе на iOS скролл
  // «протекает» на основную страницу (overscroll-behavior помогает не всегда),
  // и юзер теряет нужную строку списка. Восстанавливаем при закрытии.
  useEffect(() => {
    if (activeSheet !== "block" && activeSheet !== "color") return;
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

  const CurrentIcon = current.icon;

  return createPortal(
    <div
      className="kb-mobile-toolbar"
      style={{ bottom }}
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
        <div
          className="kb-mobile-fullsheet"
          role="dialog"
          aria-label="Превратить в"
          style={{ bottom }}
        >
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
        <div
          className="kb-mobile-fullsheet"
          role="dialog"
          aria-label="Цвет блока"
          style={{ bottom }}
        >
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
      </div>
    </div>,
    document.body,
  );
}
