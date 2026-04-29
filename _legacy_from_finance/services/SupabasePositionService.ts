import { supabase } from '../../utils/supabaseClient';
import { Position } from '../../types';

/**
 * Сервис для работы с должностями в Supabase
 */
export class SupabasePositionService {
  private static readonly TABLE_NAME = 'positions';

  /**
   * Преобразование данных из формата Supabase в локальный формат
   */
  private static mapFromSupabase(supabasePosition: any): Position {
    return {
      id: supabasePosition.id,
      organizationId: supabasePosition.organization_id,
      legalEntityId: supabasePosition.legal_entity_id,
      name: supabasePosition.name,
      description: supabasePosition.description,
      createdAt: new Date(supabasePosition.created_at),
      updatedAt: supabasePosition.updated_at ? new Date(supabasePosition.updated_at) : undefined,
      isActive: supabasePosition.is_active,
    };
  }

  /**
   * Преобразование данных из локального формата в формат Supabase
   */
  private static mapToSupabase(
    position: Omit<Position, 'id' | 'createdAt' | 'updatedAt'>
  ): any {
    return {
      organization_id: position.organizationId,
      legal_entity_id: position.legalEntityId,
      name: position.name,
      description: position.description,
      is_active: position.isActive,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Получение должностей организации
   */
  static async getPositions(organizationId: string): Promise<Position[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении должностей:', error);
      throw new Error(`Ошибка при получении должностей: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Получение должности по ID
   */
  static async getPositionById(id: string): Promise<Position | null> {
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
      console.error('Ошибка при получении должности:', error);
      throw new Error(`Ошибка при получении должности: ${error.message}`);
    }

    return data ? this.mapFromSupabase(data) : null;
  }

  /**
   * Создание новой должности
   */
  static async addPosition(
    position: Omit<Position, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Position> {
    const positionData = this.mapToSupabase(position);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .insert(positionData)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при создании должности:', error);
      throw new Error(`Ошибка при создании должности: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Обновление существующей должности
   */
  static async updatePosition(
    updatedPosition: Position
  ): Promise<Position> {
    const positionData = this.mapToSupabase(updatedPosition);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .update(positionData)
      .eq('id', updatedPosition.id)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при обновлении должности:', error);
      throw new Error(`Ошибка при обновлении должности: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Удаление должности (мягкое удаление)
   */
  static async deletePosition(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('Ошибка при удалении должности:', error);
      throw new Error(`Ошибка при удалении должности: ${error.message}`);
    }

    return true;
  }

  /**
   * Получение должностей юридического лица
   */
  static async getPositionsByLegalEntity(legalEntityId: string): Promise<Position[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('legal_entity_id', legalEntityId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении должностей юридического лица:', error);
      throw new Error(`Ошибка при получении должностей юридического лица: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }
} 