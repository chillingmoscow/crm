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
  MessageCircle,
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
  Warehouse,
  Thermometer,
  Fan,
  CalendarCheck,
  CalendarClock,
  Timer,
  Hourglass,
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
  /** Не показывать в окне выбора (значок остаётся в реестре). */
  hidden?: boolean;
};

/** Колонок в окне выбора: столько же, сколько цветов, — цвета встают
 *  одной строкой над той же сеткой, а группы — полными рядами. */
export const KB_ICON_PICKER_COLUMNS = 7;

export const KB_ICONS: KbIcon[] = [
  // ─── Документы ─────────────────────────────────────────
  { name: "file-text",         icon: FileText,        group: "Документы", label: "Документ" },
  { name: "book-open",         icon: BookOpen,        group: "Документы", label: "Книга" },
  { name: "notebook",          icon: Notebook,        group: "Документы", label: "Тетрадь" },
  { name: "scroll-text",       icon: ScrollText,      group: "Документы", label: "Свиток" },
  { name: "clipboard-list",    icon: ClipboardList,   group: "Документы", label: "Чек-лист" },
  { name: "list-checks",       icon: ListChecks,      group: "Документы", label: "Задачи" },
  { name: "check-square",      icon: CheckSquare,     group: "Документы", label: "Чекбокс" },
  { name: "lightbulb",         icon: Lightbulb,       group: "Документы", label: "Идея" },
  { name: "folder",            icon: Folder,          group: "Документы", label: "Папка" },
  { name: "folder-open",       icon: FolderOpen,      group: "Документы", label: "Открытая папка" },
  { name: "archive",           icon: Archive,         group: "Документы", label: "Архив" },
  { name: "tag",               icon: Tag,             group: "Документы", label: "Тег" },
  { name: "tags",              icon: Tags,            group: "Документы", label: "Теги" },
  { name: "bookmark",          icon: Bookmark,        group: "Документы", label: "Закладка" },

  // ─── Метки ─────────────────────────────────────────────
  { name: "star",              icon: Star,            group: "Метки", label: "Звезда" },
  { name: "heart",             icon: Heart,           group: "Метки", label: "Сердце" },
  { name: "flag",              icon: Flag,            group: "Метки", label: "Флаг" },
  { name: "pin",               icon: Pin,             group: "Метки", label: "Кнопка" },
  { name: "sparkles",          icon: Sparkles,        group: "Метки", label: "Искры" },
  { name: "award",             icon: Award,           group: "Метки", label: "Награда" },
  { name: "trophy",            icon: Trophy,          group: "Метки", label: "Кубок" },

  // ─── Люди и связь ──────────────────────────────────────
  { name: "user",              icon: User,            group: "Люди и связь", label: "Сотрудник" },
  { name: "users",             icon: Users,           group: "Люди и связь", label: "Команда" },
  { name: "chef-hat",          icon: ChefHat,         group: "Люди и связь", label: "Шеф" },
  { name: "concierge-bell",    icon: ConciergeBell,   group: "Люди и связь", label: "Стойка" },
  { name: "hand-platter",      icon: HandPlatter,     group: "Люди и связь", label: "Подача" },
  { name: "bell",              icon: Bell,            group: "Люди и связь", label: "Колокольчик" },
  { name: "gift",              icon: Gift,            group: "Люди и связь", label: "Подарок" },
  { name: "message-square",    icon: MessageSquare,   group: "Люди и связь", label: "Сообщение" },
  { name: "message-circle",    icon: MessageCircle,   group: "Люди и связь", label: "Сообщение (круг)" },
  { name: "mail",              icon: Mail,            group: "Люди и связь", label: "Письмо" },
  { name: "phone",             icon: Phone,           group: "Люди и связь", label: "Телефон" },
  { name: "at-sign",           icon: AtSign,          group: "Люди и связь", label: "@" },
  { name: "hash",              icon: Hash,            group: "Люди и связь", label: "Хештег" },
  { name: "link-2",            icon: Link2,           group: "Люди и связь", label: "Ссылка" },

  // ─── Время ─────────────────────────────────────────────
  { name: "calendar",          icon: Calendar,        group: "Время", label: "Календарь" },
  { name: "calendar-check",    icon: CalendarCheck,   group: "Время", label: "Календарь с отметкой" },
  { name: "calendar-clock",    icon: CalendarClock,   group: "Время", label: "Срок" },
  { name: "clock",             icon: Clock,           group: "Время", label: "Часы" },
  { name: "alarm-clock",       icon: AlarmClock,      group: "Время", label: "Будильник" },
  { name: "timer",             icon: Timer,           group: "Время", label: "Таймер" },
  { name: "hourglass",         icon: Hourglass,       group: "Время", label: "Песочные часы" },

  // ─── Финансы ───────────────────────────────────────────
  { name: "wallet",            icon: Wallet,          group: "Финансы", label: "Кошелёк" },
  { name: "calculator",        icon: Calculator,      group: "Финансы", label: "Калькулятор" },
  { name: "receipt",           icon: Receipt,         group: "Финансы", label: "Чек" },
  { name: "trending-up",       icon: TrendingUp,      group: "Финансы", label: "Рост" },
  { name: "trending-down",     icon: TrendingDown,    group: "Финансы", label: "Падение" },
  { name: "percent",           icon: Percent,         group: "Финансы", label: "Процент" },
  { name: "activity",          icon: Activity,        group: "Финансы", label: "Активность" },

  // ─── Места ─────────────────────────────────────────────
  { name: "home",              icon: Home,            group: "Места", label: "Дом" },
  { name: "building-2",        icon: Building2,       group: "Места", label: "Здание" },
  { name: "store",             icon: Store,           group: "Места", label: "Магазин" },
  { name: "warehouse",         icon: Warehouse,       group: "Места", label: "Склад" },
  { name: "shopping-cart",     icon: ShoppingCart,    group: "Места", label: "Корзина" },
  { name: "shopping-bag",      icon: ShoppingBag,     group: "Места", label: "Сумка" },
  { name: "map",               icon: Map,             group: "Места", label: "Карта" },
  { name: "map-pin",           icon: MapPin,          group: "Места", label: "Точка на карте" },
  { name: "compass",           icon: Compass,         group: "Места", label: "Компас" },
  { name: "globe",             icon: Globe,           group: "Места", label: "Глобус" },
  { name: "truck",             icon: Truck,           group: "Места", label: "Доставка" },
  { name: "bike",              icon: Bike,            group: "Места", label: "Велосипед" },
  { name: "car",               icon: Car,             group: "Места", label: "Авто" },
  { name: "package",           icon: Package,         group: "Места", label: "Коробка" },

  // ─── Напитки ───────────────────────────────────────────
  { name: "coffee",            icon: Coffee,          group: "Напитки", label: "Кофе" },
  { name: "wine",              icon: Wine,            group: "Напитки", label: "Вино" },
  { name: "beer",              icon: Beer,            group: "Напитки", label: "Пиво" },
  { name: "martini",           icon: Martini,         group: "Напитки", label: "Коктейль" },
  { name: "cup-soda",          icon: CupSoda,         group: "Напитки", label: "Напиток" },
  { name: "glass-water",       icon: GlassWater,      group: "Напитки", label: "Вода" },
  { name: "milk",              icon: Milk,            group: "Напитки", label: "Молоко" },

  // ─── Блюда ─────────────────────────────────────────────
  { name: "pizza",             icon: Pizza,           group: "Блюда", label: "Пицца" },
  { name: "soup",              icon: Soup,            group: "Блюда", label: "Суп" },
  { name: "salad",             icon: Salad,           group: "Блюда", label: "Салат" },
  { name: "sandwich",          icon: Sandwich,        group: "Блюда", label: "Сэндвич" },
  { name: "beef",              icon: Beef,            group: "Блюда", label: "Мясо" },
  { name: "fish",              icon: Fish,            group: "Блюда", label: "Рыба" },
  { name: "drumstick",         icon: Drumstick,       group: "Блюда", label: "Курица" },
  { name: "ham",               icon: Ham,             group: "Блюда", label: "Ветчина" },
  { name: "egg",               icon: Egg,             group: "Блюда", label: "Яйцо" },
  { name: "egg-fried",         icon: EggFried,        group: "Блюда", label: "Яичница" },
  { name: "croissant",         icon: Croissant,       group: "Блюда", label: "Круассан" },
  { name: "cookie",            icon: Cookie,          group: "Блюда", label: "Печенье" },
  { name: "popcorn",           icon: Popcorn,         group: "Блюда", label: "Попкорн" },
  { name: "wheat",             icon: Wheat,           group: "Блюда", label: "Пшеница" },

  // ─── Продукты ──────────────────────────────────────────
  { name: "apple",             icon: Apple,           group: "Продукты", label: "Яблоко" },
  { name: "banana",            icon: Banana,          group: "Продукты", label: "Банан" },
  { name: "cherry",            icon: Cherry,          group: "Продукты", label: "Вишня" },
  { name: "citrus",            icon: Citrus,          group: "Продукты", label: "Цитрус" },
  { name: "grape",             icon: Grape,           group: "Продукты", label: "Виноград" },
  { name: "carrot",            icon: Carrot,          group: "Продукты", label: "Морковь" },
  { name: "vegan",             icon: Vegan,           group: "Продукты", label: "Веган" },

  // ─── Сладкое ───────────────────────────────────────────
  { name: "cake",              icon: Cake,            group: "Сладкое", label: "Торт" },
  { name: "cake-slice",        icon: CakeSlice,       group: "Сладкое", label: "Кусок торта" },
  { name: "donut",             icon: Donut,           group: "Сладкое", label: "Пончик" },
  { name: "ice-cream-cone",    icon: IceCreamCone,    group: "Сладкое", label: "Рожок" },
  { name: "ice-cream-bowl",    icon: IceCreamBowl,    group: "Сладкое", label: "Десерт" },
  { name: "candy",             icon: Candy,           group: "Сладкое", label: "Конфета" },
  { name: "lollipop",          icon: Lollipop,        group: "Сладкое", label: "Леденец" },

  // ─── Посуда и техника ──────────────────────────────────
  { name: "utensils",          icon: Utensils,        group: "Посуда и техника", label: "Сервировка" },
  { name: "utensils-crossed",  icon: UtensilsCrossed, group: "Посуда и техника", label: "Приборы" },
  { name: "cooking-pot",       icon: CookingPot,      group: "Посуда и техника", label: "Кастрюля" },
  { name: "refrigerator",      icon: Refrigerator,    group: "Посуда и техника", label: "Холодильник" },
  { name: "microwave",         icon: Microwave,       group: "Посуда и техника", label: "Микроволновка" },
  { name: "thermometer",       icon: Thermometer,     group: "Посуда и техника", label: "Термометр" },
  { name: "fan",               icon: Fan,             group: "Посуда и техника", label: "Вентиляция" },

  // ─── Инструменты ───────────────────────────────────────
  { name: "wrench",            icon: Wrench,          group: "Инструменты", label: "Гаечный ключ" },
  { name: "hammer",            icon: Hammer,          group: "Инструменты", label: "Молоток" },
  { name: "settings",          icon: Settings,        group: "Инструменты", label: "Настройки" },
  { name: "settings-2",        icon: Settings2,       group: "Инструменты", label: "Параметры" },
  { name: "key",               icon: Key,             group: "Инструменты", label: "Ключ" },
  { name: "lock",              icon: Lock,            group: "Инструменты", label: "Замок" },
  { name: "shield-check",      icon: ShieldCheck,     group: "Инструменты", label: "Защита" },

  // ─── Природа ───────────────────────────────────────────
  { name: "sun",               icon: Sun,             group: "Природа", label: "Солнце" },
  { name: "moon",              icon: Moon,            group: "Природа", label: "Луна" },
  { name: "cloud",             icon: Cloud,           group: "Природа", label: "Облако" },
  { name: "droplet",           icon: Droplet,         group: "Природа", label: "Капля" },
  { name: "leaf",              icon: Leaf,            group: "Природа", label: "Лист" },
  { name: "sprout",            icon: Sprout,          group: "Природа", label: "Росток" },
  { name: "tree-pine",         icon: TreePine,        group: "Природа", label: "Дерево" },

  // ─── Прочее ────────────────────────────────────────────
  { name: "music",             icon: Music,           group: "Прочее", label: "Музыка" },
  { name: "mic",               icon: Mic,             group: "Прочее", label: "Микрофон" },
  { name: "headphones",        icon: Headphones,      group: "Прочее", label: "Наушники" },
  { name: "camera",            icon: Camera,          group: "Прочее", label: "Камера" },
  { name: "briefcase",         icon: Briefcase,       group: "Прочее", label: "Портфель" },
  { name: "flame",             icon: Flame,           group: "Прочее", label: "Огонь" },
  { name: "zap",               icon: Zap,             group: "Прочее", label: "Молния" },

  // ─── Не показываются в окне выбора: дубли и значки не для ресторана.
  //     Остаются в реестре — у страниц, где они уже стоят, значок рисуется.
  { name: "medal",             icon: Medal,           group: "Метки", label: "Медаль", hidden: true },
  { name: "ice-cream",         icon: IceCream,        group: "Сладкое", label: "Мороженое", hidden: true },
  { name: "box",               icon: Box,             group: "Папки", label: "Куб", hidden: true },
  { name: "shield",            icon: Shield,          group: "Инструменты", label: "Щит", hidden: true },
  { name: "database",          icon: Database,        group: "Инструменты", label: "БД", hidden: true },
  { name: "code",              icon: Code,            group: "Инструменты", label: "Код", hidden: true },
  { name: "terminal",          icon: Terminal,        group: "Инструменты", label: "Терминал", hidden: true },
  { name: "bug",               icon: Bug,             group: "Инструменты", label: "Баг", hidden: true },
  { name: "git-branch",        icon: GitBranch,       group: "Инструменты", label: "Git", hidden: true },
  { name: "plus",              icon: Plus,            group: "Прочее", label: "Плюс", hidden: true },
  { name: "minus",             icon: Minus,           group: "Прочее", label: "Минус", hidden: true },
  { name: "equal",             icon: Equal,           group: "Прочее", label: "Равно", hidden: true },
];

/** Значки окна выбора по группам, в порядке реестра; скрытые не входят. */
export const KB_PICKER_ICON_GROUPS: { group: string; items: KbIcon[] }[] = (() => {
  const groups: { group: string; items: KbIcon[] }[] = [];
  for (const item of KB_ICONS) {
    if (item.hidden) continue;
    const last = groups[groups.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return groups;
})();

/** Значки окна выбора одним списком (для поиска). */
export const KB_PICKER_ICONS: KbIcon[] = KB_PICKER_ICON_GROUPS.flatMap((g) => g.items);

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
} from "../palette.ts";
