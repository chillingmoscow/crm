import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Box, 
  Typography, 
  Paper, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemIcon, 
  ListItemSecondaryAction,
  IconButton,
  LinearProgress,
  Tooltip
} from '@mui/material';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import DeleteIcon from '@mui/icons-material/Delete';
import ImageIcon from '@mui/icons-material/Image';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import InfoIcon from '@mui/icons-material/Info';
import AddIcon from '@mui/icons-material/Add';
import { AttachedFile } from '../../types';

// Максимальный размер файла (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface FileUploadProps {
  files: AttachedFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (fileId: string) => void;
  maxFiles?: number;
}

// Функция для форматирования размера файла
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' байт';
  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  else return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
};

// Функция для получения иконки в зависимости от типа файла
const getFileIcon = (fileType: string) => {
  if (fileType.startsWith('image/')) {
    return <ImageIcon fontSize="small" />;
  } else if (fileType === 'application/pdf') {
    return <PictureAsPdfIcon fontSize="small" />;
  } else {
    return <InsertDriveFileIcon fontSize="small" />;
  }
};

const FileUpload: React.FC<FileUploadProps> = ({ 
  files, 
  onAddFiles, 
  onRemoveFile,
  maxFiles = 5 
}) => {
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Проверяем, не превышен ли лимит файлов
    if (files.length + acceptedFiles.length > maxFiles) {
      alert(`Вы можете загрузить максимум ${maxFiles} файлов`);
      return;
    }

    // Проверяем размер каждого файла
    const validFiles = acceptedFiles.filter(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`Файл "${file.name}" слишком большой. Максимальный размер: 10MB`);
        return false;
      }
      return true;
    });

    // Имитация загрузки файлов
    validFiles.forEach(file => {
      const fileId = `temp-${Date.now()}-${file.name}`;
      setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));
      
      // Имитация прогресса загрузки
      const interval = setInterval(() => {
        setUploadProgress(prev => {
          const progress = (prev[fileId] || 0) + 10;
          if (progress >= 100) {
            clearInterval(interval);
          }
          return { ...prev, [fileId]: progress };
        });
      }, 300);
    });

    // Передаем файлы родительскому компоненту
    onAddFiles(validFiles);
  }, [files, maxFiles, onAddFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif'],
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    }
  });

  return (
    <Box sx={{ mt: 2 }}>
      {/* Показываем поле загрузки только если нет файлов */}
      {files.length === 0 && (
      <Paper
        {...getRootProps()}
        sx={{
          p: 2,
          border: '2px dashed',
          borderColor: isDragActive ? 'primary.main' : 'grey.300',
            backgroundColor: isDragActive ? 'rgba(99, 100, 255, 0.05)' : 'transparent',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
            boxShadow: 'none',
          '&:hover': {
            borderColor: 'primary.main',
            backgroundColor: 'rgba(99, 100, 255, 0.05)',
          },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 120,
          position: 'relative',
        }}
      >
        <input {...getInputProps()} />
        <DescriptionIcon color="primary" sx={{ fontSize: 32, mb: 1 }} />
        <Typography variant="caption" align="center" color="text.secondary">
          {isDragActive
            ? 'Перетащите файлы сюда...'
            : 'Перетащите сюда документы или выберите файлы'}
        </Typography>
        
        <Tooltip 
          title={
            <React.Fragment>
              <Typography variant="caption">Максимальный размер файла: 10MB</Typography>
              <Typography variant="caption" component="div">
                Поддерживаемые форматы: изображения (JPG, PNG, GIF), PDF, документы Word (DOC, DOCX), Excel (XLS, XLSX)
              </Typography>
            </React.Fragment>
          } 
          arrow
        >
          <IconButton 
            size="small" 
            sx={{ 
              p: 0.3, 
              position: 'absolute', 
              top: 8, 
              right: 8 
            }}
          >
            <InfoIcon sx={{ fontSize: 16 }} color="action" />
          </IconButton>
        </Tooltip>
      </Paper>
      )}

      {files.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Прикрепленные файлы ({files.length})
            </Typography>
            <Tooltip title="Добавить файл">
              <IconButton 
                size="small"
                onClick={() => {
                  // Программно кликаем на input для выбора файлов
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx';
                  input.onchange = (e) => {
                    const target = e.target as HTMLInputElement;
                    if (target.files) {
                      const filesArray = Array.from(target.files);
                      onDrop(filesArray);
                    }
                  };
                  input.click();
                }}
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    backgroundColor: 'rgba(99, 100, 255, 0.1)',
                  }
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        <List>
          {files.map((file) => (
              <ListItem key={file.id} sx={{ bgcolor: 'background.paper', mb: 1, borderRadius: 1, pl: 0 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                {getFileIcon(file.type)}
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2">{file.name}</Typography>}
                secondary={<Typography variant="caption" color="text.secondary">{formatFileSize(file.size)}</Typography>}
              />
              <ListItemSecondaryAction>
                <IconButton 
                  edge="end" 
                  aria-label="delete"
                  onClick={() => onRemoveFile(file.id)}
                  size="small"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
        </Box>
      )}

      {/* Показываем прогресс загрузки для новых файлов */}
      {Object.keys(uploadProgress).map(fileId => {
        const progress = uploadProgress[fileId];
        if (progress < 100) {
          return (
            <Box key={fileId} sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {fileId.replace(/^temp-\d+-/, '')} ({progress}%)
              </Typography>
              <LinearProgress variant="determinate" value={progress} sx={{ height: 4 }} />
            </Box>
          );
        }
        return null;
      })}
    </Box>
  );
};

export default FileUpload; 