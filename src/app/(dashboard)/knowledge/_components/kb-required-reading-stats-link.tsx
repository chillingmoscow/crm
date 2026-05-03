import Link from "next/link";
import { BookCheck } from "lucide-react";

import { IconTooltip } from "@/components/ui/icon-tooltip";

/**
 * Кнопка-ссылка «Кто прочитал» в page-header. Видна только когда:
 *   — у юзера есть `kb.manage_required_reading` (gated в parent server-
 *     компоненте `[slug]/page.tsx`)
 *   — на странице действительно стоит флаг required-reading
 *     (gated там же — без флага список бесполезен)
 *
 * Sprint D / Phase 2.
 */
export function KbRequiredReadingStatsLink({ slug }: { slug: string }) {
  return (
    <IconTooltip label="Кто прочитал">
      <Link
        href={`/knowledge/${slug}/required-reading`}
        aria-label="Открыть список тех, кто прочитал страницу"
        className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <BookCheck className="w-[18px] h-[18px]" />
      </Link>
    </IconTooltip>
  );
}
