import { supabase } from '../../utils/supabaseClient';
import { Organization } from '../../types';

/**
 * Сервис для работы с организациями в Supabase
 */
export class SupabaseOrganizationService {
  private static readonly TABLE_NAME = 'organizations';

  /**
   * Преобразование данных из формата Supabase в локальный формат
   */
  private static mapFromSupabase(supabaseOrganization: any): Organization {
    return {
      id: supabaseOrganization.id,
      name: supabaseOrganization.name,
      description: supabaseOrganization.description,
      ownerId: supabaseOrganization.owner_id,
      settings: supabaseOrganization.settings || {},
      createdAt: new Date(supabaseOrganization.created_at),
      updatedAt: supabaseOrganization.updated_at ? new Date(supabaseOrganization.updated_at) : undefined,
      isActive: supabaseOrganization.is_active,
    };
  }

  /**
   * Преобразование данных из локального формата в формат Supabase
   */
  private static mapToSupabase(
    organization: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>,
    userId: string
  ): any {
    return {
      name: organization.name,
      description: organization.description,
      owner_id: organization.ownerId,
      settings: organization.settings,
      is_active: organization.isActive,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Получение списка организаций
   */
  static async getOrganizations(): Promise<Organization[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении организаций:', error);
      throw new Error(`Ошибка при получении организаций: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Получение организации по ID
   */
  static async getOrganizationById(id: string): Promise<Organization | null> {
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
      console.error('Ошибка при получении организации:', error);
      throw new Error(`Ошибка при получении организации: ${error.message}`);
    }

    return data ? this.mapFromSupabase(data) : null;
  }

  /**
   * Создание новой организации
   */
  static async addOrganization(
    organization: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>,
    userId: string
  ): Promise<Organization> {
    const organizationData = this.mapToSupabase(organization, userId);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .insert(organizationData)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при создании организации:', error);
      throw new Error(`Ошибка при создании организации: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Обновление существующей организации
   */
  static async updateOrganization(
    updatedOrganization: Organization,
    userId: string
  ): Promise<Organization> {
    const organizationData = this.mapToSupabase(updatedOrganization, userId);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .update(organizationData)
      .eq('id', updatedOrganization.id)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при обновлении организации:', error);
      throw new Error(`Ошибка при обновлении организации: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Удаление организации (мягкое удаление)
   */
  static async deleteOrganization(id: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('Ошибка при удалении организации:', error);
      throw new Error(`Ошибка при удалении организации: ${error.message}`);
    }

    return true;
  }

  /**
   * Получение организаций пользователя
   */
  static async getUserOrganizations(userId: string): Promise<Organization[]> {
    const { data, error } = await supabase
      .from('user_assignments')
      .select(`
        organizations!inner(*)
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('organizations.is_active', true);

    if (error) {
      console.error('Ошибка при получении организаций пользователя:', error);
      throw new Error(`Ошибка при получении организаций пользователя: ${error.message}`);
    }

    return (data || []).map(item => this.mapFromSupabase(item.organizations));
  }
} 