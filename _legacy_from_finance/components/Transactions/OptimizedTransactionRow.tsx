import React, { memo } from 'react';
import {
  TableRow,
  TableCell,
  Checkbox,
  Typography,
  Chip,
  Box
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { Transaction, Account, Category, Counterparty } from '../../types';
import { formatCurrency, formatDate } from '../../utils/helpers';

interface OptimizedTransactionRowProps {
  transaction: Transaction;
  account: Account | undefined;
  category: Category | null;
  counterparty: Counterparty | null;
  toAccount: Account | null;
  isSelected: boolean;
  onRowClick: (transaction: Transaction) => void;
  onSelectClick: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
}

/**
 * Оптимизированный компонент строки транзакции с React.memo
 * Предотвращает лишние ререндеры при работе с большими списками
 */
const OptimizedTransactionRow: React.FC<OptimizedTransactionRowProps> = memo(({
  transaction,
  account,
  category,
  counterparty,
  toAccount,
  isSelected,
  onRowClick,
  onSelectClick
}) => {
  // Мемоизируем иконку типа транзакции
  const typeIcon = React.useMemo(() => {
    switch (transaction.type) {
      case 'income':
        return <TrendingUpIcon fontSize="small" sx={{ color: 'success.main' }} />;
      case 'expense':
        return <TrendingDownIcon fontSize="small" sx={{ color: 'error.main' }} />;
      case 'transfer':
        return <SwapHorizIcon fontSize="small" sx={{ color: 'info.main' }} />;
      default:
        return null;
    }
  }, [transaction.type]);

  // Мемоизируем форматированную сумму
  const formattedAmount = React.useMemo(() => {
    const amount = transaction.type === 'transfer' && transaction.toAmount 
      ? transaction.toAmount 
      : transaction.amount;
    const currency = transaction.type === 'transfer' && transaction.toCurrency 
      ? transaction.toCurrency 
      : account?.currency || 'RUB';
    
    return formatCurrency(amount, currency);
  }, [transaction.amount, transaction.toAmount, transaction.toCurrency, transaction.type, account?.currency]);

  // Мемоизируем форматированную дату
  const formattedDate = React.useMemo(() => {
    return formatDate(transaction.date);
  }, [transaction.date]);

  return (
    <TableRow 
      onClick={() => onRowClick(transaction)}
      sx={{ 
        cursor: 'pointer',
        height: 48,
        '&:hover': { backgroundColor: '#F9FAFB' },
        ...(isSelected ? { backgroundColor: '#F3F4F6' } : {}),
        '& .MuiTableCell-root': { 
          borderBottom: '1px solid #F3F4F6',
          py: 1,
          height: 48,
        }
      }}
      selected={isSelected}
    >
      {/* Чекбокс для выбора */}
      <TableCell padding="checkbox" sx={{ width: 48 }}>
        <Checkbox
          checked={isSelected}
          onClick={(event) => onSelectClick(event, transaction.id)}
          sx={{ p: 0 }}
        />
      </TableCell>

      {/* Дата */}
      <TableCell sx={{ width: '12%' }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {formattedDate}
        </Typography>
      </TableCell>

      {/* Тип с иконкой */}
      <TableCell sx={{ width: '10%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {typeIcon}
          <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
            {transaction.type === 'income' ? 'Доход' : 
             transaction.type === 'expense' ? 'Расход' : 'Перевод'}
          </Typography>
        </Box>
      </TableCell>

      {/* Счет */}
      <TableCell sx={{ width: '15%' }}>
        <Typography variant="body2">
          {account?.name || 'Неизвестный счет'}
        </Typography>
        {transaction.type === 'transfer' && toAccount && (
          <Typography variant="caption" color="text.secondary">
            → {toAccount.name}
          </Typography>
        )}
      </TableCell>

      {/* Категория */}
      <TableCell sx={{ width: '15%' }}>
        {category ? (
          <Chip
            label={category.name}
            size="small"
            sx={{
              backgroundColor: category.color || '#E0E0E0',
              color: '#000',
              fontSize: '0.75rem',
            }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {transaction.type === 'transfer' ? '—' : 'Без категории'}
          </Typography>
        )}
      </TableCell>

      {/* Контрагент */}
      <TableCell sx={{ width: '15%' }}>
        <Typography variant="body2">
          {counterparty?.name || '—'}
        </Typography>
      </TableCell>

      {/* Сумма */}
      <TableCell sx={{ width: '12%', textAlign: 'right' }}>
        <Typography 
          variant="body2" 
          sx={{ 
            fontWeight: 600,
            color: transaction.type === 'income' ? 'success.main' : 
                   transaction.type === 'expense' ? 'error.main' : 'info.main'
          }}
        >
          {transaction.type === 'expense' ? '-' : '+'}{formattedAmount}
        </Typography>
      </TableCell>

      {/* Описание */}
      <TableCell sx={{ width: '21%' }}>
        <Typography 
          variant="body2" 
          sx={{ 
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200
          }}
        >
          {transaction.description || '—'}
        </Typography>
      </TableCell>
    </TableRow>
  );
});

OptimizedTransactionRow.displayName = 'OptimizedTransactionRow';

export default OptimizedTransactionRow; 