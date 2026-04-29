// Константы для фильтров транзакций

export const TRANSACTION_TYPES = [
  { value: 'all', label: 'Все' },
  { value: 'income', label: 'Приход' },
  { value: 'expense', label: 'Расход' },
  { value: 'transfer', label: 'Переводы' }
] as const;

export const FILTER_PLACEHOLDERS = {
  TRANSACTION_TYPES: 'Типы операций',
  ACCOUNTS: 'Счета',
  CATEGORIES: 'Статьи', 
  COUNTERPARTIES: 'Контрагенты'
} as const;

export const SPECIAL_FILTER_IDS = {
  NO_CATEGORY: 'no-category',
  NO_COUNTERPARTY: 'no-counterparty'
} as const;

export const FILTER_GROUP_IDS = {
  ALL: 'all',
  SPECIAL: 'special',
  UNGROUPED: 'ungrouped'
} as const;

export const FILTER_STYLES = {
  CONTAINER: {
    mb: 2,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 1,
    alignItems: 'center',
    p: 2,
    backgroundColor: '#FAFAFA',
    borderRadius: '12px',
    border: '1px solid #E0E0E0'
  },
  FILTER_BUTTON: {
    borderRadius: '20px',
    textTransform: 'none' as const,
    fontSize: '0.875rem',
    minHeight: 'auto',
    py: 0.5,
    px: 2
  },
  ACTIVE_FILTER: {
    backgroundColor: '#E3F2FD',
    borderColor: '#1976D2',
    color: '#1976D2'
  },
  INACTIVE_FILTER: {
    backgroundColor: '#F3F4F6',
    borderColor: 'transparent',
    color: 'text.secondary'
  },
  CLEAR_BUTTON: {
    borderRadius: '20px',
    borderColor: '#DC2626',
    color: '#DC2626',
    textTransform: 'none' as const,
    fontSize: '0.875rem',
    minHeight: 'auto',
    py: 0.5,
    px: 2,
    '&:hover': {
      borderColor: '#EF4444',
      backgroundColor: '#FEF2F2',
      color: '#DC2626'
    }
  }
} as const;

export const FILTERS_VISIBILITY_STORAGE_KEY = 'transactions-filters-visible'; 