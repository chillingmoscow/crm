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
  Chip,
  TextField,
  InputAdornment,
  IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { CategoryGroup } from '../../types';
import { useFinance } from '../../context/FinanceContext';
import RightSidebar from '../Layout/RightSidebar';
import ConfirmDialog from '../Common/ConfirmDialog';
import CategoryGroupForm from './CategoryGroupForm';
import { COMPONENT_SIZES, SEARCH_FIELD_STYLES } from '../../utils/constants';
import { formatDateTime } from '../../utils/helpers';
import { useNavigate } from 'react-router-dom';

/**
 * Компонент страницы управления группами категорий
 */
const CategoryGroupsPage: React.FC = () => {
  const { 
    categoryGroups = [], 
    categories = [],
    addCategoryGroup, 
    updateCategoryGroup, 
    deleteCategoryGroup 
  } = useFinance();
  const navigate = useNavigate();

  // Состояния для сайдбара
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [currentCategoryGroup, setCurrentCategoryGroup] = useState<Partial<CategoryGroup>>({
    name: '',
    type: 'both',
    description: ''
  });

  // Получение количества категорий в группе
  const getCategoriesInGroupCount = (groupId: string) => {
    return categories.filter(category => category.groupId === groupId).length;
  };

  // Получение цвета для типа группы
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'income':
        return 'success';
      case 'expense':
        return 'error';
      case 'both':
        return 'primary';
      default:
        return 'default';
    }
  };

  // Получение текста для типа группы
  const getTypeText = (type: string) => {
    switch (type) {
      case 'income':
        return 'Доходы';
      case 'expense':
        return 'Расходы';
      case 'both':
        return 'Доходы и расходы';
      default:
        return 'Неизвестно';
    }
  };

  // Фильтрация групп по поисковому запросу
  const filteredCategoryGroups = categoryGroups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Открыть сайдбар для добавления новой группы
  const handleAddClick = () => {
    setCurrentCategoryGroup({
      name: '',
      type: 'both',
      description: ''
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для редактирования группы
  const handleEditClick = (categoryGroup: CategoryGroup) => {
    setCurrentCategoryGroup(categoryGroup);
    setIsEditing(true);
    setSidebarOpen(true);
  };

  // Закрыть сайдбар
  const handleClose = () => {
    setSidebarOpen(false);
  };

  // Сохранение группы
  const handleSave = async () => {
    // Проверка обязательных полей
    if (!currentCategoryGroup.name || !currentCategoryGroup.type) {
      alert('Пожалуйста, заполните все обязательные поля');
      return;
    }

    if (isEditing && currentCategoryGroup.id) {
      // Обновление существующей группы
      updateCategoryGroup(currentCategoryGroup as CategoryGroup);
    } else {
      // Создание новой группы
      addCategoryGroup({
        name: currentCategoryGroup.name!,
        type: currentCategoryGroup.type!,
        description: currentCategoryGroup.description || ''
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
    if (currentCategoryGroup.id) {
      deleteCategoryGroup(currentCategoryGroup.id);
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
        <TableContainer sx={{ maxHeight: 'calc(100vh - 200px)' }}>
          <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }} stickyHeader>
            <TableHead>
              <TableRow sx={{ height: 42 }}>
                <TableCell sx={{ width: '25%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Название</TableCell>
                <TableCell sx={{ width: '35%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Описание</TableCell>
                <TableCell sx={{ width: '20%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Тип</TableCell>
                <TableCell sx={{ width: '20%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Количество статей</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCategoryGroups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      {searchQuery 
                        ? `Не найдено групп категорий по запросу "${searchQuery}"`
                        : 'Групп категорий пока нет. Создайте первую группу для организации ваших категорий.'
                      }
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredCategoryGroups.map((group) => {
                  const categoriesCount = getCategoriesInGroupCount(group.id);
                  
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
                          py: 1,
                          height: 56,
                        }
                      }}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {group.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {group.description || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={getTypeText(group.type)} 
                          color={getTypeColor(group.type) as any}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {categoriesCount}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Правый сайдбар для добавления/редактирования группы */}
      <RightSidebar 
        open={sidebarOpen} 
        onClose={handleClose} 
        title={isEditing ? 'Редактировать группу' : 'Добавить группу'}
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CategoryGroupForm
          categoryGroup={currentCategoryGroup}
          isEditing={isEditing}
          onSave={handleSave}
          onDelete={handleDeleteClick}
          onClose={handleClose}
          onCategoryGroupChange={setCurrentCategoryGroup}
        />
      </RightSidebar>

      {/* Диалог подтверждения удаления */}
      <ConfirmDialog
        open={confirmDialogOpen}
        title="Удалить группу"
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

export default CategoryGroupsPage; 