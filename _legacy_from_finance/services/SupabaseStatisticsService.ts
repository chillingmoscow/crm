import { supabase } from '../../utils/supabaseClient';
import { StatsPeriodData, CategoryStats, AccountStats, Statistics } from '../../types';

/**
 * Сервис для работы со статистикой через Supabase
 */
export class SupabaseStatisticsService {
  /**
   * Получает статистику за период
   */
  static async getPeriodStatistics(
    fromDate: Date,
    toDate: Date,
    currency: string = 'RUB'
  ): Promise<StatsPeriodData> {
    console.log('SupabaseStatisticsService: Получаем статистику за период:', { fromDate, toDate, currency });

    // Получаем все транзакции за период
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select(`
        *,
        categories(name, type),
        accounts(name, currency)
      `)
      .gte('date', fromDate.toISOString())
      .lte('date', toDate.toISOString())
      .eq('currency', currency)
      .is('deleted_at', null);

    if (error) {
      console.error('Ошибка при получении статистики:', error);
      throw new Error('Ошибка при получении статистики');
    }

    if (!transactions || transactions.length === 0) {
      return {
        totalIncome: 0,
        totalExpense: 0,
        balance: 0,
        transactionCount: 0,
        categoryBreakdown: [],
        topCategories: [],
      };
    }

    // Рассчитываем основные показатели
    let totalIncome = 0;
    let totalExpense = 0;
    let transactionCount = transactions.length;

    // Группировка по категориям
    const categoryMap = new Map<string, { name: string; income: number; expense: number; count: number }>();

    transactions.forEach(transaction => {
      const amount = Number(transaction.amount);
      
      if (transaction.type === 'income') {
        totalIncome += amount;
      } else if (transaction.type === 'expense') {
        totalExpense += amount;
      }
      // Переводы не учитываем в доходах/расходах

      // Группировка по категориям
      const categoryId = transaction.category_id;
      const categoryName = transaction.categories?.name || 'Без категории';
      
      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, {
          name: categoryName,
          income: 0,
          expense: 0,
          count: 0
        });
      }

      const categoryData = categoryMap.get(categoryId)!;
      categoryData.count++;

      if (transaction.type === 'income') {
        categoryData.income += amount;
      } else if (transaction.type === 'expense') {
        categoryData.expense += amount;
      }
    });

    // Формируем результат
    const categoryBreakdown = Array.from(categoryMap.entries()).map(([id, data]) => ({
      categoryId: id,
      categoryName: data.name,
      totalAmount: data.income + data.expense,
      transactionCount: data.count,
      percentage: totalIncome + totalExpense > 0 ? 
        ((data.income + data.expense) / (totalIncome + totalExpense)) * 100 : 0
    }));

    // Топ категории по сумме
    const topCategories = categoryBreakdown
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);

    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      transactionCount,
      categoryBreakdown,
      topCategories,
    };
  }

  /**
   * Получает статистику по категориям за период
   */
  static async getCategoryStatistics(
    fromDate: Date,
    toDate: Date,
    currency: string = 'RUB'
  ): Promise<CategoryStats[]> {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select(`
        type,
        amount,
        currency,
        category_id,
        categories(name, type, color)
      `)
      .gte('date', fromDate.toISOString())
      .lte('date', toDate.toISOString())
      .is('deleted_at', null);

    if (error) {
      console.error('Ошибка при получении статистики по категориям:', error);
      throw new Error('Ошибка при получении статистики по категориям');
    }

    if (!transactions) {
      return [];
    }

    // Фильтруем по валюте и группируем по категориям
    const categoryMap = new Map<string, {
      categoryId: string;
      categoryName: string;
      categoryType: 'income' | 'expense';
      categoryColor?: string;
      totalAmount: number;
      transactionCount: number;
    }>();

    const filteredTransactions = transactions.filter(t => t.currency === currency);
    const totalAmount = filteredTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

    filteredTransactions.forEach(transaction => {
      const categoryId = transaction.category_id || 'no-category';
      const category = Array.isArray(transaction.categories) ? transaction.categories[0] : transaction.categories;
      const categoryName = category?.name || 'Без категории';
      const categoryType = transaction.type as 'income' | 'expense';
      const categoryColor = category?.color;
      const amount = Number(transaction.amount);

      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, {
          categoryId,
          categoryName,
          categoryType,
          categoryColor,
          totalAmount: 0,
          transactionCount: 0,
        });
      }

      const categoryData = categoryMap.get(categoryId)!;
      categoryData.totalAmount += amount;
      categoryData.transactionCount += 1;
    });

    // Преобразуем в массив и добавляем расчетные поля
    return Array.from(categoryMap.values()).map(category => ({
      ...category,
      averageAmount: category.totalAmount / category.transactionCount,
      percentage: totalAmount > 0 ? (category.totalAmount / totalAmount) * 100 : 0,
    }));
  }

  /**
   * Получает статистику по счетам
   */
  static async getAccountStatistics(
    fromDate: Date,
    toDate: Date
  ): Promise<AccountStats[]> {
    console.log('SupabaseStatisticsService: Получаем статистику по счетам');

    // Получаем текущие балансы счетов
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('*')
      .is('deleted_at', null);

    if (accountsError) {
      console.error('Ошибка при получении счетов:', accountsError);
      throw new Error('Ошибка при получении счетов');
    }

    // Получаем транзакции за период
    const { data: transactions, error: transactionsError } = await supabase
      .from('transactions')
      .select(`
        *,
        accounts!transactions_account_id_fkey(name, currency)
      `)
      .gte('date', fromDate.toISOString())
      .lte('date', toDate.toISOString())
      .is('deleted_at', null);

    if (transactionsError) {
      console.error('Ошибка при получении транзакций для статистики:', transactionsError);
      throw new Error('Ошибка при получении транзакций для статистики');
    }

    // Группировка по счетам
    const accountMap = new Map<string, AccountStats>();

    // Инициализируем счета
    accounts?.forEach(account => {
      accountMap.set(account.id, {
        accountId: account.id,
        accountName: account.name,
        currency: account.currency,
        currentBalance: Number(account.balance),
        totalIncome: 0,
        totalExpense: 0,
        transactionCount: 0,
        averageTransactionAmount: 0,
      });
    });

    // Обрабатываем транзакции
    transactions?.forEach(transaction => {
      const accountId = transaction.account_id;
      const amount = Number(transaction.amount);
      
      if (!accountMap.has(accountId)) return;

      const accountData = accountMap.get(accountId)!;
      accountData.transactionCount++;

      if (transaction.type === 'income') {
        accountData.totalIncome += amount;
      } else if (transaction.type === 'expense') {
        accountData.totalExpense += amount;
      }

      // Для переводов учитываем как исходящий счет
      if (transaction.type === 'transfer') {
        accountData.totalExpense += amount;
      }

      // Для целевого счета переводов
      if (transaction.type === 'transfer' && transaction.to_account_id) {
        const toAccountData = accountMap.get(transaction.to_account_id);
        if (toAccountData) {
          toAccountData.totalIncome += amount;
          toAccountData.transactionCount++;
        }
      }
    });

    // Рассчитываем средние значения
    const accountStats = Array.from(accountMap.values()).map(account => ({
      ...account,
      averageTransactionAmount: account.transactionCount > 0 ? 
        (account.totalIncome + account.totalExpense) / account.transactionCount : 0,
    }));

    return accountStats.sort((a, b) => b.currentBalance - a.currentBalance);
  }

  /**
   * Получает данные для графика трендов (по дням/месяцам)
   */
  static async getTrendData(
    fromDate: Date,
    toDate: Date,
    groupBy: 'day' | 'week' | 'month' = 'day',
    currency: string = 'RUB'
  ): Promise<Array<{ date: string; income: number; expense: number; balance: number }>> {
    console.log('SupabaseStatisticsService: Получаем данные трендов');

    // Определяем SQL группировку в зависимости от периода
    let dateFormat = '';
    switch (groupBy) {
      case 'day':
        dateFormat = 'DATE(date)';
        break;
      case 'week':
        dateFormat = "DATE_TRUNC('week', date)";
        break;
      case 'month':
        dateFormat = "DATE_TRUNC('month', date)";
        break;
    }

    const { data, error } = await supabase.rpc('get_trend_data', {
      from_date: fromDate.toISOString(),
      to_date: toDate.toISOString(),
      group_format: dateFormat,
      target_currency: currency
    });

    if (error) {
      console.log('RPC функция недоступна, используем альтернативный метод');
      // Fallback: группируем данные на клиенте
      return this.getTrendDataFallback(fromDate, toDate, groupBy, currency);
    }

    return data || [];
  }

  /**
   * Альтернативный метод получения трендов (без RPC)
   */
  private static async getTrendDataFallback(
    fromDate: Date,
    toDate: Date,
    groupBy: 'day' | 'week' | 'month',
    currency: string
  ): Promise<Array<{ date: string; income: number; expense: number; balance: number }>> {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .gte('date', fromDate.toISOString())
      .lte('date', toDate.toISOString())
      .eq('currency', currency)
      .is('deleted_at', null)
      .order('date');

    if (error || !transactions) {
      return [];
    }

    // Группируем транзакции по датам
    const trendMap = new Map<string, { income: number; expense: number }>();

    transactions.forEach(transaction => {
      const date = new Date(transaction.date);
      let dateKey = '';

      switch (groupBy) {
        case 'day':
          dateKey = date.toISOString().split('T')[0];
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          dateKey = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
          break;
      }

      if (!trendMap.has(dateKey)) {
        trendMap.set(dateKey, { income: 0, expense: 0 });
      }

      const trendData = trendMap.get(dateKey)!;
      const amount = Number(transaction.amount);

      if (transaction.type === 'income') {
        trendData.income += amount;
      } else if (transaction.type === 'expense') {
        trendData.expense += amount;
      }
    });

    // Формируем результат с накопительным балансом
    let cumulativeBalance = 0;
    const result = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => {
        cumulativeBalance += data.income - data.expense;
        return {
          date,
          income: data.income,
          expense: data.expense,
          balance: cumulativeBalance,
        };
      });

    return result;
  }

  /**
   * Получает общую статистику за период
   */
  static async getStatistics(
    fromDate: Date,
    toDate: Date,
    currency: string = 'RUB'
  ): Promise<Statistics> {
    try {
      // Получаем все транзакции за период
      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('type, amount, currency, category_id')
        .gte('date', fromDate.toISOString())
        .lte('date', toDate.toISOString())
        .is('deleted_at', null);

      if (error) {
        console.error('Ошибка при получении транзакций для статистики:', error);
        throw new Error('Ошибка при получении статистики');
      }

      if (!transactions) {
        return this.getEmptyStatistics();
      }

      // Фильтруем по валюте
      const filteredTransactions = transactions.filter(t => t.currency === currency);
      
      const totalIncome = filteredTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + Number(t.amount), 0);
      
      const totalExpense = filteredTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      // Группируем по категориям
      const incomeByCategory: Record<string, number> = {};
      const expenseByCategory: Record<string, number> = {};

      filteredTransactions.forEach(transaction => {
        const categoryId = transaction.category_id || 'no-category';
        const amount = Number(transaction.amount);

        if (transaction.type === 'income') {
          incomeByCategory[categoryId] = (incomeByCategory[categoryId] || 0) + amount;
        } else if (transaction.type === 'expense') {
          expenseByCategory[categoryId] = (expenseByCategory[categoryId] || 0) + amount;
        }
      });

      return {
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
        incomeByCategory,
        expenseByCategory
      };
    } catch (error) {
      console.error('Ошибка при получении статистики:', error);
      throw error;
    }
  }

  private static getEmptyStatistics(): Statistics {
    return {
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      incomeByCategory: {},
      expenseByCategory: {}
    };
  }
} 