import React from 'react';
import { TableRow, TableCell, Checkbox, Box, Typography } from '@mui/material';
import { Transaction, Account, Category, Counterparty } from '../../types';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BusinessIcon from '@mui/icons-material/Business';

interface TransactionRowProps {
  transaction: Transaction;
  isSelected: boolean;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
  onClick: (transaction: Transaction) => void;
  getAccountById: (id: string) => Account | undefined;
  getCategoryById: (id: string) => Category | undefined;
  getCounterpartyById: (id: string) => Counterparty | undefined;
  formatDate: (date: Date) => string;
  formatAmount: (transaction: Transaction) => string;
}

/**
 * Компонент строки транзакции в таблице
 */
const TransactionRow: React.FC<TransactionRowProps> = ({
  transaction,
  isSelected,
  onSelect,
  onClick,
  getAccountById,
  getCategoryById,
  getCounterpartyById,
  formatDate,
  formatAmount
}) => {
  const account = getAccountById(transaction.accountId);
  const category = transaction.type !== 'transfer' && transaction.categoryId && transaction.categoryId !== 'no-category' 
    ? getCategoryById(transaction.categoryId) 
    : null;
  const toAccount = transaction.toAccountId ? getAccountById(transaction.toAccountId) : null;
  const counterparty = transaction.counterpartyId ? getCounterpartyById(transaction.counterpartyId) : null;
  
  return (
    <TableRow 
      onClick={() => onClick(transaction)}
      sx={{ 
        cursor: 'pointer',
        '&:hover': {
          backgroundColor: 'rgba(0, 0, 0, 0.04)',
        },
        ...(isSelected ? { backgroundColor: 'rgba(25, 118, 210, 0.08)' } : {}),
        '& .MuiTableCell-root': { 
          borderBottom: 'none',
          py: 1.5,
          height: 56, // Уменьшенная высота ячеек
        }
      }}
      selected={isSelected}
    >
      <TableCell padding="checkbox" sx={{ width: 48, p: '0 0 0 16px' }}>
        <Checkbox
          checked={isSelected}
          onClick={(event) => onSelect(event as any, transaction.id)}
          sx={{ p: 0 }}
        />
      </TableCell>
      <TableCell>{formatDate(transaction.date)}</TableCell>
      <TableCell sx={{ 
        color: transaction.type === 'income' ? 'success.main' : 
              transaction.type === 'expense' ? 'error.main' : 'text.primary',
      }}>
        {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''}
        {formatAmount(transaction)}
      </TableCell>
      <TableCell>
        {transaction.type === 'transfer' ? (
          <Box sx={{ height: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#9E9E9E', // Серый цвет
                  mr: 1,
                }}
              />
              <Typography variant="body2">Перевод между счетами</Typography>
            </Box>
            {transaction.description && (
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.2 }}>
                {transaction.description}
              </Typography>
            )}
          </Box>
        ) : (
          <Box sx={{ height: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {category && (
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: category.color || '#ccc',
                    mr: 1,
                  }}
                />
              )}
              <Typography variant="body2">
              {(category && category.name) ? category.name : 'Без статьи'}
              </Typography>
            </Box>
            {transaction.description && (
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.2 }}>
                {transaction.description}
              </Typography>
            )}
          </Box>
        )}
      </TableCell>
      <TableCell>
        <Box sx={{ height: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {counterparty ? (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <BusinessIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
            {counterparty.name}
          </Box>
        ) : (
          '—'
        )}
        </Box>
      </TableCell>
      <TableCell>
        <Box sx={{ height: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {transaction.type === 'transfer' && toAccount ? (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography variant="body2">
                {account ? account.name : 'Неизвестный счет'}
              </Typography>
              <ArrowForwardIcon fontSize="small" sx={{ mx: 1, color: '#9E9E9E', fontSize: '16px' }} />
              <Typography variant="body2">
              {toAccount.name}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2">
              {account ? account.name : 'Неизвестный счет'}
            </Typography>
          )}
          </Box>
      </TableCell>
    </TableRow>
  );
};

export default React.memo(TransactionRow); 