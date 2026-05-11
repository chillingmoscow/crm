/** Helpers поверх ProseMirror-документа BlockNote'а: используются
 *  SupabaseThreadStore для re-anchoring mark'ов комментариев когда
 *  сохранённые PM-позиции расходятся с реальным content'ом
 *  (например, после edit'а соседнего блока). */

/** Возвращает текст между двумя PM-позициями. Использует tiptap view
 *  если он доступен; возвращает null если editor ещё не инициализирован
 *  или диапазон out-of-range.
 *
 *  Block-separator = "\n" (если выделение пересекает границу блоков),
 *  leafText = "" — атомарные leaf-ноды (mention chip и т.п.) не
 *  считаем char'ами, чтобы fingerprint фокусировался на text-content. */
export function readDocTextBetween(
  editor: unknown,
  from: number,
  to: number,
): string | null {
  const view = (editor as
    | {
        _tiptapEditor?: {
          view?: {
            state: {
              doc: {
                content: { size: number };
                textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
              };
            };
          };
        }
      } | null)?._tiptapEditor?.view;
  if (!view) return null;
  const doc = view.state.doc;
  const docSize = doc.content.size;
  if (from < 0 || to > docSize || from >= to) return null;
  try {
    return doc.textBetween(from, to, "\n", "");
  } catch {
    return null;
  }
}

/** Перебирает все text-узлы doc'а и склеивает их в плоскую строку
 *  с маппингом каждого char'а в абсолютную PM-позицию. Используется
 *  в applyAllMarksToEditor для re-anchor'а: если metadata.text не
 *  совпадает с текстом по сохранённым PM-позициям, ищем text в
 *  плоской строке и пересчитываем PM-позиции для marka.
 *
 *  Атомарные leaf-ноды (mentions, attachment-chips) не вносят char'ов
 *  — flat string содержит ТОЛЬКО реальные text-content символы из
 *  text-узлов. Это совпадает с поведением `readDocTextBetween` без
 *  leafText. */
export function buildDocCharMap(doc: {
  descendants: (
    cb: (node: { isText: boolean; text?: string }, pos: number) => void,
  ) => void;
}): { flat: string; pmPositions: number[] } {
  const flat: string[] = [];
  const pmPositions: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || typeof node.text !== "string") return;
    for (let i = 0; i < node.text.length; i++) {
      flat.push(node.text[i]);
      pmPositions.push(pos + i);
    }
  });
  return { flat: flat.join(""), pmPositions };
}
