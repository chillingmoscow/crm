import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";

import { countRu, pluralRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";

/** «3 платежа ждут разбора». */
export function inboxCountText(count: number): string {
  return `${countRu(count, "платёж", "платежа", "платежей")} ${pluralRu(
    count,
    "ждёт",
    "ждут",
    "ждут",
  )} разбора`;
}

/**
 * Красная плашка над шапкой «Дашборда» и «Транзакций»: есть ожидаемые
 * платежи, по которым нужно решение. Вся плашка — ссылка в «На разбор».
 * При нуле не рисуется.
 */
export function InboxPlaque({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <Link
      href="/finance/inbox"
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1">{inboxCountText(count)}</span>
      <span className="inline-flex shrink-0 items-center gap-1 font-medium">
        Разобрать
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}
