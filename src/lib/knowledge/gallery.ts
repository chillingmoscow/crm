export type KbGalleryColumns = 2 | 3 | 4 | 5;

export interface KbGalleryItem {
  id: string;
  url: string;
  source: "upload" | "url";
  name?: string;
  caption?: string;
  alt?: string;
}

export interface KbGalleryData {
  version: 1;
  images: KbGalleryItem[];
}

export const KB_GALLERY_DEFAULT_COLUMNS: KbGalleryColumns = 3;
export const KB_GALLERY_EMPTY_JSON = JSON.stringify({
  version: 1,
  images: [],
} satisfies KbGalleryData);

export function coerceGalleryColumns(value: unknown): KbGalleryColumns {
  return value === 2 || value === 3 || value === 4 || value === 5
    ? value
    : KB_GALLERY_DEFAULT_COLUMNS;
}

export function parseGalleryItemsJson(value: unknown): KbGalleryData {
  if (typeof value !== "string" || value.trim() === "") {
    return { version: 1, images: [] };
  }

  try {
    const raw = JSON.parse(value) as {
      version?: unknown;
      images?: unknown;
    };
    if (!Array.isArray(raw.images)) {
      return { version: 1, images: [] };
    }
    return {
      version: 1,
      images: raw.images
        .map(normalizeGalleryItem)
        .filter((item): item is KbGalleryItem => item !== null),
    };
  } catch {
    return { version: 1, images: [] };
  }
}

export function serializeGalleryItems(images: KbGalleryItem[]): string {
  return JSON.stringify({
    version: 1,
    images: images
      .map(normalizeGalleryItem)
      .filter((item): item is KbGalleryItem => item !== null),
  } satisfies KbGalleryData);
}

export function isLikelyImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(trimmed)) return true;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return /\.(png|jpe?g|gif|webp)$/i.test(parsed.pathname);
}

export function extractImageUrlsFromText(value: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const matches = value.match(/https?:\/\/[^\s"'<>]+|data:image\/[^\s"'<>]+/gi);
  for (const match of matches ?? []) {
    const cleaned = match.replace(/[),.;]+$/g, "");
    if (!isLikelyImageUrl(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    urls.push(cleaned);
  }
  return urls;
}

export function galleryItemText(item: KbGalleryItem): string {
  return [item.caption, item.alt, item.name].filter(Boolean).join(" ").trim();
}

function normalizeGalleryItem(value: unknown): KbGalleryItem | null {
  const raw = value as Partial<KbGalleryItem> | null;
  if (!raw || typeof raw.url !== "string" || raw.url.trim() === "") {
    return null;
  }

  const id =
    typeof raw.id === "string" && raw.id.trim() !== ""
      ? raw.id.trim()
      : fallbackItemId(raw.url);
  const source = raw.source === "upload" ? "upload" : "url";

  return {
    id,
    url: raw.url.trim(),
    source,
    name: cleanOptionalString(raw.name),
    caption: cleanOptionalString(raw.caption),
    alt: cleanOptionalString(raw.alt),
  };
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function fallbackItemId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0;
  }
  return `img_${Math.abs(hash).toString(36)}`;
}
