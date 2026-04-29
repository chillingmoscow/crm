// Типы для фильтров транзакций

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface AmountRange {
  min: number | null;
  max: number | null;
}

export interface TransactionFiltersType {
  dateRange: DateRange;
  type: string;
  accountIds: string[];
  categoryIds: string[];
  counterpartyIds: string[];
  amountRange: AmountRange;
}

export interface FilterItem {
  id: string;
  name: string;
  groupId?: string;
}

export interface FilterGroup {
  id: string;
  name: string;
}

export interface FilterDataItem {
  id: string;
  name: string;
  groupId?: string;
}

export interface FilterDataGroup {
  id: string;
  name: string;
}

export interface MultiSelectFilterProps {
  title: string;
  placeholder: string;
  items: FilterItem[];
  groups?: FilterGroup[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  onClear?: () => void;
  showApplyButton?: boolean;
}

export interface TransactionFiltersProps {
  filters: TransactionFiltersType;
  onFiltersChange: (filters: TransactionFiltersType) => void;
  accounts: FilterDataItem[];
  categories: FilterDataItem[];
  counterparties: FilterDataItem[];
  accountGroups?: FilterDataGroup[];
  categoryGroups?: FilterDataGroup[];
  counterpartyGroups?: FilterDataGroup[];
} 