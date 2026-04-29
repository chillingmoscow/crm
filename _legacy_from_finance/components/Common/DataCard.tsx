import React, { ReactNode } from 'react';
import { Card, CardContent, Typography, Box, alpha, useTheme } from '@mui/material';

interface DataCardProps {
  /**
   * Заголовок карточки
   */
  title: string;
  
  /**
   * Основное значение для отображения
   */
  value: string | number;
  
  /**
   * Дополнительная информация (снизу)
   */
  subtitle?: string;
  
  /**
   * Иконка для отображения
   */
  icon?: ReactNode;
  
  /**
   * Цвет для акцентов (по умолчанию primary)
   */
  color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  
  /**
   * Дополнительные действия (кнопки, меню)
   */
  actions?: ReactNode;
  
  /**
   * Обработчик клика по карточке
   */
  onClick?: () => void;
}

/**
 * Переиспользуемый компонент карточки с данными
 */
const DataCard: React.FC<DataCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  color = 'primary',
  actions,
  onClick,
}) => {
  const theme = useTheme();
  
  return (
    <Card 
      sx={{ 
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': onClick ? {
          transform: 'translateY(-4px)',
          boxShadow: theme.shadows[4],
        } : {},
      }}
      onClick={onClick}
    >
      <CardContent sx={{ height: '100%', position: 'relative' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
          {actions && (
            <Box>
              {actions}
            </Box>
          )}
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', mb: subtitle ? 1 : 0 }}>
          {icon && (
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              width: 40, 
              height: 40, 
              borderRadius: '50%', 
              bgcolor: alpha(theme.palette[color].main, 0.1),
              color: theme.palette[color].main,
              mr: 2 
            }}>
              {icon}
            </Box>
          )}
          <Typography variant="h5" component="div" fontWeight="bold">
            {value}
          </Typography>
        </Box>
        
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export default DataCard; 