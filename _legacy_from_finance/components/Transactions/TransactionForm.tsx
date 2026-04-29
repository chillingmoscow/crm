import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  Autocomplete,
  List,
  ListItem,
  ListItemText,
  Avatar,
  InputAdornment,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import HistoryIcon from '@mui/icons-material/History';
import CreateIcon from '@mui/icons-material/CreateOutlined';
import UpdateIcon from '@mui/icons-material/Update';
import BusinessIcon from '@mui/icons-material/BusinessOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AddIcon from '@mui/icons-material/AddOutlined';
import RemoveIcon from '@mui/icons-material/RemoveOutlined';
import CompareArrowsIcon from '@mui/icons-material/CompareArrowsOutlined';
import { Transaction } from '../../types';
import { useFinance } from '../../context/FinanceContext';
import { useUser } from '../../context/UserContext';
// import FileUpload from '../Common/FileUpload'; // ЗАКОММЕНТИРОВАНО: больше не используем файловую загрузку
import { 
  formatCurrency, 
  formatDateTime, 
  createGetterFunctions
} from '../../utils/helpers';

// Интерфейс пропсов компонента
interface TransactionFormProps {
  /** Текущая транзакция для редактирования или пустая для создания */
  transaction: Partial<Transaction>;
  /** Флаг режима редактирования */
  isEditing: boolean;
  /** Обработчик сохранения транзакции */
  onSave: () => Promise<void>;
  /** Обработчик удаления транзакции */
  onDelete?: () => void;
  /** Обработчик закрытия формы */
  onClose: () => void;
  /** Обработчик добавления новой категории */
  onAddCategory: () => void;
  /** Обработчик добавления нового контрагента */
  onAddCounterparty: () => void;
  /** Обработчик добавления нового счета */
  onAddAccount: () => void;
  /** Обработчик изменения транзакции */
  onTransactionChange: (transaction: Partial<Transaction>) => void;
  // ЗАКОММЕНТИРОВАНО: больше не используем файловую загрузку
  // /** Обработчик добавления файлов */
  // onAddFiles: (files: File[]) => Promise<void>;
  // /** Обработчик удаления файла */
  // onRemoveFile: (fileId: string) => Promise<void>;
}

/**
 * Компонент формы создания/редактирования транзакции
 */
