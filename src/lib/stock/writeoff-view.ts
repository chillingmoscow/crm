import {
  writeoffKindLabels,
  type StoredWriteoff,
  type WriteoffArchive,
} from "./writeoffs";
export type WriteoffRow = {
  id: string;
  date: string;
  name: string;
  correspondent: string;
  kind: string;
  status: string;
  reason: string;
  store: string;
  quantity: string | null;
  total: number | null;
  issues: string[];
  native?: StoredWriteoff;
  archive?: WriteoffArchive;
};
export function writeoffRows(
  documents: StoredWriteoff[],
  archives: WriteoffArchive[],
  source: "native" | "archive",
): WriteoffRow[] {
  if (source === "native")
    return documents
      .map((d) => ({
        id: d.id,
        date: d.business_date,
        name: d.payload.number,
        correspondent:
          d.payload.operatorName ?? writeoffKindLabels[d.payload.kind],
        kind: writeoffKindLabels[d.payload.kind],
        status: d.missing_at
          ? "Нет в источнике"
          : d.payload.processed
            ? "Проведён"
            : "Черновик",
        reason: d.payload.reason ?? "—",
        store: d.payload.storeName,
        quantity: null,
        total: d.payload.total,
        issues: d.payload.issues,
        native: d,
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const latest = new Map<string, WriteoffArchive>();
  for (const r of archives) {
    const old = latest.get(r.legacy_ref);
    if (
      !old ||
      r.captured_at > old.captured_at ||
      (r.captured_at === old.captured_at && r.id > old.id)
    )
      latest.set(r.legacy_ref, r);
  }
  return [...latest.values()]
    .map((a) => ({
      id: a.id,
      date: a.business_date,
      name: a.name,
      correspondent: a.correspondent,
      kind: a.kind,
      status: a.deleted ? "Удалено" : "Архив",
      reason: a.category ?? "—",
      store: "—",
      quantity: a.quantity,
      total: a.total,
      issues: a.issues,
      archive: a,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
export function writeoffTotal(rows: WriteoffRow[]) {
  const counted = rows.filter((r) =>
    r.native
      ? !r.native.missing_at && r.native.payload.processed
      : !r.archive?.deleted,
  );
  const known = counted.flatMap((r) => (r.total === null ? [] : [r.total]));
  return {
    value: known.length
      ? Math.round(known.reduce((s, n) => s + n, 0) * 100) / 100
      : null,
    known: known.length,
    total: counted.length,
  };
}
/** Shared by the on-screen table and a fresh CSV read. */
export function filterWriteoffs(
  rows: WriteoffRow[],
  month: string,
  kind: string,
  search: string,
) {
  const needle = search.normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
  return rows.filter(
    (r) =>
      r.date.startsWith(month.slice(0, 7)) &&
      (kind === "all" || r.kind === kind) &&
      [
        r.name,
        r.correspondent,
        r.reason,
        r.store,
        r.date,
        new Date(`${r.date}T12:00:00`).toLocaleDateString("ru-RU"),
        new Date(`${r.date}T12:00:00`).toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        ...(r.native?.payload.lines.flatMap((l) => [l.name, ...l.categories]) ??
          []),
      ]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase("ru-RU")
        .includes(needle),
  );
}
