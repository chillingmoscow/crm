import React from 'react';
import { CATEGORY_COLORS } from './constants';
import { v4 as uuidv4 } from 'uuid';

/**
 * Утилитарные функции
 */

// Функция для генерации случайного цвета категории
export const generateRandomColor = (): string => {
  return CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)].value;
};

// Функция для форматирования суммы с учетом валюты
export const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency,
    signDisplay: 'never'
  }).format(Math.abs(amount));
};

// Функция для форматирования даты
export const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString('ru-RU');
};

// Функция для форматирования даты и времени
export const formatDateTime = (date: Date): string => {
  return new Date(date).toLocaleString('ru-RU', { 
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Функция для форматирования размера файла
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' байт';
  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  else return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
};

// Функция для преобразования текста с URL в кликабельные ссылки
export const linkify = (text: string): (string | React.ReactElement)[] => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return React.createElement('a', {
        key: i,
        href: part,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: { color: '#6364FF', textDecoration: 'underline' },
        onClick: (e: React.MouseEvent) => e.stopPropagation()
      }, part);
    }
    return part;
  });
};

// Функция для безопасной проверки вхождения подстроки
export const safeIncludes = (text: string | undefined | null, query: string): boolean => {
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
};

// Функция для дебаунса
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Утилитарные функции для получения данных по ID
export const createGetterFunctions = <T extends { id: string }>(items: T[]) => ({
  getById: (id: string) => items.find(item => item.id === id),
  getByIds: (ids: string[]) => items.filter(item => ids.includes(item.id))
});

// Генерация уникального идентификатора
export const generateId = (): string => {
  return uuidv4();
}; 