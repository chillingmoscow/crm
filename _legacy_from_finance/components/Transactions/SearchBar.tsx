import React from 'react';
import { Box, InputBase } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';

interface SearchBarProps {
  searchQuery: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  width?: number | string;
}

/**
 * Компонент поисковой строки, используемый на разных страницах
 * @param searchQuery - Текущее значение строки поиска
 * @param onChange - Обработчик изменения значения поиска
 * @param placeholder - Подсказка в поисковой строке
 * @param width - Ширина компонента
 */
const SearchBar: React.FC<SearchBarProps> = ({ 
  searchQuery, 
  onChange, 
  placeholder = "Поиск...", 
  width = 300 
}) => {
  return (
    <Box sx={{ 
      backgroundColor: alpha('#e0e0e0', 0.5), 
      borderRadius: '8px',
      px: 2,
      display: 'flex',
      alignItems: 'center',
      width,
    }}>
      <SearchIcon sx={{ color: 'text.secondary' }} />
      <InputBase
        placeholder={placeholder}
        sx={{ ml: 1, flex: 1 }}
        value={searchQuery}
        onChange={onChange}
        onKeyPress={(e) => {
          if (e.key === 'Enter') {
            // При нажатии Enter можно добавить дополнительную логику
            console.log(`Поиск по запросу: "${searchQuery}"`);
          }
        }}
      />
    </Box>
  );
};

export default SearchBar; 