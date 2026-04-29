# 💾 Memory Bank - Finance Tracker Project

## 📊 Статус проекта (Июнь 2025)
- **Состояние:** ✅ Стабильно работает
- **TypeScript:** ✅ Без ошибок компиляции
- **Архитектура:** ✅ Полностью рефакторированная
- **База данных:** ✅ Supabase PostgreSQL
- **UI/UX:** ✅ Единые стандарты дизайна

## 🎨 Дизайн-система (Обновлено июнь 2025)

### Стандарты дизайна ✅
```typescript
// utils/constants.ts
export const DESIGN_STANDARDS = {
  BORDER_RADIUS: '8px',           // Для всех форм и кнопок
  COLOR_INDICATOR_SIZE: 8         // Для цветных индикаторов в таблицах
};
```

### Эталонный стиль (TransactionsPage)
- **Paper компоненты** с `borderRadius: '8px'`
- **Границы:** `border: '1px solid #F3F4F6'`
- **Поиск:** SearchIcon + SEARCH_FIELD_STYLES
- **Таблицы:** с пагинацией, поиском и фильтрами
- **Кнопки:** `boxShadow: 'none'`, `borderRadius: '8px'`
- **Цвета:** минималистичная палитра
- **Формы:** все поля с `borderRadius: '8px'`

### Применено в компонентах ✅
- ✅ **TransactionsPage** - эталонный компонент
- ✅ **CategoriesPage** - полностью переделан в табличный стиль
- ✅ **LegalEntitiesPage** - обновлена структура столбцов
- ✅ **CounterpartiesPage** - добавлен ColumnSelector
- ✅ **PositionsPage** - полностью в новом стиле
- ✅ **AccountGroupsPage** - исправлены синтаксические ошибки
- ✅ **Все формы** - применен единый borderRadius: 8px

### Новые UI компоненты ✅
```typescript
// ColumnSelector компонент
- Popover интерфейс для выбора видимых столбцов
- Сохранение настроек в localStorage
- Обязательные/опциональные столбцы
- Массовое включение/выключение столбцов
```

## 🏗 Архитектурные решения

### Система прав доступа (ВАЖНО!)
```
Финальная архитектура после рефакторинга:
User → UserAssignment → Position → PositionPermissions

УДАЛЕНЫ (устаревшие поля):
- User.role 
- User.roleType
- UserAssignment.role_type
- UserAssignment.permissions

ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВ:
- position_permissions таблица
- accessLevel: 'read' | 'write' | 'full'
- objectType: 'accounts', 'transactions', 'categories', etc.
```

### Структура проекта
```
src/
├── components/
│   ├── Positions/ (✅ ОБНОВЛЕНО - новый дизайн)
│   ├── Organization/ (✅ ОБНОВЛЕНО - PositionForm)
│   ├── Transactions/ (эталон дизайна)
│   ├── Categories/ (✅ ПЕРЕДЕЛАНО - табличный стиль)
│   ├── Counterparties/ (✅ ДОБАВЛЕН ColumnSelector)
│   └── Common/PermissionGuard (защита действий)
├── context/
│   └── services/ (✅ все сервисы обновлены)
└── types/ (✅ очищены от устаревших полей)
```

## 🗄 База данных

### Ключевые таблицы
```sql
-- Организационная структура
organizations (id, name, owner_id, settings, public_id)
legal_entities (id, organization_id, name, inn, kpp..., public_id)
positions (id, organization_id, legal_entity_id, name, public_id)
position_permissions (id, position_id, object_type, access_level, public_id)

-- Пользователи  
users (id, full_name, email, organization_id, position_id, legal_entity_id)
user_assignments (id, user_id, organization_id, position_id, legal_entity_id, public_id)

-- Финансы
accounts (id, organization_id, legal_entity_id, name..., public_id)
categories (id, organization_id, name..., public_id)
transactions (id, organization_id, account_id, amount..., public_id)
counterparties (id, organization_id, name..., public_id)
account_groups, category_groups, counterparty_groups (все с public_id)
```

