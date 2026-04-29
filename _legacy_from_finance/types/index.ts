// Типы для пользователей
export type UserStatus = 'invited' | 'active' | 'suspended' | 'terminated';
export type Gender = 'male' | 'female';

// Базовые типы для приложения
export interface User {
  id: string;
  fullName: string;
  email: string;
  avatar?: string;
  
  // Личные данные
  lastName?: string; // Фамилия
  firstName?: string; // Имя  
  middleName?: string; // Отчество
  gender?: Gender; // Пол: мужской или женский
  
  // Контактная информация
  phone?: string;
  telegramId?: string;
  
  // Статус и даты
  status: UserStatus;
  birthDate?: Date;
  hireDate?: Date;
  terminationDate?: Date;
  
  // Связи с организационной структурой
  organizationId?: string; // ID основной организации
  positionId?: string; // ID должности (основной источник прав)
  legalEntityId?: string; // ID привязанного юрлица
  
  // Дополнительные поля
  notes?: string;
  
  // Служебные поля
  createdAt: Date;
  updatedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
  isActive: boolean;
}

// Интерфейс для аудита всех сущностей
export interface AuditInfo {
  createdBy: string; // ID пользователя
  createdAt: Date;
  updatedBy?: string; // ID пользователя
  updatedAt?: Date;
  deletedBy?: string; // ID пользователя
  deletedAt?: Date;
}

// Типы счетов
export type AccountType = 'checking' | 'debit_card' | 'cash' | 'fund';

// Интерфейс для счета
export interface Account {
  id: string;
  name: string;
  balance: number;
  currency: string;
  description?: string;
  groupId?: string; // ID группы счета
  accountType: AccountType;
  
  // Поля для связи с организацией и заведением
  organizationId: string; // ID организации (обязательное поле)
  legalEntityId: string; // ID юридического лица (обязательное поле)
  
  // Банковские поля (для расчетных счетов и дебетовых карт)
  bankName?: string;
  bik?: string;
  accountNumber?: string;
  correspondentAccount?: string;
  acquiringPercentage?: number;
  
  // Поля для дебетовых карт
  cardHolder?: string;
  cardNumber?: string;
  
  audit: AuditInfo;
}

// Интерфейс для категории
export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense'; // тип: доход или расход
  description?: string;
  color?: string; // цвет для отображения в интерфейсе
  groupId?: string; // ID группы категории
  
  audit: AuditInfo;
}

// Интерфейс для контрагента
export interface Counterparty {
  id: string;
  name: string;             // Название компании/ИП/физлица
  legalEntity: string;      // Юридическое лицо (форма собственности: ООО, ИП, АО и т.д.)
  inn?: string;             // ИНН
  contactPerson?: string;   // Контактное лицо
  phone?: string;           // Телефон
  email?: string;           // Email
  description?: string;     // Краткое описание
  groupId?: string;         // ID группы контрагента
  
  audit: AuditInfo;
}

// Интерфейс для транзакции
export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  accountId: string;
  categoryId?: string;
  counterpartyId?: string;
  description: string;
  date: Date;
  type: 'income' | 'expense' | 'transfer';
  toAccountId?: string; // Для переводов между счетами
  toAmount?: number; // Сумма зачисления для переводов с разными валютами
  toCurrency?: string; // Валюта зачисления для переводов с разными валютами
  attachments?: AttachedFile[];
  
  audit: AuditInfo;
}

// Интерфейс для прикрепленного файла
export interface AttachedFile {
  id: string;
  name: string;
  type: string; // MIME type
  size: number; // размер в байтах
  url: string;  // ссылка на файл
  thumbnailUrl?: string; // ссылка на миниатюру (для изображений)
  uploadedAt: Date;
  uploadedBy: string; // ID пользователя
  storagePath?: string; // Путь файла в Supabase Storage
}

// Тип для статистики
export interface Statistics {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
}

// Типы для системы аудита
export type EntityType = 'account' | 'category' | 'transaction' | 'user' | 'counterparty' | 'account_group' | 'category_group' | 'counterparty_group';
export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout';

export interface AuditLog {
  id: string;
  userId: string;
  timestamp: Date;
  action: AuditAction;
  entityType: EntityType;
  entityId?: string;
  details: string;
}

// Дополнительные типы для статистики
export interface StatsPeriodData {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  transactionCount: number;
  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    totalAmount: number;
    transactionCount: number;
    percentage: number;
  }>;
  topCategories: Array<{
    categoryId: string;
    categoryName: string;
    totalAmount: number;
    transactionCount: number;
    percentage: number;
  }>;
}

export interface CategoryStats {
  categoryId: string;
  categoryName: string;
  categoryType: 'income' | 'expense';
  categoryColor?: string;
  totalAmount: number;
  transactionCount: number;
  averageAmount: number;
  percentage: number;
}

export interface AccountStats {
  accountId: string;
  accountName: string;
  currency: string;
  currentBalance: number;
  totalIncome: number;
  totalExpense: number;
  transactionCount: number;
  averageTransactionAmount: number;
  lastTransactionDate?: Date;
}

