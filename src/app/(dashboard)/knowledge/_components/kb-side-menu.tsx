"use client";

import type { FC } from "react";
import { Copy, CopyPlus, Trash2 } from "lucide-react";
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

const KbDragHandleMenu: FC = () => (
  <DragHandleMenu>
    <CopyBlockItem />
    <DuplicateBlockItem />
    {/* `KbColorPickerItem` — наш кастомный sub-trigger с правильной
     *  Palette-иконкой; внутри открывает grid-сетку 5 колонок (frame
     *  08 · GkjMx). Полностью заменяет BN-default'ный
     *  `BlockColorsItem`, который рендерит unstyled vertical-list. */}
    <KbColorPickerItem>Цвет</KbColorPickerItem>
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
