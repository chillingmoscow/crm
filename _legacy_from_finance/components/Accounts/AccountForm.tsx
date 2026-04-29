import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { Account, AccountGroup, AccountType, Organization, LegalEntity } from '../../types';
import { useFinance } from '../../context/FinanceContext';
import { useUser } from '../../context/UserContext';
import { SupabaseOrganizationService } from '../../context/services/SupabaseOrganizationService';
import { SupabaseLegalEntityService } from '../../context/services/SupabaseLegalEntityService';
import RightSidebar from '../Layout/RightSidebar';
import AccountGroupForm from './AccountGroupForm';
import { CURRENCIES, ACCOUNT_TYPES, COMPONENT_SIZES } from '../../utils/constants';
import DeleteIcon from '@mui/icons-material/DeleteOutline';

// Интерфейс пропсов компонента
interface AccountFormProps {
  /** Текущий счет для редактирования или пустой для создания */
  account: Partial<Account>;
  /** Флаг режима редактирования */
  isEditing: boolean;
  /** Обработчик сохранения счета */
  onSave: () => void;
  /** Обработчик удаления счета */
  onDelete?: () => void;
  /** Обработчик закрытия формы */
  onClose: () => void;
  /** Обработчик изменения счета */
  onAccountChange: (account: Partial<Account>) => void;
}

/**
 * Компонент формы создания/редактирования счета
 */
