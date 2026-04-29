import { supabase } from '../../utils/supabaseClient';
import { Counterparty } from '../../types';

/**
 * Сервис для работы с контрагентами в Supabase
 */
export class SupabaseCounterpartyService {
  /**
   * Преобразует данные из Supabase в тип Counterparty
   */
  private static mapFromSupabase(supabaseCounterparty: any): Counterparty {
    return {
      id: supabaseCounterparty.id,
      name: supabaseCounterparty.name,
      legalEntity: supabaseCounterparty.legal_entity,
      inn: supabaseCounterparty.inn,
      contactPerson: supabaseCounterparty.contact_person,
      phone: supabaseCounterparty.phone,
      email: supabaseCounterparty.email,
      description: supabaseCounterparty.description,
      groupId: supabaseCounterparty.group_id,
      audit: {
        createdBy: supabaseCounterparty.created_by,
        createdAt: new Date(supabaseCounterparty.created_at),
        updatedBy: supabaseCounterparty.updated_by,
        updatedAt: supabaseCounterparty.updated_at ? new Date(supabaseCounterparty.updated_at) : undefined,
        deletedBy: supabaseCounterparty.deleted_by,
        deletedAt: supabaseCounterparty.deleted_at ? new Date(supabaseCounterparty.deleted_at) : undefined,
      },
    };
  }

  /**
   * Преобразует Counterparty в формат для Supabase
   */
  private static mapToSupabase(
    counterparty: Omit<Counterparty, 'id' | 'audit'>,
    userId: string
  ): any {
    return {
      name: counterparty.name,
      legal_entity: counterparty.legalEntity,
      inn: counterparty.inn,
      contact_person: counterparty.contactPerson,
      phone: counterparty.phone,
      email: counterparty.email,
      description: counterparty.description,
      group_id: counterparty.groupId,
      created_by: userId,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Получить всех контрагентов
   */
  static async getCounterparties(): Promise<Counterparty[]> {
    try {
      const { data, error } = await supabase
        .from('counterparties')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) {
        console.error('Ошибка загрузки контрагентов:', error);
        throw error;
      }

      return data.map(this.mapFromSupabase);
    } catch (error) {
      console.error('Ошибка в getCounterparties:', error);
      throw error;
    }
  }

  /**
   * Добавить нового контрагента
   */
  static async addCounterparty(
    counterparty: Omit<Counterparty, 'id' | 'audit'>,
    userId: string,
    organizationId: string
  ): Promise<Counterparty> {
    try {
      const counterpartyData = this.mapToSupabase(counterparty, userId);
      
      // Добавляем organization_id для RLS
      counterpartyData.organization_id = organizationId;

      const { data, error } = await supabase
        .from('counterparties')
        .insert([counterpartyData])
        .select()
        .single();

      if (error) {
        console.error('Ошибка создания контрагента:', error);
        throw error;
      }

      return this.mapFromSupabase(data);
    } catch (error) {
      console.error('Ошибка в addCounterparty:', error);
      throw error;
    }
  }

  /**
   * Обновить контрагента
   */
  static async updateCounterparty(
    updatedCounterparty: Counterparty,
    userId: string
  ): Promise<Counterparty> {
    try {
      const counterpartyData = this.mapToSupabase(updatedCounterparty, userId);
      // Убираем поля создания и добавляем поля обновления
      delete counterpartyData.created_by;
      delete counterpartyData.created_at;
      counterpartyData.updated_by = userId;
      counterpartyData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('counterparties')
        .update(counterpartyData)
        .eq('id', updatedCounterparty.id)
        .select()
        .single();

      if (error) {
        console.error('Ошибка обновления контрагента:', error);
        throw error;
      }

      return this.mapFromSupabase(data);
    } catch (error) {
      console.error('Ошибка в updateCounterparty:', error);
      throw error;
    }
  }

  /**
   * Мягкое удаление контрагента
   */
  static async deleteCounterparty(id: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('counterparties')
        .update({
          deleted_by: userId,
          deleted_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) {
        console.error('Ошибка удаления контрагента:', error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Ошибка в deleteCounterparty:', error);
      throw error;
    }
  }
} 