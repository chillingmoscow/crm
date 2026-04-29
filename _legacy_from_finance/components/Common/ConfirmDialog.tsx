import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

interface ConfirmDialogProps {
  /**
   * Открыт ли диалог
   */
  open: boolean;
  
  /**
   * Заголовок диалога
   */
  title: string;
  
  /**
   * Текст сообщения
   */
  message: string;
  
  /**
   * Текст кнопки подтверждения
   */
  confirmText?: string;
  
  /**
   * Текст кнопки отмены
   */
  cancelText?: string;
  
  /**
   * Цвет кнопки подтверждения
   */
  confirmColor?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  
  /**
   * Обработчик подтверждения
   */
  onConfirm: () => void;
  
  /**
   * Обработчик отмены
   */
  onCancel: () => void;
}

/**
 * Переиспользуемый компонент диалога подтверждения
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  confirmColor = 'primary',
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{cancelText}</Button>
        <Button onClick={onConfirm} color={confirmColor} variant="contained" autoFocus>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog; 