### 🚀 API Стандарт (ВАЖНО!)
**Все новые таблицы ОБЯЗАТЕЛЬНО должны содержать поле public_id:**
```sql
ALTER TABLE table_name ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_table_name_public_id ON table_name(public_id);
COMMENT ON COLUMN table_name.public_id IS 'Глобальный автоинкрементный ID для API';
```

**Причины использования public_id:**
- ✅ **Простота API:** `/api/transactions/127` вместо UUID
- ✅ **Безопасность:** UUID остаются внутренними, RLS контролирует доступ  
- ✅ **Производительность:** SERIAL индексы работают быстрее UUID
- ✅ **UX:** Администраторы могут легко ссылаться на записи

### Важные миграции
- `20250107000003_simplify_user_assignments.sql` - удаление role_type
- `20250107000002_fix_init_user_function.sql` - исправление функции инициализации
- `20250107000004_update_init_user_with_business_data.sql` - бизнес-данные при регистрации
- `20250607000003_fix_search_path_security.sql` - **БЕЗОПАСНОСТЬ**: исправление search_path ✅

## 🔧 Сервисы

### Обновленные сервисы
```typescript
// Новый сервис для прав должностей
SupabasePositionPermissionService
├── getPositionPermissions(positionId)
├── addPositionPermission(permission)
├── deletePositionPermission(id)
└── setPositionPermissions(positionId, permissions[])

// Обновленные сервисы (убраны role_type поля)
SupabaseUserAssignmentService
SupabasePositionService  
SupabaseUserService
```

## 🛡 Безопасность

### PermissionGuard
```tsx
<PermissionGuard objectType="positions" level="write">
  <Button>Действие требующее прав</Button>
</PermissionGuard>
```

### RLS Policies
- Все данные фильтруются по organization_id
- Права проверяются через position_permissions
- Пользователи видят только данные своей организации

### Функции PostgreSQL (ИСПРАВЛЕНО)
- **Все функции защищены** `SET search_path = ''` ✅
- **Security Definer** включен для всех критических функций ✅
- **Предотвращены атаки** типа "schema poisoning" ✅

## 🚀 Рабочие процессы

### Разработка
```bash
# Компиляция TypeScript
npx tsc --noEmit

# Запуск приложения  
npm start

# Миграции базы данных
# Файлы в supabase/migrations/

# Настройка локальной разработки
cd supabase && supabase start
```

### ⚠️ Важные настройки для локальной разработки
В `supabase/config.toml` должно быть установлено:
```toml
[auth.email]
enable_confirmations = false  # Отключает подтверждение email
```
Это необходимо для удобной регистрации в локальной среде без необходимости подтверждать email.

### Тестирование
- **Тестовый пользователь:** admin@test.com / admin123
- **Организация:** "Моя компания" (создается автоматически)
- **Юрлицо:** "Мой первый бизнес"
- **Должность:** "Владелец" с полными правами

## 📋 Последние изменения (Июнь 2025)

### ✅ UI/UX Улучшения
1. **Единые стандарты дизайна** - `DESIGN_STANDARDS` в constants.ts
2. **Переделка CategoriesPage** - с карточек на таблицу, убран столбец "Действия"
3. **Обновление LegalEntitiesPage** - новая структура столбцов (полное имя + ИНН)
4. **Добавление ColumnSelector** - выбор видимых столбцов в CounterpartiesPage
5. **Исправление форм** - единый borderRadius: 8px во всех формах
6. **Убраны кнопки "Отмена"** - в TransactionForm и LegalEntityForm

### ✅ Интеграции
1. **Jivo чат-виджет** - добавлен скрипт в `public/index.html`
2. **Мета-теги** - обновлены для SEO

### ✅ Исправления багов
1. **AccountGroupsPage синтаксическая ошибка** - исправлена отсутствующая `{`
2. **Цветные индикаторы** - уменьшены с 16px до 8px для единообразия
3. **Пропорции столбцов** - обновлены для лучшего использования пространства

