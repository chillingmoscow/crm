import React, { useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  InputAdornment,
  IconButton,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useFinance } from '../../context/FinanceContext';
import { AccountGroup } from '../../types';
import RightSidebar from '../Layout/RightSidebar';
import { COMPONENT_SIZES, SEARCH_FIELD_STYLES } from '../../utils/constants';
import AccountGroupForm from './AccountGroupForm';
import ConfirmDialog from '../Common/ConfirmDialog';
import { useNavigate } from 'react-router-dom';

/**
 * Компонент страницы управления группами счетов
 */
const AccountGroupsPage: React.FC = () => {
  const { accountGroups, accounts, addAccountGroup, updateAccountGroup, deleteAccountGroup } = useFinance();
  const navigate = useNavigate();
  
  // Состояния для сайдбара
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentGroup, setCurrentGroup] = useState<Partial<AccountGroup>>({
    name: '',
  });
  
  // Состояние для поиска
  const [searchQuery, setSearchQuery] = useState('');
  
  // Состояние для диалога подтверждения удаления
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  // Получение количества счетов в группе
  const getAccountsInGroupCount = (groupId: string) => {
    return accounts.filter(account => account.groupId === groupId).length;
  };

  // Фильтрация групп на основе поискового запроса
  const filteredGroups = accountGroups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Открыть сайдбар для добавления новой группы
  const handleAddClick = () => {
    setCurrentGroup({
      name: '',
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для редактирования группы
  const handleEditClick = (group: AccountGroup) => {
    setCurrentGroup(group);
    setIsEditing(true);
    setSidebarOpen(true);
  };

  // Закрыть сайдбар
  const handleClose = () => {
    setSidebarOpen(false);
  };

  // Сохранение группы
  const handleSave = () => {
    if (!currentGroup.name) {
      alert('Пожалуйста, укажите название группы');
      return;
    }

    if (isEditing && currentGroup.id) {
      // Обновление существующей группы
      updateAccountGroup(currentGroup as AccountGroup);
    } else {
      // Создание новой группы
      addAccountGroup({
        name: currentGroup.name,
      });
    }

    // Закрытие сайдбара
    handleClose();
  };

  // Открытие диалога подтверждения удаления
  const handleDeleteClick = () => {
    setConfirmDialogOpen(true);
  };

  // Удаление группы
  const handleDelete = () => {
    if (currentGroup.id) {
      deleteAccountGroup(currentGroup.id);
      setConfirmDialogOpen(false);
      handleClose();
    }
  };

  return (
    <Box>
      {/* Поиск и кнопки */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        {/* Поиск */}
        <TextField
          placeholder="Поиск групп..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
        
        {/* Кнопка добавления */}
        <Button
          variant="contained"
          onClick={handleAddClick}
          sx={{ 
            borderRadius: '8px',
            boxShadow: 'none',
            px: 3,
            height: '40px' // Явно задаем высоту
          }}
        >
          Добавить группу
        </Button>
      </Box>

      {/* Таблица групп */}
      <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
        <TableContainer>
          <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }} stickyHeader>
            <TableHead>
              <TableRow sx={{ height: 42 }}>
                <TableCell sx={{ height: 42, py: 0, borderBottom: '1px solid #F3F4F6', backgroundColor: '#F9FAFB', fontWeight: 600 }}>
                  Название
                </TableCell>
                <TableCell sx={{ width: '200px', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', backgroundColor: '#F9FAFB', fontWeight: 600 }}>
                  Количество счетов
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredGroups.map((group) => {
                const accountsCount = getAccountsInGroupCount(group.id);
                
                return (
                  <TableRow 
                    key={group.id}
                    onClick={() => handleEditClick(group)}
                    sx={{ 
                      cursor: 'pointer',
                      height: 56,
                      '&:hover': {
                        backgroundColor: '#F9FAFB',
                      },
                      '& .MuiTableCell-root': { 
                        borderBottom: '1px solid #F3F4F6',
                        py: 2,
                        height: 56,
                      }
                    }}
                  >
                    <TableCell>
                      <Box>
                        <Box sx={{ fontSize: '0.875rem', fontWeight: 500, color: 'text.primary' }}>
                          {group.name}
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {accountsCount}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
              
              {filteredGroups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                    {searchQuery ? 'Группы не найдены' : 'Нет созданных групп'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Правый сайдбар для добавления/редактирования группы */}
      <RightSidebar 
        open={sidebarOpen} 
        onClose={handleClose} 
        title={isEditing ? 'Редактировать группу счетов' : 'Добавить группу счетов'}
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <AccountGroupForm
          accountGroup={currentGroup}
          isEditing={isEditing}
          onSave={handleSave}
          onDelete={handleDeleteClick}
          onClose={handleClose}
          onAccountGroupChange={setCurrentGroup}
        />
      </RightSidebar>

      {/* Диалог подтверждения удаления */}
      <ConfirmDialog
        open={confirmDialogOpen}
        title="Удалить группу счетов"
        message="Вы уверены, что хотите удалить эту группу? Это действие нельзя отменить."
        confirmText="Удалить"
        cancelText="Отмена"
        confirmColor="primary"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDialogOpen(false)}
      />
    </Box>
  );
};

export default AccountGroupsPage; 