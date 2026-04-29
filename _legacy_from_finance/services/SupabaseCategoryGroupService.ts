import { supabase } from '../../utils/supabaseClient';
import { CategoryGroup } from '../../types';

interface SupabaseCategoryGroupRow {
  id: string;
  name: string;
  type: string;
  description?: string;
  created_at: string;
  created_by: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

/**
 * Сервис для работы с группами категорий в Supabase
 */
export class SupabaseCategoryGroupService {

  /**
   * Получить все группы категорий
   */
  static async getCategoryGroups(): Promise<CategoryGroup[]> {
    try {
      const { data, error } = await supabase
        .from('category_groups')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) {
        console.error('Ошибка при загрузке групп категорий:', error);
        return [];
      }

      return (data as SupabaseCategoryGroupRow[]).map(group => ({
        id: group.id,
        name: group.name,
        type: group.type as 'income' | 'expense' | 'both',
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
      console.error('Ошибка при загрузке групп категорий:', error);
      return [];
    }
  }

  /**
   * Добавить новую группу категорий
   */
  static async addCategoryGroup(
    categoryGroup: Omit<CategoryGroup, 'id' | 'audit' | 'createdAt' | 'updatedAt'>, 
    userId: string,
    organizationId: string
  ): Promise<CategoryGroup> {
    try {
      const { data, error } = await supabase
        .from('category_groups')
        .insert([{
          name: categoryGroup.name,
          type: categoryGroup.type,
          description: categoryGroup.description,
          organization_id: organizationId,
          created_by: userId,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Ошибка при создании группы категорий:', error);
        throw error;
      }

      const group = data as SupabaseCategoryGroupRow;
      return {
        id: group.id,
        name: group.name,
        type: group.type as 'income' | 'expense' | 'both',
        description: group.description,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.created_at),
        audit: {
          createdAt: new Date(group.created_at),
          createdBy: group.created_by
        }
      };
    } catch (error) {
      console.error('Ошибка при создании группы категорий:', error);
      throw error;
    }
  }

  /**
   * Обновить группу категорий
   */
  static async updateCategoryGroup(categoryGroup: CategoryGroup, userId: string): Promise<CategoryGroup> {
    try {
      const { data, error } = await supabase
        .from('category_groups')
        .update({
          name: categoryGroup.name,
          type: categoryGroup.type,
          description: categoryGroup.description,
          updated_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq('id', categoryGroup.id)
        .select()
        .single();

      if (error) {
        console.error('Ошибка при обновлении группы категорий:', error);
        throw error;
      }

      const group = data as SupabaseCategoryGroupRow;
      return {
        id: group.id,
        name: group.name,
        type: group.type as 'income' | 'expense' | 'both',
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
      console.error('Ошибка при обновлении группы категорий:', error);
      throw error;
    }
  }

  /**
   * Удалить группу категорий (мягкое удаление)
   */
  static async deleteCategoryGroup(id: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('category_groups')
        .update({
          deleted_by: userId,
          deleted_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) {
        console.error('Ошибка при удалении группы категорий:', error);
        throw error;
      }
    } catch (error) {
      console.error('Ошибка при удалении группы категорий:', error);
      throw error;
    }
  }
} 