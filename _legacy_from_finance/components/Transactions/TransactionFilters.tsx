import React from 'react';
import {
  Box,
  Button,
  Select,
  MenuItem,
  FormControl,
  IconButton
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';

import DateRangeFilter from './DateRangeFilter';
import MultiSelectFilter from './MultiSelectFilter';
import AmountRangeFilter from './AmountRangeFilter';

import { TransactionFiltersProps, TransactionFiltersType } from './filters/types';
import { 
  prepareAccountsForFilter, 
  prepareCategoriesForFilter, 
  prepareCounterpartiesForFilter,
  hasActiveFilters 
} from './filters/utils';
import { TRANSACTION_TYPES, FILTER_STYLES, FILTER_PLACEHOLDERS } from './filters/constants';

/**
 * Компонент фильтров для транзакций
 */
const TransactionFilters: React.FC<TransactionFiltersProps> = ({
  filters,
  onFiltersChange,
  accounts,
  categories,
  counterparties,
  accountGroups = [],
  categoryGroups = [],
  counterpartyGroups = []
}) => {
  
  // === Обработчики изменения фильтров ===

  const handleDateRangeChange = (dateRange: { start: Date | null; end: Date | null }) => {
    onFiltersChange({ ...filters, dateRange });
  };

  const handleTypeChange = (event: any) => {
    onFiltersChange({ ...filters, type: event.target.value });
  };

  const handleAccountsChange = (accountIds: string[]) => {
    onFiltersChange({ ...filters, accountIds });
  };

  const handleCategoriesChange = (categoryIds: string[]) => {
    onFiltersChange({ ...filters, categoryIds });
  };

  const handleCounterpartiesChange = (counterpartyIds: string[]) => {
    onFiltersChange({ ...filters, counterpartyIds });
  };

  const handleAmountRangeChange = (amountRange: { min: number | null; max: number | null }) => {
    onFiltersChange({ ...filters, amountRange });
  };

  // === Обработчики сброса фильтров ===

  const handleClearAllFilters = () => {
    onFiltersChange({
      dateRange: { start: null, end: null },
      type: 'all',
      accountIds: [],
      categoryIds: [],
      counterpartyIds: [],
      amountRange: { min: null, max: null }
    });
  };

  const handleClearType = (event: React.MouseEvent) => {
    event.stopPropagation();
    onFiltersChange({ ...filters, type: 'all' });
  };

  const createClearHandler = (filterKey: keyof TransactionFiltersType) => () => {
    if (filterKey === 'amountRange') {
      onFiltersChange({ ...filters, amountRange: { min: null, max: null } });
    } else if (Array.isArray(filters[filterKey])) {
      onFiltersChange({ ...filters, [filterKey]: [] });
    }
  };

  // === Подготовка данных ===

  const accountsForFilter = prepareAccountsForFilter(accounts);
  const categoriesForFilter = prepareCategoriesForFilter(categories);
  const counterpartiesForFilter = prepareCounterpartiesForFilter(counterparties);

  const isTypeActive = filters.type !== 'all';

  // Получаем текущий выбранный тип для отображения
  const getTypeDisplayText = () => {
    if (isTypeActive) {
      const currentType = TRANSACTION_TYPES.find(type => type.value === filters.type);
      return currentType?.label || FILTER_PLACEHOLDERS.TRANSACTION_TYPES;
    }
    return FILTER_PLACEHOLDERS.TRANSACTION_TYPES;
  };

  return (
    <Box sx={FILTER_STYLES.CONTAINER}>
      {/* Фильтр по дате */}
      <DateRangeFilter
        value={filters.dateRange}
        onChange={handleDateRangeChange}
      />

      {/* Фильтр по типу операций */}
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        <FormControl size="small">
          <Select
            value={filters.type}
            onChange={handleTypeChange}
            displayEmpty
            IconComponent={isTypeActive ? () => null : ExpandMoreIcon}
            renderValue={() => getTypeDisplayText()}
            sx={{
              minWidth: 130,
              ...FILTER_STYLES.FILTER_BUTTON,
              ...(isTypeActive ? FILTER_STYLES.ACTIVE_FILTER : FILTER_STYLES.INACTIVE_FILTER),
              pr: isTypeActive ? 6 : 3,
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: isTypeActive ? '#1976D2' : 'transparent',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: isTypeActive ? '#1976D2' : 'transparent',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: 'primary.main',
              },
              '& .MuiSelect-select': {
                py: 0.5,
                px: 2,
                fontSize: '0.875rem',
                minHeight: 'auto'
              }
            }}
          >
            {TRANSACTION_TYPES.map((type) => (
              <MenuItem key={type.value} value={type.value} sx={{ fontSize: '0.875rem' }}>
                {type.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Крестик для сброса типа */}
        {isTypeActive && (
          <IconButton
            size="small"
            onClick={handleClearType}
            sx={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 18,
              height: 18,
              backgroundColor: '#1976D2',
              color: 'white',
              '&:hover': {
                backgroundColor: '#1565C0'
              },
              '& .MuiSvgIcon-root': {
                fontSize: 14
              }
            }}
          >
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      {/* Фильтр по счетам */}
      <MultiSelectFilter
        title=""
        placeholder={FILTER_PLACEHOLDERS.ACCOUNTS}
        items={accountsForFilter}
        groups={accountGroups.map(g => ({ id: g.id, name: g.name }))}
        selectedIds={filters.accountIds}
        onChange={handleAccountsChange}
        onClear={createClearHandler('accountIds')}
        showApplyButton={false}
      />

      {/* Фильтр по категориям */}
      <MultiSelectFilter
        title=""
        placeholder={FILTER_PLACEHOLDERS.CATEGORIES}
        items={categoriesForFilter}
        groups={categoryGroups.map(g => ({ id: g.id, name: g.name }))}
        selectedIds={filters.categoryIds}
        onChange={handleCategoriesChange}
        onClear={createClearHandler('categoryIds')}
        showApplyButton={false}
      />

      {/* Фильтр по контрагентам */}
      <MultiSelectFilter
        title=""
        placeholder={FILTER_PLACEHOLDERS.COUNTERPARTIES}
        items={counterpartiesForFilter}
        groups={counterpartyGroups.map(g => ({ id: g.id, name: g.name }))}
        selectedIds={filters.counterpartyIds}
        onChange={handleCounterpartiesChange}
        onClear={createClearHandler('counterpartyIds')}
        showApplyButton={false}
      />

      {/* Фильтр по сумме */}
      <AmountRangeFilter
        value={filters.amountRange}
        onChange={handleAmountRangeChange}
        onClear={createClearHandler('amountRange')}
      />

      {/* Кнопка очистки всех фильтров */}
      {hasActiveFilters(filters) && (
        <Button
          variant="outlined"
          size="small"
          onClick={handleClearAllFilters}
          sx={FILTER_STYLES.CLEAR_BUTTON}
        >
          Очистить все
        </Button>
      )}
    </Box>
  );
};

export default TransactionFilters; 