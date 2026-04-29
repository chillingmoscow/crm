import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Button,
  Popover,
  Typography,
  Checkbox,
  FormControlLabel,
  List,
  ListItem,
  IconButton,
  Divider
} from '@mui/material';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import CloseIcon from '@mui/icons-material/Close';

// Интерфейс для конфигурации столбца
export interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  required?: boolean; // Обязательные столбцы нельзя скрыть
}

// Пропсы компонента
interface ColumnSelectorProps {
  columns: ColumnConfig[];
  onChange: (columns: ColumnConfig[]) => void;
}

/**
 * Компонент для выбора видимых столбцов в таблице
 */
const ColumnSelector: React.FC<ColumnSelectorProps> = ({
  columns,
  onChange
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const open = Boolean(anchorEl);

  // Подсчет выбранных столбцов (исключая обязательные)
  const visibleCount = useMemo(() => {
    return columns.filter(col => col.visible).length;
  }, [columns]);

  const optionalColumns = useMemo(() => {
    return columns.filter(col => !col.required);
  }, [columns]);

  const visibleOptionalCount = useMemo(() => {
    return optionalColumns.filter(col => col.visible).length;
  }, [optionalColumns]);

  // === Обработчики событий ===
  
  const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleColumnToggle = useCallback((columnKey: string) => {
    const updatedColumns = columns.map(col => 
      col.key === columnKey 
        ? { ...col, visible: !col.visible }
        : col
    );
    onChange(updatedColumns);
  }, [columns, onChange]);

  const handleSelectAll = useCallback(() => {
    const updatedColumns = columns.map(col => ({ ...col, visible: true }));
    onChange(updatedColumns);
  }, [columns, onChange]);

  const handleDeselectAll = useCallback(() => {
    const updatedColumns = columns.map(col => 
      col.required ? col : { ...col, visible: false }
    );
    onChange(updatedColumns);
  }, [columns, onChange]);

  // Текст для кнопки
  const getButtonText = () => {
    return `Столбцы (${visibleCount})`;
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<ViewColumnIcon />}
        onClick={handleClick}
        sx={{
          borderRadius: '8px',
          px: 2,
          py: 1,
          height: '40px',
          borderColor: '#E5E7EB',
          color: 'text.secondary',
          '&:hover': {
            borderColor: '#D1D5DB',
            backgroundColor: 'rgba(0, 0, 0, 0.01)'
          }
        }}
      >
        {getButtonText()}
      </Button>

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
          '& .MuiPopover-paper': {
            borderRadius: '8px',
            boxShadow: '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -1px rgba(0, 0, 0, 0.06)',
            border: '1px solid #E5E7EB',
            mt: 1,
            minWidth: 250,
            maxWidth: 350
          }
        }}
      >
        <Box sx={{ p: 2 }}>
          {/* Заголовок */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Видимость столбцов
            </Typography>
            <IconButton
              size="small"
              onClick={handleClose}
              sx={{ ml: 1 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* Кнопки "Выбрать все" / "Снять все" */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button
              size="small"
              variant="text"
              onClick={handleSelectAll}
              disabled={visibleOptionalCount === optionalColumns.length}
              sx={{ 
                fontSize: '0.75rem',
                px: 1,
                py: 0.5,
                minWidth: 'auto',
                borderRadius: '4px'
              }}
            >
              Все
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={handleDeselectAll}
              disabled={visibleOptionalCount === 0}
              sx={{ 
                fontSize: '0.75rem',
                px: 1,
                py: 0.5,
                minWidth: 'auto',
                borderRadius: '4px'
              }}
            >
              Сбросить
            </Button>
          </Box>

          <Divider sx={{ mb: 1 }} />

          {/* Список столбцов */}
          <List sx={{ p: 0, maxHeight: 300, overflow: 'auto' }}>
            {columns.map((column) => (
              <ListItem
                key={column.key}
                sx={{ 
                  p: 0, 
                  cursor: column.required ? 'default' : 'pointer',
                  opacity: column.required ? 0.6 : 1,
                  '&:hover': column.required ? {} : { backgroundColor: '#F5F5F5' },
                  borderRadius: '4px',
                  mb: 0.5
                }}
                onClick={() => !column.required && handleColumnToggle(column.key)}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={column.visible}
                      disabled={column.required}
                      size="small"
                      sx={{
                        color: column.required ? 'action.disabled' : 'primary.main'
                      }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                        {column.label}
                        {column.required && (
                          <Typography 
                            component="span" 
                            variant="caption" 
                            sx={{ ml: 1, color: 'text.secondary' }}
                          >
                            (обязательный)
                          </Typography>
                        )}
                      </Typography>
                    </Box>
                  }
                  sx={{ 
                    ml: 0, 
                    mr: 0, 
                    width: '100%',
                    '& .MuiFormControlLabel-label': {
                      flex: 1
                    }
                  }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      </Popover>
    </>
  );
};

export default ColumnSelector; 