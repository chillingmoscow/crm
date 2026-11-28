import "server-only";
import { cache } from "react";

import { getKbPageBySlug } from "@/lib/knowledge/pages";

/**
 * `getKbPageBySlug` с кэшем на время одного запроса: название вкладки
 * (`generateMetadata`) и сама страница читают строку один раз.
 * Отдельным модулем: `pages.ts` — "use server" и не может экспортировать
 * `cache(...)`.
 */
export const getKbPageBySlugCached = cache(getKbPageBySlug);
