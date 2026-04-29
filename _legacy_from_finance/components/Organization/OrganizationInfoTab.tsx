import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Organization } from '../../types';
import { SupabaseOrganizationService } from '../../context/services/SupabaseOrganizationService';

interface OrganizationInfoTabProps {
  organization: Organization;
  onUpdate: (organization: Organization) => void;
}

// Расширенный список часовых поясов отсортированный по UTC
const TIMEZONES = [
  { value: 'Pacific/Midway', label: 'Мидуэй (UTC-11)' },
  { value: 'Pacific/Honolulu', label: 'Гонолулу (UTC-10)' },
  { value: 'America/Anchorage', label: 'Анкоридж (UTC-9)' },
  { value: 'America/Los_Angeles', label: 'Лос-Анджелес (UTC-8)' },
  { value: 'America/Denver', label: 'Денвер (UTC-7)' },
  { value: 'America/Chicago', label: 'Чикаго (UTC-6)' },
  { value: 'America/New_York', label: 'Нью-Йорк (UTC-5)' },
  { value: 'America/Caracas', label: 'Каракас (UTC-4)' },
  { value: 'America/Sao_Paulo', label: 'Сан-Паулу (UTC-3)' },
  { value: 'Atlantic/South_Georgia', label: 'Южная Георгия (UTC-2)' },
  { value: 'Atlantic/Azores', label: 'Азоры (UTC-1)' },
  { value: 'Europe/London', label: 'Лондон (UTC+0)' },
  { value: 'Europe/Paris', label: 'Париж (UTC+1)' },
  { value: 'Europe/Berlin', label: 'Берлин (UTC+1)' },
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Kiev', label: 'Киев (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Minsk', label: 'Минск (UTC+3)' },
  { value: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Tashkent', label: 'Ташкент (UTC+5)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Almaty', label: 'Алматы (UTC+6)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { value: 'Asia/Shanghai', label: 'Шанхай (UTC+8)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Токио (UTC+9)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Петропавловск-Камчатский (UTC+12)' },
];

/**
 * Вкладка с информацией об организации
 */
const OrganizationInfoTab: React.FC<OrganizationInfoTabProps> = ({
  organization,
  onUpdate
}) => {
  const [editedOrg, setEditedOrg] = useState<Organization>(organization);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  /**
   * Обработка изменения полей формы
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEditedOrg(prev => ({
      ...prev,
      [name]: value
    }));
    // Сбрасываем ошибки при изменении
    setError(null);
  };

  /**
   * Сохранение изменений
   */
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      // Валидация
      if (!editedOrg.name.trim()) {
        setError('Название компании обязательно');
        return;
      }

      // Сохраняем в базе данных
      const updatedOrganization = await SupabaseOrganizationService.updateOrganization(
        editedOrg,
        organization.ownerId // Используем ID владельца как userId
      );

      // Обновляем данные в родительском компоненте
      onUpdate(updatedOrganization);
      setSnackbarOpen(true);
    } catch (err) {
      console.error('Ошибка при сохранении организации:', err);
      setError('Не удалось сохранить изменения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: 'flex', gap: 4 }}>
      {/* Левая часть - форма */}
      <Box sx={{ flex: 1 }}>
        {/* Форма в стиле TransactionForm */}
        <Box component="form" onSubmit={(e) => { e.preventDefault(); handleSave(); }} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          {/* Название компании */}
          <TextField
            name="name"
            label="Название компании"
            fullWidth
            required
            value={editedOrg.name}
            onChange={handleInputChange}
            error={error === 'Название компании обязательно'}
            helperText={error === 'Название компании обязательно' ? error : ''}
            sx={{
              width: '50%',
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />
          
          {/* Поддомен с информационной иконкой */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, width: '50%' }}>
            <TextField
              name="subdomain"
              label="Поддомен"
              value={editedOrg.settings?.subdomain || ''}
              onChange={(e) => {
                const newSettings = { ...editedOrg.settings, subdomain: e.target.value };
                setEditedOrg(prev => ({ ...prev, settings: newSettings }));
              }}
              placeholder="mycompany"
              sx={{
                flex: 1,
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            />
            <Tooltip 
              title="Поддомен используется для создания уникального адреса вашей компании в системе. Например, если вы укажете 'mycompany', то адрес будет mycompany.finova.ru"
              placement="top"
              arrow
            >
              <IconButton 
                size="small" 
                sx={{ 
                  mt: 0.5,
                  color: 'text.secondary',
                  '&:hover': {
                    color: 'primary.main'
                  }
                }}
              >
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Основная валюта */}
          <FormControl sx={{ width: '50%' }}>
            <InputLabel>Основная валюта</InputLabel>
            <Select
              value={editedOrg.settings?.defaultCurrency || 'RUB'}
              label="Основная валюта"
              onChange={(e) => {
                const newSettings = { ...editedOrg.settings, defaultCurrency: e.target.value };
                setEditedOrg(prev => ({ ...prev, settings: newSettings }));
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            >
              <MenuItem value="RUB">₽ Российский рубль</MenuItem>
              <MenuItem value="USD">$ Доллар США</MenuItem>
              <MenuItem value="EUR">€ Евро</MenuItem>
              <MenuItem value="KZT">₸ Казахский тенге</MenuItem>
              <MenuItem value="BYN">Br Белорусский рубль</MenuItem>
              <MenuItem value="UAH">₴ Украинская гривна</MenuItem>
            </Select>
          </FormControl>
          
          {/* Часовой пояс с ограниченной высотой */}
          <FormControl sx={{ width: '50%' }}>
            <InputLabel>Часовой пояс</InputLabel>
            <Select
              value={editedOrg.settings?.timezone || 'Europe/Moscow'}
              label="Часовой пояс"
              onChange={(e) => {
                const newSettings = { ...editedOrg.settings, timezone: e.target.value };
                setEditedOrg(prev => ({ ...prev, settings: newSettings }));
              }}
              MenuProps={{
                PaperProps: {
                  style: {
                    maxHeight: 300, // Ограничиваем высоту выпадающего списка
                  },
                },
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            >
              {TIMEZONES.map((timezone) => (
                <MenuItem key={timezone.value} value={timezone.value}>
                  {timezone.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Ошибка */}
          {error && error !== 'Название компании обязательно' && (
            <Box sx={{ p: 2, backgroundColor: '#FEF2F2', borderRadius: '8px' }}>
              <Alert severity="error" sx={{ backgroundColor: 'transparent' }}>
                {error}
              </Alert>
            </Box>
          )}

          {/* Кнопка сохранения */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={saving}
              sx={{ 
                borderRadius: '8px',
                boxShadow: 'none',
                '&:hover': {
                  boxShadow: '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -1px rgba(0, 0, 0, 0.06)'
                },
                py: 1,
                minWidth: 100
              }}
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Правая часть - изображение */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 300,
        maxWidth: 400,
        pr: 4
      }}>
        <Box
          component="img"
          src="/preferences.svg"
          alt="Настройки организации"
          sx={{
            width: '100%',
            height: 'auto',
            maxWidth: 350,
            opacity: 0.8
          }}
        />
      </Box>

      {/* Snackbar для успешного сохранения */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbarOpen(false)} 
          severity="success"
          sx={{ 
            borderRadius: '8px',
            '& .MuiAlert-action': {
              alignItems: 'center'
            }
          }}
        >
          Настройки компании успешно обновлены
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default OrganizationInfoTab; 