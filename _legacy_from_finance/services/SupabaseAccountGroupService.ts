import { supabase } from '../../utils/supabaseClient';
import { AccountGroup } from '../../types';

interface SupabaseAccountGroupRow {
  id: string;
  name: string;
  created_at: string;
  created_by: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

/**
 * Сервис для работы с группами счетов в Supabase
 */
export class SupabaseAccountGroupService {

  /**
   * Получить все группы счетов
   */
  static async getAccountGroups(): Promise<AccountGroup[]> {
    try {
      const { data, error } = await supabase
        .from('account_groups')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) {
        console.error('Ошибка при загрузке групп счетов:', error);
        return [];
      }

      return (data as SupabaseAccountGroupRow[]).map(group => ({
        id: group.id,
        name: group.name,
        createdAt: new Date(group.created_at),
        updatedAt: group.updated_at ? new Date(group.updated_at) : new Date(group.created_at),
        audit: {
          createdAt: new Date(group.created_at),
          createdBy: group.created_by,
          updatedAt: group.updated_at ? new Date(group.updated_at) : undefined,
          updatedBy: group.updated_by || undefined
        }
      }));
    } catch (error) {
      console.error('Ошибка при загрузке групп счетов:', error);
      return [];
    }
  }

  /**
   * Добавить новую группу счетов
   */
  static async addAccountGroup(
    accountGroup: Omit<AccountGroup, 'id' | 'audit' | 'createdAt' | 'updatedAt'>, 
    userId: string
  ): Promise<AccountGroup> {
    try {
      const { data, error } = await supabase
        .from('account_groups')
        .insert([{
          name: accountGroup.name,
          created_by: userId,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Ошибка при создании группы счетов:', error);
        throw error;
      }

      const group = data as SupabaseAccountGroupRow;
      return {
        id: group.id,
        name: group.name,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.created_at),
        audit: {
          createdAt: new Date(group.created_at),
          createdBy: group.created_by
        }
      };
    } catch (error) {
      console.error('Ошибка при создании группы счетов:', error);
      throw error;
    }
  }

  /**
   * Обновить группу счетов
   */
  static async updateAccountGroup(accountGroup: AccountGroup, userId: string): Promise<AccountGroup> {
    try {
      const { data, error } = await supabase
        .from('account_groups')
        .update({
          name: accountGroup.name,
          updated_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq('id', accountGroup.id)
        .select()
        .single();

      if (error) {
        console.error('Ошибка при обновлении группы счетов:', error);
        throw error;
      }

      const group = data as SupabaseAccountGroupRow;
      return {
        id: group.id,
        name: group.name,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.updated_at!),
        audit: {
          createdAt: new Date(group.created_at),
          createdBy: group.created_by,
          updatedAt: new Date(group.updated_at!),
          updatedBy: group.updated_by!
        }
      };
    } catch (error) {
      console.error('Ошибка при обновлении группы счетов:', error);
      throw error;
    }
  }

  /**
   * Удалить группу счетов (мягкое удаление)
   */
  static async deleteAccountGroup(id: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('account_groups')
        .update({
          deleted_by: userId,
          deleted_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) {
        console.error('Ошибка при удалении группы счетов:', error);
        throw error;
      }
    } catch (error) {
      console.error('Ошибка при удалении группы счетов:', error);
      throw error;
    }
  }
} 