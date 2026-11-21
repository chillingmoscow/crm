import Link from "next/link";
import { Split } from "lucide-react";

import type { AuditEvent } from "@/lib/audit/list";
import { pluralRu } from "@/lib/format/plural";
import {
  writeoffJournalNumber,
  writeoffJournalNumbers,
  writeoffJournalPayer,
} from "@/lib/stock/writeoff-journal";
import type { AuditEventSpec } from "./format";

// «Кто платит» за акты списания в общем журнале: `stock.writeoffs.pool_*`.
// Пишут RPC set_writeoff_pool и set_writeoff_pool_bulk (миграции 308, 368).
// С 368 в details есть номер акта и имена плательщиков на момент записи; у
// более старых строк их нет, тогда фраза обходится вариантом без имени.

const INFO = "text-brand bg-brand/10";

/** «акт списания № 15» — ссылка на карточку акта в журнале списаний. */
function ActRef({ event, genitive = false }: { event: AuditEvent; genitive?: boolean }) {
  const number = writeoffJournalNumber(event.details.number);
  const ext = Number(event.details.externalId);
  const noun = genitive ? "акта списания" : "акт списания";
  const label = number ? `${noun} ${number}` : noun;
  if (!Number.isSafeInteger(ext) || ext <= 0)
    return <strong className="font-medium">{label}</strong>;
  return (
    <Link
      href={`/documents/writeoffs?act=${ext}`}
      className="font-medium hover:underline"
    >
      {label}
    </Link>
  );
}

export const writeoffAuditSpecs: Record<string, AuditEventSpec> = {
  "stock.writeoffs.pool_assigned": {
    icon: Split,
    iconClass: INFO,
    buildHeadline: (e) => {
      const after = writeoffJournalPayer(e.details.after);
      if (!after)
        return (
          <>
            снял(а) разнесение <ActRef event={e} genitive />
          </>
        );
      return (
        <>
          разнес(ла) <ActRef event={e} />: {after}
        </>
      );
    },
    buildDetails: (e) => {
      const before = writeoffJournalPayer(e.details.before);
      const after = writeoffJournalPayer(e.details.after);
      if (!before) return null;
      return (
        <p className="text-xs text-muted-foreground">
          {after ? `${before} → ${after}` : `Было: ${before}`}
        </p>
      );
    },
  },
  "stock.writeoffs.pool_bulk_assigned": {
    icon: Split,
    iconClass: INFO,
    buildHeadline: (e) => {
      const count = Number(e.details.count ?? 0);
      const after = writeoffJournalPayer(e.details.after) ?? "плательщик не указан";
      return (
        <>
          разнес(ла) {count} {pluralRu(count, "акт", "акта", "актов")} списания:{" "}
          {after}
        </>
      );
    },
    buildDetails: (e) => {
      const acts = Array.isArray(e.details.acts) ? e.details.acts : [];
      const numbers = writeoffJournalNumbers(acts);
      const replaced = acts.filter(
        (a) => writeoffJournalPayer((a as { before?: unknown } | null)?.before) !== null,
      ).length;
      const skipped = Number(e.details.skipped ?? 0);
      const lines = [
        numbers ? `Акты: ${numbers}` : null,
        replaced > 0 ? `Сменён плательщик: ${replaced}` : null,
        skipped > 0 ? `Пропущено: ${skipped}` : null,
      ].filter((x): x is string => !!x);
      if (!lines.length) return null;
      return (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      );
    },
  },
};