const AccountForm: React.FC<AccountFormProps> = ({
  account,
  isEditing,
  onSave,
  onDelete,
  onClose,
  onAccountChange
}) => {
  const { accountGroups, addAccountGroup } = useFinance();
  const { currentUser } = useUser();
  
  // Состояние для организаций и юридических лиц
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [loadingLegalEntities, setLoadingLegalEntities] = useState(false);
  
  // Состояния для валидации банковских полей
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Остальные состояния
  const [groupFormSidebarOpen, setGroupFormSidebarOpen] = useState(false);
  const [currentAccountGroup, setCurrentAccountGroup] = useState<Partial<AccountGroup>>({ name: '' });

  // Валидация БИК (9 цифр)
  const validateBik = (bik: string): boolean => {
    const bikRegex = /^\d{9}$/;
    return bik.length === 0 || bikRegex.test(bik);
  };

  // Валидация номера счета (20 цифр)
  const validateAccountNumber = (accountNumber: string): boolean => {
    const accountRegex = /^\d{20}$/;
    return accountNumber.length === 0 || accountRegex.test(accountNumber);
  };

  // Валидация корреспондентского счета (20 цифр)
  const validateCorrespondentAccount = (correspondentAccount: string): boolean => {
    return /^\d{20}$/.test(correspondentAccount);
  };

  // Загрузка организаций при монтировании компонента
  useEffect(() => {
    loadOrganizations();
  }, []);

  // Загрузка юридических лиц при изменении организации
  useEffect(() => {
    if (account.organizationId) {
      loadLegalEntities(account.organizationId);
    } else {
      setLegalEntities([]);
    }
  }, [account.organizationId]);

  // Автоматическое назначение организации пользователя, если она еще не выбрана
  useEffect(() => {
    if (currentUser?.organizationId && !account.organizationId) {
      onAccountChange({
        ...account,
        organizationId: currentUser.organizationId
      });
    }
  }, [currentUser, account, onAccountChange]);

  /**
   * Загрузка организаций
   */
  const loadOrganizations = async () => {
    try {
      const orgs = await SupabaseOrganizationService.getOrganizations();
      setOrganizations(orgs);
    } catch (error) {
      console.error('Ошибка при загрузке организаций:', error);
    }
  };

  /**
   * Загрузка юридических лиц организации
   */
  const loadLegalEntities = async (organizationId: string) => {
    try {
      setLoadingLegalEntities(true);
      const entities = await SupabaseLegalEntityService.getLegalEntities(organizationId);
      setLegalEntities(entities);
      
      // Если юридическое лицо не выбрано и есть доступные, выбираем первое
      if (!account.legalEntityId && entities.length > 0) {
        onAccountChange({
          ...account,
          legalEntityId: entities[0].id
        });
      }
    } catch (error) {
      console.error('Ошибка при загрузке юридических лиц:', error);
    } finally {
      setLoadingLegalEntities(false);
    }
  };

  // Валидация формы
  const validateForm = (): boolean => {
    if (!account.name?.trim()) return false;
    if (!account.currency) return false;
    if (!account.accountType) return false;
    if (!account.legalEntityId) return false; // Юридическое лицо обязательно
    
    // Дополнительная валидация для банковских полей
    if (account.accountType === 'checking') {
      if (account.bik && !validateBik(account.bik)) return false;
      if (account.accountNumber && !validateAccountNumber(account.accountNumber)) return false;
      if (account.correspondentAccount && !validateCorrespondentAccount(account.correspondentAccount)) return false;
    }
    
    return true;
  };

  // Обработчик сохранения с валидацией
  const handleSave = () => {
    setShowValidationErrors(true);
    
    if (validateForm()) {
      onSave();
    }
  };

  // Обработка изменения полей формы
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    // Валидация банковских полей с ограничением на цифры
    if (name === 'bik') {
      const numericValue = value.replace(/\D/g, '');
      onAccountChange({
        ...account,
        [name]: numericValue,
      });
      return;
    }
    
    if (name === 'accountNumber') {
      const numericValue = value.replace(/\D/g, '');
      onAccountChange({
        ...account,
        [name]: numericValue,
      });
      return;
    }
    
    if (name === 'correspondentAccount') {
      const numericValue = value.replace(/\D/g, '');
      onAccountChange({
        ...account,
        [name]: numericValue,
      });
      return;
    }
    
    onAccountChange({
      ...account,
      [name]: name === 'balance' || name === 'acquiringPercentage' 
        ? parseFloat(value) || 0 
        : value,
    });
  };

  // Обработка изменения валюты
  const handleCurrencyChange = (e: SelectChangeEvent) => {
    onAccountChange({
      ...account,
      currency: e.target.value,
    });
  };

  // Обработка изменения типа счета
  const handleAccountTypeChange = (e: SelectChangeEvent) => {
    onAccountChange({
      ...account,
      accountType: e.target.value as AccountType,
    });
  };

  // Обработка изменения группы
  const handleGroupChange = (e: SelectChangeEvent) => {
    const value = e.target.value;
    if (value === '__add_new__') {
      // Открываем форму создания новой группы
      setCurrentAccountGroup({ name: '' });
      setGroupFormSidebarOpen(true);
    } else {
      onAccountChange({
        ...account,
        groupId: value || undefined,
      });
    }
  };

  // Обработка изменения юридического лица
  const handleLegalEntityChange = (e: SelectChangeEvent) => {
    onAccountChange({
      ...account,
      legalEntityId: e.target.value,
    });
  };

  // Закрыть форму создания группы
  const handleGroupFormClose = () => {
    setGroupFormSidebarOpen(false);
  };

  // Сохранить новую группу
  const handleGroupSave = async () => {
    if (!currentAccountGroup.name) {
      alert('Пожалуйста, введите название группы');
      return;
    }

    try {
      const newGroup = await addAccountGroup({
        name: currentAccountGroup.name
      });
      // Устанавливаем новую группу как выбранную
      onAccountChange({
        ...account,
        groupId: newGroup.id,
      });
      handleGroupFormClose();
    } catch (error) {
      console.error('Ошибка при создании группы:', error);
      alert('Ошибка при создании группы');
    }
  };

  return (
    <>
      <Box component="form" onSubmit={(e) => { e.preventDefault(); handleSave(); }} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
        {/* Основная информация */}
        <TextField
          name="name"
          label="Название счета"
          type="text"
          fullWidth
          required
          value={account.name || ''}
          onChange={handleInputChange}
          placeholder="Например: Основной расчетный счет"
          error={showValidationErrors && !account.name?.trim()}
          helperText={showValidationErrors && !account.name?.trim() ? 'Обязательное поле' : ''}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            }
          }}
        />

        {/* Первый ряд: Баланс и Валюта */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            name="balance"
            label="Начальный баланс"
            type="number"
            required
            value={account.balance ?? ''}
            onChange={handleInputChange}
            inputProps={{
              inputMode: 'decimal',
              style: { textAlign: 'left' }
            }}
            sx={{
              width: '50%',
              '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
                '-webkit-appearance': 'none',
                margin: 0,
              },
              '& input[type=number]': {
                '-moz-appearance': 'textfield',
              },
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
            placeholder="0,00"
          />

          <FormControl sx={{ width: '50%' }} required error={showValidationErrors && !account.currency}>
            <InputLabel>Валюта</InputLabel>
            <Select
              value={account.currency || ''}
              label="Валюта"
              onChange={handleCurrencyChange}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            >
              {CURRENCIES.map((currency) => (
                <MenuItem key={currency.code} value={currency.code}>
                  {currency.symbol} {currency.name}
                </MenuItem>
              ))}
            </Select>
            {showValidationErrors && !account.currency && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, mx: 1.75 }}>
                Обязательное поле
              </Typography>
            )}
          </FormControl>
        </Box>

        {/* Второй ряд: Тип счета и Группа */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl sx={{ width: '50%' }} required error={showValidationErrors && !account.accountType}>
            <InputLabel>Тип счета</InputLabel>
            <Select
              value={account.accountType || ''}
              label="Тип счета"
              onChange={handleAccountTypeChange}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            >
              {ACCOUNT_TYPES.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </Select>
            {showValidationErrors && !account.accountType && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, mx: 1.75 }}>
                Обязательное поле
              </Typography>
            )}
          </FormControl>

          <FormControl sx={{ width: '50%' }}>
            <InputLabel>Группа счетов</InputLabel>
            <Select
              value={account.groupId ?? ''}
              label="Группа счетов"
              onChange={handleGroupChange}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            >
              <MenuItem value="__add_new__" sx={{ color: 'primary.main' }}>
                <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1, color: 'primary.main', fontSize: 18 }} />
                Добавить новую группу
              </MenuItem>
              {accountGroups.map((group) => (
                <MenuItem key={group.id} value={group.id.toString()}>
                  {group.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* Третий ряд: Описание и Юридическое лицо */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            name="description"
            label="Описание"
            type="text"
            value={account.description || ''}
            onChange={handleInputChange}
            placeholder="Краткое описание счета"
            sx={{
              width: '50%',
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
              }
            }}
          />

          <FormControl sx={{ width: '50%' }} required error={showValidationErrors && !account.legalEntityId}>
            <InputLabel>Юридическое лицо</InputLabel>
            <Select
              value={account.legalEntityId || ''}
              label="Юридическое лицо"
              onChange={handleLegalEntityChange}
              disabled={loadingLegalEntities}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            >
              {legalEntities.map((entity) => (
                <MenuItem key={entity.id} value={entity.id}>
                  {entity.name}
                </MenuItem>
              ))}
            </Select>
            {showValidationErrors && !account.legalEntityId && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, mx: 1.75 }}>
                Обязательное поле
              </Typography>
            )}
          </FormControl>
        </Box>

        {/* Банковские реквизиты */}
        {account.accountType === 'checking' && (
          <>
            <Typography variant="h6" color="text.primary" sx={{ mt: 3, mb: 1, fontWeight: 600 }}>
              Банковские реквизиты
            </Typography>
            
            <TextField
              name="bankName"
              label="Название банка"
              type="text"
              fullWidth
              value={account.bankName || ''}
              onChange={handleInputChange}
              placeholder="Например: ПАО Сбербанк"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                }
              }}
            />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                name="bik"
                label="БИК"
                type="text"
                value={account.bik || ''}
                onChange={handleInputChange}
                placeholder="044525225"
                inputProps={{ maxLength: 9 }}
                sx={{
                  width: '50%',
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />

              <TextField
                name="acquiringPercentage"
                label="Процент эквайринга (%)"
                type="number"
                value={account.acquiringPercentage ?? ''}
                onChange={handleInputChange}
                inputProps={{
                  inputMode: 'decimal',
                  step: '0.01',
                  min: '0',
                  max: '100'
                }}
                placeholder="1.5"
                sx={{
                  width: '50%',
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />
            </Box>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                name="accountNumber"
                label="Номер счета"
                type="text"
                value={account.accountNumber || ''}
                onChange={handleInputChange}
                placeholder="40817810099910004312"
                inputProps={{ maxLength: 20 }}
                sx={{
                  width: '50%',
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />

              <TextField
                name="correspondentAccount"
                label="Корреспондентский счет"
                type="text"
                value={account.correspondentAccount || ''}
                onChange={handleInputChange}
                placeholder="30101810400000000225"
                inputProps={{ maxLength: 20 }}
                sx={{
                  width: '50%',
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />
            </Box>
          </>
        )}

        {/* Данные карты */}
        {(account.accountType as string) === 'card' && (
          <>
            <Typography variant="h6" color="text.primary" sx={{ mt: 3, mb: 1, fontWeight: 600 }}>
              Данные карты
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                name="cardHolder"
                label="Держатель карты"
                type="text"
                value={account.cardHolder || ''}
                onChange={handleInputChange}
                placeholder="IVAN IVANOV"
                sx={{
                  width: '50%',
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />

              <TextField
                name="cardNumber"
                label="Номер карты"
                type="text"
                value={account.cardNumber || ''}
                onChange={handleInputChange}
                placeholder="**** **** **** 1234"
                sx={{
                  width: '50%',
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                  }
                }}
              />
            </Box>
          </>
        )}

        {/* Кнопки управления для редактирования */}
        {isEditing && (
          <>
            <Box sx={{ mt: 3 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button 
                startIcon={<DeleteIcon />} 
                color="error" 
                variant="outlined"
                onClick={onDelete}
                sx={{
                  borderRadius: '8px',
                  borderColor: '#FFB3BA',
                  color: '#DC2626',
                  backgroundColor: '#FEF2F2',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    borderColor: '#DC2626',
                    backgroundColor: '#DC2626',
                    color: 'white',
                    '& .MuiSvgIcon-root': {
                      color: 'white'
                    }
                  },
                  py: 1
                }}
              >
                Удалить
              </Button>
              <Button 
                type="submit"
                variant="contained"
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
                Сохранить
              </Button>
            </Box>
          </>
        )}

        {/* Кнопки для новых счетов */}
        {!isEditing && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
            <Button 
              type="submit"
              variant="contained"
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
              Сохранить
            </Button>
          </Box>
        )}
      </Box>

      {/* Сайдбар для создания группы */}
      <RightSidebar 
        open={groupFormSidebarOpen} 
        onClose={handleGroupFormClose} 
        title="Добавить группу счетов"
        width={COMPONENT_SIZES.RIGHT_SIDEBAR_WIDTH}
      >
        <AccountGroupForm
          accountGroup={currentAccountGroup}
          isEditing={false}
          onSave={handleGroupSave}
          onClose={handleGroupFormClose}
          onAccountGroupChange={setCurrentAccountGroup}
        />
      </RightSidebar>
    </>
  );
};

export default AccountForm; 