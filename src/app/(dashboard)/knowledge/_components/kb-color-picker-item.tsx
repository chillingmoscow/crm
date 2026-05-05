"use client";

import {
  type FC,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Palette } from "lucide-react";
import {
  blockHasType,
  editorHasBlockWithType,
  SideMenuExtension,
} from "@blocknote/core";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
} from "@blocknote/react";

/**
 * Custom replacement для BN-default'ного `BlockColorsItem`. Open'ит
 * sub-menu с горизонтальной 5-колоночной grid-сеткой цветов (см.
 * sheerly.pen frame 08 · GkjMx) — секции «Текст» / «Задний фон»,
 * каждая по 10 chip'ов.
 *
 * Отличия от BN-default:
 *   - Своя layout-сетка вместо вертикального списка menu-item'ов.
 *     Текстовые лейблы цветов (например «Серый», «Коричневый») не
 *     рендерим — chip'ы и так визуально означают цвет, см. дизайн.
 *   - Не использует `Components.Generic.Menu.Item` для каждого цвета
 *     (CSS-override шorel-styles BN'а конфликтовал с grid-layout'ом
 *     поверх shadcn DropdownMenuItem). Вместо этого — обычные
 *     `<button>`'ы с собственным focus/hover стилем.
 *   - Рамка вокруг текущего значения через outline на самом chip'е.
 *
 * Sub-menu container — всё ещё `Components.Generic.Menu.Dropdown`
 * (BN sub-trigger открывает его как Radix DropdownMenuSubContent),
 * чтобы keyboard-nav в parent-меню (drag-handle) работал как раньше.
 */
const COLORS = [
  "default",
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

type Color = (typeof COLORS)[number];

interface KbColorPickerItemProps {
  /** Видимая подпись sub-trigger'а в parent-меню (обычно «Цвет»). */
  children: ReactNode;
}

export const KbColorPickerItem: FC<KbColorPickerItemProps> = ({ children }) => {
  const Components = useComponentsContext()!;
  // any-generic'и здесь идиоматичны для BN-extension'ов (см.
  // kb-side-menu.tsx CopyBlockItem / DuplicateBlockItem). Без них
  // типы useExtensionState selector'а не совпадают с return-типом.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (s) => s?.block,
  });

  if (!block) return null;
  // BN-default: показываем picker если у блока есть textColor ИЛИ
  // backgroundColor prop.
  const hasText = blockHasType(block, editor, block.type, {
    textColor: "string",
  });
  const hasBackground = blockHasType(block, editor, block.type, {
    backgroundColor: "string",
  });
  if (!hasText && !hasBackground) return null;

  const blockProps = block.props as {
    textColor?: string;
    backgroundColor?: string;
  };
  const textColor =
    hasText &&
    editorHasBlockWithType(editor, block.type, { textColor: "string" })
      ? (blockProps.textColor as Color | undefined)
      : undefined;
  const bgColor =
    hasBackground &&
    editorHasBlockWithType(editor, block.type, { backgroundColor: "string" })
      ? (blockProps.backgroundColor as Color | undefined)
      : undefined;

  const setText = (c: Color) => {
    editor.updateBlock(block, {
      type: block.type,
      props: { textColor: c },
    });
  };
  const setBg = (c: Color) => {
    editor.updateBlock(block, {
      props: { backgroundColor: c },
    });
  };

  // Stop propagation чтобы клик по chip'у НЕ закрывал
  // parent-DropdownMenu (Radix close-on-click). Цвет применяется,
  // но юзер остаётся в меню — может пощёлкать варианты.
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <Components.Generic.Menu.Root position={"right"} sub={true}>
      <Components.Generic.Menu.Trigger sub={true}>
        <Components.Generic.Menu.Item
          className="bn-menu-item"
          subTrigger
          icon={<Palette className="size-4" />}
        >
          {children}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>

      <Components.Generic.Menu.Dropdown
        sub
        className="bn-menu-dropdown bn-color-picker-dropdown kb-color-picker"
      >
        <div className="kb-color-picker-grid">
          {hasText && (
            <>
              <div className="kb-color-picker-label">Текст</div>
              {COLORS.map((c) => (
                <button
                  key={`tc-${c}`}
                  type="button"
                  aria-label={`Цвет текста: ${c}`}
                  data-active={textColor === c || undefined}
                  onClick={stop(() => setText(c))}
                  className="kb-color-chip kb-color-chip-text"
                >
                  <span className="bn-color-icon" data-text-color={c}>
                    A
                  </span>
                </button>
              ))}
            </>
          )}
          {hasBackground && (
            <>
              <div className="kb-color-picker-label">Задний фон</div>
              {COLORS.map((c) => (
                <button
                  key={`bg-${c}`}
                  type="button"
                  aria-label={`Цвет фона: ${c}`}
                  data-active={bgColor === c || undefined}
                  onClick={stop(() => setBg(c))}
                  className="kb-color-chip kb-color-chip-bg"
                >
                  <span className="bn-color-icon" data-background-color={c}>
                    A
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
};
