import React, { useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Typography,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  InputAdornment,
} from '@mui/material';

import GroupIcon from '@mui/icons-material/CategoryOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { useFinance } from '../../context/FinanceContext';
import { Category } from '../../types';
import RightSidebar from '../Layout/RightSidebar';
import { COMPONENT_SIZES, SEARCH_FIELD_STYLES, DESIGN_STANDARDS } from '../../utils/constants';
import CategoryForm from './CategoryForm';
import ConfirmDialog from '../Common/ConfirmDialog';
import { useNavigate } from 'react-router-dom';

// Компонент страницы категорий
const CategoriesPage: React.FC = () => {
  const { categories, addCategory, updateCategory, deleteCategory } = useFinance();
  const navigate = useNavigate();
  
  // Состояние для поиска
  const [searchQuery, setSearchQuery] = useState('');
  
  // Состояние для сайдбара категорий
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [currentCategory, setCurrentCategory] = useState<Partial<Category>>({
    name: '',
    type: 'expense',
    color: '#F44336',
    description: '',
  });

  // Фильтрация категорий по поисковому запросу
  const filteredCategories = categories.filter(category =>
    category.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    category.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Открыть сайдбар для добавления новой категории
  const handleAddClick = () => {
    setCurrentCategory({
      name: '',
      type: 'expense',
      color: '#F44336',
      description: '',
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  // Открыть сайдбар для редактирования категории
  const handleEditClick = (category: Category) => {
    setCurrentCategory(category);
    setIsEditing(true);
    setSidebarOpen(true);
  };

  // Закрыть сайдбар
  const handleClose = () => {
    setSidebarOpen(false);
  };

  // Сохранение категории
  const handleSave = () => {
    if (!currentCategory.name || !currentCategory.type) {
      alert('Пожалуйста, заполните все обязательные поля');
      return;
    }

    if (isEditing && currentCategory.id) {
      // Обновление существующей категории
      updateCategory(currentCategory as Category);
    } else {
      // Создание новой категории
      addCategory({
        name: currentCategory.name,
        type: currentCategory.type,
        color: currentCategory.color || '#F44336',
        description: currentCategory.description || '',
      });
    }

    // Закрытие сайдбара
    handleClose();
  };

  // Подтверждение удаления
  const handleDeleteClick = () => {
    setConfirmDialogOpen(true);
  };

  // Удалить категорию
  const handleDeleteConfirm = () => {
    if (currentCategory.id) {
      deleteCategory(currentCategory.id);
      setConfirmDialogOpen(false);
      handleClose();
    }
  };

  // Отменить удаление
  const handleDeleteCancel = () => {
    setConfirmDialogOpen(false);
  };

  // Получение цвета для типа категории
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'income':
        return 'success';
      case 'expense':
        return 'error';
      default:
        return 'default';
    }
  };

  // Получение текста для типа категории
  const getTypeText = (type: string) => {
    switch (type) {
      case 'income':
        return 'Доход';
      case 'expense':
        return 'Расход';
      default:
        return 'Неизвестно';
    }
  };

  return (
    <Box>
      {/* Поиск и кнопки */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        {/* Поиск */}
        <TextField
          placeholder="Поиск статей..."
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
        
        {/* Кнопки */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/settings/category-groups')}
            startIcon={<GroupIcon />}
            sx={{
              borderRadius: '8px',
              px: 3,
              height: '40px'
            }}
          >
            Группы статей
          </Button>
          <Button
            variant="contained"
            onClick={handleAddClick}
            sx={{
              borderRadius: '8px',
              boxShadow: 'none',
              px: 3,
              height: '40px'
            }}
          >
            Добавить статью
          </Button>
        </Box>
      </Box>

      {/* Таблица категорий */}
      <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: 'calc(100vh - 200px)' }}>
          <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }} stickyHeader>
            <TableHead>
              <TableRow sx={{ height: 42 }}>
                <TableCell sx={{ width: '30%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Название</TableCell>
                <TableCell sx={{ width: '20%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Тип</TableCell>
                <TableCell sx={{ width: '50%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Описание</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCategories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      {searchQuery 
                        ? `Не найдено статей по запросу "${searchQuery}"`
                        : 'Статей пока нет. Нажмите "Добавить статью" для создания новой.'
                      }
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredCategories.map((category) => (
                  <TableRow 
                    key={category.id}
                    onClick={() => handleEditClick(category)}
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
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Box
                          sx={{
                            width: DESIGN_STANDARDS.COLOR_INDICATOR_SIZE,
                            height: DESIGN_STANDARDS.COLOR_INDICATOR_SIZE,
                            borderRadius: '50%',
                            backgroundColor: category.color || '#ccc',
                            mr: 1,
                          }}
                        />
                        <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {category.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={getTypeText(category.type)} 
                        color={getTypeColor(category.type) as any}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {category.description || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Сайдбар для редактирования категории */}
      <RightSidebar
        open={sidebarOpen}
        onClose={handleClose}
        title={isEditing ? 'Редактировать статью' : 'Добавить статью'}
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <CategoryForm
          category={currentCategory}
          isEditing={isEditing}
          onSave={handleSave}
          onDelete={handleDeleteClick}
          onClose={handleClose}
          onCategoryChange={setCurrentCategory}
          onCreateGroup={() => {}}
        />
      </RightSidebar>

      {/* Диалог подтверждения удаления */}
      <ConfirmDialog
        open={confirmDialogOpen}
        title="Удалить статью"
        message={`Вы уверены, что хотите удалить статью "${currentCategory.name}"?`}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </Box>
  );
};

export default CategoriesPage; 