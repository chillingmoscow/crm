import {
  FileText,
  BookOpen,
  Notebook,
  ScrollText,
  ClipboardList,
  ListChecks,
  CheckSquare,
  Lightbulb,
  Star,
  Heart,
  Flag,
  Bookmark,
  Pin,
  Archive,
  Folder,
  FolderOpen,
  Building2,
  Users,
  User,
  ChefHat,
  Utensils,
  UtensilsCrossed,
  Coffee,
  Wine,
  Beer,
  Pizza,
  Cake,
  IceCream,
  Soup,
  Salad,
  ConciergeBell,
  HandPlatter,
  Calculator,
  Wallet,
  Receipt,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Calendar,
  Clock,
  AlarmClock,
  Bell,
  MessageSquare,
  Mail,
  Phone,
  Camera,
  Music,
  Mic,
  Headphones,
  Truck,
  Bike,
  Car,
  Map,
  MapPin,
  Compass,
  Globe,
  Home,
  Store,
  ShoppingCart,
  ShoppingBag,
  Package,
  Box,
  Gift,
  Award,
  Trophy,
  Medal,
  Sparkles,
  Zap,
  Flame,
  Sun,
  Moon,
  Cloud,
  Droplet,
  Leaf,
  Sprout,
  TreePine,
  Apple,
  Banana,
  Carrot,
  Cherry,
  Citrus,
  Grape,
  Croissant,
  Egg,
  EggFried,
  Fish,
  Beef,
  Drumstick,
  Ham,
  Sandwich,
  Cookie,
  CupSoda,
  Martini,
  CookingPot,
  Refrigerator,
  Microwave,
  Donut,
  CakeSlice,
  IceCreamBowl,
  IceCreamCone,
  Lollipop,
  Candy,
  Popcorn,
  GlassWater,
  Milk,
  Wheat,
  Vegan,
  Wrench,
  Hammer,
  Settings,
  Settings2,
  Shield,
  ShieldCheck,
  Key,
  Lock,
  Database,
  Code,
  Terminal,
  Bug,
  GitBranch,
  Link2,
  Tag,
  Tags,
  AtSign,
  Hash,
  Percent,
  Plus,
  Minus,
  Equal,
  Activity,
  type LucideIcon,
} from "lucide-react";

/**
 * Реестр иконок для KB-страниц.
 *
 * Хранится в `kb_pages.icon` как короткое имя (e.g. `book-open`).
 * Если в БД лежит значение, которого нет в реестре, считаем его
 * «свободным текстом» (обычно emoji), и рендерим как text node.
 */

export type KbIcon = {
  name: string;
  icon: LucideIcon;
  /** UI-категория для группировки в picker'е. */
  group: string;
  /** Подсказка title/aria. */
  label: string;
};

