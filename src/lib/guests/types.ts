import { z } from "zod";
export const guestDataSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    contacts: z.string().max(4000).nullable().optional(),
    instagram: z.string().max(4000).nullable().optional(),
    gender: z.string().max(500).nullable().optional(),
    day: z.number().int().min(1).max(31).nullable().optional(),
    month: z.number().int().min(1).max(12).nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    regular: z.boolean().nullable().optional(),
    recognized: z.boolean().nullable().optional(),
    sociability: z.string().max(4000).nullable().optional(),
    personality: z.array(z.string().max(500)).max(50).optional(),
    hobbies: z.array(z.string().max(500)).max(50).optional(),
    work: z.string().max(4000).nullable().optional(),
    alcohol: z.string().max(4000).nullable().optional(),
    channels: z.array(z.string().max(500)).max(50).optional(),
    benefits: z.array(z.string().max(500)).max(50).optional(),
    mobility: z.string().max(4000).nullable().optional(),
    note: z.string().max(4000).nullable().optional(),
    photoPath: z.string().max(300).nullable().optional(),
  })
  .strict();
export type GuestEditable = z.infer<typeof guestDataSchema>;
export type GuestData = Partial<GuestEditable> & {
  groupId?: number | null;
  groupTitle?: string | null;
  discountPercent?: number | null;
  issues?: string[];
  sourceMissing?: boolean;
};
export type Guest = {
  id: string;
  revision: number;
  qrId: number | null;
  legacyId: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  data: GuestData;
  photoUrl?: string | null;
};
export type GuestHistory = {
  id: number;
  action: string;
  revision: number;
  actor_name: string;
  reason?: string;
  created_at: string;
  before_data?: GuestData | null;
  after_data?: GuestData | null;
};
export type GuestDetail = Guest & {
  history: GuestHistory[];
  canManage: boolean;
  canDetails: boolean;
};
export type GuestFilters = {
  search: string;
  group: string;
  birthday: "" | "today" | "upcoming";
  archived: boolean;
  page: number;
  size: number;
  sort: "name" | "group" | "birthday" | "updated";
  desc: boolean;
};
export type GuestList = {
  venueId: string;
  rows: Guest[];
  groups: string[];
  total: number;
  today: string;
  canManage: boolean;
  canDetails: boolean;
  canConfigure: boolean;
};
export const guestRulesSchema = z
  .object({
    autoRead: z.boolean(),
    intervalMinutes: z.number().int().min(15).max(1440),
    birthdayToday: z.boolean(),
    birthdayUpcoming: z.boolean(),
    leadDays: z.number().int().min(1).max(60),
    groupTransitions: z.boolean(),
    groupId: z.number().int().positive(),
    birthdayHour: z.number().int().min(0).max(23),
    birthdayMinute: z.number().int().min(0).max(59),
    groupHour: z.number().int().min(0).max(23),
    groupMinute: z.number().int().min(0).max(59),
  })
  .strict();
export type GuestRules = z.infer<typeof guestRulesSchema>;
export const defaultGuestRules: GuestRules = {
  autoRead: false,
  intervalMinutes: 60,
  birthdayToday: false,
  birthdayUpcoming: false,
  leadDays: 14,
  groupTransitions: false,
  groupId: 4,
  birthdayHour: 13,
  birthdayMinute: 12,
  groupHour: 13,
  groupMinute: 15,
};
export type GuestConfiguration = {
  venueId: string;
  checkedAt: string | null;
  rows: number;
  job: {
    state: string;
    phase: string;
    cursor: number;
    error: string | null;
  } | null;
  groups: { id: number; title: string; discountPercent: number }[];
  versions: {
    id: string;
    version: number;
    config: GuestRules;
    reason: string;
    actor_name: string;
    created_at: string;
  }[];
};
export const guestFields: Record<string, string> = {
  name: "Имя",
  contacts: "Контакты",
  instagram: "Instagram",
  gender: "Пол",
  day: "День рождения",
  month: "Месяц рождения",
  year: "Год рождения",
  regular: "Постоянный гость",
  recognized: "Узнаём в лицо",
  sociability: "Общительность",
  personality: "Характер",
  hobbies: "Увлечения",
  work: "Работа",
  alcohol: "Предпочтения в напитках",
  channels: "Каналы связи",
  benefits: "Привилегии",
  mobility: "Перемещения",
  note: "Заметки",
  photoPath: "Фотография",
  groupId: "Группа Quick Resto",
  groupTitle: "Группа",
  discountPercent: "Скидка",
  sourceMissing: "Нет в источнике",
  issues: "Проверка сведений",
};
export const guestHistoryActions: Record<string, string> = {
  create: "Карточка создана",
  update: "Карточка изменена",
  archive: "Карточка в архиве",
  restore: "Карточка восстановлена",
  source_created: "Получена из Quick Resto",
  source_updated: "Обновлена из Quick Resto",
  source_missing: "Нет в текущей базе Quick Resto",
  legacy_imported: "Перенесена из Glide",
};
