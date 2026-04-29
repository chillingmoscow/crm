import { supabase } from '../../utils/supabaseClient';
import { LegalEntity } from '../../types';

/**
 * Сервис для работы с юридическими лицами в Supabase
 */
export class SupabaseLegalEntityService {
  private static readonly TABLE_NAME = 'legal_entities';

  /**
   * Преобразование данных из формата Supabase в локальный формат
   */
  private static mapFromSupabase(supabaseLegalEntity: any): LegalEntity {
    return {
      id: supabaseLegalEntity.id,
      organizationId: supabaseLegalEntity.organization_id,
      name: supabaseLegalEntity.name,
      fullName: supabaseLegalEntity.full_name || supabaseLegalEntity.name,
      inn: supabaseLegalEntity.inn,
      kpp: supabaseLegalEntity.kpp,
      ogrn: supabaseLegalEntity.ogrn,
      legalAddress: supabaseLegalEntity.legal_address || supabaseLegalEntity.address,
      actualAddress: supabaseLegalEntity.actual_address || supabaseLegalEntity.address,
      phone: supabaseLegalEntity.phone,
      email: supabaseLegalEntity.email,
      website: supabaseLegalEntity.website,
      taxSystem: supabaseLegalEntity.tax_system,
      vatAccountingEnabled: supabaseLegalEntity.vat_accounting_enabled || false,
      createdAt: new Date(supabaseLegalEntity.created_at),
      updatedAt: supabaseLegalEntity.updated_at ? new Date(supabaseLegalEntity.updated_at) : undefined,
      isActive: supabaseLegalEntity.is_active,
    };
  }

  /**
   * Преобразование данных из локального формата в формат Supabase
   */
  private static mapToSupabase(
    legalEntity: Omit<LegalEntity, 'id' | 'createdAt' | 'updatedAt'>
  ): any {
    return {
      organization_id: legalEntity.organizationId,
      name: legalEntity.name,
      full_name: legalEntity.fullName,
      legal_form: 'ООО', // По умолчанию ООО, можно будет улучшить
      inn: legalEntity.inn,
      kpp: legalEntity.kpp,
      ogrn: legalEntity.ogrn,
      address: legalEntity.legalAddress,
      legal_address: legalEntity.legalAddress,
      actual_address: legalEntity.actualAddress,
      phone: legalEntity.phone,
      email: legalEntity.email,
      website: legalEntity.website,
      tax_system: legalEntity.taxSystem,
      vat_accounting_enabled: legalEntity.vatAccountingEnabled,
      description: legalEntity.fullName ? `Полное название: ${legalEntity.fullName}` : undefined,
      is_default: false, // По умолчанию не основное
      is_active: legalEntity.isActive,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Получение юридических лиц организации
   */
  static async getLegalEntities(organizationId: string): Promise<LegalEntity[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Ошибка при получении юридических лиц:', error);
      throw new Error(`Ошибка при получении юридических лиц: ${error.message}`);
    }

    return (data || []).map(this.mapFromSupabase);
  }

  /**
   * Получение юридического лица по ID
   */
  static async getLegalEntityById(id: string): Promise<LegalEntity | null> {
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
      console.error('Ошибка при получении юридического лица:', error);
      throw new Error(`Ошибка при получении юридического лица: ${error.message}`);
    }

    return data ? this.mapFromSupabase(data) : null;
  }

  /**
   * Создание нового юридического лица
   */
  static async addLegalEntity(
    legalEntity: Omit<LegalEntity, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<LegalEntity> {
    const legalEntityData = this.mapToSupabase(legalEntity);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .insert(legalEntityData)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при создании юридического лица:', error);
      throw new Error(`Ошибка при создании юридического лица: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Обновление существующего юридического лица
   */
  static async updateLegalEntity(
    updatedLegalEntity: LegalEntity
  ): Promise<LegalEntity> {
    const legalEntityData = this.mapToSupabase(updatedLegalEntity);

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .update(legalEntityData)
      .eq('id', updatedLegalEntity.id)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при обновлении юридического лица:', error);
      throw new Error(`Ошибка при обновлении юридического лица: ${error.message}`);
    }

    return this.mapFromSupabase(data);
  }

  /**
   * Удаление юридического лица (мягкое удаление)
   */
  static async deleteLegalEntity(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('Ошибка при удалении юридического лица:', error);
      throw new Error(`Ошибка при удалении юридического лица: ${error.message}`);
    }

    return true;
  }


} 