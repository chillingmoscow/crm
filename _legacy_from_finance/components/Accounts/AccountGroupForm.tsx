import React from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import { AccountGroup } from '../../types';

// Интерфейс пропсов компонента
interface AccountGroupFormProps {
  /** Текущая группа для редактирования или пустая для создания */
  accountGroup: Partial<AccountGroup>;
  /** Флаг режима редактирования */
  isEditing: boolean;
  /** Обработчик сохранения группы */
  onSave: () => void;
  /** Обработчик удаления группы */
  onDelete?: () => void;
  /** Обработчик закрытия формы */
  onClose: () => void;
  /** Обработчик изменения группы */
  onAccountGroupChange: (accountGroup: Partial<AccountGroup>) => void;
}

/**
 * Компонент формы создания/редактирования группы счетов
 */
const AccountGroupForm: React.FC<AccountGroupFormProps> = ({
  accountGroup,
  isEditing,
  onSave,
  onDelete,
  onClose,
  onAccountGroupChange
}) => {
  // Обработка изменения полей формы
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    onAccountGroupChange({
      ...accountGroup,
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
        value={accountGroup.name || ''}
        onChange={handleInputChange}
        placeholder="Например: Расчетные счета"
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: '8px',
          }
        }}
      />

      {/* Кнопки управления для редактирования */}
      {isEditing && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
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

      {/* Кнопки для новых групп */}
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

      {/* Описание функциональности */}
      <Alert 
        severity="info" 
        icon={<InfoIcon />}
        sx={{ 
          mt: 6,
          '& .MuiAlert-message': {
            fontSize: '0.75rem',
            lineHeight: 1.3
          },
          borderRadius: '8px'
        }}
      >
        <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
          Объедините банковские счета в группы, чтобы они соответствовали структуре вашего бизнеса, 
          и вам было проще их анализировать. Например, это могут быть расчетные счета, депозиты, фонды и т.д.
        </Typography>
      </Alert>
    </Box>
  );
};

export default AccountGroupForm; 