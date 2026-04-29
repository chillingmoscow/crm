import { supabase } from '../../utils/supabaseClient';
import { Account } from '../../types';

/**
 * Сервис для работы со счетами в Supabase
 */
export class SupabaseAccountService {

  /**
   * Преобразует данные из Supabase в тип Account
   */
  private static mapFromSupabase(supabaseAccount: any): Account {
    return {
      id: supabaseAccount.id,
      name: supabaseAccount.name,
      balance: parseFloat(supabaseAccount.balance),
      currency: supabaseAccount.currency,
      description: supabaseAccount.description,
      groupId: supabaseAccount.group_id,
      accountType: supabaseAccount.account_type,
      organizationId: supabaseAccount.organization_id,
      legalEntityId: supabaseAccount.legal_entity_id,
      bankName: supabaseAccount.bank_name,
      bik: supabaseAccount.bik,
      accountNumber: supabaseAccount.account_number,
      correspondentAccount: supabaseAccount.correspondent_account,
      acquiringPercentage: supabaseAccount.acquiring_percentage,
      cardHolder: supabaseAccount.card_holder,
      cardNumber: supabaseAccount.card_number,
      audit: {
        createdBy: supabaseAccount.created_by,
        createdAt: new Date(supabaseAccount.created_at),
        updatedBy: supabaseAccount.updated_by,
        updatedAt: supabaseAccount.updated_at ? new Date(supabaseAccount.updated_at) : undefined,
        deletedBy: supabaseAccount.deleted_by,
        deletedAt: supabaseAccount.deleted_at ? new Date(supabaseAccount.deleted_at) : undefined,
      },
    };
  }

  /**
   * Преобразует Account в формат для Supabase
   */
  private static mapToSupabase(
    account: Omit<Account, 'id' | 'audit'>,
    userId: string
  ): any {
    return {
      name: account.name,
      balance: account.balance,
      currency: account.currency,
      description: account.description,
      group_id: account.groupId || null,
      account_type: account.accountType,
      organization_id: account.organizationId,
      legal_entity_id: account.legalEntityId,
      bank_name: account.bankName || null,
      bik: account.bik || null,
      account_number: account.accountNumber || null,
      correspondent_account: account.correspondentAccount || null,
      acquiring_percentage: account.acquiringPercentage || null,
      card_holder: account.cardHolder || null,
      card_number: account.cardNumber || null,
      created_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Получить все счета
   */
  static async getAccounts(): Promise<Account[]> {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) {
        console.error('Ошибка загрузки счетов:', error);
        throw error;
      }

      return data.map(this.mapFromSupabase);
    } catch (error) {
      console.error('Ошибка в getAccounts:', error);
      throw error;
    }
  }

  /**
   * Добавить новый счет
   */
  static async addAccount(
    account: Omit<Account, 'id' | 'audit'>,
    userId: string
  ): Promise<Account> {
    try {
      const accountData = this.mapToSupabase(account, userId);

      const { data, error } = await supabase
        .from('accounts')
        .insert([accountData])
        .select()
        .single();

      if (error) {
        console.error('Ошибка создания счета:', error);
        throw error;
      }

      return this.mapFromSupabase(data);
    } catch (error) {
      console.error('Ошибка в addAccount:', error);
      throw error;
    }
  }

  /**
   * Обновить счет
   */
  static async updateAccount(
    updatedAccount: Account,
    userId: string
  ): Promise<Account> {
    try {
      const accountData = this.mapToSupabase(updatedAccount, userId);
      // Убираем поля создания и добавляем поля обновления
      delete accountData.created_by;
      delete accountData.created_at;
      accountData.updated_by = userId;
      accountData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('accounts')
        .update(accountData)
        .eq('id', updatedAccount.id)
        .select()
        .single();

      if (error) {
        console.error('Ошибка обновления счета:', error);
        throw error;
      }

      return this.mapFromSupabase(data);
    } catch (error) {
      console.error('Ошибка в updateAccount:', error);
      throw error;
    }
  }

  /**
   * Мягкое удаление счета
   */
  static async deleteAccount(id: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('accounts')
        .update({
          deleted_by: userId,
          deleted_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) {
        console.error('Ошибка удаления счета:', error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Ошибка в deleteAccount:', error);
      throw error;
    }
  }
} 