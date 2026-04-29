import React from 'react';
import { 
  Paper, 
  TableContainer, 
  Table, 
  TableHead, 
  TableBody, 
  TableRow, 
  TableCell, 
  TablePagination, 
  Checkbox, 
  Box, 
  Button, 
  Typography 
} from '@mui/material';
import { Transaction, Account, Category, Counterparty } from '../../types';
import TransactionRow from './TransactionRow';

interface LabelDisplayedRowsProps {
  from: number;
  to: number;
  count: number;
}

interface TransactionsTableProps {
  transactions: Transaction[];
  filteredTransactions: Transaction[];
  paginatedTransactions: Transaction[];
  selected: string[];
  page: number;
  rowsPerPage: number;
  accounts: Account[];
  categories: Category[];
  counterparties: Counterparty[];
  onChangePage: (event: unknown, newPage: number) => void;
  onChangeRowsPerPage: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectAllClick: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectClick: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
  onEditClick: (transaction: Transaction) => void;
  onCopyTransaction: () => void;
  onBulkEdit: () => void;
  onBulkDelete: () => void;
  areAllSameType: () => boolean;
  isSelected: (id: string) => boolean;
  getAccountById: (id: string) => Account | undefined;
  getCategoryById: (id: string) => Category | undefined;
  getCounterpartyById: (id: string) => Counterparty | undefined;
  formatDate: (date: Date) => string;
  formatAmount: (transaction: Transaction) => string;
}

/**
 * Компонент таблицы транзакций
 */
const TransactionsTable: React.FC<TransactionsTableProps> = ({
  transactions,
  filteredTransactions,
  paginatedTransactions,
  selected,
  page,
  rowsPerPage,
  onChangePage,
  onChangeRowsPerPage,
  onSelectAllClick,
  onSelectClick,
  onEditClick,
  onCopyTransaction,
  onBulkEdit,
  onBulkDelete,
  areAllSameType,
  isSelected,
  getAccountById,
  getCategoryById,
  getCounterpartyById,
  formatDate,
  formatAmount
}) => {
  if (transactions.length === 0) {
    return (
      <Paper sx={{ p: 4 }}>
        <Typography variant="body1" color="textSecondary" align="center">
          У вас пока нет транзакций. Используйте кнопки "Приход", "Расход" или "Перевод" для создания новых операций.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper>
      <TableContainer sx={{ maxHeight: 'calc(100vh - 200px)' }}>
        <Table sx={{ borderCollapse: 'collapse' }} stickyHeader>
          {selected.length > 0 ? (
            // Панель инструментов для выбранных транзакций
            <TableHead>
              <TableRow sx={{ height: 48 }}>
                <TableCell padding="checkbox" sx={{ width: 48, p: '0 0 0 16px', height: 48, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>
                  <Checkbox
                    indeterminate={selected.length > 0 && selected.length < paginatedTransactions.length}
                    checked={paginatedTransactions.length > 0 && selected.length === paginatedTransactions.length}
                    onChange={onSelectAllClick}
                    sx={{ p: 0 }}
                  />
                </TableCell>
                <TableCell colSpan={6} padding="none" sx={{ p: 0, height: 48, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      height: '100%',
                      pl: 1
                    }}
                  >
                    <Typography
                      sx={{ 
                        fontSize: '0.75rem',
                        color: 'text.secondary',
                        fontWeight: 'normal',
                        mr: 2
                      }}
                      variant="caption"
                      component="span"
                    >
                      {selected.length}
                    </Typography>
                    
                    {selected.length === 1 && (
                      <Button
                        onClick={onCopyTransaction}
                        size="small"
                        variant="outlined"
                        sx={{ 
                          mr: 1, 
                          py: 0.5, 
                          minHeight: 0, 
                          borderColor: 'primary.light',
                          color: 'primary.main',
                          fontSize: '0.75rem',
                          textTransform: 'none'
                        }}
                      >
                        Копировать
                      </Button>
                    )}
                    
                    {areAllSameType() && (
                      <Button
                        onClick={onBulkEdit}
                        size="small"
                        variant="outlined"
                        sx={{ 
                          mr: 1, 
                          py: 0.5, 
                          minHeight: 0, 
                          borderColor: 'primary.light',
                          color: 'primary.main',
                          fontSize: '0.75rem',
                          textTransform: 'none'
                        }}
                      >
                        Редактировать
                      </Button>
                    )}
                    
                    <Button
                      onClick={onBulkDelete}
                      size="small"
                      variant="contained"
                      sx={{ 
                        py: 0.5, 
                        minHeight: 0, 
                        bgcolor: 'error.main',
                        color: 'white',
                        fontSize: '0.75rem',
                        textTransform: 'none',
                        '&:hover': {
                          bgcolor: 'error.dark',
                        }
                      }}
                    >
                      Удалить
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
          ) : (
            // Обычные заголовки таблицы
            <TableHead>
              <TableRow sx={{ height: 48 }}>
                <TableCell padding="checkbox" sx={{ width: 48, p: '0 0 0 16px', height: 48, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>
                  <Checkbox
                    indeterminate={selected.length > 0 && selected.length < paginatedTransactions.length}
                    checked={paginatedTransactions.length > 0 && selected.length === paginatedTransactions.length}
                    onChange={onSelectAllClick}
                    sx={{ p: 0 }}
                  />
                </TableCell>
                <TableCell sx={{ width: '12%', height: 48, py: 0, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>Дата</TableCell>
                <TableCell sx={{ width: '18%', height: 48, py: 0, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>Сумма</TableCell>
                <TableCell sx={{ width: '23%', height: 48, py: 0, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>Статья</TableCell>
                <TableCell sx={{ width: '22%', height: 48, py: 0, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>Контрагент</TableCell>
                <TableCell sx={{ width: '25%', height: 48, py: 0, borderBottom: '1px solid rgba(224, 224, 224, 1)' }}>Счет</TableCell>
              </TableRow>
            </TableHead>
          )}
          <TableBody>
            {paginatedTransactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                isSelected={isSelected(transaction.id)}
                onSelect={onSelectClick}
                onClick={onEditClick}
                getAccountById={getAccountById}
                getCategoryById={getCategoryById}
                getCounterpartyById={getCounterpartyById}
                formatDate={formatDate}
                formatAmount={formatAmount}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[25, 50, 100]}
        component="div"
        count={filteredTransactions.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={onChangePage}
        onRowsPerPageChange={onChangeRowsPerPage}
        labelRowsPerPage="Строк на странице:"
        labelDisplayedRows={({ from, to, count }: LabelDisplayedRowsProps) => 
          `${from}–${to} из ${count !== -1 ? count : `более чем ${to}`}`
        }
      />
    </Paper>
  );
};

export default React.memo(TransactionsTable); 