/**
 * Утилиты для работы с именем + расширением файла в KB-блоках.
 *
 * Юзер-фидбек на PR #153:
 *   1. «Расширение файла теперь есть и в самом названии, и дублируется
 *      отдельно справа. Хотелось бы скрывать расширение в названии. И
 *      показывать его только справа.»
 *   2. «Переименовал PDF файл в "Преза.docx" — в расширении теперь тоже
 *      указано docx.» — т.е. юзер не должен иметь возможность менять
 *      реальное расширение через rename. Файл на сервере остаётся PDF,
 *      и подделывать его расширение в UI вводит в заблуждение.
 *
 * Решение: ВСЕГДА хранить полное имя в `block.props.name` (включая ext)
 * — это то имя, которое пойдёт в Content-Disposition при download'е, —
 * но при отображении и редактировании работаем только с basename'ом,
 * расширение показываем как отдельную read-only метку.
 */

/** Detect-pattern для расширения файла. Должно начинаться с буквы (так
 *  не путаем версию-суффикс «v2.0» с расширением — Codex P2 на #153),
 *  далее 0-9 букв/цифр. */
const EXT_RE = /\.[a-zA-Z][a-zA-Z0-9]{0,9}$/;

/** Разбиваем имя файла на basename + extension. Если расширение не
 *  распознано (digit-led суффикс типа `.7z` или вообще без точки) —
 *  отдаём всё имя как basename, extension = "".
 *
 *  Примеры:
 *    «Преза.pdf»        → { basename: «Преза»,        extension: «.pdf» }
 *    «Report v2.0»      → { basename: «Report v2.0»,  extension: «»     }
 *    «archive.7z»       → { basename: «archive.7z»,   extension: «»     }
 *    «notes»            → { basename: «notes»,        extension: «»     }
 */
export function splitFileName(name: string | undefined | null): {
  basename: string;
  extension: string;
} {
  if (!name) return { basename: "", extension: "" };
  const m = name.match(EXT_RE);
  if (!m) return { basename: name, extension: "" };
  const ext = m[0];
  return { basename: name.slice(0, name.length - ext.length), extension: ext };
}

/** Сборка имени обратно: основа + (опциональное) расширение. Если ext
 *  не задан — basename как есть. Если ext задан и basename уже им
 *  заканчивается (юзер-копипаст) — не дублируем. */
export function joinFileName(basename: string, extension: string): string {
  const trimmed = basename.trim();
  if (!extension) return trimmed;
  if (trimmed.toLowerCase().endsWith(extension.toLowerCase())) return trimmed;
  return trimmed + extension;
}
