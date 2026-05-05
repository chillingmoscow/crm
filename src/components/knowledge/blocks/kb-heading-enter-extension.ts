/**
 * Tiptap-extension, который меняет поведение Enter В НАЧАЛЕ heading'а:
 *
 *  - До: cursor at start of H1 + Enter → новая пустая H1 ВЫШЕ, исходный
 *    H1 толкается вниз. По умолчанию ProseMirror split keeps node-type.
 *  - После: новая пустая строка ВЫШЕ — обычный paragraph (не heading).
 *    Это совпадает с Word / Notion / Google Docs UX-конвенцией: над
 *    заголовком обычно идёт body-текст.
 *
 * Реализация: на keypress Enter проверяем, что:
 *   1. курсор в начале текущей ноды (`$from.parentOffset === 0`),
 *   2. нода — heading.
 * Если оба true: вставляем пустой `paragraph`-node ПЕРЕД текущей и
 * откатываем default-Enter (которое бы split'нуло heading на две
 * heading-половинки).
 *
 * Подключается через `extensions: [...]` на `useCreateBlockNote`.
 */
import { Extension } from "@tiptap/core";

export const KbHeadingEnterExtension = Extension.create({
  name: "kbHeadingEnter",

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parentOffset !== 0) return false;
        const node = $from.parent;
        if (node.type.name !== "heading") return false;

        // Создаём пустой paragraph и вставляем его ПЕРЕД текущим
        // heading'ом. Cursor остаётся в heading'е (после вставки выше
        // позиция heading'а сдвигается, $from.before() указывает на
        // место ДО оригинального heading'а — вот туда и кладём).
        const paragraphType = state.schema.nodes.paragraph;
        if (!paragraphType) return false;
        const paragraph = paragraphType.create();
        const insertPos = $from.before();
        const tr = state.tr.insert(insertPos, paragraph);
        view.dispatch(tr);
        return true;
      },
    };
  },
});
