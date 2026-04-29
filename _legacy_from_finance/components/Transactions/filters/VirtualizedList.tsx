import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, List } from '@mui/material';

interface VirtualizedListProps {
  items: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  itemHeight?: number;
  containerHeight?: number;
  overscan?: number;
}

/**
 * Виртуализированный список для оптимизации производительности
 * при отображении больших объемов данных
 */
const VirtualizedList: React.FC<VirtualizedListProps> = ({
  items,
  renderItem,
  itemHeight = 36,
  containerHeight = 300,
  overscan = 5
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Вычисляем видимый диапазон элементов
  const visibleRange = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.min(
      visibleStart + Math.ceil(containerHeight / itemHeight),
      items.length - 1
    );

    return {
      start: Math.max(0, visibleStart - overscan),
      end: Math.min(items.length - 1, visibleEnd + overscan)
    };
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan]);

  // Видимые элементы
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end + 1);
  }, [items, visibleRange]);

  // Обработчик скролла
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  // Общая высота всего списка
  const totalHeight = items.length * itemHeight;

  // Высота отступа сверху (для элементов, которые не отображаются)
  const offsetY = visibleRange.start * itemHeight;

  return (
    <Box
      ref={containerRef}
      sx={{
        height: containerHeight,
        overflowY: 'auto',
        position: 'relative'
      }}
      onScroll={handleScroll}
    >
      {/* Общий контейнер для поддержания высоты скролла */}
      <Box sx={{ height: totalHeight, position: 'relative' }}>
        {/* Видимые элементы */}
        <Box
          sx={{
            position: 'absolute',
            top: offsetY,
            width: '100%'
          }}
        >
          <List dense sx={{ p: 0 }}>
            {visibleItems.map((item, index) =>
              renderItem(item, visibleRange.start + index)
            )}
          </List>
        </Box>
      </Box>
    </Box>
  );
};

export default VirtualizedList; 