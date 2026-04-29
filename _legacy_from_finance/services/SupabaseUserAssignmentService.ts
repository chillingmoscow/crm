import { supabase } from '../../utils/supabaseClient';
import { UserAssignment } from '../../types';

/**
 * Сервис для работы с назначениями пользователей в Supabase
 */
export class SupabaseUserAssignmentService {
  private static readonly TABLE_NAME = 'user_assignments';

  /**
   * Преобразование данных из формата Supabase в локальный формат
   */
  private static mapFromSupabase(supabaseAssignment: any): UserAssignment {
    return {
      id: supabaseAssignment.id,
      userId: supabaseAssignment.user_id,
      organizationId: supabaseAssignment.organization_id,
      legalEntityId: supabaseAssignment.legal_entity_id,
      positionId: supabaseAssignment.position_id, // Теперь обязательное поле
      invitedAt: new Date(supabaseAssignment.invited_at),
      acceptedAt: supabaseAssignment.accepted_at ? new Date(supabaseAssignment.accepted_at) : undefined,
      isActive: supabaseAssignment.is_active,
    };
  }

  /**
   * Преобразование данных из локального формата в формат Supabase
   */
  private static mapToSupabase(
    assignment: Omit<UserAssignment, 'id' | 'invitedAt'>
  ): any {
    return {
      user_id: assignment.userId,
      organization_id: assignment.organizationId,
      legal_entity_id: assignment.legalEntityId,
      position_id: assignment.positionId, // Обязательное поле
      accepted_at: assignment.acceptedAt?.toISOString(),
      is_active: assignment.isActive,
    };
  }

  /**
   * Получение назначений пользователей организации
   */
  static async getUserAssignments(organizationId: string): Promise<UserAssignment[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('invited_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении назначений пользователей:', error);
      throw new Error(`Ошибка при получении назначений пользователей: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Получение назначения по ID
   */
  static async getUserAssignmentById(id: string): Promise<UserAssignment | null> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Ошибка при получении назначения пользователя:', error);
      throw new Error(`Ошибка при получении назначения пользователя: ${error.message}`);
    }

    return data ? this.mapFromSupabase(data) : null;
  }

  /**
   * Получение назначений конкретного пользователя
   */
  static async getUserAssignmentsByUser(userId: string): Promise<UserAssignment[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('invited_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении назначений пользователя:', error);
      throw new Error(`Ошибка при получении назначений пользователя: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Создание нового назначения пользователя
   */
  static async addUserAssignment(
    assignment: Omit<UserAssignment, 'id' | 'invitedAt'>
  ): Promise<UserAssignment> {
    const assignmentData = this.mapToSupabase(assignment);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .insert(assignmentData)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при создании назначения пользователя:', error);
      throw new Error(`Ошибка при создании назначения пользователя: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Обновление существующего назначения пользователя
   */
  static async updateUserAssignment(
    updatedAssignment: UserAssignment
  ): Promise<UserAssignment> {
    const assignmentData = this.mapToSupabase(updatedAssignment);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .update(assignmentData)
      .eq('id', updatedAssignment.id)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при обновлении назначения пользователя:', error);
      throw new Error(`Ошибка при обновлении назначения пользователя: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Удаление назначения пользователя (мягкое удаление)
   */
  static async deleteUserAssignment(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .update({
        is_active: false,
      })
      .eq('id', id);

    if (error) {
      console.error('Ошибка при удалении назначения пользователя:', error);
      throw new Error(`Ошибка при удалении назначения пользователя: ${error.message}`);
    }

    return true;
  }

  /**
   * Принятие приглашения пользователем
   */
  static async acceptInvitation(assignmentId: string): Promise<UserAssignment> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .update({
        accepted_at: new Date().toISOString(),
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при принятии приглашения:', error);
      throw new Error(`Ошибка при принятии приглашения: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Получение назначений по должности
   */
  static async getUserAssignmentsByPosition(positionId: string): Promise<UserAssignment[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('position_id', positionId)
      .eq('is_active', true)
      .order('invited_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении назначений по должности:', error);
      throw new Error(`Ошибка при получении назначений по должности: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Получение назначений по юридическому лицу
   */
  static async getUserAssignmentsByLegalEntity(legalEntityId: string): Promise<UserAssignment[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('legal_entity_id', legalEntityId)
      .eq('is_active', true)
      .order('invited_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении назначений по юридическому лицу:', error);
      throw new Error(`Ошибка при получении назначений по юридическому лицу: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }
} 