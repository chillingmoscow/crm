export type ColumnMetric = {
  size: number;
  min: number;
  max: number;
  fixed?: boolean;
};

/** Allocate the available width while honoring actual pixel minima and fixed service columns. */
export function fitColumnWidths(
  columns: ColumnMetric[],
  available: number,
): number[] {
  const result = columns.map((c) => (c.fixed ? c.size : c.min));
  let remaining =
    Math.max(
      available,
      result.reduce((a, b) => a + b, 0),
    ) - result.reduce((a, b) => a + b, 0);
  let flexible = columns
    .map((c, i) => i)
    .filter((i) => !columns[i].fixed && result[i] < columns[i].max);
  while (remaining > 0.01 && flexible.length) {
    const weight = flexible.reduce(
      (s, i) => s + Math.max(1, columns[i].size - columns[i].min),
      0,
    );
    const before = remaining;
    for (const i of flexible) {
      const add = Math.min(
        columns[i].max - result[i],
        (before * Math.max(1, columns[i].size - columns[i].min)) / weight,
      );
      result[i] += add;
      remaining -= add;
    }
    flexible = flexible.filter((i) => result[i] < columns[i].max - 0.01);
  }
  return result;
}

/** Resize a data column independently; scrolling absorbs growth without squeezing other headers. */
export function resizeColumnWidths(
  widths: number[],
  columns: ColumnMetric[],
  index: number,
  delta: number,
): number[] {
  const next = [...widths];
  if (!columns[index].fixed)
    next[index] = Math.max(
      columns[index].min,
      Math.min(columns[index].max, widths[index] + delta),
    );
  return next;
}
