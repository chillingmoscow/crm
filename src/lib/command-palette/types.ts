export type PaletteGroup =
  | "staff"
  | "candidates"
  | "guests"
  | "acts"
  | "transactions"
  | "knowledge";

export type PaletteHit = {
  group: PaletteGroup;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** Человек: в строке — аватар (фото или инициалы). */
  person?: boolean;
  avatarUrl?: string | null;
  /** Страница базы знаний: её иконка. */
  kbIcon?: string | null;
  kbIconColor?: string | null;
};

export type PaletteSearchResult = { hits: PaletteHit[] };

export const PALETTE_GROUP_LABEL: Record<PaletteGroup, string> = {
  staff: "Сотрудники",
  candidates: "Кандидаты",
  guests: "Гости",
  acts: "Акты инвентаризации",
  transactions: "Транзакции",
  knowledge: "База знаний",
};
