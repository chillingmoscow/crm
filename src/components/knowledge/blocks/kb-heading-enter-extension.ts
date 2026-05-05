/**
 * Tiptap-extension, который меняет поведение Enter В НАЧАЛЕ heading'а:
 *
 *  - До: cursor at start of H1 + Enter → новая пустая H1 ВЫШЕ, исходный
 *    H1 толкается вниз. По умолчанию ProseMirror split keeps node-type.
 *  - После: новая пустая строка ВЫШЕ — обычный paragraph (не heading).
 *    Это совпадает с Word / Notion / Google Docs UX-конвенцией: над
 *    заголовком обычно идёт body-текст.
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

        // BN PM-schema: `blockContainer { content: "blockContent
        // blockGroup?" }` — внутри одного container'а ровно один
        // blockContent + опциональный blockGroup. Вставка paragraph'а
        // как сиблинга heading'а ВНУТРИ контейнера ломает схему и
        // кидает Transformation Error на tr.insert (Codex P1 на PR
        // #119).
        //
        // Правильно: создать НОВЫЙ blockContainer (с paragraph внутри)
        // и вставить его ПЕРЕД текущим контейнером — на уровень выше.
        // ID нового блока auto-генерится BN-овской UniqueID-extension'ой
        // в appendTransaction.
        const blockContainerType = state.schema.nodes.blockContainer;
        const paragraphType = state.schema.nodes.paragraph;
        if (!blockContainerType || !paragraphType) return false;

        // $from.depth — глубина heading-content; depth - 1 — глубина
        // blockContainer'а. Если меньше 2 ($from.parent — top-level
        // node) — пропускаем, не наша ситуация.
        if ($from.depth < 2) return false;

        const newBlock = blockContainerType.create(
          null,
          paragraphType.create(),
        );
        const insertPos = $from.before($from.depth - 1);
        try {
          const tr = state.tr.insert(insertPos, newBlock);
          view.dispatch(tr);
        } catch {
          // Fail-safe: если по какой-то причине схема не приняла
          // вставку — пропускаем default-Enter (`return false`),
          // чтобы юзер не оказался в состоянии «Enter не работает».
          return false;
        }
        return true;
      },
    };
  },
});
