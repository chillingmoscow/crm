import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Crown,
  Briefcase,
  Calculator,
  UserCheck,
  UtensilsCrossed,
  Utensils,
  Settings2,
  Settings,
  Users,
  User,
  CircleUserRound,
  Wallet,
  Building2,
  Building,
  Store,
  Coffee,
  Wine,
  Beer,
  Pizza,
  Soup,
  Salad,
  IceCream,
  Cake,
  ChefHat,
  ConciergeBell,
  Receipt,
  Truck,
  Bike,
  Sparkles,
  Star,
  Heart,
  Award,
  Trophy,
  Medal,
  Key,
  KeyRound,
  Lock,
  Headphones,
  Mic,
  Music,
  Camera,
  Clipboard,
  ClipboardList,
  Phone,
  HandHeart,
  HandPlatter,
  type LucideIcon,
} from "lucide-react";

/**
 * Реестр иконок ролей.
 *
 * Системные роли (по `code`) имеют зашитую иконку для консистентности
 * с дизайн-системой. Кастомные роли могут переопределить иконку через
 * `roles.icon` (имя из `ICON_REGISTRY`).
 *
 * Если `role.icon` задано и есть в реестре — приоритет у него.
 * Иначе — fallback по системному `code`. Иначе — `Shield`.
 */

/** Порядок отображения в picker'е, сгруппирован тематически. */
export const PICKABLE_ICONS: { name: string; icon: LucideIcon; label: string }[] = [
  // Power / authority
  { name: "shield",            icon: Shield,           label: "Щит" },
  { name: "shield-check",      icon: ShieldCheck,      label: "Щит-чек" },
  { name: "shield-alert",      icon: ShieldAlert,      label: "Щит-внимание" },
  { name: "crown",             icon: Crown,            label: "Корона" },
  { name: "key",               icon: Key,              label: "Ключ" },
  { name: "key-round",         icon: KeyRound,         label: "Ключ круглый" },
  { name: "lock",              icon: Lock,             label: "Замок" },
  // Office / management
  { name: "briefcase",         icon: Briefcase,        label: "Портфель" },
  { name: "settings",          icon: Settings,         label: "Настройки" },
  { name: "settings-2",        icon: Settings2,        label: "Параметры" },
  { name: "calculator",        icon: Calculator,       label: "Калькулятор" },
  { name: "wallet",            icon: Wallet,           label: "Кошелёк" },
  { name: "receipt",           icon: Receipt,          label: "Чек" },
  { name: "clipboard",         icon: Clipboard,        label: "Планшет" },
  { name: "clipboard-list",    icon: ClipboardList,    label: "Список" },
  // People / customers
  { name: "user",              icon: User,             label: "Пользователь" },
  { name: "users",             icon: Users,            label: "Группа" },
  { name: "user-check",        icon: UserCheck,        label: "Хостес" },
  { name: "circle-user-round", icon: CircleUserRound,  label: "Гость" },
  { name: "concierge-bell",    icon: ConciergeBell,    label: "Стойка" },
  { name: "hand-platter",      icon: HandPlatter,      label: "Подача" },
  { name: "hand-heart",        icon: HandHeart,        label: "Забота" },
  // Kitchen / service
  { name: "chef-hat",          icon: ChefHat,          label: "Шеф" },
  { name: "utensils-crossed",  icon: UtensilsCrossed,  label: "Приборы" },
  { name: "utensils",          icon: Utensils,         label: "Сервировка" },
  { name: "soup",              icon: Soup,             label: "Суп" },
  { name: "salad",             icon: Salad,            label: "Салат" },
  { name: "pizza",             icon: Pizza,            label: "Пицца" },
  { name: "ice-cream",         icon: IceCream,         label: "Десерт" },
  { name: "cake",              icon: Cake,             label: "Торт" },
  // Bar
  { name: "coffee",            icon: Coffee,           label: "Кофе" },
  { name: "wine",              icon: Wine,             label: "Вино" },
  { name: "beer",              icon: Beer,             label: "Пиво" },
  // Place / logistics
  { name: "building-2",        icon: Building2,        label: "Здание" },
  { name: "building",          icon: Building,         label: "Офис" },
  { name: "store",             icon: Store,            label: "Магазин" },
  { name: "truck",             icon: Truck,            label: "Доставка" },
  { name: "bike",              icon: Bike,             label: "Курьер" },
  // Decor / accent
  { name: "sparkles",          icon: Sparkles,         label: "Искры" },
  { name: "star",              icon: Star,             label: "Звезда" },
  { name: "heart",             icon: Heart,            label: "Сердце" },
  { name: "award",             icon: Award,            label: "Награда" },
  { name: "trophy",            icon: Trophy,           label: "Кубок" },
  { name: "medal",             icon: Medal,            label: "Медаль" },
  // Multimedia / contact
  { name: "headphones",        icon: Headphones,       label: "Поддержка" },
  { name: "mic",               icon: Mic,              label: "Микрофон" },
  { name: "music",             icon: Music,            label: "Музыка" },
  { name: "camera",            icon: Camera,           label: "Камера" },
  { name: "phone",             icon: Phone,            label: "Телефон" },
];

export const ICON_REGISTRY: Record<string, LucideIcon> = Object.fromEntries(
  PICKABLE_ICONS.map((it) => [it.name, it.icon]),
);

const SYSTEM_ROLE_ICONS: Record<string, LucideIcon> = {
  owner:      Shield,
  manager:    Briefcase,
  admin:      Settings2,
  accountant: Calculator,
  host:       UserCheck,
  hostess:    UserCheck,
  waiter:     UtensilsCrossed,
};

/**
 * Получить иконку для роли. Override (`role.icon`) имеет приоритет
 * над системным маппингом по `code`.
 *
 * @param code  системный код роли (owner, manager, admin, …)
 * @param iconOverride опциональное имя иконки из ICON_REGISTRY
 */
export function iconForRole(
  code: string,
  iconOverride?: string | null,
): LucideIcon {
  if (iconOverride && ICON_REGISTRY[iconOverride]) {
    return ICON_REGISTRY[iconOverride];
  }
  return SYSTEM_ROLE_ICONS[code] ?? Shield;
}
