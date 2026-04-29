import React, { useState } from 'react';
import {
  Box,
  Button,
  TextField,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { CounterpartyGroup } from '../../types';

// Интерфейс пропсов компонента
interface CounterpartyGroupFormProps {
  /** Текущая группа контрагентов для редактирования или пустая для создания */
  counterpartyGroup: Partial<CounterpartyGroup>;
  /** Флаг режима редактирования */
  isEditing: boolean;
  /** Обработчик сохранения группы */
  onSave: () => void;
  /** Обработчик удаления группы */
  onDelete?: () => void;
  /** Обработчик закрытия формы */
  onClose: () => void;
  /** Обработчик изменения группы */
  onCounterpartyGroupChange: (counterpartyGroup: Partial<CounterpartyGroup>) => void;
}

/**
 * Компонент формы создания/редактирования группы контрагентов
 */
const CounterpartyGroupForm: React.FC<CounterpartyGroupFormProps> = ({
  counterpartyGroup,
  isEditing,
  onSave,
  onDelete,
  onClose,
  onCounterpartyGroupChange
}) => {
  // Состояния для валидации
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Валидация формы
  const validateForm = (): boolean => {
    const hasName = Boolean(counterpartyGroup.name?.trim());
    
    return hasName;
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
    onCounterpartyGroupChange({
      ...counterpartyGroup,
      [name]: value,
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
        value={counterpartyGroup.name || ''}
        onChange={handleInputChange}
        placeholder="Например: Основные поставщики"
        error={showValidationErrors && !counterpartyGroup.name?.trim()}
        helperText={showValidationErrors && !counterpartyGroup.name?.trim() ? 'Обязательное поле' : ''}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
          }
        }}
      />

      {/* Описание */}
      <TextField
        name="description"
        label="Описание"
        type="text"
        fullWidth
        multiline
        rows={2}
        value={counterpartyGroup.description || ''}
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

export default CounterpartyGroupForm; 