### 🔄 В работе
1. **UsersPage рефакторинг** - приведение к стилю TransactionsPage
2. **Формы должностей** - добавление функциональности
3. **Система приглашений** - отправка и отслеживание статуса

## 💡 Важные паттерны

### Структура компонентов страниц
```tsx
const SomePage: React.FC = () => {
  // 1. Состояния
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  
  // 2. Поиск и кнопки
  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
    <TextField placeholder="Поиск..." />
    <Box sx={{ display: 'flex', gap: 2 }}>
      <Button>Действие</Button>
    </Box>
  </Box>
  
  // 3. Таблица с пагинацией
  <Paper sx={{ borderRadius: '8px', border: '1px solid #F3F4F6' }}>
    <Table stickyHeader>...</Table>
    <TablePagination />
  </Paper>
  
  // 4. Сайдбары и диалоги
  <RightSidebar />
  <ConfirmDialog />
};
```

### Стили кнопок и форм
```tsx
// Кнопки
sx={{
  borderRadius: '8px',
  boxShadow: 'none',
  height: '40px'
}}

// Поля форм
sx={{
  '& .MuiOutlinedInput-root': {
    borderRadius: '8px',
  }
}}
```

## 🎯 Следующие этапы

### Приоритетные задачи
1. **UsersPage рефакторинг** - привести к единому стилю
2. **Система приглашений** - email уведомления
3. **Должности и права** - улучшенная форма назначения
4. **Мобильная адаптация** - адаптивный дизайн

### Технический долг
1. **Оптимизация производительности** - lazy loading компонентов
2. **Тестирование** - unit тесты для ключевых компонентов
3. **Документация** - API документация
4. **Интернационализация** - поддержка других языков 

# Cursor's Memory Bank для Финансового Трекера

## Обзор проекта
**Finance Tracker** - мультитенантная система финансового учета с иерархической структурой: Организация → Юридические лица → Позиции → Сотрудники.

## Текущая архитектура

### База данных (PostgreSQL + Supabase)
- **UUID-based**: Все сущности используют UUID как первичные ключи
- **Public ID**: Добавлены SERIAL public_id для простых API endpoints  
- **RLS (Row Level Security)**: Все таблицы защищены на уровне организации
- **Мультитенантность**: Полная изоляция данных между организациями

### API архитектура
- **Внутренняя**: UUID для всех связей и референсов
- **Внешняя**: Простые целочисленные ID (GET /api/transactions/127)
- **Автоматическая безопасность**: RLS обеспечивает фильтрацию по организации

### Основные таблицы
1. **organizations** - организации (владельцы аккаунтов)
2. **users** - пользователи системы
3. **legal_entities** - юридические лица внутри организации  
4. **positions** - должности в компании
5. **employees** - сотрудники (включая владельцев)
6. **user_assignments** - назначения пользователей на позиции
7. **accounts** - финансовые счета
8. **categories** - категории доходов/расходов
9. **transactions** - финансовые операции
10. **counterparties** - контрагенты

## Ключевые особенности

### Система прав
- **Через должности**: Права назначаются позициям, а не пользователям напрямую
- **Гранулярные права**: read/write/full для каждого типа объектов
- **Автоматические права владельца**: При создании организации владелец получает полные права

### RLS Performance
- **Оптимизировано**: Количество политик сокращено с 64 до 12
- **Indexed**: Все поля для RLS проиндексированы
- **Set search_path**: Безопасные функции с ограниченным search_path

### Инициализация пользователя
- **Автоматическая**: При регистрации создается полная организационная структура
- **Базовые данные**: 3 счета, 10 категорий, 3 группы контрагентов
- **Запись сотрудника**: Владелец автоматически добавляется в список сотрудников

## UI/UX Components

### Формы
- **EmployeeFormSimplified**: Упрощенная форма сотрудников с полем "пол"
- **Убраны поля**: Фотография, Telegram ID, Статус, Дата рождения, Примечания
- **Современный дизайн**: Material-UI с закругленными углами и красивыми эффектами