const TransactionForm: React.FC<TransactionFormProps> = ({
  transaction,
  isEditing,
  onSave,
  onDelete,
  onClose,
  onAddCategory,
  onAddCounterparty,
  onAddAccount,
  onTransactionChange,
  // ЗАКОММЕНТИРОВАНО: больше не используем файловую загрузку
  // onAddFiles,
  // onRemoveFile
}) => {
  const { 
    accounts, 
    categories, 
    counterparties,
    calculateAccountBalance
  } = useFinance();
  const { users } = useUser();

  // Создаем функции получения данных по ID
  const { getById: getAccountById } = createGetterFunctions(accounts);
  const { getById: getCategoryById } = createGetterFunctions(categories);
  const { getById: getCounterpartyById } = createGetterFunctions(counterparties);

  // Получение имени пользователя по ID
  const getUserName = (userId: string) => {
    if (userId === 'system') return 'Система';
    const user = users.find(u => u.id === userId);
    return user ? user.fullName : 'Неизвестный пользователь';
  };

  // Обработка изменения полей формы
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    onTransactionChange({
      ...transaction,
      [name]: name === 'amount' ? parseFloat(value) || 0 : value,
    });
  };

  // Обработка изменения даты
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onTransactionChange({
      ...transaction,
      date: new Date(e.target.value),
    });
  };

  // Обработка изменения типа транзакции
  const handleTypeChange = (e: SelectChangeEvent) => {
    const type = e.target.value as 'income' | 'expense' | 'transfer';
    
    if (type === 'transfer') {
      // Для перевода выбираем второй счет автоматически, если есть
      const targetAccountId = accounts.find(a => a.id !== transaction.accountId)?.id || '';
      onTransactionChange({
        ...transaction,
        type,
        categoryId: '',
        toAccountId: targetAccountId,
        toAmount: 0,
        toCurrency: '',
      });
    } else {
      // Для доходов/расходов сбрасываем категорию и целевой счет
      onTransactionChange({
        ...transaction,
        type,
        categoryId: '',
        toAccountId: '', // Сбрасываем целевой счет
        toAmount: 0,
        toCurrency: '',
      });
    }
  };

  // Обработчик для выбора счета через Autocomplete
  const handleAccountAutocompleteChange = (event: React.SyntheticEvent, newValue: any) => {
    // Если выбрана опция "Добавить счет"
    if (newValue && newValue.isAddOption) {
      onAddAccount();
      return;
    }
    
    const newAccountId = newValue ? newValue.id : '';
    
    // Если выбран тот же счет, что и целевой в случае перевода,
    // меняем целевой счет на другой доступный
    if (transaction.type === 'transfer' && newAccountId === transaction.toAccountId) {
      const otherAccount = accounts.find(a => a.id !== newAccountId);
      
      onTransactionChange({
        ...transaction,
        accountId: newAccountId,
        toAccountId: otherAccount?.id || '',
        toAmount: 0,
        toCurrency: '',
      });
    } else {
      onTransactionChange({
        ...transaction,
        accountId: newAccountId,
      });
    }
  };

  // Обработчик для выбора целевого счета через Autocomplete
  const handleToAccountAutocompleteChange = (event: React.SyntheticEvent, newValue: any) => {
    // Если выбрана опция "Добавить счет"
    if (newValue && newValue.isAddOption) {
      onAddAccount();
      return;
    }
    
    const newToAccountId = newValue ? newValue.id : '';
    
    // Если выбран тот же счет, что и исходный в случае перевода,
    // меняем исходный счет на другой доступный
    if (transaction.type === 'transfer' && newToAccountId === transaction.accountId) {
      const otherAccount = accounts.find(a => a.id !== newToAccountId);
      
      onTransactionChange({
        ...transaction,
        accountId: otherAccount?.id || '',
        toAccountId: newToAccountId,
        toAmount: 0,
        toCurrency: '',
      });
    } else {
      onTransactionChange({
        ...transaction,
        toAccountId: newToAccountId,
        toAmount: 0,
        toCurrency: '',
      });
    }
  };

  // Обработка изменения категории
  const handleCategoryChange = (event: React.SyntheticEvent, newValue: any) => {
    // Если выбрана опция "Добавить статью"
    if (newValue && newValue.isAddOption) {
      onAddCategory();
      return;
    }
    
    // Иначе устанавливаем выбранную категорию
    onTransactionChange({
      ...transaction,
      categoryId: newValue ? newValue.id : ''
    });
  };

  // Обработка изменения контрагента
  const handleCounterpartyChange = (event: React.SyntheticEvent, newValue: any) => {
    // Если выбрана опция "Добавить контрагента"
    if (newValue && newValue.isAddOption) {
      onAddCounterparty();
      return;
    }
    
    // Иначе устанавливаем выбранного контрагента
    onTransactionChange({
      ...transaction,
      counterpartyId: newValue ? newValue.id : ''
    });
  };

  // Фильтрация категорий по типу транзакции
  const getFilteredCategories = () => {
    if (transaction.type === 'transfer') return [];
    return categories.filter(c => c.type === transaction.type);
  };

  return (
    <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
      {/* Для переводов - специальная компоновка */}
      {transaction.type === 'transfer' ? (
        <>
          {/* Сумма перевода - полная ширина */}
          <TextField
            name="amount"
            label="Сумма перевода"
            value={transaction.amount === 0 ? '' : transaction.amount || ''}
            onChange={(e) => {
              const value = e.target.value;
              // Разрешаем пустое значение или числовое значение (включая десятичные числа)
              if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                handleInputChange({
                  ...e,
                  target: {
                    ...e.target,
                    name: 'amount',
                    value: value
                  }
                });
              }
            }}
            required
            fullWidth
            InputLabelProps={{
              shrink: true,
            }}
            inputProps={{
              inputMode: 'decimal',
              style: { textAlign: 'left' }
            }}
            sx={{
              '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
                '-webkit-appearance': 'none',
                margin: 0,
              },
              '& input[type=number]': {
                '-moz-appearance': 'textfield',
              },
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
            placeholder="0,00"
          />
          
          {/* Сумма поступления - только если валюты разные */}
          {(() => {
            const fromAccount = accounts.find(a => a.id === transaction.accountId);
            const toAccount = accounts.find(a => a.id === transaction.toAccountId);
            const isDifferentCurrencies = fromAccount && toAccount && fromAccount.currency !== toAccount.currency;
            
            if (isDifferentCurrencies) {
              return (
                <TextField
                  name="toAmount"
                  label={`Сумма поступления (${toAccount?.currency})`}
                  value={transaction.toAmount === 0 ? '' : transaction.toAmount || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                      onTransactionChange({
                        ...transaction,
                        toAmount: parseFloat(value) || 0,
                        toCurrency: toAccount?.currency || ''
                      });
                    }
                  }}
                  required
                  fullWidth
                  InputLabelProps={{
                    shrink: true,
                  }}
                  inputProps={{
                    inputMode: 'decimal',
                    style: { textAlign: 'left' }
                  }}
                  sx={{
                    '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
                      '-webkit-appearance': 'none',
                      margin: 0,
                    },
                    '& input[type=number]': {
                      '-moz-appearance': 'textfield',
                    },
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '8px',
                    }
                  }}
                  placeholder="0,00"
                />
              );
            }
            return null;
          })()}

          {/* Счет списания - полная ширина */}
          <Autocomplete
            id="account-select"
            options={[
              { id: 'add-new-account', name: 'Добавить счет', isAddOption: true as const },
              ...accounts.map(account => ({ 
                id: account.id, 
                name: account.name, 
                balance: account.balance,
                currency: account.currency
              }))
            ]}
            getOptionLabel={(option: any) => {
              if (option.isAddOption) return option.name;
              
              // В форме показываем динамический остаток на текущий момент
              const currentBalance = calculateAccountBalance(option.id);
              return `${option.name} (${formatCurrency(currentBalance, option.currency)})`;
            }}
            value={
              transaction.accountId
                ? { 
                    id: transaction.accountId, 
                    name: accounts.find(a => a.id === transaction.accountId)?.name || '',
                    balance: accounts.find(a => a.id === transaction.accountId)?.balance || 0,
                    currency: accounts.find(a => a.id === transaction.accountId)?.currency || 'RUB'
                  } 
                : null
            }
            onChange={handleAccountAutocompleteChange}
            filterOptions={(options: any[], state) => {
              const addOption = options.find(option => option.isAddOption);
              const filtered = options
                .filter(option => !option.isAddOption && 
                  option.name.toLowerCase().includes(state.inputValue.toLowerCase()));
              return addOption ? [addOption, ...filtered] : filtered;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Счет списания"
                placeholder="Начните вводить для поиска"
                required
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />
            )}
            renderOption={(props, option: any) => (
              <li {...props}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {option.isAddOption ? (
                    <>
                      <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1, color: 'primary.main', fontSize: 18 }} />
                      <Typography color="primary.main">{option.name}</Typography>
                    </>
                  ) : (
                    <Typography>
                      {option.name} ({formatCurrency(calculateAccountBalance(option.id), option.currency)})
                    </Typography>
                  )}
                </Box>
              </li>
            )}
            isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
            fullWidth
            disabled={accounts.length === 0}
          />

          {/* Счет поступления - полная ширина */}
          <Autocomplete
            id="to-account-select"
            options={[
              { id: 'add-new-account', name: 'Добавить счет', isAddOption: true as const },
              ...accounts
                .filter(account => account.id !== transaction.accountId) // Исключаем выбранный счет списания
                .map(account => ({ 
                  id: account.id, 
                  name: account.name, 
                  balance: account.balance,
                  currency: account.currency
                }))
            ]}
            getOptionLabel={(option: any) => {
              if (option.isAddOption) return option.name;
              
              const currentBalance = calculateAccountBalance(option.id);
              return `${option.name} (${formatCurrency(currentBalance, option.currency)})`;
            }}
            value={
              transaction.toAccountId
                ? { 
                    id: transaction.toAccountId, 
                    name: accounts.find(a => a.id === transaction.toAccountId)?.name || '',
                    balance: accounts.find(a => a.id === transaction.toAccountId)?.balance || 0,
                    currency: accounts.find(a => a.id === transaction.toAccountId)?.currency || 'RUB'
                  } 
                : null
            }
            onChange={handleToAccountAutocompleteChange}
            filterOptions={(options: any[], state) => {
              const addOption = options.find(option => option.isAddOption);
              const filtered = options
                .filter(option => !option.isAddOption && 
                  option.name.toLowerCase().includes(state.inputValue.toLowerCase()));
              return addOption ? [addOption, ...filtered] : filtered;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Счет поступления"
                placeholder="Начните вводить для поиска"
                required
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />
            )}
            renderOption={(props, option: any) => (
              <li {...props}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {option.isAddOption ? (
                    <>
                      <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1, color: 'primary.main', fontSize: 18 }} />
                      <Typography color="primary.main">{option.name}</Typography>
                    </>
                  ) : (
                    <Typography>
                      {option.name} ({formatCurrency(calculateAccountBalance(option.id), option.currency)})
                    </Typography>
                  )}
                </Box>
              </li>
            )}
            isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
            fullWidth
            disabled={accounts.length === 0}
          />

          {/* Дата - полная ширина */}
          <TextField
            name="date"
            label="Дата"
            type="date"
            fullWidth
            value={transaction.date ? new Date(transaction.date).toISOString().split('T')[0] : ''}
            onChange={handleDateChange}
            required
            InputLabelProps={{
              shrink: true,
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />

          {/* Кнопки управления для переводов */}
          {isEditing && (
            <>
              <Box sx={{ mt: 3 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button 
                  startIcon={<DeleteIcon />} 
                  color="error" 
                  variant="outlined"
                  onClick={onDelete}
                  sx={{
                    borderRadius: '8px',
                    borderColor: '#FFB3BA',
                    color: '#DC2626',
                    backgroundColor: '#FEF2F2',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      borderColor: '#DC2626',
                      backgroundColor: '#DC2626',
                      color: 'white',
                      '& .MuiSvgIcon-root': {
                        color: 'white'
                      }
                    },
                    py: 1
                  }}
                >
                  Удалить
                </Button>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button 
                    onClick={onClose} 
                    variant="outlined"
                    sx={{
                      borderRadius: '8px',
                      borderColor: '#E5E7EB',
                      color: 'text.secondary',
                      '&:hover': {
                        borderColor: '#D1D5DB',
                        backgroundColor: 'rgba(0, 0, 0, 0.01)'
                      },
                      py: 1,
                      minWidth: 100
                    }}
                  >
                    Отмена
                  </Button>
                  <Button 
                    onClick={onSave} 
                    variant="contained"
                    sx={{
                      borderRadius: '8px',
                      boxShadow: 'none',
                      '&:hover': {
                        boxShadow: '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -1px rgba(0, 0, 0, 0.06)'
                      },
                      py: 1,
                      minWidth: 100
                    }}
                  >
                    Сохранить
                  </Button>
                </Box>
              </Box>
            </>
          )}
        </>
      ) : (
        <>
          {/* Для доходов и расходов - обычная компоновка */}
          {/* Первый ряд: Сумма и Счет */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              name="amount"
              label="Сумма"
              value={transaction.amount === 0 ? '' : transaction.amount || ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                  handleInputChange({
                    ...e,
                    target: {
                      ...e.target,
                      name: 'amount',
                      value: value
                    }
                  });
                }
              }}
              required
              InputLabelProps={{
                shrink: true,
              }}
              inputProps={{
                inputMode: 'decimal',
                style: { textAlign: 'left' }
              }}
              sx={{
                width: '50%',
                '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
                  '-webkit-appearance': 'none',
                  margin: 0,
                },
                '& input[type=number]': {
                  '-moz-appearance': 'textfield',
                },
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
              placeholder="0,00"
            />
            
            <Autocomplete
              id="account-select"
              options={[
                { id: 'add-new-account', name: 'Добавить счет', isAddOption: true as const },
                ...accounts.map(account => ({ 
                  id: account.id, 
                  name: account.name, 
                  balance: account.balance,
                  currency: account.currency
                }))
              ]}
              getOptionLabel={(option: any) => {
                if (option.isAddOption) return option.name;
                
                const currentBalance = calculateAccountBalance(option.id);
                return `${option.name} (${formatCurrency(currentBalance, option.currency)})`;
              }}
              value={
                transaction.accountId
                  ? { 
                      id: transaction.accountId, 
                      name: accounts.find(a => a.id === transaction.accountId)?.name || '',
                      balance: accounts.find(a => a.id === transaction.accountId)?.balance || 0,
                      currency: accounts.find(a => a.id === transaction.accountId)?.currency || 'RUB'
                    } 
                  : null
              }
              onChange={handleAccountAutocompleteChange}
              filterOptions={(options: any[], state) => {
                const addOption = options.find(option => option.isAddOption);
                const filtered = options
                  .filter(option => !option.isAddOption && 
                    option.name.toLowerCase().includes(state.inputValue.toLowerCase()));
                return addOption ? [addOption, ...filtered] : filtered;
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Счет"
                  placeholder="Начните вводить для поиска"
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '8px',
                    }
                  }}
                />
              )}
              renderOption={(props, option: any) => (
                <li {...props}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    {option.isAddOption ? (
                      <>
                        <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1, color: 'primary.main', fontSize: 18 }} />
                        <Typography color="primary.main">{option.name}</Typography>
                      </>
                    ) : (
                      <Typography>
                        {option.name} ({formatCurrency(calculateAccountBalance(option.id), option.currency)})
                      </Typography>
                    )}
                  </Box>
                </li>
              )}
              isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
              sx={{ 
                width: '50%',
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
              disabled={accounts.length === 0}
            />
          </Box>

          {/* Второй ряд: Категория и Дата */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Autocomplete
              id="category-select"
              options={[
                { id: 'add-new', name: 'Добавить статью', isAddOption: true as const },
                ...getFilteredCategories().map(cat => ({ id: cat.id, name: cat.name, color: cat.color }))
              ]}
              getOptionLabel={(option: any) => option.name}
              value={transaction.categoryId ? 
                { id: transaction.categoryId, name: getCategoryById(transaction.categoryId)?.name || '', color: getCategoryById(transaction.categoryId)?.color } : 
                null}
              onChange={handleCategoryChange}
              filterOptions={(options: any[], state) => {
                const addOption = options.find(option => option.isAddOption);
                const filtered = options
                  .filter(option => !option.isAddOption && option.name.toLowerCase().includes(state.inputValue.toLowerCase()));
                return addOption ? [addOption, ...filtered] : filtered;
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Категория"
                  placeholder="Начните вводить для поиска"
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '8px',
                    }
                  }}
                />
              )}
              renderOption={(props, option: any) => (
                <li {...props}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    {option.isAddOption ? (
                      <>
                        <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1, color: 'primary.main', fontSize: 18 }} />
                        <Typography color="primary.main">{option.name}</Typography>
                      </>
                    ) : (
                      <>
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: option.color || '#ccc',
                            mr: 1,
                            border: '1px solid rgba(0, 0, 0, 0.1)'
                          }}
                        />
                        {option.name}
                      </>
                    )}
                  </Box>
                </li>
              )}
              isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
              sx={{ 
                width: '50%',
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
              disabled={getFilteredCategories().length === 0}
            />
            
            <TextField
              name="date"
              label="Дата"
              type="date"
              value={transaction.date ? new Date(transaction.date).toISOString().split('T')[0] : ''}
              onChange={handleDateChange}
              required
              InputLabelProps={{
                shrink: true,
              }}
              sx={{
                width: '50%',
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            />
          </Box>
          
          {/* Контрагент */}
          <Autocomplete
            id="counterparty-select"
            options={[
              { id: 'add-new', name: 'Добавить контрагента', isAddOption: true as const },
              ...counterparties.map(cp => ({ id: cp.id, name: cp.name }))
            ]}
            getOptionLabel={(option: any) => option.name}
            value={transaction.counterpartyId ? 
              { id: transaction.counterpartyId, name: getCounterpartyById(transaction.counterpartyId)?.name || '' } : 
              null}
            onChange={handleCounterpartyChange}
            filterOptions={(options: any[], state) => {
              const addOption = options.find(option => option.isAddOption);
              const filtered = options
                .filter(option => !option.isAddOption && option.name.toLowerCase().includes(state.inputValue.toLowerCase()));
              return addOption ? [addOption, ...filtered] : filtered;
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Контрагент"
                placeholder="Начните вводить для поиска"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />
            )}
            renderOption={(props, option: any) => (
              <li {...props}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {option.isAddOption ? (
                    <>
                      <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1, color: 'primary.main', fontSize: 18 }} />
                      <Typography color="primary.main">{option.name}</Typography>
                    </>
                  ) : (
                    <>
                      <BusinessIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary', fontSize: 18 }} />
                      {option.name}
                    </>
                  )}
                </Box>
              </li>
            )}
            isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
            fullWidth
          />

          {/* Описание */}
          <TextField
            name="description"
            label="Описание"
            type="text"
            fullWidth
            value={transaction.description}
            onChange={handleInputChange}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />

          {/* Кнопки управления для доходов и расходов */}
          {isEditing && (
            <>
              <Box sx={{ mt: 3 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button 
                  startIcon={<DeleteIcon />} 
                  color="error" 
                  variant="outlined"
                  onClick={onDelete}
                  sx={{
                    borderRadius: '8px',
                    borderColor: '#FFB3BA',
                    color: '#DC2626',
                    backgroundColor: '#FEF2F2',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      borderColor: '#DC2626',
                      backgroundColor: '#DC2626',
                      color: 'white',
                      '& .MuiSvgIcon-root': {
                        color: 'white'
                      }
                    },
                    py: 1
                  }}
                >
                  Удалить
                </Button>
                <Button 
                  onClick={onSave} 
                  variant="contained"
                  sx={{
                    borderRadius: '8px',
                    boxShadow: 'none',
                    '&:hover': {
                      boxShadow: '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -1px rgba(0, 0, 0, 0.06)'
                    },
                    py: 1,
                    minWidth: 100
                  }}
                >
                  Сохранить
                </Button>
              </Box>
            </>
          )}

          {/* ЗАКОММЕНТИРОВАНО: Блок файлов больше не используется */}
          {/* 
          <Box sx={{ mt: 3 }} />
          <FileUpload
            files={transaction.attachments || []}
            onAddFiles={onAddFiles}
            onRemoveFile={onRemoveFile}
          />
          */}
        </>
      )}
      
      {/* Кнопки для новых транзакций */}
      {!isEditing && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button 
            onClick={onSave} 
            variant="contained"
            sx={{
              borderRadius: '8px',
              boxShadow: 'none',
              '&:hover': {
                boxShadow: '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -1px rgba(0, 0, 0, 0.06)'
              },
              py: 1,
              minWidth: 100
            }}
          >
            Сохранить
          </Button>
        </Box>
      )}
      
      {/* История изменений в самом низу */}
      {isEditing && transaction.audit && (
        <>
          <Box sx={{ mt: 4 }} />
          <Typography variant="subtitle2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
            <HistoryIcon fontSize="small" sx={{ mr: 1, fontSize: 18 }} />
            История изменений
          </Typography>
          
          <List disablePadding>
            {/* Информация о создании */}
            {transaction.audit.createdAt && (
              <ListItem sx={{ py: 1, px: 0 }}>
                <Avatar 
                  sx={{ 
                    width: 32, 
                    height: 32, 
                    mr: 2, 
                    bgcolor: 'success.main',
                    fontSize: '0.75rem'
                  }}
                >
                  <CreateIcon sx={{ fontSize: 18 }} />
                </Avatar>
                <ListItemText 
                  primary={
                    <Typography variant="body2">
                      Создано: <b>{getUserName(transaction.audit.createdBy)}</b>
                    </Typography>
                  }
                  secondary={formatDateTime(new Date(transaction.audit.createdAt))}
                />
              </ListItem>
            )}
            
            {/* Информация об обновлении */}
            {transaction.audit.updatedAt && (
              <ListItem sx={{ py: 1, px: 0 }}>
                <Avatar 
                  sx={{ 
                    width: 32, 
                    height: 32, 
                    mr: 2, 
                    bgcolor: 'primary.main',
                    fontSize: '0.75rem'
                  }}
                >
                  <UpdateIcon sx={{ fontSize: 18 }} />
                </Avatar>
                <ListItemText 
                  primary={
                    <Typography variant="body2">
                      Изменено: <b>{getUserName(transaction.audit.updatedBy || '')}</b>
                    </Typography>
                  }
                  secondary={formatDateTime(new Date(transaction.audit.updatedAt))}
                />
              </ListItem>
            )}
          </List>
        </>
      )}
    </Box>
  );
};

export default TransactionForm; 