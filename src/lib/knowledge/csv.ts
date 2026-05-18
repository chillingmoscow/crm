/**
 * Минимальный RFC-4180 CSV-парсер (Notion экспортирует базы как
 * стандартный CSV: запятая-разделитель, `"`-кавычки, экранирование
 * `""`, переносы строк и запятые внутри кавычек, CRLF/ LF). Без
 * внешней зависимости — нужен только для импорта.
 *
 * Возвращает массив строк-массивов ячеек (включая строку-заголовок).
 * Пустой ввод → []. Завершающий перевод строки не даёт лишней
 * пустой строки.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = input.length;
  // BOM
  if (input.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF или одиночный CR
      if (input[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Хвост: если что-то накопилось (или была хотя бы одна ячейка) —
  // финализируем последнюю строку. Игнорируем абсолютно пустой хвост.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows;
}