### Сотрудники  
- **Владелец видим**: Исправлена функция инициализации для создания employee record
- **Поле "пол"**: Добавлено в БД и форму (male/female)
- **Статусы**: invited, active, suspended, terminated

### Константы дизайна
```typescript
DESIGN_STANDARDS = {
  BORDER_RADIUS: '8px',
  COMPONENT_SPACING: 2
}
```

## Процессы и workflow

### Регистрация нового пользователя
1. Supabase Auth создает пользователя
2. Функция `init_user_full_setup()` инициализирует:
   - Запись в `users`
   - Организацию с владельцем  
   - Юридическое лицо
   - Должность "Владелец"
   - **Запись сотрудника для владельца**
   - Права для должности
   - Базовые счета и категории

### Добавление сотрудника
1. Упрощенная форма: имя, фамилия, email, телефон, пол
2. Обязательные поля: должность, заведение
3. Автоматический статус: "invited"
4. Создание записи через `SupabaseEmployeeService`

## Технические детали

### Миграции
- **Последняя**: `20250608000002_add_gender_and_fix_employee_creation.sql`
- **Содержит**: Поле gender + исправление функции инициализации
- **Безопасно**: Условные операции для несуществующих таблиц

### TypeScript типы
```typescript
type Gender = 'male' | 'female';

interface Employee {
  // ... основные поля
  gender?: Gender;
  // ... остальные поля
}
```

### Сервисы
- **SupabaseEmployeeService**: CRUD операции для сотрудников
- **Поддержка gender**: В CreateEmployeeData и mapFromDatabase

## Стандарты разработки

### Новые таблицы должны включать:
1. `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
2. `public_id SERIAL UNIQUE` для API
3. `organization_id UUID` для мультитенантности  
4. `created_at TIMESTAMP DEFAULT NOW()`
5. `updated_at TIMESTAMP DEFAULT NOW()`
6. Соответствующие RLS политики

### API endpoints должны:
1. Использовать public_id во внешних URL
2. Возвращать publicId в JSON responses
3. Внутренне работать только с UUID
4. Полагаться на RLS для безопасности

## Текущий статус

**База данных**: ✅ Работает  
**API архитектура**: ✅ Настроена  
**UI компоненты**: ✅ Обновлены  
**Миграции**: ✅ Применены  
**Сотрудники**: ✅ Владелец отображается  
**Форма**: ✅ Упрощена с полем "пол"  

## Последние изменения (2025-06-08)

### ✅ Задача: Владелец не отображается в сотрудниках
**Решение**: Исправлена функция `init_user_full_setup()` для создания employee record

### ✅ Задача: Упростить форму сотрудника  
**Решение**: Создана `EmployeeFormSimplified` без ненужных полей

### ✅ Задача: Добавить поле "пол"
**Решение**: Добавлена колонка `gender` в таблицу employees + TypeScript типы

### Технические детали
- Создана миграция `20250608000002_add_gender_and_fix_employee_creation.sql`
- Обновлен `SupabaseEmployeeService` для работы с gender
- Заменен `EmployeeForm` на `EmployeeFormSimplified` в `UsersPage`
- Добавлен тип `Gender = 'male' | 'female'` в types/index.ts

### Тестирование
- Создан тестовый пользователь `test@example.com`
- Проверена полная цепочка: Auth → User → Organization → Employee  
- Владелец корректно отображается в списке сотрудников со статусом "active"

## Следующие шаги

### Приоритет 1: Тестирование
1. Полное тестирование формы сотрудников
2. Проверка всех статусов и переходов  
3. Тестирование UI/UX на разных экранах

### Приоритет 2: API Development
1. Создание REST endpoints с public_id
2. Документация API  
3. Тестирование производительности

### Приоритет 3: Улучшения
1. Фотографии сотрудников (upload в Supabase Storage)
2. Расширенная система уведомлений
3. Экспорт данных сотрудников
4. Интернационализация форм 