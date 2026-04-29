import { supabase } from '../../utils/supabaseClient';
import { Category } from '../../types';

/**
 * Сервис для работы с категориями в Supabase
 */
export class SupabaseCategoryService {
  /**
   * Преобразует данные из Supabase в тип Category
   */
  private static mapFromSupabase(supabaseCategory: any): Category {
    return {
      id: supabaseCategory.id,
      name: supabaseCategory.name,
      type: supabaseCategory.type,
      description: supabaseCategory.description,
      color: supabaseCategory.color,
      groupId: supabaseCategory.group_id,
      audit: {
        createdBy: supabaseCategory.created_by,
        createdAt: new Date(supabaseCategory.created_at),
        updatedBy: supabaseCategory.updated_by,
        updatedAt: supabaseCategory.updated_at ? new Date(supabaseCategory.updated_at) : undefined,
        deletedBy: supabaseCategory.deleted_by,
        deletedAt: supabaseCategory.deleted_at ? new Date(supabaseCategory.deleted_at) : undefined,
      },
    };
  }

  /**
   * Преобразует Category в формат для Supabase
   */
  private static mapToSupabase(
    category: Omit<Category, 'id' | 'audit'>,
    userId: string
  ): any {
    return {
      name: category.name,
      type: category.type,
      description: category.description,
      color: category.color,
      group_id: category.groupId,
      created_by: userId,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Получить все категории
   */
  static async getCategories(): Promise<Category[]> {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) {
        console.error('Ошибка загрузки категорий:', error);
        throw error;
      }

      return data.map(this.mapFromSupabase);
    } catch (error) {
      console.error('Ошибка в getCategories:', error);
      throw error;
    }
  }

  /**
   * Добавить новую категорию
   */
  static async addCategory(
    category: Omit<Category, 'id' | 'audit'>,
    userId: string,
    organizationId: string
  ): Promise<Category> {
    try {
      const categoryData = this.mapToSupabase(category, userId);
      
      // Добавляем organization_id для RLS
      categoryData.organization_id = organizationId;

      const { data, error } = await supabase
        .from('categories')
        .insert([categoryData])
        .select()
        .single();

      if (error) {
        console.error('Ошибка создания категории:', error);
        throw error;
      }

      return this.mapFromSupabase(data);
    } catch (error) {
      console.error('Ошибка в addCategory:', error);
      throw error;
    }
  }

  /**
   * Обновить категорию
   */
  static async updateCategory(
    updatedCategory: Category,
    userId: string
  ): Promise<Category> {
    try {
      const categoryData = this.mapToSupabase(updatedCategory, userId);
      // Убираем поля создания и добавляем поля обновления
      delete categoryData.created_by;
      delete categoryData.created_at;
      categoryData.updated_by = userId;
      categoryData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('categories')
        .update(categoryData)
        .eq('id', updatedCategory.id)
        .select()
        .single();

      if (error) {
        console.error('Ошибка обновления категории:', error);
        throw error;
      }

      return this.mapFromSupabase(data);
    } catch (error) {
      console.error('Ошибка в updateCategory:', error);
      throw error;
    }
  }

  /**
   * Мягкое удаление категории
   */
  static async deleteCategory(id: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('categories')
        .update({
          deleted_by: userId,
          deleted_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) {
        console.error('Ошибка удаления категории:', error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Ошибка в deleteCategory:', error);
      throw error;
    }
  }
} 