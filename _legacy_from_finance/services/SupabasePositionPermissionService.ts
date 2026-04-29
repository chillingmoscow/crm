import { supabase } from '../../utils/supabaseClient';
import { PositionPermission } from '../../types';

/**
 * Сервис для работы с правами должностей в Supabase
 */
export class SupabasePositionPermissionService {
  private static readonly TABLE_NAME = 'position_permissions';

  /**
   * Преобразование данных из формата Supabase в локальный формат
   */
  private static mapFromSupabase(supabasePermission: any): PositionPermission {
    return {
      id: supabasePermission.id,
      positionId: supabasePermission.position_id,
      objectType: supabasePermission.object_type,
      accessLevel: supabasePermission.access_level,
      createdAt: new Date(supabasePermission.created_at),
    };
  }

  /**
   * Преобразование данных из локального формата в формат Supabase
   */
  private static mapToSupabase(
    permission: Omit<PositionPermission, 'id' | 'createdAt'>
  ): any {
    return {
      position_id: permission.positionId,
      object_type: permission.objectType,
      access_level: permission.accessLevel,
    };
  }

  /**
   * Получение прав должности
   */
  static async getPositionPermissions(positionId: string): Promise<PositionPermission[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('position_id', positionId)
      .order('object_type', { ascending: true });

    if (error) {
      console.error('Ошибка при получении прав должности:', error);
      throw new Error(`Ошибка при получении прав должности: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Создание права для должности
   */
  static async addPositionPermission(
    permission: Omit<PositionPermission, 'id' | 'createdAt'>
  ): Promise<PositionPermission> {
    const permissionData = this.mapToSupabase(permission);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .insert(permissionData)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при создании права должности:', error);
      throw new Error(`Ошибка при создании права должности: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Обновление права должности
   */
  static async updatePositionPermission(
    updatedPermission: PositionPermission
  ): Promise<PositionPermission> {
    const permissionData = this.mapToSupabase(updatedPermission);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .update(permissionData)
      .eq('id', updatedPermission.id)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при обновлении права должности:', error);
      throw new Error(`Ошибка при обновлении права должности: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Удаление права должности
   */
  static async deletePositionPermission(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Ошибка при удалении права должности:', error);
      throw new Error(`Ошибка при удалении права должности: ${error.message}`);
    }

    return true;
  }

  /**
   * Массовое обновление прав должности
   */
  static async setPositionPermissions(
    positionId: string,
    permissions: Array<Omit<PositionPermission, 'id' | 'positionId' | 'createdAt'>>
  ): Promise<PositionPermission[]> {
    // Сначала удаляем все существующие права
    await supabase
      .from(this.TABLE_NAME)
      .delete()
      .eq('position_id', positionId);

    // Затем добавляем новые права
    const permissionsData = permissions.map(permission => ({
      position_id: positionId,
      object_type: permission.objectType,
      access_level: permission.accessLevel,
    }));

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .insert(permissionsData)
      .select();

    if (error) {
      console.error('Ошибка при массовом обновлении прав должности:', error);
      throw new Error(`Ошибка при массовом обновлении прав должности: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Получение права должности для конкретного объекта
   */
  static async getPositionPermission(
    positionId: string,
    objectType: string
  ): Promise<PositionPermission | null> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('position_id', positionId)
      .eq('object_type', objectType)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Ошибка при получении права должности:', error);
      throw new Error(`Ошибка при получении права должности: ${error.message}`);
    }

    return data ? this.mapFromSupabase(data) : null;
  }
} 