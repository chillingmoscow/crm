import React, { useState } from 'react';
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
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { Category } from '../../types';
import { useFinance } from '../../context/FinanceContext';
import { CATEGORY_COLORS } from '../../utils/constants';

// Интерфейс пропсов компонента
interface CategoryFormProps {
  /** Текущая категория для редактирования или пустая для создания */
  category: Partial<Category>;
  /** Флаг режима редактирования */
  isEditing: boolean;
  /** Обработчик сохранения категории */
  onSave: () => void;
  /** Обработчик удаления категории */
  onDelete?: () => void;
  /** Обработчик закрытия формы */
  onClose: () => void;
  /** Обработчик изменения категории */
  onCategoryChange: (category: Partial<Category>) => void;
  /** Обработчик открытия сайдбара создания группы */
  onCreateGroup?: () => void;
}

/**
 * Компонент формы создания/редактирования категории
 */
const CategoryForm: React.FC<CategoryFormProps> = ({
  category,
  isEditing,
  onSave,
  onDelete,
  onClose,
  onCategoryChange,
  onCreateGroup
}) => {
  const { categoryGroups = [], addCategoryGroup } = useFinance();
  
  // Состояния для валидации
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Валидация формы
  const validateForm = (): boolean => {
    const hasName = Boolean(category.name?.trim());
    const hasType = Boolean(category.type);
    
    return hasName && hasType;
  };

  // Обработчик сохранения с валидацией
  const handleSave = () => {
    setShowValidationErrors(true);
    
    if (validateForm()) {
      onSave();
    }
  };

  // Обработка изменения полей формы
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    onCategoryChange({
      ...category,
      [name]: value,
    });
  };

  // Обработка изменения типа категории
  const handleTypeChange = (e: SelectChangeEvent) => {
    onCategoryChange({
      ...category,
      type: e.target.value as 'income' | 'expense',
    });
  };

  // Обработка изменения цвета категории
  const handleColorChange = (e: SelectChangeEvent) => {
    onCategoryChange({
      ...category,
      color: e.target.value,
    });
  };

  // Обработка изменения группы категории
  const handleGroupChange = (e: SelectChangeEvent) => {
    const value = e.target.value;
    
    if (value === 'add_new') {
      // Открываем диалог создания новой группы
      handleCreateNewGroup();
    } else {
      onCategoryChange({
        ...category,
        groupId: value || undefined,
      });
    }
  };

  // Создание новой группы
  const handleCreateNewGroup = () => {
    if (onCreateGroup) {
      onCreateGroup();
    } else {
      // Fallback на prompt если не передан колбэк
      const groupName = prompt('Введите название новой группы категорий:');
      if (groupName?.trim()) {
        const groupType = category.type || 'both';
        
        try {
          addCategoryGroup({
            name: groupName.trim(),
            type: groupType as 'income' | 'expense' | 'both',
            description: ''
          });
        } catch (error) {
          console.error('Ошибка при создании группы:', error);
          alert('Не удалось создать группу. Попробуйте еще раз.');
        }
      }
    }
  };

  // Фильтрация групп по типу категории
  const getFilteredGroups = () => {
    return categoryGroups.filter(group => 
      group.type === 'both' || group.type === category.type
    );
  };

  return (
    <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
      {/* Название категории */}
      <TextField
        name="name"
        label="Название"
        type="text"
        fullWidth
        required
        value={category.name || ''}
        onChange={handleInputChange}
        placeholder="Например: Продажи или Аренда офиса"
        error={showValidationErrors && !category.name?.trim()}
        helperText={showValidationErrors && !category.name?.trim() ? 'Обязательное поле' : ''}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
          }
        }}
      />

      {/* Первый ряд: Тип и Цвет */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <FormControl sx={{ width: '50%' }} required error={showValidationErrors && !category.type}>
          <InputLabel>Тип</InputLabel>
          <Select
            value={category.type || 'expense'}
            label="Тип"
            onChange={handleTypeChange}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          >
            <MenuItem value="income">Доход</MenuItem>
            <MenuItem value="expense">Расход</MenuItem>
          </Select>
          {showValidationErrors && !category.type && (
            <Typography variant="caption" color="error" sx={{ mt: 0.5, mx: 1.75 }}>
              Обязательное поле
            </Typography>
          )}
        </FormControl>

        <FormControl sx={{ width: '50%' }}>
          <InputLabel>Цвет</InputLabel>
          <Select
            value={category.color || CATEGORY_COLORS[0].value}
            label="Цвет"
            onChange={handleColorChange}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          >
            {CATEGORY_COLORS.map((color) => (
              <MenuItem key={color.value} value={color.value}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Box
                    sx={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      backgroundColor: color.value,
                      mr: 1,
                    }}
                  />
                  <Typography variant="body2">
                    {color.name}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Группа категории */}
      <FormControl fullWidth>
        <InputLabel>Группа статей</InputLabel>
        <Select
          value={category.groupId && getFilteredGroups().find(g => g.id === category.groupId) ? category.groupId : ''}
          label="Группа статей"
          onChange={handleGroupChange}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        >
          <MenuItem value="add_new" sx={{ color: 'primary.main' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1, color: 'primary.main', fontSize: 18 }} />
              Добавить новую группу
            </Box>
          </MenuItem>
          {getFilteredGroups().map((group) => (
            <MenuItem key={group.id} value={group.id}>
              {group.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Описание */}
      <TextField
        name="description"
        label="Описание"
        type="text"
        fullWidth
        value={category.description || ''}
        onChange={handleInputChange}
        placeholder="Краткое описание категории"
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
          }
        }}
      />

      {/* Кнопки управления для редактирования */}
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
              onClick={handleSave} 
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

      {/* Кнопки для новых категорий */}
      {!isEditing && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button 
            onClick={handleSave} 
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
    </Box>
  );
};

export default CategoryForm; 