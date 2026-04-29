/**
 * Утилиты для форматирования данных в приложении
 */

/**
 * Форматирует дату в локальный формат
 * @param date Дата для форматирования
 * @returns Отформатированная дата
 */
export const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString('ru-RU');
};

/**
 * Форматирует дату и время
 * @param date Дата для форматирования
 * @returns Отформатированные дата и время
 */
export const formatDateTime = (date: Date): string => {
  return new Date(date).toLocaleString('ru-RU', { 
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Форматирует время
 * @param date Дата для форматирования
 * @returns Отформатированное время
 */
export const formatTime = (date: Date): string => {
  return new Date(date).toLocaleTimeString('ru-RU', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

/**
 * Форматирует денежную сумму в указанной валюте
 * @param amount Сумма для форматирования
 * @param currency Валюта (по умолчанию RUB)
 * @returns Отформатированная денежная сумма
 */
export const formatAmount = (amount: number, currency = 'RUB'): string => {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
  }).format(amount);
};

/**
 * Возвращает инициалы из полного имени
 * @param fullName Полное имя
 * @returns Инициалы (до 2 символов)
 */
export const getInitials = (fullName: string): string => {
  return fullName
    .split(' ')
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
}; 