/**
 * Утилиты для оптимизации производительности приложения
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Хук для дебаунсинга значений
 * Оптимизирует поиск и фильтрацию для больших списков
 */
export const useDebounce = <T>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Хук для дебаунсинга функций
 * Предотвращает частые вызовы дорогих операций
 */
export const useDebouncedCallback = <T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T => {
  const ref = useRef<NodeJS.Timeout | null>(null);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (ref.current) {
        clearTimeout(ref.current);
      }

      ref.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  ) as T;

  return debouncedCallback;
};

/**
 * Хук для виртуализации списков
 * Оптимизирует отрисовку больших списков
 */
export const useVirtualization = (
  items: any[],
  containerHeight: number = 400,
  itemHeight: number = 48
) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLElement | null>(null);

  // Вычисляем видимый диапазон
  const visibleRange = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.min(
      visibleStart + Math.ceil(containerHeight / itemHeight) + 2, // +2 для буфера
      items.length - 1
    );

    return {
      start: Math.max(0, visibleStart - 2), // -2 для буфера
      end: Math.min(items.length - 1, visibleEnd + 2), // +2 для буфера
    };
  }, [scrollTop, itemHeight, containerHeight, items.length]);

  // Видимые элементы
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end + 1);
  }, [items, visibleRange]);

  // Обработчик скролла
  const handleScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  // Высоты для правильного отображения скролла
  const totalHeight = items.length * itemHeight;
  const offsetY = visibleRange.start * itemHeight;

  return {
    visibleItems,
    visibleRange,
    totalHeight,
    offsetY,
    handleScroll,
    containerRef,
    shouldVirtualize: items.length > 100, // Виртуализация для списков больше 100 элементов
  };
};

/**
 * Хук для мемоизации дорогих вычислений
 * Кэширует результаты до изменения зависимостей
 */
export const useExpensiveComputation = <T>(
  computeFn: () => T,
  deps: React.DependencyList
): T => {
  return useMemo(computeFn, deps);
};

/**
 * Хук для ленивой загрузки данных
 * Загружает данные только когда они нужны
 */
export const useLazyLoad = <T>(
  loadFn: () => Promise<T>,
  deps: React.DependencyList = []
) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const result = await loadFn();
      setData(result);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [loadFn, loading]);

  useEffect(() => {
    load();
  }, [load, ...deps]);

  return { data, loading, error, reload: load };
};

/**
 * Утилита для проверки должна ли использоваться виртуализация
 */
export const shouldUseVirtualization = (itemsCount: number, threshold: number = 100): boolean => {
  return itemsCount > threshold;
};

/**
 * Кэш для мемоизации дорогих операций
 */
class PerformanceCache {
  private cache = new Map<string, { value: any; timestamp: number }>();
  private maxSize: number;
  private ttl: number; // time to live в миллисекундах

  constructor(maxSize: number = 1000, ttl: number = 5 * 60 * 1000) { // 5 минут по умолчанию
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) return null;
    
    // Проверяем не истек ли TTL
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  set<T>(key: string, value: T): void {
    // Очищаем старые записи если кэш переполнен
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export const performanceCache = new PerformanceCache();

/**
 * Хук для кэширования результатов функций
 */
export const useCachedFunction = <T extends (...args: any[]) => any>(
  fn: T,
  keyGenerator: (...args: Parameters<T>) => string
): T => {
  return useCallback(
    ((...args: Parameters<T>) => {
      const key = keyGenerator(...args);
      let result = performanceCache.get<ReturnType<T>>(key);
      
      if (result === null) {
        result = fn(...args);
        performanceCache.set(key, result);
      }
      
      return result;
    }) as T,
    [fn, keyGenerator]
  );
};

/**
 * Утилита для батчинга операций
 * Группирует множественные операции в одну для оптимизации
 */
export class BatchProcessor<T> {
  private batch: T[] = [];
  private timeout: NodeJS.Timeout | null = null;
  private processFn: (items: T[]) => void;
  private delay: number;

  constructor(processFn: (items: T[]) => void, delay: number = 100) {
    this.processFn = processFn;
    this.delay = delay;
  }

  add(item: T): void {
    this.batch.push(item);

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(() => {
      this.flush();
    }, this.delay);
  }

  flush(): void {
    if (this.batch.length > 0) {
      this.processFn([...this.batch]);
      this.batch = [];
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}

/**
 * Хук для отслеживания производительности компонента
 */
export const usePerformanceMonitor = (componentName: string) => {
  const renderCount = useRef(0);
  const startTime = useRef(performance.now());

  useEffect(() => {
    renderCount.current++;
    const endTime = performance.now();
    const renderTime = endTime - startTime.current;

    // Логируем только если рендер занял больше 16мс (60fps)
    if (renderTime > 16) {
      console.warn(
        `🐌 Медленный рендер ${componentName}: ${renderTime.toFixed(2)}мс (рендер #${renderCount.current})`
      );
    }

    startTime.current = performance.now();
  }, [componentName]);

  return {
    renderCount: renderCount.current,
  };
}; 