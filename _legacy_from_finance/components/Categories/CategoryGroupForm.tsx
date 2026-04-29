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
import { CategoryGroup } from '../../types';

// Интерфейс пропсов компонента
interface CategoryGroupFormProps {
  /** Текущая группа категорий для редактирования или пустая для создания */
  categoryGroup: Partial<CategoryGroup>;
  /** Флаг режима редактирования */
  isEditing: boolean;
  /** Обработчик сохранения группы */
  onSave: () => void;
  /** Обработчик удаления группы */
  onDelete?: () => void;
  /** Обработчик закрытия формы */
  onClose: () => void;
  /** Обработчик изменения группы */
  onCategoryGroupChange: (categoryGroup: Partial<CategoryGroup>) => void;
}

/**
 * Компонент формы создания/редактирования группы категорий
 */
const CategoryGroupForm: React.FC<CategoryGroupFormProps> = ({
  categoryGroup,
  isEditing,
  onSave,
  onDelete,
  onClose,
  onCategoryGroupChange
}) => {
  // Состояния для валидации
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Валидация формы
  const validateForm = (): boolean => {
    const hasName = Boolean(categoryGroup.name?.trim());
    const hasType = Boolean(categoryGroup.type);
    
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
    onCategoryGroupChange({
      ...categoryGroup,
      [name]: value,
    });
  };

  // Обработка изменения типа группы
  const handleTypeChange = (e: SelectChangeEvent) => {
    onCategoryGroupChange({
      ...categoryGroup,
      type: e.target.value as 'income' | 'expense' | 'both',
    });
  };

  return (
    <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
      {/* Название группы */}
      <TextField
        name="name"
        label="Название группы"
        type="text"
        fullWidth
        required
        value={categoryGroup.name || ''}
        onChange={handleInputChange}
        placeholder="Например: Основные расходы"
        error={showValidationErrors && !categoryGroup.name?.trim()}
        helperText={showValidationErrors && !categoryGroup.name?.trim() ? 'Обязательное поле' : ''}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
          }
        }}
      />

      {/* Тип группы */}
      <FormControl fullWidth required error={showValidationErrors && !categoryGroup.type}>
        <InputLabel>Тип группы</InputLabel>
        <Select
          value={categoryGroup.type || ''}
          label="Тип группы"
          onChange={handleTypeChange}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        >
          <MenuItem value="income">Только для доходов</MenuItem>
          <MenuItem value="expense">Только для расходов</MenuItem>
          <MenuItem value="both">Для доходов и расходов</MenuItem>
        </Select>
        {showValidationErrors && !categoryGroup.type && (
          <Typography variant="caption" color="error" sx={{ mt: 0.5, mx: 1.75 }}>
            Обязательное поле
          </Typography>
        )}
      </FormControl>

      {/* Описание */}
      <TextField
        name="description"
        label="Описание"
        type="text"
        fullWidth
        multiline
        rows={2}
        value={categoryGroup.description || ''}
        onChange={handleInputChange}
        placeholder="Краткое описание группы"
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

      {/* Кнопки для новых групп */}
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

export default CategoryGroupForm; 