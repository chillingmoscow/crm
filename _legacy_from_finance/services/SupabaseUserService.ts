// Новый сервис для пользователей

import { User, CreateUserData, Gender, UserStatus } from '../../types';

// Интерфейс для работы с базой данных
interface DatabaseUser {
  id: string;
  full_name: string;
  email: string;
  avatar?: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string;
  gender?: string;
  phone?: string;
  telegram_id?: string;
  status: string;
  birth_date?: string;
  hire_date?: string;
  termination_date?: string;
  organization_id?: string;
  position_id?: string;
  legal_entity_id?: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
  is_active: boolean;
}

// Функция маппинга из формата базы данных в формат приложения
export function mapFromDatabase(dbUser: DatabaseUser): User {
  return {
    id: dbUser.id,
    fullName: dbUser.full_name,
    email: dbUser.email,
    avatar: dbUser.avatar,
    lastName: dbUser.last_name,
    firstName: dbUser.first_name,
    middleName: dbUser.middle_name,
    gender: dbUser.gender as Gender,
    phone: dbUser.phone,
    telegramId: dbUser.telegram_id,
    status: dbUser.status as UserStatus,
    birthDate: dbUser.birth_date ? new Date(dbUser.birth_date) : undefined,
    hireDate: dbUser.hire_date ? new Date(dbUser.hire_date) : undefined,
    terminationDate: dbUser.termination_date ? new Date(dbUser.termination_date) : undefined,
    organizationId: dbUser.organization_id,
    positionId: dbUser.position_id,
    legalEntityId: dbUser.legal_entity_id,
    notes: dbUser.notes,
    createdAt: new Date(dbUser.created_at),
    updatedAt: dbUser.updated_at ? new Date(dbUser.updated_at) : undefined,
    createdBy: dbUser.created_by,
    updatedBy: dbUser.updated_by,
    isActive: dbUser.is_active,
  };
}

// Функция маппинга из формата приложения в формат базы данных
export function mapToDatabase(user: CreateUserData, organizationId: string): Partial<DatabaseUser> {
  return {
    full_name: `${user.lastName} ${user.firstName} ${user.middleName || ''}`.trim(),
    email: user.email,
    last_name: user.lastName,
    first_name: user.firstName,
    middle_name: user.middleName || undefined,
    gender: user.gender || undefined,
    phone: user.phone || undefined,
    status: 'invited', // По умолчанию приглашенный
    hire_date: user.hireDate ? user.hireDate.toISOString().split('T')[0] : undefined,
    organization_id: organizationId,
    position_id: user.positionId || undefined,
    legal_entity_id: user.legalEntityId || undefined,
    notes: user.notes || undefined,
    is_active: true,
  };
}

export class SupabaseUserService {
  private static tableName = 'users';

  // Получить всех пользователей организации
  static async getAll(): Promise<User[]> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.REACT_APP_SUPABASE_URL!,
      process.env.REACT_APP_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('last_name', { ascending: true });

    if (error) {
      console.error('Ошибка при получении пользователей:', error);
      throw new Error(error.message);
    }

    return data?.map(mapFromDatabase) || [];
  }

  // Получить пользователя по ID
  static async getUserById(id: string): Promise<User | null> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.REACT_APP_SUPABASE_URL!,
      process.env.REACT_APP_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Пользователь не найден
      }
      console.error('Ошибка при получении пользователя:', error);
      throw new Error(error.message);
    }

    return mapFromDatabase(data);
  }

  // Создать нового пользователя
  static async create(userData: CreateUserData): Promise<User> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.REACT_APP_SUPABASE_URL!,
      process.env.REACT_APP_SUPABASE_ANON_KEY!
    );

    // Получаем текущего пользователя для organization_id
    const { data: currentUser } = await supabase.auth.getUser();
    if (!currentUser.user) {
      throw new Error('Пользователь не авторизован');
    }

    // Получаем organization_id текущего пользователя
    const { data: userInfo, error: userError } = await supabase
      .from(this.tableName)
      .select('organization_id')
      .eq('id', currentUser.user.id)
      .single();

    if (userError || !userInfo?.organization_id) {
      throw new Error('Не удалось определить организацию пользователя');
    }

    const dbData = mapToDatabase(userData, userInfo.organization_id);
    dbData.created_by = currentUser.user.id;

    const { data, error } = await supabase
      .from(this.tableName)
      .insert([dbData])
      .select()
      .single();

    if (error) {
      console.error('Ошибка при создании пользователя:', error);
      throw new Error(error.message);
    }

    return mapFromDatabase(data);
  }

  // Обновить пользователя
  static async update(id: string, userData: Partial<CreateUserData>): Promise<User> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.REACT_APP_SUPABASE_URL!,
      process.env.REACT_APP_SUPABASE_ANON_KEY!
    );

    // Получаем текущего пользователя
    const { data: currentUser } = await supabase.auth.getUser();
    if (!currentUser.user) {
      throw new Error('Пользователь не авторизован');
    }

    const updateData: Partial<DatabaseUser> = {
      updated_by: currentUser.user.id,
    };

    if (userData.lastName !== undefined) {
      updateData.last_name = userData.lastName;
    }
    if (userData.firstName !== undefined) {
      updateData.first_name = userData.firstName;
    }
    if (userData.middleName !== undefined) {
      updateData.middle_name = userData.middleName || undefined;
    }
    if (userData.email !== undefined) {
      updateData.email = userData.email;
    }
    if (userData.phone !== undefined) {
      updateData.phone = userData.phone || undefined;
    }
    if (userData.gender !== undefined) {
      updateData.gender = userData.gender || undefined;
    }
    if (userData.positionId !== undefined) {
      updateData.position_id = userData.positionId || undefined;
    }
    if (userData.legalEntityId !== undefined) {
      updateData.legal_entity_id = userData.legalEntityId || undefined;
    }
    if (userData.hireDate !== undefined) {
      updateData.hire_date = userData.hireDate ? userData.hireDate.toISOString().split('T')[0] : undefined;
    }
    if (userData.notes !== undefined) {
      updateData.notes = userData.notes || undefined;
    }

    // Обновляем full_name если изменились компоненты имени
    if (userData.lastName !== undefined || userData.firstName !== undefined || userData.middleName !== undefined) {
      const lastName = userData.lastName || '';
      const firstName = userData.firstName || '';
      const middleName = userData.middleName || '';
      updateData.full_name = `${lastName} ${firstName} ${middleName}`.trim();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Ошибка при обновлении пользователя:', error);
      throw new Error(error.message);
    }

    return mapFromDatabase(data);
  }
}
