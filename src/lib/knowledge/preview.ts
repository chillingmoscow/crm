"use server";

import { createClient } from "@/lib/supabase/server";
import { estimateReadingMinutes } from "@/lib/knowledge/reading-time";

export interface KbPagePreview {
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  /** Первые ~180 символов plain_text — достаточно для tooltip-snippet'а
   *  но не нагружает payload. */
  snippet: string;
  /** Минут чтения (через estimateReadingMinutes). 0/null если страница
   *  пустая. */
  reading_minutes: number | null;
  required_reading: boolean;
  is_locked: boolean;
}

const SNIPPET_LENGTH = 180;

/** Preview KB-страницы для inline-link tooltip'а. RLS на kb_pages
 *  фильтрует по active account и kb.view_pages — если caller не
 *  имеет доступа, .maybeSingle() вернёт null.
 *
 *  Sprint D Phase 7 / plan §2.X (inline-preview tooltip). Вызывается
 *  из client'а KbLinkPreview на hover @-mention'ом. Кэшируется на
 *  client-side per-slug. */
export async function getKbPagePreview(
  slug: string,
): Promise<{ preview: KbPagePreview | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select(
      "slug, title, icon, icon_color, plain_text, required_reading, locked_at",
    )
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { preview: null, error: error.message };
  if (!data) return { preview: null, error: null };

  const plain = data.plain_text ?? "";
  const trimmed = plain.trim();
  const snippet =
    trimmed.length > SNIPPET_LENGTH
      ? trimmed.slice(0, SNIPPET_LENGTH).trimEnd() + "…"
      : trimmed;
  const readingMinutes = trimmed.length > 0 ? estimateReadingMinutes(plain) : null;

  return {
    preview: {
      slug: data.slug,
      title: data.title,
      icon: data.icon,
      icon_color: data.icon_color,
      snippet,
      reading_minutes: readingMinutes,
      required_reading: data.required_reading,
      is_locked: data.locked_at !== null,
    },
    error: null,
  };
}
