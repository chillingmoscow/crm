export const KNOWLEDGE_FILE_FORMAT_HINT: Record<string, string> = {
  video: "MP4, MOV, WebM · до 50 МБ",
  image: "PNG, JPG, GIF, WEBP · до 10 МБ",
  audio: "MP3, WAV, OGG, M4A · до 50 МБ",
  file: "Любой файл · до 50 МБ",
};

const MAX_BYTES: Record<string, number> = {
  video: 50 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  file: 50 * 1024 * 1024,
};

const MIME_PATTERNS: Record<string, RegExp | null> = {
  video: /^video\//,
  image: /^image\/(png|jpe?g|gif|webp)$/,
  audio: /^audio\//,
  file: null,
};

const EXT_PATTERNS: Record<string, RegExp | null> = {
  video: /\.(mp4|mov|webm|m4v|ogv)$/i,
  image: /\.(png|jpe?g|gif|webp)$/i,
  audio: /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i,
  file: null,
};

export interface KnowledgeFileLike {
  name: string;
  size: number;
  type?: string;
}

export function validateKnowledgeFile(
  file: KnowledgeFileLike,
  blockType: string,
): string | null {
  const maxBytes = MAX_BYTES[blockType] ?? MAX_BYTES.file;
  if (file.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    return `Файл слишком большой (${fileMb} МБ). Лимит — ${limitMb} МБ.`;
  }

  const mimePattern = MIME_PATTERNS[blockType];
  const extPattern = EXT_PATTERNS[blockType];
  if (mimePattern && extPattern) {
    const extOk = extPattern.test(file.name);
    const type = file.type ?? "";
    const passes = type ? mimePattern.test(type) || extOk : extOk;
    if (!passes) {
      return `Неподходящий формат: ${type || file.name.split(".").pop() || "?"}. Поддерживаются: ${KNOWLEDGE_FILE_FORMAT_HINT[blockType]}.`;
    }
  }

  return null;
}
