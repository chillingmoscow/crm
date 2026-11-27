import {
  AlertTriangle,
  ArrowLeftRight,
  AtSign,
  Bell,
  BookOpen,
  Cake,
  FileWarning,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Gift,
  HeartPulse,
  Info,
  MessageCircle,
  PartyPopper,
  RotateCcw,
  UserCheck,
  UserMinus,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { StatusTone } from "@/components/ui/status-badge";

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

export type NotificationCategory =
  | "kb"
  | "finance"
  | "schedule"
  | "staff"
  | "inventory"
  | "crm"
  | "system";

export interface NotificationTypeSpec {
  /** Раздел, к которому относится уведомление. Он же задаёт цвет иконки. */
  category: NotificationCategory;
  /** Lucide-иконка для row'а (когда нет actor'а / fallback). */
  icon: LucideIcon;
  /** Verb для строки «Pavel <verb> в <entity>». Если null — bell
   *  использует `title` как-есть, без actor-prefix'а. */
  verb: string | null;
  /**
   * Формы слова для стопки однотипных уведомлений одного дня
   * («13 новых анкет»): one / few / many. Без них стопка подписывается
   * «N уведомлений».
   */
  stack?: readonly [string, string, string];
}

/**
 * Цвет иконки по разделу — тоны статусной палитры DS (`statusTones`):
 * один рецепт на обе темы. Разделы различаются цветом, тип внутри
 * раздела — иконкой.
 */
export const CATEGORY_TONES: Record<NotificationCategory, StatusTone> = {
  staff: "accent",
  crm: "accent",
  finance: "success",
  schedule: "info",
  inventory: "warning",
  kb: "neutral",
  system: "neutral",
};

export function notificationTone(type: string): StatusTone {
  return CATEGORY_TONES[getNotificationTypeSpec(type).category];
}

const FALLBACK: NotificationTypeSpec = {
  category: "system",
  icon: Info,
  verb: null,
};

const REGISTRY: Record<string, NotificationTypeSpec> = {
  "finance.cash_discrepancy": {
    category: "finance",
    icon: AlertTriangle,
    verb: null,
  },
  "crm.guest.birthday": {category:"crm",icon:Cake,verb:null},
  "crm.guest.birthday_upcoming": {category:"crm",icon:Cake,verb:null},
  "crm.guest.group": {category:"crm",icon:UserPlus,verb:null},
  // KB
  "kb.mention_in_page": {
    category: "kb",
    icon: AtSign,
    verb: "упомянул(а) вас в",
    stack: ["упоминание", "упоминания", "упоминаний"],
  },
  "kb.mention_in_comment": {
    category: "kb",
    icon: AtSign,
    verb: "упомянул(а) вас в комментарии в",
    stack: ["упоминание в комментарии", "упоминания в комментариях", "упоминаний в комментариях"],
  },
  "kb.required_reading_assigned": {
    category: "kb",
    icon: BookOpen,
    verb: "отметил(а) обязательной к прочтению",
  },
  "kb.comment_replied": {
    category: "kb",
    icon: MessageCircle,
    verb: "ответил(а) в треде",
    stack: ["ответ в треде", "ответа в треде", "ответов в треде"],
  },

  // Staff
  "candidate.new": {
    category: "staff",
    icon: UserPlus,
    verb: null,
    stack: ["новая анкета", "новые анкеты", "новых анкет"],
  },
  "staff.payroll_comment": {
    category: "staff",
    icon: MessageCircle,
    verb: null,
  },
  // Сервер сформировал черновик плана выплат в начале периода (Павел, 27.11).
  "staff.payout_plan_ready": { category: "staff", icon: ClipboardList, verb: null },
  "staff.medical_reminder": { category:"staff",icon:HeartPulse,verb:null },
  "finance.certificate_expiring": {
    category: "finance",
    icon: FileWarning,
    verb: null,
    stack: ["истекающий документ", "истекающих документа", "истекающих документов"],
  },
  "staff.medical_book_expiring": {
    category: "staff",
    icon: HeartPulse,
    verb: null,
  },
  "staff.birthday_self": {
    category: "staff",
    icon: Cake,
    verb: null,
  },
  "staff.birthday_colleague": {
    category: "staff",
    icon: Gift,
    verb: null,
    stack: ["день рождения коллеги", "дня рождения коллег", "дней рождения коллег"],
  },
  "staff.welcome": {
    category: "staff",
    icon: PartyPopper,
    verb: null,
  },

  // Inventory (акты инвентаризации)
  "inventory.document.assigned": {
    category: "inventory",
    icon: ClipboardList,
    verb: "назначил(а) вам акт",
    stack: ["назначенный акт", "назначенных акта", "назначенных актов"],
  },
  "inventory.document.review_assigned": {
    category: "inventory",
    icon: UserCheck,
    verb: "назначил(а) вас проверяющим по акту",
  },
  "inventory.document.ready_for_review": {
    category: "inventory",
    icon: ClipboardCheck,
    verb: null,
  },
  "inventory.document.returned_for_recount": {
    category: "inventory",
    icon: RotateCcw,
    verb: null,
  },
  "inventory.document.finalized": {
    category: "inventory",
    icon: CheckCircle2,
    verb: null,
  },

  "inventory.deduction_anomaly": {
    category: "inventory",
    icon: AlertTriangle,
    verb: null,
  },

  // Generic / system
  invite: {
    category: "staff",
    icon: UserPlus,
    verb: "пригласил(а) вас",
  },
  warning: {
    category: "system",
    icon: AlertTriangle,
    verb: null,
  },

  // График: замена сотрудника на опубликованной смене (миграция 338).
  "schedule.shift_assigned": {
    category: "schedule",
    icon: UserCheck,
    verb: null,
    stack: ["новая смена", "новые смены", "новых смен"],
  },
  "schedule.shift_unassigned": {
    category: "schedule",
    icon: UserMinus,
    verb: null,
    stack: ["снятая смена", "снятые смены", "снятых смен"],
  },

  // График: заявка на замену смены (миграция 358).
  "schedule.swap_offered": {
    category: "schedule",
    icon: ArrowLeftRight,
    verb: null,
  },
  "schedule.swap_requested": {
    category: "schedule",
    icon: ArrowLeftRight,
    verb: null,
    stack: ["заявка на замену", "заявки на замену", "заявок на замену"],
  },
  "schedule.swap_answered": {
    category: "schedule",
    icon: MessageCircle,
    verb: null,
  },
  "schedule.swap_approved": {
    category: "schedule",
    icon: CheckCircle2,
    verb: null,
  },
  "schedule.swap_rejected": {
    category: "schedule",
    icon: XCircle,
    verb: null,
  },
  "schedule.swap_cancelled": {
    category: "schedule",
    icon: RotateCcw,
    verb: null,
  },

  // Future cross-module emit'еры добавляются здесь:
  // "finance.transaction_pending_approval": {...},
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
  "inventory",
  "crm",
  "system",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  kb: "База знаний",
  finance: "Финансы",
  schedule: "График",
  staff: "Команда",
  inventory: "Инвентаризация",
  crm: "Гости",
  system: "Прочее",
};

/** Default-icon (Bell) — экспортируется для bell-button'а вне registry. */
export { Bell };
