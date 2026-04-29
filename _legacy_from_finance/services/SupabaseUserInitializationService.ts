import { supabase } from '../../utils/supabaseClient';

/**
 * Результат инициализации пользователя
 */
export interface UserInitializationResult {
  success: boolean;
  user_id?: string;
  organization_id?: string;
  legal_entity_id?: string;
  position_id?: string;
  assignment_id?: string;
  message?: string;
  error?: string;
}

/**
 * Статус инициализации пользователя
 */
export interface UserInitializationStatus {
  initialized: boolean;
  user_id?: string;
  organization_id?: string;
  message?: string;
  error?: string;
}

/**
 * Упрощенный сервис для инициализации пользователей
 * Убрана вся логика кэширования для простоты и надежности
 */
export class SupabaseUserInitializationService {

  /**
   * Завершает регистрацию пользователя - создает организацию, юридическое лицо и базовые данные
   */
  static async completeUserRegistration(): Promise<UserInitializationResult> {
    try {
      console.log('🚀 Инициализация пользователя...');

      const { data, error } = await supabase.rpc('complete_user_registration');

      if (error) {
        console.error('❌ Ошибка инициализации:', error);
        throw new Error(`Ошибка инициализации: ${error.message}`);
      }

      if (!data?.success) {
        const errorMessage = data?.error || data?.message || 'Неизвестная ошибка инициализации';
        throw new Error(errorMessage);
      }

      console.log('✅ Инициализация завершена');
      return data as UserInitializationResult;

    } catch (error) {
      console.error('❌ Критическая ошибка инициализации:', error);
      throw error;
    }
  }

  /**
   * Проверяет статус инициализации текущего пользователя
   */
  static async checkInitializationStatus(): Promise<UserInitializationStatus> {
    try {
      console.log('🔍 Проверка статуса инициализации...');

      // Используем Promise.race для таймаута
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          console.error('⏰ Таймаут проверки статуса (5 сек)');
          reject(new Error('Таймаут проверки статуса'));
        }, 5000);
      });

      const { data, error } = await Promise.race([
        supabase.rpc('check_user_initialization_status'),
        timeoutPromise
      ]);

      if (error) {
        console.error('❌ Ошибка проверки статуса:', error);
        return {
          initialized: false,
          error: error.message
        };
      }

      console.log('📊 Статус получен:', data);
      return data as UserInitializationStatus;

    } catch (error) {
      console.error('❌ Исключение при проверке статуса:', error);
      return {
        initialized: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      };
    }
  }

  /**
   * Обеспечивает инициализацию пользователя - проверяет и при необходимости инициализирует
   */
  static async ensureUserInitialized(): Promise<boolean> {
    try {
      console.log('🎯 Проверка инициализации...');
      
      // Проверяем текущий статус
      const status = await this.checkInitializationStatus();
      
      if (status.error) {
        console.error('❌ Ошибка статуса:', status.error);
        return false;
      }

      if (status.initialized) {
        console.log('✅ Пользователь уже инициализирован');
        return true;
      }

      // Если не инициализирован - инициализируем
      console.log('🔄 Запуск инициализации...');
      const result = await this.completeUserRegistration();
      
      if (result.success) {
        console.log('🎉 Инициализация успешна');
      } else {
        console.error('💥 Инициализация не удалась:', result.error || result.message);
      }

      return result.success;

    } catch (error) {
      console.error('❌ Ошибка обеспечения инициализации:', error);
      return false;
    }
  }
}