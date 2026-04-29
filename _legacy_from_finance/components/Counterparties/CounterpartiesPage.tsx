import React, { useState } from 'react';
import {
  Box,
  Button,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  InputBase,
  IconButton,
  Card,
  CardActions,
  CardContent,
  Chip,
  Avatar,
  TextField,
  InputAdornment,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';
import GroupIcon from '@mui/icons-material/CategoryOutlined';
import { useFinance } from '../../context/FinanceContext';
import { useUser } from '../../context/UserContext';
import { useNavigate } from 'react-router-dom';
import { Counterparty, CounterpartyGroup } from '../../types';
import RightSidebar from '../Layout/RightSidebar';
import ConfirmDialog from '../Common/ConfirmDialog';
import { alpha } from '@mui/material/styles';
import { COMPONENT_SIZES, SEARCH_FIELD_STYLES } from '../../utils/constants';
import { formatDateTime } from '../../utils/helpers';
import CounterpartyForm from './CounterpartyForm';
import CounterpartyGroupForm from './CounterpartyGroupForm';
import ColumnSelector, { ColumnConfig } from './ColumnSelector';

// Интерфейс для параметров пагинации
interface LabelDisplayedRowsProps {
  from: number;
  to: number;
  count: number;
}

// Ключ для сохранения настроек столбцов в localStorage
const COLUMNS_STORAGE_KEY = 'counterparties_columns_config';

// Конфигурация столбцов по умолчанию
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'name', label: 'Название', visible: true, required: true },
  { key: 'inn', label: 'ИНН', visible: true },
  { key: 'contact', label: 'Контакт', visible: true },
  { key: 'phone', label: 'Телефон', visible: true },
  { key: 'email', label: 'Email', visible: true },
  { key: 'legalEntity', label: 'Юридическое лицо', visible: false },
  { key: 'description', label: 'Описание', visible: false },
  { key: 'createdAt', label: 'Дата создания', visible: false },
];

