import {
  Shield,
  ShieldCheck,
  Crown,
  Briefcase,
  Calculator,
  UserCheck,
  UtensilsCrossed,
  Settings2,
  Users,
  CircleUserRound,
  Wallet,
  Building2,
  Coffee,
  Wine,
  Pizza,
  Star,
  Heart,
  Key,
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

export const ICON_REGISTRY: Record<string, LucideIcon> = {
  shield:           Shield,
  "shield-check":   ShieldCheck,
  crown:            Crown,
  briefcase:        Briefcase,
  calculator:       Calculator,
  "user-check":     UserCheck,
  "utensils-crossed": UtensilsCrossed,
  "settings-2":     Settings2,
  users:            Users,
  "circle-user-round": CircleUserRound,
  wallet:           Wallet,
  "building-2":     Building2,
  coffee:           Coffee,
  wine:             Wine,
  pizza:            Pizza,
  star:             Star,
  heart:            Heart,
  key:              Key,
};

/** Порядок отображения в picker'е. */
export const PICKABLE_ICONS: { name: string; icon: LucideIcon; label: string }[] = [
  { name: "shield",            icon: Shield,           label: "Щит" },
  { name: "shield-check",      icon: ShieldCheck,      label: "Щит-чек" },
  { name: "crown",             icon: Crown,            label: "Корона" },
  { name: "briefcase",         icon: Briefcase,        label: "Портфель" },
  { name: "settings-2",        icon: Settings2,        label: "Настройки" },
  { name: "key",               icon: Key,              label: "Ключ" },
  { name: "calculator",        icon: Calculator,       label: "Калькулятор" },
  { name: "wallet",            icon: Wallet,           label: "Кошелёк" },
  { name: "user-check",        icon: UserCheck,        label: "Хостес" },
  { name: "utensils-crossed",  icon: UtensilsCrossed,  label: "Официант" },
  { name: "coffee",            icon: Coffee,           label: "Кофе" },
  { name: "wine",              icon: Wine,             label: "Бар" },
  { name: "pizza",             icon: Pizza,            label: "Кухня" },
  { name: "users",             icon: Users,            label: "Группа" },
  { name: "circle-user-round", icon: CircleUserRound,  label: "Гость" },
  { name: "building-2",        icon: Building2,        label: "Здание" },
  { name: "star",              icon: Star,             label: "Звезда" },
  { name: "heart",             icon: Heart,            label: "Сердце" },
];

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