// Типы для групп счетов
export interface AccountGroup {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  
  audit: AuditInfo;
}

// Типы для групп категорий
export interface CategoryGroup {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'both'; // тип: для доходов, расходов или для обоих
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  
  audit: AuditInfo;
}

// Типы для групп контрагентов
export interface CounterpartyGroup {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  
  audit: AuditInfo;
}

// Статусы сотрудников (устарело - используем UserStatus)
export type EmployeeStatus = 'invited' | 'active' | 'suspended' | 'terminated';

// Интерфейс для создания пользователя
export interface CreateUserData {
  // Личные данные
  lastName: string; // Фамилия
  firstName: string; // Имя  
  middleName?: string; // Отчество
  gender?: Gender; // Пол: мужской или женский
  
  // Контактная информация
  email: string;
  phone?: string;
  
  // Организационные связи
  positionId?: string;
  legalEntityId?: string;
  
  // Даты
  hireDate?: Date;
  
  // Дополнительные поля
  notes?: string;
}

// Типы для мультитенантности и организационной структуры
export interface Organization {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  settings: Record<string, any>;
  createdAt: Date;
  updatedAt?: Date;
  isActive: boolean;
}

export interface LegalEntity {
  id: string;
  organizationId: string;
  name: string; // Краткое название
  fullName?: string; // Полное название (например "ООО Ромашка")
  inn?: string;
  kpp?: string;
  ogrn?: string;
  legalAddress?: string; // Юридический адрес
  actualAddress?: string; // Фактический адрес
  phone?: string;
  email?: string;
  website?: string; // Сайт
  taxSystem?: string; // Система налогообложения
  vatAccountingEnabled?: boolean; // Учет НДС
  createdAt: Date;
  updatedAt?: Date;
  isActive: boolean;
}

export interface Position {
  id: string;
  organizationId: string;
  legalEntityId?: string;
  name: string; // Директор, Бухгалтер, Управляющий и т.д.
  description?: string;
  createdAt: Date;
  updatedAt?: Date;
  isActive: boolean;
}

// Отдельный интерфейс для прав должности
export interface PositionPermission {
  id: string;
  positionId: string;
  objectType: string; // 'accounts', 'transactions', 'categories', etc.
  accessLevel: 'read' | 'write' | 'full';
  createdAt: Date;
}

export interface UserAssignment {
  id: string;
  userId: string;
  organizationId: string;
  legalEntityId?: string;
  positionId: string; // Теперь обязательное поле - права только через должности!
  invitedAt: Date;
  acceptedAt?: Date; // когда пользователь принял приглашение
  isActive: boolean;
}

// Расширенный интерфейс пользователя с организационной информацией
export interface UserWithAssignment extends User {
  organizationId?: string;
  assignment?: UserAssignment;
  position?: Position;
  legalEntity?: LegalEntity;
}

// Интерфейс для настроек прав доступа
export interface Permission {
  key: string;
  name: string;
  description: string;
  category: string;
}

// Предустановленные права доступа
export const PERMISSIONS: Permission[] = [
  // Управление организацией
  { key: 'manage_organization', name: 'Управление организацией', description: 'Изменение настроек организации', category: 'organization' },
  { key: 'manage_users', name: 'Управление пользователями', description: 'Приглашение и управление пользователями', category: 'organization' },
  { key: 'manage_positions', name: 'Управление должностями', description: 'Создание и редактирование должностей', category: 'organization' },
  { key: 'manage_legal_entities', name: 'Управление юрлицами', description: 'Создание и редактирование юридических лиц', category: 'organization' },
  
  // Финансовый учет
  { key: 'manage_accounts', name: 'Управление счетами', description: 'Создание и редактирование счетов', category: 'finance' },
  { key: 'manage_transactions', name: 'Управление транзакциями', description: 'Создание и редактирование транзакций', category: 'finance' },
  { key: 'manage_categories', name: 'Управление категориями', description: 'Создание и редактирование категорий', category: 'finance' },
  { key: 'manage_counterparties', name: 'Управление контрагентами', description: 'Создание и редактирование контрагентов', category: 'finance' },
  
  // Просмотр отчетов
  { key: 'view_reports', name: 'Просмотр отчетов', description: 'Доступ к финансовым отчетам и аналитике', category: 'reports' },
  { key: 'export_data', name: 'Экспорт данных', description: 'Экспорт данных в различных форматах', category: 'reports' },
  
  // Административные функции
  { key: 'view_audit_logs', name: 'Просмотр аудита', description: 'Доступ к журналу действий пользователей', category: 'admin' },
  { key: 'manage_settings', name: 'Управление настройками', description: 'Изменение системных настроек', category: 'admin' },
];

// Группировка прав по категориям
export const PERMISSION_CATEGORIES = [
  { key: 'organization', name: 'Управление организацией', icon: '🏢' },
  { key: 'finance', name: 'Финансовый учет', icon: '💰' },
  { key: 'reports', name: 'Отчеты и аналитика', icon: '📊' },
  { key: 'admin', name: 'Администрирование', icon: '⚙️' },
]; 