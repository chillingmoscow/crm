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
            //
            // Codex P1 на PR #123: tr.mapping.map(pos) с дефолтным
            // assoc=1 после insert'а возвращает позицию ПОСЛЕ
            // вставленного блока (mapped == insertPos + nodeSize),
            // соответственно `mapped + 2` указывал в СЛЕДУЮЩИЙ блок
            // (или за границу doc'а если heading был последним) —
            // setSelection кидал, fail-safe попадал в default-split.
            //
            // Корректно: после insert'а исходный `insertPos` всё ещё
            // указывает на ту же абсолютную позицию ПЕРЕД вставленным
            // blockContainer'ом. Cursor нужен ВНУТРИ нового paragraph'а:
            //   insertPos + 1 — внутрь blockContainer'а
            //   insertPos + 2 — внутрь paragraph'а (на старт content'а)
            const insertPos = $from.after(containerDepth);
            const tr = state.tr.insert(insertPos, newBlock);
            const cursorPos = insertPos + 2;
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