export const KB_ICONS: KbIcon[] = [
  // ─── Документы ─────────────────────────────────────────
  { name: "file-text",       icon: FileText,       group: "Документы", label: "Документ" },
  { name: "book-open",       icon: BookOpen,       group: "Документы", label: "Книга" },
  { name: "notebook",        icon: Notebook,       group: "Документы", label: "Тетрадь" },
  { name: "scroll-text",     icon: ScrollText,     group: "Документы", label: "Свиток" },
  { name: "clipboard-list",  icon: ClipboardList,  group: "Документы", label: "Чек-лист" },
  { name: "list-checks",     icon: ListChecks,     group: "Документы", label: "Задачи" },
  { name: "check-square",    icon: CheckSquare,    group: "Документы", label: "Чекбокс" },
  { name: "lightbulb",       icon: Lightbulb,      group: "Документы", label: "Идея" },
  { name: "tag",             icon: Tag,            group: "Документы", label: "Тег" },
  { name: "tags",            icon: Tags,           group: "Документы", label: "Теги" },

  // ─── Метки ─────────────────────────────────────────────
  { name: "star",            icon: Star,           group: "Метки",     label: "Звезда" },
  { name: "heart",           icon: Heart,          group: "Метки",     label: "Сердце" },
  { name: "flag",            icon: Flag,           group: "Метки",     label: "Флаг" },
  { name: "bookmark",        icon: Bookmark,       group: "Метки",     label: "Закладка" },
  { name: "pin",             icon: Pin,            group: "Метки",     label: "Кнопка" },
  { name: "sparkles",        icon: Sparkles,       group: "Метки",     label: "Искры" },
  { name: "award",           icon: Award,          group: "Метки",     label: "Награда" },
  { name: "trophy",          icon: Trophy,         group: "Метки",     label: "Кубок" },
  { name: "medal",           icon: Medal,          group: "Метки",     label: "Медаль" },

  // ─── Папки ─────────────────────────────────────────────
  { name: "folder",          icon: Folder,         group: "Папки",     label: "Папка" },
  { name: "folder-open",     icon: FolderOpen,     group: "Папки",     label: "Открытая папка" },
  { name: "archive",         icon: Archive,        group: "Папки",     label: "Архив" },
  { name: "package",         icon: Package,        group: "Папки",     label: "Коробка" },
  { name: "box",             icon: Box,            group: "Папки",     label: "Куб" },

  // ─── Команда ───────────────────────────────────────────
  { name: "user",            icon: User,           group: "Команда",   label: "Сотрудник" },
  { name: "users",           icon: Users,          group: "Команда",   label: "Команда" },
  { name: "chef-hat",        icon: ChefHat,        group: "Команда",   label: "Шеф" },
  { name: "concierge-bell",  icon: ConciergeBell,  group: "Команда",   label: "Стойка" },
  { name: "hand-platter",    icon: HandPlatter,    group: "Команда",   label: "Подача" },

  // ─── Посуда и техника ──────────────────────────────────
  { name: "utensils",         icon: Utensils,         group: "Посуда и техника", label: "Сервировка" },
  { name: "utensils-crossed", icon: UtensilsCrossed,  group: "Посуда и техника", label: "Приборы" },
  { name: "cooking-pot",      icon: CookingPot,       group: "Посуда и техника", label: "Кастрюля" },
  { name: "refrigerator",     icon: Refrigerator,     group: "Посуда и техника", label: "Холодильник" },
  { name: "microwave",        icon: Microwave,        group: "Посуда и техника", label: "Микроволновка" },

  // ─── Напитки ───────────────────────────────────────────
  { name: "coffee",           icon: Coffee,           group: "Напитки",     label: "Кофе" },
  { name: "wine",             icon: Wine,             group: "Напитки",     label: "Вино" },
  { name: "beer",             icon: Beer,             group: "Напитки",     label: "Пиво" },
  { name: "martini",          icon: Martini,          group: "Напитки",     label: "Коктейль" },
  { name: "cup-soda",         icon: CupSoda,          group: "Напитки",     label: "Напиток" },
  { name: "glass-water",      icon: GlassWater,       group: "Напитки",     label: "Вода" },
  { name: "milk",             icon: Milk,             group: "Напитки",     label: "Молоко" },

  // ─── Блюда ─────────────────────────────────────────────
  { name: "pizza",            icon: Pizza,            group: "Блюда",       label: "Пицца" },
  { name: "soup",             icon: Soup,             group: "Блюда",       label: "Суп" },
  { name: "salad",            icon: Salad,            group: "Блюда",       label: "Салат" },
  { name: "sandwich",         icon: Sandwich,         group: "Блюда",       label: "Сэндвич" },
  { name: "beef",             icon: Beef,             group: "Блюда",       label: "Мясо" },
  { name: "fish",             icon: Fish,             group: "Блюда",       label: "Рыба" },
  { name: "drumstick",        icon: Drumstick,        group: "Блюда",       label: "Курица" },
  { name: "ham",              icon: Ham,              group: "Блюда",       label: "Ветчина" },
  { name: "egg",              icon: Egg,              group: "Блюда",       label: "Яйцо" },
  { name: "egg-fried",        icon: EggFried,         group: "Блюда",       label: "Яичница" },

  // ─── Продукты ──────────────────────────────────────────
  { name: "apple",            icon: Apple,            group: "Продукты",    label: "Яблоко" },
  { name: "banana",           icon: Banana,           group: "Продукты",    label: "Банан" },
  { name: "cherry",           icon: Cherry,           group: "Продукты",    label: "Вишня" },
  { name: "citrus",           icon: Citrus,           group: "Продукты",    label: "Цитрус" },
  { name: "grape",            icon: Grape,            group: "Продукты",    label: "Виноград" },
  { name: "carrot",           icon: Carrot,           group: "Продукты",    label: "Морковь" },
  { name: "wheat",            icon: Wheat,            group: "Продукты",    label: "Пшеница" },
  { name: "vegan",            icon: Vegan,            group: "Продукты",    label: "Веган" },

  // ─── Сладкое ───────────────────────────────────────────
  { name: "croissant",        icon: Croissant,        group: "Сладкое",     label: "Круассан" },
  { name: "cake",             icon: Cake,             group: "Сладкое",     label: "Торт" },
  { name: "cake-slice",       icon: CakeSlice,        group: "Сладкое",     label: "Кусок торта" },
  { name: "donut",            icon: Donut,            group: "Сладкое",     label: "Пончик" },
  { name: "ice-cream",        icon: IceCream,         group: "Сладкое",     label: "Мороженое" },
  { name: "ice-cream-bowl",   icon: IceCreamBowl,     group: "Сладкое",     label: "Десерт" },
  { name: "ice-cream-cone",   icon: IceCreamCone,     group: "Сладкое",     label: "Рожок" },
  { name: "cookie",           icon: Cookie,           group: "Сладкое",     label: "Печенье" },
  { name: "candy",            icon: Candy,            group: "Сладкое",     label: "Конфета" },
  { name: "lollipop",         icon: Lollipop,         group: "Сладкое",     label: "Леденец" },
  { name: "popcorn",          icon: Popcorn,          group: "Сладкое",     label: "Попкорн" },

  // ─── Финансы ───────────────────────────────────────────
  { name: "wallet",           icon: Wallet,           group: "Финансы",     label: "Кошелёк" },
  { name: "calculator",       icon: Calculator,       group: "Финансы",     label: "Калькулятор" },
  { name: "receipt",          icon: Receipt,          group: "Финансы",     label: "Чек" },
  { name: "trending-up",      icon: TrendingUp,       group: "Финансы",     label: "Рост" },
  { name: "trending-down",    icon: TrendingDown,     group: "Финансы",     label: "Падение" },
  { name: "percent",          icon: Percent,          group: "Финансы",     label: "Процент" },

  // ─── Время и план ──────────────────────────────────────
  { name: "calendar",         icon: Calendar,         group: "Время",       label: "Календарь" },
  { name: "clock",            icon: Clock,            group: "Время",       label: "Часы" },
  { name: "alarm-clock",      icon: AlarmClock,       group: "Время",       label: "Будильник" },
  { name: "bell",             icon: Bell,             group: "Время",       label: "Колокольчик" },

  // ─── Связь ─────────────────────────────────────────────
  { name: "message-square",   icon: MessageSquare,    group: "Связь",       label: "Сообщение" },
  { name: "mail",             icon: Mail,             group: "Связь",       label: "Письмо" },
  { name: "phone",            icon: Phone,            group: "Связь",       label: "Телефон" },
  { name: "at-sign",          icon: AtSign,           group: "Связь",       label: "@" },
  { name: "hash",             icon: Hash,             group: "Связь",       label: "Хештег" },
  { name: "link-2",           icon: Link2,            group: "Связь",       label: "Ссылка" },

  // ─── Места ─────────────────────────────────────────────
  { name: "home",             icon: Home,             group: "Места",       label: "Дом" },
  { name: "building-2",       icon: Building2,        group: "Места",       label: "Здание" },
  { name: "store",            icon: Store,            group: "Места",       label: "Магазин" },
  { name: "shopping-cart",    icon: ShoppingCart,     group: "Места",       label: "Корзина" },
  { name: "shopping-bag",     icon: ShoppingBag,      group: "Места",       label: "Сумка" },
  { name: "map",              icon: Map,              group: "Места",       label: "Карта" },
  { name: "map-pin",          icon: MapPin,           group: "Места",       label: "Точка на карте" },
  { name: "compass",          icon: Compass,          group: "Места",       label: "Компас" },
  { name: "globe",            icon: Globe,            group: "Места",       label: "Глобус" },
  { name: "truck",            icon: Truck,            group: "Места",       label: "Доставка" },
  { name: "bike",             icon: Bike,             group: "Места",       label: "Велосипед" },
  { name: "car",              icon: Car,              group: "Места",       label: "Авто" },

  // ─── Стихии ────────────────────────────────────────────
  { name: "sun",              icon: Sun,              group: "Стихии",      label: "Солнце" },
  { name: "moon",             icon: Moon,             group: "Стихии",      label: "Луна" },
  { name: "cloud",            icon: Cloud,            group: "Стихии",      label: "Облако" },
  { name: "droplet",          icon: Droplet,          group: "Стихии",      label: "Капля" },
  { name: "leaf",             icon: Leaf,             group: "Стихии",      label: "Лист" },
  { name: "sprout",           icon: Sprout,           group: "Стихии",      label: "Росток" },
  { name: "tree-pine",        icon: TreePine,         group: "Стихии",      label: "Дерево" },
  { name: "flame",            icon: Flame,            group: "Стихии",      label: "Огонь" },
  { name: "zap",              icon: Zap,              group: "Стихии",      label: "Молния" },

  // ─── Инструменты ───────────────────────────────────────
  { name: "wrench",           icon: Wrench,           group: "Инструменты", label: "Гаечный ключ" },
  { name: "hammer",           icon: Hammer,           group: "Инструменты", label: "Молоток" },
  { name: "settings",         icon: Settings,         group: "Инструменты", label: "Настройки" },
  { name: "settings-2",       icon: Settings2,        group: "Инструменты", label: "Параметры" },
  { name: "shield",           icon: Shield,           group: "Инструменты", label: "Щит" },
  { name: "shield-check",     icon: ShieldCheck,      group: "Инструменты", label: "Защита" },
  { name: "key",              icon: Key,              group: "Инструменты", label: "Ключ" },
  { name: "lock",             icon: Lock,             group: "Инструменты", label: "Замок" },
  { name: "database",         icon: Database,         group: "Инструменты", label: "БД" },
  { name: "code",             icon: Code,             group: "Инструменты", label: "Код" },
  { name: "terminal",         icon: Terminal,         group: "Инструменты", label: "Терминал" },
  { name: "bug",              icon: Bug,              group: "Инструменты", label: "Баг" },
  { name: "git-branch",       icon: GitBranch,        group: "Инструменты", label: "Git" },
  { name: "activity",         icon: Activity,         group: "Инструменты", label: "Активность" },

  // ─── Прочее ────────────────────────────────────────────
  { name: "gift",             icon: Gift,             group: "Прочее",      label: "Подарок" },
  { name: "music",            icon: Music,            group: "Прочее",      label: "Музыка" },
  { name: "mic",              icon: Mic,              group: "Прочее",      label: "Микрофон" },
  { name: "headphones",       icon: Headphones,       group: "Прочее",      label: "Наушники" },
  { name: "camera",           icon: Camera,           group: "Прочее",      label: "Камера" },
  { name: "briefcase",        icon: Briefcase,        group: "Прочее",      label: "Портфель" },
  { name: "plus",             icon: Plus,             group: "Прочее",      label: "Плюс" },
  { name: "minus",            icon: Minus,            group: "Прочее",      label: "Минус" },
  { name: "equal",            icon: Equal,            group: "Прочее",      label: "Равно" },
];

const ICON_REGISTRY: Record<string, LucideIcon> = Object.fromEntries(
  KB_ICONS.map((it) => [it.name, it.icon]),
);

/**
 * Узнать, является ли строка ключом из Lucide-реестра. Если нет —
 * считаем значение свободным текстом (emoji или произвольная строка).
 */
export function isKbLucideIcon(value: string | null | undefined): boolean {
  if (!value) return false;
  return value in ICON_REGISTRY;
}

export function getKbLucideIcon(name: string): LucideIcon | null {
  return ICON_REGISTRY[name] ?? null;
}

// ─── Цветовая палитра ─────────────────────────────────────────────────────
//
// Палитра промоутнута в `@/lib/palette` (10 Notion-цветов + `default`).
// Здесь оставляем re-export'ы со старыми именами для обратной совместимости
// существующих call-site'ов (kb-icon-picker, kb-page-icon, kb-page-properties,
// types/knowledge.ts). Новый код должен импортировать напрямую из `@/lib/palette`.

export {
  paletteText as colorTextClass,
  paletteBg as colorTintClass,
  paletteDot as colorDotClass,
  type PaletteColor as KbIconColor,
  PALETTE_COLORS as KB_ICON_COLORS,
} from "@/lib/palette";
