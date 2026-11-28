"use client";

import { KbRouteError } from "@/app/(dashboard)/knowledge/_components/kb-route-states";

export default function KnowledgePageError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <KbRouteError {...props} title="Не удалось открыть страницу" />;
}
