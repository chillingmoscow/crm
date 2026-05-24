"use client";

import { useCallback, useEffect, useState } from "react";
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
 * Состав: тип блока + B/I/U/S/код + цвет текста + ссылка. Комментарий / AI на
 * баре — следующий fast-follow (завязаны на comments-extension / AI-команды).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

type MarkKey = "bold" | "italic" | "underline" | "strike" | "code";

type ActiveStyles = Partial<Record<MarkKey, boolean>> & { textColor?: string };

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
  const activeColor = activeStyles.textColor ?? "default";

  const [current, setCurrent] = useState<BlockTypeOption>(BLOCK_TYPES[0]);
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
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

  // Видимость = редактор в фокусе. Позицию над клавиатурой считаем через
  // visualViewport, но НЕ гейтим видимость поднятием клавиатуры: на touch с
  // внешней клавиатурой (iPad/Android) soft-клавиатуры нет, и при гейте по
  // keyboard>100 бар не показывался → пользователь оставался вообще без
  // тулбара форматирования (плавающий BN-тулбар на touch выключен). Codex P1.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;

    const isEditorFocused = () => {
      try {
        return editor.isFocused();
      } catch {
        return false;
      }
    };

    const update = () => {
      const focused = isEditorFocused();
      if (!vv) {
        setBottom(0);
        setVisible(focused);
        return;
      }
      // Высота клавиатуры = разница layout- и visual-viewport'а снизу.
      const keyboard = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      setBottom(keyboard);
      // keyboard влияет только на позицию (bottom); видимость — по фокусу.
      setVisible(focused);
    };

    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    // focusin/out по документу: фокус ушёл в редактор / из него → пересчёт.
    // Фокус в наш собственный link-input (внутри бара) не должен прятать бар —
    // update() читает editor.isFocused(), а ProseMirror держит selection при
    // blur, поэтому focused остаётся true достаточно для рендера; на всякий
    // случай при focusout пересчитываем через setTimeout (фокус мог уйти
    // обратно в редактор/в инпут бара).
    const onFocusIn = () => update();
    const onFocusOut = () => window.setTimeout(update, 0);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [editor]);

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
    setActiveSheet(null);
    editor.focus();
    syncBlock();
  };

  const applyColor = (key: string) => {
    // BN: addStyles({ textColor }); "default" сбрасывает цвет.
    editor.addStyles({ textColor: key } as Parameters<typeof editor.addStyles>[0]);
    setActiveSheet(null);
    editor.focus();
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
    setActiveSheet(null);
    editor.focus();
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
      {/* Поповеры открываются ВВЕРХ над баром (бар уже над клавиатурой;
          bottom-sheet был бы скрыт клавиатурой). overlay ловит тап вне
          поповера для закрытия. */}
      {activeSheet ? (
        <div
          className="kb-mobile-sheet-overlay"
          onClick={() => {
            setActiveSheet(null);
            // Вернуть фокус редактору, чтобы бар не пропал после закрытия
            // поповера (visible снова станет true по focusin).
            editor.focus();
          }}
          aria-hidden
        />
      ) : null}

      {activeSheet === "block" ? (
        <div className="kb-mobile-sheet" role="menu">
          {BLOCK_TYPES.map((option) => {
            const Icon = option.icon;
            const active = option.key === current.key;
            return (
              <button
                key={option.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className="kb-mobile-sheet-item"
                data-active={active ? true : undefined}
                onClick={() => applyBlockType(option)}
              >
                <Icon className="size-4" />
                <span className="flex-1 text-left">{option.label}</span>
                {active ? <Check className="size-4 text-brand" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {activeSheet === "color" ? (
        <div className="kb-mobile-sheet kb-mobile-color-grid" role="menu">
          {TEXT_COLORS.map((color) => {
            const active = color.key === activeColor;
            return (
              <button
                key={color.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className="kb-mobile-color-swatch"
                data-active={active ? true : undefined}
                aria-label={color.label}
                title={color.label}
                onClick={() => applyColor(color.key)}
              >
                <span
                  className="kb-mobile-color-dot"
                  style={color.css ? { color: color.css } : undefined}
                  data-default={color.css ? undefined : true}
                >
                  А
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeSheet === "link" ? (
        <div className="kb-mobile-sheet kb-mobile-link-sheet" role="menu">
          <input
            type="url"
            inputMode="url"
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
          data-active={activeColor !== "default" || activeSheet === "color" ? true : undefined}
          aria-label="Цвет текста"
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
