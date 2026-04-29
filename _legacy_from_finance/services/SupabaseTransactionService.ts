import { supabase, handleSupabaseError } from '../../utils/supabaseClient';
import { Transaction } from '../../types';

/**
 * Сервис для работы с транзакциями через Supabase
 */
export class SupabaseTransactionService {
  /**
   * Преобразует данные из Supabase в формат приложения
   */
  private static mapFromSupabase(supabaseTransaction: any): Transaction {
    return {
      id: supabaseTransaction.id,
      type: supabaseTransaction.type as 'income' | 'expense' | 'transfer',
      amount: Number(supabaseTransaction.amount),
      currency: supabaseTransaction.currency,
      accountId: supabaseTransaction.account_id,
      toAccountId: supabaseTransaction.to_account_id || undefined,
      toAmount: supabaseTransaction.to_amount ? Number(supabaseTransaction.to_amount) : undefined,
      toCurrency: supabaseTransaction.to_currency || undefined,
      categoryId: supabaseTransaction.category_id || undefined,
      counterpartyId: supabaseTransaction.counterparty_id || undefined,
      description: supabaseTransaction.description || undefined,
      date: new Date(supabaseTransaction.date),
      attachments: [],
      audit: {
        createdBy: supabaseTransaction.created_by,
        createdAt: new Date(supabaseTransaction.created_at),
        updatedBy: supabaseTransaction.updated_by || undefined,
        updatedAt: supabaseTransaction.updated_at ? new Date(supabaseTransaction.updated_at) : undefined,
        deletedBy: supabaseTransaction.deleted_by || undefined,
        deletedAt: supabaseTransaction.deleted_at ? new Date(supabaseTransaction.deleted_at) : undefined,
      }
    };
  }

  /**
   * Преобразует данные приложения в формат для Supabase
   */
  private static mapToSupabase(
    transaction: Omit<Transaction, 'id' | 'audit' | 'attachments'>,
    userId: string
  ): any {
    return {
      type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      account_id: transaction.accountId,
      to_account_id: transaction.toAccountId || null,
      to_amount: transaction.toAmount || null,
      to_currency: transaction.toCurrency || null,
      category_id: transaction.categoryId || null,
      counterparty_id: transaction.counterpartyId || null,
      description: transaction.description || '',
      date: transaction.date.toISOString(),
      created_by: userId,
    };
  }

  /**
   * Получает все активные транзакции с возможностью фильтрации
   */
  static async getTransactions(filters?: {
    accountId?: string;
    categoryId?: string;
    counterpartyId?: string;
    type?: 'income' | 'expense' | 'transfer';
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<Transaction[]> {
    let query = supabase
      .from('transactions')
      .select(`
        *,
        accounts!transactions_account_id_fkey(name),
        categories(name, type),
        counterparties(name)
      `)
      .is('deleted_at', null);

    // Применяем фильтры
    if (filters?.accountId) {
      query = query.eq('account_id', filters.accountId);
    }
    
    if (filters?.categoryId) {
      query = query.eq('category_id', filters.categoryId);
    }
    
    if (filters?.counterpartyId) {
      query = query.eq('counterparty_id', filters.counterpartyId);
    }
    
    if (filters?.type) {
      query = query.eq('type', filters.type);
    }
    
    if (filters?.fromDate) {
      query = query.gte('date', filters.fromDate.toISOString());
    }
    
    if (filters?.toDate) {
      query = query.lte('date', filters.toDate.toISOString());
    }
    
    // Сортировка по дате (новые сначала)
    query = query.order('date', { ascending: false });
    
    // Ограничение количества результатов
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    
    if (filters?.offset) {
      query = query.range(filters.offset, (filters.offset + (filters.limit || 50)) - 1);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Ошибка при получении транзакций:', error);
      throw new Error('Ошибка при получении транзакций');
    }

    if (!data) {
      return [];
    }

    const transactions = data.map(this.mapFromSupabase);

    return transactions;
  }

  /**
   * Получает транзакцию по ID
   */
  static async getTransactionById(id: string): Promise<Transaction | null> {
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        *,
        accounts!transactions_account_id_fkey(name),
        categories(name, type),
        counterparties(name)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Транзакция не найдена
        return null;
      }
      console.error('Ошибка при получении транзакции:', error);
      throw new Error('Ошибка при получении транзакции');
    }

    if (!data) {
      return null;
    }

    return this.mapFromSupabase(data);
  }

