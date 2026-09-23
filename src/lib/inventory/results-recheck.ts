// Сверка построчных итогов перед проведением акта.
//
// Расчётный остаток приходит из Quick Resto и пересчитывается им, когда в учёте
// меняются данные за период до даты акта. Между тем моментом, когда проверяющий
// посмотрел «Итоги», и моментом, когда он нажал «Подвести итоги», числа могли
// уехать — и тогда утверждают одно, а в QR проводится другое. Реальный случай:
// акт СВ340, проверяющий видел итог +89,25 ₽, провелось +16 301,75 ₽.

export type InventoryRecheckLine = {
  externalItemId: string;
  differenceAmount: number | null;
  differenceSum: number | null;
};

export type InventoryRecheckDiff = {
  changedLines: number;
  addedLines: number;
  removedLines: number;
  beforeTotal: number;
  afterTotal: number;
  /** Названия/ключи изменившихся строк — для сообщения пользователю. */
  changedKeys: string[];
};

const EPSILON = 0.005;

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function total(lines: InventoryRecheckLine[]) {
  return lines.reduce((sum, line) => sum + finite(line.differenceSum), 0);
}

/**
 * Что изменилось в построчных итогах между двумя чтениями акта.
 *
 * Сравниваем и сумму, и количество: расхождение может «переехать» между
 * строками, не поменяв общий итог, — для проверяющего это всё равно другие
 * данные.
 */
export function compareResultLines(
  before: InventoryRecheckLine[],
  after: InventoryRecheckLine[],
): InventoryRecheckDiff {
  const beforeByKey = new Map(before.map((line) => [line.externalItemId, line]));
  const afterByKey = new Map(after.map((line) => [line.externalItemId, line]));

  const changedKeys: string[] = [];
  for (const [key, afterLine] of afterByKey) {
    const beforeLine = beforeByKey.get(key);
    if (!beforeLine) continue;
    const sumChanged = Math.abs(finite(afterLine.differenceSum) - finite(beforeLine.differenceSum)) > EPSILON;
    const amountChanged =
      Math.abs(finite(afterLine.differenceAmount) - finite(beforeLine.differenceAmount)) > 0.000001;
    if (sumChanged || amountChanged) changedKeys.push(key);
  }

  let addedLines = 0;
  for (const key of afterByKey.keys()) if (!beforeByKey.has(key)) addedLines += 1;
  let removedLines = 0;
  for (const key of beforeByKey.keys()) if (!afterByKey.has(key)) removedLines += 1;

  return {
    changedLines: changedKeys.length,
    addedLines,
    removedLines,
    beforeTotal: total(before),
    afterTotal: total(after),
    changedKeys,
  };
}

export function hasResultDrift(diff: InventoryRecheckDiff): boolean {
  return diff.changedLines > 0 || diff.addedLines > 0 || diff.removedLines > 0;
}

function formatRub(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ₽`;
}

// Локальное склонение: модуль намеренно без импортов из `@/...`, чтобы
// node:test мог подключить его напрямую (как act-status.ts).
function plural(n: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Сообщение проверяющему: что именно разъехалось и что делать. */
export function describeResultDrift(diff: InventoryRecheckDiff): string {
  const parts: string[] = [];
  if (diff.changedLines > 0) {
    const n = diff.changedLines;
    parts.push(`${plural(n, "изменилась", "изменились", "изменились")} ${n} ${plural(n, "строка", "строки", "строк")}`);
  }
  if (diff.addedLines > 0) parts.push(`добавилось строк: ${diff.addedLines}`);
  if (diff.removedLines > 0) parts.push(`исчезло строк: ${diff.removedLines}`);

  return (
    `Данные в Quick Resto изменились с момента, когда вы смотрели итоги: ${parts.join(", ")}. ` +
    `Итог был ${formatRub(diff.beforeTotal)}, стал ${formatRub(diff.afterTotal)}. ` +
    `Таблица уже обновлена — проверьте цифры и подведите итоги ещё раз, чтобы утвердить именно то, что проведётся.`
  );
}
