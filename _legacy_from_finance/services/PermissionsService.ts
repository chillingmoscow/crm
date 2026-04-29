// Сервис для работы с правами доступа в мультитенантной системе
import React from 'react';
import { supabase } from '../../utils/supabaseClient';

export interface UserPermission {
  object_type: string; // 'accounts', 'transactions', 'users', etc.
  access_level: 'none' | 'read' | 'write' | 'full';
  source: 'position' | 'individual' | 'owner';
}

export interface PermissionCheckResult {
  canRead: boolean;
  canWrite: boolean;
  canFull: boolean;
}

/**
 * Сервис для работы с правами доступа
 */
export class PermissionsService {
  private static userPermissionsCache: UserPermission[] | null = null;
  private static cacheTimestamp: number = 0;
  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 минут

  /**
   * Получает все права пользователя в текущей организации
   */
  static async getUserPermissions(organizationId?: string): Promise<UserPermission[]> {
    const now = Date.now();
    
    // Проверяем кеш
    if (
      this.userPermissionsCache && 
      this.cacheTimestamp && 
      (now - this.cacheTimestamp) < this.CACHE_DURATION
    ) {
      return this.userPermissionsCache;
    }

    try {
      const { data, error } = await supabase.rpc('get_user_permissions', {
        org_uuid: organizationId || null
      });

      if (error) {
        console.error('Ошибка получения прав пользователя:', error);
        return [];
      }

      // Обновляем кеш
      this.userPermissionsCache = data || [];
      this.cacheTimestamp = now;

      return data || [];
    } catch (error) {
      console.error('Ошибка при получении прав:', error);
      return [];
    }
  }

  /**
   * Проверяет права доступа к определенному объекту
   */
  static async checkPermission(
    objectType: string, 
    requiredLevel: 'read' | 'write' | 'full' = 'read',
    organizationId?: string
  ): Promise<PermissionCheckResult> {
    const permissions = await this.getUserPermissions(organizationId);
    
    const permission = permissions.find(p => p.object_type === objectType);
    const accessLevel = permission?.access_level || 'none';

    return {
      canRead: ['read', 'write', 'full'].includes(accessLevel),
      canWrite: ['write', 'full'].includes(accessLevel),
      canFull: accessLevel === 'full'
    };
  }

  /**
   * Быстрая проверка - может ли пользователь читать объект
   */
  static async canRead(objectType: string, organizationId?: string): Promise<boolean> {
    const result = await this.checkPermission(objectType, 'read', organizationId);
    return result.canRead;
  }

  /**
   * Быстрая проверка - может ли пользователь изменять объект
   */
  static async canWrite(objectType: string, organizationId?: string): Promise<boolean> {
    const result = await this.checkPermission(objectType, 'write', organizationId);
    return result.canWrite;
  }

  /**
   * Быстрая проверка - есть ли полные права на объект
   */
  static async canFull(objectType: string, organizationId?: string): Promise<boolean> {
    const result = await this.checkPermission(objectType, 'full', organizationId);
    return result.canFull;
  }

  /**
   * Проверяет статус инициализации пользователя
   */
  static async checkInitializationStatus(): Promise<{
    initialized: boolean;
    message: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('check_user_initialization_status');

      if (error) {
        console.error('Ошибка проверки статуса инициализации:', error);
        return { initialized: false, message: 'Ошибка проверки статуса' };
      }

      return data || { initialized: false, message: 'Нет данных' };
    } catch (error) {
      console.error('Ошибка при проверке инициализации:', error);
      return { initialized: false, message: 'Системная ошибка' };
    }
  }

  /**
   * Очищает кеш прав пользователя
   */
  static clearCache(): void {
    this.userPermissionsCache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Проверяет есть ли у пользователя права администратора
   */
  static async isAdmin(organizationId?: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(organizationId);
    
    // Проверяем есть ли права владельца или полные права на пользователей
    return permissions.some(p => 
      p.source === 'owner' || 
      (p.object_type === 'users' && p.access_level === 'full')
    );
  }

  /**
   * Получает список доступных объектных типов с правами
   */
  static async getAvailableObjectTypes(organizationId?: string): Promise<string[]> {
    const permissions = await this.getUserPermissions(organizationId);
    return permissions
      .filter(p => p.access_level !== 'none')
      .map(p => p.object_type);
  }

  /**
   * Проверяет права доступа с использованием серверной функции
   */
  static async hasPermissionOnServer(
    organizationId: string,
    objectType: string,
    requiredLevel: 'read' | 'write' | 'full' = 'read'
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('has_permission', {
        user_uuid: null, // null = текущий пользователь
        org_uuid: organizationId,
        object_type: objectType,
        required_level: requiredLevel
      });

      if (error) {
        console.error('Ошибка серверной проверки прав:', error);
        return false;
      }

      return data || false;
    } catch (error) {
      console.error('Ошибка при серверной проверке прав:', error);
      return false;
    }
  }
}

/**
 * React Hook для работы с правами пользователя
 */
export const usePermissions = (organizationId?: string) => {
  const [permissions, setPermissions] = React.useState<UserPermission[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadPermissions = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const userPermissions = await PermissionsService.getUserPermissions(organizationId);
      setPermissions(userPermissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки прав');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  React.useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  return {
    permissions,
    loading,
    error,
    canRead: (objectType: string) => 
      permissions.some(p => p.object_type === objectType && ['read', 'write', 'full'].includes(p.access_level)),
    canWrite: (objectType: string) => 
      permissions.some(p => p.object_type === objectType && ['write', 'full'].includes(p.access_level)),
    canFull: (objectType: string) => 
      permissions.some(p => p.object_type === objectType && p.access_level === 'full'),
    isAdmin: permissions.some(p => p.source === 'owner'),
    refresh: () => {
      PermissionsService.clearCache();
      return loadPermissions();
    }
  };
};

 