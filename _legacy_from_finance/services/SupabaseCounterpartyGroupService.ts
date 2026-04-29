import { supabase } from '../../utils/supabaseClient';
import { CounterpartyGroup } from '../../types';

interface SupabaseCounterpartyGroupRow {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  created_by: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

/**
 * Сервис для работы с группами контрагентов в Supabase
 */
export class SupabaseCounterpartyGroupService {

  /**
   * Получить все группы контрагентов
   */
  static async getCounterpartyGroups(): Promise<CounterpartyGroup[]> {
    try {
      const { data, error } = await supabase
        .from('counterparty_groups')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) {
        console.error('Ошибка при загрузке групп контрагентов:', error);
        return [];
      }

      return (data as SupabaseCounterpartyGroupRow[]).map(group => ({
        id: group.id,
        name: group.name,
        description: group.description,
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
      console.error('Ошибка при загрузке групп контрагентов:', error);
      return [];
    }
  }

  /**
   * Добавить новую группу контрагентов
   */
  static async addCounterpartyGroup(
    counterpartyGroup: Omit<CounterpartyGroup, 'id' | 'audit' | 'createdAt' | 'updatedAt'>, 
    userId: string,
    organizationId: string
  ): Promise<CounterpartyGroup> {
    try {
      const { data, error } = await supabase
        .from('counterparty_groups')
        .insert([{
          name: counterpartyGroup.name,
          description: counterpartyGroup.description,
          organization_id: organizationId,
          created_by: userId,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Ошибка при создании группы контрагентов:', error);
        throw error;
      }

      const group = data as SupabaseCounterpartyGroupRow;
      return {
        id: group.id,
        name: group.name,
        description: group.description,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.created_at),
        audit: {
          createdAt: new Date(group.created_at),
          createdBy: group.created_by
        }
      };
    } catch (error) {
      console.error('Ошибка при создании группы контрагентов:', error);
      throw error;
    }
  }

  /**
   * Обновить группу контрагентов
   */
  static async updateCounterpartyGroup(counterpartyGroup: CounterpartyGroup, userId: string): Promise<CounterpartyGroup> {
    try {
      const { data, error } = await supabase
        .from('counterparty_groups')
        .update({
          name: counterpartyGroup.name,
          description: counterpartyGroup.description,
          updated_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq('id', counterpartyGroup.id)
        .select()
        .single();

      if (error) {
        console.error('Ошибка при обновлении группы контрагентов:', error);
        throw error;
      }

      const group = data as SupabaseCounterpartyGroupRow;
      return {
        id: group.id,
        name: group.name,
        description: group.description,
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
      console.error('Ошибка при обновлении группы контрагентов:', error);
      throw error;
    }
  }

  /**
   * Удалить группу контрагентов (мягкое удаление)
   */
  static async deleteCounterpartyGroup(id: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('counterparty_groups')
        .update({
          deleted_by: userId,
          deleted_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) {
        console.error('Ошибка при удалении группы контрагентов:', error);
        throw error;
      }
    } catch (error) {
      console.error('Ошибка при удалении группы контрагентов:', error);
      throw error;
    }
  }
} 