  /**
   * 🚀 API: Получает транзакцию по public_id (для внешнего API)
   */
  static async getTransactionByPublicId(publicId: number): Promise<Transaction | null> {
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        *,
        accounts!transactions_account_id_fkey(name),
        categories(name, type),
        counterparties(name)
      `)
      .eq('public_id', publicId)
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Транзакция не найдена
        return null;
      }
      console.error('Ошибка при получении транзакции по public_id:', error);
      throw new Error('Ошибка при получении транзакции');
    }

    if (!data) {
      return null;
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Добавляет новую транзакцию
   */
  static async addTransaction(
    transaction: Omit<Transaction, 'id' | 'audit' | 'attachments'>,
    userId: string,
    organizationId: string,
    legalEntityId?: string
  ): Promise<Transaction> {
    const insertData = this.mapToSupabase(transaction, userId);
    
    // Добавляем обязательные поля для RLS
    insertData.organization_id = organizationId;
    if (legalEntityId) {
      insertData.legal_entity_id = legalEntityId;
    }
    
    const { data, error } = await supabase
      .from('transactions')
      .insert(insertData)
      .select(`
        *,
        accounts!transactions_account_id_fkey(name),
        categories(name, type),
        counterparties(name)
      `)
      .single();

    if (error) {
      console.error('Ошибка при создании транзакции:', error);
      throw new Error(`Ошибка при создании транзакции: ${error.message}`);
    }

    if (!data) {
      throw new Error('Не удалось создать транзакцию - данные отсутствуют');
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Обновляет существующую транзакцию
   */
  static async updateTransaction(
    updatedTransaction: Transaction,
    userId: string
  ): Promise<Transaction> {
    const updateData: any = {
      type: updatedTransaction.type,
      amount: updatedTransaction.amount,
      currency: updatedTransaction.currency,
      account_id: updatedTransaction.accountId,
      to_account_id: updatedTransaction.toAccountId || null,
      to_amount: updatedTransaction.toAmount || null,
      to_currency: updatedTransaction.toCurrency || null,
      category_id: (updatedTransaction.categoryId === 'no-category' || !updatedTransaction.categoryId) ? null : updatedTransaction.categoryId,
      counterparty_id: updatedTransaction.counterpartyId || null,
      description: updatedTransaction.description || '',
      date: updatedTransaction.date.toISOString(),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', updatedTransaction.id)
      .select(`
        *,
        accounts!transactions_account_id_fkey(name),
        categories(name, type),
        counterparties(name)
      `)
      .single();

    if (error) {
      console.error('Ошибка при обновлении транзакции:', error);
      throw new Error('Ошибка при обновлении транзакции');
    }

    if (!data) {
      throw new Error('Не удалось обновить транзакцию');
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Удаляет транзакцию (мягкое удаление)
   */
  static async deleteTransaction(id: string, userId: string): Promise<boolean> {
    // Выполняем мягкое удаление
    const { error } = await supabase
      .from('transactions')
      .update({
        deleted_by: userId,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('Ошибка при удалении транзакции:', error);
      throw new Error('Ошибка при удалении транзакции');
    }

    return true;
  }

  /**
   * Получает транзакции для конкретного счета
   */
  static async getTransactionsByAccount(accountId: string): Promise<Transaction[]> {
    return this.getTransactions({ accountId });
  }

  /**
   * Получает транзакции для конкретной категории
   */
  static async getTransactionsByCategory(categoryId: string): Promise<Transaction[]> {
    return this.getTransactions({ categoryId });
  }

  /**
   * Получает транзакции для конкретного контрагента
   */
  static async getTransactionsByCounterparty(counterpartyId: string): Promise<Transaction[]> {
    return this.getTransactions({ counterpartyId });
  }

  /**
   * Получает последние транзакции
   */
  static async getRecentTransactions(limit: number = 10): Promise<Transaction[]> {
    return this.getTransactions({ limit });
  }
} 