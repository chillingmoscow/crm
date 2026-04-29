import React, { useState } from 'react';
import {
  Box,
  Button,
  TextField,
  Popover,
  Typography,
  IconButton
} from '@mui/material';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import CloseIcon from '@mui/icons-material/Close';

// Интерфейс для диапазона сумм
interface AmountRange {
  min: number | null;
  max: number | null;
}

// Пропсы компонента
interface AmountRangeFilterProps {
  value: AmountRange;
  onChange: (range: AmountRange) => void;
  onClear?: () => void;
}

/**
 * Компонент фильтра по диапазону сумм
 */
const AmountRangeFilter: React.FC<AmountRangeFilterProps> = ({ value, onChange, onClear }) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [tempRange, setTempRange] = useState<AmountRange>(value);

  const open = Boolean(anchorEl);

  // Обработчик открытия PopOver
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
    setTempRange(value);
  };

  // Обработчик закрытия PopOver
  const handleClose = () => {
    setAnchorEl(null);
  };

  // Обработчик применения фильтра
  const handleApply = () => {
    onChange(tempRange);
    handleClose();
  };

  // Обработчик сброса фильтра
  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onClear) {
      onClear();
    }
  };

  // Обработчик изменения минимальной суммы
  const handleMinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value ? parseFloat(event.target.value) : null;
    setTempRange(prev => ({ ...prev, min: value }));
  };

  // Обработчик изменения максимальной суммы
  const handleMaxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value ? parseFloat(event.target.value) : null;
    setTempRange(prev => ({ ...prev, max: value }));
  };

  // Форматирование суммы для отображения на кнопке
  const formatAmountForDisplay = (amount: number | null) => {
    if (!amount) return '';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Текст для кнопки
  const getButtonText = () => {
    if (!value.min && !value.max) return 'Сумма';
    if (value.min && value.max) {
      return `${formatAmountForDisplay(value.min)} - ${formatAmountForDisplay(value.max)}`;
    }
    if (value.min) return `От ${formatAmountForDisplay(value.min)}`;
    if (value.max) return `До ${formatAmountForDisplay(value.max)}`;
    return 'Сумма';
  };

  const hasValue = value.min !== null || value.max !== null;

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        variant="outlined"
        onClick={handleClick}
        startIcon={hasValue ? null : <AttachMoneyIcon sx={{ fontSize: 16 }} />}
        sx={{
          borderRadius: '20px',
          backgroundColor: hasValue ? '#E3F2FD' : '#F3F4F6',
          borderColor: hasValue ? '#1976D2' : 'transparent',
          color: hasValue ? '#1976D2' : 'text.secondary',
          textTransform: 'none',
          fontSize: '0.875rem',
          minHeight: 'auto',
          py: 0.5,
          px: 2,
          pr: hasValue ? 4 : 2, // Добавляем место для крестика
          '&:hover': {
            borderColor: hasValue ? '#1976D2' : 'transparent',
            backgroundColor: hasValue ? '#BBDEFB' : '#E5E7EB'
          }
        }}
      >
        {getButtonText()}
      </Button>

      {/* Крестик для сброса */}
      {hasValue && onClear && (
        <IconButton
          size="small"
          onClick={handleClear}
          sx={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 18,
            height: 18,
            backgroundColor: '#1976D2',
            color: 'white',
            '&:hover': {
              backgroundColor: '#1565C0'
            },
            '& .MuiSvgIcon-root': {
              fontSize: 14
            }
          }}
        >
          <CloseIcon />
        </IconButton>
      )}

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        sx={{
          '& .MuiPaper-root': {
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
            minWidth: 280,
            maxWidth: 320
          }
        }}
      >
        <Box sx={{ p: 3 }}>
          {/* Поля ввода сумм */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <TextField
              label="От"
              type="number"
              size="small"
              value={tempRange.min || ''}
              onChange={handleMinChange}
              inputProps={{ 
                min: 0,
                step: 0.01
              }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="До"
              type="number"
              size="small"
              value={tempRange.max || ''}
              onChange={handleMaxChange}
              inputProps={{ 
                min: 0,
                step: 0.01
              }}
              sx={{ flex: 1 }}
            />
          </Box>

          {/* Кнопки управления */}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button
              variant="text"
              onClick={() => {
                setTempRange({ min: null, max: null });
                onChange({ min: null, max: null });
                handleClose();
              }}
              sx={{ textTransform: 'none' }}
            >
              Очистить
            </Button>
            <Button
              variant="contained"
              onClick={handleApply}
              sx={{ 
                textTransform: 'none',
                borderRadius: '8px',
                boxShadow: 'none'
              }}
            >
              Применить
            </Button>
          </Box>
        </Box>
      </Popover>
    </Box>
  );
};

export default AmountRangeFilter; 