import {
  AlertTriangle,
  AtSign,
  Bell,
  BookOpen,
  Cake,
  Gift,
  HeartPulse,
  Info,
  MessageCircle,
  PartyPopper,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

/**
 * Central registry для всех notification-type'ов в системе.
 *
 * Каждый emit-RPC / trigger пишет конкретный `type`-string (e.g.
 * `kb.mention_in_page`); bell использует registry чтобы получить
 * иконку, цвет и человеко-читаемый verb для рендера.
 *
 * Добавление нового type'а: одна строка в registry + emit-RPC,
 * без изменений UI. Sprint E §3 cross-module readiness.
 */

export interface NotificationTypeSpec {
  /** Module category — для filter-chips в bell'е. */
  category: "kb" | "finance" | "schedule" | "staff" | "system";
  /** Lucide-иконка для row'а (когда нет actor'а / fallback). */
  icon: LucideIcon;
  /** Tailwind-класс цвета иконки. */
  iconColor: string;
  /** Verb для строки «Pavel <verb> в <entity>». Если null — bell
   *  использует `title` как-есть, без actor-prefix'а. */
  verb: string | null;
}

const FALLBACK: NotificationTypeSpec = {
  category: "system",
  icon: Info,
  iconColor: "text-muted-foreground",
  verb: null,
};

const REGISTRY: Record<string, NotificationTypeSpec> = {
  // KB
  "kb.mention_in_page": {
    category: "kb",
    icon: AtSign,
    iconColor: "text-blue-500",
    verb: "упомянул(а) вас в",
  },
  "kb.mention_in_comment": {
    category: "kb",
    icon: AtSign,
    iconColor: "text-blue-500",
    verb: "упомянул(а) вас в комментарии в",
  },
  "kb.required_reading_assigned": {
    category: "kb",
    icon: BookOpen,
    iconColor: "text-amber-500",
    verb: "отметил(а) обязательной к прочтению",
  },
  "kb.comment_replied": {
    category: "kb",
    icon: MessageCircle,
    iconColor: "text-emerald-500",
    verb: "ответил(а) в треде",
  },

  // Staff
  "staff.medical_book_expiring": {
    category: "staff",
    icon: HeartPulse,
    iconColor: "text-rose-500",
    verb: null,
  },
  "staff.birthday_self": {
    category: "staff",
    icon: Cake,
    iconColor: "text-pink-500",
    verb: null,
  },
  "staff.birthday_colleague": {
    category: "staff",
    icon: Gift,
    iconColor: "text-purple-500",
    verb: null,
  },
  "staff.welcome": {
    category: "staff",
    icon: PartyPopper,
    iconColor: "text-brand",
    verb: null,
  },

  // Generic / system
  "invite": {
    category: "staff",
    icon: UserPlus,
    iconColor: "text-blue-500",
    verb: "пригласил(а) вас",
  },
  "warning": {
    category: "system",
    icon: AlertTriangle,
    iconColor: "text-amber-500",
    verb: null,
  },

  // Future cross-module emit'еры добавляются здесь:
  // "finance.transaction_pending_approval": {...},
  // "schedule.shift_assigned": {...},
};

export function getNotificationTypeSpec(type: string): NotificationTypeSpec {
  return REGISTRY[type] ?? FALLBACK;
}

/** Все известные categories — для filter-chips в bell'е. */
export const KNOWN_CATEGORIES = [
  "kb",
  "finance",
  "schedule",
  "staff",
  "system",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  kb: "База знаний",
  finance: "Финансы",
  schedule: "График",
  staff: "Команда",
  system: "Прочее",
};

/** Default-icon (Bell) — экспортируется для bell-button'а вне registry. */
export { Bell };
