// Компонент для условного рендеринга на основе прав пользователя
import React from 'react';
import { usePermissions } from '../../context/services/PermissionsService';
import { Box, CircularProgress, Alert } from '@mui/material';

interface PermissionGuardProps {
  children: React.ReactNode;
  objectType: string; // 'accounts', 'transactions', 'users', etc.
  level?: 'read' | 'write' | 'full'; // минимальный требуемый уровень доступа
  organizationId?: string;
  fallback?: React.ReactNode; // что показать если нет прав
  showLoading?: boolean; // показывать ли индикатор загрузки
  showError?: boolean; // показывать ли ошибки
}

/**
 * Компонент-охранник для проверки прав доступа
 * Показывает дочерние элементы только если у пользователя есть нужные права
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  children,
  objectType,
  level = 'read',
  organizationId,
  fallback = null,
  showLoading = true,
  showError = false
}) => {
  const { permissions, loading, error, canRead, canWrite, canFull } = usePermissions(organizationId);

  // Показываем загрузку
  if (loading && showLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" p={2}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  // Показываем ошибку
  if (error && showError) {
    return (
      <Alert severity="error" sx={{ m: 1 }}>
        Ошибка загрузки прав: {error}
      </Alert>
    );
  }

  // Проверяем права доступа
  const hasPermission = (() => {
    switch (level) {
      case 'read':
        return canRead(objectType);
      case 'write':
        return canWrite(objectType);
      case 'full':
        return canFull(objectType);
      default:
        return false;
    }
  })();

  // Если нет прав - показываем fallback
  if (!hasPermission) {
    return <>{fallback}</>;
  }

  // Если есть права - показываем дочерние элементы
  return <>{children}</>;
};

/**
 * HOC для компонентов, требующих проверки прав
 */
export function withPermissionCheck<P extends object>(
  Component: React.ComponentType<P>,
  objectType: string,
  level: 'read' | 'write' | 'full' = 'read'
) {
  return function PermissionCheckedComponent(props: P & { organizationId?: string }) {
    const { organizationId, ...restProps } = props;
    
    return (
      <PermissionGuard 
        objectType={objectType} 
        level={level} 
        organizationId={organizationId}
        fallback={
          <Alert severity="warning" sx={{ m: 2 }}>
            У вас нет прав для просмотра этого раздела
          </Alert>
        }
      >
        <Component {...(restProps as P)} />
      </PermissionGuard>
    );
  };
}

/**
 * Хук для получения информации о правах с мемоизацией
 */
export const usePermissionInfo = (objectType: string, organizationId?: string) => {
  const { permissions, loading, error, canRead, canWrite, canFull, isAdmin } = usePermissions(organizationId);
  
  return React.useMemo(() => ({
    permissions: permissions.filter(p => p.object_type === objectType),
    hasAnyAccess: permissions.some(p => p.object_type === objectType && p.access_level !== 'none'),
    canRead: canRead(objectType),
    canWrite: canWrite(objectType),
    canFull: canFull(objectType),
    isAdmin,
    loading,
    error
  }), [permissions, objectType, canRead, canWrite, canFull, isAdmin, loading, error]);
}; 