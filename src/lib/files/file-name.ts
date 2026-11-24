/**
 * Помощники для названий и вида файлов: общие для сервера и браузера.
 */

/**
 * Чуть меньше 50 МБ (`storage.file_size_limit` и лимит тела server action):
 * у запроса с файлом есть свои накладные байты.
 */
export const MAX_FILE_BYTES = 49 * 1024 * 1024;

const MAX_NAME_LENGTH = 200;
const EXTENSION = /\.([a-z0-9]{1,5})$/i;
const PREVIEW_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type RenameResult = { name: string; error: null } | { name: null; error: string };

/**
 * Новое название файла из того, что ввёл пользователь. Расширение исходного
 * файла сохраняется: без него PDF перестал бы открываться как PDF.
 */
export function renameFileName(current: string, input: string): RenameResult {
  // Управляющие и невидимые символы (в том числе смена направления текста,
  // которой маскируют «.exe» под «.pdf») в названии не нужны.
  if (/[\p{Cc}\p{Cf}]/u.test(input.replace(/[\t\n\r]/g, " "))) {
    return { name: null, error: "Название не может содержать служебные символы" };
  }
  const base = input.replace(/\s+/g, " ").trim();
  if (!base) return { name: null, error: "Укажите название файла" };
  if (/[/\\]/.test(base)) return { name: null, error: "Название не может содержать / и \\" };

  const ext = EXTENSION.exec(current)?.[0] ?? "";
  const name = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;
  if (name.length > MAX_NAME_LENGTH) return { name: null, error: "Название длиннее 200 символов" };
  return { name, error: null };
}

/**
 * Как показать файл в окне предпросмотра. Только по сохранённому типу:
 * название меняет пользователь, и HTML с именем «.pdf» во встроенный
 * просмотрщик попасть не должен.
 */
export function filePreviewKind(mime: string): "pdf" | "image" | "none" {
  if (mime === "application/pdf") return "pdf";
  if (PREVIEW_IMAGE_TYPES.has(mime)) return "image";
  return "none";
}

/** Короткая подпись вида файла: «Фото», «PDF», «DOCX». */
export function fileKindLabel(mime: string, name: string): string {
  if (mime.startsWith("image/")) return "Фото";
  if (mime === "application/pdf") return "PDF";
  const ext = EXTENSION.exec(name)?.[1];
  return ext ? ext.toUpperCase() : "Файл";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}
