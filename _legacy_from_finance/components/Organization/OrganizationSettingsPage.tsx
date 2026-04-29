import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  CircularProgress,
  Paper,
} from '@mui/material';
import { Organization } from '../../types';
import { SupabaseOrganizationService } from '../../context/services/SupabaseOrganizationService';
import OrganizationInfoTab from './OrganizationInfoTab';

/**
 * Страница настроек организации
 */
const OrganizationSettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Данные организации
  const [organization, setOrganization] = useState<Organization | null>(null);

  // Загрузка данных при монтировании компонента
  useEffect(() => {
    loadOrganizationData();
  }, []);

  /**
   * Загрузка данных организации
   */
  const loadOrganizationData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Для демонстрации используем первую организацию
      // В реальном приложении ID организации будет браться из контекста пользователя
      const orgs = await SupabaseOrganizationService.getOrganizations();
      if (orgs.length > 0) {
        const org = orgs[0];
        setOrganization(org);
      }
    } catch (err) {
      console.error('Ошибка при загрузке данных организации:', err);
      setError('Не удалось загрузить данные организации');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Обновление организации
   */
  const handleOrganizationUpdate = (updatedOrg: Organization) => {
    setOrganization(updatedOrg);
  };

  return (
    <Box>
      {/* Показываем прелоадер во время загрузки */}
      {loading ? (
        <Paper sx={{ p: 4, borderRadius: '8px', border: '1px solid #F3F4F6' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={40} />
            <Typography variant="body1" color="textSecondary" align="center">
              Загрузка настроек организации...
            </Typography>
          </Box>
        </Paper>
      ) : error || !organization ? (
        <Paper sx={{ p: 4, borderRadius: '8px', border: '1px solid #F3F4F6' }}>
          <Alert severity="error">
            {error || 'Организация не найдена'}
          </Alert>
        </Paper>
      ) : (
        <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
          <OrganizationInfoTab
            organization={organization}
            onUpdate={handleOrganizationUpdate}
          />
        </Paper>
      )}
    </Box>
  );
};

export default OrganizationSettingsPage; 