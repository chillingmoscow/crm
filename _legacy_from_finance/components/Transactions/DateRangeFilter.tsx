import React, { useState } from 'react';
import {
  Box,
  Button,
  TextField,
  Popover,
  Typography,
  Chip,
  Stack,
  IconButton
} from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CloseIcon from '@mui/icons-material/Close';

// Интерфейс для диапазона дат
interface DateRange {
  start: Date | null;
  end: Date | null;
}

// Пропсы компонента
interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

// Функции для работы с датами
const getDatePresets = () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Понедельник
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Воскресенье
  
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  const startOfQuarter = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  const endOfQuarter = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 0);
  
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const endOfYear = new Date(today.getFullYear(), 11, 31);
  
  // Прошлые периоды
  const lastWeekStart = new Date(startOfWeek);
  lastWeekStart.setDate(startOfWeek.getDate() - 7);
  const lastWeekEnd = new Date(endOfWeek);
  lastWeekEnd.setDate(endOfWeek.getDate() - 7);
  
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  
  const lastQuarterStart = new Date(startOfQuarter);
  lastQuarterStart.setMonth(startOfQuarter.getMonth() - 3);
  const lastQuarterEnd = new Date(endOfQuarter);
  lastQuarterEnd.setMonth(endOfQuarter.getMonth() - 3);
  
  const lastYearStart = new Date(today.getFullYear() - 1, 0, 1);
  const lastYearEnd = new Date(today.getFullYear() - 1, 11, 31);

  return [
    { label: 'Сегодня', start: today, end: today },
    { label: 'Вчера', start: yesterday, end: yesterday },
    { label: 'Текущая неделя', start: startOfWeek, end: endOfWeek },
    { label: 'Текущий месяц', start: startOfMonth, end: endOfMonth },
    { label: 'Текущий квартал', start: startOfQuarter, end: endOfQuarter },
    { label: 'Текущий год', start: startOfYear, end: endOfYear },
    { label: 'Прошлая неделя', start: lastWeekStart, end: lastWeekEnd },
    { label: 'Прошлый месяц', start: lastMonthStart, end: lastMonthEnd },
    { label: 'Прошлый квартал', start: lastQuarterStart, end: lastQuarterEnd },
    { label: 'Прошлый год', start: lastYearStart, end: lastYearEnd },
    { label: 'Все время', start: null, end: null }
  ];
};

/**
 * Компонент фильтра по диапазону дат
 */
const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange }) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [tempRange, setTempRange] = useState<DateRange>(value);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const open = Boolean(anchorEl);
  const datePresets = getDatePresets();

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

  // Обработчик выбора предустановленного периода
  const handlePresetClick = (preset: { label: string; start: Date | null; end: Date | null }) => {
    setTempRange({ start: preset.start, end: preset.end });
    setSelectedPreset(preset.label);
    onChange({ start: preset.start, end: preset.end });
    handleClose();
  };

  // Обработчик изменения даты начала
  const handleStartDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const date = event.target.value ? new Date(event.target.value) : null;
    
    // Если выбранная дата начала больше даты окончания, сбрасываем дату окончания
    if (date && tempRange.end && date > tempRange.end) {
      setTempRange({ start: date, end: null });
    } else {
      setTempRange(prev => ({ ...prev, start: date }));
    }
    setSelectedPreset(null); // Сбрасываем пресет при ручном вводе
  };

  // Обработчик изменения даты окончания
  const handleEndDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const date = event.target.value ? new Date(event.target.value) : null;
    
    // Если выбранная дата окончания меньше даты начала, сбрасываем дату начала
    if (date && tempRange.start && date < tempRange.start) {
      setTempRange({ start: null, end: date });
    } else {
      setTempRange(prev => ({ ...prev, end: date }));
    }
    setSelectedPreset(null); // Сбрасываем пресет при ручном вводе
  };

  // Обработчик сброса фильтра
  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedPreset(null);
    onChange({ start: null, end: null });
  };

  // Форматирование даты для отображения на кнопке
  const formatDateForDisplay = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  };

  // Текст для кнопки
  const getButtonText = () => {
    if (selectedPreset) return selectedPreset;
    if (!value.start && !value.end) return 'Дата';
    if (value.start && value.end) {
      return `${formatDateForDisplay(value.start)} - ${formatDateForDisplay(value.end)}`;
    }
    if (value.start) return `С ${formatDateForDisplay(value.start)}`;
    if (value.end) return `До ${formatDateForDisplay(value.end)}`;
    return 'Дата';
  };

  const hasValue = value.start !== null || value.end !== null;

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        variant="outlined"
        onClick={handleClick}
        startIcon={hasValue ? null : <CalendarTodayIcon sx={{ fontSize: 16 }} />}
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
      {hasValue && (
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
            minWidth: 320,
            maxWidth: 400
          }
        }}
      >
        <Box sx={{ p: 3 }}>
          {/* Поля ввода дат */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <TextField
              label="С даты"
              type="date"
              size="small"
              value={tempRange.start ? tempRange.start.toISOString().split('T')[0] : ''}
              onChange={handleStartDateChange}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="До даты"
              type="date"
              size="small"
              value={tempRange.end ? tempRange.end.toISOString().split('T')[0] : ''}
              onChange={handleEndDateChange}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Box>

          {/* Предустановленные периоды */}
          <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
            Быстрый выбор:
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {datePresets.map((preset) => (
              <Chip
                key={preset.label}
                label={preset.label}
                onClick={() => handlePresetClick(preset)}
                variant="outlined"
                size="small"
                sx={{
                  borderRadius: '16px',
                  '&:hover': {
                    backgroundColor: '#F5F5F5'
                  }
                }}
              />
            ))}
          </Stack>

          {/* Кнопка применения для ручного ввода */}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
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

export default DateRangeFilter; 