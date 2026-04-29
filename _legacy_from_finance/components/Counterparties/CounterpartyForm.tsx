import React, { useState } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  List,
  ListItem,
  ListItemText,
  Avatar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import CreateIcon from '@mui/icons-material/AddCircleOutline';
import EditIcon from '@mui/icons-material/EditOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { Counterparty } from '../../types';
import { useUser } from '../../context/UserContext';
import { useFinance } from '../../context/FinanceContext';
import { formatDateTime } from '../../utils/helpers';

// Интерфейс пропсов компонента
interface CounterpartyFormProps {
  /** Текущий контрагент для редактирования или пустой для создания */
  counterparty: Partial<Counterparty>;
  /** Флаг режима редактирования */
  isEditing: boolean;
  /** Обработчик сохранения контрагента */
  onSave: () => void;
  /** Обработчик удаления контрагента */
  onDelete?: () => void;
  /** Обработчик закрытия формы */
  onClose: () => void;
  /** Обработчик изменения контрагента */
  onCounterpartyChange: (counterparty: Partial<Counterparty>) => void;
  /** Обработчик открытия сайдбара создания группы */
  onCreateGroup?: () => void;
}

/**
 * Компонент формы создания/редактирования контрагента
 */
const CounterpartyForm: React.FC<CounterpartyFormProps> = ({
  counterparty,
  isEditing,
  onSave,
  onDelete,
  onClose,
  onCounterpartyChange,
  onCreateGroup
}) => {
  const { users } = useUser();
  const { counterpartyGroups = [], addCounterpartyGroup } = useFinance();

  // Состояния для валидации
  const [innError, setInnError] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Валидация ИНН (только цифры, 10 или 12 символов)
  const validateInn = (inn: string): boolean => {
    const innRegex = /^\d{10}$|^\d{12}$/;
    return inn.length === 0 || innRegex.test(inn);
  };

  // Валидация телефона (базовая проверка на наличие цифр)
  const validatePhone = (phone: string): boolean => {
    const phoneRegex = /^[\+\d\s\(\)\-]*$/;
    return phone.length === 0 || phoneRegex.test(phone);
  };

  // Валидация email
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return email.length === 0 || emailRegex.test(email);
  };

  // Валидация формы
  const validateForm = (): boolean => {
    const hasName = Boolean(counterparty.name?.trim());
    const isInnValid = validateInn(counterparty.inn || '');
    const isPhoneValid = validatePhone(counterparty.phone || '');
    const isEmailValid = validateEmail(counterparty.email || '');
    
    setInnError(!isInnValid);
    setPhoneError(!isPhoneValid);
    setEmailError(!isEmailValid);
    
    return hasName && isInnValid && isPhoneValid && isEmailValid;
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
    
    // Для ИНН разрешаем только цифры
    if (name === 'inn') {
      const numericValue = value.replace(/\D/g, '');
      onCounterpartyChange({
        ...counterparty,
        [name]: numericValue,
      });
      return;
    }
    
    onCounterpartyChange({
      ...counterparty,
      [name]: value,
    });
  };

  // Обработка изменения группы контрагента
  const handleGroupChange = (e: SelectChangeEvent) => {
    const value = e.target.value;
    
    if (value === 'add_new') {
      // Открываем диалог создания новой группы
      handleCreateNewGroup();
    } else {
      onCounterpartyChange({
        ...counterparty,
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
      const groupName = prompt('Введите название новой группы контрагентов:');
      if (groupName?.trim()) {
        try {
          addCounterpartyGroup({
            name: groupName.trim(),
            description: ''
          });
        } catch (error) {
          console.error('Ошибка при создании группы:', error);
          alert('Не удалось создать группу. Попробуйте еще раз.');
        }
      }
    }
  };

  // Получение имени пользователя по ID
  const getUserName = (userId: string) => {
    if (userId === 'system') return 'Система';
    const user = users.find(u => u.id === userId);
    return user ? user.fullName : 'Неизвестный пользователь';
  };

  return (
    <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
      {/* Название контрагента */}
      <TextField
        name="name"
        label="Название контрагента"
        type="text"
        fullWidth
        required
        value={counterparty.name || ''}
        onChange={handleInputChange}
        placeholder="Например: ООО Ромашка или Иванов И.И."
        error={showValidationErrors && !counterparty.name?.trim()}
        helperText={showValidationErrors && !counterparty.name?.trim() ? 'Обязательное поле' : ''}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
          }
        }}
      />

      {/* Первый ряд: Юридическое лицо и ИНН */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          name="legalEntity"
          label="Юридическое лицо"
          type="text"
          value={counterparty.legalEntity || ''}
          onChange={handleInputChange}
          placeholder="ООО, ИП, АО и т.д."
          sx={{
            width: '50%',
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        <TextField
          name="inn"
          label="ИНН"
          type="text"
          value={counterparty.inn || ''}
          onChange={handleInputChange}
          placeholder="1234567890"
          error={showValidationErrors && innError}
          helperText={showValidationErrors && innError ? 'ИНН должен содержать 10 или 12 цифр' : ''}
          inputProps={{ maxLength: 12 }}
          sx={{
            width: '50%',
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />
      </Box>

      {/* Второй ряд: Контактное лицо и Телефон */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          name="contactPerson"
          label="Контактное лицо"
          type="text"
          value={counterparty.contactPerson || ''}
          onChange={handleInputChange}
          placeholder="Иванов Иван Иванович"
          sx={{
            width: '50%',
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        <TextField
          name="phone"
          label="Телефон"
          type="tel"
          value={counterparty.phone || ''}
          onChange={handleInputChange}
          placeholder="+7 (999) 123-45-67"
          error={showValidationErrors && phoneError}
          helperText={showValidationErrors && phoneError ? 'Неправильный формат телефона' : ''}
          sx={{
            width: '50%',
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />
      </Box>

      {/* Email */}
      <TextField
        name="email"
        label="Email"
        type="email"
        fullWidth
        value={counterparty.email || ''}
        onChange={handleInputChange}
        placeholder="example@company.com"
        error={showValidationErrors && emailError}
        helperText={showValidationErrors && emailError ? 'Неправильный формат email' : ''}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
          }
        }}
      />

      {/* Группа контрагента */}
      <FormControl fullWidth>
        <InputLabel>Группа контрагентов</InputLabel>
        <Select
          value={counterparty.groupId && counterpartyGroups.find(g => g.id === counterparty.groupId) ? counterparty.groupId : ''}
          label="Группа контрагентов"
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
          {counterpartyGroups.map((group) => (
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
        multiline
        rows={2}
        value={counterparty.description || ''}
        onChange={handleInputChange}
        placeholder="Краткое описание контрагента"
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

      {/* Кнопки для новых контрагентов */}
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

export default CounterpartyForm; 