// Компонент страницы контрагентов
const CounterpartiesPage: React.FC = () => {
  const { 
    counterparties, 
    addCounterparty, 
    updateCounterparty, 
    deleteCounterparty,
    addCounterpartyGroup 
  } = useFinance();
  const { users } = useUser();
  const navigate = useNavigate();
  
  // Состояния для пагинации
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  
  // Состояние для поиска
  const [searchQuery, setSearchQuery] = useState('');
  
  // Состояние для сайдбара
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [currentCounterparty, setCurrentCounterparty] = useState<Partial<Counterparty>>({
    name: '',
    legalEntity: '',
    inn: '',
    contactPerson: '',
    phone: '',
    email: '',
    description: '',
  });

  // Состояние для сайдбара групп контрагентов
  const [groupSidebarOpen, setGroupSidebarOpen] = useState(false);
  const [currentCounterpartyGroup, setCurrentCounterpartyGroup] = useState<Partial<CounterpartyGroup>>({
    name: '',
    description: '',
  });

  // Состояние для конфигурации столбцов
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (saved) {
      try {
        const savedColumns = JSON.parse(saved);
        // Проверяем, что все столбцы из DEFAULT_COLUMNS присутствуют
        const mergedColumns = DEFAULT_COLUMNS.map(defaultCol => {
          const savedCol = savedColumns.find((col: ColumnConfig) => col.key === defaultCol.key);
          return savedCol ? { ...defaultCol, visible: savedCol.visible } : defaultCol;
        });
        return mergedColumns;
      } catch {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });

  // Открыть сайдбар для добавления нового контрагента
  const handleAddClick = () => {
    setCurrentCounterparty({
      name: '',
      legalEntity: '',
      inn: '',
      contactPerson: '',
      phone: '',
      email: '',
      description: ''
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для редактирования контрагента
  const handleEditClick = (counterparty: Counterparty) => {
    setCurrentCounterparty({
      ...counterparty
    });
    setIsEditing(true);
    setSidebarOpen(true);
  };

  // Закрыть сайдбар
  const handleClose = () => {
    setSidebarOpen(false);
  };

  // Сохранение контрагента
  const handleSave = () => {
    // Проверяем обязательные поля
    if (!currentCounterparty.name) {
      alert('Пожалуйста, укажите название контрагента');
      return;
    }

    if (isEditing && currentCounterparty.id) {
      // Обновление существующего контрагента
      updateCounterparty(currentCounterparty as Counterparty);
    } else {
      // Создание нового контрагента
      addCounterparty({
        name: currentCounterparty.name,
        legalEntity: currentCounterparty.legalEntity || '',
        inn: currentCounterparty.inn,
        contactPerson: currentCounterparty.contactPerson,
        phone: currentCounterparty.phone,
        email: currentCounterparty.email,
        description: currentCounterparty.description
      });
    }

    // Закрытие сайдбара
    handleClose();
  };

  // Открытие диалога подтверждения удаления
  const handleDeleteClick = () => {
    setConfirmDialogOpen(true);
  };

  // Удаление контрагента
  const handleDelete = () => {
    if (currentCounterparty.id) {
      deleteCounterparty(currentCounterparty.id);
      setConfirmDialogOpen(false);
      handleClose();
    }
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

  // Обработчик изменения поискового запроса
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(0); // Сбрасываем страницу при изменении поискового запроса
  };

  // Обработчик изменения конфигурации столбцов
  const handleColumnsChange = (newColumns: ColumnConfig[]) => {
    setColumns(newColumns);
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(newColumns));
  };

  // Получение имени пользователя по ID
  const getUserName = (userId: string) => {
    if (userId === 'system') return 'Система';
    const user = users.find(u => u.id === userId);
    return user ? user.fullName : 'Неизвестный пользователь';
  };

  // Фильтрация контрагентов по поисковому запросу
  const filterCounterparties = (counterparties: Counterparty[]) => {
    if (!searchQuery.trim()) {
      return counterparties;
    }

    const query = searchQuery.toLowerCase().trim();
    
    const filtered = counterparties.filter(counterparty => {
      // Поиск по названию
      if (counterparty.name.toLowerCase().includes(query)) {
        return true;
      }
      
      // Поиск по ИНН
      if (counterparty.inn && counterparty.inn.toLowerCase().includes(query)) {
        return true;
      }
      
      // Поиск по контактному лицу
      if (counterparty.contactPerson && counterparty.contactPerson.toLowerCase().includes(query)) {
        return true;
      }
      
      // Поиск по телефону
      if (counterparty.phone && counterparty.phone.toLowerCase().includes(query)) {
        return true;
      }
      
      // Поиск по email
      if (counterparty.email && counterparty.email.toLowerCase().includes(query)) {
        return true;
      }
      
      return false;
    });
    
    return filtered;
  };

  // Фильтрация контрагентов
  const filteredCounterparties = filterCounterparties(counterparties);

  // Получение контрагентов для текущей страницы
  const paginatedCounterparties = filteredCounterparties.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  // Обработчик создания новой группы из формы контрагента
  const handleCreateGroupFromForm = () => {
    setCurrentCounterpartyGroup({
      name: '',
      description: '',
    });
    setGroupSidebarOpen(true);
  };

  // Закрыть сайдбар группы
  const handleGroupClose = () => {
    setGroupSidebarOpen(false);
  };

  // Сохранение группы
  const handleGroupSave = async () => {
    if (!currentCounterpartyGroup.name) {
      alert('Пожалуйста, заполните название группы');
      return;
    }

    try {
      const newGroup = await addCounterpartyGroup({
        name: currentCounterpartyGroup.name!,
        description: currentCounterpartyGroup.description || ''
      });

      // После создания группы выбираем её в форме контрагента
      setCurrentCounterparty(prev => ({
        ...prev,
        groupId: newGroup.id,
      }));

      // Закрываем сайдбар группы
      handleGroupClose();
    } catch (error) {
      console.error('Ошибка при создании группы:', error);
      alert('Не удалось создать группу. Попробуйте еще раз.');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        {/* Поиск */}
        <TextField
          placeholder="Поиск контрагентов..."
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

        <Box sx={{ display: 'flex', gap: 2 }}>
          <ColumnSelector
            columns={columns}
            onChange={handleColumnsChange}
          />
          <Button
            variant="outlined"
            onClick={() => navigate('/settings/counterparty-groups')}
            startIcon={<GroupIcon />}
            sx={{
              borderRadius: '8px',
              px: 3,
              py: 1,
              height: '40px'
            }}
          >
            Группы контрагентов
          </Button>
          <Button
            variant="contained"
            onClick={handleAddClick}
            sx={{
              borderRadius: '8px',
              boxShadow: 'none',
              px: 3,
              py: 1,
              height: '40px'
            }}
          >
            Добавить контрагента
          </Button>
        </Box>
      </Box>

      {counterparties.length > 0 && (
        <>
          {/* Таблица контрагентов */}
          <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: 'calc(100vh - 200px)' }}>
              <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }} stickyHeader>
                <TableHead>
                  <TableRow sx={{ height: 42 }}>
                    {columns.filter(col => col.visible).map((column) => (
                      <TableCell 
                        key={column.key}
                        sx={{ 
                          height: 42, 
                          py: 0, 
                          borderBottom: '1px solid #F3F4F6',
                          fontWeight: 600 
                        }}
                      >
                        {column.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedCounterparties.map((counterparty) => (
                    <TableRow 
                      key={counterparty.id}
                      onClick={() => handleEditClick(counterparty)}
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
                      {columns.filter(col => col.visible).map((column) => (
                        <TableCell key={column.key}>
                          {column.key === 'name' && (
                            <>
                              <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {counterparty.name}
                              </Typography>
                              {counterparty.legalEntity && (
                                <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {counterparty.legalEntity}
                                </Typography>
                              )}
                            </>
                          )}
                          {column.key === 'inn' && (
                            <Typography variant="body2">
                              {counterparty.inn || '—'}
                            </Typography>
                          )}
                          {column.key === 'contact' && (
                            <Typography variant="body2">
                              {counterparty.contactPerson || '—'}
                            </Typography>
                          )}
                          {column.key === 'phone' && (
                            <Typography variant="body2">
                              {counterparty.phone || '—'}
                            </Typography>
                          )}
                          {column.key === 'email' && (
                            <Typography variant="body2">
                              {counterparty.email || '—'}
                            </Typography>
                          )}
                          {column.key === 'legalEntity' && (
                            <Typography variant="body2">
                              {counterparty.legalEntity || '—'}
                            </Typography>
                          )}
                          {column.key === 'description' && (
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {counterparty.description || '—'}
                            </Typography>
                          )}
                          {column.key === 'createdAt' && (
                            <Typography variant="body2">
                              {counterparty.audit?.createdAt ? formatDateTime(counterparty.audit.createdAt) : '—'}
                            </Typography>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              rowsPerPageOptions={[25, 50, 100]}
              component="div"
              count={filteredCounterparties.length}
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
        </>
      )}

      {counterparties.length === 0 && (
        <Paper sx={{ p: 4, borderRadius: '8px', border: '1px solid #F3F4F6' }}>
          <Typography variant="body1" color="textSecondary" align="center">
            У вас пока нет контрагентов. Нажмите "Добавить контрагента" для создания нового.
          </Typography>
        </Paper>
      )}

      {/* Правый сайдбар для добавления/редактирования контрагента */}
      <RightSidebar 
        open={sidebarOpen} 
        onClose={handleClose} 
        title={isEditing ? 'Редактировать контрагента' : 'Добавить контрагента'}
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CounterpartyForm
          counterparty={currentCounterparty}
          isEditing={isEditing}
          onSave={handleSave}
          onDelete={handleDeleteClick}
          onClose={handleClose}
          onCounterpartyChange={setCurrentCounterparty}
          onCreateGroup={handleCreateGroupFromForm}
        />
      </RightSidebar>

      {/* Диалог подтверждения удаления */}
      <ConfirmDialog
        open={confirmDialogOpen}
        title="Удалить контрагента"
        message="Вы уверены, что хотите удалить этого контрагента? Это действие нельзя отменить."
        confirmText="Удалить"
        cancelText="Отмена"
        confirmColor="primary"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDialogOpen(false)}
      />

      {/* Правый сайдбар для добавления/редактирования группы контрагентов */}
      <RightSidebar 
        open={groupSidebarOpen} 
        onClose={handleGroupClose} 
        title="Добавить группу контрагентов"
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CounterpartyGroupForm
          counterpartyGroup={currentCounterpartyGroup}
          isEditing={false}
          onSave={handleGroupSave}
          onClose={handleGroupClose}
          onCounterpartyGroupChange={setCurrentCounterpartyGroup}
        />
      </RightSidebar>
    </Box>
  );
};

export default CounterpartiesPage; 