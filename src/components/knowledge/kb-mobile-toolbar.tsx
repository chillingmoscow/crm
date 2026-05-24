"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveStyles, useEditorSelectionChange } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  Bold,
  Check,
  ChevronUp,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
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
 * (нет наезда), а выбор типа блока — через touch-bottom-sheet, не Radix Select.
 *
 * Работает через editor-API BlockNote 0.49: useActiveStyles (реактивные марки),
 * editor.toggleStyles, getTextCursorPosition().block + updateBlock (тип блока).
 *
 * Видимость — по фокусу редактора (бар нужен и без soft-клавиатуры, напр. на
 * touch-устройстве с внешней клавиатурой). Позицию над клавиатурой считаем
 * через window.visualViewport (bottom = высота клавиатуры; 0 если опущена).
 *
 * Stage 1a — block-type + B/I/U/S/код. Ссылка / цвет / комментарий / AI на
 * мобильном баре — fast-follow после проверки архитектуры на устройстве.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

type MarkKey = "bold" | "italic" | "underline" | "strike" | "code";

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
  const activeStyles = useActiveStyles(editor) as Partial<Record<MarkKey, boolean>>;

  const [current, setCurrent] = useState<BlockTypeOption>(BLOCK_TYPES[0]);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  if (typeof document === "undefined" || !visible) return null;

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
    setSheetOpen(false);
    editor.focus();
    syncBlock();
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
      // может отменить сам click.
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* Поповер выбора типа блока — открывается ВВЕРХ над баром (бар уже над
          клавиатурой; bottom-sheet был бы скрыт клавиатурой). overlay ловит
          тап вне поповера для закрытия. */}
      {sheetOpen ? (
        <div
          className="kb-mobile-sheet-overlay"
          onClick={() => setSheetOpen(false)}
          aria-hidden
        />
      ) : null}
      {sheetOpen ? (
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

      <button
        type="button"
        className="kb-mobile-toolbar-blocktype"
        data-open={sheetOpen ? true : undefined}
        onClick={() => setSheetOpen((v) => !v)}
        aria-label="Тип блока"
        aria-expanded={sheetOpen}
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
      </div>
    </div>,
    document.body,
  );
}
