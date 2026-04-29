import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PermissionGuard, usePermissionInfo } from '../Common/PermissionGuard';
import {
  Box,
  Button,
  TextField,
  Typography,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  SelectChangeEvent,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Divider,
  List,
  ListItem,
  ListItemText,
  Avatar,
  Checkbox,
  Autocomplete,
  InputBase,
  CircularProgress,
  InputAdornment,
  IconButton,
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import HistoryIcon from '@mui/icons-material/History';
import CreateIcon from '@mui/icons-material/CreateOutlined';
import UpdateIcon from '@mui/icons-material/Update';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';
import RemoveIcon from '@mui/icons-material/RemoveOutlined';
import CompareArrowsIcon from '@mui/icons-material/CompareArrowsOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import FilterListIcon from '@mui/icons-material/FilterListOutlined';
import BusinessIcon from '@mui/icons-material/BusinessOutlined';
import { useFinance } from '../../context/FinanceContext';
import { useUser } from '../../context/UserContext';
import { Transaction } from '../../types';
import RightSidebar from '../../components/Layout/RightSidebar';
import ConfirmDialog from '../Common/ConfirmDialog';
import { alpha } from '@mui/material/styles';
import { COMPONENT_SIZES } from '../../utils/constants';
import { 
  formatCurrency, 
  formatDate, 
  formatDateTime, 
  linkify, 
  generateRandomColor,
  createGetterFunctions
} from '../../utils/helpers';
import TransactionForm from './TransactionForm';
import CategoryForm from '../Categories/CategoryForm';
import CounterpartyForm from '../Counterparties/CounterpartyForm';
import AccountForm from '../Accounts/AccountForm';
import CounterpartyGroupForm from '../Counterparties/CounterpartyGroupForm';
import CategoryGroupForm from '../Categories/CategoryGroupForm';
import { SEARCH_FIELD_STYLES } from '../../utils/constants';
import TransactionFilters from './TransactionFilters';
import { TransactionFiltersType } from './filters/types';
import { getActiveFiltersCount } from './filters/utils';
import { FILTERS_VISIBILITY_STORAGE_KEY } from './filters/constants';

// Интерфейс для параметров пагинации
interface LabelDisplayedRowsProps {
  from: number;
  to: number;
  count: number;
}

// Компонент страницы транзакций
const TransactionsPage: React.FC = () => {
  const { 
    transactions, 
    accounts, 
    categories,
    categoryGroups,
    counterparties,
    counterpartyGroups,
    accountGroups,
    addTransaction, 
    updateTransaction, 
    deleteTransaction, 
    addCounterparty, 
    addCategory,
    addCategoryGroup,
    addAccount,
    addCounterpartyGroup,
    calculateAccountBalance
  } = useFinance();
  const { users } = useUser();
  
  // Состояние загрузки
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  // Состояния для пагинации
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  
  // Состояние для выбранных транзакций
  const [selected, setSelected] = useState<string[]>([]);
  
  // Состояние для поиска
  const [searchQuery, setSearchQuery] = useState('');
  
  // Состояние для видимости фильтров
  const [filtersVisible, setFiltersVisible] = useState(() => {
    const saved = localStorage.getItem(FILTERS_VISIBILITY_STORAGE_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  
  // Состояние для сайдбара
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  
  // Состояние для сайдбара создания контрагента
  const [counterpartySidebarOpen, setCounterpartySidebarOpen] = useState(false);
  const [currentCounterparty, setCurrentCounterparty] = useState<Partial<import('../../types').Counterparty>>({
    name: '',
    legalEntity: '',
    inn: '',
    contactPerson: '',
    phone: '',
    email: '',
    description: ''
  });
  
  // Состояние для формы новой категории
  const [categorySidebarOpen, setCategorySidebarOpen] = useState(false);
  const [currentCategory, setCurrentCategory] = useState<Partial<import('../../types').Category>>({
    name: '',
    type: 'expense' as 'income' | 'expense',
    description: '',
    color: generateRandomColor() // Случайный цвет в формате HEX
  });

  const [currentTransaction, setCurrentTransaction] = useState<Partial<Transaction>>({
    amount: 0,
    accountId: '',
    categoryId: '',
    counterpartyId: '',
    description: '',
    date: new Date(),
    type: 'expense',
    toAccountId: '',
    toAmount: 0,
    toCurrency: '',
  });

  // Состояние для формы нового счета
  const [accountSidebarOpen, setAccountSidebarOpen] = useState(false);
  const [currentAccount, setCurrentAccount] = useState<Partial<import('../../types').Account>>({
    name: '',
    balance: 0,
    currency: 'RUB',
    description: '',
    groupId: '',
    accountType: 'checking' as const,
    // Банковские поля
    bankName: '',
    bik: '',
    accountNumber: '',
    correspondentAccount: '',
    acquiringPercentage: 0,
    // Поля для карт
    cardHolder: '',
    cardNumber: ''
  });

  // Состояние для формы новой группы контрагентов
  const [counterpartyGroupSidebarOpen, setCounterpartyGroupSidebarOpen] = useState(false);
  const [currentCounterpartyGroup, setCurrentCounterpartyGroup] = useState<Partial<import('../../types').CounterpartyGroup>>({
    name: '',
    description: ''
  });

  // Состояние для формы новой группы категорий
  const [categoryGroupSidebarOpen, setCategoryGroupSidebarOpen] = useState(false);
  const [currentCategoryGroup, setCurrentCategoryGroup] = useState<Partial<import('../../types').CategoryGroup>>({
    name: '',
    type: 'both' as 'income' | 'expense' | 'both',
    description: ''
  });

  // Фильтры с состоянием
  const [filters, setFilters] = useState<TransactionFiltersType>({
    dateRange: { start: null, end: null },
    accountIds: [],
    categoryIds: [],
    counterpartyIds: [],
    type: 'all',
    amountRange: { min: null, max: null }
  });

  // Создаем функции получения данных по ID с мемоизацией
  const { getById: getAccountById } = useMemo(() => createGetterFunctions(accounts), [accounts]);
  const { getById: getCategoryById } = useMemo(() => createGetterFunctions(categories), [categories]);
  const { getById: getCounterpartyById } = useMemo(() => createGetterFunctions(counterparties), [counterparties]);

  // Получение имени пользователя по ID
  const getUserName = (userId: string) => {
    if (userId === 'system') return 'Система';
    const user = users.find(u => u.id === userId);
    return user ? user.fullName : 'Неизвестный пользователь';
  };
  
  // Форматирование суммы с учетом валюты
  const formatAmount = (transaction: Transaction) => {
    const account = getAccountById(transaction.accountId);
    if (!account) return `${transaction.amount}`;
    
    return formatCurrency(transaction.amount, account.currency);
  };

  // Открыть сайдбар для добавления нового прихода
  const handleAddIncomeClick = () => {
    setCurrentTransaction({
      amount: 0,
      accountId: accounts.length > 0 ? accounts[0].id : '',
      categoryId: '',
      counterpartyId: '',
      description: '',
      date: new Date(),
      type: 'income',
      toAccountId: '',
      toAmount: 0,
      toCurrency: '',
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для добавления нового расхода
  const handleAddExpenseClick = () => {
    setCurrentTransaction({
      amount: 0,
      accountId: accounts.length > 0 ? accounts[0].id : '',
      categoryId: '',
      counterpartyId: '',
      description: '',
      date: new Date(),
      type: 'expense',
      toAccountId: '',
      toAmount: 0,
      toCurrency: '',
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для добавления нового перевода
  const handleAddTransferClick = () => {
    if (accounts.length < 2) {
      alert('Для создания перевода необходимо иметь как минимум два счета');
      return;
    }
    
    setCurrentTransaction({
      amount: 0,
      accountId: '', // Не выбираем счет по умолчанию
      toAccountId: '', // Не выбираем целевой счет по умолчанию
      categoryId: '',
      counterpartyId: '',
      description: '',
      date: new Date(),
      type: 'transfer',
      toAmount: 0,
      toCurrency: '',
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для редактирования транзакции
  const handleEditClick = (transaction: Transaction) => {
    setCurrentTransaction({
      ...transaction,
      date: new Date(transaction.date),
      // Убеждаемся, что файлы корректно передаются
      attachments: transaction.attachments || []
    });
    setIsEditing(true);
    setSidebarOpen(true);
  };

  // Закрыть сайдбар
  const handleClose = () => {
    setSidebarOpen(false);
  };

  // Обработка изменения полей формы
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCurrentTransaction({
      ...currentTransaction,
      [name]: name === 'amount' ? parseFloat(value) || 0 : value,
    });
  };

  // Обработка изменения даты
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTransaction({
      ...currentTransaction,
      date: new Date(e.target.value),
    });
  };

  // Обработка изменения типа транзакции
  const handleTypeChange = (e: SelectChangeEvent) => {
    const type = e.target.value as 'income' | 'expense' | 'transfer';
    
    if (type === 'transfer') {
      // Для перевода выбираем второй счет автоматически, если есть
      const targetAccountId = accounts.find(a => a.id !== currentTransaction.accountId)?.id || '';
      setCurrentTransaction({
        ...currentTransaction,
        type,
        categoryId: '',
        toAccountId: targetAccountId,
        toAmount: 0,
        toCurrency: '',
      });
    } else {
      // Для доходов/расходов сбрасываем категорию и целевой счет
      setCurrentTransaction({
        ...currentTransaction,
        type,
        categoryId: '',
        toAccountId: '',
        toAmount: 0,
        toCurrency: '',
      });
    }
  };

  // Создадим обработчик для выбора счета через Autocomplete
  const handleAccountAutocompleteChange = (event: React.SyntheticEvent, newValue: any) => {
    // Если выбрана опция "Добавить счет"
    if (newValue && newValue.isAddOption) {
      // Открываем сайдбар для создания нового счета
      setAccountSidebarOpen(true);
      return;
    }
    
    const newAccountId = newValue ? newValue.id : '';
    
    // Если выбран тот же счет, что и целевой в случае перевода,
    // меняем целевой счет на другой доступный
    if (currentTransaction.type === 'transfer' && newAccountId === currentTransaction.toAccountId) {
      const otherAccount = accounts.find(a => a.id !== newAccountId);
      
      setCurrentTransaction({
        ...currentTransaction,
        accountId: newAccountId,
        toAccountId: otherAccount?.id || '',
        toAmount: 0,
        toCurrency: '',
      });
    } else {
      setCurrentTransaction({
        ...currentTransaction,
        accountId: newAccountId,
      });
    }
  };

  // Создадим обработчик для выбора целевого счета через Autocomplete
  const handleToAccountAutocompleteChange = (event: React.SyntheticEvent, newValue: any) => {
    // Если выбрана опция "Добавить счет"
    if (newValue && newValue.isAddOption) {
      // Открываем сайдбар для создания нового счета
      setAccountSidebarOpen(true);
      return;
    }
    
    const newToAccountId = newValue ? newValue.id : '';
    
    // Если выбран тот же счет, что и исходный в случае перевода,
    // меняем исходный счет на другой доступный
    if (currentTransaction.type === 'transfer' && newToAccountId === currentTransaction.accountId) {
      const otherAccount = accounts.find(a => a.id !== newToAccountId);
      
      setCurrentTransaction({
        ...currentTransaction,
        accountId: otherAccount?.id || '',
        toAccountId: newToAccountId,
        toAmount: 0,
        toCurrency: '',
      });
    } else {
      setCurrentTransaction({
        ...currentTransaction,
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
      // Устанавливаем тип новой категории в соответствии с типом транзакции
      setCurrentCategory(prev => ({
        ...prev,
        type: currentTransaction.type === 'income' ? 'income' : 'expense'
      }));
      
      // Открываем сайдбар для создания новой категории
      setCategorySidebarOpen(true);
      return;
    }
    
    // Иначе устанавливаем выбранную категорию
    setCurrentTransaction({
      ...currentTransaction,
      categoryId: newValue ? newValue.id : ''
    });
  };

  // Обработка изменения контрагента
  const handleCounterpartyChange = (event: React.SyntheticEvent, newValue: any) => {
    // Если выбрана опция "Добавить контрагента"
    if (newValue && newValue.isAddOption) {
      // Устанавливаем тип новой категории в соответствии с типом транзакции
      setCurrentCategory(prev => ({
        ...prev,
        type: currentTransaction.type === 'income' ? 'income' : 'expense'
      }));
      setCounterpartySidebarOpen(true);
      return;
    }
    
    // Иначе устанавливаем выбранного контрагента
    setCurrentTransaction({
      ...currentTransaction,
      counterpartyId: newValue ? newValue.id : ''
    });
  };

  // Сохранение нового контрагента
  const handleSaveNewCounterparty = () => {
    // Проверка обязательных полей
    if (!currentCounterparty.name) {
      alert('Пожалуйста, укажите название контрагента');
      return;
    }
    
    // Создаем нового контрагента
    addCounterparty(currentCounterparty as Omit<import('../../types').Counterparty, 'id' | 'audit'>);
    
    // Закрываем сайдбар
    setCounterpartySidebarOpen(false);
    
    // Сбрасываем форму
    setCurrentCounterparty({
      name: '',
      legalEntity: '',
      inn: '',
      contactPerson: '',
      phone: '',
      email: '',
      description: ''
    });

    // Автоматически выбираем созданного контрагента
    setTimeout(() => {
      const newlyCreatedCounterparty = counterparties
        .filter(c => c.name === currentCounterparty.name)
        .pop();
      
      if (newlyCreatedCounterparty) {
        setCurrentTransaction(prev => ({
          ...prev,
          counterpartyId: newlyCreatedCounterparty.id
        }));
      }
    }, 100);
  };

  // Сохранение новой категории
  const handleSaveNewCategory = () => {
    // Проверка обязательных полей
    if (!currentCategory.name) {
      alert('Пожалуйста, укажите название категории');
      return;
    }
    
    // Создаем новую категорию
    addCategory(currentCategory as Omit<import('../../types').Category, 'id' | 'audit'>);
    
    // Закрываем сайдбар
    setCategorySidebarOpen(false);
      
      // Сбрасываем форму
      setCurrentCategory({
        name: '',
        type: 'expense' as 'income' | 'expense',
        description: '',
        color: generateRandomColor()
      });

      // Автоматически выбираем созданную категорию
      setTimeout(() => {
        const newlyCreatedCategory = categories
          .filter(c => c.name === currentCategory.name)
          .pop();
        
        if (newlyCreatedCategory) {
          setCurrentTransaction(prev => ({
            ...prev,
            categoryId: newlyCreatedCategory.id
          }));
        }
      }, 100);
  };

  // Сохранение транзакции
  const handleSave = async () => {
    // Проверяем обязательные поля в зависимости от типа транзакции
    if (
      !currentTransaction.amount ||
      !currentTransaction.accountId ||
      !currentTransaction.date ||
      !currentTransaction.type
    ) {
      alert('Пожалуйста, заполните все обязательные поля');
      return;
    }
    
    // Проверка для переводов
    if (currentTransaction.type === 'transfer' && !currentTransaction.toAccountId) {
      alert('Пожалуйста, выберите целевой счет для перевода');
      return;
    }
    
    if (currentTransaction.type === 'transfer' && 
        currentTransaction.accountId === currentTransaction.toAccountId) {
      alert('Исходный и целевой счета должны быть разными');
      return;
    }
    
    // Проверка на отрицательную сумму
    if (currentTransaction.amount <= 0) {
      alert('Сумма должна быть больше нуля');
      return;
    }

    // Сохраняем временные файлы
    const tempFiles = currentTransaction.attachments?.filter(file => file.id.startsWith('temp-')) || [];
    
    if (isEditing && currentTransaction.id) {
      // Обновление существующей транзакции
      const updatedTransaction = {
        ...currentTransaction,
        categoryId: (currentTransaction.categoryId === 'no-category' || !currentTransaction.categoryId) ? undefined : currentTransaction.categoryId,
        // Сохраняем поля для переводов с разными валютами
        toAmount: currentTransaction.type === 'transfer' && currentTransaction.toAmount ? currentTransaction.toAmount : undefined,
        toCurrency: currentTransaction.type === 'transfer' && currentTransaction.toCurrency ? currentTransaction.toCurrency : undefined,
      } as Transaction;
      
      updateTransaction(updatedTransaction);
      
      // Загружаем временные файлы, если они есть
      for (const file of tempFiles) {
        try {
          // Получаем Blob из URL
          const response = await fetch(file.url);
          const blob = await response.blob();
          const fileObj = new File([blob], file.name, { type: file.type });
          
          // ЗАКОММЕНТИРОВАНО: больше не используем файловую загрузку
          // await addAttachmentToTransaction(currentTransaction.id, fileObj);
        } catch (error) {
          console.error('Ошибка при добавлении файла:', error);
        }
      }
    } else {
      // Создание новой транзакции
      const selectedAccount = getAccountById(currentTransaction.accountId!);
      const selectedToAccount = currentTransaction.toAccountId ? getAccountById(currentTransaction.toAccountId) : null;
      
      const newTransactionData = {
        amount: currentTransaction.amount!,
        currency: selectedAccount?.currency || 'RUB', // Добавляем валюту из выбранного счета
        accountId: currentTransaction.accountId!,
        categoryId: (currentTransaction.categoryId === 'no-category' || !currentTransaction.categoryId) ? undefined : currentTransaction.categoryId, // Исправлено: правильно обрабатываем 'no-category'
        counterpartyId: currentTransaction.counterpartyId || undefined,
        description: currentTransaction.description || '',
        date: currentTransaction.date!,
        type: currentTransaction.type!,
        toAccountId: currentTransaction.type === 'transfer' ? currentTransaction.toAccountId : undefined,
        // Добавляем поля для переводов с разными валютами
        toAmount: currentTransaction.type === 'transfer' && selectedToAccount && selectedAccount?.currency !== selectedToAccount.currency 
          ? currentTransaction.toAmount 
          : undefined,
        toCurrency: currentTransaction.type === 'transfer' && selectedToAccount && selectedAccount?.currency !== selectedToAccount.currency
          ? selectedToAccount.currency
          : undefined,
      };
      
      console.log('TransactionsPage: Создаем транзакцию с данными:', newTransactionData);
      console.log('TransactionsPage: currentTransaction:', currentTransaction);
      console.log('TransactionsPage: selectedAccount:', selectedAccount);
      
      // Добавляем транзакцию
      try {
        const createdTransaction = await addTransaction(newTransactionData);
        console.log('TransactionsPage: Транзакция успешно создана:', createdTransaction);
        
        // Загружаем временные файлы если они есть
        if (tempFiles.length > 0) {
          console.log(`Загружаем ${tempFiles.length} файлов для новой транзакции`);
          
          // ЗАКОММЕНТИРОВАНО: больше не используем файловую загрузку
          // for (const file of tempFiles) {
          //   try {
          //     // Получаем Blob из URL
          //     const response = await fetch(file.url);
          //     const blob = await response.blob();
          //     const fileObj = new File([blob], file.name, { type: file.type });
          //     
          //     await addAttachmentToTransaction(createdTransaction.id, fileObj);
          //     console.log(`Файл "${file.name}" успешно загружен`);
          //   } catch (error) {
          //     console.error(`Ошибка при загрузке файла "${file.name}":`, error);
          //     // Не прерываем процесс из-за ошибки одного файла
          //   }
          // }
        }
        
      } catch (error) {
        console.error('TransactionsPage: Ошибка при создании транзакции:', error);
        alert(`Ошибка при создании транзакции: ${error}`);
        return; // Не закрываем форму если была ошибка
      }
    }

    // Закрытие сайдбара
    handleClose();
  };

  // Открытие диалога подтверждения удаления
  const handleDeleteClick = () => {
    setConfirmDialogOpen(true);
  };

  // Удаление транзакции
  const handleDelete = () => {
    if (currentTransaction.id) {
      deleteTransaction(currentTransaction.id);
      setConfirmDialogOpen(false);
      handleClose();
    }
  };

  // Базовые обработчики событий с useCallback
  const handleChangePage = useCallback((event: unknown, newPage: number) => {
    setPage(newPage);
  }, []);

  const handleChangeRowsPerPage = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  }, []);
  
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(0); // Сброс на первую страницу при поиске
  }, []);

  const toggleFiltersVisibility = useCallback(() => {
    const newVisibility = !filtersVisible;
    setFiltersVisible(newVisibility);
    localStorage.setItem(FILTERS_VISIBILITY_STORAGE_KEY, JSON.stringify(newVisibility));
  }, [filtersVisible]);

  // Вспомогательные функции
  const isSelected = useCallback((id: string) => selected.indexOf(id) !== -1, [selected]);
  
  // Проверяем, все ли выбранные транзакции одного типа
  const areAllSameType = useCallback(() => {
    if (selected.length <= 1) return true;
    
    const selectedTransactions = transactions.filter(t => selected.includes(t.id));
    if (selectedTransactions.length === 0) return false;
    
    const firstType = selectedTransactions[0].type;
    return selectedTransactions.every(t => t.type === firstType);
  }, [selected, transactions]);
  
  // Обработчик копирования транзакции
  const handleCopyTransaction = useCallback(() => {
    if (selected.length !== 1) return;
    
    const transactionToCopy = transactions.find(t => t.id === selected[0]);
    if (transactionToCopy) {
      setCurrentTransaction({
        ...transactionToCopy,
        id: undefined, // Не копируем ID, чтобы создать новую транзакцию
        date: new Date(), // Устанавливаем текущую дату
        description: `Копия: ${transactionToCopy.description}`,
      });
      setIsEditing(false);
      setSidebarOpen(true);
      setSelected([]);
    }
  }, [selected, transactions]);
  
  // Обработчик группового редактирования
  const handleBulkEdit = useCallback(() => {
    if (selected.length === 1) {
      // Если выбрана только одна транзакция, открываем ее для редактирования
      const transaction = transactions.find(t => t.id === selected[0]);
      if (transaction) {
        handleEditClick(transaction);
      }
    } else if (selected.length > 1 && areAllSameType()) {
      // Для групповых операций нужно будет реализовать отдельную логику
      alert('Групповое редактирование в разработке');
    }
  }, [selected, transactions, areAllSameType]);
  
  // Обработчик группового удаления
  const handleBulkDelete = useCallback(() => {
    setConfirmDialogOpen(true);
  }, []);
  
  // Подтверждение удаления выбранных транзакций
  const confirmBulkDelete = useCallback(() => {
    selected.forEach(id => {
      deleteTransaction(id);
    });
    setConfirmDialogOpen(false);
    setSelected([]);
  }, [selected, deleteTransaction]);

  // Функция для подсчета активных фильтров
  const getActiveFiltersCount = () => {
    let count = 0;
    if (filters.dateRange.start !== null || filters.dateRange.end !== null) count++;
    if (filters.type !== 'all') count++;
    if (filters.accountIds.length > 0) count++;
    if (filters.categoryIds.length > 0) count++;
    if (filters.counterpartyIds.length > 0) count++;
    if (filters.amountRange.min !== null || filters.amountRange.max !== null) count++;
    return count;
  };

  // Применение фильтров к транзакциям
  const applyFilters = (transactions: Transaction[]) => {
    return transactions.filter(transaction => {
      // Фильтр по типу операции
      if (filters.type !== 'all' && filters.type !== transaction.type) {
        return false;
      }
      
      // Фильтр по счету (проверяем как основной счет, так и целевой для переводов)
      if (filters.accountIds.length > 0) {
        const accountMatches = filters.accountIds.includes(transaction.accountId) ||
          (transaction.toAccountId && filters.accountIds.includes(transaction.toAccountId));
        if (!accountMatches) {
          return false;
        }
      }
      
      // Фильтр по контрагенту
      if (filters.counterpartyIds.length > 0) {
        // Проверяем "Без контрагента"
        if (filters.counterpartyIds.includes('no-counterparty')) {
          if (!transaction.counterpartyId) {
            // Если выбран "Без контрагента" и у транзакции нет контрагента, пропускаем
          } else if (!filters.counterpartyIds.includes(transaction.counterpartyId)) {
            return false;
          }
        } else if (!transaction.counterpartyId || !filters.counterpartyIds.includes(transaction.counterpartyId)) {
          return false;
        }
      }
      
      // Фильтр по категории
      if (filters.categoryIds.length > 0) {
        // Проверяем "Без статьи"
        if (filters.categoryIds.includes('no-category')) {
          if (!transaction.categoryId || transaction.categoryId === 'no-category') {
            // Если выбрана "Без статьи" и у транзакции нет категории, пропускаем
          } else if (!filters.categoryIds.includes(transaction.categoryId)) {
            return false;
          }
        } else if (!transaction.categoryId || !filters.categoryIds.includes(transaction.categoryId)) {
          return false;
        }
      }
      
      // Фильтр по дате
      if (filters.dateRange.start || filters.dateRange.end) {
        const transactionDate = new Date(transaction.date);
        transactionDate.setHours(0, 0, 0, 0); // Сбрасываем время для корректного сравнения
        
        if (filters.dateRange.start) {
          const startDate = new Date(filters.dateRange.start);
          startDate.setHours(0, 0, 0, 0);
          if (transactionDate < startDate) {
            return false;
          }
        }
        
        if (filters.dateRange.end) {
          const endDate = new Date(filters.dateRange.end);
          endDate.setHours(23, 59, 59, 999); // Включаем весь день
          if (transactionDate > endDate) {
            return false;
          }
        }
      }
      
      // Фильтр по сумме
      if (filters.amountRange.min !== null && transaction.amount < filters.amountRange.min) {
        return false;
      }
      if (filters.amountRange.max !== null && transaction.amount > filters.amountRange.max) {
        return false;
      }
      
      return true;
    });
  };

  // Фильтрация транзакций по поисковому запросу
  const filterTransactions = (transactions: Transaction[]) => {
    if (!searchQuery || !searchQuery.trim()) {
      return transactions;
    }

    const query = searchQuery.toLowerCase().trim();
    
    const filtered = transactions.filter(transaction => {
      const account = getAccountById(transaction.accountId);
      const category = transaction.type !== 'transfer' && transaction.categoryId && transaction.categoryId !== 'no-category' 
        ? getCategoryById(transaction.categoryId) 
        : null;
      const toAccount = transaction.toAccountId ? getAccountById(transaction.toAccountId) : null;
      const counterparty = transaction.counterpartyId ? getCounterpartyById(transaction.counterpartyId) : null;
      
      // Функция для безопасной проверки вхождения подстроки
      const safeIncludes = (text: string | undefined | null) => {
        if (!text) return false;
        return text.toLowerCase().includes(query);
      };
      
      // Проверяем все поля
      if (safeIncludes(transaction.description)) {
        return true;
      }
      
      if (safeIncludes(account?.name)) {
        return true;
      }
      
      if (safeIncludes(toAccount?.name)) {
        return true;
      }
      
      if (safeIncludes(category?.name)) {
        return true;
      }
      
      if (safeIncludes(counterparty?.name)) {
        return true;
      }
      
      // Поиск по сумме
      const amountStr = transaction.amount.toString();
      if (amountStr.includes(query)) {
        return true;
      }
      
      return false;
    });
    
    return filtered;
  };

  // Сортировка транзакций по дате (сначала новые)
  const sortedTransactions = useMemo(() => {
    return [...transactions].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [transactions]);

  // Мемоизированная фильтрация транзакций для оптимизации производительности
  const filteredTransactions = useMemo(() => {
    return filterTransactions(sortedTransactions);
  }, [sortedTransactions, searchQuery, filters]);

  // Мемоизированная пагинация для избежания лишних вычислений
  const paginatedTransactions = useMemo(() => {
    const startIndex = page * rowsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredTransactions, page, rowsPerPage]);

  // Мемоизированная проверка выбранности всех элементов
  const isAllSelected = useMemo(() => {
    return paginatedTransactions.length > 0 && selected.length === paginatedTransactions.length;
  }, [paginatedTransactions.length, selected.length]);

  // Мемоизированная проверка частичного выбора
  const isIndeterminate = useMemo(() => {
    return selected.length > 0 && selected.length < paginatedTransactions.length;
  }, [selected.length, paginatedTransactions.length]);

  // Обработчики выбора (объявлены после paginatedTransactions)
  const handleSelectAllClick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const newSelected = paginatedTransactions.map((transaction) => transaction.id);
      setSelected(newSelected);
    } else {
      setSelected([]);
    }
  }, [paginatedTransactions]);

  const handleSelectClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    const selectedIndex = selected.indexOf(id);
    let newSelected: string[] = [];

    if (selectedIndex === -1) {
      newSelected = newSelected.concat(selected, id);
    } else if (selectedIndex === 0) {
      newSelected = newSelected.concat(selected.slice(1));
    } else if (selectedIndex === selected.length - 1) {
      newSelected = newSelected.concat(selected.slice(0, -1));
    } else if (selectedIndex > 0) {
      newSelected = newSelected.concat(
        selected.slice(0, selectedIndex),
        selected.slice(selectedIndex + 1),
      );
    }

    setSelected(newSelected);
  }, [selected]);

  // Сохранение нового счета
  const handleSaveNewAccount = () => {
    // Проверка обязательных полей
    if (!currentAccount.name) {
      alert('Пожалуйста, укажите название счета');
      return;
    }
    
    // Создаем новый счет
    addAccount(currentAccount as Omit<import('../../types').Account, 'id' | 'audit'>);
    
    // Закрываем сайдбар
    setAccountSidebarOpen(false);
    
    // Находим ID только что созданного счета (последний добавленный с таким именем)
    setTimeout(() => {
      const newlyCreatedAccount = accounts
        .filter(a => a.name === currentAccount.name)
        .pop();
      
      if (newlyCreatedAccount) {
        // Устанавливаем новый счет для транзакции
        setCurrentTransaction(prev => ({
          ...prev,
          accountId: newlyCreatedAccount.id
        }));
      }
      
      // Сбрасываем форму
      setCurrentAccount({
        name: '',
        balance: 0,
        currency: 'RUB',
        description: '',
        groupId: '',
        accountType: 'checking' as const,
        // Банковские поля
        bankName: '',
        bik: '',
        accountNumber: '',
        correspondentAccount: '',
        acquiringPercentage: 0,
        // Поля для карт
        cardHolder: '',
        cardNumber: ''
      });
    }, 100);
  };

  // Эффект для управления состоянием загрузки
  useEffect(() => {
    // Имитируем минимальное время загрузки для показа прелоадера
    const timer = setTimeout(() => {
      setIsInitialLoading(false);
    }, 800);

    return () => clearTimeout(timer);
  }, []);

  // Функция для краткого форматирования сумм (15,2 ₽)
  const formatShortAmount = (amount: number, currency: string) => {
    const absAmount = Math.abs(amount);
    let shortAmount: string;
    
    if (absAmount >= 1000000) {
      shortAmount = (Math.round(absAmount / 1000000 * 10) / 10).toString() + 'М';
    } else if (absAmount >= 1000) {
      shortAmount = (Math.round(absAmount / 1000 * 10) / 10).toString() + 'К';
    } else {
      shortAmount = (Math.round(absAmount * 10) / 10).toString();
    }
    
    // Убираем .0 только если это действительно целое число
    if (shortAmount.endsWith('.0')) {
      shortAmount = shortAmount.slice(0, -2);
    }
    
    // Добавляем символ валюты
    const currencySymbol = currency === 'RUB' ? '₽' : 
                          currency === 'USD' ? '$' : 
                          currency === 'EUR' ? '€' : currency;
    
    return `${shortAmount} ${currencySymbol}`;
  };

  // Функция для очистки фильтра
  const clearFilter = (filterType: string) => {
    setFilters(prev => ({
      ...prev,
      [filterType]: filterType === 'dateRange' || filterType === 'amountRange' 
        ? { start: null, end: null, min: null, max: null }[filterType === 'dateRange' ? 'start' : 'min'] !== undefined 
          ? { start: null, end: null } 
          : { min: null, max: null }
        : null
    }));
    setPage(0);
  };

  // Обработчик для создания новой группы контрагентов
  const handleCreateCounterpartyGroup = () => {
    setCounterpartyGroupSidebarOpen(true);
  };

  // Сохранение новой группы контрагентов
  const handleSaveNewCounterpartyGroup = () => {
    // Проверка обязательных полей
    if (!currentCounterpartyGroup.name) {
      alert('Пожалуйста, укажите название группы');
      return;
    }
    
    // Создаем новую группу
    addCounterpartyGroup(currentCounterpartyGroup as Omit<import('../../types').CounterpartyGroup, 'id' | 'audit'>);
    
    // Закрываем сайдбар
    setCounterpartyGroupSidebarOpen(false);
    
    // Сбрасываем форму
    setCurrentCounterpartyGroup({
      name: '',
      description: ''
    });

    // Автоматически выбираем созданную группу
    setTimeout(() => {
      const newlyCreatedGroup = counterpartyGroups
        .filter(g => g.name === currentCounterpartyGroup.name)
        .pop();
      
      if (newlyCreatedGroup) {
        setCurrentCounterparty(prev => ({
          ...prev,
          groupId: newlyCreatedGroup.id
        }));
      }
    }, 100);
  };

  // Обработчик для создания новой группы категорий
  const handleCreateCategoryGroup = () => {
    // Устанавливаем тип группы в соответствии с типом категории
    setCurrentCategoryGroup(prev => ({
      ...prev,
      type: currentCategory.type || 'both'
    }));
    setCategoryGroupSidebarOpen(true);
  };

  // Сохранение новой группы категорий
  const handleSaveNewCategoryGroup = () => {
    // Проверка обязательных полей
    if (!currentCategoryGroup.name) {
      alert('Пожалуйста, укажите название группы');
      return;
    }
    
    // Создаем новую группу
    addCategoryGroup(currentCategoryGroup as Omit<import('../../types').CategoryGroup, 'id' | 'audit'>);
    
    // Закрываем сайдбар
    setCategoryGroupSidebarOpen(false);
    
    // Сбрасываем форму
    setCurrentCategoryGroup({
      name: '',
      type: 'both' as 'income' | 'expense' | 'both',
      description: ''
    });

    // Автоматически выбираем созданную группу
    setTimeout(() => {
      const newlyCreatedGroup = categoryGroups
        .filter(g => g.name === currentCategoryGroup.name)
        .pop();
      
      if (newlyCreatedGroup) {
        setCurrentCategory(prev => ({
          ...prev,
          groupId: newlyCreatedGroup.id
        }));
      }
    }, 100);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            placeholder="Поиск по операциям..."
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
          
          {/* Кнопка управления фильтрами */}
          <IconButton
            onClick={toggleFiltersVisibility}
            sx={{
              position: 'relative',
              width: 40,
              height: 40,
              backgroundColor: filtersVisible ? '#E3F2FD' : '#F3F4F6',
              borderRadius: '8px',
              border: filtersVisible ? '1px solid #1976D2' : '1px solid transparent',
              color: filtersVisible ? '#1976D2' : 'text.secondary',
              '&:hover': {
                backgroundColor: filtersVisible ? '#BBDEFB' : '#E5E7EB',
              }
            }}
          >
            <FilterListIcon sx={{ fontSize: '1.2rem' }} />
            {/* Индикатор количества активных фильтров */}
            {getActiveFiltersCount() > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  backgroundColor: '#DC2626',
                  color: 'white',
                  borderRadius: '50%',
                  minWidth: 16,
                  height: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: '2px solid white'
                }}
              >
                {getActiveFiltersCount()}
              </Box>
            )}
          </IconButton>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 2 }}>
          <PermissionGuard objectType="transactions" level="write">
          <Button
            variant="contained"
            onClick={handleAddIncomeClick}
            disabled={accounts.length === 0 || categories.filter(c => c.type === 'income').length === 0}
            color="primary"
            startIcon={<AddIcon sx={{ fontSize: 18 }} />}
            sx={{ 
              borderRadius: '8px',
              boxShadow: 'none',
              px: 3,
              py: 1
            }}
          >
            Приход
          </Button>
          </PermissionGuard>
          <PermissionGuard objectType="transactions" level="write">
          <Button
            variant="contained"
            onClick={handleAddExpenseClick}
            disabled={accounts.length === 0 || categories.filter(c => c.type === 'expense').length === 0}
            color="primary"
            startIcon={<RemoveIcon sx={{ fontSize: 18 }} />}
            sx={{ 
              borderRadius: '8px',
              boxShadow: 'none',
              px: 3,
              py: 1
            }}
          >
            Расход
          </Button>
          </PermissionGuard>
          <PermissionGuard objectType="transactions" level="write">
          <Button
            variant="contained"
            onClick={handleAddTransferClick}
            disabled={accounts.length < 2}
            color="primary"
            startIcon={<CompareArrowsIcon sx={{ fontSize: 18 }} />}
            sx={{ 
              borderRadius: '8px',
              boxShadow: 'none',
              px: 3,
              py: 1
            }}
          >
            Перевод
          </Button>
          </PermissionGuard>
        </Box>
      </Box>

      {/* Фильтры */}
      {filtersVisible && (
        <TransactionFilters
          filters={filters}
          onFiltersChange={(newFilters) => {
            setFilters(newFilters);
            setPage(0);
          }}
          accounts={accounts}
          categories={categories}
          counterparties={counterparties}
          accountGroups={accountGroups}
          categoryGroups={categoryGroups}
          counterpartyGroups={counterpartyGroups}
        />
      )}

      {/* Показываем прелоадер во время загрузки */}
      {isInitialLoading ? (
        <Paper sx={{ p: 4, borderRadius: '8px', border: '1px solid #F3F4F6' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={40} />
            <Typography variant="body1" color="textSecondary" align="center">
              Загрузка операций...
            </Typography>
          </Box>
        </Paper>
      ) : (
        <>
          {/* Уведомление об отсутствии данных или операций */}
          {(accounts.length === 0 || categories.length === 0 || transactions.length === 0) && (
            <Paper sx={{ p: 4, borderRadius: '8px', border: '1px solid #F3F4F6', mb: 2 }}>
              <Typography variant="body1" color="textSecondary" align="center">
                {accounts.length === 0 
                  ? 'Для создания операций необходимо сначала создать хотя бы один счет.' 
                  : categories.length === 0 
                    ? 'Для создания операций необходимо сначала создать хотя бы одну категорию.'
                    : 'У вас пока нет операций. Используйте кнопки "Приход", "Расход" или "Перевод" для создания новых операций.'}
              </Typography>
            </Paper>
          )}

          {/* Таблица операций */}
          {transactions.length > 0 && accounts.length > 0 && categories.length > 0 && (
            <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
              <TableContainer sx={{ maxHeight: 'calc(100vh - 200px)' }}>
                <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }} stickyHeader>
                  {selected.length > 0 ? (
                    // Панель инструментов для выбранных транзакций
                    <TableHead>
                      <TableRow sx={{ height: 42 }}>
                        <TableCell padding="checkbox" sx={{ width: 48, p: '0 0 0 16px', height: 42, borderBottom: '1px solid #F3F4F6' }}>
                          <Checkbox
                            checked={isAllSelected}
                            indeterminate={isIndeterminate}
                            onChange={handleSelectAllClick}
                            sx={{ p: 0 }}
                          />
                        </TableCell>
                        <TableCell colSpan={6} padding="none" sx={{ p: 0, height: 42, borderBottom: '1px solid #F3F4F6' }}>
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
                                onClick={handleCopyTransaction}
                                size="small"
                                variant="outlined"
                                sx={{ 
                                  mr: 1, 
                                  py: 0.5, 
                                  minHeight: 0, 
                                  borderColor: 'primary.light',
                                  color: 'primary.main',
                                  fontSize: '0.75rem',
                                  textTransform: 'none',
                                  borderRadius: '8px'
                                }}
                              >
                                Копировать
                              </Button>
                            )}
                            
                            {areAllSameType() && (
                              <Button
                                onClick={handleBulkEdit}
                                size="small"
                                variant="outlined"
                                sx={{ 
                                  mr: 1, 
                                  py: 0.5, 
                                  minHeight: 0, 
                                  borderColor: 'primary.light',
                                  color: 'primary.main',
                                  fontSize: '0.75rem',
                                  textTransform: 'none',
                                  borderRadius: '8px'
                                }}
                              >
                                Редактировать
                              </Button>
                            )}
                            
                            <Button
                              onClick={handleBulkDelete}
                              size="small"
                              variant="contained"
                              sx={{ 
                                py: 0.5, 
                                minHeight: 0, 
                                bgcolor: 'error.main',
                                color: 'white',
                                fontSize: '0.75rem',
                                textTransform: 'none',
                                borderRadius: '8px',
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
                      <TableRow sx={{ height: 42 }}>
                        <TableCell padding="checkbox" sx={{ width: 48, p: '0 0 0 16px', height: 42, borderBottom: '1px solid #F3F4F6' }}>
                          <Checkbox
                            checked={isAllSelected}
                            indeterminate={isIndeterminate}
                            onChange={handleSelectAllClick}
                            sx={{ p: 0 }}
                          />
                        </TableCell>
                        <TableCell sx={{ width: '12%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6' }}>Дата</TableCell>
                        <TableCell sx={{ width: '18%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6' }}>Сумма</TableCell>
                        <TableCell sx={{ width: '23%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6' }}>Статья</TableCell>
                        <TableCell sx={{ width: '22%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6' }}>Контрагент</TableCell>
                        <TableCell sx={{ width: '25%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6' }}>Счет</TableCell>
                      </TableRow>
                    </TableHead>
                  )}
                  <TableBody>
                    {paginatedTransactions.map((transaction) => {
                      const account = getAccountById(transaction.accountId);
                      const category = transaction.type !== 'transfer' && transaction.categoryId && transaction.categoryId !== 'no-category' 
                        ? getCategoryById(transaction.categoryId) 
                        : null;
                      const counterparty = transaction.counterpartyId ? getCounterpartyById(transaction.counterpartyId) : null;
                      const toAccount = transaction.toAccountId ? getAccountById(transaction.toAccountId) : null;
                      const isItemSelected = isSelected(transaction.id);
                      
                      return (
                        <TableRow 
                          key={transaction.id}
                          onClick={() => handleEditClick(transaction)}
                          sx={{ 
                            cursor: 'pointer',
                            height: 48, // Уменьшенная высота строки
                            '&:hover': {
                              backgroundColor: '#F9FAFB',
                            },
                            ...(isItemSelected ? { backgroundColor: '#F3F4F6' } : {}),
                            '& .MuiTableCell-root': { 
                              borderBottom: '1px solid #F3F4F6',
                              py: 1,
                              height: 48, // Уменьшенная высота ячеек
                            }
                          }}
                          selected={isItemSelected}
                        >
                          <TableCell padding="checkbox" sx={{ width: 48, p: '0 0 0 16px' }}>
                            <Checkbox
                              checked={isItemSelected}
                              onClick={(event) => handleSelectClick(event, transaction.id)}
                              sx={{ p: 0 }}
                            />
                          </TableCell>
                          <TableCell>{formatDate(transaction.date)}</TableCell>
                          <TableCell sx={{ 
                            color: transaction.type === 'income' ? 'success.main' : 
                                   transaction.type === 'expense' ? 'error.main' : 'text.primary',
                            fontWeight: 500
                          }}>
                            {transaction.type === 'transfer' && transaction.toAmount && transaction.toCurrency ? (
                              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                <Typography variant="body2" sx={{ lineHeight: 1.2 }}>
                                  -{formatAmount(transaction)}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
                                  +{formatCurrency(transaction.toAmount, transaction.toCurrency)}
                                </Typography>
                              </Box>
                            ) : (
                              <>
                                {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''}
                                {formatAmount(transaction)}
                              </>
                            )}
                          </TableCell>
                          <TableCell>
                            {transaction.type === 'transfer' ? (
                              <Box sx={{ height: 48, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
                                    {linkify(transaction.description)}
                                  </Typography>
                                )}
                              </Box>
                            ) : (
                              <Box sx={{ height: 48, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
                                    {category ? category.name : 'Без статьи'}
                                  </Typography>
                                </Box>
                                {transaction.description && (
                                  <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.2 }}>
                                    {linkify(transaction.description)}
                                  </Typography>
                                )}
                              </Box>
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ height: 48, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              {counterparty ? (
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Box sx={{ 
                                    width: 24, 
                                    height: 24, 
                                    borderRadius: '50%', 
                                    backgroundColor: '#F3F4F6',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    mr: 1
                                  }}>
                                    <BusinessIcon sx={{ color: 'text.secondary', fontSize: '16px' }} />
                                  </Box>
                                  {counterparty.name}
                                </Box>
                              ) : (
                                '—'
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ height: 48, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              {transaction.type === 'transfer' && toAccount ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                  {/* Исходный счет */}
                                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <Typography variant="body2" sx={{ mr: 1 }}>
                                      {account ? account.name : 'Неизвестный счет'}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', mr: 1 }}>
                                      {account && formatShortAmount(
                                        calculateAccountBalance(account.id), 
                                        account.currency
                                      )}
                                    </Typography>
                                    <SwapHorizIcon fontSize="small" sx={{ color: '#9E9E9E', fontSize: '16px' }} />
                                  </Box>
                                  {/* Целевой счет */}
                                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <Typography variant="body2" sx={{ mr: 1 }}>
                                      {toAccount.name}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', mr: 1 }}>
                                      {formatShortAmount(
                                        calculateAccountBalance(toAccount.id), 
                                        toAccount.currency
                                      )}
                                    </Typography>
                                    <SwapHorizIcon fontSize="small" sx={{ color: '#9E9E9E', fontSize: '16px' }} />
                                  </Box>
                                </Box>
                              ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Typography variant="body2" sx={{ mr: 1 }}>
                                    {account ? account.name : 'Неизвестный счет'}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: 'text.secondary', mr: 1 }}>
                                    {account && formatShortAmount(
                                      calculateAccountBalance(account.id), 
                                      account.currency
                                    )}
                                  </Typography>
                                  {transaction.type === 'income' ? (
                                    <TrendingUpIcon fontSize="small" sx={{ color: 'success.main', fontSize: '16px' }} />
                                  ) : (
                                    <TrendingDownIcon fontSize="small" sx={{ color: 'error.main', fontSize: '16px' }} />
                                  )}
                                </Box>
                              )}
                            </Box>
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
                count={filteredTransactions.length}
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
          )}
        </>
      )}

      {/* Правый сайдбар для добавления/редактирования транзакции */}
      <RightSidebar 
        open={sidebarOpen} 
        onClose={handleClose} 
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
              {isEditing 
                ? 'Редактировать операцию' 
                : (
                  <Box component="span" sx={{ display: 'flex', alignItems: 'baseline' }}>
                    Добавить операцию{' '}
                    <Box 
                      component="span" 
                      onClick={() => {
                        const type = currentTransaction.type === 'income' ? 'expense' : currentTransaction.type === 'expense' ? 'transfer' : 'income';
                        
                        if (type === 'transfer') {
                          // Для перевода выбираем второй счет автоматически, если есть
                          const targetAccountId = accounts.find(a => a.id !== currentTransaction.accountId)?.id || '';
                          setCurrentTransaction({
                            ...currentTransaction,
                            type,
                            categoryId: '',
                            toAccountId: targetAccountId,
                            toAmount: 0,
                            toCurrency: '',
                          });
                        } else {
                          // Для доходов/расходов сбрасываем категорию и целевой счет
                          setCurrentTransaction({
                            ...currentTransaction,
                            type,
                            categoryId: '',
                            toAccountId: '',
                            toAmount: 0,
                            toCurrency: '',
                          });
                        }
                      }}
                      sx={{ 
                        cursor: 'pointer',
                        color: currentTransaction.type === 'income' 
                          ? 'success.main' 
                          : currentTransaction.type === 'expense'
                            ? 'error.main'
                            : 'primary.main',
                        fontWeight: 500,
                        borderBottom: '1px dashed',
                        borderColor: currentTransaction.type === 'income' 
                          ? 'success.main' 
                          : currentTransaction.type === 'expense'
                            ? 'error.main'
                            : 'primary.main',
                        ml: 0.5,
                        display: 'inline-flex',
                        alignItems: 'center',
                        '&:hover': {
                          opacity: 0.8
                        }
                      }}
                    >
                      {currentTransaction.type === 'income' && (
                        <>
                          прихода
                          <AddIcon sx={{ fontSize: 16, ml: 0.5 }} />
                        </>
                      )}
                      {currentTransaction.type === 'expense' && (
                        <>
                          расхода
                          <RemoveIcon sx={{ fontSize: 16, ml: 0.5 }} />
                        </>
                      )}
                      {currentTransaction.type === 'transfer' && (
                        <>
                          перевода
                          <CompareArrowsIcon sx={{ fontSize: 16, ml: 0.5 }} />
                        </>
                      )}
                    </Box>
                  </Box>
                )
              }
            </Typography>
          </Box>
        }
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <TransactionForm
          transaction={currentTransaction}
          isEditing={isEditing}
          onSave={handleSave}
          onDelete={handleDeleteClick}
          onClose={handleClose}
          onAddCategory={() => setCategorySidebarOpen(true)}
          onAddCounterparty={() => setCounterpartySidebarOpen(true)}
          onAddAccount={() => setAccountSidebarOpen(true)}
          onTransactionChange={setCurrentTransaction}
        />
      </RightSidebar>

      {/* Диалог подтверждения удаления */}
      <ConfirmDialog
        open={confirmDialogOpen}
        title={selected.length > 1 ? "Удалить выбранные операции" : "Удалить операцию"}
        message={selected.length > 1 
          ? `Вы уверены, что хотите удалить ${selected.length} выбранных операций? Это действие нельзя отменить.` 
          : "Вы уверены, что хотите удалить эту операцию? Это действие нельзя отменить."}
        confirmText="Удалить"
        cancelText="Отмена"
        confirmColor="primary"
        onConfirm={selected.length > 0 ? confirmBulkDelete : handleDelete}
        onCancel={() => setConfirmDialogOpen(false)}
      />

      {/* Сайдбар для создания нового контрагента */}
      <RightSidebar 
        open={counterpartySidebarOpen} 
        onClose={() => setCounterpartySidebarOpen(false)} 
        title="Добавить нового контрагента"
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CounterpartyForm
          counterparty={currentCounterparty}
          isEditing={false}
          onSave={handleSaveNewCounterparty}
          onClose={() => setCounterpartySidebarOpen(false)}
          onCounterpartyChange={setCurrentCounterparty}
          onCreateGroup={handleCreateCounterpartyGroup}
        />
      </RightSidebar>

      {/* Сайдбар для создания новой категории */}
      <RightSidebar 
        open={categorySidebarOpen} 
        onClose={() => setCategorySidebarOpen(false)} 
        title="Добавить новую статью"
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CategoryForm
          category={currentCategory}
          isEditing={false}
          onSave={handleSaveNewCategory}
          onClose={() => setCategorySidebarOpen(false)}
          onCategoryChange={setCurrentCategory}
          onCreateGroup={handleCreateCategoryGroup}
        />
      </RightSidebar>

      {/* Сайдбар для создания нового счета */}
      <RightSidebar 
        open={accountSidebarOpen} 
        onClose={() => setAccountSidebarOpen(false)} 
        title="Добавить новый счет"
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <AccountForm
          account={currentAccount}
          isEditing={false}
          onSave={handleSaveNewAccount}
          onClose={() => setAccountSidebarOpen(false)}
          onAccountChange={setCurrentAccount}
        />
      </RightSidebar>

      {/* Сайдбар для создания новой группы контрагентов */}
      <RightSidebar 
        open={counterpartyGroupSidebarOpen} 
        onClose={() => setCounterpartyGroupSidebarOpen(false)} 
        title="Добавить новую группу контрагентов"
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CounterpartyGroupForm
          counterpartyGroup={currentCounterpartyGroup}
          isEditing={false}
          onSave={handleSaveNewCounterpartyGroup}
          onClose={() => setCounterpartyGroupSidebarOpen(false)}
          onCounterpartyGroupChange={setCurrentCounterpartyGroup}
        />
      </RightSidebar>

      {/* Сайдбар для создания новой группы категорий */}
      <RightSidebar 
        open={categoryGroupSidebarOpen} 
        onClose={() => setCategoryGroupSidebarOpen(false)} 
        title="Добавить новую группу категорий"
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CategoryGroupForm
          categoryGroup={currentCategoryGroup}
          isEditing={false}
          onSave={handleSaveNewCategoryGroup}
          onClose={() => setCategoryGroupSidebarOpen(false)}
          onCategoryGroupChange={setCurrentCategoryGroup}
        />
      </RightSidebar>
    </Box>
  );
};

export default TransactionsPage; 