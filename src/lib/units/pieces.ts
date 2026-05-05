// «Штук» — счётная единица, без conversion factor (единственная
// единица в категории). Отдельный файл для symmetry с mass/volume —
// если позже добавим «упаковка» / «коробка», легко расширить здесь.

export const PIECE_UNIT = {
  code: "piece",
  label: "шт",
  longLabel: "штук",
} as const;

export type PieceUnitCode = typeof PIECE_UNIT.code;
