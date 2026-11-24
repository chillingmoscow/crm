/** ASCII storage keys keep Russian labels without relying on URL escaping. */
export function encodeStaffDocumentName(name: string): string {
  return "hex-" + Array.from(new TextEncoder().encode(name), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function decodeStaffDocumentName(name: string): string {
  if (/^hex-(?:[0-9a-f]{2})+$/i.test(name)) {
    const bytes = name.slice(4).match(/../g)!.map((b) => parseInt(b, 16));
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  }
  return decodeURIComponent(name);
}

/** Форматы файлов в «Документах» сотрудника и их расширение в пути хранилища. */
export const STAFF_DOCUMENT_FORMATS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
};
export const STAFF_DOCUMENT_ACCEPT = Object.keys(STAFF_DOCUMENT_FORMATS).join(",");
export const STAFF_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Почему файл нельзя добавить в «Документы»; null — можно. */
export function staffDocumentProblem(file: { type: string; size: number }, name: string): string | null {
  if (!STAFF_DOCUMENT_FORMATS[file.type] || file.size > STAFF_DOCUMENT_MAX_BYTES)
    return "Выберите JPEG, PNG, WebP, HEIC или PDF размером до 10 МБ";
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) return "Укажите название документа до 100 символов";
  return null;
}

/**
 * Путь файла в хранилище `staff-documents`. Название документа кодируется в
 * ASCII, исходное имя файла в путь не попадает.
 */
export function staffDocumentPath(input: {
  venueId: string; userId: string; name: string; type: string; timestamp: number; nonce: string;
}): string {
  const extension = STAFF_DOCUMENT_FORMATS[input.type];
  return `${input.venueId}/${input.userId}/passport/${input.timestamp}__${encodeStaffDocumentName(input.name.trim())}__${input.nonce}.${extension}`;
}
