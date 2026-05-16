"use client";

import { type FC, type ReactNode } from "react";
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
 *   - Своя grid-сетка вместо вертикального списка.
 *   - Текст-подписи цветов не рендерим — сам chip-цвет понятен.
 *   - Каждый chip — это `Components.Generic.Menu.Item` (= shadcn
 *     `DropdownMenuCheckboxItem`), чтобы Radix-roving-tabindex и
 *     Enter-select работали с клавиатуры (Codex P2 на PR #112).
 *     Padding/check-indicator overrid'им CSS'ом (см. `.kb-color-chip`
 *     в globals.css).
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

/** Подписи для tooltip'ов на swatch'ах. Без них юзер угадывает цвет
 *  по визуалу (а коричневый и оранжевый похожи в light-tint'е). */
const COLOR_LABELS: Record<Color, string> = {
  default: "По умолчанию",
  gray: "Серый",
  brown: "Коричневый",
  red: "Красный",
  orange: "Оранжевый",
  yellow: "Жёлтый",
  green: "Зелёный",
  blue: "Синий",
  purple: "Фиолетовый",
  pink: "Розовый",
};

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
        {hasText && (
          <>
            <Components.Generic.Menu.Label className="kb-color-picker-label">
              Текст
            </Components.Generic.Menu.Label>
            {COLORS.map((c) => (
              <Components.Generic.Menu.Item
                key={`tc-${c}`}
                className="kb-color-chip"
                checked={textColor === c}
                icon={
                  <span
                    className="bn-color-icon"
                    data-text-color={c}
                    data-tip={`Текст · ${COLOR_LABELS[c]}`}
                    aria-label={`Текст · ${COLOR_LABELS[c]}`}
                  >
                    A
                  </span>
                }
                onClick={() => setText(c)}
              />
            ))}
          </>
        )}
        {hasBackground && (
          <>
            <Components.Generic.Menu.Label className="kb-color-picker-label">
              Задний фон
            </Components.Generic.Menu.Label>
            {COLORS.map((c) => (
              <Components.Generic.Menu.Item
                key={`bg-${c}`}
                className="kb-color-chip"
                checked={bgColor === c}
                icon={
                  <span
                    className="bn-color-icon"
                    data-background-color={c}
                    data-tip={`Фон · ${COLOR_LABELS[c]}`}
                    aria-label={`Фон · ${COLOR_LABELS[c]}`}
                  >
                    A
                  </span>
                }
                onClick={() => setBg(c)}
              />
            ))}
          </>
        )}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
};
