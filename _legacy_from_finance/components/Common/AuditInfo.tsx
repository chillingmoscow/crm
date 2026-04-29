import React from 'react';
import { Box, Typography, Tooltip, Divider } from '@mui/material';
import { AuditInfo as AuditInfoType } from '../../types';
import { useUser } from '../../context/UserContext';

interface AuditInfoProps {
  audit: AuditInfoType;
  entityType: string;
}

/**
 * Компонент для отображения информации о создании, обновлении и удалении сущности
 */
const AuditInfo: React.FC<AuditInfoProps> = ({ audit, entityType }) => {
  const { users } = useUser();
  
  // Функция для получения имени пользователя по ID
  const getUserName = (userId: string) => {
    if (userId === 'system') return 'Система';
    const user = users.find(u => u.id === userId);
    return user ? user.fullName : 'Неизвестный пользователь';
  };
  
  // Форматирование даты и времени
  const formatDateTime = (date: Date) => {
    return new Date(date).toLocaleString('ru-RU', { 
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        История изменений
      </Typography>
      
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: '0.75rem' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            Создано:
          </Typography>
          <Tooltip title={`Создано пользователем ${getUserName(audit.createdBy)}`} arrow>
            <Typography variant="caption">
              {formatDateTime(audit.createdAt)}
            </Typography>
          </Tooltip>
        </Box>
        
        {audit.updatedAt && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              Обновлено:
            </Typography>
            <Tooltip title={`Обновлено пользователем ${getUserName(audit.updatedBy || '')}`} arrow>
              <Typography variant="caption">
                {formatDateTime(audit.updatedAt)}
              </Typography>
            </Tooltip>
          </Box>
        )}
        
        {audit.deletedAt && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              Удалено:
            </Typography>
            <Tooltip title={`Удалено пользователем ${getUserName(audit.deletedBy || '')}`} arrow>
              <Typography variant="caption">
                {formatDateTime(audit.deletedAt)}
              </Typography>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default AuditInfo; 