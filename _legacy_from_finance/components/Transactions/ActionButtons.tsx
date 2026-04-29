import React from 'react';
import { Box, Button } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

interface ActionButtonsProps {
  onAddIncome: () => void;
  onAddExpense: () => void;
  onAddTransfer: () => void;
  disableIncome?: boolean;
  disableExpense?: boolean;
  disableTransfer?: boolean;
}

/**
 * Компонент с кнопками действий для создания транзакций
 * @param onAddIncome - Обработчик добавления дохода
 * @param onAddExpense - Обработчик добавления расхода
 * @param onAddTransfer - Обработчик добавления перевода
 * @param disableIncome - Флаг отключения кнопки добавления дохода
 * @param disableExpense - Флаг отключения кнопки добавления расхода
 * @param disableTransfer - Флаг отключения кнопки добавления перевода
 */
const ActionButtons: React.FC<ActionButtonsProps> = ({
  onAddIncome,
  onAddExpense,
  onAddTransfer,
  disableIncome = false,
  disableExpense = false,
  disableTransfer = false
}) => {
  return (
    <Box sx={{ display: 'flex', gap: 2 }}>
      <Button
        variant="contained"
        startIcon={<AddIcon />}
        onClick={onAddIncome}
        disabled={disableIncome}
        color="primary"
      >
        Приход
      </Button>
      <Button
        variant="contained"
        startIcon={<RemoveIcon />}
        onClick={onAddExpense}
        disabled={disableExpense}
        color="primary"
      >
        Расход
      </Button>
      <Button
        variant="contained"
        startIcon={<SwapHorizIcon />}
        onClick={onAddTransfer}
        disabled={disableTransfer}
        color="primary"
      >
        Перевод
      </Button>
    </Box>
  );
};

export default ActionButtons; 