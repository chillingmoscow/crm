// Утилиты для фильтров транзакций

import { FilterItem, FilterGroup } from './types';
import { SPECIAL_FILTER_IDS, FILTER_GROUP_IDS } from './constants';

/**
 * Сортирует элементы по алфавиту
 */
export const sortItemsAlphabetically = (items: FilterItem[]): FilterItem[] => {
  return items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
};

/**
 * Сортирует группы по алфавиту
 */
export const sortGroupsAlphabetically = (groups: FilterGroup[]): FilterGroup[] => {
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
};

/**
 * Проверяет, является ли элемент специальным (Без статьи/Без контрагента)
 */
export const isSpecialItem = (item: FilterItem): boolean => {
  return item.id === SPECIAL_FILTER_IDS.NO_CATEGORY || 
         item.id === SPECIAL_FILTER_IDS.NO_COUNTERPARTY;
};

/**
 * Группирует элементы фильтра с правильной сортировкой
 * Специальные элементы всегда идут первыми без группировки
 */
export const groupFilterItems = (
  items: FilterItem[], 
  groups: FilterGroup[]
): Record<string, FilterItem[]> => {
  const result: Record<string, FilterItem[]> = {};
  
  // Если нет групп, возвращаем все элементы в одной группе
  if (groups.length === 0) {
    result[FILTER_GROUP_IDS.ALL] = sortItemsAlphabetically(items);
    return result;
  }

  // Специальные элементы всегда идут первыми отдельно
  const specialItems = items.filter(isSpecialItem);
  
  // Обычные элементы (исключаем специальные)
  const regularItems = items.filter(item => !isSpecialItem(item));
  
  // Сортированные группы
  const sortedGroups = sortGroupsAlphabetically(groups);
  
  // Группируем обычные элементы по группам
  sortedGroups.forEach(group => {
    const groupItems = regularItems.filter(item => item.groupId === group.id);
    if (groupItems.length > 0) {
      result[group.id] = sortItemsAlphabetically(groupItems);
    }
  });

  // Элементы без группы в конце (только из обычных элементов)
  const ungroupedItems = regularItems.filter(item => !item.groupId);
  if (ungroupedItems.length > 0) {
    result[FILTER_GROUP_IDS.UNGROUPED] = sortItemsAlphabetically(ungroupedItems);
  }

  // Добавляем специальные элементы в начало только если они есть
  if (specialItems.length > 0) {
    // Создаем новый объект с правильным порядком
    const orderedResult: Record<string, FilterItem[]> = {};
    orderedResult[FILTER_GROUP_IDS.SPECIAL] = specialItems;
    
    // Добавляем остальные группы
    Object.keys(result).forEach(key => {
      orderedResult[key] = result[key];
    });
    
    return orderedResult;
  }

  return result;
};

/**
 * Подготавливает данные для фильтра категорий
 */
export const prepareCategoriesForFilter = (categories: any[]): FilterItem[] => {
  return [
    { id: SPECIAL_FILTER_IDS.NO_CATEGORY, name: 'Без статьи' },
    ...categories.map(category => ({
      id: category.id,
      name: category.name,
      groupId: category.groupId
    }))
  ];
};

/**
 * Подготавливает данные для фильтра контрагентов
 */
export const prepareCounterpartiesForFilter = (counterparties: any[]): FilterItem[] => {
  return [
    { id: SPECIAL_FILTER_IDS.NO_COUNTERPARTY, name: 'Без контрагента' },
    ...counterparties.map(counterparty => ({
      id: counterparty.id,
      name: counterparty.name,
      groupId: counterparty.groupId
    }))
  ];
};

/**
 * Подготавливает данные для фильтра счетов
 */
export const prepareAccountsForFilter = (accounts: any[]): FilterItem[] => {
  return accounts.map(account => ({
    id: account.id,
    name: account.name,
    groupId: account.groupId
  }));
};

/**
 * Проверяет наличие активных фильтров
 */
export const hasActiveFilters = (filters: any): boolean => {
  return (
    filters.dateRange.start !== null || 
    filters.dateRange.end !== null ||
    filters.type !== 'all' ||
    filters.accountIds.length > 0 ||
    filters.categoryIds.length > 0 ||
    filters.counterpartyIds.length > 0 ||
    filters.amountRange.min !== null ||
    filters.amountRange.max !== null
  );
};

/**
 * Подсчитывает количество активных фильтров
 */
export const getActiveFiltersCount = (filters: any): number => {
  let count = 0;
  if (filters.dateRange.start !== null || filters.dateRange.end !== null) count++;
  if (filters.type !== 'all') count++;
  if (filters.accountIds.length > 0) count++;
  if (filters.categoryIds.length > 0) count++;
  if (filters.counterpartyIds.length > 0) count++;
  if (filters.amountRange.min !== null || filters.amountRange.max !== null) count++;
  return count;
};

// === Функции оптимизации ===

/**
 * Кэш для результатов группировки
 */
const groupingCache = new Map<string, Record<string, FilterItem[]>>();

/**
 * Создает ключ для кэширования группировки
 */
const createCacheKey = (items: FilterItem[], groups: FilterGroup[]): string => {
  const itemsKey = items.map(item => `${item.id}-${item.groupId || 'none'}`).join('|');
  const groupsKey = groups.map(group => group.id).join('|');
  return `${itemsKey}::${groupsKey}`;
};

/**
 * Группирует элементы с кэшированием для оптимизации
 */
export const groupFilterItemsWithCache = (
  items: FilterItem[], 
  groups: FilterGroup[]
): Record<string, FilterItem[]> => {
  const cacheKey = createCacheKey(items, groups);
  
  if (groupingCache.has(cacheKey)) {
    return groupingCache.get(cacheKey)!;
  }
  
  const result = groupFilterItems(items, groups);
  groupingCache.set(cacheKey, result);
  
  // Ограничиваем размер кэша
  if (groupingCache.size > 50) {
    const firstKey = Array.from(groupingCache.keys())[0];
    if (firstKey) {
      groupingCache.delete(firstKey);
    }
  }
  
  return result;
};

/**
 * Очищает кэш группировки
 */
export const clearGroupingCache = (): void => {
  groupingCache.clear();
};

/**
 * Создает дебаунсированную функцию
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

/**
 * Проверяет, нужна ли виртуализация для списка
 */
export const shouldUseVirtualization = (itemsCount: number): boolean => {
  return itemsCount > 100; // Включаем виртуализацию для списков больше 100 элементов
};

/**
 * Фильтрует элементы по поисковому запросу
 */
export const filterItemsBySearch = (items: FilterItem[], searchQuery: string): FilterItem[] => {
  if (!searchQuery.trim()) return items;
  
  const query = searchQuery.toLowerCase().trim();
  return items.filter(item =>
    item.name.toLowerCase().includes(query)
  );
}; 