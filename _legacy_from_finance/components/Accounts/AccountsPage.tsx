import React, { useState } from 'react';
import {
  Box,
  Button,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
} from '@mui/material';
import GroupIcon from '@mui/icons-material/CategoryOutlined';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import { Account } from '../../types';
import { useFinance } from '../../context/FinanceContext';
import { useUser } from '../../context/UserContext';
import { useNavigate } from 'react-router-dom';
import RightSidebar from '../Layout/RightSidebar';
import ConfirmDialog from '../Common/ConfirmDialog';
import { COMPONENT_SIZES, SEARCH_FIELD_STYLES } from '../../utils/constants';
import { formatCurrency } from '../../utils/helpers';
import AccountForm from './AccountForm';
import { SupabaseLegalEntityService } from '../../context/services/SupabaseLegalEntityService';

// Интерфейс для параметров пагинации
interface LabelDisplayedRowsProps {
  from: number;
  to: number;
  count: number;
}

// Компонент страницы счетов
const AccountsPage: React.FC = () => {
  const { accounts, accountGroups, addAccount, updateAccount, deleteAccount, calculateAccountBalance } = useFinance();
  const { currentUser } = useUser();
  const navigate = useNavigate();
  
  // Состояния для сайдбара
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  
  // Состояния для пагинации
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  
  // Состояние для поиска
  const [searchQuery, setSearchQuery] = useState('');

  // Состояние для юридических лиц
  const [legalEntities, setLegalEntities] = useState<Array<{ id: string; name: string }>>([]);

  // Загрузка юридических лиц при изменении пользователя или организации
  React.useEffect(() => {
    if (currentUser?.organizationId) {
      loadLegalEntities(currentUser.organizationId);
    }
  }, [currentUser?.organizationId]);

  /**
   * Загрузка юридических лиц организации
   */
  const loadLegalEntities = async (organizationId: string) => {
    try {
      const entities = await SupabaseLegalEntityService.getLegalEntities(organizationId);
      setLegalEntities(entities.map(e => ({ id: e.id, name: e.name })));
    } catch (error) {
      console.error('Ошибка при загрузке юридических лиц:', error);
    }
  };

  const [currentAccount, setCurrentAccount] = useState<Partial<Account>>({
    name: '',
    balance: 0,
    currency: 'RUB',
    description: '',
    groupId: '',
    accountType: 'checking',
    organizationId: currentUser?.organizationId || '',
    legalEntityId: '',
    bankName: '',
    bik: '',
    accountNumber: '',
    correspondentAccount: '',
    acquiringPercentage: 0,
    cardHolder: '',
    cardNumber: ''
  });

  // Открыть сайдбар для добавления нового счета
  const handleAddClick = () => {
    setCurrentAccount({
      name: '',
      balance: 0,
      currency: 'RUB',
      description: '',
      groupId: '',
      accountType: 'checking',
      organizationId: currentUser?.organizationId || '',
      legalEntityId: '',
      bankName: '',
      bik: '',
      accountNumber: '',
      correspondentAccount: '',
      acquiringPercentage: 0,
      cardHolder: '',
      cardNumber: ''
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для редактирования счета
  const handleEditClick = (account: Account) => {
    setCurrentAccount({
      ...account,
      organizationId: account.organizationId || currentUser?.organizationId || ''
    });
    setIsEditing(true);
    setSidebarOpen(true);
  };

  // Закрыть сайдбар
  const handleClose = () => {
    setSidebarOpen(false);
  };

  // Сохранение счета
  const handleSave = () => {
    if (!currentAccount.name) {
      alert('Пожалуйста, укажите название счета');
      return;
    }

    if (isEditing && currentAccount.id) {
      // Обновление существующего счета
      updateAccount(currentAccount as Account);
    } else {
      // Создание нового счета
      addAccount({
        name: currentAccount.name!,
        balance: currentAccount.balance || 0,
        currency: currentAccount.currency || 'RUB',
        description: currentAccount.description || '',
        groupId: currentAccount.groupId || '',
        accountType: currentAccount.accountType || 'checking',
        organizationId: currentAccount.organizationId || currentUser?.organizationId || '',
        legalEntityId: currentAccount.legalEntityId!,
        bankName: currentAccount.bankName || '',
        bik: currentAccount.bik || '',
        accountNumber: currentAccount.accountNumber || '',
        correspondentAccount: currentAccount.correspondentAccount || '',
        acquiringPercentage: currentAccount.acquiringPercentage || 0,
        cardHolder: currentAccount.cardHolder || '',
        cardNumber: currentAccount.cardNumber || ''
      });
    }

    // Закрытие сайдбара
    handleClose();
  };

  // Открытие диалога подтверждения удаления
  const handleDeleteClick = () => {
    setConfirmDialogOpen(true);
  };

  // Удаление счета
  const handleDelete = () => {
    if (currentAccount.id) {
      deleteAccount(currentAccount.id);
      setConfirmDialogOpen(false);
      handleClose();
    }
  };

  // Обработчик изменения поиска
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(0); // Сбрасываем страницу при изменении поискового запроса
  };

  // Обработка изменения страницы
  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  // Обработка изменения количества строк на странице
  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Фильтрация счетов
  const filterAccounts = (accounts: Account[]) => {
    let filtered = accounts;

    // Поиск
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(account =>
        account.name.toLowerCase().includes(query) ||
        account.description?.toLowerCase().includes(query) ||
        account.bankName?.toLowerCase().includes(query) ||
        account.accountNumber?.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  // Получение названия типа счета
  const getAccountTypeName = (type: string) => {
    switch (type) {
      case 'checking': return 'Расчетный счет';
      case 'debit_card': return 'Дебетовая карта';
      case 'cash': return 'Наличные';
      case 'fund': return 'Фонд';
      default: return type;
    }
  };

  // Получение цвета для типа счета
  const getAccountTypeColor = (type: string) => {
    switch (type) {
      case 'checking': return 'primary';
      case 'debit_card': return 'secondary';
      case 'cash': return 'success';
      case 'fund': return 'warning';
      default: return 'default';
    }
  };

  // Получение символа валюты
  const getCurrencySymbol = (currency: string) => {
    switch (currency) {
      case 'RUB': return '₽';
      case 'USD': return '$';
      case 'EUR': return '€';
      default: return currency;
    }
  };

  const filteredAccounts = filterAccounts(accounts);
  
  // Получение счетов для текущей страницы
  const paginatedAccounts = filteredAccounts.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  return (
    <Box>
      {/* Поиск и кнопки */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Поиск */}
          <TextField
            placeholder="Поиск счетов..."
            value={searchQuery}
            onChange={handleSearchChange}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'text.secondary', fontSize: '1.2rem' }} />
                </InputAdornment>
              ),
            }}
            sx={{
              width: SEARCH_FIELD_STYLES.width,
              ...SEARCH_FIELD_STYLES.sx,
            }}
          />
        </Box>
        
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/settings/account-groups')}
            startIcon={<GroupIcon />}
            sx={{
              borderRadius: '8px',
              px: 3,
              py: 1
            }}
          >
            Группы счетов
          </Button>
          <Button
            variant="contained"
            onClick={handleAddClick}
            sx={{
              borderRadius: '8px',
              boxShadow: 'none',
              px: 3,
              py: 1
            }}
          >
            Добавить счет
          </Button>
        </Box>
      </Box>

      {/* Таблица счетов */}
      {accounts.length > 0 ? (
        <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: 'calc(100vh - 200px)' }}>
            <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }} stickyHeader>
              <TableHead>
                <TableRow sx={{ height: 42 }}>
                  <TableCell sx={{ width: '30%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Название</TableCell>
                  <TableCell sx={{ width: '15%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Тип</TableCell>
                  <TableCell sx={{ width: '20%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Баланс</TableCell>
                  <TableCell sx={{ width: '20%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Юридическое лицо</TableCell>
                  <TableCell sx={{ width: '15%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Группа</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedAccounts.map((account) => {
                  const currentBalance = calculateAccountBalance(account.id);
                  const group = accountGroups.find(g => g.id === account.groupId);
                  const legalEntity = legalEntities.find(e => e.id === account.legalEntityId);
                  
                  return (
                    <TableRow 
                      key={account.id}
                      onClick={() => handleEditClick(account)}
                      sx={{ 
                        cursor: 'pointer',
                        height: 56,
                        '&:hover': {
                          backgroundColor: '#F9FAFB',
                        },
                        '& .MuiTableCell-root': { 
                          borderBottom: '1px solid #F3F4F6',
                          py: 1,
                          height: 56,
                        }
                      }}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {account.name} ({getCurrencySymbol(account.currency)})
                        </Typography>
                        {account.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {account.description}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={getAccountTypeName(account.accountType)}
                          color={getAccountTypeColor(account.accountType) as any}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            fontWeight: 500,
                            color: currentBalance < 0 ? 'error.main' : 'text.primary'
                          }}
                        >
                          {formatCurrency(currentBalance, account.currency)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {legalEntity ? legalEntity.name : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {group ? group.name : '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            rowsPerPageOptions={[25, 50, 100]}
            component="div"
            count={filteredAccounts.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            labelRowsPerPage="Строк на странице:"
            labelDisplayedRows={({ from, to, count }: LabelDisplayedRowsProps) => 
              `${from}–${to} из ${count !== -1 ? count : `более чем ${to}`}`
            }
            sx={{
              borderTop: '1px solid #F3F4F6',
              '.MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
                fontSize: '0.875rem',
                color: 'text.secondary'
              },
              '.MuiTablePagination-select': {
                fontSize: '0.875rem'
              }
            }}
          />
        </Paper>
      ) : (
        <Paper sx={{ p: 4, borderRadius: '8px', border: '1px solid #F3F4F6' }}>
          <Typography variant="body1" color="textSecondary" align="center">
            {searchQuery 
              ? 'Не найдено счетов по заданным критериям.' 
              : 'У вас пока нет счетов. Нажмите "Добавить счет" для создания нового счета.'
            }
          </Typography>
        </Paper>
      )}

      {/* Правый сайдбар для добавления/редактирования счета */}
      <RightSidebar 
        open={sidebarOpen} 
        onClose={handleClose} 
        title={isEditing ? 'Редактировать счет' : 'Добавить счет'}
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <AccountForm
          account={currentAccount}
          isEditing={isEditing}
          onSave={handleSave}
          onDelete={handleDeleteClick}
          onClose={handleClose}
          onAccountChange={setCurrentAccount}
        />
      </RightSidebar>

      {/* Диалог подтверждения удаления */}
      <ConfirmDialog
        open={confirmDialogOpen}
        title="Удалить счет"
        message="Вы уверены, что хотите удалить этот счет? Это действие нельзя отменить."
        confirmText="Удалить"
        cancelText="Отмена"
        confirmColor="primary"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDialogOpen(false)}
      />
    </Box>
  );
};

export default AccountsPage; 