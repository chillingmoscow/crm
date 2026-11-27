/** Строки подряд с одним ключом — одна группа. Порядок не меняется. */
export function groupConsecutiveRows<R>(rows: readonly R[], key: (row: R) => string) {
  const out: Array<{ key: string; rows: R[] }> = [];
  for (const row of rows) {
    const value = key(row);
    const last = out[out.length - 1];
    if (last && last.key === value) last.rows.push(row);
    else out.push({ key: value, rows: [row] });
  }
  return out;
}
