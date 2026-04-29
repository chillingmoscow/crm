import React from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  SelectChangeEvent,
} from '@mui/material';
import {
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { LegalEntity } from '../../types';

interface LegalEntityFormProps {
  legalEntity: Partial<LegalEntity>;
  isEditing: boolean;
  loading: boolean;
  onSave: () => void;
  onClose: () => void;
  onLegalEntityChange: (legalEntity: Partial<LegalEntity>) => void;
  onDelete?: () => void;
}

// Список систем налогообложения
const TAX_SYSTEMS = [
  { value: 'УСН доходы', label: 'УСН доходы (6%)' },
  { value: 'УСН доходы минус расходы', label: 'УСН доходы минус расходы (15%)' },
  { value: 'ОСНО', label: 'Основная система налогообложения' },
  { value: 'ЕНВД', label: 'Единый налог на вмененный доход' },
  { value: 'ПСН', label: 'Патентная система налогообложения' },
  { value: 'ЕСХН', label: 'Единый сельскохозяйственный налог' },
];

/**
 * Форма создания/редактирования юридического лица
 */
const LegalEntityForm: React.FC<LegalEntityFormProps> = ({
  legalEntity,
  isEditing,
  loading,
  onSave,
  onClose,
  onLegalEntityChange,
  onDelete
}) => {
  /**
   * Обработка изменения полей формы
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    onLegalEntityChange({
      ...legalEntity,
      [name]: value
    });
  };

  /**
   * Обработка изменения системы налогообложения
   */
  const handleTaxSystemChange = (e: SelectChangeEvent) => {
    onLegalEntityChange({
      ...legalEntity,
      taxSystem: e.target.value
    });
  };

  /**
   * Обработка изменения учета НДС
   */
  const handleVatAccountingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onLegalEntityChange({
      ...legalEntity,
      vatAccountingEnabled: e.target.checked
    });
  };

  /**
   * Обработка отправки формы
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave();
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
        {/* Название */}
        <TextField
          name="name"
          label="Краткое название"
          fullWidth
          required
          value={legalEntity.name || ''}
          onChange={handleInputChange}
          placeholder="Например: Ромашка"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        {/* Полное название */}
        <TextField
          name="fullName"
          label="Полное название"
          fullWidth
          value={legalEntity.fullName || ''}
          onChange={handleInputChange}
          placeholder="Например: ООО «Ромашка»"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        {/* ИНН, КПП и ОГРН в одном ряду */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            name="inn"
            label="ИНН"
            fullWidth
            value={legalEntity.inn || ''}
            onChange={handleInputChange}
            placeholder="1234567890"
            inputProps={{
              maxLength: 12,
              pattern: '[0-9]*'
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />

          <TextField
            name="kpp"
            label="КПП"
            fullWidth
            value={legalEntity.kpp || ''}
            onChange={handleInputChange}
            placeholder="123456789"
            inputProps={{
              maxLength: 9,
              pattern: '[0-9]*'
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />

          <TextField
            name="ogrn"
            label="ОГРН"
            fullWidth
            value={legalEntity.ogrn || ''}
            onChange={handleInputChange}
            placeholder="1234567890123"
            inputProps={{
              maxLength: 15,
              pattern: '[0-9]*'
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />
        </Box>

        {/* Юридический адрес */}
        <TextField
          name="legalAddress"
          label="Юридический адрес"
          fullWidth
          multiline
          rows={2}
          value={legalEntity.legalAddress || ''}
          onChange={handleInputChange}
          placeholder="Полный юридический адрес"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        {/* Фактический адрес */}
        <TextField
          name="actualAddress"
          label="Фактический адрес"
          fullWidth
          multiline
          rows={2}
          value={legalEntity.actualAddress || ''}
          onChange={handleInputChange}
          placeholder="Фактический адрес (если отличается от юридического)"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        {/* Телефон */}
        <TextField
          name="phone"
          label="Телефон"
          fullWidth
          value={legalEntity.phone || ''}
          onChange={handleInputChange}
          placeholder="+7 (999) 123-45-67"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        {/* Email и Сайт в одном ряду */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            name="email"
            label="Email"
            type="email"
            fullWidth
            value={legalEntity.email || ''}
            onChange={handleInputChange}
            placeholder="info@example.com"
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />

          <TextField
            name="website"
            label="Сайт"
            fullWidth
            value={legalEntity.website || ''}
            onChange={handleInputChange}
            placeholder="https://example.com"
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />
        </Box>

        {/* Система налогообложения */}
        <FormControl fullWidth>
          <InputLabel>Система налогообложения</InputLabel>
          <Select
            value={legalEntity.taxSystem || ''}
            label="Система налогообложения"
            onChange={handleTaxSystemChange}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          >
            {TAX_SYSTEMS.map((system) => (
              <MenuItem key={system.value} value={system.value}>
                {system.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Переключатель "Учет НДС" */}
        <FormControlLabel
          control={
            <Switch
              checked={legalEntity.vatAccountingEnabled || false}
              onChange={handleVatAccountingChange}
              color="primary"
            />
          }
          label={
            <Box>
              <Typography variant="body1">
                Учет НДС
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Включить учет налога на добавленную стоимость
              </Typography>
            </Box>
          }
          sx={{ mb: 2 }}
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
                type="submit"
                variant="contained"
                disabled={loading}
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
                {loading ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </Box>
          </>
        )}

        {/* Кнопки для новых юридических лиц */}
        {!isEditing && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
            <Button 
              type="submit"
              variant="contained"
              disabled={loading}
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
              {loading ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </Box>
        )}
      </Box>
    );
};

export default LegalEntityForm; 