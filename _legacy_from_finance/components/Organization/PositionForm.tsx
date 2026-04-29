import React, { useState, useEffect } from 'react';
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
  Paper,
  Divider,
  Chip,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Checkbox,
  FormGroup,
  Grid,
  CircularProgress,
} from '@mui/material';
import {
  Save as SaveIcon,
  Cancel as CancelIcon,
  ExpandMore as ExpandMoreIcon,
  Security as SecurityIcon,
  Shield as ShieldIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { Position, LegalEntity, PositionPermission, PERMISSIONS, PERMISSION_CATEGORIES } from '../../types';
import { SupabasePositionPermissionService } from '../../context/services/SupabasePositionPermissionService';

interface PositionFormProps {
  position: Partial<Position>;
  legalEntities: LegalEntity[];
  isEditing: boolean;
  loading: boolean;
  onSave: () => void;
  onClose: () => void;
  onPositionChange: (position: Partial<Position>) => void;
}

/**
 * Современная форма управления должностями в стиле приложения
 */
const PositionForm: React.FC<PositionFormProps> = ({
  position,
  legalEntities,
  isEditing,
  loading,
  onSave,
  onClose,
  onPositionChange
}) => {
  // Состояния для управления правами
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissions, setPermissions] = useState<PositionPermission[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | false>('basic');
  const [error, setError] = useState<string | null>(null);

  // Загрузка прав при редактировании существующей должности
  useEffect(() => {
    if (isEditing && position.id) {
      loadPositionPermissions();
    } else {
      setPermissions([]);
    }
  }, [isEditing, position.id]);

  /**
   * Загрузка прав должности
   */
  const loadPositionPermissions = async () => {
    if (!position.id) return;

    try {
      setPermissionsLoading(true);
      const positionPermissions = await SupabasePositionPermissionService.getPositionPermissions(position.id);
      setPermissions(positionPermissions);
    } catch (err) {
      console.error('Ошибка загрузки прав должности:', err);
      setError('Не удалось загрузить права должности');
    } finally {
      setPermissionsLoading(false);
    }
  };

  /**
   * Обработка изменения основных полей
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    onPositionChange({
      ...position,
      [name]: value
    });
  };

  /**
   * Обработка изменения активности должности
   */
  const handleActiveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPositionChange({
      ...position,
      isActive: e.target.checked
    });
  };

  /**
   * Обработка изменения юридического лица
   */
  const handleLegalEntityChange = (e: SelectChangeEvent) => {
    onPositionChange({
      ...position,
      legalEntityId: e.target.value || undefined
    });
  };

  /**
   * Проверка, включено ли право
   */
  const isPermissionEnabled = (permissionKey: string): boolean => {
    return permissions.some(p => p.objectType === permissionKey.split('.')[0] && p.accessLevel === permissionKey.split('.')[1]);
  };

  /**
   * Обработка изменения прав доступа
   */
  const handlePermissionChange = async (permissionKey: string, enabled: boolean) => {
    if (!position.id && !isEditing) {
      // Для новых должностей сохраняем права локально
      const [objectType, level] = permissionKey.split('.');
      
      if (enabled) {
        // Добавляем право
        const newPermission = {
          id: 'temp',
          positionId: 'temp',
          objectType,
          accessLevel: level as 'read' | 'write' | 'full',
          createdAt: new Date()
        };
        setPermissions(prev => [...prev.filter(p => !(p.objectType === objectType && p.accessLevel === level)), newPermission]);
      } else {
        // Убираем право
        setPermissions(prev => prev.filter(p => !(p.objectType === objectType && p.accessLevel === level)));
      }
      return;
    }

    if (!position.id) return;

    try {
      const [objectType, level] = permissionKey.split('.');
      
      if (enabled) {
        // Добавляем право
        const newPermission = await SupabasePositionPermissionService.addPositionPermission({
          positionId: position.id,
          objectType,
          accessLevel: level as 'read' | 'write' | 'full'
        });
        setPermissions(prev => [...prev.filter(p => !(p.objectType === objectType && p.accessLevel === level)), newPermission]);
      } else {
        // Убираем право - найдем ID права и удалим
        const existingPermission = permissions.find(p => p.objectType === objectType && p.accessLevel === level);
        if (existingPermission) {
          await SupabasePositionPermissionService.deletePositionPermission(existingPermission.id);
          setPermissions(prev => prev.filter(p => !(p.objectType === objectType && p.accessLevel === level)));
        }
      }
    } catch (err) {
      console.error('Ошибка изменения прав:', err);
      setError('Не удалось изменить права доступа');
    }
  };

  /**
   * Обработка разворачивания категории
   */
  const handleCategoryExpand = (categoryKey: string) => (
    event: React.SyntheticEvent,
    isExpanded: boolean
  ) => {
    setExpandedCategory(isExpanded ? categoryKey : false);
  };

  /**
   * Получение количества включенных прав в категории
   */
  const getEnabledPermissionsCount = (categoryKey: string): number => {
    const categoryPermissions = PERMISSIONS.filter(p => p.category === categoryKey);
    return categoryPermissions.filter(p => isPermissionEnabled(p.key)).length;
  };

  /**
   * Обработка отправки формы
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      // Сначала сохраняем должность
      await onSave();
      
      // Если это новая должность и у нас есть локальные права, сохраняем их
      if (!isEditing && permissions.length > 0 && position.id) {
                 for (const permission of permissions) {
           if (permission.positionId === 'temp') {
             await SupabasePositionPermissionService.addPositionPermission({
               positionId: position.id,
               objectType: permission.objectType,
               accessLevel: permission.accessLevel
             });
           }
         }
      }
    } catch (err) {
      console.error('Ошибка сохранения:', err);
      setError('Не удалось сохранить должность');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Заголовок */}
      <Box sx={{ p: 3, borderBottom: '1px solid #F3F4F6' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <SecurityIcon sx={{ color: 'warning.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {isEditing ? 'Редактировать должность' : 'Новая должность'}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {isEditing 
            ? 'Изменение параметров и прав доступа должности'
            : 'Создание новой должности с настройкой прав доступа'
          }
        </Typography>
      </Box>

      {/* Уведомления об ошибках */}
      {error && (
        <Alert severity="error" sx={{ m: 3, borderRadius: '8px' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Основная форма */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          
          {/* Основная информация */}
          <Paper sx={{ p: 3, borderRadius: '8px', border: '1px solid #F3F4F6' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
              Основная информация
            </Typography>
            
                         <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
               <TextField
                 name="name"
                 label="Название должности"
                 fullWidth
                 required
                 value={position.name || ''}
                 onChange={handleInputChange}
                 placeholder="Например: Директор, Бухгалтер, Менеджер"
                 sx={{
                   '& .MuiOutlinedInput-root': {
                     borderRadius: '8px',
                   }
                 }}
               />
               
               <FormControl fullWidth>
                 <InputLabel>Юридическое лицо</InputLabel>
                 <Select
                   value={position.legalEntityId || ''}
                   label="Юридическое лицо"
                   onChange={handleLegalEntityChange}
                   sx={{
                     borderRadius: '8px',
                   }}
                 >
                   <MenuItem value="">
                     <em>Без привязки к юрлицу</em>
                   </MenuItem>
                   {legalEntities.map((entity) => (
                     <MenuItem key={entity.id} value={entity.id}>
                       {entity.name}
                     </MenuItem>
                   ))}
                 </Select>
               </FormControl>
               
               <TextField
                 name="description"
                 label="Описание должности"
                 fullWidth
                 multiline
                 rows={3}
                 value={position.description || ''}
                 onChange={handleInputChange}
                 placeholder="Краткое описание обязанностей и ответственности"
                 sx={{
                   '& .MuiOutlinedInput-root': {
                     borderRadius: '8px',
                   }
                 }}
               />
               
               <FormControlLabel
                 control={
                   <Switch
                     checked={position.isActive ?? true}
                     onChange={handleActiveChange}
                     name="isActive"
                   />
                 }
                 label="Активная должность"
               />
             </Box>
          </Paper>

          {/* Права доступа */}
          <Paper sx={{ p: 0, borderRadius: '8px', border: '1px solid #F3F4F6', overflow: 'hidden' }}>
            <Box sx={{ p: 3, borderBottom: '1px solid #F3F4F6' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <ShieldIcon sx={{ color: 'primary.main' }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Права доступа
                </Typography>
                {permissions.length > 0 && (
                  <Chip 
                    label={`${permissions.length} прав`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                )}
              </Box>
              <Typography variant="body2" color="text.secondary">
                Настройте права доступа для данной должности
              </Typography>
            </Box>

            {permissionsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <Box sx={{ p: 0 }}>
                {PERMISSION_CATEGORIES.map((category) => {
                  const categoryPermissions = PERMISSIONS.filter(p => p.category === category.key);
                  const enabledCount = getEnabledPermissionsCount(category.key);
                  
                  return (
                    <Accordion
                      key={category.key}
                      expanded={expandedCategory === category.key}
                      onChange={handleCategoryExpand(category.key)}
                      sx={{ 
                        boxShadow: 'none',
                        '&:before': { display: 'none' },
                        '&:not(:last-child)': {
                          borderBottom: '1px solid #F3F4F6'
                        }
                      }}
                    >
                      <AccordionSummary
                        expandIcon={<ExpandMoreIcon />}
                        sx={{
                          backgroundColor: '#FAFAFA',
                          '&:hover': {
                            backgroundColor: '#F5F5F5'
                          },
                          '& .MuiAccordionSummary-content': {
                            alignItems: 'center'
                          }
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {category.name}
                          </Typography>
                          {enabledCount > 0 && (
                            <Chip
                              label={`${enabledCount}/${categoryPermissions.length}`}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                          )}
                        </Box>
                      </AccordionSummary>
                      
                      <AccordionDetails sx={{ p: 3 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          Права доступа для категории "{category.name}"
                        </Typography>
                        
                        <FormGroup>
                          {categoryPermissions.map((permission) => (
                            <FormControlLabel
                              key={permission.key}
                              control={
                                <Checkbox
                                  checked={isPermissionEnabled(permission.key)}
                                  onChange={(e) => handlePermissionChange(permission.key, e.target.checked)}
                                  name={permission.key}
                                />
                              }
                              label={
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    {permission.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {permission.description}
                                  </Typography>
                                </Box>
                              }
                              sx={{ mb: 1, alignItems: 'flex-start' }}
                            />
                          ))}
                        </FormGroup>
                      </AccordionDetails>
                    </Accordion>
                  );
                })}
              </Box>
            )}
          </Paper>
        </Box>
      </Box>

      {/* Кнопки управления */}
      <Box sx={{ 
        p: 3, 
        borderTop: '1px solid #F3F4F6',
        backgroundColor: '#FAFAFA',
        display: 'flex',
        gap: 2,
        justifyContent: 'flex-end'
      }}>
        <Button
          onClick={onClose}
          disabled={loading}
          startIcon={<CancelIcon />}
          sx={{ 
            borderRadius: '8px',
            px: 3
          }}
        >
          Отмена
        </Button>
        
        <Button
          type="submit"
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || !position.name?.trim()}
          startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
          sx={{ 
            borderRadius: '8px',
            boxShadow: 'none',
            px: 3
          }}
        >
          {loading ? 'Сохранение...' : (isEditing ? 'Сохранить' : 'Создать')}
        </Button>
      </Box>
    </Box>
  );
};

export default PositionForm; 