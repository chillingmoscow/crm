/**
 * Tiptap-extension, переопределяющий Enter в heading-блоках.
 *
 * Default ProseMirror split при Enter сохраняет тип узла — обе
 * половинки остаются heading. Word / Notion / Google Docs работают
 * иначе:
 *   - Enter В НАЧАЛЕ heading'а → новая пустая строка ВЫШЕ — paragraph
 *     (не heading). Cursor остаётся в исходном heading'е.
 *   - Enter В КОНЦЕ heading'а → новая пустая строка НИЖЕ — paragraph.
 *     Cursor перемещается в новую paragraph-строку.
 *   - Enter В СЕРЕДИНЕ heading'а → дефолтный split (две heading-
 *     половинки). Полезно когда юзер режет длинный заголовок надвое.
 *
 * Priority выше, чем у BN-овского KeyboardShortcutsExtension (50),
 * чтобы наш handler сработал первым и блокировал default-split.
 *
 * BN PM-schema: `blockContainer { content: "blockContent
 * blockGroup?" }` — на один контейнер один blockContent + опционально
 * blockGroup. Поэтому новый paragraph оборачиваем в blockContainer и
 * вставляем перед / после текущего контейнера (не как сиблинг
 * heading'а внутри контейнера, иначе Transformation Error). UniqueID
 * extension сам выставит id новому блоку в appendTransaction.
 */
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export const KbHeadingEnterExtension = Extension.create({
  name: "kbHeadingEnter",

  // Higher than BN's KeyboardShortcutsExtension (50) — наш handler
  // должен сработать ПЕРЕД default-split'ом, иначе обе половинки
  // останутся heading.
  priority: 200,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        const node = $from.parent;
        if (node.type.name !== "heading") return false;
        if ($from.depth < 2) return false;

        const blockContainerType = state.schema.nodes.blockContainer;
        const paragraphType = state.schema.nodes.paragraph;
        if (!blockContainerType || !paragraphType) return false;

        const atStart = $from.parentOffset === 0;
        const atEnd = $from.parentOffset === node.content.size;

        // Middle of heading → дефолтный split (две heading-половинки)
        // — то поведение, что хочет юзер для разрезания заголовка.
        if (!atStart && !atEnd) return false;

        const containerDepth = $from.depth - 1;
        const newBlock = blockContainerType.create(
          null,
          paragraphType.create(),
        );

        try {
          if (atStart) {
            // Enter в начале heading'а: paragraph выше, cursor
            // остаётся в heading'е (не двигаем явно — после insert
            // выше позиция текущего heading'а сдвигается вниз, но
            // PM сохраняет TextSelection относительно текста, так
            // что cursor по-прежнему стоит в начале heading-content
            // нового положения).
            const insertPos = $from.before(containerDepth);
            const tr = state.tr.insert(insertPos, newBlock);
            view.dispatch(tr);
          } else {
            // Enter в конце heading'а: paragraph ниже, cursor
            // переходит в начало paragraph'а.
            const insertPos = $from.after(containerDepth);
            const tr = state.tr.insert(insertPos, newBlock);
            // cursor → внутрь нового paragraph'а. Position: insertPos
            // + 1 (входим в blockContainer) + 1 (входим в paragraph)
            // = insertPos + 2. Mapping через tr нужен потому что мы
            // только что modify'или doc.
            const mapped = tr.mapping.map(insertPos);
            const cursorPos = mapped + 2;
            tr.setSelection(TextSelection.create(tr.doc, cursorPos));
            tr.scrollIntoView();
            view.dispatch(tr);
          }
        } catch {
          // Fail-safe: схема отвергла вставку → пропускаем default-Enter
          return false;
        }
        return true;
      },
    };
  },
});
