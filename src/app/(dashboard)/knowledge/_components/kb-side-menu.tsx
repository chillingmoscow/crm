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

/** Item для table-блока: «Расширить» — растянуть на всю доступную
 *  ширину editor area и распределить колонки равномерно.
 *
 *  Ширины хранятся в `block.content.columnWidths: (number | undefined)[]`,
 *  по одной на колонку (cell.props не для ширины; см. Codex P1 на
 *  PR #180).
 *
 *  Доступная ширина = `clientWidth` ProseMirror DOM-узла editor'а;
 *  fallback на 720 (≈ ширина prose-зоны). Делим на N колонок,
 *  применяем одинаковое значение всему массиву. */
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
        const content = (
          block as unknown as {
            content?: {
              type?: "tableContent";
              columnWidths?: (number | undefined)[];
              rows?: Array<{ cells: unknown[] }>;
            };
          }
        ).content;
        if (!content?.rows?.length) return;
        const colCount = content.rows[0]?.cells.length ?? 0;
        if (colCount === 0) return;

        // Доступная ширина = clientWidth ProseMirror-DOM editor'а минус
        // padding-вещи, BN рисует table-wrapper ещё с
        // --bn-table-handle-size (9px) padding-left и --bn-table-widget-
        // size (22px) padding-right (см. shadcn/style.css). Вычитаем,
        // чтобы N равных колонок поместились в content-zone без overflow.
        const TABLE_WRAPPER_PADDING = 9 + 22;
        let availableWidth = 720;
        try {
          const view = (
            editor as unknown as {
              prosemirrorView?: { dom: HTMLElement };
            }
          ).prosemirrorView;
          if (view?.dom) {
            availableWidth = Math.max(
              200,
              view.dom.clientWidth - TABLE_WRAPPER_PADDING,
            );
          }
        } catch {
          /* fallback to 720 */
        }
        const equal = Math.floor(availableWidth / colCount);
        const newColumnWidths = Array.from({ length: colCount }, () => equal);

        editor.updateBlock(block, {
          content: { ...content, columnWidths: newColumnWidths },
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
 *  меняем только содержимое выпадающего меню drag-handle'а.
 *
 *  `editable` — если false (locked-страница), скрываем side-menu для
 *  audio-блока: action'ов с ним всё равно сделать нельзя, drag-handle и
 *  + кнопка визуально только мешают. CSS-подход через scope-класс не
 *  работает — BN рендерит side-menu в FloatingUI portal вне `.bn-sheerly`.
 *  JS-условие на `props.block.type` — единственный надёжный путь. */
export function KbSideMenuController({
  editable = true,
}: {
  editable?: boolean;
}) {
  return (
    <SideMenuController
      sideMenu={(props) => {
        const blockType = (props as { block?: { type?: string } }).block?.type;
        if (!editable && blockType === "audio") return null;
        return <SideMenu {...props} dragHandleMenu={KbDragHandleMenu} />;
      }}
    />
  );
}
