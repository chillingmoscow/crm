"use client";

import type { FC } from "react";
import {
  Check,
  Columns3,
  Copy,
  CopyPlus,
  Trash2,
  Type,
} from "lucide-react";
import { SideMenuExtension } from "@blocknote/core";
import {
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
} from "@blocknote/react";
import { toast } from "sonner";

import { KbColorPickerItem } from "@/app/(dashboard)/knowledge/_components/kb-color-picker-item";

/**
 * Custom drag-handle menu для KB-страниц. Дополняет default-меню
 * BlockNote (Цвет, Удалить) пунктами «Копировать» и «Дублировать».
 *
 * Копировать = текстовое представление блока → clipboard. Дублировать =
 * insert копии того же блока сразу после текущего (Notion-style Cmd+D).
 *
 * Использует тот же ComponentsContext, что и встроенные пункты —
 * получаем стилистически идентичные menu items.
 */
function CopyBlockItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (s) => s?.block,
  });
  if (!block) return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      icon={<Copy className="size-4" />}
      onClick={async () => {
        try {
          // Block из SideMenuExtension имеет generic-параметры <any,any,any>,
          // а editor.blocksToMarkdownLossy ждёт точные схемы — cast as never.
          const md = await editor.blocksToMarkdownLossy([block as never]);
          await navigator.clipboard.writeText(md);
          toast.success("Скопировано");
        } catch {
          toast.error("Не удалось скопировать");
        }
      }}
    >
      Копировать
    </Components.Generic.Menu.Item>
  );
}

function DuplicateBlockItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (s) => s?.block,
  });
  if (!block) return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      icon={<CopyPlus className="size-4" />}
      onClick={() => {
        // Передаём только PartialBlock-поля (без id, internal refs).
        // structuredClone — чтобы content/children/props не разделяли
        // ссылки с исходным блоком: иначе BlockNote мутирует обе копии
        // одновременно и side-menu state ловит «двух блоков с одним id».
        const partial = structuredClone({
          type: block.type,
          props: block.props,
          content: block.content,
          children: block.children,
        });
        editor.insertBlocks([partial as never], block as never, "after");
      }}
    >
      Дублировать
    </Components.Generic.Menu.Item>
  );
}

/** Item для table-блока: «Расширить» — равномерно распределить ширины
 *  колонок. Берёт сумму текущих colwidth у первой строки, делит на
 *  количество ячеек и применяет одинаковую ширину каждой ячейке во
 *  всех строках. Если colwidth не выставлены явно — фолбэк на 100px
 *  на колонку (BN-default). */
function TableExpandItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (s) => s?.block,
  });
  if (!block || block.type !== "table") return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      icon={<Columns3 className="size-4" />}
      onClick={() => {
        // Структура BN table-content: { rows: [{ cells: [{ props: { colwidth?: number[] } }] }] }
        const content = (
          block as unknown as {
            content?: {
              rows?: Array<{
                cells: Array<{
                  props?: { colwidth?: number[] };
                }>;
              }>;
            };
          }
        ).content;
        const rows = content?.rows ?? [];
        const firstRow = rows[0];
        if (!firstRow || firstRow.cells.length === 0) return;

        const widths = firstRow.cells.map(
          (c) => c.props?.colwidth?.[0] ?? 100,
        );
        const total = widths.reduce((a, b) => a + b, 0);
        const equal = Math.round(total / widths.length);

        const newRows = rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            props: {
              ...(cell.props ?? {}),
              colwidth: [equal],
            },
          })),
        }));

        editor.updateBlock(block, {
          content: { ...content, rows: newRows },
        } as never);
      }}
    >
      Расширить
    </Components.Generic.Menu.Item>
  );
}

/** Submenu для quote-блока: «Размер» (default / large). Виден только если
 *  текущий выделенный блок имеет type=quote. Apply через editor.updateBlock. */
function QuoteSizeItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (s) => s?.block,
  });
  if (!block || block.type !== "quote") return null;
  const current =
    ((block.props as { size?: string }).size as "default" | "large") ??
    "default";
  const items: { value: "default" | "large"; label: string }[] = [
    { value: "default", label: "Обычный" },
    { value: "large", label: "Крупный" },
  ];
  return (
    <Components.Generic.Menu.Root position={"right"} sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item
          className="bn-menu-item"
          subTrigger
          icon={<Type className="size-4" />}
        >
          Размер
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {items.map((it) => {
          const checked = current === it.value;
          return (
            <Components.Generic.Menu.Item
              key={it.value}
              className="bn-menu-item"
              icon={
                checked ? (
                  <Check className="size-4" />
                ) : (
                  <span className="size-4 inline-block" />
                )
              }
              onClick={() => {
                editor.updateBlock(block, {
                  props: { size: it.value },
                } as never);
              }}
            >
              {it.label}
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

const KbDragHandleMenu: FC = () => (
  <DragHandleMenu>
    <CopyBlockItem />
    <DuplicateBlockItem />
    {/* `KbColorPickerItem` — наш кастомный sub-trigger с правильной
     *  Palette-иконкой; внутри открывает grid-сетку 5 колонок (frame
     *  08 · GkjMx). Полностью заменяет BN-default'ный
     *  `BlockColorsItem`, который рендерит unstyled vertical-list. */}
    <KbColorPickerItem>Цвет</KbColorPickerItem>
    {/* Type-specific submenus. Каждый item внутри сам проверяет
     *  `block.type` и возвращает null для других блоков. */}
    <QuoteSizeItem />
    <TableExpandItem />
    <RemoveBlockItem>
      <span className="bn-kb-menu-item-label bn-kb-menu-item-destructive">
        <Trash2 className="size-4" /> Удалить
      </span>
    </RemoveBlockItem>
  </DragHandleMenu>
);

/** Render-prop для BlockNoteView: отдаёт SideMenuController с custom
 *  drag-handle menu. AddBlockButton и DragHandleButton остаются default —
 *  меняем только содержимое выпадающего меню drag-handle'а. */
export function KbSideMenuController() {
  return (
    <SideMenuController
      sideMenu={(props) => (
        <SideMenu {...props} dragHandleMenu={KbDragHandleMenu} />
      )}
    />
  );
}
