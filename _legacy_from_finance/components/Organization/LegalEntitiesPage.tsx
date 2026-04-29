import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  InputAdornment,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { LegalEntity } from '../../types';
import { SupabaseLegalEntityService } from '../../context/services/SupabaseLegalEntityService';
import { useUser } from '../../context/UserContext';
import LegalEntityForm from './LegalEntityForm';
import RightSidebar from '../Layout/RightSidebar';
import ConfirmDialog from '../Common/ConfirmDialog';
import { PermissionGuard } from '../Common/PermissionGuard';
import { COMPONENT_SIZES, SEARCH_FIELD_STYLES } from '../../utils/constants';
import { formatDateTime } from '../../utils/helpers';

/**
 * Страница управления юридическими лицами
 */
const LegalEntitiesPage: React.FC = () => {
  console.log('🏛️ LegalEntitiesPage: Компонент инициализируется');
  
  const { currentUser, loading: userLoading } = useUser();
  
  // Основное состояние
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Поиск
  const [searchQuery, setSearchQuery] = useState('');
  
  // Сайдбар для редактирования
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentLegalEntity, setCurrentLegalEntity] = useState<Partial<LegalEntity>>({});
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  /**
   * Простая загрузка юридических лиц
   */
  const loadLegalEntities = async () => {
    console.log('🔄 Загрузка юридических лиц для организации:', currentUser?.organizationId);
    
    if (!currentUser?.organizationId) {
      console.log('❌ Нет organizationId');
      setError('Не удалось определить организацию пользователя');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const entities = await SupabaseLegalEntityService.getLegalEntities(currentUser.organizationId);
      console.log('✅ Загружены юридические лица:', entities);
      setLegalEntities(entities);
      
    } catch (err) {
      console.error('❌ Ошибка загрузки:', err);
      setError(`Ошибка загрузки: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Эффект для загрузки данных при готовности пользователя
   */
  useEffect(() => {
    console.log('🔄 useEffect: userLoading =', userLoading, 'currentUser =', currentUser);
    
    // Ждем окончания загрузки пользователя
    if (userLoading) {
      console.log('⏳ Ждем загрузки пользователя...');
      return;
    }
    
    // Загружаем данные
    loadLegalEntities();
  }, [currentUser, userLoading]);

  /**
   * Фильтрация юридических лиц
   */
  const filteredEntities = legalEntities.filter(entity => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return entity.name.toLowerCase().includes(query) ||
           entity.fullName?.toLowerCase().includes(query) ||
           entity.inn?.toLowerCase().includes(query);
  });

  /**
   * Обработчики
   */
  const handleAddClick = () => {
    console.log('➕ Добавление юридического лица');
    setCurrentLegalEntity({
      organizationId: currentUser?.organizationId,
      name: '',
      isActive: true,
    });
    setIsEditing(false);
    setSidebarOpen(true);
  };

  const handleEditClick = (entity: LegalEntity) => {
    console.log('✏️ Редактирование юридического лица:', entity.name);
    setCurrentLegalEntity(entity);
    setIsEditing(true);
    setSidebarOpen(true);
  };

  const handleClose = () => {
    setSidebarOpen(false);
  };

  const handleSave = async () => {
    if (!currentUser?.organizationId || !currentLegalEntity.name?.trim()) {
      setError('Заполните все обязательные поля');
      return;
    }

    try {
      setError(null);
      console.log('💾 Сохранение юридического лица:', currentLegalEntity);

      if (isEditing && currentLegalEntity.id) {
        const updated = await SupabaseLegalEntityService.updateLegalEntity(currentLegalEntity as LegalEntity);
        setLegalEntities(prev => prev.map(e => e.id === updated.id ? updated : e));
        console.log('✅ Юридическое лицо обновлено');
      } else {
        const created = await SupabaseLegalEntityService.addLegalEntity({
          ...currentLegalEntity,
          organizationId: currentUser.organizationId,
          isActive: true,
        } as Omit<LegalEntity, 'id' | 'createdAt' | 'updatedAt'>);
        setLegalEntities(prev => [...prev, created]);
        console.log('✅ Юридическое лицо создано');
      }
      setSidebarOpen(false);
    } catch (err) {
      console.error('❌ Ошибка сохранения:', err);
      setError(`Ошибка сохранения: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`);
    }
  };

  const handleDeleteClick = () => {
    setConfirmDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!currentLegalEntity.id) return;

    try {
      await SupabaseLegalEntityService.deleteLegalEntity(currentLegalEntity.id);
      setLegalEntities(prev => prev.filter(entity => entity.id !== currentLegalEntity.id));
      setConfirmDialogOpen(false);
      setSidebarOpen(false);
      console.log('✅ Юридическое лицо удалено');
    } catch (err) {
      console.error('❌ Ошибка удаления:', err);
      setError(`Ошибка удаления: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`);
    }
  };

  /**
   * Состояния загрузки
   */
  if (userLoading) {
    console.log('⏳ Показываем загрузку пользователя');
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Загрузка пользователя...</Typography>
      </Box>
    );
  }

  if (!currentUser) {
    console.log('❌ Нет пользователя');
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          Ошибка: пользователь не авторизован
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Ошибки */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Поиск и кнопки */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        {/* Поиск */}
        <TextField
          placeholder="Поиск юридических лиц..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary', fontSize: '1.2rem' }} />
              </InputAdornment>
            ),
          }}
          sx={{
            width: SEARCH_FIELD_STYLES.width,
            ...SEARCH_FIELD_STYLES.sx,
          }}
        />
        
        {/* Кнопка добавления */}
        <PermissionGuard
          objectType="legal_entities"
          level="write"
          organizationId={currentUser?.organizationId}
          fallback={null}
        >
          <Button
            variant="contained"
            onClick={handleAddClick}
            disabled={loading}
            sx={{ 
              borderRadius: '8px',
              boxShadow: 'none',
              px: 3,
              height: '40px'
            }}
          >
            Добавить юридическое лицо
          </Button>
        </PermissionGuard>
      </Box>

      {/* Таблица юридических лиц */}
      <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress />
            <Typography sx={{ ml: 2 }}>Загрузка юридических лиц...</Typography>
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight: 'calc(100vh - 200px)' }}>
            <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }} stickyHeader>
              <TableHead>
                <TableRow sx={{ height: 42 }}>
                  <TableCell sx={{ width: '30%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Название</TableCell>
                  <TableCell sx={{ width: '25%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Фактический адрес</TableCell>
                  <TableCell sx={{ width: '25%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Контакты</TableCell>
                  <TableCell sx={{ width: '20%', height: 42, py: 0, borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>Статус</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredEntities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        {searchQuery 
                          ? `Не найдено юридических лиц по запросу "${searchQuery}"`
                          : 'Юридических лиц пока нет. Создайте первое юридическое лицо для работы с системой.'
                        }
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEntities.map((entity) => (
                    <TableRow 
                      key={entity.id}
                      onClick={() => handleEditClick(entity)}
                      sx={{ 
                        cursor: 'pointer',
                        height: 56,
                        '&:hover': {
                          backgroundColor: '#F9FAFB',
                        },
                        '& .MuiTableCell-root': { 
                          borderBottom: '1px solid #F3F4F6',
                          py: 1,
                          height: 56,
                        }
                      }}
                    >
                      <TableCell>
                        <Box sx={{ height: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entity.name}
                          </Typography>
                          {entity.fullName && entity.fullName !== entity.name && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entity.fullName}
                              {entity.inn && ` • ИНН: ${entity.inn}`}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entity.actualAddress || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ height: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          {entity.phone && (
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entity.phone}
                            </Typography>
                          )}
                          {entity.website && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entity.website}
                            </Typography>
                          )}
                          {!entity.phone && !entity.website && (
                            <Typography variant="body2" color="text.secondary">
                              —
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={entity.isActive ? 'Активное' : 'Неактивное'}
                          color={entity.isActive ? 'success' : 'default'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Правый сайдбар для добавления/редактирования */}
      <RightSidebar 
        open={sidebarOpen} 
        onClose={handleClose} 
        title={isEditing ? 'Редактировать юридическое лицо' : 'Добавить юридическое лицо'}
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <LegalEntityForm
          legalEntity={currentLegalEntity}
          isEditing={isEditing}
          loading={loading}
          onSave={handleSave}
          onClose={handleClose}
          onLegalEntityChange={setCurrentLegalEntity}
          onDelete={handleDeleteClick}
        />
      </RightSidebar>

      {/* Диалог подтверждения удаления */}
      <ConfirmDialog
        open={confirmDialogOpen}
        title="Удалить юридическое лицо"
        message={`Вы уверены, что хотите удалить юридическое лицо "${currentLegalEntity.name}"? Это действие нельзя отменить.`}
        confirmText="Удалить"
        cancelText="Отмена"
        confirmColor="primary"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDialogOpen(false)}
      />
    </Box>
  );
};

export default LegalEntitiesPage; 