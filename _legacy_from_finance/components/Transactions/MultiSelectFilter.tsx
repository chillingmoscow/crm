import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Button,
  TextField,
  Popover,
  Typography,
  Checkbox,
  FormControlLabel,
  List,
  ListItem,
  Divider,
  Chip,
  IconButton
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';

import { MultiSelectFilterProps } from './filters/types';
import { 
  groupFilterItemsWithCache, 
  isSpecialItem,
  debounce,
  shouldUseVirtualization,
  filterItemsBySearch
} from './filters/utils';
import { FILTER_GROUP_IDS } from './filters/constants';
import VirtualizedList from './filters/VirtualizedList';

/**
 * Компонент мультивыбора с группировкой, поиском и оптимизациями
 */
const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({
  title,
  placeholder,
  items,
  groups = [],
  selectedIds,
  onChange,
  onClear,
  showApplyButton = true
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  const open = Boolean(anchorEl);

  // Дебаунсированная функция для поиска
  const debouncedSearch = useMemo(
    () => debounce((query: string) => {
      setDebouncedSearchQuery(query);
    }, 300),
    []
  );

  // Фильтрация элементов по поисковому запросу
  const filteredItems = useMemo(() => {
    return filterItemsBySearch(items, debouncedSearchQuery);
  }, [items, debouncedSearchQuery]);

  // Группировка элементов с кэшированием
  const groupedItems = useMemo(() => {
    return groupFilterItemsWithCache(filteredItems, groups);
  }, [filteredItems, groups]);

  // Проверяем, нужна ли виртуализация
  const useVirtualization = useMemo(() => {
    const totalItems = Object.values(groupedItems).reduce((sum, items) => sum + items.length, 0);
    return shouldUseVirtualization(totalItems);
  }, [groupedItems]);

  // === Обработчики событий ===
  
  const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
    setSearchQuery('');
    setDebouncedSearchQuery('');
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleClear = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onClear?.();
  }, [onClear]);

  const handleSelectAll = useCallback(() => {
    const allIds = items.map(item => item.id);
    onChange(allIds);
  }, [items, onChange]);

  const handleDeselectAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  const handleItemToggle = useCallback((itemId: string) => {
    const newSelectedIds = selectedIds.includes(itemId)
      ? selectedIds.filter(id => id !== itemId)
      : [...selectedIds, itemId];
    onChange(newSelectedIds);
  }, [selectedIds, onChange]);

  const handleGroupToggle = useCallback((groupId: string) => {
    const groupItems = groupedItems[groupId] || [];
    const groupItemIds = groupItems.map(item => item.id);
    const allGroupSelected = groupItemIds.every(id => selectedIds.includes(id));

    if (allGroupSelected) {
      // Снимаем выбор со всей группы
      const newSelectedIds = selectedIds.filter(id => !groupItemIds.includes(id));
      onChange(newSelectedIds);
    } else {
      // Выбираем всю группу
      const newSelectedIds = Array.from(new Set([...selectedIds, ...groupItemIds]));
      onChange(newSelectedIds);
    }
  }, [groupedItems, selectedIds, onChange]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    debouncedSearch(value);
  }, [debouncedSearch]);

  // === Вспомогательные функции ===

  const isGroupSelected = useCallback((groupId: string) => {
    const groupItems = groupedItems[groupId] || [];
    if (groupItems.length === 0) return false;
    return groupItems.every(item => selectedIds.includes(item.id));
  }, [groupedItems, selectedIds]);

  const isGroupIndeterminate = useCallback((groupId: string) => {
    const groupItems = groupedItems[groupId] || [];
    if (groupItems.length === 0) return false;
    const selectedCount = groupItems.filter(item => selectedIds.includes(item.id)).length;
    return selectedCount > 0 && selectedCount < groupItems.length;
  }, [groupedItems, selectedIds]);

  const getButtonText = useMemo(() => {
    if (selectedIds.length === 0) return placeholder;
    if (selectedIds.length === 1) {
      const item = items.find(i => i.id === selectedIds[0]);
      return item?.name || placeholder;
    }
    return `Выбрано: ${selectedIds.length}`;
  }, [selectedIds, items, placeholder]);

  // === Рендер компонентов ===

  const renderListItem = useCallback((item: any, index?: number) => (
    <ListItem
      key={item.id}
      sx={{ 
        p: 0, 
        cursor: 'pointer',
        '&:hover': { backgroundColor: '#F5F5F5' },
        borderRadius: '4px'
      }}
      onClick={() => handleItemToggle(item.id)}
    >
      <FormControlLabel
        control={
          <Checkbox
            checked={selectedIds.includes(item.id)}
            size="small"
          />
        }
        label={item.name}
        sx={{ ml: 0, mr: 0, width: '100%' }}
      />
    </ListItem>
  ), [selectedIds, handleItemToggle]);

  const renderGroup = useCallback((groupId: string, groupItems: any[], group?: any, isUngrouped = false) => {
    if (groupItems.length === 0) return null;

    return (
      <Box key={groupId}>
        {/* Заголовок группы (не показываем для ungrouped и special) */}
        {groups.length > 0 && !isUngrouped && groupId !== FILTER_GROUP_IDS.SPECIAL && (
          <FormControlLabel
            control={
              <Checkbox
                checked={isGroupSelected(groupId)}
                indeterminate={isGroupIndeterminate(groupId)}
                onChange={() => handleGroupToggle(groupId)}
                size="small"
              />
            }
            label={
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {group?.name}
              </Typography>
            }
            sx={{ mb: 0, ml: 0 }}
          />
        )}

        {/* Элементы группы */}
        {useVirtualization && groupItems.length > 50 ? (
          <VirtualizedList
            items={groupItems}
            renderItem={renderListItem}
            itemHeight={36}
            containerHeight={Math.min(200, groupItems.length * 36)}
          />
        ) : (
          <List dense sx={{ ml: groups.length > 0 && !isUngrouped && groupId !== FILTER_GROUP_IDS.SPECIAL ? 2 : 0 }}>
            {groupItems.map(renderListItem)}
          </List>
        )}
      </Box>
    );
  }, [groups.length, isGroupSelected, isGroupIndeterminate, handleGroupToggle, useVirtualization, renderListItem]);

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        variant="outlined"
        onClick={handleClick}
        endIcon={selectedIds.length > 0 ? null : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
        sx={{
          borderRadius: '20px',
          backgroundColor: selectedIds.length > 0 ? '#E3F2FD' : '#F3F4F6',
          borderColor: selectedIds.length > 0 ? '#1976D2' : 'transparent',
          color: selectedIds.length > 0 ? '#1976D2' : 'text.secondary',
          textTransform: 'none',
          fontSize: '0.875rem',
          minHeight: 'auto',
          py: 0.5,
          px: 2,
          pr: selectedIds.length > 0 ? 6 : 2,
          justifyContent: 'space-between',
          minWidth: 140,
          '&:hover': {
            borderColor: selectedIds.length > 0 ? '#1976D2' : 'transparent',
            backgroundColor: selectedIds.length > 0 ? '#BBDEFB' : '#E5E7EB'
          }
        }}
      >
        {getButtonText}
      </Button>

      {/* Крестик для сброса */}
      {selectedIds.length > 0 && onClear && (
        <IconButton
          size="small"
          onClick={handleClear}
          sx={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 18,
            height: 18,
            backgroundColor: '#1976D2',
            color: 'white',
            '&:hover': {
              backgroundColor: '#1565C0'
            },
            '& .MuiSvgIcon-root': {
              fontSize: 14
            }
          }}
        >
          <CloseIcon />
        </IconButton>
      )}

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        sx={{
          '& .MuiPaper-root': {
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
            minWidth: 300,
            maxWidth: 400,
            maxHeight: 500
          }
        }}
      >
        <Box sx={{ p: 2 }}>
          {/* Заголовок */}
          {title && (
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              {title}
            </Typography>
          )}

          {/* Поиск с дебаунсингом */}
          <TextField
            fullWidth
            size="small"
            placeholder={`Поиск по ${placeholder.toLowerCase()}...`}
            value={searchQuery}
            onChange={handleSearchChange}
            InputProps={{
              startAdornment: <SearchIcon sx={{ color: 'text.secondary', fontSize: 18, mr: 1 }} />
            }}
            sx={{ mb: 2 }}
          />

          {/* Кнопки управления */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Chip
              label="Выбрать все"
              onClick={handleSelectAll}
              size="small"
              variant="outlined"
              sx={{ cursor: 'pointer' }}
            />
            <Chip
              label="Снять все"
              onClick={handleDeselectAll}
              size="small"
              variant="outlined"
              sx={{ cursor: 'pointer' }}
            />
          </Box>

          {/* Список элементов */}
          <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
            {/* Специальные элементы первыми БЕЗ группировки */}
            {groupedItems[FILTER_GROUP_IDS.SPECIAL] && (
              <>
                {renderGroup(FILTER_GROUP_IDS.SPECIAL, groupedItems[FILTER_GROUP_IDS.SPECIAL])}
                {Object.keys(groupedItems).length > 1 && <Divider sx={{ my: 1 }} />}
              </>
            )}

            {/* Обычные группы */}
            {Object.entries(groupedItems)
              .filter(([groupId]) => groupId !== FILTER_GROUP_IDS.SPECIAL && groupId !== FILTER_GROUP_IDS.ALL)
              .map(([groupId, groupItems], index, array) => {
                const group = groups.find(g => g.id === groupId);
                const isUngrouped = groupId === FILTER_GROUP_IDS.UNGROUPED;
                const isLastGroup = index === array.length - 1;

                return (
                  <React.Fragment key={groupId}>
                    {renderGroup(groupId, groupItems, group, isUngrouped)}
                    {groups.length > 0 && !isLastGroup && <Divider sx={{ my: 1 }} />}
                  </React.Fragment>
                );
              })}

            {/* Все элементы (когда нет групп) */}
            {groupedItems[FILTER_GROUP_IDS.ALL] && 
              renderGroup(FILTER_GROUP_IDS.ALL, groupedItems[FILTER_GROUP_IDS.ALL])
            }

            {/* Сообщение о пустом результате */}
            {filteredItems.length === 0 && (
              <Typography 
                variant="body2" 
                color="text.secondary" 
                align="center" 
                sx={{ py: 2 }}
              >
                Ничего не найдено
              </Typography>
            )}
          </Box>

          {/* Кнопка применения */}
          {showApplyButton && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, pt: 2, borderTop: '1px solid #F0F0F0' }}>
              <Button
                variant="contained"
                onClick={handleClose}
                sx={{ 
                  textTransform: 'none',
                  borderRadius: '8px',
                  boxShadow: 'none'
                }}
              >
                Применить
              </Button>
            </Box>
          )}
        </Box>
      </Popover>
    </Box>
  );
};

export default MultiSelectFilter; 